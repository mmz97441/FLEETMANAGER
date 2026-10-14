import { collection, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where,
  type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { PackageStatus, type Package } from '../types';

export interface ParcelCoverage {
  activeReady: boolean;
  historyComplete: boolean;
  historyLoading: boolean;
  historyCount: number;
  activeCount: number;
  hasMore: boolean;
  refreshedAt?: string;
  error?: string;
}
export interface ParcelFeedController {
  loadMore(): Promise<void>;
  /** Refresh every historical page before analytics/export; returns that complete snapshot. */
  loadAll(): Promise<Package[]>;
  unsubscribe(): void;
}
export interface ParcelFeedScope { field: 'clientId' | 'clientName'; value: string }
export interface ParcelFeedOptions {
  scopes?: ParcelFeedScope[];
  pageSize?: number;
  onChange: (packages: Package[], coverage: ParcelCoverage) => void;
  onCoverage?: (coverage: ParcelCoverage) => void;
  onError?: (error: Error) => void;
}
const terminalStatuses = [PackageStatus.DELIVERED, PackageStatus.RETURNED];
const activeStatuses = Object.values(PackageStatus).filter(status => !terminalStatuses.includes(status));
const terminal = (parcel: Package) => terminalStatuses.includes(parcel.status);
const convert = (doc: QueryDocumentSnapshot) => ({ ...doc.data(), id: doc.id }) as Package;
/** Active work has no limit. Historical pagination uses document ID so records
 * without createdAt are never silently excluded. Display remains chronological. */
export function subscribeParcelFeed(options: ParcelFeedOptions): ParcelFeedController {
  const pageSize = Math.max(1, Math.min(options.pageSize || 75, 200));
  const scopes = options.scopes?.length ? options.scopes : [undefined];
  const states = scopes.map(scope => ({ scope, active: new Map<string, Package>(), history: new Map<string, Package>(),
    activeReady: false, historyReady: false, complete: false, cursor: undefined as QueryDocumentSnapshot | undefined,
    paginated: false, revisions: new Map<string, number>() }));
  let revision = 0;
  let stopped = false, loading = false, failure: Error | undefined, refreshedAt: string | undefined;
  let operation: Promise<void> | undefined;
  const unsubs: Array<() => void> = [];
  const constraints = (scope: ParcelFeedScope | undefined): QueryConstraint[] => scope ? [where(scope.field, '==', scope.value)] : [];
  const historyQuery = (state: typeof states[number], cursor?: QueryDocumentSnapshot) => query(collection(db, 'packages'),
    ...constraints(state.scope), where('status', 'in', terminalStatuses), orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(pageSize));
  const current = (): Package[] => {
    const merged = new Map<string, Package>();
    for (const state of states) for (const [id, parcel] of state.history) merged.set(id, parcel);
    for (const state of states) for (const [id, parcel] of state.active) merged.set(id, parcel);
    return [...merged.values()].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0) || a.id.localeCompare(b.id));
  };
  const coverage = (): ParcelCoverage => {
    const parcels = current(), activeCount = parcels.filter(p => !terminal(p)).length;
    const complete = states.every(s => s.historyReady && s.complete);
    return { activeReady: states.every(s => s.activeReady), historyComplete: complete && !failure && !loading,
      historyLoading: loading, historyCount: parcels.length - activeCount, activeCount, hasMore: !complete,
      ...(refreshedAt ? { refreshedAt } : {}), ...(failure ? { error: failure.message } : {}) };
  };
  const emit = () => {
    if (stopped) return;
    const state = coverage(); options.onCoverage?.(state);
    if (states.every(s => s.activeReady && s.historyReady) && !failure) options.onChange(current(), state);
  };
  const report = (error: Error) => { if (!stopped) { failure = error; options.onError?.(error); emit(); } };
  for (const state of states) {
    unsubs.push(onSnapshot(query(collection(db, 'packages'), ...constraints(state.scope), where('status', 'in', activeStatuses)), snapshot => {
      const previous = state.active;
      state.active = new Map(snapshot.docs.map(doc => [doc.id, convert(doc)])); state.activeReady = true;
      for (const id of state.active.keys()) for (const source of states) source.history.delete(id);
      // A completed active parcel stays visible even when its historical page
      // has not been loaded. Read its new status instead of retaining stale work.
      for (const [id, parcel] of previous) if (!state.active.has(id)) {
        const removed = snapshot.docChanges().find(change => change.type === 'removed' && change.doc.id === id);
        if (!removed) continue;
        void getDoc(removed.doc.ref).then(doc => {
          if (stopped || state.active.has(id)) return;
          const value = doc.exists() ? { ...doc.data(), id } as Package : null;
          const inScope = !state.scope || value?.[state.scope.field] === state.scope.value;
          if (value && inScope && terminal(value)) state.history.set(id, value); else state.history.delete(id);
          state.revisions.set(id, ++revision);
          emit();
        }).catch(report);
        // Preserve the previous entry until the authoritative lookup completes.
        state.history.set(id, parcel);
      }
      emit();
    }, error => { state.activeReady = false; report(error); }));
    unsubs.push(onSnapshot(historyQuery(state), snapshot => {
      for (const doc of snapshot.docs) { state.history.set(doc.id, convert(doc)); state.revisions.set(doc.id, ++revision); }
      if (!state.paginated) { state.cursor = snapshot.docs[snapshot.docs.length - 1]; state.complete = snapshot.size < pageSize; }
      state.historyReady = true; emit();
    }, error => { state.historyReady = false; report(error); }));
  }
  const execute = (refresh: boolean): Promise<void> => {
    if (operation) return operation.then(() => refresh ? execute(true) : undefined);
    operation = Promise.resolve().then(async () => {
      if (stopped) throw new Error('Le suivi des colis a été fermé.');
      loading = true; failure = undefined; emit();
      try {
        for (const state of states) {
          if (!refresh && state.complete) continue;
          if (!state.activeReady || !state.historyReady) throw new Error('Attendez le chargement des colis avant de charger l’historique.');
          let cursor = refresh ? undefined : state.cursor;
          const startedRevision = revision;
          // Build a fresh history independently. An error never discards the
          // already visible list or claims complete coverage.
          const collected = refresh ? new Map<string, Package>() : new Map(state.history);
          let complete = false;
          do {
            const page = await getDocs(historyQuery(state, cursor));
            if (stopped) return;
            for (const doc of page.docs) collected.set(doc.id, convert(doc));
            cursor = page.docs[page.docs.length - 1] || cursor;
            complete = page.size < pageSize;
          } while (refresh && !complete);
          // Merge terminal transitions observed during the historical request.
          for (const [id, changedAt] of state.revisions) if (changedAt > startedRevision) {
            const parcel = state.history.get(id);
            if (parcel) collected.set(id, parcel); else collected.delete(id);
          }
          for (const id of state.active.keys()) collected.delete(id);
          state.history = collected; state.cursor = cursor; state.complete = complete; state.paginated = true;
        }
        refreshedAt = new Date().toISOString();
      } catch (error) { report(error instanceof Error ? error : new Error('L’historique n’a pas pu être chargé.')); throw error; }
      finally { loading = false; emit(); }
    }).finally(() => { operation = undefined; });
    return operation;
  };
  return { loadMore: () => execute(false), loadAll: async () => { await execute(true); if (stopped) throw new Error('Le suivi des colis a été fermé.'); return current(); },
    unsubscribe: () => { stopped = true; unsubs.forEach(unsub => unsub()); } };
}
