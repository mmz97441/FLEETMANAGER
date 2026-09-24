import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), watch: vi.fn(), call: vi.fn(), report: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, _collection: string, id: string) => id, getDoc: mocks.get, onSnapshot: mocks.watch }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: () => mocks.call }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {} }));
vi.mock('./logService', () => ({ reportError: mocks.report }));
import { getUserProfile, subscribeToUserProfile } from './profileService';
const snap = (data: object | null, cached = false) => ({ id: 'driver', exists: () => !!data, data: () => data, metadata: { fromCache: cached } });
beforeEach(() => { vi.useFakeTimers(); Object.values(mocks).forEach(m => m.mockReset()); });
afterEach(() => vi.useRealTimers());
it('uses a server fallback on browser failure and preserves the real UID', async () => {
  mocks.get.mockRejectedValue(new Error('internal [0]')); mocks.call.mockResolvedValue({ data: { profile: { id: 'old-id', role: 'Chauffeur' } } });
  expect(await getUserProfile('driver')).toEqual({ id: 'driver', role: 'Chauffeur' }); expect(mocks.call).toHaveBeenCalledWith({ uid: 'driver' });
});
it('propagates a double failure instead of reporting an absent profile', async () => {
  mocks.get.mockRejectedValue(new Error('offline')); mocks.call.mockRejectedValue(new Error('server unavailable'));
  await expect(getUserProfile('driver')).rejects.toThrow('server unavailable');
});
it('confirms cached absence and cached access restrictions with the server', async () => {
  for (const data of [null, { isDisabled: true }, { sessionsRevokedAt: 1 }]) {
    mocks.get.mockResolvedValue(snap(data, true)); mocks.call.mockResolvedValue({ data: { profile: { role: 'Chauffeur' } } });
    expect(await getUserProfile('driver')).toEqual({ id: 'driver', role: 'Chauffeur' });
  }
  expect(mocks.call).toHaveBeenCalledTimes(3);
});
it('preserves a cached active profile for offline work, but returns a server-confirmed absence', async () => {
  mocks.get.mockResolvedValueOnce(snap({ role: 'Chauffeur' }, true)).mockResolvedValueOnce(snap(null));
  expect(await getUserProfile('driver')).toEqual({ id: 'driver', role: 'Chauffeur' }); expect(await getUserProfile('driver')).toBeNull(); expect(mocks.call).not.toHaveBeenCalled();
});
it('falls back after a stalled browser read and ignores its late result', async () => {
  let release!: (s: ReturnType<typeof snap>) => void;
  mocks.get.mockReturnValue(new Promise(r => { release = r; })); mocks.call.mockResolvedValue({ data: { profile: { role: 'Chauffeur' } } });
  const result = getUserProfile('driver'); await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual({ id: 'driver', role: 'Chauffeur' }); release(snap(null)); expect(vi.getTimerCount()).toBe(0);
});
it('ignores cached deletion/disabled events but applies authoritative server events', () => {
  const next = vi.fn(), fail = vi.fn(); subscribeToUserProfile('driver', next, fail);
  const [, , listener, error] = mocks.watch.mock.calls[0];
  listener(snap(null, true)); listener(snap({ isDisabled: true }, true)); expect(next).not.toHaveBeenCalled();
  listener(snap({ id: 'old', role: 'Chauffeur' })); expect(next).toHaveBeenLastCalledWith({ id: 'driver', role: 'Chauffeur' });
  listener(snap(null)); expect(next).toHaveBeenLastCalledWith(null); error('network'); expect(fail).toHaveBeenCalledWith('network');
});
