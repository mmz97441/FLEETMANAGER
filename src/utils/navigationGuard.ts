import { confirmAction } from '../services/confirmationService';

type Draft = { dirty: boolean; busy: boolean };
const drafts = new Map<symbol, () => Draft>();
let asking = false;
const historyKey = '__fleetNavigation';
const freshSession = Math.random().toString(36).slice(2) || Date.now().toString(36);
type HistoryStamp = { session: string; index: number };

function readHistoryStamp(state: unknown): HistoryStamp | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const stamp = (state as Record<string, unknown>)[historyKey];
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) return null;
  const { session, index } = stamp as Record<string, unknown>;
  if (typeof session !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(session)) return null;
  // history.go accepts a signed 32-bit traversal; reject malformed/unsafe indices.
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 0x7ffffffe) return null;
  return { session, index };
}

export function registerNavigationDraft(read: () => Draft) {
  const key = Symbol('draft');
  drafts.set(key, read);
  return () => { drafts.delete(key); };
}

export function navigationDraftState(): Draft {
  const states = [...drafts.values()].map(read => read());
  return { dirty: states.some(s => s.dirty), busy: states.some(s => s.busy) };
}

/** Used by every application view change, including browser Back/Forward. */
export async function requestNavigation(action: () => void | Promise<void>): Promise<boolean> {
  if (asking) return false;
  const state = navigationDraftState();
  if (!state.dirty && !state.busy) { await action(); return true; }
  asking = true;
  try {
    if (state.busy) {
      await confirmAction({ title: 'Opération en cours', message: 'Attendez la confirmation de l’opération avant de quitter cet écran. Votre saisie est conservée.', confirmLabel: 'Rester sur cet écran', cancelLabel: 'Continuer ici' });
      return false;
    }
    const leave = await confirmAction({ title: 'Abandonner cette saisie ?', message: 'Les modifications non enregistrées de cet écran seront perdues.', confirmLabel: 'Abandonner la saisie', cancelLabel: 'Continuer la saisie', danger: true });
    if (!leave || navigationDraftState().busy) return false;
    await action();
    return true;
  } finally { asking = false; }
}

/** Track our own history entries, restoring a traversal before asking about drafts.
 * Capture-phase interception keeps React and URL subscribers on the current view
 * until the user accepts. Native beforeunload remains responsible for documents
 * outside this SPA. No draft values are written to browser history.
 */
export function installNavigationGuard() {
  const history = window.history;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  // A reload keeps native history. Reuse its valid stamp so Back/Forward still
  // traverse the existing entries rather than treating them as unknown URLs.
  const initial = readHistoryStamp(history.state);
  const session = initial?.session ?? freshSession;
  const readIndex = (state: unknown): number | null => {
    const stamp = readHistoryStamp(state);
    return stamp?.session === session ? stamp.index : null;
  };
  const stamp = (state: any, index: number) => ({ ...(state && typeof state === 'object' ? state : {}), [historyKey]: { session, index } });
  let index = readIndex(history.state) ?? 0;
  let acceptedUrl = window.location.href;
  let acceptedState = stamp(history.state, index);
  replace(acceptedState, '', acceptedUrl);
  let restoring = false;
  let approved: number | null = null;
  let target: { index: number; url: string } | null = null;
  let alive = true;

  history.pushState = (state, title, url) => {
    push(stamp(state, ++index), title, url);
    acceptedUrl = window.location.href; acceptedState = history.state;
  };
  history.replaceState = (state, title, url) => {
    replace(stamp(state, index), title, url);
    acceptedUrl = window.location.href; acceptedState = history.state;
  };
  const onPop = (event: PopStateEvent) => {
    const next = readIndex(event.state);
    if (restoring) {
      event.stopImmediatePropagation();
      if (next !== index) { if (next !== null) history.go(index - next); return; }
      restoring = false;
      const requested = target;
      target = null;
      if (requested) void requestNavigation(() => {
        if (!alive) return;
        approved = requested.index;
        history.go(requested.index - index);
      });
      return;
    }
    if (approved !== null && next === approved) {
      approved = null; index = next; acceptedUrl = window.location.href; acceptedState = history.state;
      return;
    }
    const draft = navigationDraftState();
    if (!draft.dirty && !draft.busy && !asking) {
      index = next ?? index;
      acceptedUrl = window.location.href; acceptedState = stamp(history.state, index);
      if (next === null) replace(acceptedState, '', acceptedUrl);
      return;
    }
    event.stopImmediatePropagation();
    if (next !== null && next !== index) {
      target = { index: next, url: window.location.href };
      restoring = true;
      history.go(index - next);
    } else {
      // Older/untracked same-document entries (e.g. a fragment) cannot provide
      // a safe traversal delta. Keep the current document intact while asking.
      const nextUrl = window.location.href;
      replace(acceptedState, '', acceptedUrl);
      void requestNavigation(() => {
        if (!alive || nextUrl === acceptedUrl) return;
        history.pushState({}, '', nextUrl);
        approved = index;
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      });
    }
  };
  window.addEventListener('popstate', onPop, true);
  return () => {
    alive = false;
    history.pushState = push;
    history.replaceState = replace;
    window.removeEventListener('popstate', onPop, true);
  };
}
