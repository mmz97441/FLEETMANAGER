/** Shared recipient identity. A geocoding key or shared phone never authorizes a delivery. */
export interface PlaceLike {
  address?: string;
  postalCode?: string;
  city?: string;
  contactPhone?: string;
  contactName?: string;
  floor?: number;
  timeWindowStart?: string;
  timeWindowEnd?: string;
}
export const normAddr = (s?: string): string => (s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const normPhone = (s?: string): string => (s || '').replace(/\D/g, '');
/** Address-only key is suitable for geocoding, never for recipient grouping. */
export const placeKey = (p: PlaceLike): string => `${normAddr(p.address)}|${(p.postalCode || '').trim()}|${normAddr(p.city)}`;
export const phoneSignal = (p: PlaceLike): string => { const s = normPhone(p.contactPhone); return s.length >= 6 ? s : ''; };
export const recipientKey = (p: PlaceLike): string => `${placeKey(p)}|${normAddr(p.contactName)}|${String(p.floor ?? '')}`;
export const sameDeliveryRecipient = (a: PlaceLike, b: PlaceLike): boolean =>
  !!normAddr(a.address) && !!a.postalCode?.trim() && !!normAddr(a.city) && !!normAddr(a.contactName) && recipientKey(a) === recipientKey(b);
/** Legacy callers now use the same strict recipient identity. */
export const sameDeliveryPoint = sameDeliveryRecipient;
const minute = (value: string | undefined, fallback: number): number => !value ? fallback :
  /^([01]?\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.split(':')[0]) * 60 + Number(value.split(':')[1]) : NaN;
const clock = (value: number): string => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export function intersectDeliveryWindows(points: PlaceLike[]): Pick<PlaceLike, 'timeWindowStart' | 'timeWindowEnd'> | null {
  const start = Math.max(0, ...points.map(p => minute(p.timeWindowStart, 0)));
  const end = Math.min(1440, ...points.map(p => minute(p.timeWindowEnd, 1440)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  return { ...(points.some(p => p.timeWindowStart) ? { timeWindowStart: clock(start) } : {}),
    ...(points.some(p => p.timeWindowEnd) ? { timeWindowEnd: clock(end) } : {}) };
}
export const sameDeliveryVisit = (a: PlaceLike, b: PlaceLike): boolean => sameDeliveryRecipient(a, b) && intersectDeliveryWindows([a, b]) !== null;
/** A planned visit must fit inside every parcel's promised window. */
export function visitContainsParcelWindow(visit: PlaceLike, parcel: PlaceLike): boolean {
  const start = minute(visit.timeWindowStart, 0), end = minute(visit.timeWindowEnd, 1440);
  return start < end && start >= minute(parcel.timeWindowStart, 0) && end <= minute(parcel.timeWindowEnd, 1440);
}
