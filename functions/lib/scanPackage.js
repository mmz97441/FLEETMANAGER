"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanBusinessDay = void 0;
exports.scanPackageHandler = scanPackageHandler;
const functions = __importStar(require("firebase-functions/v1"));
const crypto_1 = require("crypto");
const deliveryAddress_1 = require("./deliveryAddress");
const scanCode_1 = require("./scanCode");
const validId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !v.includes('/');
const sources = new Set(['driver-claim', 'driver-delivery', 'driver-pickup', 'hub-loading', 'quick-scan', 'transfer', 'manual-create']);
const openStatuses = new Set(['En cours', 'Dispatché']);
const finalStops = new Set(['Terminé', 'Échec', 'Passé']);
const scanBusinessDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
exports.scanBusinessDay = scanBusinessDay;
/** A physical scan is an idempotent server operation, including its audit record.
 * The server chooses today's tour; a cached yesterday tour is only a hint. */
async function scanPackageHandler(data, context, deps) {
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
    const requestKey = (0, crypto_1.createHash)('sha256').update(`${caller.id}/${data.requestId}`).digest('hex');
    const fingerprint = JSON.stringify([driverId, data.packageId || '', code, data.targetMissionId || '', data.source, data.stopId || '']);
    const receiptRef = db.collection('scan_requests').doc(requestKey);
    const auditRef = db.collection('activity_logs').doc();
    const instant = (deps.now || (() => new Date()))();
    const timestamp = instant.toISOString(), day = (0, exports.scanBusinessDay)(instant);
    const commit = () => db.runTransaction(async (tx) => {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
            if (receipt.data().fingerprint !== fingerprint)
                throw new functions.https.HttpsError('invalid-argument', 'Cette référence de scan a déjà servi à une autre demande.');
            return { ...receipt.data().result, replayed: true };
        }
        const driverSnap = await tx.get(db.collection('users').doc(driverId));
        const driver = driverSnap.data();
        if (!driver || driver.isDisabled || !['chauffeur', 'chauffeuse'].includes(String(driver.role).toLowerCase().trim()))
            throw new functions.https.HttpsError('failed-precondition', 'Sélectionnez un chauffeur actif pour prendre en charge un colis.');
        const driverName = `${driver.firstName || ''} ${driver.lastName || ''}`.trim();
        let packageSnap;
        let ambiguous = false;
        let matchedOrderReference = null;
        const selected = data.packageId ? await tx.get(db.collection('packages').doc(data.packageId)) : undefined;
        if (selected?.exists && code && !(0, scanCode_1.matchesParcelScanCode)(selected.data(), code))
            throw new functions.https.HttpsError('invalid-argument', 'Le code lu ne correspond pas au colis sélectionné.');
        if (!code)
            packageSnap = selected;
        else {
            // Inspect every identifier field: two senders may reuse the same number,
            // including in different fields. A browser-selected parcel cannot resolve that ambiguity.
            const lookup = async (values) => {
                const candidates = [...new Set(values.filter(Boolean))];
                if (!candidates.length)
                    return [];
                if (candidates.length > 30)
                    throw new functions.https.HttpsError('invalid-argument', 'Étiquette complexe : scannez ou saisissez la référence individuelle du carton.');
                const canonical = [...new Set(candidates.map(scanCode_1.normalizeScanCode))];
                const snapshots = await Promise.all([tx.get(db.collection('packages').where('scanCodes', 'array-contains-any', canonical).limit(2)),
                    ...scanCode_1.parcelCodeFields.map(field => tx.get(db.collection('packages').where(field, 'in', candidates).limit(2)))]);
                return [...new Map(snapshots.flatMap(snap => snap.docs).map(doc => [doc.id, doc])).values()];
            };
            const knownCodes = selected?.exists ? scanCode_1.parcelCodeFields.map(field => selected.data()[field]).filter((v) => typeof v === 'string') : [];
            const exact = [...(0, scanCode_1.exactScanCandidates)(code), ...knownCodes.filter(v => (0, scanCode_1.normalizeScanCode)(v) === (0, scanCode_1.normalizeScanCode)(code))];
            let found = await lookup(exact);
            if (!found.length)
                found = await lookup([...(0, scanCode_1.individualScanCandidates)(code),
                    ...knownCodes.filter(v => (0, scanCode_1.containsIndividualCode)(code, v))].filter(v => !exact.includes(v)));
            ambiguous = found.length > 1;
            packageSnap = found[0] || selected;
            if (!ambiguous && selected?.exists && found.length && found[0].id !== selected.id)
                throw new functions.https.HttpsError('invalid-argument', 'Le code complet identifie un autre colis. Vérifiez la référence individuelle du carton.');
            // Shared order references identify an order, never authorize a carton scan.
            if (!packageSnap?.exists) {
                const hint = (0, scanCode_1.orderReferenceHint)(code);
                const references = [...new Set([...(0, scanCode_1.individualScanCandidates)(code), ...(hint ? [hint] : [])])];
                if (references.length && references.length <= 30) {
                    const orders = await tx.get(db.collection('packages').where('clientReference', 'in', references).limit(1));
                    if (!orders.empty)
                        matchedOrderReference = String(orders.docs[0].data().clientReference);
                }
            }
        }
        const pkg = packageSnap?.exists ? { ...packageSnap.data(), id: packageSnap.id } : null;
        const base = { requestId: data.requestId, scannedAt: timestamp, driverId, driverName, source: data.source,
            packageId: pkg?.id || null, packageCode: pkg ? (0, scanCode_1.parcelDisplayCode)(pkg) || code : code,
            contactName: pkg?.contactName || '', missionId: null, missionDate: null, stopId: null };
        const finish = (result) => {
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
        const refused = (outcome, message, extra = {}) => finish({ ...base, ...extra, accepted: false, outcome, message });
        if (matchedOrderReference)
            return refused('ambiguous', (0, scanCode_1.orderReferenceHint)(code) === matchedOrderReference ? (0, scanCode_1.orderReferenceMessage)(matchedOrderReference) : `La référence ${matchedOrderReference} correspond à une commande. Scannez la référence individuelle du carton ou son code DELIVREX. Aucun colis validé.`, { matchedOrderReference });
        if (ambiguous)
            return refused('ambiguous', 'Cette référence correspond à plusieurs colis ou expéditeurs. Scannez un autre identifiant unique du carton, par exemple son code DELIVREX. Aucun colis validé.', { packageId: null, packageCode: code, contactName: '' });
        if (!pkg)
            return refused('not_found', 'Référence de colis non retrouvée. Vérifiez le numéro imprimé sur le carton et son import avec le bureau. Le refus est enregistré dans le suivi des scans.');
        if (pkg.pickupMissing && data.source !== 'driver-pickup')
            return refused('blocked', 'Ce colis a été déclaré manquant à l’enlèvement. Planifiez puis confirmez sa collecte avant la livraison.');
        if (pkg.returnDisposition === 'AWAITING_DECISION' || pkg.returnDisposition === 'SENDER_RETURNED')
            return refused('blocked', 'Ce retour attend une décision du bureau ou a été rendu à l’expéditeur. Une nouvelle livraison doit être replanifiée.');
        if (pkg.status === 'Échec')
            return refused('blocked', 'Ce colis est en échec de livraison. Confirmez son retour physique au dépôt, puis faites valider la relivraison par le bureau avant de le reprendre.');
        if (['Livré', 'Retourné', 'À retourner'].includes(pkg.status))
            return refused('terminal', terminalScanMessage(pkg), { missionId: pkg.missionId || null, missionDate: pkg.missionDate || null });
        if (pkg.missionId && !validId(pkg.missionId))
            return refused('blocked', 'Affectation invalide : faites vérifier ce colis par le bureau.');
        const driverMissions = await tx.get(db.collection('missions').where('driverId', '==', driverId).where('date', '==', day));
        const all = driverMissions.docs.map(s => ({ ...s.data(), id: s.id }));
        const eligible = all.filter(m => m.date === day && openStatuses.has(m.status) && m.type !== 'Navette');
        const hinted = data.targetMissionId ? await tx.get(db.collection('missions').doc(data.targetMissionId)) : null;
        if (hinted?.exists && hinted.data().driverId !== driverId)
            throw new functions.https.HttpsError('permission-denied', 'Cette tournée appartient à un autre chauffeur.');
        // Stable choice shared by every entry point. Explicit current view wins, then an in-progress tour.
        const ranked = [...eligible].sort((a, b) => Number(b.status === 'En cours') - Number(a.status === 'En cours') ||
            String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id));
        let mission = eligible.find(m => m.id === data.targetMissionId) || eligible.find(m => m.id === driver.activeScanMissionId) || ranked[0];
        const sourceSnap = pkg.missionId ? await tx.get(db.collection('missions').doc(pkg.missionId)) : null;
        const previous = sourceSnap?.exists ? { ...sourceSnap.data(), id: sourceSnap.id } : null;
        const sourceStops = (previous?.stops || []).filter((s) => s.id === pkg.stopId || s.packageIds?.includes(pkg.id));
        const proofSnaps = await Promise.all(sourceStops.map(s => tx.get(db.collection('proofs_of_delivery').doc(`${previous.id}_${s.id}`))));
        if (proofSnaps.some(s => s.exists && s.data().type === 'SUCCESS' && Array.isArray(s.data().packageIds) && s.data().packageIds.includes(pkg.id)))
            return refused('terminal', 'Une preuve confirme déjà la livraison de ce colis. Faites vérifier son statut par le bureau.');
        // A control at a stop must never claim, transfer or resurrect a parcel.
        // Resolve the explicit context, not a cached/default tour. Transaction reads
        // also protect against a concurrent transfer or delivery after the scan starts.
        if (['driver-delivery', 'driver-pickup'].includes(data.source)) {
            const target = hinted?.exists ? { ...hinted.data(), id: hinted.id } : null;
            const stop = target?.stops?.find((s) => s.id === data.stopId);
            const pickup = data.source === 'driver-pickup';
            if (!target || target.date !== day || !openStatuses.has(target.status) || !stop)
                return refused('blocked', 'La tournée ou l’arrêt a changé. Rouvrez l’arrêt du jour avant de scanner.');
            if (finalStops.has(stop.status))
                return refused('blocked', 'Cet arrêt est déjà terminé. Consultez la livraison ou contactez le bureau.');
            if (stop.type !== (pickup ? 'PICKUP' : 'DELIVERY') || pkg.missionId !== target.id || pkg.stopId !== stop.id ||
                !stop.packageIds?.includes(pkg.id) || (!pickup && (!(0, deliveryAddress_1.sameDeliveryRecipient)(stop, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, pkg))) || (pkg.currentDriverId && pkg.currentDriverId !== driverId))
                return refused('wrong_stop', 'Ce colis ne correspond pas à cet arrêt. Ouvrez le bon arrêt ou utilisez la prise en charge pour un transfert.', { missionId: pkg.missionId || null, missionDate: pkg.missionDate || null, stopId: pkg.stopId || null });
            if (!pickup) {
                if (!Array.isArray(stop.packageIds) || stop.packageIds.length > 400)
                    return refused('blocked', 'La liste des colis de cet arrêt doit être vérifiée par le bureau.');
                const expected = await Promise.all(stop.packageIds.map((id) => tx.get(db.collection('packages').doc(id))));
                if (expected.some(doc => !doc.exists || !(0, deliveryAddress_1.sameDeliveryRecipient)(stop, doc.data()) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, doc.data()) ||
                    doc.data().missionId !== target.id || doc.data().stopId !== stop.id || (doc.data().currentDriverId && doc.data().currentDriverId !== driverId)))
                    return refused('wrong_stop', 'Cet arrêt contient un colis d’un autre destinataire, étage ou créneau. Ne remettez aucun colis avant correction par le bureau.');
            }
            tx.update(packageSnap.ref, {
                lastVerifiedAt: timestamp, lastVerifiedMissionId: target.id, lastVerifiedStopId: stop.id,
                lastVerifiedBy: driverId, updatedAt: timestamp,
            });
            return finish({ ...base, accepted: true, outcome: 'verified', missionId: target.id, missionDate: target.date,
                stopId: stop.id, status: pkg.status, message: pickup ? 'Colis vérifié pour cet enlèvement.' : 'Colis vérifié pour cette livraison.' });
        }
        let creating = false;
        if (!mission) {
            let id = `DLV-${driverId}-${day}`, suffix = 1;
            while (all.some(m => m.id === id))
                id = `DLV-${driverId}-${day}-${++suffix}`;
            const target = await tx.get(db.collection('missions').doc(id));
            if (target.exists)
                throw new functions.https.HttpsError('aborted', 'La tournée a changé. Réessayez le scan.');
            let vehicle = null;
            if (validId(driver.assignedVehicleId)) {
                const v = await tx.get(db.collection('vehicles').doc(driver.assignedVehicleId));
                if (v.exists && (v.data().driverId === driverId || v.data().assignedDriverId === driverId))
                    vehicle = { ...v.data(), id: v.id };
            }
            if (!vehicle) {
                const vehicles = await tx.get(db.collection('vehicles').where('driverId', '==', driverId).limit(1));
                if (!vehicles.empty)
                    vehicle = { ...vehicles.docs[0].data(), id: vehicles.docs[0].id };
            }
            mission = { id, driverId, driverName, date: day, type: 'Livraison', status: 'En cours', zone: pkg.zone || 'Nord',
                hubId: '', hubName: 'Prise en charge terrain', vehicleId: vehicle?.id || '', vehiclePlate: vehicle?.licensePlate || vehicle?.plate || '',
                stops: [], totalPackages: 0, completedStops: 0, failedStops: 0, deliveredPackages: 0, failedPackages: 0,
                createdAt: timestamp, updatedAt: timestamp, createdBy: caller.id, createdByName: driverName };
            creating = true;
        }
        const stops = (mission.stops || []).map((s) => ({ ...s, packageIds: [...(s.packageIds || [])] }));
        let stop = stops.find(s => s.packageIds.includes(pkg.id) && !finalStops.has(s.status));
        if (stop?.type === 'DELIVERY' && (!(0, deliveryAddress_1.sameDeliveryRecipient)(stop, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, pkg)))
            return refused('blocked', 'Le destinataire, l’étage ou le créneau de cet arrêt ne correspond plus au colis. Faites corriger la tournée par le bureau.');
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
            for (const s of stops) {
                s.packageIds = s.packageIds.filter((id) => id !== pkg.id);
                s.packageCount = s.packageIds.length;
            }
            stop = stops.find(s => s.type === 'DELIVERY' && s.status === 'En attente' && !s.proofSyncPending && (0, deliveryAddress_1.sameDeliveryVisit)(s, pkg));
            if (stop) {
                const expected = await Promise.all(stop.packageIds.map((id) => tx.get(db.collection('packages').doc(id))));
                if (expected.some(doc => !doc.exists || !(0, deliveryAddress_1.sameDeliveryRecipient)(stop, doc.data()) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, doc.data())))
                    return refused('blocked', 'Cet arrêt contient des destinataires ou créneaux incohérents. Faites corriger la tournée par le bureau.');
            }
            if (!stop) {
                stop = { id: `scan-${requestKey.slice(0, 20)}`, sequence: Math.max(0, ...stops.map(s => s.sequence || 0)) + 1,
                    type: 'DELIVERY', status: 'En attente', address: pkg.address || '', postalCode: pkg.postalCode || '', city: pkg.city || '',
                    contactName: pkg.contactName || '', contactPhone: pkg.contactPhone || '', ...(pkg.floor != null ? { floor: pkg.floor } : {}), ...(pkg.hasElevator != null ? { hasElevator: pkg.hasElevator } : {}), packageIds: [], packageCount: 0, serviceTime: pkg.serviceTime || 5,
                    ...(pkg.coordinates ? { coordinates: pkg.coordinates } : {}), ...(pkg.timeWindowStart ? { timeWindowStart: pkg.timeWindowStart } : {}),
                    ...(pkg.timeWindowEnd ? { timeWindowEnd: pkg.timeWindowEnd } : {}) };
                stops.push(stop);
            }
            if (stop.packageIds.length) {
                Object.assign(stop, (0, deliveryAddress_1.intersectDeliveryWindows)([stop, pkg]));
                stop.serviceTime = (stop.serviceTime || 5) + (pkg.serviceTime || 5);
            }
            stop.packageIds.push(pkg.id);
            stop.packageCount = stop.packageIds.length;
        }
        const duplicate = sameAssignment && pkg.lastScannedMissionId === mission.id;
        const outcome = duplicate ? 'already_scanned' : previous && previous.id !== mission.id ? 'reassigned' : 'confirmed';
        const movement = { action: 'SCANNED', timestamp, driverId, driverName, missionId: mission.id, missionDate: day,
            stopId: stop.id, source: data.source, outcome, recordedBy: caller.id, requestId: data.requestId,
            ...(previous && previous.id !== mission.id ? { fromMissionId: previous.id, fromMissionDate: previous.date || '', fromDriverName: previous.driverName || '' } : {}) };
        const patch = { missionId: mission.id, missionDate: day, stopId: stop.id, currentDriverId: driverId, currentVehicleId: mission.vehicleId || null,
            status: pickupVerification ? pkg.status : mission.status === 'Dispatché' ? 'Chargé' : 'En livraison',
            lastScannedAt: timestamp, lastScannedMissionId: mission.id, lastScannedBy: driverId, lastScanSource: data.source,
            firstScannedForMissionAt: pkg.lastScannedMissionId === mission.id ? pkg.firstScannedForMissionAt || timestamp : timestamp,
            movements: [...(pkg.movements || []), movement], updatedAt: timestamp };
        if (!sameAssignment)
            Object.assign(patch, { estimatedDeliveryAt: null, liveDriver: null, remainingBeforeMine: null });
        tx.update(packageSnap.ref, patch);
        if (driver.activeScanMissionId !== mission.id)
            tx.update(driverSnap.ref, { activeScanMissionId: mission.id });
        const counters = (ss, old) => ({
            totalPackages: Math.max(ss.reduce((n, s) => n + s.packageIds.length, 0), (old.deliveredPackages || 0) + (old.failedPackages || 0) +
                new Set(ss.filter(s => !finalStops.has(s.status)).flatMap(s => s.packageIds)).size),
            completedStops: ss.filter(s => s.status === 'Terminé').length, failedStops: ss.filter(s => ['Échec', 'Passé'].includes(s.status)).length,
        });
        if (previous && previous.id !== mission.id) {
            const oldStops = (previous.stops || []).map((s) => {
                const packageIds = (s.packageIds || []).filter((id) => id !== pkg.id);
                return { ...s, packageIds, packageCount: packageIds.length,
                    ...(!packageIds.length && !finalStops.has(s.status) ? { status: 'Passé', transferNotes: `Colis repris dans la tournée du ${day}` } : {}) };
            });
            tx.update(sourceSnap.ref, { stops: oldStops, ...counters(oldStops, previous), updatedAt: timestamp });
            tx.create(db.collection('package_transfers').doc(requestKey), { packageIds: [pkg.id], packageCount: 1, fromDriverId: previous.driverId || '', toDriverId: driverId,
                fromMissionId: previous.id, toMissionId: mission.id, fromMissionDate: previous.date || '', toMissionDate: day,
                status: 'Confirmé', reason: 'Reprise par scan', createdAt: timestamp, updatedAt: timestamp, createdBy: caller.id });
        }
        const missionPatch = { stops, ...counters(stops, mission), updatedAt: timestamp,
            ...(mission.type === 'Collecte' && !pickupVerification ? { type: 'Mixte' } : {}) };
        if (creating) {
            const { id, ...fields } = mission;
            tx.create(db.collection('missions').doc(id), { ...fields, ...missionPatch });
        }
        else if (!sameAssignment)
            tx.update(db.collection('missions').doc(mission.id), missionPatch);
        const message = `${duplicate ? 'Déjà scanné' : outcome === 'reassigned' ? 'Repris' : 'Scan confirmé'} — tournée du ${day.split('-').reverse().join('/')}`;
        return finish({ ...base, accepted: true, outcome, message, missionId: mission.id, missionDate: day, stopId: stop.id,
            status: patch.status, previousMissionId: previous?.id || null, previousMissionDate: previous?.date || null });
    });
    // Some Firestore transaction-expiry responses use code 3 with this wording,
    // which the SDK does not retry. Reusing the receipt ID makes the retry safe
    // even if the original commit succeeded but its acknowledgement was lost.
    for (let attempt = 0;; attempt++) {
        try {
            return await commit();
        }
        catch (error) {
            if (attempt >= 2 || error?.code !== 3 || !/Transaction is invalid or closed/i.test(String(error?.details || error?.message)))
                throw error;
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
    }
}
function terminalScanMessage(pkg) {
    const movement = Array.isArray(pkg.movements) ? [...pkg.movements].reverse().find((m) => m.action === 'DELIVERED') : null;
    if (pkg.status === 'Livré' && movement) {
        const date = new Date(movement.timestamp);
        const when = Number.isFinite(date.getTime()) ? ` le ${date.toLocaleString('fr-FR', { timeZone: 'Indian/Reunion', dateStyle: 'short', timeStyle: 'short' })}` : '';
        const by = movement.driverName ? ` par ${String(movement.driverName).slice(0, 120)}` : '';
        return `Livraison déjà enregistrée${when}${by}. Faites vérifier ce colis par le bureau si vous l’avez encore.`;
    }
    return `Colis ${pkg.status.toLowerCase()} : faites vérifier son historique par le bureau.`;
}
//# sourceMappingURL=scanPackage.js.map