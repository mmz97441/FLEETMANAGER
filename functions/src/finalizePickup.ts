import * as functions from 'firebase-functions/v1';
import type { Firestore } from 'firebase-admin/firestore';
import { validLogisticsProofMedia } from './logisticsProofMedia';

interface Dependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
}
const validId = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 200 && !v.includes('/');
const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 400 && v.every(validId) && new Set(v).size === v.length;
const same = (a: string[], b: string[]) => [...a].sort().join('\0') === [...b].sort().join('\0');
const refuse = (message: string): never => { throw new functions.https.HttpsError('failed-precondition', message); };

/** One immutable manifest is the idempotency key. Missing parcels are released
 * operationally only after their original pickup decision has been retained. */
export async function finalizePickupHandler(data: any, context: functions.https.CallableContext,
  { db, requireActiveCaller, isAdminCaller }: Dependencies) {
  const caller = await requireActiveCaller(context);
  if (!isAdminCaller(caller.role) && !['chauffeur', 'chauffeuse'].includes(String(caller.role || '').toLowerCase().trim()))
    throw new functions.https.HttpsError('permission-denied', 'Enlèvement réservé au chauffeur affecté.');
  if (!validId(data?.missionId) || !validId(data?.stopId) || !validId(data?.driverId) ||
    !list(data.expectedPackageIds) || !list(data.scannedPackageIds) || !list(data.missingPackageIds) ||
    !data.expectedPackageIds.length || !same(data.expectedPackageIds, [...data.scannedPackageIds, ...data.missingPackageIds]) ||
    data.scannedPackageIds.some((id: string) => data.missingPackageIds.includes(id)))
    throw new functions.https.HttpsError('invalid-argument', 'Chaque colis prévu doit être scanné ou déclaré manquant, une seule fois.');
  if (caller.id !== data.driverId && !isAdminCaller(caller.role))
    throw new functions.https.HttpsError('permission-denied', 'Reconnectez le compte qui a enregistré cet enlèvement.');
  const recordedAt = String(data.recordedAt || new Date().toISOString());
  if (!Number.isFinite(Date.parse(recordedAt)) || Date.parse(recordedAt) > Date.now() + 300000)
    throw new functions.https.HttpsError('invalid-argument', 'Heure de l’enlèvement invalide.');
  if (data.clientSignatureUrl && !validLogisticsProofMedia(data.clientSignatureUrl, `pickups/${data.missionId}/${data.stopId}/`))
    throw new functions.https.HttpsError('invalid-argument', 'Signature invalide.');
  return db.runTransaction(async tx => {
    const manifestRef = db.collection('pickups').doc(`${data.missionId}_${data.stopId}`);
    const saved = await tx.get(manifestRef);
    if (saved.exists) {
      const original = saved.data()!;
      if (original.driverId !== data.driverId || !same(original.expectedPackageIds || [], data.expectedPackageIds) ||
        !same(original.scannedPackageIds || [], data.scannedPackageIds) || !same(original.missingPackageIds || [], data.missingPackageIds))
        refuse('Un autre résultat d’enlèvement est déjà enregistré pour cet arrêt.');
      return original;
    }
    const missionRef = db.collection('missions').doc(data.missionId);
    const missionSnap = await tx.get(missionRef);
    const mission = missionSnap.data();
    const stop = mission?.stops?.find((s: any) => s.id === data.stopId);
    if (!mission || mission.driverId !== data.driverId || ['Terminé', 'Annulé'].includes(mission.status) ||
      !stop || stop.type !== 'PICKUP' || ['Terminé', 'Échec', 'Passé'].includes(stop.status))
      refuse('Cet enlèvement n’est plus disponible pour ce chauffeur. Les données locales sont conservées.');
    if (stop.proofSyncPending || !same(stop.packageIds || [], data.expectedPackageIds))
      refuse('Le manifeste prévu a changé. Faites vérifier cet enlèvement par le bureau.');
    const packages = await Promise.all(data.expectedPackageIds.map((id: string) => tx.get(db.collection('packages').doc(id))));
    for (const snap of packages) {
      const pkg = snap.data();
      if (!pkg || pkg.missionId !== data.missionId || pkg.stopId !== data.stopId ||
        (pkg.currentDriverId && pkg.currentDriverId !== data.driverId) || !['En attente', 'Collecté', 'Chargé', 'En livraison'].includes(pkg.status))
        refuse('Un colis a été transféré ou clôturé. Aucun résultat de cet enlèvement n’a été modifié.');
    }
    const receivedAt = new Date().toISOString();
    const driverName = `${caller.firstName || ''} ${caller.lastName || ''}`.trim() || data.driverName || '';
    const manifest = {
      id: manifestRef.id, missionId: data.missionId, stopId: data.stopId,
      driverId: data.driverId, driverName, clientId: mission!.clientId || data.clientId || '', clientName: stop.contactName || '',
      vehicleId: mission!.vehicleId || '', vehiclePlate: mission!.vehiclePlate || '',
      address: `${stop.address || ''}, ${stop.postalCode || ''} ${stop.city || ''}`,
      coordinates: data.coordinates && Number.isFinite(data.coordinates.lat) && Number.isFinite(data.coordinates.lng) ? data.coordinates : null,
      timestamp: recordedAt, receivedAt, createdAt: receivedAt,
      expectedPackageIds: data.expectedPackageIds, scannedPackageIds: data.scannedPackageIds,
      missingPackageIds: data.missingPackageIds,
      unknownBarcodes: Array.isArray(data.unknownBarcodes) ? data.unknownBarcodes.filter((v: any) => typeof v === 'string').slice(0, 400) : [],
      ...(data.clientSignatureUrl ? { clientSignatureUrl: data.clientSignatureUrl } : {}),
      expectedCount: data.expectedPackageIds.length, scannedCount: data.scannedPackageIds.length, missingCount: data.missingPackageIds.length,
    };
    for (const snap of packages) {
      const pkg = snap.data()!;
      const missing = data.missingPackageIds.includes(snap.id);
      tx.update(snap.ref, {
        status: missing ? 'En attente' : 'Collecté',
        currentDriverId: missing ? null : data.driverId,
        currentVehicleId: missing ? null : mission!.vehicleId || null,
        ...(missing ? { missionId: null, stopId: null, missionDate: null, estimatedDeliveryAt: null, liveDriver: null, remainingBeforeMine: null,
          pickupMissing: { missionId: data.missionId, stopId: data.stopId, driverId: data.driverId, recordedAt } } : { pickupMissing: null, currentHubId: null }),
        movements: [...(pkg.movements || []), { timestamp: recordedAt, receivedAt,
          action: missing ? 'PICKUP_MISSING' : 'COLLECTED', driverId: data.driverId, driverName,
          missionId: data.missionId, stopId: data.stopId,
          notes: missing ? 'Absent lors de l’enlèvement — nouvelle collecte à planifier' : `Enlevé chez ${manifest.clientName}` }],
        updatedAt: receivedAt,
      });
    }
    // Keep expected IDs on the historical stop: the manifest explains missing IDs.
    // Hub reception later removes physically collected IDs only.
    const stops = mission!.stops.map((s: any) => s.id === data.stopId ? { ...s, status: 'Terminé', completionTime: recordedAt,
      ...(manifest.coordinates ? { arrivalCoordinates: manifest.coordinates } : {}) } : s);
    tx.update(missionRef, { stops, completedStops: stops.filter((s: any) => s.status === 'Terminé').length,
      collectedPackages: Number(mission!.collectedPackages || 0) + data.scannedPackageIds.length, updatedAt: receivedAt });
    tx.create(manifestRef, manifest);
    return manifest;
  });
}

