import { withDeadline } from './asyncDeadline';

interface CameraActions {
  start: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  clear: () => void;
  release: () => void;
}
let releasing: Promise<unknown> = Promise.resolve();
export const waitForCameraRelease = () => releasing;

/** One owner per camera instance. A delayed startup/cleanup can never touch the
 * next scanner. Closing is bounded, including html5-qrcode's empty-track hang. */
export function createScannerCameraSession(actions: CameraActions) {
  let closed = false;
  let closing: Promise<void> | undefined;
  let stopped: Promise<void> | undefined;
  const started = Promise.resolve().then(actions.start);
  const stop = () => stopped ||= (async () => {
    try { await withDeadline(Promise.resolve().then(actions.stop), 1500, new Error('Arrêt caméra trop long.')); }
    catch { /* Startup may have failed, or the OS already released the track. */ }
    finally {
      try { actions.release(); } catch { /* best effort */ }
      try { actions.clear(); } catch { /* an old detached container may be gone */ }
    }
  })();
  const forceRelease = () => { try { actions.release(); } catch { /* best effort */ } };
  const session = {
    get closed() { return closed; },
    ready: withDeadline(started, 12000, Object.assign(new Error('La caméra ne répond pas. Relancez le lecteur ou utilisez la saisie manuelle.'), { code: 'scanner/start-timeout' })),
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      // Even after this deadline, cleanup still runs when a pending permission
      // request resolves. Never abandon a camera stream that arrives late.
      closing = withDeadline(started.then(stop, stop), 2000, new Error('Libération caméra trop longue.')).catch(forceRelease);
      releasing = Promise.all([releasing, closing]).then(() => undefined);
      return closing;
    },
  };
  return session;
}

/** start() may resolve before the video actually plays. Do not show a working
 * scanner forever when autoplay or the camera surface failed to deliver frames. */
export function waitForCameraImage(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      if (video.readyState >= 2 && !video.paused) { cleanup(); resolve(); }
    };
    const failed = () => { cleanup(); reject(Object.assign(new Error('Aucune image reçue de la caméra. Relancez le lecteur.'), { code: 'scanner/no-image' })); };
    const timer = setTimeout(failed, 8000);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('playing', ready);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed);
    };
    video.addEventListener('playing', ready);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('error', failed);
    ready();
  });
}

/** Ignore transient pause/mute events. Catch play() rejections and detach every
 * listener/timer before stop() can generate another interruption event. */
export function monitorCamera(video: HTMLVideoElement, tracks: MediaStreamTrack[], recover: (cause: string) => void) {
  let closed = false, checking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hidden = () => document.visibilityState === 'hidden';
  const healthy = () => !video.paused && tracks.every(track => track.readyState !== 'ended' && !track.muted);
  const inspect = async (cause: string) => {
    if (closed || checking || hidden() || healthy()) return;
    checking = true;
    if (video.paused && tracks.every(track => track.readyState !== 'ended')) {
      try { await withDeadline(Promise.resolve(video.play()), 1200, new Error('Reprise vidéo trop longue.')); } catch { /* Recover below, without an unhandled rejection. */ }
    }
    checking = false;
    if (!closed && !hidden() && !healthy()) recover(cause);
  };
  const schedule = (event: Event) => {
    clearTimeout(timer);
    timer = setTimeout(() => { void inspect(event.type); }, event.type === 'ended' ? 100 : 1200);
  };
  video.addEventListener('pause', schedule);
  tracks.forEach(track => { track.addEventListener('ended', schedule); track.addEventListener('mute', schedule); });
  return () => {
    closed = true; clearTimeout(timer); video.removeEventListener('pause', schedule);
    tracks.forEach(track => { track.removeEventListener('ended', schedule); track.removeEventListener('mute', schedule); });
  };
}

export function allowCameraRecovery(attempts: number[], now: number): boolean {
  while (attempts.length && now - attempts[0] >= 60000) attempts.shift();
  if (attempts.length >= 2) return false;
  attempts.push(now); return true;
}
