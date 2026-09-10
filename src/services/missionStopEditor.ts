import { doc, runTransaction, type Transaction } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { Mission, MissionStatus, MissionStop, Package, PackageStatus, StopStatus } from '../types';
import { cleanUndefined } from '../utils/firestore';

export type StopEditorPatch = Pick<MissionStop, 'contactName' | 'address' | 'city' | 'postalCode' | 'serviceTime'> & { contactPhone?: string | null; timeWindowStart?: string | null; timeWindowEnd?: string | null; notes?: string | null };
const editableStatuses = [MissionStatus.DRAFT, MissionStatus.OPTIMIZED, MissionStatus.DISPATCHED];
function editable(mission: Mission) {
  if (!editableStatuses.includes(mission.status)) throw new Error('La tournée a déjà démarré ou a été clôturée. Actualisez son suivi avant de modifier ses arrêts.');
}
function stopAt(mission: Mission, stopId: string) {
  const stop = mission.stops.find(s => s.id === stopId);
  if (!stop) throw new Error('Cet arrêt a été retiré de la tournée. Actualisez la liste.');
  if (stop.status !== StopStatus.PENDING || stop.proofSyncPending) throw new Error('Cet arrêt est déjà en cours de traitement. Sa livraison doit être conservée.');
  return stop;
}
function validPatch(patch: StopEditorPatch) {
  const text = (key: 'contactName' | 'address' | 'city' | 'postalCode') => String(patch[key] ?? '').trim();
  if (!text('contactName') || !text('address') || !text('city')) throw new Error('Renseignez le destinataire, l’adresse et la ville.');
  if (!/^\d{5}$/.test(text('postalCode'))) throw new Error('Le code postal doit contenir 5 chiffres.');
  const duration = Number(patch.serviceTime);
  if (!Number.isInteger(duration) || duration < 1 || duration > 480) throw new Error('La durée sur place doit être comprise entre 1 et 480 minutes.');
  const start = String(patch.timeWindowStart ?? '').trim();
  const end = String(patch.timeWindowEnd ?? '').trim();
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!!start !== !!end || (start && !time.test(start)) || (end && !time.test(end)) || (start && end && start >= end)) throw new Error('Renseignez un créneau complet, dont la fin suit le début.');
  return { contactName: text('contactName'), address: text('address'), city: text('city'), postalCode: text('postalCode'), serviceTime: duration,
    contactPhone: String(patch.contactPhone ?? '').trim() || null, notes: String(patch.notes ?? '').trim() || null,
    timeWindowStart: start || null, timeWindowEnd: end || null };
}

function withoutEstimate(stop: MissionStop): MissionStop {
  const { estimatedArrival, estimatedDeparture, distanceFromPrevious, durationFromPrevious, ...rest } = stop;
  return rest;
}

// A changed route invalidates downstream ETAs, including the client projection.
// Complete all reads before the caller writes any document.
async function planningParcels(tx: Transaction, missionId: string, mission: Mission) {
  const ids = [...new Set(mission.stops.filter(s => s.status === StopStatus.PENDING).flatMap(s => s.packageIds || []))];
  if (ids.length > 450) throw new Error('Cette tournée contient trop de colis pour une modification unique. Demandez une nouvelle planification au bureau.');
  const refs = ids.map(id => doc(db, 'packages', id));
  const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
  if (snapshots.some(s => !s.exists() || s.data().missionId !== missionId)) throw new Error('L’affectation d’un colis a changé. Actualisez la tournée avant de modifier son parcours.');
  return refs.map((ref, index) => ({ id: ids[index], ref }));
}

export async function editMissionStop(missionId: string, stopId: string, patch: StopEditorPatch): Promise<void> {
  const validated = validPatch(patch);
  const ref = doc(db, 'missions', missionId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable.');
    const mission = snap.data() as Mission;
    editable(mission);
    const original = stopAt(mission, stopId);
    const moved = original.address !== validated.address || original.city !== validated.city || original.postalCode !== validated.postalCode;
    const changedPlan = moved || original.serviceTime !== validated.serviceTime || (original.timeWindowStart || null) !== validated.timeWindowStart || (original.timeWindowEnd || null) !== validated.timeWindowEnd;
    const parcels = changedPlan ? await planningParcels(tx, missionId, mission) : [];
    const now = new Date().toISOString();
    const stops = mission.stops.map(s => {
      const next = changedPlan && s.status === StopStatus.PENDING ? withoutEstimate(s) : { ...s };
      if (s.id !== stopId) return next;
      if (moved) delete next.coordinates;
      return { ...next, ...validated };
    });
    parcels.forEach(parcel => tx.update(parcel.ref, { estimatedDeliveryAt: null, updatedAt: now }));
    tx.update(ref, cleanUndefined({ stops, ...(changedPlan ? { totalDistance: null, estimatedDuration: null } : {}), updatedAt: now }));
  });
}

