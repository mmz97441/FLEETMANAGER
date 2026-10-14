import { beforeEach, expect, it, vi } from 'vitest';
import { PackageStatus } from '../types';
const state = vi.hoisted(() => ({ listeners: [] as { query: any; success: (snap: any) => void; error: (error: Error) => void; off: ReturnType<typeof vi.fn> }[], read: vi.fn(), readOne: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ collection: (_db: unknown, name: string) => name, doc: (_db: unknown, collection: string, id: string) => ({ collection, id }), query: (...args: any[]) => args, where: (...args: any[]) => ['where', ...args],
  documentId: () => '__name__', orderBy: (...args: any[]) => ['order', ...args], startAfter: (doc: any) => ['after', doc.id], limit: (size: number) => ['limit', size],
  getDocsFromServer: state.read, getDocFromServer: state.readOne,
  onSnapshot: (query: any, options: any, success: any, error: any) => { expect(options).toEqual({ includeMetadataChanges: true }); const off = vi.fn(); state.listeners.push({ query, success, error, off }); return off; },
}));
import { subscribeParcelFeed } from './parcelFeed';
const pkg = <T extends object>(id: string, status = PackageStatus.DELIVERED, patch = {} as T) => ({ id, status, ...patch });
const entry = (value: any) => ({ id: value.id, ref: value.id, data: () => value, exists: () => true, metadata: { fromCache: false } });
const snap = (entries: any[], removed: any[] = [], fromCache = false) => ({ metadata: { fromCache }, size: entries.length, docs: entries.map(entry),
  docChanges: () => removed.map(value => ({ type: 'removed', doc: entry(value) })) });
