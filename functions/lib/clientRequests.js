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
exports.createClientRequestHandler = createClientRequestHandler;
exports.updateClientRequestHandler = updateClientRequestHandler;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("firebase-admin/firestore");
const crypto_1 = require("crypto");
const clientRequestModel_1 = require("./clientRequestModel");
const hash = (text) => (0, crypto_1.createHash)('sha256').update(text).digest('hex');
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
const fail = (message) => { throw new functions.https.HttpsError('invalid-argument', message); };
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail('Texte invalide ou trop long.');
const belongsTo = (parcel, client) => parcel.clientId === client.id || (!!client.companyName && parcel.clientName === client.companyName);
async function createClientRequestHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role);
    if (!manager && String(caller.role).toLowerCase() !== 'client')
        throw new functions.https.HttpsError('permission-denied', 'Demande réservée au client et à l’exploitation.');
    if (!validId(data?.requestId) || !validId(data.packageId) || !validId(data.clientId))
        fail('Références de demande invalides.');
    if (!manager && data.clientId !== caller.id)
        throw new functions.https.HttpsError('permission-denied', 'Cette demande appartient à un autre client.');
    const kind = data.kind;
    if (!Object.prototype.hasOwnProperty.call(clientRequestModel_1.CLIENT_REQUEST_LABELS, kind))
        fail('Choisissez le motif de la demande.');
    const message = text(data.message, 3000);
    if (message.length < 10)
        fail('Décrivez votre demande en au moins 10 caractères.');
    const requestedAddress = kind === 'ADDRESS' ? {
        contactName: text(data.requestedAddress?.contactName, 200), address: text(data.requestedAddress?.address, 500),
        postalCode: text(data.requestedAddress?.postalCode, 20), city: text(data.requestedAddress?.city, 200), contactPhone: text(data.requestedAddress?.contactPhone, 100),
    } : null;
    if (requestedAddress && (Object.values(requestedAddress).some(value => !value) || !/^\d{5}$/.test(requestedAddress.postalCode)))
        fail('Complétez le destinataire, la rue, le code postal à cinq chiffres, la ville et le téléphone proposés.');
    const requestedDate = kind === 'REDELIVERY' ? text(data.requestedDate || '', 10) : '';
    const parsedDate = Date.parse(`${requestedDate}T12:00:00Z`);
    if (requestedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== requestedDate))
        fail('Date de présentation invalide.');
    const fingerprint = hash(JSON.stringify([data.clientId, data.packageId, kind, message, requestedAddress, requestedDate]));
    const id = hash(`${caller.id}|${data.requestId}`), ref = deps.db.collection('client_requests').doc(id);
    return deps.db.runTransaction(async (tx) => {
        const old = await tx.get(ref);
        if (old.exists) {
            if (old.data().actorId !== caller.id || old.data().fingerprint !== fingerprint)
                throw new functions.https.HttpsError('failed-precondition', 'Cette référence contient déjà une autre demande.');
            return { id, reference: old.data().reference };
        }
        if (requestedDate && requestedDate < new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10))
            fail('Choisissez une date de présentation à partir d’aujourd’hui, en heure de La Réunion.');
        const clientSnap = await tx.get(deps.db.collection('users').doc(data.clientId));
        const client = { ...clientSnap.data(), id: clientSnap.id };
        const packageSnap = await tx.get(deps.db.collection('packages').doc(data.packageId)), parcel = packageSnap.data();
        if (!clientSnap.exists || String(client.role).toLowerCase() !== 'client' || client.isDisabled || !parcel || !belongsTo(parcel, client))
            throw new functions.https.HttpsError('permission-denied', 'Ce colis n’appartient pas à ce client ou n’est plus disponible.');
        if (!(0, clientRequestModel_1.allowedClientRequestKinds)(parcel).includes(kind))
            throw new functions.https.HttpsError('failed-precondition', 'Le statut du colis a changé. Actualisez sa fiche pour choisir une demande adaptée.');
        const previous = await tx.get(deps.db.collection('client_requests').where('packageId', '==', data.packageId));
        const active = previous.docs.find(row => row.data().kind === kind && ['OPEN', 'IN_PROGRESS'].includes(row.data().status));
        if (active)
            throw new functions.https.HttpsError('already-exists', `Une demande est déjà ouverte : ${active.data().reference}. Consultez son suivi.`, { requestId: active.id });
        const users = await tx.get(deps.db.collection('users'));
        const recipients = users.docs.filter(user => !user.data().isDisabled && deps.isAdminCaller(user.data().role));
        if (recipients.length > 400)
            throw new functions.https.HttpsError('resource-exhausted', 'La demande ne peut pas encore être distribuée. Contactez l’exploitation.');
        const now = new Date().toISOString(), reference = `DC-${id.slice(0, 10).toUpperCase()}`;
        const packageReference = String(parcel.externalId || parcel.carrierBarcode || parcel.barcode || parcel.orderNumber || packageSnap.id);
        tx.create(ref, { reference, actorId: caller.id, clientId: client.id, companyName: client.companyName || '', fingerprint,
            packageId: packageSnap.id, packageReference, packageStatus: String(parcel.status || 'Statut inconnu'), recipientName: parcel.contactName || '', kind, message,
            requestedAddress, requestedDate: requestedDate || null, status: 'OPEN', response: '', version: 1, createdAt: now, updatedAt: now,
            history: [{ status: 'OPEN', timestamp: now, actorName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), response: '' }] });
        for (const user of recipients)
            tx.create(deps.db.collection('notifications').doc(`client-request-${id}-${user.id}`), {
                recipientId: user.id, type: 'system', priority: 'high', title: 'Demande client à traiter',
                message: `${reference} · ${packageReference} · ${clientRequestModel_1.CLIENT_REQUEST_LABELS[kind]}`, actionType: 'navigate', actionTarget: 'missions',
                metadata: { clientRequestId: id, packageId: packageSnap.id }, read: false, createdAt: now, _createdAt: firestore_1.FieldValue.serverTimestamp()
            });
        return { id, reference };
    });
}
async function updateClientRequestHandler(data, context, deps) {
    const caller = await deps.requireActiveCaller(context);
    if (!deps.isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Le traitement des demandes est réservé à l’exploitation.');
    if (!validId(data?.id) || !validId(data.operationId) || !Number.isInteger(data.expectedVersion))
        fail('Référence de traitement invalide.');
    const status = data.status, response = text(data.response || '', 3000);
    if (!['IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(status))
        fail('Statut de demande invalide.');
    if (['RESOLVED', 'REJECTED'].includes(status) && response.length < 10)
        fail('Expliquez au client le résultat du traitement en au moins 10 caractères.');
    const key = hash(`${caller.id}|${data.operationId}`), receiptRef = deps.db.collection('client_request_operations').doc(key), ref = deps.db.collection('client_requests').doc(data.id);
    const fingerprint = hash(JSON.stringify([data.id, data.expectedVersion, status, response]));
    return deps.db.runTransaction(async (tx) => {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
            if (receipt.data().fingerprint !== fingerprint)
                throw new functions.https.HttpsError('failed-precondition', 'Cette opération correspond à une autre réponse.');
            return { id: data.id };
        }
        const snap = await tx.get(ref), request = snap.data();
        if (!request)
            throw new functions.https.HttpsError('not-found', 'Demande introuvable.');
        if (request.version !== data.expectedVersion || ['RESOLVED', 'REJECTED'].includes(request.status))
            throw new functions.https.HttpsError('failed-precondition', 'Cette demande a déjà été traitée ou modifiée. Relisez son suivi avant de répondre.');
        const now = new Date().toISOString(), nextVersion = request.version + 1;
        const history = [...request.history, { status, response, timestamp: now, actorName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim() }];
        tx.update(ref, { status, response, version: nextVersion, updatedAt: now, assignedTo: caller.id, history });
        tx.create(receiptRef, { fingerprint, actorId: caller.id, requestId: snap.id, createdAt: now });
        tx.create(deps.db.collection('notifications').doc(`client-request-result-${snap.id}-${nextVersion}`), {
            recipientId: request.clientId, type: 'system', priority: 'normal', title: `${request.reference} · ${clientRequestModel_1.CLIENT_REQUEST_STATUS_LABELS[status]}`,
            message: response || 'L’exploitation a pris en charge votre demande.', actionType: 'navigate', actionTarget: 'client_shipments',
            metadata: { clientRequestId: snap.id, packageId: request.packageId }, read: false, createdAt: now, _createdAt: firestore_1.FieldValue.serverTimestamp()
        });
        // Request workflow never edits the parcel, its mission, movements or proofs.
        return { id: snap.id };
    });
}
//# sourceMappingURL=clientRequests.js.map