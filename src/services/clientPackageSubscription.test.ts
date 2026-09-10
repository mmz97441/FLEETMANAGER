import { beforeEach, expect, it, vi } from 'vitest';
import { PackageStatus } from '../types';
const state = vi.hoisted(() => ({ listeners: [] as { success: (snap: any) => void; error: (error: Error) => void; off: ReturnType<typeof vi.fn> }[] }));
vi.mock('../firebaseConfig', () => ({ db: {} }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
vi.mock('firebase/firestore', () => ({ collection: (_db: unknown, name: string) => name, query: (...args: any[]) => args, where: (...args: any[]) => args,
  onSnapshot: (_query: unknown, success: any, error: any) => { const off = vi.fn(); state.listeners.push({ success, error, off }); return off; },
}));
import { listenClientPackages } from './clientPackageSubscription';
const snap = (entries: any[]) => ({ docs: entries.map(entry => ({ id: entry.id, data: () => entry })) });
beforeEach(() => { state.listeners.length = 0; });
it('waits for both parcel sources when tracking arrives first, then deduplicates parcels', () => {
  const callback = vi.fn();
  listenClientPackages({ id: 'client', companyName: 'Company' }, callback);
  state.listeners[2].success(snap([{ missionId: 'm', ranks: { p: 2 }, liveDriver: { updatedAt: 'now' } }]));
  state.listeners[0].success(snap([{ id: 'p', status: PackageStatus.IN_DELIVERY, missionId: 'm', createdAt: '2026-09-10' }]));
  expect(callback).not.toHaveBeenCalled();
  state.listeners[1].success(snap([{ id: 'p', status: PackageStatus.IN_DELIVERY, missionId: 'm', createdAt: '2026-09-10' }]));
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0]).toHaveLength(1);
  expect(callback.mock.calls[0][0][0].remainingBeforeMine).toBe(2);
});
it('does not turn a failed partial read into a complete list or hide its error', () => {
  const callback = vi.fn(), error = vi.fn();
  listenClientPackages({ id: 'client', companyName: 'Company' }, callback, error);
  state.listeners[0].success(snap([{ id: 'p' }]));
  state.listeners[1].error(new Error('permission denied'));
  state.listeners[2].success(snap([]));
  expect(callback).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledOnce();
});
it('loads a client without company, remains usable on tracking failure and stops late emissions', () => {
  const callback = vi.fn(), error = vi.fn();
  const off = listenClientPackages({ id: 'client' }, callback, error);
  state.listeners[0].success(snap([{ id: 'p', status: PackageStatus.IN_DELIVERY }]));
  state.listeners[1].error(new Error('tracking unavailable'));
  expect(callback.mock.calls[callback.mock.calls.length - 1]?.[0]).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
  off(); const count = callback.mock.calls.length;
  state.listeners[0].success(snap([])); state.listeners[0].error(new Error('late'));
  expect(callback).toHaveBeenCalledTimes(count); expect(error).not.toHaveBeenCalled();
  expect(state.listeners.every(listener => listener.off.mock.calls.length === 1)).toBe(true);
});
