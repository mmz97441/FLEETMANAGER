import { useCallback, useSyncExternalStore } from 'react';

export const urlChangeEvent = 'fleet-url-change';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener(urlChangeEvent, notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener(urlChangeEvent, notify);
  };
};

/** Update only the requested filters; leave page, other filters and hash intact. */
export function updateUrlParams(values: Record<string, string | null>, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (url.href === window.location.href) return;
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (replace) window.history.replaceState(window.history.state, '', target);
  else window.history.pushState(window.history.state, '', target);
  window.dispatchEvent(new Event(urlChangeEvent));
}

export function readUrlParam<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  const value = new URLSearchParams(window.location.search).get(key);
  return value !== null && (!allowed || allowed.includes(value as T)) ? value as T : fallback;
}

/** No write on mount: browser back and external deep links remain authoritative. */
export function useUrlParam<T extends string = string>(key: string, fallback: T, allowed?: readonly T[]) {
  const value = useSyncExternalStore(subscribe, () => readUrlParam(key, fallback, allowed), () => fallback);
  const setValue = useCallback((next: T | ((previous: T) => T), replace = false) => {
    const resolved = typeof next === 'function' ? next(readUrlParam(key, fallback, allowed)) : next;
    updateUrlParams({ [key]: resolved === fallback ? null : resolved }, replace);
  }, [key, fallback, allowed]);
  return [value, setValue] as const;
}
