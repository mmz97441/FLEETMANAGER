import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_UPDATE_STORAGE_KEY, createAppUpdateMonitor, parseAppVersion } from './appUpdate';

const current = { version: '4.36.0', buildId: '1790000000000' };
const latest = { version: '4.37.0', buildId: '1790000000001' };
const response = (manifest: unknown) => ({ ok: true, json: async () => manifest });
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('deployed app version detection', () => {
  it('validates both version and build without losing build precision', () => {
    expect(parseAppVersion({ version: '4.37.0', buildId: '12345678901234567890' })).toEqual({ version: '4.37.0', buildId: '12345678901234567890' });
    for (const invalid of [null, [], {}, { ...latest, version: '4.37' }, { ...latest, version: '04.37.0' }, { ...latest, buildId: 123 },
      { ...latest, buildId: '' }, { ...latest, buildId: '1<script>' }, { ...latest, buildId: '123456789012345678901' }]) expect(parseAppVersion(invalid)).toBeNull();
  });

  it('checks without caching and shares one in-flight request across consumers', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn(() => new Promise<ReturnType<typeof response>>(done => { resolve = done; }));
    const monitor = createAppUpdateMonitor({ current, fetch, now: () => 100 });
    const first = monitor.checkNow(), second = monitor.checkNow();
    expect(second).toBe(first); await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce(); expect(monitor.getSnapshot().checking).toBe(true);
    expect(fetch.mock.calls[0]).toEqual(['/version.json?ts=100', expect.objectContaining({ cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: expect.any(AbortSignal) })]);
    resolve(response(current)); expect(await first).toBe(true);
    expect(monitor.getSnapshot()).toMatchObject({ available: false, checking: false, latestVersion: current.version, latestBuildId: current.buildId, lastCheckedAt: 100, error: null });
  });

  it('keeps a confirmed requirement across an offline reload of the old build without touching other local data', async () => {
    const storage = memoryStorage(); storage.setItem('proof-draft', 'preserved');
    const online = createAppUpdateMonitor({ current, storage, fetch: vi.fn().mockResolvedValue(response(latest)) });
    await online.checkNow(); expect(online.getSnapshot().available).toBe(true);
    const offline = createAppUpdateMonitor({ current, storage, fetch: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(offline.getSnapshot()).toMatchObject({ available: true, latestVersion: latest.version, latestBuildId: latest.buildId, lastCheckedAt: online.getSnapshot().lastCheckedAt });
    expect(await offline.checkNow()).toBe(false); expect(offline.getSnapshot()).toMatchObject({ available: true, checking: false });
    expect(offline.getSnapshot().error).toMatch(/Connexion/); expect(storage.getItem('proof-draft')).toBe('preserved');
  });

  it('clears the remembered gate when the required build is installed, even offline', async () => {
    const storage = memoryStorage();
    const before = createAppUpdateMonitor({ current, storage, fetch: vi.fn().mockResolvedValue(response(latest)) }); await before.checkNow();
    const installed = createAppUpdateMonitor({ current: latest, storage, fetch: vi.fn().mockRejectedValue(new Error('offline')) });
    expect(installed.getSnapshot().available).toBe(false); expect(storage.getItem(APP_UPDATE_STORAGE_KEY)).toBeNull();
    await installed.checkNow(); expect(installed.getSnapshot().available).toBe(false);
  });

  it('allows a valid rollback to cancel or replace a previous requirement', async () => {
    const storage = memoryStorage(), fetch = vi.fn().mockResolvedValueOnce(response(latest)).mockResolvedValueOnce(response(current));
    const monitor = createAppUpdateMonitor({ current, storage, fetch });
    await monitor.checkNow(); expect(monitor.getSnapshot().available).toBe(true);
    await monitor.checkNow(); expect(monitor.getSnapshot().available).toBe(false); expect(storage.getItem(APP_UPDATE_STORAGE_KEY)).toBeNull();
    fetch.mockResolvedValue(response({ version: '4.35.0', buildId: '1789999999999' })); await monitor.checkNow();
    expect(monitor.getSnapshot()).toMatchObject({ available: true, latestVersion: '4.35.0', latestBuildId: '1789999999999' });
  });

  it('detects a rebuild of the same version but refuses an incoherent same-build manifest', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...current, buildId: latest.buildId })).mockResolvedValueOnce(response({ ...latest, buildId: current.buildId }));
    const monitor = createAppUpdateMonitor({ current, fetch });
    await monitor.checkNow(); expect(monitor.getSnapshot().available).toBe(true);
    await monitor.checkNow(); expect(monitor.getSnapshot()).toMatchObject({ available: true, latestVersion: current.version, latestBuildId: latest.buildId });
    expect(monitor.getSnapshot().error).toMatch(/invalide/);
  });

  it('never creates a requirement from malformed storage, malformed JSON or a failed HTTP response', async () => {
    for (const stored of ['broken', JSON.stringify({ schema: 1, required: latest }), JSON.stringify({ schema: 1, required: { version: '', buildId: 'x' }, detectedOn: current })]) {
      const storage = memoryStorage(); storage.setItem(APP_UPDATE_STORAGE_KEY, stored);
      const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('bad JSON'); } }).mockResolvedValueOnce({ ok: false });
      const monitor = createAppUpdateMonitor({ current, fetch, storage });
      expect(monitor.getSnapshot().available).toBe(false); expect(storage.getItem(APP_UPDATE_STORAGE_KEY)).toBeNull();
      expect(await monitor.checkNow()).toBe(false); expect(monitor.getSnapshot().error).toMatch(/invalide/);
      expect(await monitor.checkNow()).toBe(false); expect(monitor.getSnapshot().available).toBe(false); expect(monitor.getSnapshot().error).toBeTruthy();
    }
  });

  it('does not revoke a known requirement on malformed manifest and recovers on the next valid check', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(latest)).mockResolvedValueOnce(response({ version: 'broken', buildId: '1' })).mockResolvedValueOnce(response(current));
    const monitor = createAppUpdateMonitor({ current, fetch });
    await monitor.checkNow(); await monitor.checkNow(); expect(monitor.getSnapshot().available).toBe(true);
    await monitor.checkNow(); expect(monitor.getSnapshot()).toMatchObject({ available: false, error: null });
  });

  it('times out a hung request and ignores its response after a successful retry', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(response(current));
    const storage = memoryStorage(), monitor = createAppUpdateMonitor({ current, fetch, storage });
    const pending = monitor.checkNow(); await vi.advanceTimersByTimeAsync(8000); expect(await pending).toBe(false);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(monitor.getSnapshot()).toMatchObject({ available: false, checking: false }); expect(monitor.getSnapshot().error).toMatch(/expiré/);
    await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledOnce(); // Controller has no retry loop.
    await monitor.checkNow(); resolve(response(latest)); await Promise.resolve(); await Promise.resolve();
    expect(monitor.getSnapshot()).toMatchObject({ available: false, latestBuildId: current.buildId, error: null }); expect(storage.getItem(APP_UPDATE_STORAGE_KEY)).toBeNull();
  });

  it('cancels on unsubscribe without letting a late response replace the next check', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(response(current));
    const monitor = createAppUpdateMonitor({ current, fetch }); const listener = vi.fn(), unsubscribe = monitor.subscribe(listener);
    const pending = monitor.checkNow(); await Promise.resolve(); unsubscribe(); monitor.cancelPending();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true); const calls = listener.mock.calls.length;
    expect(await monitor.checkNow()).toBe(true); resolve(response(latest)); expect(await pending).toBe(false);
    expect(listener).toHaveBeenCalledTimes(calls); expect(monitor.getSnapshot()).toMatchObject({ available: false, latestBuildId: current.buildId, checking: false });
  });

  it('keeps detection working when storage is denied', async () => {
    const denied = () => { throw new Error('Denied'); };
    const monitor = createAppUpdateMonitor({ current, storage: { getItem: denied, setItem: denied, removeItem: denied }, fetch: vi.fn().mockResolvedValue(response(latest)) });
    await monitor.checkNow(); expect(monitor.getSnapshot()).toMatchObject({ available: true, error: null });
  });
});
