import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { User } from '../types';
const { call, report, info } = vi.hoisted(() => ({ call: vi.fn(), report: vi.fn(), info: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: () => call }));
vi.mock('../firebaseConfig', () => ({ default: {} }));
vi.mock('./logService', () => ({ reportError: report, notifyInfo: info }));
import { subscribeToTeamDirectory } from './teamDirectoryService';
const self = { id: 'driver-test', firstName: 'Fictif', role: 'Chauffeur' } as User;
const colleague = { id: 'colleague-test', firstName: 'Test' } as User;
let win: EventTarget, doc: EventTarget & { visibilityState: string }, network: { onLine: boolean };
let stop: (() => void) | undefined;
const tick = () => vi.advanceTimersByTimeAsync(0);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-17T14:00:00Z'));
  call.mockReset(); report.mockReset(); info.mockReset();
  win = new EventTarget(); doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); network = { onLine: true };
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('navigator', network);
  vi.stubGlobal('location', { pathname: '/driver-tour' });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits offline, resumes online and never overlaps requests on repeated wake events', async () => {
  const pending = deferred<{ data: { users: User[] } }>(); call.mockReturnValue(pending.promise);
  network.onLine = false; const received = vi.fn(); stop = subscribeToTeamDirectory(self, received);
  await vi.advanceTimersByTimeAsync(120000); expect(call).not.toHaveBeenCalled(); expect(received).toHaveBeenLastCalledWith([self]);
  network.onLine = true; win.dispatchEvent(new Event('online')); win.dispatchEvent(new Event('online')); doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120000); expect(call).toHaveBeenCalledTimes(1);
  pending.resolve({ data: { users: [{ ...self, firstName: 'Stale' }, colleague] } }); await tick();
  expect(received).toHaveBeenLastCalledWith([self, colleague]);
  await vi.advanceTimersByTimeAsync(59999); expect(call).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(call).toHaveBeenCalledTimes(2);
});

it('keeps the loaded directory during failures and retries with increasing delays', async () => {
  call.mockResolvedValueOnce({ data: { users: [colleague] } }).mockRejectedValue({ code: 'functions/internal', message: 'internal [0]' });
  const received = vi.fn(); stop = subscribeToTeamDirectory(self, received); await tick();
  await vi.advanceTimersByTimeAsync(60000); expect(call).toHaveBeenCalledTimes(2);
  expect(received).toHaveBeenLastCalledWith([self, colleague]); expect(info).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4999); expect(call).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(call).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(14999); expect(call).toHaveBeenCalledTimes(3);
  call.mockResolvedValue({ data: { users: [] } }); await vi.advanceTimersByTimeAsync(1);
  expect(received).toHaveBeenLastCalledWith([self]); expect(call).toHaveBeenCalledTimes(4);
  expect(report).toHaveBeenLastCalledWith('directory.load', expect.anything(), expect.objectContaining({ silent: true, extra: expect.objectContaining({ attempt: 2, hasPreviousData: true, retryInMs: 15000 }) }));
});

it('pauses while hidden and ignores results after the subscriber leaves', async () => {
  call.mockResolvedValueOnce({ data: { users: [colleague] } }); const received = vi.fn();
  stop = subscribeToTeamDirectory(self, received); await tick();
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(180000); expect(call).toHaveBeenCalledTimes(1);
  const pending = deferred<{ data: { users: User[] } }>(); call.mockReturnValueOnce(pending.promise);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); expect(call).toHaveBeenCalledTimes(2);
  stop(); const count = received.mock.calls.length; pending.resolve({ data: { users: [] } }); await tick();
  expect(received).toHaveBeenCalledTimes(count); await vi.advanceTimersByTimeAsync(180000); expect(call).toHaveBeenCalledTimes(2);
});

it('stops retries and removes colleague data after an access rejection', async () => {
  call.mockResolvedValueOnce({ data: { users: [colleague] } }).mockRejectedValue({ code: 'functions/permission-denied' });
  const received = vi.fn(); stop = subscribeToTeamDirectory(self, received); await tick(); await vi.advanceTimersByTimeAsync(60000);
  expect(received).toHaveBeenLastCalledWith([self]); win.dispatchEvent(new Event('online')); doc.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(300000); expect(call).toHaveBeenCalledTimes(2);
  expect(report.mock.lastCall?.[2].extra.retryInMs).toBeNull(); expect(info).toHaveBeenCalledTimes(1);
});

it('informs once if the initial load fails while retaining the current user', async () => {
  call.mockRejectedValue({ code: 'functions/unavailable' }); const received = vi.fn();
  stop = subscribeToTeamDirectory(self, received); await tick(); await vi.advanceTimersByTimeAsync(20000);
  expect(call).toHaveBeenCalledTimes(3); expect(info).toHaveBeenCalledTimes(1); expect(received).toHaveBeenCalledTimes(1);
  expect(received).toHaveBeenLastCalledWith([self]);
});

it('does not erase the previous directory for a malformed successful response', async () => {
  call.mockResolvedValueOnce({ data: { users: [colleague] } }).mockResolvedValueOnce({ data: {} }); const received = vi.fn();
  stop = subscribeToTeamDirectory(self, received); await tick(); await vi.advanceTimersByTimeAsync(60000);
  expect(received).toHaveBeenLastCalledWith([self, colleague]); expect(report).toHaveBeenCalledTimes(1);
});
