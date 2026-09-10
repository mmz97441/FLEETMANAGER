import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Package, Hub } from '../types';
import type { GMPROResult } from './cloudFunctions';
import { optimizeMultiVehicle, type DriverVehicle } from './gmproService';

const mocked = vi.hoisted(() => ({ optimize: vi.fn(), fetch: vi.fn() }));
vi.mock('./cloudFunctions', () => ({ optimizeToursCF: mocked.optimize }));

const parcel = (id: string, fields: Partial<Package> = {}): Package => ({
  id, address: `Rue ${id}`, city: 'Saint-Denis', postalCode: '97400',
  contactName: `Client ${id}`, coordinates: { lat: -20.9, lng: 55.5 }, ...fields,
} as Package);
const hub = { address: 'Hub', city: 'Saint-Denis', postalCode: '97400', coordinates: { lat: -20.9, lng: 55.4 }, closingTime: '20:00' } as Hub;
const drivers = [{ driver: { id: 'driver', firstName: 'Jean', lastName: 'Dupont' } }] as DriverVehicle[];
const run = (packages: Package[], selectedHub = hub) => optimizeMultiVehicle(packages, drivers, selectedHub, '2026-09-10', 'test-key');
const response = (route: NonNullable<GMPROResult['routes']>[number] = {}): GMPROResult => ({
  routes: [{ visits: [{ startTime: '2026-09-10T04:30:00Z' }], ...route }],
});

