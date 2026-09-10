export const uxTaskNames = ['find_package', 'create_shipment', 'dispatch', 'deliver', 'sync', 'load_packages'] as const;
export type UxTask = typeof uxTaskNames[number];
export type UxOutcome = 'success' | 'error' | 'cancelled';
type UxRole = 'office' | 'driver' | 'client' | 'other';
export interface UxMeasurement { task: UxTask; role: UxRole; outcome: UxOutcome; durationMs: number; items?: number; errors?: number }
const key = 'fleet-ux-session-v1';
const maxSamples = 200;
const listeners = new Set<() => void>();
let records: UxMeasurement[] = [];
let enabled = true;
let loaded = false;
let version = 0;
const roleOf = (role = ''): UxRole => {
  const text = role.toLowerCase();
  if (text.includes('client')) return 'client';
  if (text.includes('driver') || text.includes('chauffeur')) return 'driver';
  if (/admin|president|président|direct|exploit|gestion/.test(text)) return 'office';
  return 'other';
};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1000000) : undefined;
function clean(record: any): UxMeasurement | null {
  if (!uxTaskNames.includes(record?.task) || !['office','driver','client','other'].includes(record.role) || !['success','error','cancelled'].includes(record.outcome) || !Number.isFinite(record.durationMs) || record.durationMs < 0 || record.durationMs > 28800000) return null;
  // Reconstruct the shape; never retain free text, identifiers or extra fields.
  return { task: record.task, role: record.role, outcome: record.outcome, durationMs: Math.round(record.durationMs), items: number(record.items), errors: number(record.errors) };
}
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    enabled = saved?.enabled !== false;
    records = Array.isArray(saved?.records) ? saved.records.slice(-maxSamples).map(clean).filter((r: UxMeasurement | null): r is UxMeasurement => !!r) : [];
  } catch { /* Measurements remain optional and in memory if storage is unavailable. */ }
}
function publish() {
  version++;
  try { sessionStorage.setItem(key, JSON.stringify({ enabled, records })); } catch { /* Never block a delivery for measurement. */ }
  for (const notify of listeners) { try { notify(); } catch { /* Measurement UI cannot fail a business operation. */ } }
}
export const subscribeUxMetrics = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
export const getUxMetricsVersion = () => version;
export const getUxMetrics = () => { load(); return { enabled, records: records.map(r => ({ ...r })), limit: maxSamples }; };
export function setUxMetricsEnabled(value: boolean) { load(); enabled = value; publish(); }
export function clearUxMetrics() { load(); records = []; publish(); }

/** Durations are local observations, not evidence of a real-world speed gain. */
export function startUxTask(task: UxTask, role?: string) {
  load();
  const started = performance.now();
  const collecting = enabled && uxTaskNames.includes(task);
  let finished = false;
  return { finish(outcome: UxOutcome, counts?: { items?: number; errors?: number }) {
    if (finished) return;
    finished = true;
    if (!collecting || !enabled) return;
    const record = clean({ task, role: roleOf(role), outcome, durationMs: performance.now() - started, items: counts?.items, errors: counts?.errors });
    if (!record) return;
    records = [...records, record].slice(-maxSamples);
    publish();
  } };
}
export function summarizeUxMetrics(samples: UxMeasurement[]) {
  const groups = new Map<string, UxMeasurement[]>();
  for (const sample of samples) {
    const key = sample.task + ':' + sample.role;
    groups.set(key, [...(groups.get(key) || []), sample]);
  }
  return [...groups.values()].map(group => {
    const times = group.filter(r => r.outcome === 'success').map(r => r.durationMs).sort((a, b) => a - b);
    const percentile = (p: number) => times.length ? times[Math.max(0, Math.ceil(p * times.length) - 1)] : null;
    return { task: group[0].task, role: group[0].role, attempts: group.length, successes: times.length, errors: group.filter(r => r.outcome === 'error').length, cancelled: group.filter(r => r.outcome === 'cancelled').length, medianMs: percentile(.5), p95Ms: percentile(.95), maxItems: Math.max(0, ...group.map(r => r.items || 0)) };
  });
}
export function exportUxMetrics() {
  load();
  return { schema: 1, scope: 'this-browser-session', sampleLimit: maxSamples, note: 'Observations locales, sans preuve de gain ni de représentativité. Les durées de réussite excluent les échecs et abandons.', summary: summarizeUxMetrics(records) };
}
