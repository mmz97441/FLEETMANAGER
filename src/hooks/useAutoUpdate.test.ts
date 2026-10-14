import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ subscriptions: [] as Array<{ subscribe: (listener: () => void) => () => void; snapshot: () => any }> }));
vi.mock('react', () => ({ useSyncExternalStore: (subscribe: any, snapshot: any) => { hooks.subscriptions.push({ subscribe, snapshot }); return snapshot(); } }));
const valid = { version: __APP_VERSION__, buildId: __BUILD_ID__ };
let browser: EventTarget, page: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); hooks.subscriptions.length = 0;
  browser = new EventTarget(); Object.assign(browser, { setInterval, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', browser); vi.stubGlobal('document', page);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => valid }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };

it('shares startup checks and the 60-second poll between App and every office status card', async () => {
  const { useAutoUpdate } = await import('./useAutoUpdate'); useAutoUpdate(); useAutoUpdate();
  const first = hooks.subscriptions[0].subscribe(() => {}), second = hooks.subscriptions[1].subscribe(() => {});
  await settle(); expect(fetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledTimes(2);
  first(); await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledTimes(3);
  second(); await vi.advanceTimersByTimeAsync(60000); expect(fetch).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});

it('checks on focus, visible return and online, while hidden polling stays quiet', async () => {
  const { useAutoUpdate } = await import('./useAutoUpdate'); useAutoUpdate(); const unsubscribe = hooks.subscriptions[0].subscribe(() => {});
  await settle(); page.visibilityState = 'hidden';
  browser.dispatchEvent(new Event('focus')); page.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(60000);
  expect(fetch).toHaveBeenCalledOnce();
  page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); await settle(); expect(fetch).toHaveBeenCalledTimes(2);
  browser.dispatchEvent(new Event('focus')); await settle(); expect(fetch).toHaveBeenCalledTimes(3);
  browser.dispatchEvent(new Event('online')); await settle(); expect(fetch).toHaveBeenCalledTimes(4);
  unsubscribe(); browser.dispatchEvent(new Event('online')); browser.dispatchEvent(new Event('focus')); await settle(); expect(fetch).toHaveBeenCalledTimes(4);
});

it('coalesces all events while checking and cancels a request when its last consumer leaves', async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  const { useAutoUpdate } = await import('./useAutoUpdate'); const state = useAutoUpdate();
  const unsubscribe = hooks.subscriptions[0].subscribe(() => {}); await settle();
  browser.dispatchEvent(new Event('focus')); browser.dispatchEvent(new Event('online')); page.dispatchEvent(new Event('visibilitychange')); void state.checkNow();
  await settle(); expect(fetch).toHaveBeenCalledOnce();
  unsubscribe(); await settle(); expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
