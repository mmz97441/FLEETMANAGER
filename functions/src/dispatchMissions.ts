import { createHash } from 'crypto';
import { Firestore } from 'firebase-admin/firestore';
import { https } from 'firebase-functions/v1';
import { placeKey } from './deliveryAddress';

const bad = (message: string): never => { throw new https.HttpsError('invalid-argument', message); };
const unavailable = (message: string): never => { throw new https.HttpsError('failed-precondition', message); };
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
const time = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const text = (value: unknown, max = 500): string => typeof value === 'string' ? value.slice(0, max) : '';
const nonnegative = (value: unknown, fallback = 0): number => value === undefined ? fallback : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : bad('Durée ou distance invalide.');

// Canonical serialization makes a receipt independent of JSON object key order.
const stable = (value: any): string => Array.isArray(value)
  ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
    : JSON.stringify(value);

/** All reads precede writes. A stale parcel rejects the entire dispatch. */
export async function dispatchMissionsTransaction(db: Firestore, data: any, caller: any) {
  if (!id(data?.requestId) || !Array.isArray(data.missions) || !data.missions.length || data.missions.length > 20)
    bad('Dispatch invalide : 1 à 20 tournées par envoi.');
  const parcelIds = new Set<string>();
  const drivers = new Set<string>();
  const vehicles = new Set<string>();
  const missions = data.missions.map((m: any) => {
    if (!m || !id(m.driverId) || !id(m.hubId) || !/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !time(m.plannedDepartureTime) || !['Nord', 'Sud', 'Est', 'Ouest'].includes(m.zone))
      bad('Date, chauffeur, hub, zone ou heure de départ invalide.');
    const date = new Date(m.date + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== m.date) bad('Date de tournée invalide.');
    if (drivers.has(m.driverId)) bad('Un chauffeur apparaît sur plusieurs tournées du même dispatch.');
    drivers.add(m.driverId);
    if (m.vehicleId) {
      if (!id(m.vehicleId) || vehicles.has(m.vehicleId)) bad('Véhicule invalide ou utilisé deux fois.');
      vehicles.add(m.vehicleId);
    }
    if (!Array.isArray(m.stops) || !m.stops.length || m.stops.length > 450) bad('Liste des arrêts invalide.');
    const stopIds = new Set<string>();
    const stops = m.stops.map((s: any, index: number) => {
      if (!s || !id(s.id) || stopIds.has(s.id) || s.type !== 'DELIVERY' || !Array.isArray(s.packageIds) || !s.packageIds.length)
        bad('Arrêt de livraison invalide.');
      stopIds.add(s.id);
      for (const parcelId of s.packageIds) {
        if (!id(parcelId) || parcelIds.has(parcelId)) bad('Un colis ne peut figurer que dans un seul arrêt.');
        parcelIds.add(parcelId);
      }
      const stop: any = {
        id: s.id, sequence: index + 1, type: 'DELIVERY', status: 'En attente',
        address: text(s.address), city: text(s.city), postalCode: text(s.postalCode, 30),
        contactName: text(s.contactName), contactPhone: text(s.contactPhone, 80),
        packageIds: s.packageIds, packageCount: s.packageIds.length,
        serviceTime: nonnegative(s.serviceTime, Math.max(5, s.packageIds.length * 5)),
      };
      if (!stop.address || !stop.city || !stop.postalCode) bad('Adresse de livraison incomplète.');
      if (s.coordinates) {
        const { lat, lng } = s.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) bad('Coordonnées invalides.');
        stop.coordinates = { lat, lng };
      }
      for (const key of ['timeWindowStart', 'timeWindowEnd']) {
        if (s[key] !== undefined && s[key] !== '') {
          if (!time(s[key])) bad('Créneau de livraison invalide.');
          stop[key] = s[key];
        }
      }
      if (stop.timeWindowStart && stop.timeWindowEnd && stop.timeWindowStart >= stop.timeWindowEnd) bad('Créneau de livraison inversé.');
      for (const key of ['estimatedArrival', 'estimatedDeparture']) {
        if (s[key] !== undefined) {
          if (typeof s[key] !== 'string' || !Number.isFinite(Date.parse(s[key]))) bad('Horaire estimé invalide.');
          stop[key] = s[key];
        }
      }
      for (const key of ['distanceFromPrevious', 'durationFromPrevious', 'waitingTime', 'delayFromPrevious', 'breakFromPrevious'])
        if (s[key] !== undefined) stop[key] = nonnegative(s[key]);
      if (typeof s.floor === 'number' && Number.isFinite(s.floor)) stop.floor = s.floor;
      if (typeof s.hasElevator === 'boolean') stop.hasElevator = s.hasElevator;
      if (typeof s.notes === 'string') stop.notes = text(s.notes, 2000);
      return stop;
    });
    return {
      date: m.date, zone: m.zone, hubId: m.hubId, plannedDepartureTime: m.plannedDepartureTime,
      driverId: m.driverId, ...(m.vehicleId ? { vehicleId: m.vehicleId } : {}), stops,
      totalDistance: nonnegative(m.totalDistance), estimatedDuration: nonnegative(m.estimatedDuration),
    };
  });
  // 450 packages + 20 missions + 20 notifications + 1 receipt = 491 writes maximum.
  if (parcelIds.size > 450 || Buffer.byteLength(JSON.stringify(missions), 'utf8') > 800000)
    bad('Dispatch trop volumineux : 450 colis maximum. Répartissez les envois.');
  const fingerprint = createHash('sha256').update(stable(missions)).digest('hex');
  const receiptId = createHash('sha256').update(caller.id + ':' + data.requestId).digest('hex');
  const receiptRef = db.collection('dispatch_requests').doc(receiptId);
  return db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      const result = receipt.data()!;
      if (result.fingerprint !== fingerprint) bad('Ce dispatch a déjà été utilisé avec un autre contenu. Relancez l’optimisation.');
      return { missionIds: result.missionIds as string[], packageCount: result.packageCount as number, replayed: true };
    }
    const driverSnaps = await Promise.all([...drivers].map(driverId => tx.get(db.collection('users').doc(driverId))));
    const vehicleSnaps = await Promise.all([...vehicles].map(vehicleId => tx.get(db.collection('vehicles').doc(vehicleId))));
    const hubIds = [...new Set<string>(missions.map((m: any) => m.hubId))];
    const hubSnaps = await Promise.all(hubIds.map(hubId => tx.get(db.collection('hubs').doc(hubId))));
    const packageSnaps = await Promise.all([...parcelIds].map(parcelId => tx.get(db.collection('packages').doc(parcelId))));
    const absenceSnaps = await Promise.all([...drivers].map(driverId => tx.get(db.collection('absences').where('userId', '==', driverId))));
    const driverMap = new Map(driverSnaps.map(s => [s.id, s.data()]));
    const vehicleMap = new Map(vehicleSnaps.map(s => [s.id, s.data()]));
    const hubMap = new Map(hubSnaps.map(s => [s.id, s.data()]));
    const packageMap = new Map(packageSnaps.map(s => [s.id, s.data()]));
    const missionIds = missions.map((_m: any, index: number) => 'dispatch-' + receiptId + '-' + index);
    const now = new Date().toISOString();
    const callerName = `${caller.firstName || ''} ${caller.lastName || ''}`.trim();
    missions.forEach((m: any, index: number) => {
      const driver = driverMap.get(m.driverId), hub = hubMap.get(m.hubId), vehicle = m.vehicleId ? vehicleMap.get(m.vehicleId) : undefined;
      const role = String(driver?.role || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (!driver || !['chauffeur', 'chauffeuse'].includes(role) || driver.isDisabled || (driver.status && driver.status !== 'active'))
        unavailable('Chauffeur indisponible. Actualisez la liste avant de dispatcher.');
      if (absenceSnaps.some(result => result.docs.some(snap => {
        const absence = snap.data();
        return absence.userId === m.driverId && absence.status === 'Validé' && absence.startDate <= m.date && absence.endDate >= m.date;
      }))) unavailable('Le chauffeur est absent à la date de cette tournée.');
      if (!hub?.isActive) unavailable('Le hub de départ est indisponible.');
      if (m.vehicleId && (!vehicle || !['en service', 'actif', 'active', 'disponible', 'idle'].includes(String(vehicle.status || '').toLowerCase().trim()) ||
        ![vehicle.driverId, vehicle.assignedDriverId].includes(m.driverId) ||
        [vehicle.driverId, vehicle.assignedDriverId].some(assigned => assigned && assigned !== m.driverId)))
        unavailable('Le véhicule a changé d’affectation ou n’est plus disponible.');
      const driverName = `${driver!.firstName || ''} ${driver!.lastName || ''}`.trim();
      for (const stop of m.stops) {
        for (const parcelId of stop.packageIds) {
          const pkg = packageMap.get(parcelId);
          if (!pkg || !['Au hub', 'Trié'].includes(pkg.status) || pkg.missionId || pkg.stopId || pkg.currentDriverId)
            unavailable(`Le colis ${parcelId} n’est plus disponible. Aucun colis n’a été affecté ; actualisez et relancez l’optimisation.`);
          if (placeKey(pkg!) !== placeKey(stop)) unavailable(`L’adresse du colis ${parcelId} a changé. Relancez l’optimisation.`);
          tx.update(db.collection('packages').doc(parcelId), {
            status: 'Trié', missionId: missionIds[index], stopId: stop.id, currentDriverId: m.driverId,
            currentVehicleId: m.vehicleId || null,
            movements: [...(Array.isArray(pkg!.movements) ? pkg!.movements : []), {
              action: 'SORTED', timestamp: now, driverId: m.driverId, driverName,
              notes: `Dispatché mission ${m.zone} - ${driverName}`, recordedBy: caller.id,
            }], updatedAt: now,
          });
        }
      }
      const totalPackages = m.stops.reduce((sum: number, stop: any) => sum + stop.packageIds.length, 0);
      tx.create(db.collection('missions').doc(missionIds[index]), {
        ...m, id: missionIds[index], type: 'Livraison', status: 'Dispatché', hubName: hub!.name || '', driverName,
        ...(vehicle ? { vehiclePlate: vehicle.licensePlate || vehicle.plate || '' } : {}), totalPackages,
        completedStops: 0, failedStops: 0, deliveredPackages: 0, failedPackages: 0,
        createdBy: caller.id, createdByName: callerName, dispatchedBy: caller.id, dispatchedByName: callerName,
        dispatchedAt: now, createdAt: now, updatedAt: now,
      });
      tx.create(db.collection('notifications').doc('dispatch-' + missionIds[index]), {
        type: 'mission_assigned', priority: 'high', recipientId: m.driverId,
        title: 'Nouvelle tournée assignée', message: `Mission ${m.zone} : ${m.stops.length} arrêts${(vehicle?.licensePlate || vehicle?.plate) ? ' • Véhicule ' + (vehicle.licensePlate || vehicle.plate) : ''}`,
        actionType: 'navigate', actionTarget: 'driver_tour', actionLabel: 'Voir ma tournée',
        metadata: { missionId: missionIds[index], zone: m.zone, stopCount: m.stops.length, vehiclePlate: vehicle?.licensePlate || vehicle?.plate || '' },
        read: false, createdAt: now,
      });
    });
    tx.create(receiptRef, { fingerprint, missionIds, packageCount: parcelIds.size, createdBy: caller.id, createdAt: now });
    return { missionIds, packageCount: parcelIds.size, replayed: false };
  });
}
