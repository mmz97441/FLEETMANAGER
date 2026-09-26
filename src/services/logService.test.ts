import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appendToast, type VisibleToast } from '../utils/toastQueue';
const { send, storage } = vi.hoisted(() => ({ send: vi.fn(), storage: new Map<string, string>() }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {} }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: () => send }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn() }));
let network: { onLine: boolean; userAgent: string };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); storage.clear(); send.mockReset();
  send.mockImplementation(async ({ entries }) => ({ data: { acknowledged: entries.map((e: any) => e.referenceId) } }));
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  vi.stubGlobal('location', { origin: 'https://test.invalid', pathname: '/driver-tour', href: 'https://test.invalid/driver-tour?token=secret' });
  network = { onLine: false, userAgent: 'test-browser' };
  vi.stubGlobal('navigator', network); vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const service = async () => { const s = await import('./logService'); s.setLogUser({ id: 'driver' }); return s; };
it('stores offline errors immediately with codes and stacks, without URL tokens', async () => {
  const s = await service(); s.reportError('directory.load', { message: 'internal [0]', stack: 'remote stack', code: 'functions/internal' }, { silent: true });
  const entry = s.getLocalErrorLogs()[0];
  expect(entry).toMatchObject({ message: 'internal [0]', stack: 'remote stack', url: 'https://test.invalid/driver-tour', extra: { errorCode: 'functions/internal', diagnostics: { online: false } } });
  expect(JSON.stringify(entry)).not.toContain('secret'); expect(send).not.toHaveBeenCalled();
});
it('groups repeated alerts and uploads every occurrence with stable references in bounded batches', async () => {
  const s = await service(); let visible: VisibleToast[] = [];
  const stop = s.onUserMessage(message => { visible = appendToast(visible, message); });
  for (let i = 0; i < 23; i++) s.reportError('window.error', 'Script error.');
  expect(visible).toHaveLength(1); expect(visible[0].occurrences).toBe(23); expect(s.getLocalErrorLogs()).toHaveLength(23);
  network.onLine = true; await s.flushLocalErrorLogs();
  expect(send.mock.calls.map(([data]) => data.entries.length)).toEqual([20, 3]); expect(s.getLocalErrorLogs()).toEqual([]); stop();
});
it('preserves logs reported during a pending flush and removes only acknowledged entries', async () => {
  const s = await service(); s.reportError('old', 'old', { silent: true }); storage.set('delivery-outbox', 'untouched'); network.onLine = true;
  let release!: (v: any) => void;
  send.mockImplementationOnce(() => new Promise(r => { release = r; })).mockRejectedValueOnce(new Error('offline'));
  const first = s.flushLocalErrorLogs(); expect(s.flushLocalErrorLogs()).toBe(first);
  const reference = s.getLocalErrorLogs()[0].referenceId;
  s.reportError('new', 'new', { silent: true }); expect(s.getLocalErrorLogs()).toHaveLength(2);
  release({ data: { acknowledged: [reference] } }); await first;
  expect(s.getLocalErrorLogs().map(e => e.message)).toEqual(['new']); expect(storage.get('delivery-outbox')).toBe('untouched');
  await s.flushLocalErrorLogs(); expect(s.getLocalErrorLogs()).toEqual([]);
});
it('releases a stalled upload and retries exactly the same receipt after the deadline', async () => {
  const s = await service(); s.reportError('test', 'pending', { silent: true }); network.onLine = true;
  send.mockReturnValueOnce(new Promise(() => {})); const first = s.flushLocalErrorLogs(); await vi.advanceTimersByTimeAsync(18000); await first;
  expect(s.getLocalErrorLogs()).toHaveLength(1); await s.flushLocalErrorLogs();
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]); expect(s.getLocalErrorLogs()).toEqual([]);
});
it('does not upload another account’s buffered records as the current user', async () => {
  const s = await service(); s.reportError('test', 'driver record', { silent: true }); s.setLogUser({ id: 'other' }); network.onLine = true;
  await s.flushLocalErrorLogs(); expect(send).not.toHaveBeenCalled(); expect(s.getLocalErrorLogs()).toHaveLength(1);
});
it('repairs legacy references and malformed buffers without touching business data', async () => {
  const s = await service(); storage.set('fleet_error_logs', '{"invalid":true}'); expect(s.getLocalErrorLogs()).toEqual([]);
  storage.set('fleet_error_logs', JSON.stringify([{ message: 'legacy' }])); network.onLine = true; await s.flushLocalErrorLogs();
  expect(String(send.mock.calls[0][0].entries[0].referenceId)).toMatch(/^legacy-/); expect(s.getLocalErrorLogs()).toEqual([]);
});
it('does not combine a business validation message with runtime noise', () => {
  const message = { id: 'runtime', level: 'error' as const, message: 'Réessayez', durationMs: 0 };
  let queue = appendToast([], { ...message, group: 'runtime' }); queue = appendToast(queue, { ...message, id: 'business' });
  expect(queue).toHaveLength(2);
});
it('can report online even if localStorage is full or denied', async () => {
  const s = await service(); network.onLine = true;
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } });
  s.reportError('test.storage', 'storage unavailable', { silent: true }); await s.flushLocalErrorLogs();
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].entries[0].message).toBe('storage unavailable');
  expect(s.getLocalErrorLogs()).toEqual([]);
});
