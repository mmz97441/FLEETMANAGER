import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../services/confirmationService', () => ({ confirmAction: confirm }));
const reload = vi.fn();
beforeEach(() => {
  vi.resetModules(); confirm.mockReset(); reload.mockReset();
  vi.stubGlobal('window', { location: { reload } });
});
afterEach(() => vi.unstubAllGlobals());

it.each(['dirty', 'busy', 'active'] as const)('mandatory update never discards %s activity or offers abandonment', async key => {
  const safety = await import('../services/updateSafety');
  const release = safety.registerUpdateSafetySource(() => ({ [key]: true }));
  const { reloadApplication } = await import('./reloadApplication');
  expect(await reloadApplication({ requireClean: true })).toBe(false);
  expect(confirm).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  release();
  expect(await reloadApplication({ requireClean: true })).toBe(true);
  expect(reload).toHaveBeenCalledOnce();
});

it('does not reload automatically when a busy operation ends', async () => {
  const safety = await import('../services/updateSafety');
  const release = safety.beginUpdateOperation();
  const { reloadApplication } = await import('./reloadApplication');
  expect(await reloadApplication({ requireClean: true })).toBe(false);
  release(); await Promise.resolve();
  expect(reload).not.toHaveBeenCalled();
});

it('rechecks background operations after an explicit abandonment confirmation', async () => {
  const safety = await import('../services/updateSafety');
  const draft = safety.registerUpdateSafetySource(() => ({ dirty: true }));
  let end!: () => void;
  confirm.mockImplementation(async () => { end = safety.beginUpdateOperation(); return true; });
  const { reloadApplication } = await import('./reloadApplication');
  expect(await reloadApplication()).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  end(); draft();
});

it('allows an explicit confirmed reload of a camera while keeping durable storage untouched', async () => {
  const safety = await import('../services/updateSafety');
  const release = safety.registerUpdateSafetySource(() => ({ active: true }));
  confirm.mockResolvedValue(true);
  const { reloadApplication } = await import('./reloadApplication');
  expect(await reloadApplication()).toBe(true);
  expect(confirm).toHaveBeenCalledOnce(); expect(reload).toHaveBeenCalledOnce();
  release();
});
