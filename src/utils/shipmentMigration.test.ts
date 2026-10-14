import { describe, expect, it } from 'vitest';
import { shipmentMigrationPlan } from '../../functions/src/shipmentMigration';
const parcel = { contactName: 'Pharmacie', address: '10 rue Test', postalCode: '97400', city: 'Saint-Denis', requestedDeliveryDate: '2026-10-20T10:30', status: 'En attente', comment: 'Fragile' };
const quote = { convertedToPackageId: 'p', deliveryDate: parcel.requestedDeliveryDate };
describe('controlled shipment migration', () => {
  it('repairs only proven date fields, preserving instructions and requested hour', () => {
    expect(shipmentMigrationPlan('p', parcel, quote).patch).toEqual({ requestedDeliveryDate: '2026-10-20', requestedDeliveryTime: '10:30', comment: 'Fragile | Heure de livraison souhaitée : 10:30 (La Réunion)', shipmentContractMigration: { version: 1, originalRequestedDeliveryDate: parcel.requestedDeliveryDate } });
  });
  it('reports incomplete addresses without completing them', () => {
    const plan = shipmentMigrationPlan('p', { ...parcel, city: '' }, quote);
    expect(plan.addressIssues).toHaveProperty('city'); expect(plan.patch).not.toHaveProperty('city');
  });
  it.each([{ status: 'Livré' }, { status: 'Échec' }, { missionId: 'm' }, { requestedDeliveryTime: '14:00' }])('leaves historical, planned and conflicting parcels untouched: %j', change => {
    expect(shipmentMigrationPlan('p', { ...parcel, ...change }, quote).patch).toBeUndefined();
  });
  it('refuses absent or changed provenance and is idempotent after apply', () => {
    expect(shipmentMigrationPlan('p', parcel).patch).toBeUndefined();
    expect(shipmentMigrationPlan('p', parcel, { ...quote, deliveryDate: '2026-10-21T10:30' }).patch).toBeUndefined();
    const patch = shipmentMigrationPlan('p', parcel, quote).patch;
    expect(shipmentMigrationPlan('p', { ...parcel, ...patch }, quote).patch).toBeUndefined();
  });
});
