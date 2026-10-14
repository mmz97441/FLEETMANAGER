"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_REQUEST_STATUS_LABELS = exports.CLIENT_REQUEST_LABELS = void 0;
exports.allowedClientRequestKinds = allowedClientRequestKinds;
exports.CLIENT_REQUEST_LABELS = {
    MISSING: 'Signaler un colis manquant',
    ADDRESS: 'Demander une correction d’adresse',
    REDELIVERY: 'Demander une nouvelle livraison',
    CANCELLATION: 'Demander une annulation',
};
exports.CLIENT_REQUEST_STATUS_LABELS = {
    OPEN: 'Demande reçue', IN_PROGRESS: 'Prise en charge', RESOLVED: 'Réponse apportée', REJECTED: 'Demande refusée',
};
function allowedClientRequestKinds(parcel) {
    const choices = ['MISSING'];
    if (!['Livré', 'Retourné'].includes(parcel.status || '') && parcel.returnDisposition !== 'SENDER_RETURNED')
        choices.push('ADDRESS', 'CANCELLATION');
    if (parcel.returnDisposition !== 'SENDER_RETURNED' && !['Livré', 'Retourné'].includes(parcel.status || '') &&
        (['Échec', 'À retourner'].includes(parcel.status || '') || ['AWAITING_DECISION', 'REDELIVERY_READY'].includes(parcel.returnDisposition || '')))
        choices.push('REDELIVERY');
    return choices;
}
//# sourceMappingURL=clientRequestModel.js.map