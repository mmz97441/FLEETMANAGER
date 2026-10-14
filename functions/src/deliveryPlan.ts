import { randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { sameDeliveryRecipient, intersectDeliveryWindows } from './deliveryAddress';

interface Dependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
}
const fail = (message: string): never => { throw new functions.https.HttpsError('failed-precondition', message); };
const id = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 200 && !value.includes('/');
const editable = (mission: any) => {
  if (!['Brouillon', 'Optimisé', 'Dispatché'].includes(mission?.status)) fail('La tournée a démarré ou est clôturée. La correction doit être décidée avec le chauffeur avant une nouvelle affectation.');
};
const pending = (stop: any) => {
  if (!stop || stop.type !== 'DELIVERY' || stop.status !== 'En attente' || stop.proofSyncPending) fail('Cet arrêt a déjà commencé ou a été déplacé. Sa décision et ses preuves doivent être conservées.');
};
const allowed = ['contactName', 'contactPhone', 'contactEmail', 'address', 'city', 'postalCode', 'timeWindowStart', 'timeWindowEnd', 'serviceTime', 'floor', 'hasElevator', 'requestedDeliveryDate', 'weight', 'volume', 'comment', 'notes'];
const planningFields = ['contactName', 'contactPhone', 'address', 'city', 'postalCode', 'timeWindowStart', 'timeWindowEnd', 'serviceTime', 'floor', 'hasElevator', 'requestedDeliveryDate'];
function patchFields(fields: any): Record<string, any> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(key => !allowed.includes(key)))
    throw new functions.https.HttpsError('invalid-argument', 'Champs de correction invalides. Les références et statuts utilisent leurs parcours dédiés.');
  const patch: any = {};
  for (const [key, value] of Object.entries(fields)) {
    if (['weight', 'volume', 'serviceTime', 'floor'].includes(key)) {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'serviceTime' && (value < 1 || value > 480))))
        throw new functions.https.HttpsError('invalid-argument', 'Durée, poids, volume ou étage invalide.');
      patch[key] = value;
    } else if (key === 'hasElevator') {
      if (typeof value !== 'boolean') throw new functions.https.HttpsError('invalid-argument', 'Ascenseur invalide.');
      patch[key] = value;
    } else {
      if (value !== null && (typeof value !== 'string' || value.length > 2000)) throw new functions.https.HttpsError('invalid-argument', 'Texte de correction invalide.');
      patch[key] = typeof value === 'string' ? value.trim() || null : null;
    }
  }
  return patch;
}
function validatePoint(point: any) {
  if (!point.contactName || !point.address || !point.city || !/^\d{5}$/.test(point.postalCode || ''))
    throw new functions.https.HttpsError('invalid-argument', 'Renseignez le destinataire, l’adresse, la ville et un code postal de 5 chiffres.');
  const start = point.timeWindowStart, end = point.timeWindowEnd, time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ((start && !time.test(start)) || (end && !time.test(end)) || (start && end && start >= end))
    throw new functions.https.HttpsError('invalid-argument', 'Vérifiez le format et l’ordre des bornes du créneau.');
  if (point.requestedDeliveryDate) {
    const date = new Date(point.requestedDeliveryDate + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.requestedDeliveryDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== point.requestedDeliveryDate)
      throw new functions.https.HttpsError('invalid-argument', 'Date souhaitée invalide.');
  }
}
function resetEstimate(stop: any) {
  const { estimatedArrival, estimatedDeparture, distanceFromPrevious, durationFromPrevious, waitingTime, delayFromPrevious, breakFromPrevious, ...rest } = stop;
  return rest;
}
function pointFields(pkg: any) {
  const point: any = {};
  for (const key of planningFields.filter(key => key !== 'requestedDeliveryDate')) if (pkg[key] !== undefined) point[key] = pkg[key];
  return point;
}
/** One transaction owns both views of a delivery destination. A parcel-level
 * change can split a pending group, but can never redirect its neighbours. */
