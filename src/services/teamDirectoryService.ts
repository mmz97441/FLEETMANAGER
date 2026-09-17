import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import type { User } from '../types';
import { beginDiagnosticOperation } from '../utils/runtimeDiagnostics';
import { notifyInfo, reportError } from './logService';

const RETRIES = [5000, 15000, 30000, 60000];
const ACCESS_ERRORS = new Set(['functions/permission-denied', 'functions/unauthenticated']);

/** Directory reads never overlap or poll while offline/hidden. Existing names survive transient failures. */
export function subscribeToTeamDirectory(currentUser: User, callback: (users: User[]) => void) {
  let cancelled = false, busy = false, stopped = false, loaded = false, informed = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const callable = httpsCallable<unknown, { users: User[] }>(getFunctions(app, 'europe-west1'), 'getTeamDirectory', { timeout: 20000 });
  const canRead = () => !cancelled && !stopped && navigator.onLine !== false && document.visibilityState !== 'hidden';
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => { clearTimer(); if (canRead()) timer = setTimeout(() => { timer = undefined; void refresh(); }, delay); };
  const refresh = async () => {
    if (busy || !canRead()) return;
    busy = true;
    const started = Date.now(), operation = beginDiagnosticOperation('directory.load');
    let delay = 60000;
    try {
      const result = await callable({});
      if (!Array.isArray(result.data?.users)) throw new Error('Réponse d’annuaire invalide.');
      operation.finish('success');
      if (cancelled) return;
      const users = result.data.users.filter(user => user && typeof user.id === 'string');
      callback([currentUser, ...users.filter(user => user.id !== currentUser.id)]);
      loaded = true;
      failures = 0;
      informed = false;
    } catch (error) {
      operation.finish('failure');
      if (cancelled) return;
      failures++;
      delay = RETRIES[Math.min(failures - 1, RETRIES.length - 1)];
      const code = String((error as { code?: string })?.code || '');
      stopped = ACCESS_ERRORS.has(code);
      if (stopped) callback([currentUser]);
      reportError('directory.load', error, { silent: true, extra: { operationId: operation.id, durationMs: Math.max(0, Date.now() - started), attempt: failures, retryInMs: stopped ? null : delay, hasPreviousData: loaded } });
      if ((!loaded || stopped) && !informed && navigator.onLine !== false && document.visibilityState !== 'hidden') {
        informed = true;
        notifyInfo(stopped ? 'La liste des collègues n’est pas accessible. Reconnectez-vous pour réessayer.' : 'La liste des collègues est temporairement indisponible. Une nouvelle tentative est prévue.');
      }
    } finally {
      busy = false;
      if (!cancelled) schedule(delay);
    }
  };
  const wake = () => { clearTimer(); if (canRead()) void refresh(); };
  // Never retain a previous user's directory while the new account is loading.
  callback([currentUser]);
  window.addEventListener('online', wake);
  window.addEventListener('offline', wake);
  document.addEventListener('visibilitychange', wake);
  void refresh();
  return () => {
    cancelled = true;
    clearTimer();
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}