/** A missed collection is replanned at the sender's historical pickup address,
 * never at the parcel's delivery address. No physical collection is implied. */
export async function replanPickupHandler(data: any, context: functions.https.CallableContext,
  { db, requireActiveCaller, isAdminCaller }: Dependencies) {
  const caller = await requireActiveCaller(context);
  if (!isAdminCaller(caller.role)) throw new functions.https.HttpsError('permission-denied', 'La nouvelle collecte doit être planifiée par le bureau.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!validId(data?.requestId) || !validId(data?.driverId) || !validId(data?.hubId) || !list(data?.packageIds) || !data.packageIds.length ||
    typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || data.date < today ||
    !Number.isFinite(Date.parse(`${data.date}T00:00:00Z`)) || new Date(`${data.date}T00:00:00Z`).toISOString().slice(0, 10) !== data.date)
    throw new functions.https.HttpsError('invalid-argument', 'Choisissez un chauffeur, un dépôt et une date de collecte à venir.');
  const missionId = `recollect-${data.requestId}`;
  return db.runTransaction(async tx => {
    const ref = db.collection('missions').doc(missionId), existing = await tx.get(ref);
    const intent = { packageIds: [...data.packageIds].sort(), driverId: data.driverId, hubId: data.hubId, date: data.date };
    if (existing.exists) {
      if (JSON.stringify(existing.data()?.recollectionIntent) !== JSON.stringify(intent)) refuse('Cette demande correspond à une autre collecte.');
      return { missionId, replayed: true };
    }
    const driver = await tx.get(db.collection('users').doc(data.driverId)), hub = await tx.get(db.collection('hubs').doc(data.hubId));
    const absences = await tx.get(db.collection('absences').where('userId', '==', data.driverId));
    if (!driver.exists || driver.data()?.isDisabled || (driver.data()?.status && driver.data()?.status !== 'active') ||
      !['chauffeur', 'chauffeuse'].includes(String(driver.data()?.role || '').trim().toLowerCase()) ||
      absences.docs.some(s => s.data().status === 'Validé' && s.data().startDate <= data.date && s.data().endDate >= data.date)) refuse('Ce chauffeur est indisponible à la date choisie.');
    if (!hub.exists || !hub.data()?.isActive) refuse('Le dépôt choisi est indisponible.');
    const packages = await Promise.all(data.packageIds.map((id: string) => tx.get(db.collection('packages').doc(id))));
    const first = packages[0].data()?.pickupMissing;
    if (!first || !validId(first.missionId) || !validId(first.stopId)) refuse('La collecte initiale de ce colis doit être vérifiée.');
    for (const snap of packages) {
      const pkg = snap.data();
      if (!pkg || pkg.status !== 'En attente' || pkg.missionId || pkg.stopId || pkg.currentDriverId ||
        pkg.pickupMissing?.missionId !== first.missionId || pkg.pickupMissing?.stopId !== first.stopId)
        refuse('Ces colis ne sont plus disponibles ou proviennent de collectes différentes.');
    }
    const source = await tx.get(db.collection('missions').doc(first.missionId));
    const original = source.data()?.stops?.find((s: any) => s.id === first.stopId);
    const manifest = await tx.get(db.collection('pickups').doc(`${first.missionId}_${first.stopId}`));
    if (!original || original.type !== 'PICKUP' || !original.address || !original.city || !original.postalCode ||
      !data.packageIds.every((id: string) => manifest.data()?.missingPackageIds?.includes(id)))
      refuse('Le lieu de collecte ou son manifeste initial est incomplet. Faites-le vérifier par le bureau.');
    const stop = { id: 'pickup', sequence: 1, type: 'PICKUP', status: 'En attente',
      contactName: original.contactName || manifest.data()?.clientName || '', contactPhone: original.contactPhone || '',
      address: original.address, postalCode: original.postalCode, city: original.city,
      packageIds: data.packageIds, packageCount: data.packageIds.length, serviceTime: original.serviceTime || 5,
      ...(original.coordinates ? { coordinates: original.coordinates } : {}) };
    const now = new Date().toISOString();
    tx.create(ref, { id: missionId, type: 'Collecte', status: 'Dispatché', date: data.date,
      driverId: driver.id, driverName: `${driver.data()?.firstName || ''} ${driver.data()?.lastName || ''}`.trim(),
      hubId: hub.id, hubName: hub.data()?.name || '', zone: hub.data()?.zone || '',
      clientId: manifest.data()?.clientId || '', stops: [stop], totalPackages: data.packageIds.length,
      deliveredPackages: 0, collectedPackages: 0, failedPackages: 0, completedStops: 0,
      recollectionIntent: intent, createdBy: caller.id, createdAt: now, updatedAt: now });
    for (const snap of packages) tx.update(snap.ref, { missionId, missionDate: data.date, stopId: stop.id,
      currentDriverId: driver.id, currentVehicleId: null, updatedAt: now,
      movements: [...(snap.data()!.movements || []), { action: 'PICKUP_REPLANNED', timestamp: now, recordedBy: caller.id,
        missionId, fromMissionId: first.missionId, notes: `Nouvelle collecte prévue le ${data.date}` }] });
    return { missionId, replayed: false };
  });
}
