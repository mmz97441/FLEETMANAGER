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
exports.prepareDeliveryStopHandler = prepareDeliveryStopHandler;
const functions = __importStar(require("firebase-functions/v1"));
const deliveryGroup_1 = require("./deliveryGroup");
const scanPackage_1 = require("./scanPackage");
const validId = (id) => typeof id === 'string' && !!id && id.length <= 200 && !id.includes('/');
async function prepareDeliveryStopHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context);
    if (!['chauffeur', 'chauffeuse'].includes(String(caller.role).trim().toLowerCase()))
        throw new functions.https.HttpsError('permission-denied', 'Préparation réservée au chauffeur de la tournée.');
    const extraIds = data?.packageIds || [];
    if (!validId(data?.missionId) || !validId(data?.stopId) || !Array.isArray(extraIds) || extraIds.length > 200 ||
        extraIds.some(id => !validId(id)) || (data.arrive != null && typeof data.arrive !== 'boolean'))
        throw new functions.https.HttpsError('invalid-argument', 'Arrêt ou liste de colis invalide.');
    const { db } = deps;
    const now = (deps.now || (() => new Date()))(), timestamp = now.toISOString();
    const refuse = (message) => { throw new functions.https.HttpsError('failed-precondition', message); };
    return db.runTransaction(async (tx) => {
        const ref = db.collection('missions').doc(data.missionId), snap = await tx.get(ref);
        if (!snap.exists)
            refuse('Tournée introuvable.');
        const mission = snap.data();
        if (mission.driverId !== caller.id)
            throw new functions.https.HttpsError('permission-denied', 'Cette tournée appartient à un autre chauffeur.');
        if (mission.date !== (0, scanPackage_1.scanBusinessDay)(now) || !['En cours', 'Dispatché'].includes(mission.status))
            refuse('Rouvrez une tournée du jour encore ouverte.');
        const stops = mission.stops || [], target = stops.find(s => s.id === data.stopId);
        if (!target || target.type !== 'DELIVERY' || !['En attente', 'Arrivé'].includes(target.status) || target.proofSyncPending)
            refuse('Cet arrêt est terminé ou possède une preuve en attente. Synchronisez la livraison.');
        const group = (0, deliveryGroup_1.deliveryStopGroup)(stops, target);
        const ids = [...new Set([...group.flatMap(s => s.packageIds || []), ...extraIds])];
        if (ids.length > 400 || ids.some(id => !validId(id)))
            refuse('Trop de colis ou références invalides : faites vérifier cet arrêt par le bureau.');
        const parcels = await Promise.all(ids.map(id => tx.get(db.collection('packages').doc(id))));
        const targetIds = new Set(target.packageIds || []);
        const incoming = new Set(ids.filter(id => !targetIds.has(id)));
        const affected = stops.filter(s => s.id === target.id || s.packageIds?.some((id) => incoming.has(id)) || group.some(g => g.id === s.id));
        const proofSnaps = await Promise.all(affected.map(s => tx.get(db.collection('proofs_of_delivery').doc(`${ref.id}_${s.id}`))));
        if (proofSnaps.some(p => p.exists) || affected.some(s => s.proofSyncPending ||
            (s.id !== target.id && !group.some(g => g.id === s.id))))
            refuse('Une remise a déjà commencé sur un autre arrêt. Terminez ou faites vérifier cette livraison avant de regrouper.');
        for (const parcel of parcels) {
            const p = parcel.data();
            if (!p || ['Livré', 'Retourné', 'À retourner', 'Échec'].includes(p.status) || p.pod ||
                (p.currentDriverId && p.currentDriverId !== caller.id) || (p.missionId && p.missionId !== ref.id))
                refuse('Un colis a été livré, transféré ou retourné. Actualisez la tournée.');
            if (incoming.has(parcel.id) && !(0, deliveryGroup_1.sameDeliveryRecipient)(target, p))
                refuse('Un colis correspond à un autre destinataire ou à une autre adresse. Faites vérifier son affectation par le bureau.');
            const owners = stops.filter(s => s.packageIds?.includes(parcel.id));
            if (owners.some(s => !affected.includes(s)) || (p.stopId && !owners.some(s => s.id === p.stopId)) ||
                (p.missionId === ref.id && !owners.length))
                refuse('L’affectation d’un colis a changé. Actualisez la tournée.');
        }
        const notes = [...new Set(affected.map(s => s.notes).filter(Boolean))].join('\n');
        const groupIds = new Set(group.map(s => s.id));
        const merged = { ...target, packageIds: ids, packageCount: ids.length,
            ...(group.length > 1 ? { serviceTime: group.reduce((sum, s) => sum + (s.serviceTime || 0), 0) || target.serviceTime || 5 } : {}),
            ...(notes ? { notes } : {}),
            ...(data.arrive && target.status === 'En attente' ? { status: 'Arrivé', arrivalTime: timestamp } : {}) };
        const next = stops.flatMap(s => {
            if (s.id === target.id)
                return [merged];
            if (!affected.includes(s))
                return [s];
            const packageIds = s.packageIds.filter((id) => !ids.includes(id));
            return packageIds.length ? [{ ...s, packageIds, packageCount: packageIds.length }] : [];
        }).sort((a, b) => a.sequence - b.sequence).map((s, index) => ({ ...s, sequence: index + 1 }));
        const allIds = next.flatMap(s => s.packageIds || []);
        if (new Set(allIds).size !== allIds.length)
            refuse('Un colis figure dans plusieurs arrêts. Faites vérifier la tournée par le bureau.');
        const changed = incoming.size > 0 || groupIds.size > 1 || (data.arrive && target.status === 'En attente');
        if (!changed)
            return { mission: { ...mission, id: ref.id }, addedCount: 0 };
        const updates = { stops: next, totalPackages: allIds.length, status: 'En cours', updatedAt: timestamp };
        tx.update(ref, updates);
        for (const parcel of parcels) {
            const p = parcel.data();
            if (!incoming.has(parcel.id) && p.stopId === target.id)
                continue;
            tx.update(parcel.ref, { missionId: ref.id, stopId: target.id, currentDriverId: caller.id,
                ...(mission.vehicleId ? { currentVehicleId: mission.vehicleId } : {}),
                status: 'En livraison', updatedAt: timestamp,
                movements: [...(p.movements || []), { action: 'OUT_FOR_DELIVERY', timestamp, driverId: caller.id,
                        driverName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), notes: `Réuni à l’arrêt ${target.id} pour une remise commune.` }] });
        }
        tx.create(db.collection('activity_logs').doc(), { userId: caller.id, userName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(),
            userRole: caller.role, action: 'DELIVERY_STOP_PREPARED', category: 'Livraison', outcome: 'success',
            targetType: 'mission', targetId: ref.id, targetName: target.contactName || target.address,
            description: `${ids.length} colis préparés pour une remise commune.`,
            details: { metadata: { stopId: target.id, packageIds: ids, previousStopIds: affected.map(s => s.id), addedCount: incoming.size } }, createdAt: timestamp });
        return { mission: { ...mission, ...updates, id: ref.id }, addedCount: incoming.size };
    });
}
//# sourceMappingURL=prepareDeliveryStop.js.map