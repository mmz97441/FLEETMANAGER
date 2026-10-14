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
exports.returnPackageHandler = returnPackageHandler;
exports.resolveReturnedPackageHandler = resolveReturnedPackageHandler;
const functions = __importStar(require("firebase-functions/v1"));
const scanCode_1 = require("./scanCode");
const carrierBarcode_1 = require("./carrierBarcode");
const logisticsProofMedia_1 = require("./logisticsProofMedia");
const validId = (v) => typeof v === 'string' && !!v && v.length <= 200 && !v.includes('/');
const refuse = (message) => { throw new functions.https.HttpsError('failed-precondition', message); };
function photoProof(proof, packageId) {
    if (!proof || !Array.isArray(proof.photoUrls) || !proof.photoUrls.length || proof.photoUrls.length > 5 ||
        proof.photoUrls.some((url) => !(0, logisticsProofMedia_1.validLogisticsProofMedia)(url, `pod/returns/${packageId}/`)) ||
        (proof.signatureUrl && !(0, logisticsProofMedia_1.validLogisticsProofMedia)(proof.signatureUrl, `pod/returns/${packageId}/`)))
        throw new functions.https.HttpsError('invalid-argument', 'Une preuve photographique du retour est obligatoire.');
}
/** Physical hub receipt and the subsequent office disposition are separate.
 * Replays compare an immutable operation receipt before looking at new state. */
