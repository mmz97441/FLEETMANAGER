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
exports.receiveTransferredPackageAtHubHandler = receiveTransferredPackageAtHubHandler;
exports.receivePackagesAtHubHandler = receivePackagesAtHubHandler;
const functions = __importStar(require("firebase-functions/v1"));
const scanCode_1 = require("./scanCode");
const carrierBarcode_1 = require("./carrierBarcode");
/** Destination staff acknowledge a physical transfer; this never moves a
 * parcel still carried by a driver or waiting for a return decision. */
async function receiveTransferredPackageAtHubHandler(data, context, { db, requireActiveCaller, isAdminCaller }) {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Réception inter-dépôts réservée au bureau.');
    if (!validId(data?.packageId) || !validId(data?.hubId) || typeof data.code !== 'string' ||
        data.confirmedPhysicalReception !== true || !String(data.reason || '').trim())
        throw new functions.https.HttpsError('invalid-argument', 'Scannez le carton au dépôt de destination et indiquez le motif du transfert.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('packages').doc(data.packageId), snap = await tx.get(ref);
        const hub = await tx.get(db.collection('hubs').doc(data.hubId)), pkg = snap.data();
        if (!pkg || !hub.exists || !hub.data()?.isActive)
            refuse('Colis ou dépôt de destination indisponible.');
        if (!['Au hub', 'Trié'].includes(pkg.status) || pkg.missionId || pkg.stopId || pkg.currentDriverId || pkg.currentVehicleId ||
            pkg.returnDisposition === 'AWAITING_DECISION' || pkg.returnDisposition === 'SENDER_RETURNED')
            refuse('Ce colis n’est pas disponible pour une réception inter-dépôts.');
        if (!validId(pkg.currentHubId))
            refuse('Le dépôt de départ du colis doit être vérifié.');
        const code = (0, scanCode_1.normalizeScanCode)(data.code);
        if (!(0, scanCode_1.parcelScanCodes)(pkg).includes(code))
            refuse('Ce code ne correspond pas au carton choisi.');
        await (0, carrierBarcode_1.checkCarrierBarcode)(tx, db, code, snap.id);
        if (pkg.currentHubId === hub.id)
            return { success: true, alreadyReceived: true };
        const source = await tx.get(db.collection('hubs').doc(pkg.currentHubId));
        if (!source.exists)
            refuse('Le dépôt de départ est introuvable.');
        const now = new Date().toISOString();
        tx.update(ref, { status: 'Au hub', currentHubId: hub.id, updatedAt: now,
            hubReceivedBy: caller.id, hubReceivedAt: now,
            movements: [...(pkg.movements || []), { action: 'HUB_TRANSFER', timestamp: now, receivedAt: now,
                    recordedBy: caller.id, fromHubId: source.id, fromHubName: source.data()?.name || '',
                    hubId: hub.id, hubName: hub.data()?.name || '', notes: String(data.reason).trim() }] });
        tx.create(db.collection('audit_logs').doc(), { action: 'HUB_TRANSFER_RECEIVED', performedBy: caller.id,
            performedAt: now, packageId: snap.id, fromHubId: source.id, hubId: hub.id });
        return { success: true, alreadyReceived: false };
    });
}
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/');
const refuse = (message) => { throw new functions.https.HttpsError('failed-precondition', message); };
/** Reception atomically releases a completed pickup's operational assignment.
 * The immutable pickup manifest and historical mission counters remain intact. */
