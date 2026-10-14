import { beforeEach, expect, it, vi } from 'vitest';
import { PackageStatus } from '../types';
const state = vi.hoisted(() => ({ listeners: [] as { query: any[]; success: (snap: any) => void; error: (error: Error) => void; off: ReturnType<typeof vi.fn> }[], read: vi.fn(), readOne: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ collection: (_db: unknown, name: string) => name, query: (...args: any[]) => args, where: (...args: any[]) => ['where', ...args],
  documentId: () => '__name__', orderBy: (...args: any[]) => ['order', ...args], startAfter: (doc: any) => ['after', doc.id], limit: (size: number) => ['limit', size],
  getDocs: state.read, getDoc: state.readOne,
  onSnapshot: (query: any[], success: any, error: any) => { const off = vi.fn(); state.listeners.push({ query, success, error, off }); return off; },
}));
import { subscribeParcelFeed } from './parcelFeed';
const pkg = (id: string, status = PackageStatus.DELIVERED) => ({ id, status });
const snap = (entries: any[], removed: any[] = []) => ({ size: entries.length, docs: entries.map(entry => ({ id: entry.id, ref: entry.id, data: () => entry })),
  docChanges: () => removed.map(entry => ({ type: 'removed', doc: { id: entry.id, ref: entry.id, data: () => entry } })) });
beforeEach(() => { state.listeners.length = 0; state.read.mockReset(); state.readOne.mockReset(); });
it('never limits active parcels and does not exclude undated history records', () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 2 });
  expect(state.listeners[0].query.some(c => c[0] === 'limit')).toBe(false);
  expect(state.listeners[1].query).toContainEqual(['order', '__name__']);
  state.listeners[0].success(snap(Array.from({ length: 300 }, (_, i) => pkg('active' + i, PackageStatus.IN_DELIVERY))));
  expect(onChange).not.toHaveBeenCalled();
  state.listeners[1].success(snap([pkg('old-a'), pkg('old-b', PackageStatus.RETURNED)]));
  expect(onChange.mock.lastCall?.[0]).toHaveLength(302);
  expect(onChange.mock.lastCall?.[1]).toMatchObject({ activeCount: 300, historyCount: 2, historyComplete: false, hasMore: true });
  feed.unsubscribe();
});
it('paginates history and refreshes every page before returning analytics data', async () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 2 });
  state.listeners[0].success(snap([pkg('active', PackageStatus.PENDING)]));
  state.listeners[1].success(snap([pkg('a'), pkg('b')]));
  state.read.mockResolvedValueOnce(snap([pkg('c')]));
  await feed.loadMore();
  expect(state.read.mock.calls[0][0]).toContainEqual(['after', 'b']);
  expect(onChange.mock.lastCall?.[1].historyComplete).toBe(true);
  state.read.mockResolvedValueOnce(snap([pkg('a'), pkg('b')])).mockResolvedValueOnce(snap([pkg('new')]));
  const all = await feed.loadAll();
  expect(state.read.mock.calls[1][0].some((c: any) => c[0] === 'after')).toBe(false);
  expect(all.map(p => p.id).sort()).toEqual(['a', 'active', 'b', 'new']); // stale deleted c is not retained
  feed.unsubscribe();
});
it('keeps completed active work visible even outside the first historical page', async () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 1 });
  state.listeners[0].success(snap([pkg('z', PackageStatus.IN_DELIVERY)])); state.listeners[1].success(snap([pkg('a')]));
  state.readOne.mockResolvedValue({ exists: () => true, data: () => pkg('z') });
  state.listeners[0].success(snap([], [pkg('z', PackageStatus.IN_DELIVERY)]));
  await vi.waitFor(() => expect(onChange.mock.lastCall?.[0].find((p: any) => p.id === 'z').status).toBe(PackageStatus.DELIVERED));
  expect(onChange.mock.lastCall?.[1].activeCount).toBe(0); feed.unsubscribe();
});
it('unions all authorized sources and never reports a failed partial source as complete', () => {
  const onChange = vi.fn(), onError = vi.fn(), onCoverage = vi.fn();
  const feed = subscribeParcelFeed({ scopes: [{ field: 'clientId', value: 'c' }, { field: 'clientName', value: 'Company' }], onChange, onError, onCoverage });
  state.listeners[0].success(snap([pkg('same', PackageStatus.PENDING)])); state.listeners[1].success(snap([]));
  state.listeners[2].error(new Error('denied')); state.listeners[3].success(snap([]));
  expect(onChange).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
  expect(onCoverage.mock.lastCall?.[0].historyComplete).toBe(false); feed.unsubscribe();
});
it('retains the visible list during a failed page and retries without dropping active parcels', async () => {
  const onChange = vi.fn(), onError = vi.fn(); const feed = subscribeParcelFeed({ onChange, onError, pageSize: 1 });
  state.listeners[0].success(snap([pkg('active', PackageStatus.FAILED)])); state.listeners[1].success(snap([pkg('a')]));
  state.read.mockRejectedValueOnce(new Error('offline'));
  await expect(feed.loadMore()).rejects.toThrow('offline');
  expect(onChange.mock.lastCall?.[0]).toHaveLength(2);
  state.read.mockResolvedValueOnce(snap([])); await feed.loadMore();
  expect(onChange.mock.lastCall?.[1]).toMatchObject({ historyComplete: true, activeCount: 1 }); feed.unsubscribe();
});
it('ignores late query responses after unsubscribe', () => {
  const onChange = vi.fn(), onError = vi.fn(); const feed = subscribeParcelFeed({ onChange, onError });
  feed.unsubscribe(); state.listeners[0].success(snap([])); state.listeners[1].success(snap([])); state.listeners[0].error(new Error('late'));
  expect(onChange).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  expect(state.listeners.every(listener => listener.off.mock.calls.length === 1)).toBe(true);
});