export async function correctDeliveryPlanHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const { db, requireActiveCaller, isAdminCaller } = deps;
  const caller = await requireActiveCaller(context);
  if (!isAdminCaller(caller.role)) throw new functions.https.HttpsError('permission-denied', 'Correction réservée au bureau.');
  const wholeStop = data?.mode === 'STOP';
  if (wholeStop ? !id(data.missionId) || !id(data.stopId) : !id(data?.packageId)) throw new functions.https.HttpsError('invalid-argument', 'Colis ou arrêt invalide.');
  const patch = patchFields(data.fields);
  if (!Object.keys(patch).length) return { updated: 0 };
  const changesPlan = Object.keys(patch).some(key => planningFields.includes(key));
  return db.runTransaction(async tx => {
    const initialRef = wholeStop ? db.collection('missions').doc(data.missionId) : db.collection('packages').doc(data.packageId);
    const initial = await tx.get(initialRef);
    if (!initial.exists) fail('Colis ou tournée introuvable.');
    const pkg = wholeStop ? null : initial.data()!;
    if (pkg && ['Livré', 'Retourné', 'Échec', 'À retourner'].includes(pkg.status)) fail('Ce colis possède une décision de livraison. Utilisez la reprise ou le retour ; son adresse historique est conservée.');
    const missionId = wholeStop ? data.missionId : pkg!.missionId;
    const missionRef = missionId ? db.collection('missions').doc(missionId) : null;
    const missionSnap = missionRef ? (wholeStop ? initial : await tx.get(missionRef)) : null;
    const mission = missionSnap?.data();
    if (missionId && !mission) fail('L’affectation du colis doit être vérifiée par le bureau.');
    if (mission) editable(mission);
    const stop = mission?.stops?.find((s: any) => s.id === (wholeStop ? data.stopId : pkg!.stopId));
    if (mission) pending(stop);
    if (stop && !wholeStop && !stop.packageIds?.includes(data.packageId)) fail('L’arrêt ne contient plus ce colis. Actualisez la tournée.');
    const targetIds: string[] = wholeStop ? stop.packageIds || [] : [data.packageId];
    const ids: string[] = mission ? [...new Set<string>(mission.stops.filter((s: any) => s.status === 'En attente').flatMap((s: any) => s.packageIds || []))] : targetIds;
    if (!targetIds.length || ids.length > 440) fail('Cette tournée nécessite une correction par le bureau en plusieurs étapes.');
    const snapshots = await Promise.all(ids.map(parcelId => tx.get(db.collection('packages').doc(parcelId))));
    const byId = new Map(snapshots.map(s => [s.id, s.data()]));
    if (snapshots.some(s => !s.exists || (missionId && s.data()!.missionId !== missionId))) fail('Une affectation a changé. Aucune correction effectuée.');
    for (const parcelId of targetIds) {
      const before = byId.get(parcelId)!;
      if (!before || (mission && (before.stopId !== stop.id || before.currentDriverId !== mission.driverId)) || ['Livré', 'Retourné', 'Échec', 'À retourner'].includes(before.status)) fail('Un colis de cet arrêt a déjà été traité ou déplacé.');
      validatePoint({ ...before, ...patch });
      if (patch.requestedDeliveryDate && mission && patch.requestedDeliveryDate !== mission.date) fail('La nouvelle date diffère de la tournée. Retirez d’abord le colis de cette affectation puis replanifiez-le.');
    }
    if (wholeStop) {
      const originals = targetIds.map(parcelId => byId.get(parcelId)!);
      if (!originals.every(p => sameDeliveryRecipient(originals[0], p))) fail('Cet arrêt regroupe plusieurs destinataires. Corrigez chaque colis individuellement pour éviter de réadresser les autres.');
      const targets = targetIds.map(parcelId => ({ ...byId.get(parcelId), ...patch }));
      if (!targets.every(p => sameDeliveryRecipient(targets[0], p)) || !intersectDeliveryWindows(targets)) fail('Les colis de cet arrêt ne partagent pas le même destinataire et un créneau compatible. Corrigez les colis séparément.');
    }
    const now = new Date().toISOString(), moved = ['address', 'city', 'postalCode'].some(key => Object.prototype.hasOwnProperty.call(patch, key));
    let stops: any[] = mission ? mission.stops.map((s: any) => changesPlan && s.status === 'En attente' ? resetEstimate(s) : { ...s }) : [];
    let targetStopId = stop?.id;
    if (stop && changesPlan) {
      const index = stops.findIndex(s => s.id === stop.id);
      const nextParcel = { ...byId.get(targetIds[0]), ...patch };
      if (wholeStop || stop.packageIds.length === 1) {
        stops[index] = { ...stops[index], ...pointFields(nextParcel), ...(patch.notes !== undefined ? { notes: patch.notes } : {}) };
        if (wholeStop) {
          const targets = targetIds.map(parcelId => ({ ...byId.get(parcelId), ...patch }));
          const window = intersectDeliveryWindows(targets)!;
          delete stops[index].timeWindowStart; delete stops[index].timeWindowEnd;
          Object.assign(stops[index], window);
          stops[index].serviceTime = patch.serviceTime ?? targets.reduce((sum, p) => sum + (p.serviceTime || 5), 0);
        } else stops[index].serviceTime = nextParcel.serviceTime || 5;
        if (moved) delete stops[index].coordinates;
      } else {
        const neighbours = stop.packageIds.filter((parcelId: string) => parcelId !== data.packageId).map((parcelId: string) => byId.get(parcelId)!);
        const window = intersectDeliveryWindows([nextParcel, ...neighbours]);
        if (neighbours.every((p: any) => sameDeliveryRecipient(p, nextParcel)) && window) {
          const { timeWindowStart, timeWindowEnd, ...base } = stops[index];
          stops[index] = { ...base, ...window, serviceTime: [nextParcel, ...neighbours].reduce((sum: number, p: any) => sum + (p.serviceTime || 5), 0) };
          if (patch.contactPhone !== undefined) stops[index].contactPhone = patch.contactPhone;
        } else {
          const remaining = stop.packageIds.filter((parcelId: string) => parcelId !== data.packageId);
          stops[index] = { ...stops[index], packageIds: remaining, packageCount: remaining.length, serviceTime: neighbours.reduce((sum: number, p: any) => sum + (p.serviceTime || 5), 0) };
          targetStopId = 'corrected-' + randomUUID();
          stops.splice(index + 1, 0, { ...pointFields(nextParcel), id: targetStopId, type: 'DELIVERY', status: 'En attente', packageIds: [data.packageId], packageCount: 1, serviceTime: nextParcel.serviceTime || 5, ...(moved ? {} : nextParcel.coordinates ? { coordinates: nextParcel.coordinates } : {}) });
        }
      }
      stops = stops.map((s, index) => ({ ...s, sequence: index + 1 }));
    }
    const targets = new Set(targetIds);
    for (const snapshot of snapshots) {
      if (!targets.has(snapshot.id)) {
        if (changesPlan) tx.update(snapshot.ref, { estimatedDeliveryAt: null, updatedAt: now });
        continue;
      }
      const before = snapshot.data()!;
      const parcelPatch = { ...patch };
      // Stop duration describes the whole visit; keep equal shares on cartons
      // so a later optimisation reconstructs the same total.
      if (wholeStop && typeof parcelPatch.serviceTime === 'number') parcelPatch.serviceTime /= targetIds.length;
      tx.update(snapshot.ref, { ...parcelPatch, ...(moved ? { coordinates: null } : {}), ...(changesPlan ? { estimatedDeliveryAt: null } : {}), ...(targetStopId ? { stopId: targetStopId } : {}),
        movements: [...(before.movements || []), { action: 'ADDRESS_CORRECTED', timestamp: now, recordedBy: caller.id, notes: 'Correction avant livraison', changes: Object.fromEntries(Object.keys(patch).map(key => [key, { before: before[key] ?? null, after: parcelPatch[key] }])) }], updatedAt: now });
    }
    if (missionRef && mission) {
      tx.update(missionRef, { stops, ...(changesPlan ? { totalDistance: null, estimatedDuration: null } : {}), updatedAt: now });
      if (mission.driverId) tx.create(db.collection('notifications').doc(), { type: 'mission_updated', priority: 'high', recipientId: mission.driverId, title: 'Livraison corrigée', message: `L’adresse ou les informations de ${stop.contactName || 'votre arrêt'} ont été corrigées. Vérifiez la tournée avant le départ.`, actionType: 'navigate', actionTarget: 'driver_tour', metadata: { missionId }, read: false, createdAt: now });
    }
    return { updated: targetIds.length, stopId: targetStopId || null };
  });
}

