/** Snapshot of exactly the offer reviewed by the customer. No mutable timestamp. */
export interface QuoteOfferSnapshot {
  version: 1;
  priceOffer: number;
  adminNotes: string;
  request: Record<string, unknown>;
}
export function quoteOfferSnapshot(quote: any): QuoteOfferSnapshot {
  if (typeof quote?.priceOffer !== 'number' || !Number.isFinite(quote.priceOffer) || quote.priceOffer < 0) throw new Error('Le montant de cette offre doit être vérifié avant acceptation.');
  const request: Record<string, unknown> = {};
  for (const key of ['origin', 'originAddress', 'destination', 'destinationAddress', 'pickupDate', 'deliveryDate', 'requestedDeliveryDate', 'goodsDescription', 'clientNotes']) request[key] = typeof quote[key] === 'string' ? quote[key] : '';
  for (const key of ['weight', 'volume']) request[key] = typeof quote[key] === 'number' ? quote[key] : null;
  for (const key of ['originContact', 'destinationContact']) request[key] = { name: quote[key]?.name || '', phone: quote[key]?.phone || '' };
  request.dimensions = { length: quote.dimensions?.length ?? null, width: quote.dimensions?.width ?? null, height: quote.dimensions?.height ?? null };
  request.deliveryTimeWindow = { start: quote.deliveryTimeWindow?.start || '', end: quote.deliveryTimeWindow?.end || '', label: quote.deliveryTimeWindow?.label || '' };
  return { version: 1, priceOffer: quote.priceOffer, adminNotes: typeof quote.adminNotes === 'string' ? quote.adminNotes : '', request };
}
function stable(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function matchesQuoteOffer(quote: any, expected: unknown): expected is QuoteOfferSnapshot {
  return !!expected && stable(quoteOfferSnapshot(quote)) === stable(expected);
}
