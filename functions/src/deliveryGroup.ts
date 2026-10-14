import { sameDeliveryRecipient, type PlaceLike } from './deliveryAddress';
export { sameDeliveryRecipient } from './deliveryAddress';
interface DeliveryPoint extends PlaceLike {}
interface GroupStop extends DeliveryPoint { id: string; type: string; status: string; proofSyncPending?: boolean; packageIds: string[] }
export function deliveryStopGroup<T extends GroupStop>(stops: T[], target: T): T[] {
  if (target.type !== 'DELIVERY' || target.status !== 'En attente' || target.proofSyncPending) return [target];
  return [target, ...stops.filter(stop => stop.id !== target.id && stop.type === 'DELIVERY' &&
    stop.status === 'En attente' && !stop.proofSyncPending && sameDeliveryRecipient(target, stop) &&
    // Stops have planned windows; parcel windows may be wider than the planned visit.
    (target.timeWindowStart || '') === (stop.timeWindowStart || '') &&
    (target.timeWindowEnd || '') === (stop.timeWindowEnd || ''))];
}
