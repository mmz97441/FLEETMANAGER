import { expect, it, vi } from 'vitest';
import { connectionStatus, createPresencePublisher } from './presence';
const now = Date.parse('2026-09-24T08:00:00Z');
it('separates unknown, disabled, online and expired presence independently of GPS or login date', () => {
  expect(connectionStatus({}, now)).toBe('unknown'); expect(connectionStatus({ lastSeenAt: 'invalid' }, now)).toBe('unknown');
  expect(connectionStatus({ lastSeenAt: new Date(now + 60001).toISOString() }, now)).toBe('unknown');
  expect(connectionStatus({ lastSeenAt: new Date(now - 179999).toISOString() }, now)).toBe('online');
  expect(connectionStatus({ lastSeenAt: new Date(now - 180000).toISOString() }, now)).toBe('offline');
  expect(connectionStatus({ isDisabled: true, lastSeenAt: new Date(now).toISOString() }, now)).toBe('disabled');
});
it('retries the opening timestamp after failure, throttles heartbeats and pauses while hidden/offline', async () => {
  const deps = { send: vi.fn(async (_login: boolean) => {}), visible: vi.fn(() => false), report: vi.fn() };
  const p = createPresencePublisher(deps); await p.tick(now); expect(deps.send).not.toHaveBeenCalled();
  deps.visible.mockReturnValue(true); deps.send.mockRejectedValueOnce('network'); await p.tick(now);
  await p.tick(now + 60000); expect(deps.send.mock.calls).toEqual([[true], [true]]);
  await p.tick(now + 60001); expect(deps.send).toHaveBeenCalledTimes(2);
  await p.tick(now + 120000); expect(deps.send).toHaveBeenLastCalledWith(false);
  p.stop(); await p.tick(now + 180000); expect(deps.send).toHaveBeenCalledTimes(3);
});
it('never overlaps or writes an offline state that could overwrite another tab', async () => {
  let done!: () => void;
  const send = vi.fn(() => new Promise<void>(r => { done = r; })); const p = createPresencePublisher({ send, visible: () => true, report: vi.fn() });
  const first = p.tick(now); await p.tick(now + 1000); expect(send).toHaveBeenCalledTimes(1);
  p.stop(); done(); await first; await p.tick(now + 180000); expect(send).toHaveBeenCalledTimes(1);
});

it('recovers a suspended presence request and ignores its late failure', async () => {
  let reject!: (error: unknown) => void;
  const deps = { send: vi.fn().mockReturnValueOnce(new Promise((_, r) => { reject = r; })).mockResolvedValue(undefined), visible: vi.fn(() => true), report: vi.fn() };
  const p = createPresencePublisher(deps), first = p.tick(now);
  deps.visible.mockReturnValue(false); await p.tick(now + 1000);
  deps.visible.mockReturnValue(true); await p.tick(now + 2000);
  reject(new Error('old network')); await first;
  expect(deps.send.mock.calls).toEqual([[true], [true]]); expect(deps.report).not.toHaveBeenCalled();
  await p.tick(now + 65000); expect(deps.send).toHaveBeenLastCalledWith(false);
});