async function returnPackageHandler(data, context, { db, requireActiveCaller, isAdminCaller }) {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role);
    const proof = data?.extra?.returnProof;
    const requestId = data?.requestId || proof?.requestId;
    if (!validId(data?.packageId) || !validId(requestId) || !validId(proof?.hubId) ||
        !(data.expectedMissionId === null || validId(data.expectedMissionId)))
        throw new functions.https.HttpsError('invalid-argument', 'Choisissez le dépôt où le colis est réellement remis.');
    photoProof(proof, data.packageId);
    const timestamp = proof.timestamp || new Date().toISOString();
    if (!Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) > Date.now() + 300000)
        throw new functions.https.HttpsError('invalid-argument', 'Heure du retour invalide.');
    return db.runTransaction(async (tx) => {
        const receiptRef = db.collection('logistics_operations').doc(`return_${requestId}`);
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
            const old = receipt.data();
            if (old.performedBy !== caller.id || old.packageId !== data.packageId || old.hubId !== proof.hubId ||
                old.expectedMissionId !== (data.expectedMissionId || null) || (proof.timestamp != null && old.timestamp !== timestamp))
                throw new functions.https.HttpsError('permission-denied', 'Cette confirmation appartient à une autre opération.');
            return { success: true, alreadyReceived: true };
        }
        const ref = db.collection('packages').doc(data.packageId);
        const snap = await tx.get(ref), hub = await tx.get(db.collection('hubs').doc(proof.hubId));
        const pkg = snap.data();
        if (!pkg)
            throw new functions.https.HttpsError('not-found', 'Colis introuvable.');
        if (!hub.exists || !hub.data()?.isActive)
            refuse('Le dépôt choisi est indisponible.');
        if (!manager && (!['chauffeur', 'chauffeuse'].includes(String(caller.role || '').toLowerCase().trim()) || pkg.currentDriverId !== caller.id))
            throw new functions.https.HttpsError('permission-denied', 'Ce colis ne vous est plus affecté. La preuve locale reste conservée.');
        if (!['À retourner', 'Échec'].includes(pkg.status))
            refuse('Ce colis n’attend pas de retour physique au dépôt.');
        if (data.expectedMissionId !== undefined && (pkg.missionId || null) !== (data.expectedMissionId || null))
            refuse('L’affectation de ce colis a changé depuis la saisie du retour.');
        const missionRef = pkg.missionId ? db.collection('missions').doc(pkg.missionId) : null;
        const missionSnap = missionRef ? await tx.get(missionRef) : null;
        const mission = missionSnap?.data();
        if (mission?.stops?.some((s) => s.proofSyncPending && (s.id === pkg.stopId || s.packageIds?.includes(snap.id))))
            refuse('Synchronisez d’abord la preuve d’échec de cet arrêt. Le retour reste conservé sur ce téléphone.');
        const receivedAt = new Date().toISOString();
        const retainedProof = {
            ...proof, requestId, packageId: snap.id, missionId: pkg.missionId || null,
            driverId: caller.id, driverName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(),
            hubId: hub.id, hubName: hub.data().name || '', timestamp, receivedAt,
        };
        if (missionRef && mission) {
            const stops = (mission.stops || []).map((s) => {
                const packageIds = (s.packageIds || []).filter((id) => id !== snap.id);
                return { ...s, packageIds, packageCount: packageIds.length };
            }).filter((s) => s.packageIds.length || ['Terminé', 'Échec', 'Passé'].includes(s.status));
            tx.update(missionRef, { stops,
                totalPackages: Math.max(Number(mission.totalPackages || 0), Number(mission.deliveredPackages || 0) + Number(mission.failedPackages || 0), (mission.stops || []).reduce((total, stop) => total + (stop.packageIds || []).length, 0)),
                updatedAt: receivedAt });
        }
        tx.update(ref, {
            status: 'Au hub', returnDisposition: 'AWAITING_DECISION', missionId: null, missionDate: null, stopId: null,
            currentDriverId: null, currentVehicleId: null, currentHubId: hub.id,
            estimatedDeliveryAt: null, liveDriver: null, remainingBeforeMine: null,
            returnProof: retainedProof,
            returnProofs: [...(Array.isArray(pkg.returnProofs) ? pkg.returnProofs : pkg.returnProof ? [pkg.returnProof] : []), retainedProof],
            movements: [...(pkg.movements || []), { timestamp, receivedAt, action: 'HUB_ARRIVAL',
                    missionId: pkg.missionId || null, stopId: pkg.stopId || null,
                    driverId: caller.id, hubId: hub.id, hubName: hub.data().name || '',
                    notes: 'Retour physique au dépôt confirmé — décision de relivraison ou de retour expéditeur attendue' }],
            updatedAt: receivedAt,
        });
        tx.create(receiptRef, { kind: 'RETURN_TO_HUB', performedBy: caller.id, packageId: snap.id, hubId: hub.id,
            expectedMissionId: data.expectedMissionId || null, timestamp, receivedAt });
        return { success: true, alreadyReceived: false };
    });
}
async function resolveReturnedPackageHandler(data, context, { db, requireActiveCaller, isAdminCaller }) {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'La décision de reprise appartient au bureau.');
    if (!validId(data?.packageId) || !validId(data?.requestId) || !['REDELIVER', 'SENDER_RETURNED'].includes(data?.decision) || !String(data?.notes || '').trim())
        throw new functions.https.HttpsError('invalid-argument', 'Précisez la décision et son motif.');
    if (data.decision === 'SENDER_RETURNED') {
        photoProof(data.proof, data.packageId);
        if (data.confirmedPhysicalHandover !== true)
            refuse('Confirmez uniquement après la remise réelle à l’expéditeur.');
    }
    if (data.requestedDeliveryDate) {
        const day = data.requestedDeliveryDate;
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today ||
            !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
            throw new functions.https.HttpsError('invalid-argument', 'La date de relivraison doit être une date valide à venir.');
    }
    return db.runTransaction(async (tx) => {
        const receiptRef = db.collection('logistics_operations').doc(`decision_${data.requestId}`);
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
            if (receipt.data()?.packageId !== data.packageId || receipt.data()?.performedBy !== caller.id || receipt.data()?.decision !== data.decision)
                refuse('Cette décision correspond à une autre opération.');
            return { success: true, alreadyResolved: true };
        }
        const ref = db.collection('packages').doc(data.packageId), snap = await tx.get(ref), pkg = snap.data();
        if (!pkg)
            throw new functions.https.HttpsError('not-found', 'Colis introuvable.');
        if (pkg.status === 'Livré' || pkg.returnDisposition === 'SENDER_RETURNED' || pkg.missionId || pkg.currentDriverId)
            refuse('Un colis remis, définitivement retourné ou encore affecté ne peut pas être réouvert ici.');
        const legacy = pkg.status === 'Retourné' && !pkg.returnDisposition;
        if (!legacy && !(pkg.status === 'Au hub' && pkg.returnDisposition === 'AWAITING_DECISION'))
            refuse('Ce colis n’attend pas de décision après retour.');
        const hubId = legacy ? data.hubId : pkg.currentHubId;
        if (!validId(hubId))
            refuse('Vérifiez le dépôt physique de ce colis avant de décider.');
        const hub = await tx.get(db.collection('hubs').doc(hubId));
        if (!hub.exists || !hub.data()?.isActive)
            refuse('Le dépôt doit être actif.');
        if (legacy && (data.confirmedPhysicalPresence !== true || typeof data.code !== 'string' || !(0, scanCode_1.parcelScanCodes)(pkg).includes((0, scanCode_1.normalizeScanCode)(data.code))))
            refuse('Ancien retour : contrôlez le code du carton et confirmez sa présence physique dans ce dépôt.');
        if (legacy)
            await (0, carrierBarcode_1.checkCarrierBarcode)(tx, db, (0, scanCode_1.normalizeScanCode)(data.code), snap.id);
        const now = new Date().toISOString();
        const redeliver = data.decision === 'REDELIVER';
        tx.update(ref, {
            status: redeliver ? 'Au hub' : 'Retourné',
            returnDisposition: redeliver ? 'REDELIVERY_READY' : 'SENDER_RETURNED',
            currentHubId: redeliver ? hubId : null, returnDecision: { decision: data.decision, by: caller.id, at: now, notes: String(data.notes).trim() },
            ...(redeliver ? { requestedDeliveryDate: data.requestedDeliveryDate || null } : { senderReturnProof: { ...data.proof, receivedAt: now, recordedBy: caller.id } }),
            movements: [...(pkg.movements || []), { timestamp: now, receivedAt: now, action: redeliver ? 'REDELIVERY_REQUESTED' : 'RETURNED',
                    recordedBy: caller.id, hubId, notes: String(data.notes).trim() }], updatedAt: now,
        });
        tx.create(receiptRef, { packageId: snap.id, performedBy: caller.id, decision: data.decision, receivedAt: now });
        return { success: true, alreadyResolved: false };
    });
}
//# sourceMappingURL=returnPackage.js.map