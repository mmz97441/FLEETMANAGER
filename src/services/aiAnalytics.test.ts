import { it, expect, vi, beforeEach } from 'vitest';
const calls = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {} }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => calls.invoke,
}));
import { runQuery } from './aiAnalytics';
import { Package, PackageStatus } from '../types';
const spec = {
  metric: 'volume',
  dimension: 'none',
  period: 'all',
  chart: 'kpi',
};
const response = (value: unknown) => ({
  data: { text: JSON.stringify(value) },
});
beforeEach(() => {
  calls.invoke.mockReset();
});
it('calculates counts from packages and ignores model-supplied numbers', async () => {
  calls.invoke.mockResolvedValue(response({ ...spec, value: 999 }));
  const result = await runQuery(
    [
      { id: 'a', createdAt: '2020-01-01', status: 'En attente' },
      { id: 'b', createdAt: '2020-01-02', status: 'En attente' },
    ] as any,
    'Combien de colis ?',
    { pharmacies: [], zones: [] },
  );
  expect(result).toHaveProperty('kpi.value', '2');
});
it('asks for clarification when interpretations disagree about the period', async () => {
  calls.invoke
    .mockResolvedValueOnce(response(spec))
    .mockResolvedValueOnce(response({ ...spec, period: 'month' }));
  const result = await runQuery([], 'Colis récents', {
    pharmacies: [],
    zones: [],
  });
  expect(result).toHaveProperty('error');
  expect((result as any).error).toContain('ambiguë');
});
it('reports unavailable service without asking the user to rewrite a valid question', async () => {
  calls.invoke.mockRejectedValue(new Error('unavailable'));
  const result = await runQuery([], 'Combien de colis ?', {
    pharmacies: [],
    zones: [],
  });
  expect((result as any).error).toContain('indisponible');
});

it('uses the same resolved-attempt denominator for the global KPI and zone groups', async () => {
  const packages = [PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.RETURNED, PackageStatus.IN_DELIVERY]
    .map((status, i) => ({ id: String(i), status, createdAt: '2020-01-01', zone: 'Nord', movements: [] })) as unknown as Package[];
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'deliveryRate' }));
  expect(await runQuery(packages, 'Taux global', { pharmacies: [], zones: ['Nord'] })).toHaveProperty('kpi.value', '33');
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'deliveryRate', dimension: 'zone', chart: 'bar' }));
  expect(await runQuery(packages, 'Taux par zone', { pharmacies: [], zones: ['Nord'] })).toHaveProperty('series', [{ name: 'Zone historique non renseignée', value: 33 }]);
});

it('groups delivered volume by the field handover day, independently of creation', async () => {
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'delivered', dimension: 'day', chart: 'line' }));
  const packages = [{ id: 'old', status: PackageStatus.DELIVERED, createdAt: '2020-01-01',
    movements: [{ action: 'DELIVERED', timestamp: '2026-10-13T20:01:00Z' }],
  }] as Package[];
  expect(await runQuery(packages, 'Livrés par jour', { pharmacies: [], zones: [] })).toHaveProperty('series', [{ name: '2026-10-14', value: 1 }]);
});

it('retains the actual collection time when grouping delivery delays by handover day', async () => {
  const packages = [{ id: 'old', status: PackageStatus.DELIVERED, createdAt: '2020-01-01',
    movements: [{ action: 'COLLECTED', timestamp: '2026-10-14T07:00:00Z' }, { action: 'DELIVERED', timestamp: '2026-10-14T09:00:00Z' }],
  }] as Package[];
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'avgDelayHours' }));
  expect(await runQuery(packages, 'Délai moyen', { pharmacies: [], zones: [] })).toHaveProperty('kpi.value', '2h');
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'avgDelayHours', dimension: 'day', chart: 'line' }));
  expect(await runQuery(packages, 'Délai moyen par jour', { pharmacies: [], zones: [] })).toHaveProperty('series', [{ name: '2026-10-14', value: 2 }]);
});

 it('groups a failed attempt under its historical recipient rather than a later corrected destination', async () => {
  const packages = [{ id: 'p', status: PackageStatus.DELIVERED, contactName: 'B', zone: 'Nord', createdAt: '2026-10-01', movements: [], deliveryAttempts: [
    { id: 'old_s', missionId: 'old', stopId: 's', driverId: 'd', outcome: 'FAILURE', recordedAt: '2026-10-01T05:00:00Z', destination: { contactName: 'A', address: 'Rue A', postalCode: '97400', city: 'Ville', zone: 'Ouest' } },
    { id: 'new_s', missionId: 'new', stopId: 's', driverId: 'd', outcome: 'SUCCESS', recordedAt: '2026-10-14T05:00:00Z', destination: { contactName: 'B', address: 'Rue B', postalCode: '97400', city: 'Ville', zone: 'Nord' } },
  ] }] as unknown as Package[];
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'deliveryRate', dimension: 'pharmacy', chart: 'bar' }));
  expect(await runQuery(packages, 'Succès par pharmacie', { pharmacies: ['A', 'B'], zones: ['Nord', 'Ouest'] })).toHaveProperty('series', [{ name: 'B', value: 100 }, { name: 'A', value: 0 }]);
  calls.invoke.mockResolvedValue(response({ ...spec, metric: 'failRate', pharmacy: 'A' }));
  expect(await runQuery(packages, 'Échecs pharmacie A', { pharmacies: ['A', 'B'], zones: ['Nord', 'Ouest'] })).toHaveProperty('kpi.value', '100');
});
