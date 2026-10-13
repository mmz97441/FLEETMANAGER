import { afterEach, expect, it, vi } from 'vitest';
import { carrierBarcodeError } from './carrierBarcodeValidation';
import { scanSupportIncidents } from './scanSupport';
import { monitorCamera, allowCameraRecovery } from './scannerCameraSession';
import { validateImportManifest, importReference } from './importManifest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('preserves Boiron leading zeroes and rejects rounded numeric cells or a different order', () => {
  const code = '0014085834301322930101';
  expect(carrierBarcodeError(code, '14085834')).toBeNull();
  expect(carrierBarcodeError(Number(code), '14085834')).toMatch(/numérique/);
  expect(carrierBarcodeError(code, '14085837')).toMatch(/commande/);
  expect(carrierBarcodeError('14085834301322930101', '14085834')).toMatch(/22 chiffres/);
});
it('tracks the whole import while accepting only chunks belonging to that client and file', () => {
  const manifest = { clientId: 'c', references: ['BR1\t1', 'BR2\t1'] };
  expect(importReference({ externalId: ' br1 ', packageIndex: 1 })).toBe('BR1\t1');
  expect(validateImportManifest(manifest, [{ clientId: 'c', externalId: 'BR1', packageIndex: 1 }]).references).toHaveLength(2);
  expect(() => validateImportManifest(manifest, [{ clientId: 'other', externalId: 'BR1', packageIndex: 1 }])).toThrow();
  expect(() => validateImportManifest(manifest, [{ clientId: 'c', externalId: 'BR3' }])).toThrow();
});
it('does not count accepted controls as errors and only links a matching subsequent recovery', () => {
  const base = { action: 'PACKAGE_SCANNED', userId: 'd', targetName: 'BR1', details: { metadata: { scan: 'not_found' } } };
  const events = [
    { ...base, id: '1', outcome: 'failure', createdAt: '2026-10-13T10:00:00Z' },
    { ...base, id: '2', userId: 'other', outcome: 'success', createdAt: '2026-10-13T10:01:00Z' },
    { ...base, id: '3', outcome: 'neutral', createdAt: '2026-10-13T10:02:00Z' },
  ];
  expect(scanSupportIncidents(events.slice(0, 2))[0].extra?.resolution).toMatch(/Aucune reprise/);
  const incidents = scanSupportIncidents(events); expect(incidents).toHaveLength(1);
  expect(incidents[0].extra?.resolution).toMatch(/accepté ensuite/);
});
function camera(paused: boolean) {
  const video = Object.assign(new EventTarget(), { paused, play: vi.fn(async () => {}) });
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false });
  const recover = vi.fn();
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const close = monitorCamera(video as unknown as HTMLVideoElement, [track as unknown as MediaStreamTrack], recover);
  return { video, track, recover, close };
}
it('a transient video pause does not restart the camera', async () => {
  vi.useFakeTimers(); const c = camera(true); c.video.dispatchEvent(new Event('pause'));
  await vi.advanceTimersByTimeAsync(500); c.video.paused = false;
  await vi.advanceTimersByTimeAsync(1500); expect(c.recover).not.toHaveBeenCalled(); c.close();
});
it('an interrupted track recovers once; cleanup cancels late restart callbacks', async () => {
  vi.useFakeTimers(); const c = camera(false); c.track.readyState = 'ended'; c.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(100); expect(c.recover).toHaveBeenCalledWith('ended');
  c.video.dispatchEvent(new Event('pause')); c.close(); await vi.advanceTimersByTimeAsync(2000);
  expect(c.recover).toHaveBeenCalledTimes(1);
});
it('play rejection is handled and repeated automatic restarts reach a manual fallback', async () => {
  vi.useFakeTimers(); const c = camera(true); c.video.play.mockRejectedValue(new Error('The operation was aborted.'));
  c.video.dispatchEvent(new Event('pause')); await vi.advanceTimersByTimeAsync(1500);
  expect(c.recover).toHaveBeenCalledOnce(); c.close();
  const history: number[] = [];
  expect(allowCameraRecovery(history, 0)).toBe(true); expect(allowCameraRecovery(history, 1000)).toBe(true);
  expect(allowCameraRecovery(history, 2000)).toBe(false); expect(allowCameraRecovery(history, 61000)).toBe(true);
});
