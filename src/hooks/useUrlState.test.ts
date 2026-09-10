import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readUrlParam, updateUrlParams, urlChangeEvent } from './useUrlState';

let browser: EventTarget & { location: URL; history: { state: unknown; pushState: ReturnType<typeof vi.fn>; replaceState: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  browser = Object.assign(new EventTarget(), {
    location: new URL('https://fleet.test/missions?tab=packages&date=2026-09-10#parcel'),
    history: {
      state: { scroll: 450 },
      pushState: vi.fn((_state, _title, target) => { browser.location = new URL(target, browser.location.href); }),
      replaceState: vi.fn((_state, _title, target) => { browser.location = new URL(target, browser.location.href); }),
    },
  });
  vi.stubGlobal('window', browser);
});
afterEach(() => vi.unstubAllGlobals());

it('keeps the page, date, tab and hash when changing a search filter', () => {
  const changed = vi.fn(); browser.addEventListener(urlChangeEvent, changed);
  updateUrlParams({ q: 'Épicerie & livraison' }, true);
  expect(browser.location.pathname).toBe('/missions');
  expect(browser.location.searchParams.get('tab')).toBe('packages');
  expect(browser.location.searchParams.get('date')).toBe('2026-09-10');
  expect(browser.location.searchParams.get('q')).toBe('Épicerie & livraison');
  expect(browser.location.hash).toBe('#parcel');
  expect(browser.history.replaceState).toHaveBeenCalledWith({ scroll: 450 }, '', expect.any(String));
  expect(changed).toHaveBeenCalledOnce();
});

it('supports a shareable parcel link and clears only the requested context', () => {
  updateUrlParams({ package: 'parcel/with spaces', mission: null });
  expect(browser.location.searchParams.get('package')).toBe('parcel/with spaces');
  expect(browser.history.pushState).toHaveBeenCalledOnce();
  updateUrlParams({ package: null });
  expect(browser.location.searchParams.has('package')).toBe(false);
  expect(browser.location.searchParams.get('tab')).toBe('packages');
});

it('ignores an invalid tab and avoids writing unchanged navigation state', () => {
  expect(readUrlParam('tab', 'dashboard', ['dashboard', 'missions'])).toBe('dashboard');
  updateUrlParams({ tab: 'packages', date: '2026-09-10' });
  expect(browser.history.pushState).not.toHaveBeenCalled();
  expect(browser.history.replaceState).not.toHaveBeenCalled();
});
