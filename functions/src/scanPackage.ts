import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'crypto';
import { placeKey } from './deliveryAddress';
import { containsIndividualCode, exactScanCandidates, individualScanCandidates, matchesParcelScanCode, normalizeScanCode, parcelCodeFields, parcelDisplayCode, orderReferenceHint, orderReferenceMessage } from './scanCode';

interface Dependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
  now?: () => Date;
}
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 && !v.includes('/');
const sources = new Set(['driver-claim', 'driver-delivery', 'driver-pickup', 'hub-loading', 'quick-scan', 'transfer', 'manual-create']);
const openStatuses = new Set(['En cours', 'Dispatché']);
const finalStops = new Set(['Terminé', 'Échec', 'Passé']);
export const scanBusinessDay = (date: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** A physical scan is an idempotent server operation, including its audit record.
 * The server chooses today's tour; a cached yesterday tour is only a hint. */
export async function scanPackageHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const { db } = deps;
  const caller = await deps.requireActiveCaller(context);
  const manager = deps.isAdminCaller(caller.role);
  if (!manager && !['chauffeur', 'chauffeuse'].includes(String(caller.role).toLowerCase().trim()))
    throw new functions.https.HttpsError('permission-denied', 'Scan réservé aux chauffeurs et à l’exploitation.');
  const driverId = data?.driverId || caller.id;
  if (!validId(driverId) || (!manager && driverId !== caller.id))
    throw new functions.https.HttpsError('permission-denied', 'Vous ne pouvez pas scanner pour un autre chauffeur.');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(data?.requestId || '') || !sources.has(data?.source) ||
      (data.packageId != null && !validId(data.packageId)) || (data.targetMissionId != null && !validId(data.targetMissionId)) ||
      (data.stopId != null && !validId(data.stopId)) ||
      (data.code != null && (typeof data.code !== 'string' || !data.code.trim() || data.code.length > 500)) || (!data.packageId && !data.code))
    throw new functions.https.HttpsError('invalid-argument', 'Demande de scan invalide.');
  const code = String(data.code || '').trim();
  const requestKey = createHash('sha256').update(`${caller.id}/${data.requestId}`).digest('hex');
  const fingerprint = JSON.stringify([driverId, data.packageId || '', code, data.targetMissionId || '', data.source, data.stopId || '']);
  const receiptRef = db.collection('scan_requests').doc(requestKey);
  const auditRef = db.collection('activity_logs').doc();
  const instant = (deps.now || (() => new Date()))();
  const timestamp = instant.toISOString(), day = scanBusinessDay(instant);

  const commit = () => db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()!.fingerprint !== fingerprint) throw new functions.https.HttpsError('invalid-argument', 'Cette référence de scan a déjà servi à une autre demande.');
      return { ...receipt.data()!.result, replayed: true };
    }
    const driverSnap = await tx.get(db.collection('users').doc(driverId));
    const driver = driverSnap.data();
    if (!driver || driver.isDisabled || !['chauffeur', 'chauffeuse'].includes(String(driver.role).toLowerCase().trim()))
      throw new functions.https.HttpsError('failed-precondition', 'Sélectionnez un chauffeur actif pour prendre en charge un colis.');
    const driverName = `${driver.firstName || ''} ${driver.lastName || ''}`.trim();
    let packageSnap: DocumentSnapshot | undefined;
    let ambiguous = false;
    let matchedOrderReference: string | null = null;
    const selected = data.packageId ? await tx.get(db.collection('packages').doc(data.packageId)) : undefined;
    if (selected?.exists && code && !matchesParcelScanCode(selected.data()!, code))
      throw new functions.https.HttpsError('invalid-argument', 'Le code lu ne correspond pas au colis sélectionné.');
    if (!code) packageSnap = selected;
    else {
      // Inspect every identifier field: two senders may reuse the same number,
      // including in different fields. A browser-selected parcel cannot resolve that ambiguity.
      const lookup = async (values: string[]) => {
        const candidates = [...new Set(values.filter(Boolean))];
        if (!candidates.length) return [];
        if (candidates.length > 30) throw new functions.https.HttpsError('invalid-argument', 'Étiquette complexe : scannez ou saisissez la référence individuelle du carton.');
        const snapshots = await Promise.all(parcelCodeFields.map(field =>
          tx.get(db.collection('packages').where(field, 'in', candidates).limit(2))));
        return [...new Map(snapshots.flatMap(snap => snap.docs).map(doc => [doc.id, doc])).values()];
      };
      const knownCodes = selected?.exists ? parcelCodeFields.map(field => selected.data()![field]).filter((v): v is string => typeof v === 'string') : [];
      const exact = [...exactScanCandidates(code), ...knownCodes.filter(v => normalizeScanCode(v) === normalizeScanCode(code))];
      let found = await lookup(exact);
      if (!found.length) found = await lookup([...individualScanCandidates(code),
        ...knownCodes.filter(v => containsIndividualCode(code, v))].filter(v => !exact.includes(v)));
      ambiguous = found.length > 1;
      packageSnap = found[0] || selected;
      if (!ambiguous && selected?.exists && found.length && found[0].id !== selected.id)
        throw new functions.https.HttpsError('invalid-argument', 'Le code complet identifie un autre colis. Vérifiez la référence individuelle du carton.');
      // Shared order references identify an order, never authorize a carton scan.
      if (!packageSnap?.exists) {
        const hint = orderReferenceHint(code);
        const references = [...new Set([...individualScanCandidates(code), ...(hint ? [hint] : [])])];
        if (references.length && references.length <= 30) {
          const orders = await tx.get(db.collection('packages').where('clientReference', 'in', references).limit(1));
          if (!orders.empty) matchedOrderReference = String(orders.docs[0].data().clientReference);
        }
      }
    }
    const pkg: any = packageSnap?.exists ? { ...packageSnap.data(), id: packageSnap.id } : null;
    const base: any = { requestId: data.requestId, scannedAt: timestamp, driverId, driverName, source: data.source,
      packageId: pkg?.id || null, packageCode: pkg ? parcelDisplayCode(pkg) || code : code,
      contactName: pkg?.contactName || '', missionId: null, missionDate: null, stopId: null };
    const finish = (result: any) => {
      tx.create(receiptRef, { fingerprint, result, createdAt: timestamp, driverId, recordedBy: caller.id });
      tx.create(auditRef, {
        userId: caller.id, userName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), userRole: String(caller.role),
        action: 'PACKAGE_SCANNED', category: 'Livraison', targetType: 'package', targetId: result.packageId || '', targetName: result.packageCode,
        description: `${driverName} — ${result.packageCode} : ${result.message}`,
        outcome: result.accepted ? (result.outcome === 'already_scanned' ? 'neutral' : 'success') : 'failure',
        details: { metadata: { scan: result.outcome, scannedCode: code, accepted: result.accepted, scannedAt: timestamp, driverId, driverName, source: data.source,
          missionId: result.missionId, missionDate: result.missionDate, previousMissionId: result.previousMissionId || null,
          previousMissionDate: result.previousMissionDate || null, requestedMissionId: data.targetMissionId || null,
          requestedStopId: data.stopId || null, packageCode: result.packageCode, requestId: data.requestId } }, createdAt: timestamp,
      });
      return result;
    };
    const refused = (outcome: string, message: string, extra = {}) => finish({ ...base, ...extra, accepted: false, outcome, message });
    if (matchedOrderReference) return refused('ambiguous', orderReferenceHint(code) === matchedOrderReference ? orderReferenceMessage(matchedOrderReference) : `La référence ${matchedOrderReference} correspond à une commande. Scannez la référence individuelle du carton ou son code DELIVREX. Aucun colis validé.`, { matchedOrderReference });
    if (ambiguous) return refused('ambiguous', 'Cette référence correspond à plusieurs colis ou expéditeurs. Scannez un autre identifiant unique du carton, par exemple son code DELIVREX. Aucun colis validé.', { packageId: null, packageCode: code, contactName: '' });
    if (!pkg) return refused('not_found', 'Référence de colis non retrouvée. Vérifiez le numéro imprimé sur le carton et son import avec le bureau. Le refus est enregistré dans le suivi des scans.');
    if (['Livré', 'Retourné', 'À retourner'].includes(pkg.status))
      return refused('terminal', terminalScanMessage(pkg), { missionId: pkg.missionId || null, missionDate: pkg.missionDate || null });
    if (pkg.missionId && !validId(pkg.missionId)) return refused('blocked', 'Affectation invalide : faites vérifier ce colis par le bureau.');

    const driverMissions = await tx.get(db.collection('missions').where('driverId', '==', driverId).where('date', '==', day));
    const all = driverMissions.docs.map(s => ({ ...s.data(), id: s.id } as any));
    const eligible = all.filter(m => m.date === day && openStatuses.has(m.status) && m.type !== 'Navette');
    const hinted = data.targetMissionId ? await tx.get(db.collection('missions').doc(data.targetMissionId)) : null;
    if (hinted?.exists && hinted.data()!.driverId !== driverId)
      throw new functions.https.HttpsError('permission-denied', 'Cette tournée appartient à un autre chauffeur.');
    // Stable choice shared by every entry point. Explicit current view wins, then an in-progress tour.
    const ranked = [...eligible].sort((a, b) => Number(b.status === 'En cours') - Number(a.status === 'En cours') ||
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
    let mission = eligible.find(m => m.id === data.targetMissionId) || eligible.find(m => m.id === driver.activeScanMissionId) || ranked[0];
    const sourceSnap = pkg.missionId ? await tx.get(db.collection('missions').doc(pkg.missionId)) : null;
    const previous: any = sourceSnap?.exists ? { ...sourceSnap.data(), id: sourceSnap.id } : null;
    const sourceStops: any[] = (previous?.stops || []).filter((s: any) => s.id === pkg.stopId || s.packageIds?.includes(pkg.id));
    const proofSnaps = await Promise.all(sourceStops.map(s => tx.get(db.collection('proofs_of_delivery').doc(`${previous.id}_${s.id}`))));
    if (proofSnaps.some(s => s.exists && s.data()!.type === 'SUCCESS' && Array.isArray(s.data()!.packageIds) && s.data()!.packageIds.includes(pkg.id)))
      return refused('terminal', 'Une preuve confirme déjà la livraison de ce colis. Faites vérifier son statut par le bureau.');

    // A control at a stop must never claim, transfer or resurrect a parcel.
    // Resolve the explicit context, not a cached/default tour. Transaction reads
    // also protect against a concurrent transfer or delivery after the scan starts.
    if (['driver-delivery', 'driver-pickup'].includes(data.source)) {
      const target: any = hinted?.exists ? { ...hinted.data(), id: hinted.id } : null;
      const stop = target?.stops?.find((s: any) => s.id === data.stopId);
      const pickup = data.source === 'driver-pickup';
      if (!target || target.date !== day || !openStatuses.has(target.status) || !stop)
        return refused('blocked', 'La tournée ou l’arrêt a changé. Rouvrez l’arrêt du jour avant de scanner.');
      if (finalStops.has(stop.status)) return refused('blocked', 'Cet arrêt est déjà terminé. Consultez la livraison ou contactez le bureau.');
      if (stop.type !== (pickup ? 'PICKUP' : 'DELIVERY') || pkg.missionId !== target.id || pkg.stopId !== stop.id ||
          !stop.packageIds?.includes(pkg.id) || (pkg.currentDriverId && pkg.currentDriverId !== driverId))
        return refused('wrong_stop', 'Ce colis ne correspond pas à cet arrêt. Ouvrez le bon arrêt ou utilisez la prise en charge pour un transfert.',
          { missionId: pkg.missionId || null, missionDate: pkg.missionDate || null, stopId: pkg.stopId || null });
      tx.update(packageSnap!.ref, {
        lastVerifiedAt: timestamp, lastVerifiedMissionId: target.id, lastVerifiedStopId: stop.id,
        lastVerifiedBy: driverId, updatedAt: timestamp,
      });
      return finish({ ...base, accepted: true, outcome: 'verified', missionId: target.id, missionDate: target.date,
        stopId: stop.id, status: pkg.status, message: pickup ? 'Colis vérifié pour cet enlèvement.' : 'Colis vérifié pour cette livraison.' });
    }

    let creating = false;
    if (!mission) {
      let id = `DLV-${driverId}-${day}`, suffix = 1;
      while (all.some(m => m.id === id)) id = `DLV-${driverId}-${day}-${++suffix}`;
      const target = await tx.get(db.collection('missions').doc(id));
      if (target.exists) throw new functions.https.HttpsError('aborted', 'La tournée a changé. Réessayez le scan.');
      let vehicle: any = null;
      if (validId(driver.assignedVehicleId)) {
        const v = await tx.get(db.collection('vehicles').doc(driver.assignedVehicleId));
        if (v.exists && (v.data()!.driverId === driverId || v.data()!.assignedDriverId === driverId)) vehicle = { ...v.data(), id: v.id };
      }
      if (!vehicle) {
        const vehicles = await tx.get(db.collection('vehicles').where('driverId', '==', driverId).limit(1));
        if (!vehicles.empty) vehicle = { ...vehicles.docs[0].data(), id: vehicles.docs[0].id };
      }
      mission = { id, driverId, driverName, date: day, type: 'Livraison', status: 'En cours', zone: pkg.zone || 'Nord',
        hubId: '', hubName: 'Prise en charge terrain', vehicleId: vehicle?.id || '', vehiclePlate: vehicle?.licensePlate || vehicle?.plate || '',
        stops: [], totalPackages: 0, completedStops: 0, failedStops: 0, deliveredPackages: 0, failedPackages: 0,
        createdAt: timestamp, updatedAt: timestamp, createdBy: caller.id, createdByName: driverName };
      creating = true;
    }
    const stops: any[] = (mission.stops || []).map((s: any) => ({ ...s, packageIds: [...(s.packageIds || [])] }));
    let stop = stops.find(s => s.packageIds.includes(pkg.id) && !finalStops.has(s.status));
    const sameAssignment = pkg.missionId === mission.id && pkg.currentDriverId === driverId && stop?.id === pkg.stopId;
    if (!sameAssignment && sourceStops.some(s => s.proofSyncPending))
      return refused('blocked', 'Synchronisez la preuve en attente avant de reprendre ce colis.');
    if (pkg.missionId === mission.id && stops.some(s => s.packageIds.includes(pkg.id) && finalStops.has(s.status)))
      return refused('blocked', 'Cet arrêt a déjà été traité aujourd’hui. Faites vérifier la reprise par le bureau.');
    const pickupVerification = stop?.type === 'PICKUP' && data.source === 'driver-pickup' && (!data.stopId || data.stopId === stop.id);
    if (stop?.type === 'PICKUP' && !pickupVerification)
      return refused('blocked', 'Ce colis appartient à un enlèvement en cours. Scannez-le depuis cet arrêt puis validez l’enlèvement.');
    if (!sameAssignment && !pickupVerification) {
      // Remove a stale reference from this tour before attaching to an actionable delivery stop.
      for (const s of stops) { s.packageIds = s.packageIds.filter((id: string) => id !== pkg.id); s.packageCount = s.packageIds.length; }
      stop = stops.find(s => s.type === 'DELIVERY' && !finalStops.has(s.status) && placeKey(s) === placeKey(pkg));
      if (!stop) {
        stop = { id: `scan-${requestKey.slice(0, 20)}`, sequence: Math.max(0, ...stops.map(s => s.sequence || 0)) + 1,
          type: 'DELIVERY', status: 'En attente', address: pkg.address || '', postalCode: pkg.postalCode || '', city: pkg.city || '',
          contactName: pkg.contactName || '', contactPhone: pkg.contactPhone || '', packageIds: [], packageCount: 0, serviceTime: pkg.serviceTime || 5,
          ...(pkg.coordinates ? { coordinates: pkg.coordinates } : {}), ...(pkg.timeWindowStart ? { timeWindowStart: pkg.timeWindowStart } : {}),
          ...(pkg.timeWindowEnd ? { timeWindowEnd: pkg.timeWindowEnd } : {}) };
        stops.push(stop);
      }
      stop.packageIds.push(pkg.id); stop.packageCount = stop.packageIds.length;
    }
    const duplicate = sameAssignment && pkg.lastScannedMissionId === mission.id;
    const outcome = duplicate ? 'already_scanned' : previous && previous.id !== mission.id ? 'reassigned' : 'confirmed';
    const movement: any = { action: 'SCANNED', timestamp, driverId, driverName, missionId: mission.id, missionDate: day,
      stopId: stop.id, source: data.source, outcome, recordedBy: caller.id, requestId: data.requestId,
      ...(previous && previous.id !== mission.id ? { fromMissionId: previous.id, fromMissionDate: previous.date || '', fromDriverName: previous.driverName || '' } : {}) };
    const patch: any = { missionId: mission.id, missionDate: day, stopId: stop.id, currentDriverId: driverId, currentVehicleId: mission.vehicleId || null,
      status: pickupVerification ? pkg.status : mission.status === 'Dispatché' ? 'Chargé' : 'En livraison',
      lastScannedAt: timestamp, lastScannedMissionId: mission.id, lastScannedBy: driverId, lastScanSource: data.source,
      firstScannedForMissionAt: pkg.lastScannedMissionId === mission.id ? pkg.firstScannedForMissionAt || timestamp : timestamp,
      movements: [...(pkg.movements || []), movement], updatedAt: timestamp };
    if (!sameAssignment) Object.assign(patch, { estimatedDeliveryAt: null, liveDriver: null, remainingBeforeMine: null });
    tx.update(packageSnap!.ref, patch);
    if (driver.activeScanMissionId !== mission.id) tx.update(driverSnap.ref, { activeScanMissionId: mission.id });
    const counters = (ss: any[], old: any) => ({
      totalPackages: Math.max(ss.reduce((n, s) => n + s.packageIds.length, 0), (old.deliveredPackages || 0) + (old.failedPackages || 0) +
        new Set(ss.filter(s => !finalStops.has(s.status)).flatMap(s => s.packageIds)).size),
      completedStops: ss.filter(s => s.status === 'Terminé').length, failedStops: ss.filter(s => ['Échec', 'Passé'].includes(s.status)).length,
    });
    if (previous && previous.id !== mission.id) {
      const oldStops = (previous.stops || []).map((s: any) => {
        const packageIds = (s.packageIds || []).filter((id: string) => id !== pkg.id);
        return { ...s, packageIds, packageCount: packageIds.length,
          ...(!packageIds.length && !finalStops.has(s.status) ? { status: 'Passé', transferNotes: `Colis repris dans la tournée du ${day}` } : {}) };
      });
      tx.update(sourceSnap!.ref, { stops: oldStops, ...counters(oldStops, previous), updatedAt: timestamp });
      tx.create(db.collection('package_transfers').doc(requestKey), { packageIds: [pkg.id], packageCount: 1, fromDriverId: previous.driverId || '', toDriverId: driverId,
        fromMissionId: previous.id, toMissionId: mission.id, fromMissionDate: previous.date || '', toMissionDate: day,
        status: 'Confirmé', reason: 'Reprise par scan', createdAt: timestamp, updatedAt: timestamp, createdBy: caller.id });
    }
    const missionPatch = { stops, ...counters(stops, mission), updatedAt: timestamp,
      ...(mission.type === 'Collecte' && !pickupVerification ? { type: 'Mixte' } : {}) };
    if (creating) { const { id, ...fields } = mission; tx.create(db.collection('missions').doc(id), { ...fields, ...missionPatch }); }
    else if (!sameAssignment) tx.update(db.collection('missions').doc(mission.id), missionPatch);
    const message = `${duplicate ? 'Déjà scanné' : outcome === 'reassigned' ? 'Repris' : 'Scan confirmé'} — tournée du ${day.split('-').reverse().join('/')}`;
    return finish({ ...base, accepted: true, outcome, message, missionId: mission.id, missionDate: day, stopId: stop.id,
      status: patch.status, previousMissionId: previous?.id || null, previousMissionDate: previous?.date || null });
  });
  // Some Firestore transaction-expiry responses use code 3 with this wording,
  // which the SDK does not retry. Reusing the receipt ID makes the retry safe
  // even if the original commit succeeded but its acknowledgement was lost.
  for (let attempt = 0; ; attempt++) {
    try { return await commit(); }
    catch (error: any) {
      if (attempt >= 2 || error?.code !== 3 || !/Transaction is invalid or closed/i.test(String(error?.details || error?.message))) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

function terminalScanMessage(pkg: any): string {
  const movement = Array.isArray(pkg.movements) ? [...pkg.movements].reverse().find((m: any) => m.action === 'DELIVERED') : null;
  if (pkg.status === 'Livré' && movement) {
    const date = new Date(movement.timestamp);
    const when = Number.isFinite(date.getTime()) ? ` le ${date.toLocaleString('fr-FR', { timeZone: 'Indian/Reunion', dateStyle: 'short', timeStyle: 'short' })}` : '';
    const by = movement.driverName ? ` par ${String(movement.driverName).slice(0, 120)}` : '';
    return `Livraison déjà enregistrée${when}${by}. Faites vérifier ce colis par le bureau si vous l’avez encore.`;
  }
  return `Colis ${pkg.status.toLowerCase()} : faites vérifier son historique par le bureau.`;
}
