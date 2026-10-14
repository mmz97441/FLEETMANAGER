import { normAddr, placeKey, type PlaceLike } from './deliveryAddress';

interface DeliveryPoint extends PlaceLike { contactName?: string; floor?: number; timeWindowStart?: string; timeWindowEnd?: string }
/** Automatic consolidation needs the same named recipient and full address.
 * A shared phone number alone cannot authorize a shared proof of delivery. */
export function sameDeliveryRecipient(a: DeliveryPoint, b: DeliveryPoint): boolean {
  return !!normAddr(a.address) && !!a.postalCode?.trim() && !!normAddr(a.city) && !!normAddr(a.contactName) &&
    placeKey(a) === placeKey(b) && normAddr(a.contactName) === normAddr(b.contactName) &&
    String(a.floor ?? '') === String(b.floor ?? '');
}
interface GroupStop extends DeliveryPoint { id: string; type: string; status: string; proofSyncPending?: boolean; packageIds: string[] }
export function deliveryStopGroup<T extends GroupStop>(stops: T[], target: T): T[] {
  if (target.type !== 'DELIVERY' || !['En attente', 'Arrivé'].includes(target.status) || target.proofSyncPending) return [target];
  return [target, ...stops.filter(stop => stop.id !== target.id && stop.type === 'DELIVERY' &&
    stop.status === 'En attente' && !stop.proofSyncPending && sameDeliveryRecipient(target, stop) &&
    // Stops have planned windows; parcel windows may be wider than the planned visit.
    (target.timeWindowStart || '') === (stop.timeWindowStart || '') &&
    (target.timeWindowEnd || '') === (stop.timeWindowEnd || ''))];
}
