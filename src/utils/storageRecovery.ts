let failed = false;
const listeners = new Set<() => void>();
export function isStorageFailure(error: unknown): boolean {
  const message = typeof error === 'object' && error ? String((error as { message?: unknown }).message || '') : String(error || '');
  return /Attempt to iterate a cursor that doesn't exist|FIRESTORE.*INTERNAL ASSERTION FAILED|Indexed Database server.*lost|connection to.*IndexedDB.*lost/i.test(message);
}
export function noteStorageFailure(error: unknown) {
  if (failed || !isStorageFailure(error)) return;
  failed = true;
  listeners.forEach(listener => listener());
}
export const hasStorageFailure = () => failed;
export const subscribeStorageFailure = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
