"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameDeliveryRecipient = void 0;
exports.deliveryStopGroup = deliveryStopGroup;
const deliveryAddress_1 = require("./deliveryAddress");
var deliveryAddress_2 = require("./deliveryAddress");
Object.defineProperty(exports, "sameDeliveryRecipient", { enumerable: true, get: function () { return deliveryAddress_2.sameDeliveryRecipient; } });
function deliveryStopGroup(stops, target) {
    if (target.type !== 'DELIVERY' || target.status !== 'En attente' || target.proofSyncPending)
        return [target];
    return [target, ...stops.filter(stop => stop.id !== target.id && stop.type === 'DELIVERY' &&
            stop.status === 'En attente' && !stop.proofSyncPending && (0, deliveryAddress_1.sameDeliveryRecipient)(target, stop) &&
            // Stops have planned windows; parcel windows may be wider than the planned visit.
            (target.timeWindowStart || '') === (stop.timeWindowStart || '') &&
            (target.timeWindowEnd || '') === (stop.timeWindowEnd || ''))];
}
//# sourceMappingURL=deliveryGroup.js.map