beforeEach(() => {
  mocked.optimize.mockReset();
  mocked.optimize.mockResolvedValue(response());
  mocked.fetch.mockReset();
  mocked.fetch.mockResolvedValue({ json: async () => ({ status: 'ZERO_RESULTS', results: [] }) });
  vi.stubGlobal('fetch', mocked.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('customer time windows', () => {
  it.each(['08:15', '08:05'])('keeps an arrival window ending at %s instead of removing it', async end => {
    const result = await run([parcel('a', { timeWindowStart: '08:00', timeWindowEnd: end })]);
    expect(result.success).toBe(true);
    expect(mocked.optimize.mock.calls[0][0].shipments[0].deliveries[0].timeWindows).toEqual([
      { startTime: '2026-09-10T08:00:00+04:00', endTime: `2026-09-10T${end}:00+04:00` },
    ]);
  });

  it('intersects every parcel window at the same address', async () => {
    const result = await run([
      parcel('a', { address: 'Même adresse', timeWindowStart: '09:00', timeWindowEnd: '10:00' }),
      parcel('b', { address: 'Même adresse', timeWindowStart: '09:30', timeWindowEnd: '10:30' }),
    ]);
    expect(mocked.optimize.mock.calls[0][0].shipments).toHaveLength(1);
    expect(mocked.optimize.mock.calls[0][0].shipments[0].deliveries[0].timeWindows).toEqual([
      { startTime: '2026-09-10T09:30:00+04:00', endTime: '2026-09-10T10:00:00+04:00' },
    ]);
    expect(result.tours[0].stops[0]).toMatchObject({ timeWindowStart: '09:30', timeWindowEnd: '10:00', packageCount: 2 });
  });

  it('refuses incompatible grouped windows with an actionable error before calling Google', async () => {
    const result = await run([
      parcel('a', { address: 'Même adresse', timeWindowStart: '09:00', timeWindowEnd: '10:00' }),
      parcel('b', { address: 'Même adresse', timeWindowStart: '11:00', timeWindowEnd: '12:00' }),
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Créneaux incompatibles.*Même adresse/);
    expect(mocked.optimize).not.toHaveBeenCalled();
  });

  it('refuses an expired window instead of silently promising an unconstrained delivery', async () => {
    const result = await run([parcel('a', { timeWindowStart: '07:00', timeWindowEnd: '07:45' })]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Créneaux incompatibles');
    expect(mocked.optimize).not.toHaveBeenCalled();
  });

  it('keeps one-sided windows instead of ignoring them', async () => {
    await run([parcel('a', { timeWindowEnd: '09:00' })]);
    expect(mocked.optimize.mock.calls[0][0].shipments[0].deliveries[0].timeWindows).toEqual([
      { startTime: '2026-09-10T08:00:00+04:00', endTime: '2026-09-10T09:00:00+04:00' },
    ]);
  });

  it('refuses a departure after the hub closes', async () => {
    const result = await run([parcel('a')], { ...hub, closingTime: '07:00' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('départ doit précéder');
    expect(mocked.optimize).not.toHaveBeenCalled();
  });
});

describe('route duration and travel legs', () => {
  it('uses the whole tour duration, not travel-only duration', async () => {
    mocked.optimize.mockResolvedValue(response({ metrics: { totalDuration: '7200s', travelDuration: '3600s', travelDistanceMeters: 15_000 } }));
    const result = await run([parcel('a')]);
    expect(result.tours[0].estimatedDuration).toBe(120);
    expect(result.totalDuration).toBe(120);
    expect(result.totalDistance).toBe(15);
  });

  it('persists travel legs, distances and departure times without putting service or idle waiting in the leg', async () => {
    mocked.optimize.mockResolvedValue(response({
      visits: [{ startTime: '2026-09-10T05:00:00Z' }, { shipmentIndex: 1, startTime: '2026-09-10T05:25:00Z' }],
      transitions: [
        { travelDuration: '1800s', waitDuration: '1800s', totalDuration: '3600s', travelDistanceMeters: 10_000 },
        { travelDuration: '1200s', totalDuration: '1200s', travelDistanceMeters: 6_000 },
        { travelDuration: '600s', totalDuration: '600s' },
      ],
    }));
    const result = await run([parcel('a', { timeWindowStart: '09:00' }), parcel('b')]);
    expect(result.tours[0].stops[0]).toMatchObject({ durationFromPrevious: 30, distanceFromPrevious: 10, estimatedDeparture: '2026-09-10T05:05:00.000Z' });
    expect(result.tours[0].stops[1]).toMatchObject({ durationFromPrevious: 20, distanceFromPrevious: 6 });
    // 60 minutes first transition + 20 second + 10 return + 10 service.
    expect(result.tours[0].estimatedDuration).toBe(100);
  });

  it('includes waiting and service when totalDuration is absent', async () => {
    mocked.optimize.mockResolvedValue(response({
      visits: [{}, { shipmentIndex: 1 }],
      metrics: { travelDuration: '3600s', waitDuration: '900s' },
    }));
    const result = await run([parcel('a'), parcel('b')]);
    expect(result.tours[0].estimatedDuration).toBe(85);
  });

  it('uses visit timestamps minus previous service for older responses without transitions', async () => {
    mocked.optimize.mockResolvedValue(response({
      vehicleStartTime: '2026-09-10T04:00:00Z',
      visits: [{ startTime: '2026-09-10T04:30:00Z' }, { shipmentIndex: 1, startTime: '2026-09-10T04:50:00Z' }],
    }));
    const result = await run([parcel('a'), parcel('b')]);
    expect(result.tours[0].stops.map(stop => stop.durationFromPrevious)).toEqual([30, 15]);
  });

  it('does not replace valid zero metrics with geographical estimates', async () => {
    mocked.optimize.mockResolvedValue(response({ metrics: { totalDuration: '0s', travelDistanceMeters: 0 } }));
    const result = await run([parcel('a')]);
    expect(result.tours[0]).toMatchObject({ estimatedDuration: 0, totalDistance: 0 });
  });
});

describe('unrouted parcels and geocoding failures', () => {
  it('counts and identifies both ungeocoded stops and optional Google skips even when mandatory skips is zero', async () => {
    mocked.optimize.mockResolvedValue({ ...response(), metrics: { skippedMandatoryShipmentCount: 0 } });
    const result = await run([parcel('a'), parcel('b'), parcel('c', { coordinates: undefined })]);
    expect(result.success).toBe(true);
    expect(result.totalPackages).toBe(1);
    expect(result.skippedShipments).toBe(2);
    expect(result.skippedStopNames).toEqual([
      expect.stringContaining('Client c — Rue c, Saint-Denis (1 colis) — adresse non localisée'),
      expect.stringContaining('Client b — Rue b, Saint-Denis (1 colis) — non affecté'),
    ]);
  });

  it('reports every excluded stop when Google returns no routes', async () => {
    mocked.optimize.mockResolvedValue({ routes: [] });
    const result = await run([parcel('a'), parcel('b', { coordinates: undefined })]);
    expect(result.success).toBe(false);
    expect(result.skippedShipments).toBe(2);
    expect(result.skippedStopNames).toHaveLength(2);
  });

  it('does not claim a usable fallback when the hub cannot be geocoded', async () => {
    const result = await run([parcel('a')], { ...hub, coordinates: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toContain('hub ne peut pas être localisé');
    expect(result.tours).toEqual([]);
    expect(mocked.optimize).not.toHaveBeenCalled();
  });

  it('does not drop constraints through fallback when no delivery address can be geocoded', async () => {
    const result = await run([parcel('a', { coordinates: undefined, timeWindowStart: '09:00', timeWindowEnd: '10:00' })]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Aucune adresse');
    expect(result.skippedShipments).toBe(1);
    expect(mocked.optimize).not.toHaveBeenCalled();
  });

  it('uses valid coordinates from another parcel at the same address', async () => {
    const result = await run([parcel('a', { address: 'Même adresse', coordinates: undefined }), parcel('b', { address: 'Même adresse' })]);
    expect(result.success).toBe(true);
    expect(result.totalPackages).toBe(2);
    expect(result.skippedShipments).toBe(0);
  });

  it('refuses duplicated assignments in an inconsistent optimizer response', async () => {
    mocked.optimize.mockResolvedValue(response({ visits: [{}, {}] }));
    const result = await run([parcel('a')]);
    expect(result.success).toBe(false);
    expect(result.error).toContain('affectés plusieurs fois');
    expect(result.tours).toEqual([]);
  });

  it('reports optimizer errors without switching to a misleading fallback', async () => {
    mocked.optimize.mockRejectedValue(new Error('API indisponible'));
    const result = await run([parcel('a')]);
    expect(result).toMatchObject({ success: false, method: 'gmpro', error: 'API indisponible' });
  });
});
