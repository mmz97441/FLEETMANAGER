import { describe, expect, it } from 'vitest';
import { Package, PackageStatus } from '../types';
import { clientGroupSummary, clientParcelGroups, clientParcelNeedsAttention, clientParcelStatus, matchesClientParcel } from './clientParcelView';

const parcel = (id: string, patch: Partial<Package> = {}): Package => ({ id, status: PackageStatus.PENDING,
  contactName: 'Client A', address: '1 rue Test', postalCode: '97400', city: 'Saint-Denis', createdAt: '2026-10-14T00:30:00+04:00',
  externalId: `EXP-${id}`, orderNumber: `CMD-${id}`, ...patch } as Package);

describe('client parcel context', () => {
  it('keeps ten cartons visible when one is opened or found by the client reference', () => {
    const parcels = Array.from({ length: 10 }, (_, i) => parcel(String(i), { clientReference: i === 4 ? 'COMMANDE-CLIENT-42' : undefined }));
    expect(clientParcelGroups(parcels, 'all', '', '4')[0].packages).toHaveLength(10);
    const found = clientParcelGroups(parcels, 'all', ' commande-client-42 ');
    expect(found).toHaveLength(1); expect(found[0].matches).toBe(1); expect(found[0].packages).toHaveLength(10);
    expect(found[0].day).toBe('2026-10-14');
  });
  it('separates different recipients and floors at the same physical address', () => {
    expect(clientParcelGroups([parcel('1'), parcel('2', { contactName: 'Client B' }), parcel('3', { floor: 2 })], 'all')).toHaveLength(3);
    expect(clientParcelGroups([parcel('1', { city: '' }), parcel('2', { city: '' })], 'all')).toHaveLength(2);
  });
  it('can open a linked group excluded by the current filters without losing other matches', () => {
    const groups = clientParcelGroups([parcel('1'), parcel('2', { status: PackageStatus.DELIVERED, contactName: 'Client B' })], 'pending', '', '2');
    expect(groups).toHaveLength(2); expect(groups.find(group => group.packages[0].id === '2')?.matches).toBe(0);
  });
  it('never presents a partial shipment as complete, regardless of ordering', () => {
    const delivered = parcel('1', { status: PackageStatus.DELIVERED }), missing = parcel('2', { pickupMissing: {} as Package['pickupMissing'] });
    expect(clientGroupSummary([delivered, missing])).toMatchObject({ label: '1 livrés · 1 à traiter', tone: 'warning' });
    expect(clientGroupSummary([missing, delivered])).toEqual(clientGroupSummary([delivered, missing]));
    expect(clientGroupSummary([delivered, parcel('3')]).tone).toBe('info');
    expect(clientGroupSummary([delivered, { ...delivered, id: '4' }])).toMatchObject({ label: 'Tous livrés', tone: 'success' });
  });
  it('distinguishes missing pickup, pending return decision and physical sender return', () => {
    expect(clientParcelStatus(parcel('1', { pickupMissing: {} as Package['pickupMissing'] })).label).toBe('Absent à l’enlèvement');
    expect(clientParcelStatus(parcel('2', { status: PackageStatus.AT_HUB, returnDisposition: 'AWAITING_DECISION' })).label).toContain('décision attendue');
    const returned = parcel('3', { status: PackageStatus.RETURNED, returnDisposition: 'SENDER_RETURNED' });
    expect(clientParcelStatus(returned).label).toBe('Remis à l’expéditeur'); expect(clientParcelNeedsAttention(returned)).toBe(false);
    expect(clientGroupSummary([returned, { ...returned, id: '4' }]).tone).toBe('neutral');
  });
  it('searches generic, numeric and carrier references without removing leading zeros', () => {
    const value = parcel('1', { externalId: 'EXP/A-00042', carrierBarcode: '000012345678', clientReference: 'Été 2026' });
    expect(matchesClientParcel(value, 'all', 'exp/a-00042')).toBe(true);
    expect(matchesClientParcel(value, 'all', '000012345678')).toBe(true);
    expect(matchesClientParcel(value, 'all', 'ete 2026')).toBe(true);
    expect(matchesClientParcel(value, 'attention')).toBe(false);
  });
});
