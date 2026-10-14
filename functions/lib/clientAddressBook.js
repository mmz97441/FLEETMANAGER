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
exports.addressBookIdentity = void 0;
exports.saveClientAddressHandler = saveClientAddressHandler;
exports.updateClientAddressHandler = updateClientAddressHandler;
const functions = __importStar(require("firebase-functions/v1"));
const addressBookIdentity_1 = require("./addressBookIdentity");
var addressBookIdentity_2 = require("./addressBookIdentity");
Object.defineProperty(exports, "addressBookIdentity", { enumerable: true, get: function () { return addressBookIdentity_2.addressBookIdentity; } });
function fields(raw) {
    const value = (key, max, required = false) => {
        const text = typeof raw?.[key] === 'string' ? raw[key].trim() : '';
        if ((required && !text) || text.length > max)
            throw new functions.https.HttpsError('invalid-argument', `Champ destinataire invalide : ${key}.`);
        return text;
    };
    const result = { contactName: value('contactName', 200, true), address: value('address', 500, true), city: value('city', 200, true),
        contactPhone: value('contactPhone', 100, true), contactEmail: value('contactEmail', 254), notes: value('notes', 3000) };
    if (result.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail))
        throw new functions.https.HttpsError('invalid-argument', 'Corrigez l’adresse email ou laissez le champ vide.');
    return result;
}
async function saveClientAddressHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role);
    if (!manager && String(caller.role).toLowerCase() !== 'client')
        throw new functions.https.HttpsError('permission-denied', 'Carnet réservé au client et à l’exploitation.');
    const companyName = manager ? String(data?.address?.companyName || '').trim() : String(caller.companyName || '').trim();
    if (!companyName || companyName.length > 200)
        throw new functions.https.HttpsError('failed-precondition', 'Votre entreprise doit être renseignée par votre responsable avant d’utiliser le carnet.');
    const editable = fields(data?.address), type = data?.address?.type;
    const errors = (0, addressBookIdentity_1.addressBookFieldErrors)(editable);
    if (Object.keys(errors).length)
        throw new functions.https.HttpsError('invalid-argument', Object.values(errors).join(' '));
    if (!['pickup', 'delivery', 'both'].includes(type))
        throw new functions.https.HttpsError('invalid-argument', 'Usage de l’adresse invalide.');
    const newRef = deps.db.collection('savedAddresses').doc();
    return deps.db.runTransaction(async (tx) => {
        // The query is inside the transaction: concurrent saves of the same new
        // recipient cannot both decide that it is absent, including legacy IDs.
        const rows = await tx.get(deps.db.collection('savedAddresses').where('companyName', '==', companyName));
        const matches = rows.docs.filter(row => (0, addressBookIdentity_1.addressBookIdentity)(row.data()) === (0, addressBookIdentity_1.addressBookIdentity)(editable));
        if (matches.length > 1)
            throw new functions.https.HttpsError('failed-precondition', 'Plusieurs fiches existent pour ce destinataire. Faites contrôler ces doublons avant de réessayer.');
        const now = new Date().toISOString();
        if (matches.length) {
            const existing = matches[0], previousType = existing.data().type;
            const nextType = previousType === type || previousType === 'both' ? previousType : 'both';
            if (nextType !== previousType)
                tx.update(existing.ref, { type: nextType, updatedAt: now });
            return { id: existing.id, outcome: nextType === previousType ? 'existing' : 'usage_extended' };
        }
        tx.create(newRef, { ...editable, label: String(data?.address?.label || editable.contactName).trim().slice(0, 200),
            companyName, createdBy: caller.id, type, usageCount: 0, createdAt: now, updatedAt: now });
        return { id: newRef.id, outcome: 'created' };
    });
}
async function updateClientAddressHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role), editable = fields(data?.fields);
    if (typeof data?.id !== 'string' || !data.id || data.id.includes('/'))
        throw new functions.https.HttpsError('invalid-argument', 'Destinataire invalide.');
    return deps.db.runTransaction(async (tx) => {
        const ref = deps.db.collection('savedAddresses').doc(data.id), snap = await tx.get(ref), previous = snap.data();
        if (!previous)
            throw new functions.https.HttpsError('not-found', 'Ce destinataire a été supprimé.');
        if (!manager && (String(caller.role).toLowerCase() !== 'client' || !caller.companyName || caller.companyName !== previous.companyName))
            throw new functions.https.HttpsError('permission-denied', 'Ce destinataire appartient à une autre entreprise.');
        // Legacy incomplete places may still have their email/notes cleared. A new
        // identity, however, must be usable by the shipment workflow.
        if ((0, addressBookIdentity_1.addressBookIdentity)(previous) !== (0, addressBookIdentity_1.addressBookIdentity)(editable)) {
            const errors = (0, addressBookIdentity_1.addressBookFieldErrors)(editable);
            if (Object.keys(errors).length)
                throw new functions.https.HttpsError('invalid-argument', Object.values(errors).join(' '));
        }
        const rows = await tx.get(deps.db.collection('savedAddresses').where('companyName', '==', previous.companyName));
        if (rows.docs.some(row => row.id !== snap.id && (0, addressBookIdentity_1.addressBookIdentity)(row.data()) === (0, addressBookIdentity_1.addressBookIdentity)(editable)))
            throw new functions.https.HttpsError('already-exists', 'Ce destinataire existe déjà dans le carnet. Modifiez sa fiche existante.');
        tx.update(ref, { ...editable, label: editable.contactName, updatedAt: new Date().toISOString() });
        return { id: snap.id };
    });
}
//# sourceMappingURL=clientAddressBook.js.map