export async function reorderStops(missionId: string, orderedStopIds: string[]): Promise<void> {
  const ref = doc(db, 'missions', missionId);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable.');
    const mission = snap.data() as Mission;
    editable(mission);
    const byId = new Map(mission.stops.map(stop => [stop.id, stop]));
    if (new Set(orderedStopIds).size !== orderedStopIds.length || orderedStopIds.length !== byId.size || orderedStopIds.some(id => !byId.has(id))) throw new Error('Les arrêts ont changé pendant la préparation. Actualisez la tournée avant de les réordonner.');
    const parcels = await planningParcels(tx, missionId, mission);
    const now = new Date().toISOString();
    parcels.forEach(parcel => tx.update(parcel.ref, { estimatedDeliveryAt: null, updatedAt: now }));
    tx.update(ref, cleanUndefined({ stops: orderedStopIds.map((id, index) => {
      const stop = byId.get(id)!;
      return { ...(stop.status === StopStatus.PENDING ? withoutEstimate(stop) : stop), sequence: index + 1 };
    }), totalDistance: null, estimatedDuration: null, updatedAt: now }));
  });
}

export async function deleteMissionStop(missionId: string, stopId: string, actor: { id: string; firstName: string; lastName: string }): Promise<{ returnedPackages: number }> {
  const ref = doc(db, 'missions', missionId);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable.');
    const mission = snap.data() as Mission;
    editable(mission);
    const stop = stopAt(mission, stopId);
    const ids = [...new Set(stop.packageIds ?? [])];
    if (ids.length > 450) throw new Error('Cet arrêt contient trop de colis pour une suppression unique. Contactez le responsable.');
    const parcelRefs = ids.map(id => doc(db, 'packages', id));
    const parcels = await Promise.all(parcelRefs.map(parcelRef => tx.get(parcelRef)));
    const now = new Date().toISOString();
    const reason = `Arrêt retiré de la tournée ${mission.zone} — Retourner au hub ${mission.hubName}`;
    const returnable = [PackageStatus.AT_HUB, PackageStatus.SORTED, PackageStatus.LOADED, PackageStatus.IN_DELIVERY, PackageStatus.RETURN_REQUESTED];
    // All reads/validation precede every write: an invalid parcel aborts everything.
    parcels.forEach(snapshot => {
      if (!snapshot.exists()) throw new Error('Un colis de cet arrêt est introuvable. Aucun arrêt ni colis n’a été modifié.');
      const parcel = snapshot.data() as Package;
      if (parcel.missionId !== missionId || (parcel.stopId && parcel.stopId !== stopId) || (parcel.currentDriverId && parcel.currentDriverId !== mission.driverId) || !returnable.includes(parcel.status)) throw new Error('Un colis a été transféré ou traité entre-temps. Actualisez la tournée ; aucune suppression n’a été effectuée.');
    });
    const affectedParcels = await planningParcels(tx, missionId, mission);
    affectedParcels.filter(parcel => !ids.includes(parcel.id)).forEach(parcel => tx.update(parcel.ref, { estimatedDeliveryAt: null, updatedAt: now }));
    parcels.forEach((snapshot, index) => {
      const parcel = snapshot.data() as Package;
      if (parcel.status === PackageStatus.RETURN_REQUESTED) {
        tx.update(parcelRefs[index], { estimatedDeliveryAt: null, updatedAt: now });
        return;
      }
      tx.update(parcelRefs[index], cleanUndefined({ status: PackageStatus.RETURN_REQUESTED, returnReason: reason, estimatedDeliveryAt: null, updatedAt: now,
        movements: [...(parcel.movements ?? []), { action: 'STOP_DELETED', timestamp: now, driverId: actor.id, driverName: `${actor.firstName} ${actor.lastName}`.trim(), notes: reason }] }));
    });
    const stops = [...mission.stops].sort((a, b) => a.sequence - b.sequence).filter(s => s.id !== stopId).map((s, index) => ({ ...(s.status === StopStatus.PENDING ? withoutEstimate(s) : s), sequence: index + 1 }));
    tx.update(ref, cleanUndefined({ stops, totalDistance: null, estimatedDuration: null, totalPackages: stops.reduce((sum, s) => sum + (s.packageCount || 0), 0), updatedAt: now }));
    return { returnedPackages: ids.length };
  });
}
