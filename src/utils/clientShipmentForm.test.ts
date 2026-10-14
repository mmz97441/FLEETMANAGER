import { describe, expect, it } from 'vitest';
import { shipmentImportCounts, validateClientShipment, type ClientShipmentFields } from './clientShipmentForm';

const valid: ClientShipmentFields = { contactName: 'Pharmacie', address: '12 rue des Lilas', postalCode: '97400', city: 'Saint-Denis', contactPhone: '0262123456', contactEmail: '', packageCount: 1, weight: '' };
describe('client shipment validation', () => {
  it('requires a structured address while accepting optional email/weight', () => {
    expect(validateClientShipment({ ...valid, postalCode: '' })).toHaveProperty('postalCode');
    expect(validateClientShipment(valid)).toEqual({});
  });
  it('explains missing required fields', () => {
    expect(Object.keys(validateClientShipment({ ...valid, contactName: '', address: '', postalCode: '', city: '', contactPhone: '' }))).toEqual(['contactName', 'address', 'postalCode', 'city', 'contactPhone']);
  });
  it.each([0, 51, 1.5, NaN])('rejects invalid quantity %s instead of silently clamping', packageCount => {
    expect(validateClientShipment({ ...valid, packageCount }).packageCount).toBeTruthy();
  });
  it('rejects invalid optional values and keeps valid ones', () => {
    expect(Object.keys(validateClientShipment({ ...valid, contactEmail: 'oops', postalCode: '974', weight: '-1' }))).toEqual(['postalCode', 'contactEmail', 'weight']);
    expect(validateClientShipment({ ...valid, weight: '0.5', contactEmail: 'test@example.org' })).toEqual({});
  });
});
describe('import outcome counts', () => {
  it('keeps confirmed, pending, invalid and duplicate groups disjoint', () => {
    const rows = [{ line: 2, errors: [] }, { line: 3, errors: [] }, { line: 4, errors: ['Adresse manquante'] }, { line: 5, errors: ['Numéro en double', 'Adresse manquante'] }];
    const result = shipmentImportCounts(rows, new Set([2]));
    expect(result).toEqual({ total: 4, confirmed: 1, pending: 1, invalid: 1, duplicates: 1 });
    expect(result.confirmed + result.pending + result.invalid + result.duplicates).toBe(result.total);
  });
});

it('preserves optional windows and rejects invalid dates or inverted windows', () => {
  expect(validateClientShipment({ ...valid, requestedDeliveryDate: '2026-02-30' }).requestedDeliveryDate).toBeTruthy();
  expect(validateClientShipment({ ...valid, requestedDeliveryDate: '2026-10-13' }, '2026-10-14').requestedDeliveryDate).toBeTruthy();
  expect(validateClientShipment({ ...valid, requestedDeliveryDate: '2026-10-13' })).toEqual({}); // unchanged retry
  expect(validateClientShipment({ ...valid, timeWindowStart: '15:00', timeWindowEnd: '09:00' }).timeWindowEnd).toBeTruthy();
  expect(validateClientShipment({ ...valid, requestedDeliveryDate: '2026-10-15', timeWindowEnd: '09:00' }, '2026-10-14')).toEqual({});
});
