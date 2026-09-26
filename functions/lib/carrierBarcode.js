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
exports.validatedCarrierBarcode = validatedCarrierBarcode;
exports.checkCarrierBarcode = checkCarrierBarcode;
exports.associateCarrierBarcodeHandler = associateCarrierBarcodeHandler;
const functions = __importStar(require("firebase-functions/v1"));
const crypto_1 = require("crypto");
const scanCode_1 = require("./scanCode");
function validatedCarrierBarcode(value, reference) {
    if (typeof value !== 'string')
        throw new functions.https.HttpsError('invalid-argument', 'Le code Boiron doit être conservé comme texte, avec ses zéros initiaux.');
    const code = (0, scanCode_1.normalizeScanCode)(value), order = (0, scanCode_1.orderReferenceHint)(code);
    if (!order || order !== String(reference || '').trim())
        throw new functions.https.HttpsError('invalid-argument', 'Le code Boiron doit comporter 22 chiffres et correspondre à la référence de commande du colis.');
    return code;
}
/** Read phase only. The registry serializes concurrent associations/imports. */
async function checkCarrierBarcode(tx, db, code, packageId) {
    const ref = db.collection('carrier_barcodes').doc((0, crypto_1.createHash)('sha256').update(code).digest('hex'));
    const [reservation, matches] = await Promise.all([
        tx.get(ref),
        Promise.all(['carrierBarcode', 'barcode', 'externalId', 'orderNumber'].map(field => tx.get(db.collection('packages').where(field, '==', code).limit(2)))),
    ]);
    if (reservation.exists && reservation.data().packageId !== packageId)
        throw new functions.https.HttpsError('already-exists', 'Ce code Boiron est déjà associé à un autre colis. Faites vérifier les étiquettes.');
    for (const existing of matches) {
        if (existing.docs.some(d => d.id !== packageId))
            throw new functions.https.HttpsError('already-exists', 'Ce code identifie déjà un autre colis. Aucune association modifiée.');
    }
    return { ref, exists: reservation.exists };
}
async function associateCarrierBarcodeHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context);
    if (!deps.isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Association réservée au bureau.');
    if (typeof data?.packageId !== 'string' || !data.packageId || data.packageId.length > 200 || data.packageId.includes('/') || data?.verified !== true)
        throw new functions.https.HttpsError('invalid-argument', 'Vérifiez les deux étiquettes du même carton avant de confirmer.');
    return deps.db.runTransaction(async (tx) => {
        const ref = deps.db.collection('packages').doc(data.packageId), snap = await tx.get(ref), pkg = snap.data();
        if (!pkg)
            throw new functions.https.HttpsError('not-found', 'Colis introuvable.');
        const code = validatedCarrierBarcode(data.code, pkg.clientReference);
        if (pkg.carrierBarcode && pkg.carrierBarcode !== code)
            throw new functions.https.HttpsError('already-exists', 'Ce colis possède déjà un autre code Boiron. Faites vérifier le carton.');
        const reservation = await checkCarrierBarcode(tx, deps.db, code, ref.id);
        if (reservation.exists && pkg.carrierBarcode === code)
            return { success: true, replayed: true };
        const at = new Date().toISOString();
        tx.set(reservation.ref, { packageId: ref.id, code, createdAt: at, createdBy: caller.id });
        tx.update(ref, { carrierBarcode: code, updatedAt: at });
        tx.create(deps.db.collection('activity_logs').doc(), {
            userId: caller.id, userName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), userRole: caller.role,
            action: 'PACKAGE_BARCODE_ASSOCIATED', category: 'Livraison', targetType: 'package', targetId: ref.id,
            targetName: pkg.externalId || pkg.barcode || '', description: 'Correspondance des deux étiquettes du carton vérifiée par le bureau.',
            outcome: 'success', details: { carrierBarcode: code, clientReference: pkg.clientReference }, createdAt: at,
        });
        return { success: true, replayed: false };
    });
}
//# sourceMappingURL=carrierBarcode.js.map