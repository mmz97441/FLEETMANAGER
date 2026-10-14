// One shared rule for browser and server; placeKey is only for geocoding.
export { normAddr, normPhone, placeKey, phoneSignal, sameDeliveryPoint, sameDeliveryRecipient, sameDeliveryVisit, recipientKey, intersectDeliveryWindows, visitContainsParcelWindow } from '../../functions/src/deliveryAddress';
export type { PlaceLike } from '../../functions/src/deliveryAddress';