const removed = () => ({ metadata: { fromCache: false }, exists: () => false });
beforeEach(() => { state.listeners.length = 0; state.read.mockReset(); state.readOne.mockReset(); });
it('never limits active parcels and never excludes undated history records', () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 2 });
  expect(state.listeners[0].query.some((c: any) => c[0] === 'limit')).toBe(false);
  expect(state.listeners[1].query).toContainEqual(['order', '__name__']);
  state.listeners[0].success(snap(Array.from({ length: 300 }, (_, i) => pkg('active' + i, PackageStatus.IN_DELIVERY))));
  expect(onChange).not.toHaveBeenCalled();
  state.listeners[1].success(snap([pkg('old-a'), pkg('old-b', PackageStatus.RETURNED)]));
  expect(onChange.mock.lastCall?.[0]).toHaveLength(302);
  expect(onChange.mock.lastCall?.[1]).toMatchObject({ activeCount: 300, historyCount: 2, historyComplete: false, hasMore: true, fromCache: false });
  feed.unsubscribe();
});
it('paginates then refreshes active work and every historical page, coalescing simultaneous full requests', async () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 2 });
  state.listeners[0].success(snap([pkg('active', PackageStatus.PENDING)])); state.listeners[1].success(snap([pkg('a'), pkg('b')]));
  state.read.mockResolvedValueOnce(snap([pkg('c')])); await feed.loadMore();
  expect(state.read.mock.calls[0][0]).toContainEqual(['after', 'b']);
  state.read.mockResolvedValueOnce(snap([pkg('active', PackageStatus.PENDING)]))
    .mockResolvedValueOnce(snap([pkg('a'), pkg('b')])).mockResolvedValueOnce(snap([pkg('new')]));
  const [first, second] = await Promise.all([feed.loadAll(), feed.loadAll()]);
  expect(first.map(p => p.id).sort()).toEqual(['a', 'active', 'b', 'new']); expect(second).toEqual(first);
  expect(state.read).toHaveBeenCalledTimes(4); expect(onChange.mock.lastCall?.[1].historyComplete).toBe(true); feed.unsubscribe();
});
it('keeps observing a completed parcel beyond page one until its late proof is published', () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 1 });
  const pending = pkg('z', PackageStatus.DELIVERED, { deliveryAttempts: [{ id: 'm_s', missionId: 'm', stopId: 's', recordedAt: '2026-10-14T05:00:00Z' }] });
  state.listeners[0].success(snap([pkg('z', PackageStatus.IN_DELIVERY)])); state.listeners[1].success(snap([pkg('a')]));
  state.listeners[0].success(snap([], [pkg('z', PackageStatus.IN_DELIVERY)]));
  const watch = state.listeners[2]; expect(watch.query).toEqual({ collection: 'packages', id: 'z' });
  watch.success(entry(pending)); expect(onChange.mock.lastCall?.[0].find((p: any) => p.id === 'z').pod).toBeUndefined(); expect(watch.off).not.toHaveBeenCalled();
  const proof = { missionId: 'm', stopId: 's', photoUrls: ['photo'] };
  watch.success(entry({ ...pending, pod: proof, deliveryAttempts: pending.deliveryAttempts.map((a: any) => ({ ...a, proof })) }));
  expect(onChange.mock.lastCall?.[0].find((p: any) => p.id === 'z').pod.photoUrls).toEqual(['photo']); expect(watch.off).toHaveBeenCalledOnce(); feed.unsubscribe();
});
it('an open historical parcel stays subscribed through proof arrival until the detail is closed', () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange });
  state.listeners[0].success(snap([])); state.listeners[1].success(snap([]));
  const off = feed.watchParcel('z'); const watch = state.listeners[2]; watch.success(entry(pkg('z')));
  watch.success(entry(pkg('z', PackageStatus.DELIVERED, { pod: { photoUrls: ['late-photo'] } })));
  expect(onChange.mock.lastCall?.[0][0].pod.photoUrls).toEqual(['late-photo']); expect(watch.off).not.toHaveBeenCalled(); off(); expect(watch.off).toHaveBeenCalledOnce(); feed.unsubscribe();
});
it('removes deleted or inaccessible history but retains a merely evicted first-page parcel', async () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange, pageSize: 1 });
  state.listeners[0].success(snap([])); state.listeners[1].success(snap([pkg('b')]));
  state.readOne.mockResolvedValueOnce(entry(pkg('b')));
  state.listeners[1].success(snap([pkg('a')], [pkg('b')]));
  await vi.waitFor(() => expect(onChange.mock.lastCall?.[0].map((p: any) => p.id).sort()).toEqual(['a', 'b']));
  state.readOne.mockResolvedValueOnce(removed()); state.listeners[1].success(snap([], [pkg('a')]));
  await vi.waitFor(() => expect(onChange.mock.lastCall?.[0].map((p: any) => p.id)).toEqual(['b'])); feed.unsubscribe();
});
it('drops a revoked open parcel without claiming another client record is in scope', () => {
  const onChange = vi.fn(), onError = vi.fn(); const feed = subscribeParcelFeed({ scopes: [{ field: 'clientId', value: 'c' }], onChange });
  state.listeners[0].success(snap([])); state.listeners[1].success(snap([])); const off = feed.watchParcel('p', onError);
  state.listeners[2].success(entry(pkg('p', PackageStatus.DELIVERED, { clientId: 'c' }))); expect(onChange.mock.lastCall?.[0]).toHaveLength(1);
  state.listeners[2].success(entry(pkg('p', PackageStatus.DELIVERED, { clientId: 'other' }))); expect(onChange.mock.lastCall?.[0]).toHaveLength(0);
  state.listeners[2].error(Object.assign(new Error('denied'), { code: 'permission-denied' })); expect(onError).toHaveBeenCalledOnce(); off(); feed.unsubscribe();
});
it('does not resolve a full export refresh while a historical removal is still being verified', async () => {
  const onChange = vi.fn(); const feed = subscribeParcelFeed({ onChange });
  state.listeners[0].success(snap([])); state.listeners[1].success(snap([pkg('revoked')]));
  let finish!: (snapshot: any) => void;
  state.readOne.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  state.listeners[1].success(snap([], [pkg('revoked')]));
  state.read.mockResolvedValueOnce(snap([])).mockResolvedValueOnce(snap([]));
  const resolved = vi.fn(); const refresh = feed.loadAll().then(resolved);
  await vi.waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
  expect(resolved).not.toHaveBeenCalled(); expect(onChange.mock.lastCall?.[1].historyComplete).toBe(false);
  finish(removed()); await refresh;
  expect(resolved).toHaveBeenCalledWith([]); expect(onChange.mock.lastCall?.[1].historyComplete).toBe(true); feed.unsubscribe();
});
it('shows cached data without certifying it; full refresh rejects a cached page and retains the visible list', async () => {
  const onChange = vi.fn(), onError = vi.fn(); const feed = subscribeParcelFeed({ onChange, onError });
  state.listeners[0].success(snap([], [], true)); state.listeners[1].success(snap([pkg('cached')], [], true));
  expect(onChange.mock.lastCall?.[1]).toMatchObject({ historyComplete: false, fromCache: true });
  state.read.mockResolvedValueOnce(snap([])).mockResolvedValueOnce(snap([pkg('cached')], [], true));
  await expect(feed.loadAll()).rejects.toThrow('serveur'); expect(onError).toHaveBeenCalledOnce();
  expect(onChange.mock.lastCall?.[0]).toHaveLength(1); expect(onChange.mock.lastCall?.[1].historyComplete).toBe(false); feed.unsubscribe();
});
it('includes metadata-only server confirmation and refuses a failed partial source', () => {
  const onChange = vi.fn(), onError = vi.fn(); const feed = subscribeParcelFeed({ onChange, onError });
  state.listeners[0].success(snap([], [], true)); state.listeners[1].success(snap([], [], true));
  expect(onChange.mock.lastCall?.[1].historyComplete).toBe(false);
  state.listeners[0].success(snap([])); state.listeners[1].success(snap([])); expect(onChange.mock.lastCall?.[1].historyComplete).toBe(true);
  state.listeners[0].error(new Error('offline')); expect(onError).toHaveBeenCalledOnce(); feed.unsubscribe();
});
it('unions authorized sources without hiding a failed source and ignores responses after unsubscribe', () => {
  const onChange = vi.fn(), onError = vi.fn(); const feed = subscribeParcelFeed({ scopes: [{ field: 'clientId', value: 'c' }, { field: 'clientName', value: 'Company' }], onChange, onError });
  state.listeners[0].success(snap([pkg('same', PackageStatus.PENDING)])); state.listeners[1].success(snap([]));
  state.listeners[2].error(new Error('denied')); state.listeners[3].success(snap([])); expect(onChange).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
  feed.unsubscribe(); state.listeners[0].success(snap([])); state.listeners[0].error(new Error('late')); expect(onError).toHaveBeenCalledOnce(); expect(state.listeners.every(listener => listener.off.mock.calls.length === 1)).toBe(true);
});