async function receivePackagesAtHubHandler(data, context, { db, requireActiveCaller, isAdminCaller }) {
    const caller = await requireActiveCaller(context);
    const manager = isAdminCaller(caller.role);
    const driver = ['chauffeur', 'chauffeuse'].includes(String(caller.role || '').toLowerCase().trim());
    if (!manager && !driver)
        throw new functions.https.HttpsError('permission-denied', 'Réception réservée à l’exploitation et aux chauffeurs affectés.');
    if (!validId(data?.hubId) || !Array.isArray(data?.packageIds) || !data.packageIds.length || data.packageIds.length > 150 || data.packageIds.some((id) => !validId(id)))
        throw new functions.https.HttpsError('invalid-argument', 'Sélectionnez un hub et 1 à 150 colis.');
    const ids = [...new Set(data.packageIds)];
    return db.runTransaction(async (tx) => {
        const hubSnap = await tx.get(db.collection('hubs').doc(data.hubId));
        if (!hubSnap.exists || !hubSnap.data()?.isActive)
            refuse('Le hub sélectionné est indisponible.');
        const packageSnaps = await Promise.all(ids.map(id => tx.get(db.collection('packages').doc(id))));
        if (packageSnaps.some(snap => !snap.exists))
            refuse('Un colis est introuvable. Aucun colis de ce lot n’a été réceptionné.');
        const missionIds = [...new Set(packageSnaps.map(snap => snap.data()?.missionId).filter(Boolean))];
        if (missionIds.some(id => !validId(id)))
            refuse('Une affectation de colis est invalide. Faites-la vérifier par le bureau.');
        const missionSnaps = await Promise.all(missionIds.map(id => tx.get(db.collection('missions').doc(id))));
        const missions = new Map(missionSnaps.map(snap => [snap.id, snap]));
        const pickupKeys = new Set();
        for (const snap of packageSnaps) {
            const pkg = snap.data();
            const legacyLocation = manager && ['Au hub', 'Trié'].includes(pkg.status) && !pkg.currentHubId && !pkg.missionId && !pkg.stopId && !pkg.currentDriverId && !pkg.currentVehicleId;
            if (!['En attente', 'Collecté', 'Au hub'].includes(pkg.status) && !legacyLocation)
                refuse(`Le colis ${snap.id} ne peut pas être réceptionné depuis le statut ${pkg.status}.`);
            if (pkg.pickupMissing && pkg.status === 'En attente')
                refuse('Ce colis a été déclaré manquant à l’enlèvement. Replanifiez et confirmez sa collecte avant la réception au dépôt.');
            const alreadyReceived = pkg.status === 'Au hub' && pkg.currentHubId === data.hubId && !pkg.missionId && !pkg.stopId && !pkg.currentDriverId && !pkg.currentVehicleId;
            if (!manager && pkg.currentDriverId !== caller.id && !(alreadyReceived && pkg.hubReceivedBy === caller.id))
                throw new functions.https.HttpsError('permission-denied', 'Un colis de ce lot ne vous est pas affecté.');
            if (pkg.missionId) {
                const mission = missions.get(pkg.missionId)?.data();
                const stop = mission?.stops?.find((s) => s.id === pkg.stopId && s.packageIds?.includes(snap.id));
                if (!mission || !stop || stop.type !== 'PICKUP' || stop.status !== 'Terminé')
                    refuse('Terminez l’enlèvement et synchronisez son manifeste avant de réceptionner ses colis au hub.');
                if (stop.proofSyncPending === true)
                    refuse('Synchronisez la preuve de cet arrêt avant de déplacer ce colis.');
                if (!manager && mission.driverId !== caller.id)
                    throw new functions.https.HttpsError('permission-denied', 'Cet enlèvement ne vous est pas affecté.');
                pickupKeys.add(`${pkg.missionId}_${stop.id}`);
            }
            else if (pkg.stopId)
                refuse('Un colis conserve un arrêt sans tournée. Faites vérifier son affectation par le bureau.');
            if (pkg.status === 'Au hub' && pkg.currentHubId && !pkg.missionId && !pkg.stopId && !pkg.currentDriverId && !pkg.currentVehicleId && pkg.currentHubId !== data.hubId)
                refuse('Ce colis est déjà réceptionné dans un autre hub. Vérifiez le hub sélectionné.');
        }
        const pickupSnaps = await Promise.all([...pickupKeys].map(key => tx.get(db.collection('pickups').doc(key))));
        const pickups = new Map(pickupSnaps.map(snap => [snap.id, snap.data()]));
        const received = [], alreadyReceived = [];
        const now = new Date().toISOString();
        for (const snap of packageSnaps) {
            const pkg = snap.data();
            if (pkg.missionId) {
                const manifest = pickups.get(`${pkg.missionId}_${pkg.stopId}`);
                const mission = missions.get(pkg.missionId).data();
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
                        action: 'HUB_ARRIVAL', timestamp: now, hubId: data.hubId, hubName: hubSnap.data().name || '',
                        recordedBy: caller.id, driverId: pkg.currentDriverId || caller.id,
                        notes: `Réceptionné au ${hubSnap.data().name || 'hub'}${!pkg.currentHubId && ['Au hub', 'Trié'].includes(pkg.status) ? ' — ancien emplacement inconnu, présence physique vérifiée' : ''}`,
                    }],
            });
        }
        const receivedSet = new Set(received);
        for (const snap of missionSnaps) {
            const mission = snap.data();
            const previousStops = mission.stops || [];
            const stops = previousStops.map(stop => {
                const packageIds = (stop.packageIds || []).filter((id) => !receivedSet.has(id));
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
//# sourceMappingURL=hubReception.js.map