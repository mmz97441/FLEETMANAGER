import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });

it('publishes a stable combined snapshot and releases nested operations independently', async () => {
  const safety = await import('./updateSafety');
  const notify = vi.fn();
  const unsubscribe = safety.subscribeUpdateSafety(notify);
  const clean = safety.getUpdateSafetySnapshot();
  expect(safety.getUpdateSafetySnapshot()).toBe(clean);
  const first = safety.beginUpdateOperation(), second = safety.beginUpdateOperation();
  expect(safety.getUpdateSafetySnapshot()).toEqual({ dirty: false, active: false, busy: true });
  expect(notify).toHaveBeenCalledTimes(1);
  first(); first();
  expect(safety.getUpdateSafetySnapshot().busy).toBe(true);
  expect(notify).toHaveBeenCalledTimes(1);
  second();
  expect(safety.getUpdateSafetySnapshot().busy).toBe(false);
  expect(notify).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it('observes draft changes without polling, even after an imperative safety check', async () => {
  const safety = await import('./updateSafety');
  let state = { dirty: false, busy: false, active: true };
  const release = safety.registerUpdateSafetySource(() => state);
  const notify = vi.fn(), unsubscribe = safety.subscribeUpdateSafety(notify);
  state = { dirty: true, busy: false, active: true };
  expect(safety.getUpdateSafetySnapshot().dirty).toBe(true);
  safety.refreshUpdateSafety();
  expect(notify).toHaveBeenCalledOnce();
  safety.refreshUpdateSafety();
  expect(notify).toHaveBeenCalledOnce();
  release();
  expect(safety.getUpdateSafetySnapshot()).toEqual({ dirty: false, busy: false, active: false });
  expect(notify).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it('releases failed and synchronous throwing operations without clearing other activity', async () => {
  const safety = await import('./updateSafety');
  const release = safety.registerUpdateSafetySource(() => ({ dirty: true, active: true }));
  await expect(safety.withUpdateOperation(() => { throw new Error('Storage failed'); })).rejects.toThrow('Storage failed');
  await expect(safety.withUpdateOperation(async () => { throw new Error('Network failed'); })).rejects.toThrow('Network failed');
  expect(safety.getUpdateSafetySnapshot()).toEqual({ dirty: true, busy: false, active: true });
  release();
});

it('publishes operation activity before executing the first asynchronous step', async () => {
  const safety = await import('./updateSafety');
  const seen: boolean[] = [];
  let finish!: () => void;
  const work = safety.withUpdateOperation(() => {
    seen.push(safety.getUpdateSafetySnapshot().busy);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  expect(seen).toEqual([true]);
  expect(safety.getUpdateSafetySnapshot().busy).toBe(true);
  finish(); await work;
  expect(safety.getUpdateSafetySnapshot().busy).toBe(false);
});
