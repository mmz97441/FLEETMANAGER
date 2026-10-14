import { useSyncExternalStore } from 'react';
import { createAppUpdateMonitor, type AppUpdateState } from '../services/appUpdate';

const POLL_MS = 60_000;
let monitor: ReturnType<typeof createAppUpdateMonitor> | undefined;
let consumers = 0;
let stopWatching: (() => void) | undefined;
function sharedMonitor() {
  if (!monitor) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Browsers can forbid persistence. */ }
    monitor = createAppUpdateMonitor({ current: { version: __APP_VERSION__, buildId: __BUILD_ID__ },
      fetch: (url, options) => fetch(url, options), storage });
  }
  return monitor;
}
const checkNow = () => sharedMonitor().checkNow();
export const getLatestAppUpdateState = () => sharedMonitor().getSnapshot();
const subscribe = (listener: () => void) => {
  const active = sharedMonitor(), unsubscribe = active.subscribe(listener);
  if (++consumers === 1) {
    const check = () => { void active.checkNow(); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    const timer = window.setInterval(visible, POLL_MS);
    window.addEventListener('focus', visible);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', visible);
    stopWatching = () => {
      clearInterval(timer); window.removeEventListener('focus', visible); window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', visible); active.cancelPending();
    };
    check();
  }
  return () => { unsubscribe(); if (--consumers === 0) { stopWatching?.(); stopWatching = undefined; } };
};

/** Shared detection only. The caller chooses the gate; no form or proof is reloaded here. */
export function useAutoUpdate(): AppUpdateState & { checkNow: () => Promise<boolean> } {
  const state = useSyncExternalStore(subscribe, getLatestAppUpdateState, getLatestAppUpdateState);
  return { ...state, checkNow };
}
