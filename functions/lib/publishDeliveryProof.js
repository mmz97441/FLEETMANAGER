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
exports.publishDeliveryProofHandler = publishDeliveryProofHandler;
const functions = __importStar(require("firebase-functions/v1"));
const clean = (value) => {
    if (Array.isArray(value))
        return value.map(clean);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
    return value;
};
const validId = (value) => typeof value === 'string' && !!value && value.length <= 200 && !value.includes('/');
const validCoordinates = (value) => value && Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
/** Immutable shared proof and strictly per-parcel client projections are
 * published atomically. Drivers cannot edit historical attempts directly. */
async function publishDeliveryProofHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context);
    if (!['chauffeur', 'chauffeuse'].includes(String(caller.role || '').trim().toLowerCase()))
        throw new functions.https.HttpsError('permission-denied', 'Publication réservée au chauffeur de la tournée.');
    if (!validId(data?.missionId) || !validId(data?.stopId) || !Array.isArray(data?.packageIds) || !data.packageIds.length || data.packageIds.length > 400 ||
        data.packageIds.some((id) => !validId(id)) || new Set(data.packageIds).size !== data.packageIds.length || !['SUCCESS', 'FAILURE'].includes(data.type))
        throw new functions.https.HttpsError('invalid-argument', 'Preuve ou liste de colis invalide.');
    const receivedAt = (deps.now || (() => new Date()))().toISOString();
    const refuse = (message) => { throw new functions.https.HttpsError('failed-precondition', message); };
    return deps.db.runTransaction(async (tx) => {
        const proofId = `${data.missionId}_${data.stopId}`;
        const proofRef = deps.db.collection('proofs_of_delivery').doc(proofId);
        const missionRef = deps.db.collection('missions').doc(data.missionId);
        const [existing, missionSnap] = await Promise.all([tx.get(proofRef), tx.get(missionRef)]);
        const mission = missionSnap.data();
        if (!mission || mission.driverId !== caller.id)
            throw new functions.https.HttpsError('permission-denied', 'Cette tournée ne vous est pas affectée.');
        const stops = mission.stops || [];
        const stop = stops.find(s => s.id === data.stopId);
        if (!stop || stop.type !== 'DELIVERY')
            refuse('Cet arrêt a changé. Les preuves restent conservées sur cet appareil.');
        const previous = existing.data();
        if (previous && (previous.driverId !== caller.id || previous.missionId !== data.missionId || previous.stopId !== data.stopId ||
            previous.type !== data.type || JSON.stringify([...(previous.packageIds || [])].sort()) !== JSON.stringify([...data.packageIds].sort())))
            refuse('Une autre preuve existe pour cet arrêt. Faites vérifier les preuves par le bureau.');
        if (previous && !stop.proofSyncPending)
            return { proof: previous };
        if (stop.status !== (data.type === 'SUCCESS' ? 'Terminé' : 'Échec') ||
            data.packageIds.some((id) => !stop.packageIds.includes(id)) ||
            data.type === 'FAILURE' && data.packageIds.length !== stop.packageIds.length)
            refuse('La preuve ne correspond pas à la décision de cet arrêt.');
        const parcels = await Promise.all(stop.packageIds.map((id) => tx.get(deps.db.collection('packages').doc(id))));
        for (const [index, snap] of parcels.entries()) {
            const pkg = snap.data(), success = data.type === 'SUCCESS' && data.packageIds.includes(stop.packageIds[index]);
            if (!pkg || pkg.missionId !== data.missionId || pkg.stopId !== data.stopId || pkg.currentDriverId !== caller.id ||
                pkg.status !== (success ? 'Livré' : 'Échec'))
                refuse('Un colis a été transféré ou retraité. Les preuves restent conservées sur cet appareil.');
        }
        // Storage upload rules already restrict this directory to the mission driver.
        // Prevent links to another visit or arbitrary external images from becoming evidence.
        const validMedia = (value) => {
            if (typeof value !== 'string' || value.length > 4000)
                return false;
            try {
                const url = new URL(value);
                const emulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST && ['127.0.0.1', 'localhost'].includes(url.hostname);
                if (!emulator && (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'))
                    return false;
                const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
                const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
                if (!match || !project || ![`${project}.appspot.com`, `${project}.firebasestorage.app`].includes(match[1]))
                    return false;
                return decodeURIComponent(match[2]).startsWith(`pod/${data.missionId}/${data.stopId}/`);
            }
            catch {
                return false;
            }
        };
        let saved = previous;
        if (!saved) {
            if (!Array.isArray(data.photoUrls) || !data.photoUrls.length || data.photoUrls.length > 20 || data.photoUrls.some((url) => !validMedia(url)))
                refuse('Les photos de preuve de cet arrêt sont absentes ou invalides.');
            const timestamp = stop.completionTime;
            if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)))
                refuse('L’heure terrain de cette tentative est absente. Contactez le bureau.');
            if (data.timestamp && Date.parse(data.timestamp) !== Date.parse(timestamp))
                refuse('L’heure de la preuve ne correspond pas à la décision de remise.');
            if (data.type === 'SUCCESS' && (!validMedia(data.signatureUrl) || !String(data.recipientName || '').trim() || !validCoordinates(data.coordinates)))
                refuse('La preuve de remise doit comporter la signature, le réceptionnaire et la position.');
            if (data.type === 'FAILURE' && !String(data.failureReason || '').trim())
                refuse('Le motif d’échec est obligatoire.');
            const firstAttempt = parcels[0].data()?.deliveryAttempts?.find((a) => a.id === proofId);
            saved = clean({ packageIds: data.packageIds, missionId: data.missionId, stopId: data.stopId,
                proofId, driverId: caller.id, driverName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(),
                vehicleId: mission.vehicleId || '', vehiclePlate: mission.vehiclePlate || '', type: data.type,
                timestamp, receivedAt, createdAt: receivedAt,
                destination: firstAttempt?.destination || { contactName: stop.contactName || '', address: stop.address || '', city: stop.city || '', postalCode: stop.postalCode || '',
                    zone: parcels[0].data()?.zone || undefined, floor: stop.floor, timeWindowStart: stop.timeWindowStart, timeWindowEnd: stop.timeWindowEnd },
                photoUrls: data.photoUrls, coordinates: validCoordinates(data.coordinates) ? { lat: data.coordinates.lat, lng: data.coordinates.lng } : null,
                locationStatus: validCoordinates(data.coordinates) ? 'captured' : 'unavailable',
                ...(data.type === 'SUCCESS' ? {
                    recipientName: String(data.recipientName).trim().slice(0, 200), signatureUrl: data.signatureUrl,
                    deliveryLocation: data.deliveryLocation || null, merchandiseGoodCondition: data.merchandiseGoodCondition !== false,
                    reservesNote: data.reservesNote ? String(data.reservesNote).slice(0, 3000) : null,
                    notes: data.notes ? String(data.notes).slice(0, 3000) : undefined,
                } : { failureReason: firstAttempt?.failureReason || String(data.failureReason).slice(0, 200),
                    failureNotes: firstAttempt?.failureNotes || (data.failureNotes ? String(data.failureNotes).slice(0, 3000) : null) }),
            });
            tx.create(proofRef, saved);
        }
        for (const [index, snap] of parcels.entries()) {
            const pkg = snap.data(), packageId = stop.packageIds[index];
            const success = saved.type === 'SUCCESS' && saved.packageIds.includes(packageId);
            const attempts = pkg.deliveryAttempts || [], prior = attempts.find(a => a.id === proofId);
            const { packageIds: _privateIds, ...publicProof } = saved;
            const proof = clean({ ...publicProof, destination: prior?.destination || publicProof.destination, packageId, type: success ? 'SUCCESS' : 'FAILURE',
                ...(!success ? { recipientName: undefined, deliveryLocation: undefined, signatureUrl: undefined,
                    merchandiseGoodCondition: undefined, reservesNote: undefined, notes: undefined,
                    failureReason: prior?.failureReason || pkg.failureReason || saved.failureReason || 'Colis non remis',
                    failureNotes: prior?.failureNotes || pkg.failureNotes || saved.failureNotes || undefined } : {}),
            });
            const attempt = clean({ ...prior, id: proofId, proofId, missionId: data.missionId, stopId: data.stopId, driverId: caller.id,
                outcome: success ? 'SUCCESS' : 'FAILURE', recordedAt: prior?.recordedAt || saved.timestamp,
                destination: prior?.destination || saved.destination,
                receivedAt: prior?.receivedAt || saved.receivedAt || receivedAt, proof,
                ...(!success ? { failureReason: proof.failureReason, failureNotes: proof.failureNotes } : {}), });
            tx.update(snap.ref, clean({ [success ? 'pod' : 'failurePod']: proof,
                deliveryAttempts: prior ? attempts.map(a => a.id === proofId ? attempt : a) : [...attempts, attempt],
                ...(!success ? { failureReason: proof.failureReason, failureNotes: proof.failureNotes } : {}), updatedAt: receivedAt }));
        }
        tx.update(missionRef, { stops: stops.map(s => s.id === stop.id ? { ...s, proofSyncPending: false } : s), updatedAt: receivedAt });
        return { proof: saved };
    });
}
//# sourceMappingURL=publishDeliveryProof.js.map