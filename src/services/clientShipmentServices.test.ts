import { beforeEach, expect, it, vi } from 'vitest';
const { calls } = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {}, auth: {}, storage: {} }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: (_functions: unknown, name: string) => (data: unknown) => calls(name, data) }));
vi.mock('./scanService', () => ({ scanPackage: vi.fn() }));
vi.mock('./clientPackageSubscription', () => ({ listenClientPackages: vi.fn() }));
vi.mock('./missionStopEditor', () => ({ editMissionStop: vi.fn(), deleteMissionStop: vi.fn(), reorderStops: vi.fn() }));
vi.mock('./gmproService', () => ({ geocodeAddress: vi.fn(), getGoogleMapsApiKey: vi.fn() }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
import { createClientShipmentsBatch } from './missionService';
import { convertQuoteToPackage } from './deliveryService';
import { quoteOfferSnapshot } from '../utils/quoteOffer';
import type { QuoteRequest, User } from '../types';
const row = { colisNumber: '0000123', contactName: 'Pharmacie', address: '1 rue Test', city: 'Saint-Denis', postalCode: '97400' };
beforeEach(() => { calls.mockReset(); });
it('client batch sends each row constraint and applies the default date only to empty rows', async () => {
  calls.mockImplementation(async (_name, data) => ({ data: { ids: data.packages.map((p: { externalId: string }) => p.externalId) } }));
  const result = await createClientShipmentsBatch({ client: { id: 'client', companyName: 'Fictif' }, deliveryDate: '2026-10-20', rows: [
    { ...row, requestedDeliveryDate: '2026-10-21', timeWindowStart: '08:00', timeWindowEnd: '09:00', serviceTime: 20, floor: 0, comment: 'Digicode 1234' },
    { ...row, colisNumber: '0000124', timeWindowStart: '14:00', timeWindowEnd: '15:00', serviceTime: 15 },
  ] });
  expect(calls.mock.calls[0][1].packages[0]).toMatchObject({ requestedDeliveryDate: '2026-10-21', timeWindowStart: '08:00', timeWindowEnd: '09:00', serviceTime: 20, floor: 0, comment: 'Digicode 1234', externalId: '0000123' });
  expect(result[0].movements[0].notes).toContain('2026-10-21');
  expect(result[1]).toMatchObject({ requestedDeliveryDate: '2026-10-20', timeWindowStart: '14:00', timeWindowEnd: '15:00', serviceTime: 15 });
});
it('the real service reports the first 75 records before a second callable fails', async () => {
  const confirmed = vi.fn();
  calls.mockResolvedValueOnce({ data: { ids: Array.from({ length: 75 }, (_, i) => `id-${i}`) } }).mockRejectedValueOnce(new Error('Network interrupted'));
  await expect(createClientShipmentsBatch({ client: { id: 'client', companyName: 'Fictif' }, rows: Array.from({ length: 150 }, (_, i) => ({ ...row, colisNumber: `REF-${i}` })), onConfirmed: confirmed })).rejects.toMatchObject({ confirmedCount: 75, outcome: 'unknown' });
  expect(confirmed).toHaveBeenCalledTimes(1); expect(confirmed.mock.calls[0][0]).toHaveLength(75);
  expect(confirmed.mock.calls[0][0][74]).toMatchObject({ id: 'id-74', externalId: 'REF-74' });
});
it('quote conversion transmits the captured offer even if the live quote changed since the confirmation opened', async () => {
  calls.mockResolvedValue({ data: { packageId: 'p', zone: 'Nord' } });
  const quote = { id: 'q', priceOffer: 50, adminNotes: 'Frais inclus' } as QuoteRequest;
  const reviewed = quoteOfferSnapshot(quote);
  await convertQuoteToPackage({ ...quote, priceOffer: 150 }, {} as User, reviewed);
  expect(calls).toHaveBeenCalledWith('acceptQuote', { quoteId: 'q', expectedOffer: reviewed });
  await expect(convertQuoteToPackage(quote, {} as User)).rejects.toThrow('Rouvrez');
  expect(calls).toHaveBeenCalledTimes(1);
});
