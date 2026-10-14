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
exports.parcelReferenceId = void 0;
exports.readIndividualReferenceReservations = readIndividualReferenceReservations;
exports.writeIndividualReferenceReservations = writeIndividualReferenceReservations;
exports.repairParcelScanCodes = repairParcelScanCodes;
const crypto_1 = require("crypto");
const functions = __importStar(require("firebase-functions/v1"));
const scanCode_1 = require("./scanCode");
const parcelReferenceId = (code) => (0, crypto_1.createHash)('sha256').update((0, scanCode_1.normalizeScanCode)(code)).digest('hex');
exports.parcelReferenceId = parcelReferenceId;
/** Read before any transaction writes. Every alias participates in serialization:
 * shared order references are allowed, but cannot collide with an individual label. */
async function readIndividualReferenceReservations(tx, db, items) {
    const requests = new Map();
    const collision = () => new functions.https.HttpsError('already-exists', 'Cette référence identifie déjà un autre colis ou expéditeur. Utilisez une référence individuelle unique.');
    for (const { id, parcel } of items) {
        const individual = (0, scanCode_1.parcelIndividualCodes)(parcel);
        for (const code of (0, scanCode_1.parcelScanCodes)(parcel)) {
            if (!requests.has(code))
                requests.set(code, new Map());
            const owners = requests.get(code);
            owners.set(id, !!owners.get(id) || individual.includes(code));
        }
    }
    for (const owners of requests.values())
        if (owners.size > 1 && [...owners.values()].some(Boolean))
            throw collision();
    return Promise.all([...requests].map(async ([code, owners]) => {
        const ref = db.collection('parcel_reference_index').doc((0, exports.parcelReferenceId)(code));
        const individual = [...owners.values()].some(Boolean);
        const canonical = db.collection('packages').where('scanCodes', 'array-contains', code);
        const [reservation, ...matches] = await Promise.all([tx.get(ref),
            // Shared orders can contain many cartons. Inspect all aliases so a legacy
            // mixed-case individual label cannot hide behind the first two cartons.
            tx.get(individual ? canonical.limit(2) : canonical),
            ...scanCode_1.parcelCodeFields.map(field => tx.get(db.collection('packages').where(field, 'in', [...new Set([code, code.toLowerCase()])]).limit(2)))]);
        const known = reservation.data();
        const documents = new Map(matches.flatMap(snapshot => 'docs' in snapshot ? snapshot.docs.map(doc => [doc.id, doc]) : []));
        const knownIds = [...new Set([...(known?.packageIds || []), ...(known?.packageId ? [known.packageId] : [])])];
        const allIds = [...new Set([...owners.keys(), ...knownIds, ...documents.keys()])];
        if (individual) {
            if (known?.ambiguous || allIds.length > 1)
                throw collision();
        }
        else {
            const individualOwners = new Set([...documents].filter(([, doc]) => (0, scanCode_1.parcelIndividualCodes)(doc.data()).includes(code)).map(([id]) => id));
            if (known?.referenceKind === 'collision')
                throw collision();
            // Older reservations have no classification. Preserve unknown owners
            // conservatively until the controlled migration has inspected them.
            if (known?.referenceKind !== 'order')
                for (const id of knownIds)
                    if (known?.referenceKind === 'individual' || !documents.has(id))
                        individualOwners.add(id);
            if ([...individualOwners].some(id => allIds.some(other => other !== id)))
                throw collision();
        }
        return { ref, code, packageIds: allIds.slice(0, 2), referenceKind: individual ? 'individual' : 'order' };
    }));
}
function writeIndividualReferenceReservations(tx, reservations, createdBy, at) {
    for (const { ref, code, packageIds, referenceKind } of reservations)
        tx.set(ref, {
            code, packageId: packageIds.length === 1 ? packageIds[0] : null, packageIds,
            referenceKind, ambiguous: packageIds.length > 1, updatedAt: at, updatedBy: createdBy,
        });
}
/** Optional write trigger safety net for server paths predating the canonical index. */
async function repairParcelScanCodes(db, packageId) {
    await db.runTransaction(async (tx) => {
        const ref = db.collection('packages').doc(packageId), snap = await tx.get(ref);
        if (!snap.exists)
            return;
        const pkg = snap.data(), scanCodes = (0, scanCode_1.parcelScanCodes)(pkg);
        if (JSON.stringify(pkg.scanCodes) !== JSON.stringify(scanCodes))
            tx.update(ref, { scanCodes });
    });
}
//# sourceMappingURL=parcelReferenceIndex.js.map