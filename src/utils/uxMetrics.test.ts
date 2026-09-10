import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearUxMetrics, exportUxMetrics, getUxMetrics, setUxMetricsEnabled, startUxTask, summarizeUxMetrics } from './uxMetrics';
beforeEach(() => { clearUxMetrics(); setUxMetricsEnabled(true); });
afterEach(() => vi.restoreAllMocks());
it('records one result per action, removes identifying fields and normalizes unknown roles', () => {
  let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
  const action = startUxTask('deliver', 'person@example.invalid'); now = 1100;
  action.finish('success', { items: 2, errors: 0, address: 'Do not store' } as any); action.finish('error');
  expect(getUxMetrics().records).toEqual([{ task: 'deliver', role: 'other', outcome: 'success', durationMs: 1000, items: 2, errors: 0 }]);
  expect(JSON.stringify(exportUxMetrics())).not.toContain('person'); expect(JSON.stringify(exportUxMetrics())).not.toContain('Do not store');
});
it('keeps at most 200 records and supports disabling and erasing local observations', () => {
  for (let i = 0; i < 205; i++) startUxTask('find_package', 'Admin').finish('success');
  expect(getUxMetrics().records).toHaveLength(200);
  setUxMetricsEnabled(false); startUxTask('deliver').finish('error');
  expect(getUxMetrics().records).toHaveLength(200);
  clearUxMetrics(); expect(getUxMetrics().records).toEqual([]);
});
it('reports failed/cancelled attempts separately from successful duration percentiles', () => {
  const base = { task: 'deliver', role: 'driver', outcome: 'success' } as const;
  const result = summarizeUxMetrics([{ ...base, durationMs: 100 }, { ...base, durationMs: 200 }, { ...base, durationMs: 300 }, { ...base, durationMs: 10000, outcome: 'error' }, { ...base, durationMs: 5, outcome: 'cancelled' }])[0];
  expect(result).toMatchObject({ attempts: 5, successes: 3, errors: 1, cancelled: 1, medianMs: 200, p95Ms: 300 });
});
