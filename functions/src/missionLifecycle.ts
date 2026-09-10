import * as functions from 'firebase-functions/v1';
import type { Firestore } from 'firebase-admin/firestore';

interface LifecycleDependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
}

/** Closing is a server operation: all devices must agree on stop outcomes and
 * uploaded proofs before the tour becomes immutable. No pending parcel is
 * implicitly delivered, returned, or detached by this operation. */
export async function finishMissionHandler(
  data: any,
  context: functions.https.CallableContext,
  { db, requireActiveCaller, isAdminCaller }: LifecycleDependencies,
) {
  const caller = await requireActiveCaller(context);
  const id = data?.missionId;
  if (typeof id !== 'string' || !id || id.includes('/') || id.length > 200) {
    throw new functions.https.HttpsError('invalid-argument', 'Tournée invalide.');
  }
  return db.runTransaction(async tx => {
    const ref = db.collection('missions').doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Tournée introuvable.');
    const mission = snap.data()!;
    if (!isAdminCaller(caller.role) && (mission.driverId !== caller.id ||
      !['chauffeur', 'chauffeuse'].includes(String(caller.role || '').toLowerCase().trim()))) {
      throw new functions.https.HttpsError('permission-denied', 'Cette tournée ne vous est pas affectée.');
    }
    if (mission.status === 'Terminé') return { success: true, alreadyCompleted: true };
    if (mission.status === 'Annulé') {
      throw new functions.https.HttpsError('failed-precondition', 'Cette tournée est annulée.');
    }
    const stops: any[] = Array.isArray(mission.stops) ? mission.stops : [];
    const allIds = stops.flatMap(s => s.packageIds || []);
    if (stops.some(s => !['DELIVERY', 'PICKUP', 'HUB'].includes(s.type) || !Array.isArray(s.packageIds)) ||
      new Set(stops.map(s => s.id)).size !== stops.length || new Set(allIds).size !== allIds.length) {
      throw new functions.https.HttpsError('failed-precondition', 'Les arrêts ou les colis de cette tournée sont incohérents. Contactez le bureau.');
    }
    const remaining = stops.filter(s => !['Terminé', 'Échec', 'Passé'].includes(s.status));
    if (remaining.length) {
      throw new functions.https.HttpsError('failed-precondition',
        `${remaining.length} arrêt(s) restent à traiter. Livrez, déclarez les échecs ou faites réaffecter les colis avant de clôturer.`);
    }
    if (stops.some(s => s.proofSyncPending === true)) {
      throw new functions.https.HttpsError('failed-precondition',
        'Des preuves sont encore en attente d’envoi. Synchronisez les appareils utilisés avant de clôturer.');
    }
    const ids = [...new Set<string>(stops.flatMap(s => s.packageIds || []))];
    if (ids.some(pid => typeof pid !== 'string' || !pid || pid.includes('/')) ||
      stops.some(s => typeof s.id !== 'string' || !s.id || s.id.includes('/')) ||
      ids.length > 1000 || stops.length > 500) {
      throw new functions.https.HttpsError('failed-precondition', 'La tournée doit être vérifiée par le bureau.');
    }
    const packages = await Promise.all(ids.map(pid => tx.get(db.collection('packages').doc(pid))));
    const byId = new Map(packages.map(p => [p.id, p]));
    const proofStops = stops.filter(s => (s.packageIds || []).length && ['DELIVERY', 'PICKUP'].includes(s.type));
    const proofs = await Promise.all(proofStops.map(s => tx.get(db.collection(
      s.type === 'PICKUP' ? 'pickups' : 'proofs_of_delivery'
    ).doc(`${id}_${s.id}`))));
    const proofByStop = new Map(proofStops.map((s, i) => [s.id, proofs[i]]));
    for (const stop of stops) {
      const packageIds: string[] = stop.packageIds || [];
      if (!packageIds.length) continue;
      const proof = proofByStop.get(stop.id)?.data();
      if (stop.type === 'DELIVERY') {
        if (!proof || proof.missionId !== id || proof.stopId !== stop.id || proof.driverId !== mission.driverId ||
          !Array.isArray(proof.packageIds) || !proof.packageIds.length ||
          !Array.isArray(proof.photoUrls) || !proof.photoUrls.length ||
          proof.photoUrls.some((url: unknown) => typeof url !== 'string' || !url.startsWith('https://')) ||
          !['SUCCESS', 'FAILURE'].includes(proof.type)) {
          throw new functions.https.HttpsError('failed-precondition',
            'Une preuve de livraison ou d’échec est absente ou incomplète. Synchronisez les preuves ; si le problème persiste, contactez le bureau.');
        }
        if (stop.status === 'Terminé' && proof.type !== 'SUCCESS' ||
          ['Échec', 'Passé'].includes(stop.status) && proof.type !== 'FAILURE') {
          throw new functions.https.HttpsError('failed-precondition', 'Une preuve ne correspond pas au résultat de son arrêt.');
        }
        if (proof.type === 'SUCCESS' && (typeof proof.signatureUrl !== 'string' || !proof.signatureUrl.startsWith('https://') ||
          !String(proof.recipientName || '').trim() || !Number.isFinite(proof.coordinates?.lat) ||
          !Number.isFinite(proof.coordinates?.lng) || Math.abs(proof.coordinates.lat) > 90 || Math.abs(proof.coordinates.lng) > 180 ||
          !packageIds.some(pid => byId.get(pid)?.data()?.status === 'Livré' && proof.packageIds.includes(pid)))) {
          throw new functions.https.HttpsError('failed-precondition',
            'Une preuve de remise est incomplète (réceptionnaire, signature ou position). Contactez le bureau.');
        }
      } else if (stop.type === 'PICKUP' && (!proof || proof.driverId !== mission.driverId ||
        proof.missionId !== id || proof.stopId !== stop.id || !Array.isArray(proof.scannedPackageIds) || !Array.isArray(proof.missingPackageIds))) {
        throw new functions.https.HttpsError('failed-precondition', 'Un manifeste d’enlèvement est absent. Synchronisez cet enlèvement.');
      }
      for (const pid of packageIds) {
        const parcel = byId.get(pid);
        if (!parcel?.exists) throw new functions.https.HttpsError('failed-precondition', 'Un colis de la tournée est introuvable.');
        const p = parcel.data()!;
        if (p.status === 'À retourner') {
          throw new functions.https.HttpsError('failed-precondition', 'Des retours au hub restent à confirmer avant de clôturer la tournée.');
        }
        if ((p.missionId && p.missionId !== id) || (p.currentDriverId && p.currentDriverId !== mission.driverId)) {
          throw new functions.https.HttpsError('failed-precondition', 'Une affectation est incohérente. Faites vérifier la tournée par le bureau.');
        }
        if (stop.type === 'DELIVERY') {
          if (!['Livré', 'Échec', 'Retourné'].includes(p.status)) {
            throw new functions.https.HttpsError('failed-precondition', 'Des colis attendent encore une décision de livraison.');
          }
          if (p.status === 'Livré' && (proof?.type !== 'SUCCESS' || !proof.packageIds?.includes(pid))) {
            throw new functions.https.HttpsError('failed-precondition', 'La preuve d’un colis livré n’est pas synchronisée.');
          }
          if (proof?.type === 'FAILURE' && !proof.packageIds?.includes(pid)) {
            throw new functions.https.HttpsError('failed-precondition', 'La preuve d’échec ne couvre pas tous les colis de l’arrêt.');
          }
        } else if (stop.type === 'PICKUP' && !proof?.scannedPackageIds?.includes(pid) && !proof?.missingPackageIds?.includes(pid)) {
          throw new functions.https.HttpsError('failed-precondition', 'Un colis n’a pas de décision dans le manifeste d’enlèvement.');
        } else if (stop.type === 'HUB' && !['Au hub', 'Trié', 'Retourné'].includes(p.status)) {
          throw new functions.https.HttpsError('failed-precondition', 'La réception des colis au hub reste à confirmer.');
        }
      }
    }
    const now = new Date().toISOString();
    tx.update(ref, {
      status: 'Terminé', completedAt: now, updatedAt: now,
      completedBy: caller.id,
      completedStops: stops.filter(s => s.status === 'Terminé').length,
      failedStops: stops.filter(s => ['Échec', 'Passé'].includes(s.status)).length,
    });
    return { success: true, alreadyCompleted: false };
  });
}
