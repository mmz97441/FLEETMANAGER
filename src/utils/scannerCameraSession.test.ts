import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createScannerCameraSession, waitForCameraRelease } from './scannerCameraSession';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const actions = () => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}), clear: vi.fn(), release: vi.fn() });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => { await vi.runAllTimersAsync(); vi.useRealTimers(); });
it('waits for the old camera to stop before allowing another start', async () => {
  const a = actions(), stopped = deferred(); a.stop.mockReturnValue(stopped.promise);
  const session = createScannerCameraSession(a); await session.ready;
  const closing = session.close(); let released = false;
  void waitForCameraRelease().then(() => { released = true; });
  await vi.advanceTimersByTimeAsync(100); expect(released).toBe(false);
  stopped.resolve(); await closing; await waitForCameraRelease();
  expect(released).toBe(true); expect(a.clear).toHaveBeenCalledTimes(1);
});
it('releases a camera arriving after close without touching a newer camera', async () => {
  const a = actions(), b = actions(), startup = deferred(); a.start.mockReturnValue(startup.promise);
  const old = createScannerCameraSession(a); const closing = old.close();
  await vi.advanceTimersByTimeAsync(2000); await closing;
  expect(a.release).toHaveBeenCalledTimes(1);
  const current = createScannerCameraSession(b); await current.ready;
  startup.resolve(); await old.ready; await vi.advanceTimersByTimeAsync(0);
  expect(a.stop).toHaveBeenCalledTimes(1); expect(b.stop).not.toHaveBeenCalled();
  expect(current.closed).toBe(false); await current.close();
});
it('a hung permission request reaches a visible deadline and still cleans up when it returns', async () => {
  const a = actions(), startup = deferred(); a.start.mockReturnValue(startup.promise);
  const session = createScannerCameraSession(a);
  const failure = expect(session.ready).rejects.toMatchObject({ code: 'scanner/start-timeout' });
  await vi.advanceTimersByTimeAsync(12000); await failure;
  const closing = session.close(); await vi.advanceTimersByTimeAsync(2000); await closing;
  startup.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(a.stop).toHaveBeenCalledTimes(1); expect(a.clear).toHaveBeenCalledTimes(1);
});
it('an empty-track stop that never resolves cannot lock the scanner close button', async () => {
  const a = actions(); a.stop.mockImplementation(() => new Promise(() => {}));
  const session = createScannerCameraSession(a); await session.ready;
  const closing = session.close(); expect(session.close()).toBe(closing);
  await vi.advanceTimersByTimeAsync(1500); await closing;
  expect(a.release).toHaveBeenCalledTimes(1); expect(a.clear).toHaveBeenCalledTimes(1);
});
