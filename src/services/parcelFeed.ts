import { collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, onSnapshot, orderBy, query, startAfter, where,
  type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { PackageStatus, type Package } from '../types';
import { hasPendingDeliveryProof } from '../utils/deliveryProofState';

export interface ParcelCoverage {
  activeReady: boolean;
  historyComplete: boolean;
  historyLoading: boolean;
  historyCount: number;
  activeCount: number;
  hasMore: boolean;
  /** At least one source has not been confirmed by the server. */
  fromCache: boolean;
  refreshedAt?: string;
  error?: string;
}
export interface ParcelFeedController {
  loadMore(): Promise<void>;
  /** Refresh active work and every historical page from the server. */
  loadAll(): Promise<Package[]>;
  /** Keep an open parcel current independently of its historical page. */
  watchParcel(id: string, onError?: (error: Error) => void): () => void;
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
const convert = (entry: { id: string; data(): unknown }) => ({ ...entry.data() as object, id: entry.id }) as Package;
const denied = (error: unknown) => ['permission-denied', 'firestore/permission-denied', 'not-found'].includes(String((error as { code?: string })?.code));

/** Unbounded active subscriptions, paginated historical snapshots, and small
 * document subscriptions for open records or photos still being published. */
export function subscribeParcelFeed(options: ParcelFeedOptions): ParcelFeedController {
  const pageSize = Math.max(1, Math.min(options.pageSize || 75, 200));
  const scopes = options.scopes?.length ? options.scopes : [undefined];
  const states = scopes.map(scope => ({ scope, active: new Map<string, Package>(), history: new Map<string, Package>(),
    activeReady: false, historyReady: false, activeServer: false, historyServer: false,
    complete: false, cursor: undefined as QueryDocumentSnapshot | undefined, paginated: false,
    revisions: new Map<string, number>(), activeRevision: 0 }));
  let revision = 0, pendingReads = 0;
  const verifications = new Set<Promise<void>>();
  let stopped = false, loading = false, failure: Error | undefined, refreshedAt: string | undefined;
  let operation: Promise<void> | undefined, operationRefresh = false;
  const unsubs: Array<() => void> = [];
  const watches = new Map<string, { pending: boolean; callbacks: Set<(error: Error) => void>; leases: number; off?: () => void }>();
  const constraints = (scope: ParcelFeedScope | undefined): QueryConstraint[] => scope ? [where(scope.field, '==', scope.value)] : [];
  const activeQuery = (state: typeof states[number]) => query(collection(db, 'packages'), ...constraints(state.scope), where('status', 'in', activeStatuses));
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
    const fromCache = states.some(s => !s.activeServer || !s.historyServer);
    return { activeReady: states.every(s => s.activeReady), historyComplete: complete && !fromCache && !failure && !loading && !pendingReads,
      fromCache, historyLoading: loading, historyCount: parcels.length - activeCount, activeCount, hasMore: !complete,
      ...(refreshedAt ? { refreshedAt } : {}), ...(failure ? { error: failure.message } : {}) };
  };
  const emit = () => {
    if (stopped) return;
    const state = coverage(); options.onCoverage?.(state);
    if (states.every(s => s.activeReady && s.historyReady) && !failure) options.onChange(current(), state);
  };
  const report = (error: Error) => { if (!stopped) { failure = error; options.onError?.(error); emit(); } };
  const releaseWatch = (id: string) => {
    const watch = watches.get(id);
    if (watch && !watch.pending && !watch.leases) { watches.delete(id); watch.off?.(); }
  };
  const applyDocument = (id: string, value: Package | null) => {
    for (const state of states) {
      const inScope = value && (!state.scope || value[state.scope.field] === state.scope.value);
      state.active.delete(id); state.history.delete(id);
      if (inScope) (terminal(value) ? state.history : state.active).set(id, value);
      state.revisions.set(id, ++revision);
    }
  };
  const ensureWatch = (id: string, pending = false) => {
    let watch = watches.get(id);
    if (watch) { watch.pending ||= pending; return watch; }
    watch = { pending, callbacks: new Set(), leases: 0 }; watches.set(id, watch);
    const target = watch;
    target.off = onSnapshot(doc(db, 'packages', id), { includeMetadataChanges: true }, snapshot => {
      if (stopped || watches.get(id) !== target) return;
      // A cached document cannot undo a newer authoritative query result.
      if (snapshot.metadata.fromCache) return;
      const value = snapshot.exists() ? convert(snapshot) : null;
      applyDocument(id, value);
      target.pending = !!value && terminal(value) && hasPendingDeliveryProof(value);
      emit(); releaseWatch(id);
    }, error => {
      if (stopped || watches.get(id) !== target) return;
      if (denied(error)) { applyDocument(id, null); target.pending = false; emit(); }
      else report(error);
      target.callbacks.forEach(callback => callback(error));
      watches.delete(id); target.off?.();
    });
    return target;
  };
  const observePending = (parcel: Package) => { if (terminal(parcel) && hasPendingDeliveryProof(parcel)) ensureWatch(parcel.id, true); };
  const verifyRemoved = (id: string) => {
    const started = revision;
    pendingReads++;
    const verification = getDocFromServer(doc(db, 'packages', id)).then(snapshot => {
      if (stopped) return;
      // An overlapping document/query update is newer than this read.
      if (states.some(state => (state.revisions.get(id) || 0) > started)) return;
      const value = snapshot.exists() ? convert(snapshot) : null;
      applyDocument(id, value); if (value) observePending(value);
    }).catch(error => {
      if (denied(error)) { if (!stopped) applyDocument(id, null); }
      else report(error);
    }).finally(() => { pendingReads--; verifications.delete(verification); emit(); });
    verifications.add(verification);
  };
  for (const state of states) {
    unsubs.push(onSnapshot(activeQuery(state), { includeMetadataChanges: true }, snapshot => {
      if (stopped) return;
      const previous = state.active;
      state.active = new Map(snapshot.docs.map(entry => [entry.id, convert(entry)])); state.activeReady = true;
      state.activeServer = !snapshot.metadata.fromCache; state.activeRevision = ++revision;
      for (const id of state.active.keys()) {
        for (const source of states) source.history.delete(id);
        state.revisions.set(id, revision);
      }
      if (!snapshot.metadata.fromCache) for (const change of snapshot.docChanges()) if (change.type === 'removed') {
        // Subscribe immediately: proof publication can race the status transition.
        const prior = previous.get(change.doc.id);
        if (prior && !states.some(source => source.active.has(change.doc.id))) state.history.set(change.doc.id, prior);
        ensureWatch(change.doc.id, true);
      }
      emit();
    }, error => { state.activeReady = false; state.activeServer = false; report(error); }));
    unsubs.push(onSnapshot(historyQuery(state), { includeMetadataChanges: true }, snapshot => {
      if (stopped) return;
      state.historyServer = !snapshot.metadata.fromCache;
      for (const entry of snapshot.docs) {
        const parcel = convert(entry); state.history.set(entry.id, parcel); state.revisions.set(entry.id, ++revision);
        if (!snapshot.metadata.fromCache) observePending(parcel);
      }
      if (!state.paginated) { state.cursor = snapshot.docs[snapshot.docs.length - 1]; state.complete = !snapshot.metadata.fromCache && snapshot.size < pageSize; }
      if (!snapshot.metadata.fromCache) for (const change of snapshot.docChanges()) if (change.type === 'removed') verifyRemoved(change.doc.id);
      state.historyReady = true; emit();
    }, error => { state.historyReady = false; state.historyServer = false; report(error); }));
  }
  const execute = (refresh: boolean): Promise<void> => {
    if (operation) return refresh && !operationRefresh ? operation.then(() => execute(true)) : operation;
    operationRefresh = refresh;
    operation = Promise.resolve().then(async () => {
      if (stopped) throw new Error('Le suivi des colis a été fermé.');
      loading = true; failure = undefined; emit();
      try {
        for (const state of states) {
          if (!refresh && state.complete && state.historyServer) continue;
          if (!state.activeReady || !state.historyReady) throw new Error('Attendez le chargement des colis avant de charger l’historique.');
          const startedRevision = revision;
          if (refresh) {
            const active = await getDocsFromServer(activeQuery(state));
            if (stopped) return;
            if (active.metadata.fromCache) throw new Error('Le serveur n’a pas confirmé les colis actifs.');
            if (state.activeRevision <= startedRevision || !state.activeServer) state.active = new Map(active.docs.map(entry => [entry.id, convert(entry)]));
            state.activeServer = true;
          }
          let cursor = refresh ? undefined : state.cursor;
          const collected = refresh ? new Map<string, Package>() : new Map(state.history);
          let complete = false;
          do {
            const page = await getDocsFromServer(historyQuery(state, cursor));
            if (stopped) return;
            if (page.metadata.fromCache) throw new Error('Le serveur n’a pas confirmé tout l’historique.');
            for (const entry of page.docs) { const parcel = convert(entry); collected.set(entry.id, parcel); observePending(parcel); }
            cursor = page.docs[page.docs.length - 1] || cursor;
            complete = page.size < pageSize;
          } while (refresh && !complete);
          for (const [id, changedAt] of state.revisions) if (changedAt > startedRevision) {
            const parcel = state.history.get(id);
            if (parcel) collected.set(id, parcel); else collected.delete(id);
          }
          for (const id of state.active.keys()) collected.delete(id);
          state.history = collected; state.cursor = cursor; state.complete = complete; state.paginated = true; state.historyServer = true;
        }
        // A removed first-page record may be revoked or merely outside page one.
        // Exports must wait for that server decision before accepting the union.
        while (verifications.size && !stopped) await Promise.all([...verifications]);
        if (failure) throw failure;
        refreshedAt = new Date().toISOString();
      } catch (error) { report(error instanceof Error ? error : new Error('L’historique n’a pas pu être chargé.')); throw error; }
      finally { loading = false; emit(); }
    }).finally(() => { operation = undefined; });
    return operation;
  };
  return {
    loadMore: () => execute(false),
    loadAll: async () => { await execute(true); if (stopped) throw new Error('Le suivi des colis a été fermé.'); return current(); },
    watchParcel: (id, onError) => {
      if (stopped || !id || id.includes('/')) return () => {};
      const watch = ensureWatch(id); watch.leases++; if (onError) watch.callbacks.add(onError);
      let released = false;
      return () => { if (released) return; released = true; watch.leases--; if (onError) watch.callbacks.delete(onError); releaseWatch(id); };
    },
    unsubscribe: () => { stopped = true; unsubs.forEach(unsub => unsub()); watches.forEach(watch => watch.off?.()); watches.clear(); },
  };
}
