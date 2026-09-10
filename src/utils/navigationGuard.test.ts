import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../services/confirmationService', () => ({ confirmAction: confirm }));
import { installNavigationGuard, registerNavigationDraft, requestNavigation } from './navigationGuard';

class Pop extends Event { state: unknown; constructor(_type: string, options: { state: unknown }) { super('popstate'); this.state = options.state; } }
let browser: EventTarget & { location: URL; history: any };
let uninstall: () => void;
let unregister: () => void;
let entries: { url: string; state: any }[];
let cursor: number;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  confirm.mockReset().mockResolvedValue(false);
  entries = [{ url: 'https://fleet.test/', state: null }]; cursor = 0;
  browser = Object.assign(new EventTarget(), { location: new URL(entries[0].url), history: {
    get state() { return entries[cursor].state; },
    pushState(state: any, _title: string, url: string) { entries = entries.slice(0, cursor + 1); entries.push({ state, url: new URL(url, browser.location).href }); cursor++; browser.location = new URL(entries[cursor].url); },
    replaceState(state: any, _title: string, url: string) { entries[cursor] = { state, url: new URL(url, browser.location).href }; browser.location = new URL(entries[cursor].url); },
    go(delta: number) { const next = cursor + delta; if (next < 0 || next >= entries.length || !delta) return; queueMicrotask(() => { cursor = next; browser.location = new URL(entries[cursor].url); browser.dispatchEvent(new Pop('popstate', { state: entries[cursor].state })); }); },
  } });
  vi.stubGlobal('window', browser); vi.stubGlobal('PopStateEvent', Pop);
  uninstall = installNavigationGuard(); unregister = () => {};
});
afterEach(() => { unregister(); uninstall(); vi.unstubAllGlobals(); });
it('keeps a modified view and its URL when Back is cancelled', async () => {
  browser.history.pushState({ filter: 'today' }, '', '/missions');
  unregister = registerNavigationDraft(() => ({ dirty: true, busy: false }));
  const changed = vi.fn(); browser.addEventListener('popstate', changed);
  browser.history.go(-1); await tick(); await tick();
  expect(browser.location.pathname).toBe('/missions'); expect(cursor).toBe(1);
  expect(changed).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledOnce();
  expect(browser.history.state.filter).toBe('today');
});
it('accepts Back once, preserves Forward and never exposes the rejected intermediate view', async () => {
  browser.history.pushState({}, '', '/missions');
  unregister = registerNavigationDraft(() => ({ dirty: true, busy: false }));
  confirm.mockResolvedValue(true);
  const changed = vi.fn(); browser.addEventListener('popstate', changed);
  browser.history.go(-1); await tick(); await tick();
  expect(browser.location.pathname).toBe('/'); expect(changed).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledOnce();
  unregister(); unregister = () => {};
  browser.history.go(1); await tick();
  expect(browser.location.pathname).toBe('/missions'); expect(changed).toHaveBeenCalledTimes(2);
});
it('blocks navigation during a save even if the information dialog is accepted', async () => {
  unregister = registerNavigationDraft(() => ({ dirty: false, busy: true }));
  confirm.mockResolvedValue(true); const change = vi.fn();
  expect(await requestNavigation(change)).toBe(false); expect(change).not.toHaveBeenCalled();
});
it('does not bypass a save that starts while abandonment is being confirmed', async () => {
  let busy = false; unregister = registerNavigationDraft(() => ({ dirty: true, busy }));
  confirm.mockImplementation(async () => { busy = true; return true; });
  const change = vi.fn(); await requestNavigation(change); expect(change).not.toHaveBeenCalled();
});
it('combines nested drafts into one decision for an application view change', async () => {
  unregister = registerNavigationDraft(() => ({ dirty: true, busy: false }));
  const unregisterSecond = registerNavigationDraft(() => ({ dirty: true, busy: false }));
  try { confirm.mockResolvedValue(true); const change = vi.fn(); expect(await requestNavigation(change)).toBe(true); expect(confirm).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledOnce(); }
  finally { unregisterSecond(); }
});

it('preserves existing history after a full module reload, on both cancellation and acceptance', async () => {
  browser.history.pushState({ filter: 'today' }, '', '/missions');
  const originalStamp = { ...browser.history.state.__fleetNavigation };
  const originalEntries = entries.map(entry => entry.url);
  uninstall();
  vi.resetModules();
  const refreshed = await import('./navigationGuard');
  uninstall = refreshed.installNavigationGuard();
  unregister = refreshed.registerNavigationDraft(() => ({ dirty: true, busy: false }));
  expect(browser.history.state.__fleetNavigation).toEqual(originalStamp);
  browser.history.go(-1); await tick(); await tick();
  expect(cursor).toBe(1); expect(entries.map(entry => entry.url)).toEqual(originalEntries);
  expect(browser.location.pathname).toBe('/missions');
  confirm.mockResolvedValue(true);
  browser.history.go(-1); await tick(); await tick();
  expect(cursor).toBe(0); expect(browser.location.pathname).toBe('/');
  expect(entries.map(entry => entry.url)).toEqual(originalEntries);
  unregister(); unregister = () => {};
  browser.history.go(1); await tick();
  expect(browser.location.pathname).toBe('/missions');
  expect(browser.history.state.filter).toBe('today');
  expect(confirm).toHaveBeenCalledTimes(2);
});

it.each([
  null, [], {}, { session: '', index: 1 }, { session: 'has spaces', index: 1 },
  { session: 'x'.repeat(81), index: 1 }, { session: 123, index: 1 },
  { session: 'existing', index: '1' }, { session: 'existing', index: -1 },
  { session: 'existing', index: 1.5 }, { session: 'existing', index: Infinity },
  { session: 'existing', index: 0x80000000 },
])('replaces malformed history metadata without losing unrelated state: %j', stamp => {
  uninstall();
  browser.history.replaceState({ filter: 'retained', __fleetNavigation: stamp }, '', '/missions');
  uninstall = installNavigationGuard();
  expect(browser.history.state.filter).toBe('retained');
  expect(browser.history.state.__fleetNavigation).toMatchObject({ index: 0 });
  expect(browser.history.state.__fleetNavigation.session).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
});
