import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';

interface ReceptionDependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
}
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/');
const refuse = (message: string): never => { throw new functions.https.HttpsError('failed-precondition', message); };

/** Reception atomically releases a completed pickup's operational assignment.
 * The immutable pickup manifest and historical mission counters remain intact. */
export async function receivePackagesAtHubHandler(data: any, context: functions.https.CallableContext,
  { db, requireActiveCaller, isAdminCaller }: ReceptionDependencies) {
  const caller = await requireActiveCaller(context);
  const manager = isAdminCaller(caller.role);
  const driver = ['chauffeur', 'chauffeuse'].includes(String(caller.role || '').toLowerCase().trim());
  if (!manager && !driver) throw new functions.https.HttpsError('permission-denied', 'Réception réservée à l’exploitation et aux chauffeurs affectés.');
  if (!validId(data?.hubId) || !Array.isArray(data?.packageIds) || !data.packageIds.length || data.packageIds.length > 150 || data.packageIds.some((id: unknown) => !validId(id)))
    throw new functions.https.HttpsError('invalid-argument', 'Sélectionnez un hub et 1 à 150 colis.');
  const ids = [...new Set<string>(data.packageIds)];
  return db.runTransaction(async tx => {
    const hubSnap = await tx.get(db.collection('hubs').doc(data.hubId));
    if (!hubSnap.exists || !hubSnap.data()?.isActive) refuse('Le hub sélectionné est indisponible.');
    const packageSnaps = await Promise.all(ids.map(id => tx.get(db.collection('packages').doc(id))));
    if (packageSnaps.some(snap => !snap.exists)) refuse('Un colis est introuvable. Aucun colis de ce lot n’a été réceptionné.');
    const missionIds = [...new Set<string>(packageSnaps.map(snap => snap.data()?.missionId).filter(Boolean))];
    if (missionIds.some(id => !validId(id))) refuse('Une affectation de colis est invalide. Faites-la vérifier par le bureau.');
    const missionSnaps = await Promise.all(missionIds.map(id => tx.get(db.collection('missions').doc(id))));
    const missions = new Map(missionSnaps.map(snap => [snap.id, snap]));
    const pickupKeys = new Set<string>();
    for (const snap of packageSnaps) {
      const pkg = snap.data()!;
      if (!['En attente', 'Collecté', 'Au hub'].includes(pkg.status)) refuse(`Le colis ${snap.id} ne peut pas être réceptionné depuis le statut ${pkg.status}.`);
      const alreadyReceived = pkg.status === 'Au hub' && pkg.currentHubId === data.hubId && !pkg.missionId && !pkg.stopId && !pkg.currentDriverId && !pkg.currentVehicleId;
      if (!manager && pkg.currentDriverId !== caller.id && !(alreadyReceived && pkg.hubReceivedBy === caller.id))
        throw new functions.https.HttpsError('permission-denied', 'Un colis de ce lot ne vous est pas affecté.');
      if (pkg.missionId) {
        const mission = missions.get(pkg.missionId)?.data();
        const stop = mission?.stops?.find((s: any) => s.id === pkg.stopId && s.packageIds?.includes(snap.id));
        if (!mission || !stop || stop.type !== 'PICKUP' || stop.status !== 'Terminé')
          refuse('Terminez l’enlèvement et synchronisez son manifeste avant de réceptionner ses colis au hub.');
        if (stop.proofSyncPending === true) refuse('Synchronisez la preuve de cet arrêt avant de déplacer ce colis.');
        if (!manager && mission!.driverId !== caller.id) throw new functions.https.HttpsError('permission-denied', 'Cet enlèvement ne vous est pas affecté.');
        pickupKeys.add(`${pkg.missionId}_${stop.id}`);
      } else if (pkg.stopId) refuse('Un colis conserve un arrêt sans tournée. Faites vérifier son affectation par le bureau.');
      if (pkg.status === 'Au hub' && !pkg.missionId && !pkg.stopId && !pkg.currentDriverId && !pkg.currentVehicleId && pkg.currentHubId !== data.hubId)
        refuse('Ce colis est déjà réceptionné dans un autre hub. Vérifiez le hub sélectionné.');
    }
    const pickupSnaps = await Promise.all([...pickupKeys].map(key => tx.get(db.collection('pickups').doc(key))));
    const pickups = new Map(pickupSnaps.map(snap => [snap.id, snap.data()]));
    const received: string[] = [], alreadyReceived: string[] = [];
    const now = new Date().toISOString();
    for (const snap of packageSnaps) {
      const pkg = snap.data()!;
      if (pkg.missionId) {
        const manifest = pickups.get(`${pkg.missionId}_${pkg.stopId}`);
        const mission = missions.get(pkg.missionId)!.data()!;
        if (!manifest || manifest.missionId !== pkg.missionId || manifest.stopId !== pkg.stopId || manifest.driverId !== mission.driverId ||
          !Array.isArray(manifest.scannedPackageIds) || !manifest.scannedPackageIds.includes(snap.id) || manifest.missingPackageIds?.includes(snap.id))
          refuse('Un manifeste d’enlèvement ne confirme pas la collecte de ce colis. Synchronisez ou vérifiez l’enlèvement.');
      }
      if (pkg.status === 'Au hub' && pkg.currentHubId === data.hubId && !pkg.missionId && !pkg.stopId && !pkg.currentDriverId && !pkg.currentVehicleId) {
        alreadyReceived.push(snap.id);
        continue;
      }
      received.push(snap.id);
      tx.update(snap.ref, {
        status: 'Au hub', currentHubId: data.hubId,
        missionId: null, stopId: null, currentDriverId: null, currentVehicleId: null,
        hubReceivedBy: caller.id, hubReceivedAt: now, updatedAt: now,
        movements: [...(Array.isArray(pkg.movements) ? pkg.movements : []), {
          action: 'HUB_ARRIVAL', timestamp: now, hubId: data.hubId, hubName: hubSnap.data()!.name || '',
          recordedBy: caller.id, driverId: pkg.currentDriverId || caller.id,
          notes: `Réceptionné au ${hubSnap.data()!.name || 'hub'}`,
        }],
      });
    }
    const receivedSet = new Set(received);
    for (const snap of missionSnaps) {
      const mission = snap.data()!;
      const previousStops: any[] = mission.stops || [];
      const stops = previousStops.map(stop => {
        const packageIds = (stop.packageIds || []).filter((id: string) => !receivedSet.has(id));
        return { ...stop, packageIds, packageCount: packageIds.length };
      });
      tx.update(snap.ref, {
        stops, updatedAt: now,
        totalPackages: Math.max(Number(mission.totalPackages || 0), previousStops.reduce((total, stop) => total + (stop.packageIds || []).length, 0)),
      });
    }
    return { receivedCount: received.length, alreadyReceivedCount: alreadyReceived.length, receivedPackageIds: received, confirmedPackageIds: [...received, ...alreadyReceived] };
  });
}
