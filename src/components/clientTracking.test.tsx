import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Package, PackageStatus, User } from '../types';
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}) } }));
vi.mock('react-leaflet', () => ({ MapContainer: ({ children }: any) => <div data-map="true">{children}</div>, TileLayer: () => null, Marker: () => null, Popup: () => null, useMap: () => ({}) }));
import ClientLiveTracking from './ClientLiveTracking';
const parcel = { id: 'p', status: PackageStatus.IN_DELIVERY, contactName: 'Pharmacie', externalId: 'EXP-00001' } as Package;
afterEach(() => vi.useRealTimers());
it.each([undefined, { lat: -21, lng: 55.5, updatedAt: '2026-10-14T04:00:00Z' }])('keeps an in-delivery parcel visible with missing or stale GPS', liveDriver => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T05:00:00Z'));
  const html = renderToStaticMarkup(<ClientLiveTracking packages={[{ ...parcel, liveDriver }]} currentUser={{} as User} />);
  expect(html).toContain('1 colis en cours de livraison'); expect(html).toContain('EXP-00001'); expect(html).toContain('Position temporairement indisponible');
  expect(html).not.toContain('Aucune livraison en cours'); expect(html).not.toContain('en préparation'); expect(html).not.toContain('data-map');
});
it('maps only fresh positions and keeps the other active parcel in the list', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T05:00:00Z'));
  const html = renderToStaticMarkup(<ClientLiveTracking packages={[parcel, { ...parcel, id: 'fresh', externalId: 'BR-00002', liveDriver: { lat: -21, lng: 55.5, updatedAt: '2026-10-14T04:59:00Z' } }]} currentUser={{} as User} />);
  expect(html).toContain('2 colis en cours de livraison'); expect(html).toContain('data-map'); expect(html).toContain('EXP-00001'); expect(html).toContain('BR-00002');
});
