import { describe, expect, it } from 'vitest';
import { trackingCodeForRequest } from './shipmentRequest';
import { indexImportedPackageIds } from './importedPackageIds';
import { notificationDestination } from './notificationDestination';
import { authErrorMessage } from './authFeedback';
import { packageMatchesCode } from './barcode';

describe('UX recovery without losing business identity', () => {
  const request = 'c66329c6-54e7-469f-9fdb-17cda946c15d';
  it('reuses package identities for retries but separates parcels and new requests', () => {
    const first = [1, 2, 3].map(i => trackingCodeForRequest(request, i));
    expect([1, 2, 3].map(i => trackingCodeForRequest(request, i))).toEqual(first);
    expect(new Set(first).size).toBe(3);
    expect(trackingCodeForRequest('c66329c6-54e7-469f-9fdb-17cda946c15e', 1)).not.toBe(first[0]);
    expect(trackingCodeForRequest(request.toUpperCase(), 1)).toBe(first[0]);
    expect(first[0]).toMatch(/^CL-\d{42}$/);
    expect(packageMatchesCode({ barcode: first[0] }, first[0])).toBe(true);
    expect(packageMatchesCode({ barcode: first[0] }, first[1])).toBe(false);
  });
  it('rejects malformed request identities and fractional parcel numbers', () => {
    expect(() => trackingCodeForRequest('retry', 1)).toThrow();
    expect(() => trackingCodeForRequest(request, 1.5)).toThrow();
  });
  it('keeps imported IDs attached to their real zones when file rows alternate', () => {
    const grouped = indexImportedPackageIds([{ zone: 'Sud' }, { zone: 'Nord' }, { zone: 'Sud' }, { zone: 'Ouest' }], ['s1', 'n1', 's2', 'o1']);
    expect(grouped.get('Sud')).toEqual(['s1', 's2']);
    expect(grouped.get('Nord')).toEqual(['n1']);
    expect(grouped.get('Ouest')).toEqual(['o1']);
  });
  it('does not present a partial response as a complete import', () => {
    expect(() => indexImportedPackageIds([{ zone: 'Sud' }, { zone: 'Nord' }], ['s1'])).toThrow(/incomplet/);
  });
  it('opens the notified parcel in the correct office tab', () => {
    expect(notificationDestination({ actionType: 'navigate', actionTarget: 'missions', metadata: { missionId: 'm1', packageId: 'p1' } })).toEqual({ view: 'missions', params: { mission: 'm1', package: 'p1', tab: 'packages', scope: 'all' } });
  });
  it('only accepts internal known destinations and valid entity IDs', () => {
    for (const target of ['javascript:alert(1)', '//evil.invalid', 'https://evil.invalid', '/unknown', '/\\evil.invalid']) {
      expect(notificationDestination({ actionType: 'navigate', actionTarget: target })).toBeNull();
    }
    expect(notificationDestination({ actionType: 'navigate', actionTarget: '/driver-tour', metadata: { missionId: '../x' } })).toEqual({ view: 'driver_tour', params: {} });
  });
  it('explains a network failure without blaming credentials', () => {
    expect(authErrorMessage({ code: 'auth/network-request-failed' })).toMatch(/réseau/);
    expect(authErrorMessage({ code: 'auth/network-request-failed' })).not.toMatch(/incorrect/);
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toMatch(/incorrect/);
  });
});