/** Administrative sorting cannot stand in for a physical scan or a delivery. */
export async function setParcelSortingHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context);
  if (!deps.isAdminCaller(caller.role)) throw new functions.https.HttpsError('permission-denied', 'Tri réservé au bureau.');
  if (!id(data?.packageId) || !['Au hub', 'Trié'].includes(data.status)) fail('Utilisez la réception, le chargement, la livraison ou la reprise pour changer cette étape.');
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.collection('packages').doc(data.packageId), snap = await tx.get(ref), pkg = snap.data();
    if (!pkg || !['Au hub', 'Trié'].includes(pkg.status) || pkg.missionId || pkg.stopId || pkg.currentDriverId || !pkg.currentHubId || pkg.returnDisposition === 'AWAITING_DECISION') fail('Seul un colis réceptionné au hub et non affecté peut être trié ou détrié. Utilisez le parcours de reprise pour les autres colis.');
    const hub = await tx.get(deps.db.collection('hubs').doc(pkg!.currentHubId));
    if (!hub.data()?.isActive) fail('Le hub physique est indisponible.');
    if (pkg!.status === data.status) return { replayed: true };
    const now = new Date().toISOString();
    tx.update(ref, { status: data.status, updatedAt: now, movements: [...(pkg!.movements || []), { action: 'MANUAL_STATUS_CHANGE', timestamp: now, recordedBy: caller.id, notes: `Tri au hub : ${pkg!.status} → ${data.status}` }] });
    return { replayed: false };
  });
}
