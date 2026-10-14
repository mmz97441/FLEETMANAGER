import { afterEach, expect, it, vi } from 'vitest';
import { Package, PackageStatus } from '../types';
import { deliveryEvents, summarizeLogistics, logisticsDay } from './logisticsMetrics';
import { computeClientMetrics } from './clientMetrics';
import { buildReportSummary } from '../utils/clientReport';

const parcel = (patch: Partial<Package> = {}): Package => ({
  id: 'parcel', clientId: 'sender', contactName: 'Pharmacie', createdAt: '2026-09-01T05:00:00Z',
  status: PackageStatus.IN_DELIVERY, movements: [], ...patch,
} as Package);
const attempt = (id: string, outcome: 'SUCCESS' | 'FAILURE', recordedAt: string) => ({
  id, missionId: id.split('_')[0], stopId: 'stop', driverId: 'driver', outcome, recordedAt,
});
afterEach(() => vi.useRealTimers());

it('excludes unresolved parcels from success rate and counts final returns consistently in exports', () => {
  const packages = [PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.RETURNED, PackageStatus.IN_DELIVERY, PackageStatus.PENDING]
    .map((status, i) => parcel({ id: String(i), status }));
  expect(summarizeLogistics(packages)).toMatchObject({ delivered: 1, failed: 2, resolved: 3, workInProgress: 2, undatedOutcomes: 3 });
  expect(computeClientMetrics(packages, { period: 'all' }).deliveryRate).toBeCloseTo(100 / 3);
  expect(buildReportSummary(packages).deliveryRate).toBe(33);
});

it('counts old shipments delivered during the selected period without inventing new creations', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T08:00:00Z'));
  const pkg = parcel({ status: PackageStatus.DELIVERED, deliveryAttempts: [attempt('mission_stop', 'SUCCESS', '2026-10-14T05:00:00Z')] });
  const metrics = computeClientMetrics([pkg], { period: '7d' });
  expect(metrics).toMatchObject({ total: 0, delivered: 1, failed: 0, deliveryRate: 100 });
  expect(metrics.byDay).toEqual([{ date: '2026-10-14', total: 0, delivered: 1, failed: 0 }]);
  expect(buildReportSummary([pkg], { start: '2026-10-14', end: '2026-10-14' })).toMatchObject({ total: 0, delivered: 1, deliveryRate: 100 });
});

it('uses the field event at Reunion midnight even if synchronized the following day', () => {
  const recordedAt = '2026-10-13T20:01:00Z';
  const pkg = parcel({ status: PackageStatus.DELIVERED, deliveryAttempts: [{ ...attempt('mission_stop', 'SUCCESS', recordedAt), receivedAt: '2026-10-15T08:00:00Z' }] });
  expect(logisticsDay(recordedAt)).toBe('2026-10-14');
  expect(summarizeLogistics([pkg], { start: '2026-10-14', end: '2026-10-14' }).delivered).toBe(1);
  expect(summarizeLogistics([pkg], { start: '2026-10-15', end: '2026-10-15' }).delivered).toBe(0);
});

it('keeps historical failure after a successful redelivery and deduplicates corresponding movements', () => {
  const pkg = parcel({ status: PackageStatus.DELIVERED,
    deliveryAttempts: [attempt('old_stop', 'FAILURE', '2026-10-12T05:00:00Z'), attempt('new_stop', 'SUCCESS', '2026-10-14T05:00:00Z')],
    movements: [{ action: 'FAILED', missionId: 'old', stopId: 'stop', timestamp: '2026-10-12T05:00:00Z' },
      { action: 'DELIVERED', proofId: 'new_stop', timestamp: '2026-10-14T05:00:00Z' }],
  });
  expect(deliveryEvents(pkg)).toHaveLength(2);
  expect(summarizeLogistics([pkg])).toMatchObject({ delivered: 1, failed: 1, deliveryRate: 50 });
});

it('does not count the physical hub return as an additional failed delivery', () => {
  const pkg = parcel({ status: PackageStatus.RETURNED,
    deliveryAttempts: [attempt('old_stop', 'FAILURE', '2026-10-12T05:00:00Z')],
    movements: [{ action: 'RETURNED', timestamp: '2026-10-14T05:00:00Z' }],
  });
  expect(deliveryEvents(pkg)).toHaveLength(1);
  expect(summarizeLogistics([pkg], { start: '2026-10-14', end: '2026-10-14' }).failed).toBe(0);
});

it('separates the promised deadline from a subsequently recalculated ETA', () => {
  const pkg = parcel({ status: PackageStatus.DELIVERED, requestedDeliveryDate: '2026-10-14', timeWindowEnd: '10:00',
    estimatedDeliveryAt: '2026-10-14T05:00:00Z', deliveryAttempts: [attempt('mission_stop', 'SUCCESS', '2026-10-14T05:30:00Z')] });
  expect(summarizeLogistics([pkg])).toMatchObject({ punctualityRate: 100, etaAdherenceRate: 0 });
  expect(summarizeLogistics([parcel({ ...pkg, requestedDeliveryDate: undefined })]).punctualityRate).toBeNull();
});

it('uses immutable legacy proof time instead of a synchronization-dated DELIVERED movement', () => {
  const pkg = parcel({ status: PackageStatus.DELIVERED,
    pod: { missionId: 'mission', stopId: 'stop', timestamp: '2026-10-13T20:05:00Z', type: 'SUCCESS', photoUrls: [] } as any,
    movements: [{ action: 'DELIVERED', timestamp: '2026-10-15T06:00:00Z' }],
  });
  expect(deliveryEvents(pkg)).toHaveLength(1);
  expect(summarizeLogistics([pkg], { start: '2026-10-14', end: '2026-10-14' }).delivered).toBe(1);
  pkg.deliveryAttempts = [attempt('mission_stop', 'SUCCESS', pkg.pod!.timestamp)];
  expect(deliveryEvents(pkg)).toHaveLength(1);
});

it('uses the promise and ETA snapshot from the visit after a later replanning changes the parcel', () => {
  const pkg = parcel({ status: PackageStatus.DELIVERED, requestedDeliveryDate: '2026-10-16', estimatedDeliveryAt: '2026-10-16T05:00:00Z',
    deliveryAttempts: [{ ...attempt('mission_stop', 'SUCCESS', '2026-10-14T05:30:00Z'), promisedDeliveryAt: '2026-10-14T05:00:00Z', estimatedDeliveryAt: null }] });
  expect(summarizeLogistics([pkg])).toMatchObject({ punctualityRate: 0, etaAdherenceRate: null });
});

it('counts each carton once for a partial stop with mixed senders and a shared proof ID', () => {
  const packages = Array.from({ length: 10 }, (_, i) => parcel({ id: String(i), clientId: `sender-${i % 3}`,
    status: i === 9 ? PackageStatus.FAILED : PackageStatus.DELIVERED,
    deliveryAttempts: [attempt('common_stop', i === 9 ? 'FAILURE' : 'SUCCESS', '2026-10-14T05:00:00Z')],
  }));
  expect(summarizeLogistics(packages)).toMatchObject({ delivered: 9, failed: 1, deliveryRate: 90 });
});

it('excludes undated historical outcomes from date-specific metrics without treating them as newly delivered', () => {
  const pkg = parcel({ status: PackageStatus.DELIVERED, createdAt: '2026-10-14T05:00:00Z', updatedAt: '2026-10-14T06:00:00Z' });
  expect(summarizeLogistics([pkg], { start: '2026-10-14', end: '2026-10-14' })).toMatchObject({ total: 1, delivered: 0, undatedOutcomes: 1 });
});
