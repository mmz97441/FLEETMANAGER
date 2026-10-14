/** In-memory activity only. Durable outbox entries do not prevent an update. */
export type UpdateSafetySnapshot = Readonly<{ dirty: boolean; busy: boolean; active: boolean }>;
type Source = () => Partial<UpdateSafetySnapshot>;
const sources = new Map<symbol, Source>();
const listeners = new Set<() => void>();
let snapshot: UpdateSafetySnapshot = Object.freeze({ dirty: false, busy: false, active: false });
let publishedSnapshot = snapshot;

function readSnapshot(): UpdateSafetySnapshot {
  let dirty = false, busy = false, active = false;
  for (const read of sources.values()) {
    const state = read();
    dirty ||= !!state.dirty; busy ||= !!state.busy; active ||= !!state.active;
  }
  if (dirty !== snapshot.dirty || busy !== snapshot.busy || active !== snapshot.active) {
    snapshot = Object.freeze({ dirty, busy, active });
  }
  return snapshot;
}

/** Stable identity for React.useSyncExternalStore; also rechecks current refs. */
export const getUpdateSafetySnapshot = () => readSnapshot();
export function subscribeUpdateSafety(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function refreshUpdateSafety(): void {
  const next = readSnapshot();
  if (next !== publishedSnapshot) {
    publishedSnapshot = next;
    for (const listener of [...listeners]) listener();
  }
}
export function registerUpdateSafetySource(read: Source): () => void {
  const id = Symbol('update-safety');
  sources.set(id, read);
  refreshUpdateSafety();
  return () => { if (sources.delete(id)) refreshUpdateSafety(); };
}

/** Call before the first await; release only after local writes/remote work settle. */
export function beginUpdateOperation(): () => void {
  return registerUpdateSafetySource(() => ({ busy: true }));
}
export async function withUpdateOperation<T>(work: () => Promise<T>): Promise<T> {
  const release = beginUpdateOperation();
  try { return await work(); }
  finally { release(); }
}
