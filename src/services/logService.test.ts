import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appendToast, type VisibleToast } from '../utils/toastQueue';
const { add, storage } = vi.hoisted(() => ({ add: vi.fn(), storage: new Map<string, string>() }));
vi.mock('../firebaseConfig', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ addDoc: add, collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn() }));
beforeEach(() => {
  vi.resetModules(); add.mockReset(); add.mockResolvedValue({ id: 'test-log' }); storage.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  vi.stubGlobal('location', { origin: 'https://test.invalid', pathname: '/driver-tour', href: 'https://test.invalid/driver-tour?token=secret' });
  vi.stubGlobal('navigator', { onLine: false, userAgent: 'test-browser' }); vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const drain = async () => { await Promise.resolve(); await Promise.resolve(); };

it('preserves error codes and cross-realm stacks with network context but without URL tokens', async () => {
  const service = await import('./logService');
  service.reportError('directory.load', { message: 'internal [0]', stack: 'remote stack', code: 'functions/internal' }, { silent: true });
  const entry = add.mock.calls[0][1];
  expect(entry.message).toBe('internal [0]'); expect(entry.stack).toBe('remote stack');
  expect(entry.extra).toMatchObject({ errorCode: 'functions/internal', diagnostics: { online: false, visibility: 'hidden', page: 'driver_tour' } });
  expect(entry.url).toBe('https://test.invalid/driver-tour'); expect(JSON.stringify(entry)).not.toContain('secret');
});

it('groups repeated runtime alerts while persisting every occurrence independently', async () => {
  const service = await import('./logService'); let visible: VisibleToast[] = [];
  const stop = service.onUserMessage(message => { visible = appendToast(visible, message); });
  for (let i = 0; i < 23; i++) service.reportError('window.error', 'Script error.');
  expect(add).toHaveBeenCalledTimes(23); expect(visible).toHaveLength(1); expect(visible[0].occurrences).toBe(23);
  expect(new Set(add.mock.calls.map(([, entry]) => entry.referenceId)).size).toBe(23); stop();
});

it('shares a flush and preserves errors buffered while its first request is pending', async () => {
  const service = await import('./logService');
  storage.set('fleet_error_logs', JSON.stringify([{ referenceId: 'old-log', message: 'old' }])); storage.set('delivery-outbox', 'untouched');
  let release!: () => void; add.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockRejectedValueOnce(new Error('offline'));
  const first = service.flushLocalErrorLogs(); const second = service.flushLocalErrorLogs(); expect(first).toBe(second);
  service.reportError('new-error', new Error('new'), { silent: true }); await drain(); release(); await first;
  expect(service.getLocalErrorLogs().map(entry => entry.message)).toEqual(['new']); expect(storage.get('delivery-outbox')).toBe('untouched');
  await service.flushLocalErrorLogs(); expect(service.getLocalErrorLogs()).toEqual([]); expect(add).toHaveBeenCalledTimes(3);
});

it('retains the whole remaining buffer after a failed flush and stops the failing burst', async () => {
  const service = await import('./logService'); storage.set('fleet_error_logs', JSON.stringify([{ message: 'a' }, { message: 'b' }]));
  add.mockRejectedValueOnce(new Error('offline')); await service.flushLocalErrorLogs();
  expect(add).toHaveBeenCalledTimes(1); expect(service.getLocalErrorLogs()).toHaveLength(2);
  await service.flushLocalErrorLogs(); expect(add).toHaveBeenCalledTimes(3); expect(service.getLocalErrorLogs()).toEqual([]);
});

it('handles missing error details and a malformed local buffer without breaking the page', async () => {
  const service = await import('./logService'); storage.set('fleet_error_logs', '{"not":"an array"}');
  expect(service.getLocalErrorLogs()).toEqual([]); expect(() => service.reportError('window.unhandledrejection', undefined)).not.toThrow();
  expect(add.mock.calls[0][1].message).toBe('undefined');
});

it('does not combine a business validation message with runtime noise', () => {
  const message = { id: 'runtime', level: 'error' as const, message: 'Réessayez', durationMs: 0 };
  let queue = appendToast([], { ...message, group: 'runtime' }); queue = appendToast(queue, { ...message, id: 'business' });
  expect(queue).toHaveLength(2); expect(appendToast(queue, { ...message, id: 'again' })).toBe(queue);
});
