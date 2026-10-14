import { describe, expect, it } from 'vitest';
import { quoteShipmentFields, shipmentFieldErrors, splitRequestedDelivery } from './shipmentContract';
import { matchesQuoteOffer, quoteOfferSnapshot } from './quoteOffer';
const point = { contactName: 'Pharmacie A', address: '10 rue Test', postalCode: '97400', city: 'Saint-Denis' };
const quote = { priceOffer: 50, adminNotes: 'Frais inclus', origin: '97410 Saint-Pierre', destination: '97400 Saint-Denis', destinationAddress: '10 rue Test', destinationContact: { name: 'Pharmacie A', phone: '0262000000' }, deliveryDate: '2026-10-20T10:30', deliveryTimeWindow: { start: '08:00', end: '12:00', label: 'Matin' }, goodsDescription: 'Deux cartons', volume: 1 };
describe('shared shipment contract', () => {
  it.each(['city', 'postalCode', 'contactName', 'address'])('rejects missing %s before a new parcel is created', field => {
    expect(shipmentFieldErrors({ ...point, [field]: '' })).toHaveProperty(field);
  });
  it('uses the same calendar, window and duration checks at every boundary', () => {
    expect(shipmentFieldErrors({ ...point, requestedDeliveryDate: '2026-02-30', timeWindowStart: '14:00', timeWindowEnd: '08:00', serviceTime: 481 })).toMatchObject({ requestedDeliveryDate: expect.any(String), timeWindowEnd: expect.any(String), serviceTime: expect.any(String) });
    expect(shipmentFieldErrors({ ...point, requestedDeliveryDate: '2026-10-20', timeWindowStart: '08:00', timeWindowEnd: '12:00', serviceTime: 20 })).toEqual({});
  });
  it('separates a local quote date and hour without inventing a window', () => {
    expect(quoteShipmentFields({ ...quote, deliveryTimeWindow: undefined })).toMatchObject({ requestedDeliveryDate: '2026-10-20', requestedDeliveryTime: '10:30', city: 'Saint-Denis', postalCode: '97400', timeWindowStart: null, timeWindowEnd: null });
    expect(quoteShipmentFields(quote)).toMatchObject({ timeWindowStart: '08:00', timeWindowEnd: '12:00' });
  });
  it('uses Réunion for explicit offsets across midnight', () => {
    expect(splitRequestedDelivery('2026-10-20T22:30:00Z')).toEqual({ requestedDeliveryDate: '2026-10-21', requestedDeliveryTime: '02:30' });
    expect(splitRequestedDelivery('2026-10-20')).toEqual({ requestedDeliveryDate: '2026-10-20' });
  });
  it.each(['2026-02-30T10:30', '2026-10-20T25:00', 'tomorrow'])('refuses invalid quote date %s', date => expect(() => splitRequestedDelivery(date)).toThrow());
  it('refuses a quote without an identified destination rather than substituting the sender', () => {
    expect(() => quoteShipmentFields({ ...quote, destinationContact: {} })).toThrow('destinataire');
    expect(() => quoteShipmentFields({ ...quote, destination: '97400' })).toThrow('ville');
  });
  it('takes the postal code from the destination, never a five-digit street number', () => {
    expect(quoteShipmentFields({ ...quote, destinationAddress: '12345 rue Test' })).toMatchObject({ address: '12345 rue Test', postalCode: '97400', city: 'Saint-Denis' });
    expect(() => quoteShipmentFields({ ...quote, destinationAddress: '12345 rue Test', destination: 'Saint-Denis' })).toThrow('code postal');
  });
  it('splits a legacy full address only with the matching explicitly provided city', () => {
    expect(quoteShipmentFields({ ...quote, destinationAddress: '12345 rue Test, 97400 SAINT-DENIS', destination: 'Saint-Denis' })).toMatchObject({ address: '12345 rue Test', postalCode: '97400', city: 'Saint-Denis' });
    expect(quoteShipmentFields({ ...quote, destination: 'Saint-Denis (97400)' })).toMatchObject({ postalCode: '97400', city: 'Saint-Denis' });
    expect(() => quoteShipmentFields({ ...quote, destination: '97400 / 97490 Saint-Denis' })).toThrow('Plusieurs');
  });
});
describe('commercial offer consent', () => {
  it('requires an explicit snapshot of the presented offer', () => {
    expect(matchesQuoteOffer(quote, undefined)).toBe(false);
    expect(matchesQuoteOffer(quote, quoteOfferSnapshot(quote))).toBe(true);
  });
  it.each([{ priceOffer: 150 }, { adminNotes: 'Supplément 100 €' }, { destination: '97410 Saint-Pierre' }, { deliveryDate: '2026-10-21T10:30' }, { deliveryTimeWindow: { start: '14:00', end: '16:00' } }, { weight: 30 }, { goodsDescription: 'Dix cartons' }])('invalidates stale consent after %j', change => {
    const reviewed = quoteOfferSnapshot(quote);
    expect(matchesQuoteOffer({ ...quote, ...change }, reviewed)).toBe(false);
    expect(reviewed.priceOffer).toBe(50);
  });
  it('ignores property ordering and administrative timestamps', () => {
    const snapshot = quoteOfferSnapshot(quote);
    const reordered = JSON.parse(JSON.stringify(snapshot)); reordered.request = Object.fromEntries(Object.entries(reordered.request).reverse());
    expect(matchesQuoteOffer({ ...quote, updatedAt: 'later' }, reordered)).toBe(true);
  });
});
