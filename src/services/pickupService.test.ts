import { it, expect, vi } from 'vitest';
vi.mock('../firebaseConfig', () => ({
  db: {},
  storage: {},
  auth: {},
  default: {},
}));
import { generateBatchLabelsHTML } from './pickupService';
it('escapes recipient, reference and parcel-index fields in printable labels', () => {
  const attack = '<script>window.__unexpected=true</script>';
  const html = generateBatchLabelsHTML(
    [
      {
        barcode: 'TEST',
        orderNumber: 'TEST',
        contactName: attack,
        clientReference: attack,
        packageIndex: attack,
        packageTotal: 2,
        address: attack,
        postalCode: '97400',
        city: attack,
        zone: attack,
        comment: attack,
        clientName: attack,
      },
    ] as any,
    attack,
  );
  expect(html).not.toContain(attack);
  expect(html.match(/&lt;script&gt;/g)).toHaveLength(9);
});
