import { expect, it } from 'vitest';
import { PackageStatus, type Package } from '../../src/types';
import { computeClientMetrics } from '../../src/services/clientMetrics';
const base = { address: '1 rue Fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Pharmacie A', createdAt: '2026-10-01T05:00:00Z', movements: [] };
it('LOG-09: all views count returns as decisions and exclude work in progress', () => {
  const pkgs = [PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.RETURNED, PackageStatus.IN_DELIVERY, PackageStatus.PENDING].map((status, i) => ({ ...base, id: String(i), status })) as Package[];
  const metrics = computeClientMetrics(pkgs, { period: 'all' });
  expect(metrics.failed).toBe(2);
  expect(metrics.deliveryRate).toBeCloseTo(100 / 3);
  expect(metrics.workInProgress).toBe(2);
});
it('LOG-09: creation and handover are independent event dates', () => {
  const pkg = { ...base, id: 'old', status: PackageStatus.DELIVERED, createdAt: '2026-10-12T05:00:00Z', movements: [{ action: 'DELIVERED', timestamp: '2026-10-14T05:00:00Z' }] } as Package;
  expect(computeClientMetrics([pkg], { period: 'all' }).byDay).toEqual([
    { date: '2026-10-12', total: 1, delivered: 0, failed: 0 },
    { date: '2026-10-14', total: 0, delivered: 1, failed: 0 },
  ]);
});
