import { it, expect, vi, beforeEach } from 'vitest';
const calls = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {} }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => calls.invoke,
}));
import { runQuery } from './aiAnalytics';
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
