"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameDeliveryRecipient = sameDeliveryRecipient;
exports.deliveryStopGroup = deliveryStopGroup;
const deliveryAddress_1 = require("./deliveryAddress");
/** Automatic consolidation needs the same named recipient and full address.
 * A shared phone number alone cannot authorize a shared proof of delivery. */
function sameDeliveryRecipient(a, b) {
    return !!(0, deliveryAddress_1.normAddr)(a.address) && !!a.postalCode?.trim() && !!(0, deliveryAddress_1.normAddr)(a.city) && !!(0, deliveryAddress_1.normAddr)(a.contactName) &&
        (0, deliveryAddress_1.placeKey)(a) === (0, deliveryAddress_1.placeKey)(b) && (0, deliveryAddress_1.normAddr)(a.contactName) === (0, deliveryAddress_1.normAddr)(b.contactName) &&
        String(a.floor ?? '') === String(b.floor ?? '');
}
function deliveryStopGroup(stops, target) {
    if (target.type !== 'DELIVERY' || !['En attente', 'Arrivé'].includes(target.status) || target.proofSyncPending)
        return [target];
    return [target, ...stops.filter(stop => stop.id !== target.id && stop.type === 'DELIVERY' &&
            stop.status === 'En attente' && !stop.proofSyncPending && sameDeliveryRecipient(target, stop) &&
            // Stops have planned windows; parcel windows may be wider than the planned visit.
            (target.timeWindowStart || '') === (stop.timeWindowStart || '') &&
            (target.timeWindowEnd || '') === (stop.timeWindowEnd || ''))];
}
//# sourceMappingURL=deliveryGroup.js.map