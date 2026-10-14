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
exports.reconcileDeliveryProofsHandler = reconcileDeliveryProofsHandler;
const functions = __importStar(require("firebase-functions/v1"));
const deliveryGroup_1 = require("./deliveryGroup");
const deliveryAddress_1 = require("./deliveryAddress");
const statuses = { PENDING: 'En attente', COLLECTED: 'Collecté', AT_HUB: 'Au hub', SORTED: 'Trié', IN_TRANSIT: 'En transit', LOADED: 'Chargé', IN_DELIVERY: 'En livraison', DELIVERED: 'Livré' };
const cleanUndefined = (value) => {
    if (Array.isArray(value))
        return value.map(cleanUndefined);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, cleanUndefined(v)]));
    return value;
};
/** Office-only reconciliation never treats a completed stop as delivery evidence. */
async function reconcileDeliveryProofsHandler(_data, context, deps) {
    const caller = await deps.requireActiveCaller(context);
    if (!deps.isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Rapprochement réservé au bureau.');
    const { db } = deps;
    const result = {
        completedStopPackages: 0, fixedDelivered: 0, skippedUnproven: 0,
        skippedReassigned: 0, failed: 0, details: [],
    };
    const activeStatuses = new Set([
        statuses.PENDING, statuses.COLLECTED, statuses.AT_HUB,
        statuses.SORTED, statuses.IN_TRANSIT, statuses.LOADED,
        statuses.IN_DELIVERY,
    ]);
    const completedIds = new Set();
    const unprovenIds = new Set();
    const reassignedIds = new Set();
    const fixedIds = new Set();
    const missions = await db.collection('missions').get();
    for (const candidate of missions.docs) {
        if (!(candidate.data().stops || []).some((s) => s.type === 'DELIVERY' && s.status === 'Terminé'))
            continue;
        try {
            const checked = await db.runTransaction(async (tx) => {
                const missionRef = db.collection('missions').doc(candidate.id);
                const snapshot = await tx.get(missionRef);
                const outcome = { seen: [], unproven: [], reassigned: [], details: [] };
                if (!snapshot.exists)
                    return outcome;
                const mission = snapshot.data();
                const stops = (mission.stops || []).filter((s) => s.type === 'DELIVERY' && s.status === 'Terminé');
                if (!stops.length)
                    return outcome;
                const ids = [...new Set(mission.stops.flatMap((s) => s.packageIds || []))];
                // Leave oversized/inconsistent historical tours for an explicit audit.
                if (ids.length > 450 || ids.some(id => !id || id.includes('/')) || stops.some(s => !s.id || s.id.includes('/'))) {
                    throw new Error('Cette ancienne tournée doit être vérifiée individuellement par le bureau.');
                }
                const packages = await Promise.all(ids.map(id => tx.get(db.collection('packages').doc(id))));
                const proofs = await Promise.all(stops.map(stop => tx.get(db.collection('proofs_of_delivery').doc(`${candidate.id}_${stop.id}`))));
                const byId = new Map(packages.filter(p => p.exists).map(p => [p.id, p]));
                const repairs = new Map();
                const validatedProofs = new Map();
                const https = (value) => typeof value === 'string' && value.startsWith('https://');
                for (let index = 0; index < stops.length; index++) {
                    const stop = stops[index];
                    const proof = proofs[index].data();
                    const validProof = proof?.type === 'SUCCESS' && proof.missionId === candidate.id && proof.stopId === stop.id &&
                        !!mission.driverId && proof.driverId === mission.driverId && Array.isArray(proof.packageIds) &&
                        Array.isArray(proof.photoUrls) && proof.photoUrls.length > 0 && proof.photoUrls.every(https) && https(proof.signatureUrl) &&
                        typeof proof.recipientName === 'string' && !!proof.recipientName.trim() &&
                        Number.isFinite(proof.coordinates?.lat) && Math.abs(proof.coordinates.lat) <= 90 &&
                        Number.isFinite(proof.coordinates?.lng) && Math.abs(proof.coordinates.lng) <= 180 &&
                        typeof proof.timestamp === 'string' && Number.isFinite(Date.parse(proof.timestamp));
                    if (validProof)
                        validatedProofs.set(stop.id, proof);
                    for (const id of stop.packageIds || []) {
                        const parcel = byId.get(id);
                        if (!parcel)
                            continue;
                        outcome.seen.push(id);
                        const pkg = parcel.data();
                        // Delivered, failed and return decisions are never rewritten.
                        if (!activeStatuses.has(pkg.status))
                            continue;
                        if (pkg.missionId !== candidate.id || pkg.stopId !== stop.id || pkg.currentDriverId !== mission.driverId ||
                            !(0, deliveryGroup_1.sameDeliveryRecipient)(stop, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, pkg) ||
                            (proof?.destination && (!(0, deliveryGroup_1.sameDeliveryRecipient)(proof.destination, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(proof.destination, pkg))) ||
                            (pkg.pod && (pkg.pod.missionId !== candidate.id || pkg.pod.stopId !== stop.id || pkg.pod.packageId !== id))) {
                            outcome.reassigned.push(id);
                            continue;
                        }
                        if (!validProof || !proof.packageIds.includes(id)) {
                            outcome.unproven.push(id);
                            continue;
                        }
                        repairs.set(id, { parcel, pkg, proof: proof });
                    }
                }
                // Clear only a stale synchronization guard whose already published
                // proof covers every decision. Missing media or an inconsistent partial
                // outcome must remain blocked for review on the original device.
                const synced = new Set(stops.filter(stop => {
                    const proof = validatedProofs.get(stop.id);
                    return stop.proofSyncPending && proof && stop.packageIds.length && stop.packageIds.every((id) => {
                        const pkg = byId.get(id)?.data();
                        if (!pkg || pkg.missionId !== candidate.id || pkg.stopId !== stop.id || pkg.currentDriverId !== mission.driverId ||
                            !(0, deliveryGroup_1.sameDeliveryRecipient)(stop, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(stop, pkg) ||
                            (proof.destination && (!(0, deliveryGroup_1.sameDeliveryRecipient)(proof.destination, pkg) || !(0, deliveryAddress_1.visitContainsParcelWindow)(proof.destination, pkg))))
                            return false;
                        if (proof.packageIds.includes(id))
                            return repairs.has(id) || (pkg.status === 'Livré' &&
                                pkg.pod?.missionId === candidate.id && pkg.pod?.stopId === stop.id && pkg.pod?.packageId === id &&
                                pkg.pod?.type !== 'FAILURE' && pkg.pod?.signatureUrl === proof.signatureUrl &&
                                pkg.pod?.timestamp === proof.timestamp);
                        return pkg.status === 'Échec' && pkg.failurePod?.missionId === candidate.id && pkg.failurePod?.stopId === stop.id &&
                            pkg.failurePod?.packageId === id && pkg.failurePod?.type === 'FAILURE' && pkg.failurePod?.timestamp === proof.timestamp;
                    });
                }).map(stop => stop.id));
                if (!repairs.size && !synced.size)
                    return outcome;
                const now = new Date().toISOString();
                for (const [id, { parcel, pkg, proof }] of repairs) {
                    const { packageIds: _privateIds, ...publicProof } = proof;
                    const proofId = `${candidate.id}_${proof.stopId}`;
                    const previous = (pkg.deliveryAttempts || []).find((attempt) => attempt.id === proofId);
                    const projection = { ...publicProof, destination: previous?.destination || proof.destination, packageId: id, proofId };
                    const attempt = cleanUndefined({ ...previous, id: proofId, proofId, missionId: candidate.id, stopId: proof.stopId,
                        driverId: proof.driverId, outcome: 'SUCCESS', recordedAt: previous?.recordedAt || proof.timestamp,
                        destination: previous?.destination || proof.destination,
                        receivedAt: previous?.receivedAt || now, proof: projection });
                    tx.update(parcel.ref, cleanUndefined({
                        status: statuses.DELIVERED,
                        pod: projection,
                        deliveryAttempts: previous ? pkg.deliveryAttempts.map((item) => item.id === proofId ? attempt : item) : [...(pkg.deliveryAttempts || []), attempt],
                        movements: [...(pkg.movements || []), {
                                timestamp: proof.timestamp, receivedAt: now, action: 'DELIVERED', driverId: proof.driverId,
                                proofId, missionId: candidate.id, stopId: proof.stopId,
                                driverName: proof.driverName || mission.driverName || '',
                                notes: `Statut rétabli à partir de la preuve de remise du ${proof.timestamp}`,
                            }], updatedAt: now,
                    }));
                    outcome.details.push({ packageId: id, orderNumber: pkg.orderNumber || pkg.externalId || id, from: String(pkg.status) });
                }
                // Count the latest parcels for this mission; a concurrent transaction
                // changes the read mission/parcels and triggers a complete retry.
                const deliveredStopIds = new Set(stops.flatMap(stop => stop.packageIds || []));
                const deliveredPackages = packages.filter(parcel => {
                    if (!parcel.exists)
                        return false;
                    const pkg = parcel.data();
                    const belongs = deliveredStopIds.has(parcel.id) && (!pkg.missionId || pkg.missionId === candidate.id) &&
                        (!pkg.currentDriverId || pkg.currentDriverId === mission.driverId);
                    return belongs && (pkg.status === statuses.DELIVERED || repairs.has(parcel.id));
                }).length;
                tx.update(missionRef, { deliveredPackages, updatedAt: now,
                    ...(synced.size ? { stops: mission.stops.map((stop) => synced.has(stop.id) ? { ...stop, proofSyncPending: false } : stop) } : {}),
                });
                return outcome;
            });
            checked.seen.forEach(id => completedIds.add(id));
            checked.unproven.forEach(id => unprovenIds.add(id));
            checked.reassigned.forEach(id => reassignedIds.add(id));
            for (const detail of checked.details) {
                if (!fixedIds.has(detail.packageId))
                    result.details.push(detail);
                fixedIds.add(detail.packageId);
            }
        }
        catch (error) {
            result.failed++;
            functions.logger.warn('Delivery proof reconciliation refused', { missionId: candidate.id, reason: error instanceof Error ? error.message : String(error) });
        }
    }
    result.completedStopPackages = completedIds.size;
    result.fixedDelivered = fixedIds.size;
    result.skippedUnproven = [...unprovenIds].filter(id => !fixedIds.has(id)).length;
    result.skippedReassigned = [...reassignedIds].filter(id => !fixedIds.has(id)).length;
    return result;
}
//# sourceMappingURL=reconcileDeliveryProofs.js.map