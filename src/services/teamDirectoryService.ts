import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import type { User } from '../types';
import { beginDiagnosticOperation } from '../utils/runtimeDiagnostics';
import { notifyInfo, reportError } from './logService';
import { withDeadline } from '../utils/asyncDeadline';

const RETRIES = [5000, 15000, 30000, 60000];
const ACCESS_ERRORS = new Set(['functions/permission-denied', 'functions/unauthenticated']);

/** Directory reads never overlap or poll while offline/hidden. Existing names survive transient failures. */
export function subscribeToTeamDirectory(currentUser: User, callback: (users: User[]) => void) {
  let cancelled = false, busy = false, stopped = false, loaded = false, informed = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0, startedAt = 0;
  const callable = httpsCallable<unknown, { users: User[] }>(getFunctions(app, 'europe-west1'), 'getTeamDirectory', { timeout: 20000 });
  const canRead = () => !cancelled && !stopped && navigator.onLine !== false && document.visibilityState !== 'hidden';
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => { clearTimer(); if (canRead()) timer = setTimeout(() => { timer = undefined; void refresh(); }, delay); };
  const refresh = async () => {
    if (busy || !canRead()) return;
    busy = true;
    const attempt = ++generation;
    startedAt = Date.now();
    const started = Date.now(), operation = beginDiagnosticOperation('directory.load');
    let delay = 60000;
    try {
      const result = await withDeadline(callable({}), 20000, Object.assign(new Error('Chargement de la liste trop long.'), { code: 'functions/deadline-exceeded' }));
      if (cancelled || attempt !== generation) return;
      if (!Array.isArray(result.data?.users)) throw new Error('Réponse d’annuaire invalide.');
      operation.finish('success');
      if (cancelled || attempt !== generation) return;
      const users = result.data.users.filter(user => user && typeof user.id === 'string');
      callback([currentUser, ...users.filter(user => user.id !== currentUser.id)]);
      loaded = true;
      failures = 0;
      informed = false;
    } catch (error) {
      operation.finish('failure');
      if (cancelled || attempt !== generation) return;
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
      if (attempt === generation) {
        busy = false;
        if (!cancelled) schedule(delay);
      }
    }
  };
  const wake = () => {
    clearTimer();
    // Timers can be suspended on phones. Retire the old read on backgrounding
    // or an overdue wake; its late response must not replace the fresh list.
    if (!canRead() || (busy && Date.now() - startedAt >= 20000)) { generation++; busy = false; }
    if (canRead()) void refresh();
  };
  // Never retain a previous user's directory while the new account is loading.
  callback([currentUser]);
  window.addEventListener('online', wake);
  window.addEventListener('offline', wake);
  document.addEventListener('visibilitychange', wake);
  void refresh();
  return () => {
    cancelled = true;
    generation++;
    clearTimer();
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}
