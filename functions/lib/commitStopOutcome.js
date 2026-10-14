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
exports.commitDeliveryOutcomeHandler = commitDeliveryOutcomeHandler;
const functions = __importStar(require("firebase-functions/v1"));
const deliveryGroup_1 = require("./deliveryGroup");
const deliveryAddress_1 = require("./deliveryAddress");
const validId = (value) => typeof value === 'string' && !!value && value.length <= 200 && !value.includes('/');
const terminal = (stop) => ['Terminé', 'Échec', 'Passé'].includes(stop.status);
const clean = (value) => {
    if (Array.isArray(value))
        return value.map(clean);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
    return value;
};
/** Commits a field decision once. The device time describes the visit, while
 * receivedAt is always generated here, including during an offline replay. */
async function commitDeliveryOutcomeHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context);
    if (!['chauffeur', 'chauffeuse'].includes(String(caller.role || '').trim().toLowerCase()))
        throw new functions.https.HttpsError('permission-denied', 'Seul le chauffeur affecté peut enregistrer cette remise.');
    const outcomes = data?.packageOutcomes;
    const receivedAt = (deps.now || (() => new Date()))().toISOString();
    const recordedAt = data?.recordedAt || data?.stopPatch?.completionTime;
    if (!validId(data?.missionId) || !validId(data?.stopId) || !Array.isArray(outcomes) || !outcomes.length || outcomes.length > 400 ||
        outcomes.some(o => !o || !validId(o.packageId) || !['Livré', 'Échec'].includes(o.status)) ||
        new Set(outcomes.map(o => o.packageId)).size !== outcomes.length ||
        typeof recordedAt !== 'string' || !Number.isFinite(Date.parse(recordedAt)) || Date.parse(recordedAt) > Date.parse(receivedAt) + 300000)
        throw new functions.https.HttpsError('invalid-argument', 'Décision, heure ou liste de colis invalide. Les preuves restent sur cet appareil.');
    const delivered = outcomes.filter(o => o.status === 'Livré').length;
    const failed = outcomes.length - delivered;
    const status = delivered ? 'Terminé' : 'Échec';
    if (data?.stopPatch?.status !== status)
        throw new functions.https.HttpsError('invalid-argument', 'Le résultat de l’arrêt ne correspond pas aux colis.');
    const coordinates = data?.stopPatch?.arrivalCoordinates;
    if (coordinates != null && (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng) || Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180))
        throw new functions.https.HttpsError('invalid-argument', 'Position de la remise invalide.');
    const refuse = (message) => { throw new functions.https.HttpsError('failed-precondition', message); };
    return deps.db.runTransaction(async (tx) => {
        const missionRef = deps.db.collection('missions').doc(data.missionId);
        const snapshot = await tx.get(missionRef);
        if (!snapshot.exists)
            refuse('Tournée introuvable.');
        const mission = snapshot.data();
        if (mission.driverId !== caller.id)
            throw new functions.https.HttpsError('permission-denied', 'Cette tournée appartient à un autre chauffeur.');
        const stops = mission.stops || [];
        const stop = stops.find(candidate => candidate.id === data.stopId);
        if (!stop || stop.type !== 'DELIVERY')
            refuse('Cet arrêt de livraison a été déplacé ou supprimé.');
        const decisionIds = terminal(stop) ? stop.outcomePackageIds || stop.packageIds || [] : stop.packageIds || [];
        if (outcomes.length !== decisionIds.length || decisionIds.some((id) => !outcomes.some(o => o.packageId === id)))
            refuse('La liste des colis a changé. Vérifiez tous les colis avant de valider.');
        const parcels = await Promise.all(outcomes.map(o => tx.get(deps.db.collection('packages').doc(o.packageId))));
        const proofId = `${data.missionId}_${data.stopId}`;
        // Idempotency checks include each parcel result. Two different offline
        // intentions cannot silently accept each other's already completed stop.
        if (terminal(stop)) {
            if (stop.status !== status || parcels.some((snap, i) => {
                const pkg = snap.data();
                const attempt = pkg?.deliveryAttempts?.find((a) => a.id === proofId);
                return !pkg || (attempt ? attempt.outcome !== (outcomes[i].status === 'Livré' ? 'SUCCESS' : 'FAILURE')
                    : pkg.missionId !== data.missionId || pkg.stopId !== data.stopId || pkg.status !== outcomes[i].status);
            }))
                refuse('Une autre décision est déjà enregistrée pour cet arrêt. Faites vérifier les preuves par le bureau.');
            return { allDone: stops.every(terminal), stops };
        }
        if (!['En cours', 'Dispatché'].includes(mission.status))
            refuse('Cette tournée est clôturée ou annulée.');
        if (stop.proofSyncPending)
            refuse('Une preuve est déjà en attente pour cet arrêt.');
        if (mission.date && recordedAt.slice(0, 10) < `${mission.date}` && Date.parse(recordedAt) < Date.parse(`${mission.date}T00:00:00+04:00`))
            refuse('L’heure de remise précède le jour de la tournée. Vérifiez l’horloge du téléphone.');
        for (const [index, snap] of parcels.entries()) {
            const pkg = snap.data();
            if (!pkg || pkg.missionId !== data.missionId || pkg.stopId !== data.stopId || pkg.currentDriverId !== caller.id ||
                !['En livraison', 'Chargé', 'En transit'].includes(pkg.status))
                refuse('Un colis a été transféré, retourné ou déjà traité. Actualisez la tournée.');
            if (!(0, deliveryGroup_1.sameDeliveryRecipient)(stop, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, pkg))
                refuse('Un colis ne correspond pas au destinataire ou au créneau de cet arrêt. Faites vérifier son affectation.');
            const outcome = outcomes[index];
            if (outcome.status === 'Échec' && (!String(outcome.failureReason || '').trim() || String(outcome.failureReason).length > 200))
                refuse('Le motif d’échec est obligatoire pour chaque colis non remis.');
            if (String(outcome.failureNotes || '').length > 3000 || String(outcome.movement?.notes || '').length > 3000)
                refuse('Le commentaire de remise est trop long.');
        }
        const nextStops = stops.map(candidate => candidate.id === stop.id ? clean({ ...candidate,
            status, completionTime: recordedAt, outcomeReceivedAt: receivedAt, outcomePackageIds: [...stop.packageIds], proofSyncPending: true,
            ...(coordinates ? { arrivalCoordinates: { lat: coordinates.lat, lng: coordinates.lng } } : {}),
        }) : candidate);
        for (const [index, snap] of parcels.entries()) {
            const pkg = snap.data(), outcome = outcomes[index], success = outcome.status === 'Livré';
            const reason = success ? undefined : String(outcome.failureReason).trim();
            const notes = success ? undefined : String(outcome.failureNotes || '').trim();
            const promise = /^\d{4}-\d{2}-\d{2}$/.test(pkg.requestedDeliveryDate || '')
                ? `${pkg.requestedDeliveryDate}T${/^\d{2}:\d{2}$/.test(pkg.timeWindowEnd || '') ? `${pkg.timeWindowEnd}:00` : '23:59:59.999'}+04:00` : null;
            const attempt = clean({ id: proofId, proofId, missionId: data.missionId, stopId: data.stopId,
                driverId: caller.id, outcome: success ? 'SUCCESS' : 'FAILURE', recordedAt, receivedAt,
                destination: { contactName: stop.contactName || '', address: stop.address || '', city: stop.city || '', postalCode: stop.postalCode || '',
                    floor: stop.floor, timeWindowStart: stop.timeWindowStart, timeWindowEnd: stop.timeWindowEnd },
                promisedDeliveryAt: promise && Number.isFinite(Date.parse(promise)) ? promise : null,
                estimatedDeliveryAt: Number.isFinite(Date.parse(pkg.estimatedDeliveryAt || '')) ? pkg.estimatedDeliveryAt : null,
                failureReason: reason, failureNotes: notes });
            const movement = clean({ action: success ? 'DELIVERED' : 'FAILED', timestamp: recordedAt, receivedAt,
                proofId, missionId: data.missionId, stopId: data.stopId, driverId: caller.id,
                driverName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), vehicleId: mission.vehicleId,
                vehiclePlate: mission.vehiclePlate, failureReason: reason, notes: String(outcome.movement?.notes || '').slice(0, 3000) });
            tx.update(snap.ref, clean({ status: outcome.status, movements: [...(pkg.movements || []), movement],
                deliveryAttempts: [...(pkg.deliveryAttempts || []), attempt],
                ...(!success ? { failureReason: reason, failureNotes: notes } : {}),
                outcomeRecordedAt: recordedAt, outcomeReceivedAt: receivedAt, updatedAt: receivedAt }));
        }
        tx.update(missionRef, { stops: nextStops,
            completedStops: nextStops.filter(s => s.status === 'Terminé').length,
            failedStops: nextStops.filter(s => ['Échec', 'Passé'].includes(s.status)).length,
            totalPackages: Math.max(mission.totalPackages || 0, nextStops.reduce((sum, s) => sum + (s.packageIds?.length || 0), 0)),
            deliveredPackages: (mission.deliveredPackages || 0) + delivered,
            failedPackages: (mission.failedPackages || 0) + failed,
            status: 'En cours', updatedAt: receivedAt,
        });
        return { allDone: nextStops.every(terminal), stops: nextStops };
    });
}
//# sourceMappingURL=commitStopOutcome.js.map