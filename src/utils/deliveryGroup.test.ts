import { describe, expect, it } from 'vitest';
import { deliveryStopGroup, sameDeliveryRecipient } from './deliveryGroup';
import { packageDisplayCode } from './barcode';

const point = { address: '28 rue Joseph Bédier', postalCode: '97400', city: 'Saint-Denis', contactName: 'Pharmacie du Centre' };
const stop = { ...point, id: 'one', type: 'DELIVERY', status: 'En attente', packageIds: ['p1'] };
describe('a shared delivery for one recipient', () => {
  it('groups the same pharmacy with normalized names and addresses despite different parcel references', () => {
    const second = { ...stop, id: 'two', address: '28 RUE JOSEPH BEDIER', contactName: 'PHARMACIE DU CENTRE', packageIds: ['p2'] };
    expect(deliveryStopGroup([stop, second], stop)).toEqual([stop, second]);
  });
  it('does not infer a recipient from a phone or shared street address', () => {
    expect(sameDeliveryRecipient(point, { ...point, contactName: 'Autre pharmacie' })).toBe(false);
    expect(sameDeliveryRecipient({ ...point, contactPhone: '0692000000' }, { ...point, address: '30 rue Joseph Bédier', contactPhone: '0692000000' })).toBe(false);
    expect(sameDeliveryRecipient({ ...point, address: '' }, { ...point, address: '' })).toBe(false);
  });
  it('keeps different floors and delivery time windows separate', () => {
    expect(sameDeliveryRecipient(point, { ...point, floor: 2 })).toBe(false);
    expect(deliveryStopGroup([stop, { ...stop, id: 'two', timeWindowStart: '16:00' }], stop)).toEqual([stop]);
  });
  it('never absorbs a started delivery, a proof awaiting upload, or a pickup', () => {
    for (const change of [{ status: 'Arrivé' }, { status: 'Terminé' }, { proofSyncPending: true }, { type: 'PICKUP' }])
      expect(deliveryStopGroup([stop, { ...stop, id: 'two', ...change }], stop)).toEqual([stop]);
  });
  it('can add pending parcels to the selected arrived stop', () => {
    const arrived = { ...stop, status: 'Arrivé' }, pending = { ...stop, id: 'two' };
    expect(deliveryStopGroup([arrived, pending], arrived)).toEqual([arrived, pending]);
  });
  it('prefers the physical BR to an internal tracking reference while keeping other clients readable', () => {
    expect(packageDisplayCode({ barcode: 'GFL-123', orderNumber: ' br1001 ' })).toBe('BR1001');
    expect(packageDisplayCode({ externalId: 'BR1002', barcode: 'GFL-456' })).toBe('BR1002');
    expect(packageDisplayCode({ barcode: 'GFL-123' })).toBe('GFL-123');
  });
});
