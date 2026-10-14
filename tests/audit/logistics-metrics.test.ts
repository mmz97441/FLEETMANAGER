// Characterization tests for the 2026-10-14 audit, run explicitly (not npm test).
import { expect, it, vi } from 'vitest';
import { PackageStatus, type Package, type Hub } from '../../src/types';
import { computeClientMetrics } from '../../src/services/clientMetrics';
const mocked = vi.hoisted(() => ({ optimize: vi.fn() }));
vi.mock('../../src/services/cloudFunctions', () => ({ optimizeToursCF: mocked.optimize }));
import { optimizeMultiVehicle, type DriverVehicle } from '../../src/services/gmproService';
const base = { address: '1 rue Fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Pharmacie A', coordinates: { lat: -20.9, lng: 55.5 }, createdAt: '2026-10-01T05:00:00Z', movements: [] };
it('LOG-02: optimization also puts two recipients at one address in one stop', async () => {
  mocked.optimize.mockResolvedValue({ routes: [{ visits: [{ startTime: '2026-10-14T04:30:00Z' }] }] });
  const pkgs = [{ ...base, id: 'a', floor: 0 }, { ...base, id: 'b', contactName: 'Cabinet B', floor: 2 }] as Package[];
  const hub = { ...base, closingTime: '20:00' } as unknown as Hub;
  const drivers = [{ driver: { id: 'driver', firstName: 'Fictif', lastName: 'Audit' } }] as DriverVehicle[];
  const result = await optimizeMultiVehicle(pkgs, drivers, hub, '2026-10-14', 'synthetic-key');
  expect(result.success).toBe(true);
  expect(result.tours[0].stops).toHaveLength(1);
  expect(result.tours[0].stops[0]).toMatchObject({ contactName: 'Pharmacie A', floor: 0, packageIds: ['a', 'b'] });
});
it('LOG-09: analytical delivery rate omits returns and includes work in progress', () => {
  const pkgs = [PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.IN_DELIVERY, PackageStatus.PENDING].map((status, i) => ({ ...base, id: String(i), status })) as Package[];
  const metrics = computeClientMetrics(pkgs, { period: 'all' });
  expect(metrics.failed).toBe(0); // ClientKPIs counts the returned parcel as a failure.
  expect(metrics.deliveryRate).toBe(50); // Happens to match 1/(1+1); expose rates with a second return below.
  pkgs.push({ ...base, id: '4', status: PackageStatus.RETURNED } as Package);
  expect(computeClientMetrics(pkgs, { period: 'all' }).deliveryRate).toBe(50);
  const clientKpiRate = Math.round(100 * 1 / (1 + 2));
  const missionKpiRate = Math.round(100 * 1 / pkgs.length);
  expect([clientKpiRate, missionKpiRate]).toEqual([33, 20]);
});
it('LOG-09: a shipment created yesterday and delivered today is charted on creation day', () => {
  const pkg = { ...base, id: 'old', status: PackageStatus.DELIVERED, createdAt: '2026-10-12T05:00:00Z', movements: [{ action: 'DELIVERED', timestamp: '2026-10-14T05:00:00Z' }] } as Package;
  const metrics = computeClientMetrics([pkg], { period: 'all' });
  expect(metrics.byDay).toEqual([{ date: '2026-10-12', total: 1, delivered: 1 }]);
});
