export interface AppVersion { version: string; buildId: string }
export interface AppUpdateState {
  available: boolean;
  latestVersion: string | null;
  latestBuildId: string | null;
  checking: boolean;
  error: string | null;
  /** Last valid network response, retained with a remembered requirement. */
  lastCheckedAt: number | null;
}
export const APP_UPDATE_STORAGE_KEY = 'fleet-required-app-update-v1';
export const APP_UPDATE_TIMEOUT_MS = 8000;
export interface AppUpdateOptions {
  current: AppVersion;
  fetch: (url: string, options: RequestInit) => Promise<Pick<Response, 'ok' | 'json'>>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
  timeoutMs?: number;
}

/** Build IDs are decimal strings, not Numbers: their precision must be retained. */
export function parseAppVersion(value: unknown): AppVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, buildId } = value as Record<string, unknown>;
  if (typeof version !== 'string' || version.length > 64 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    typeof buildId !== 'string' || !/^[1-9]\d{0,19}$/.test(buildId)) return null;
  return { version, buildId };
}
const sameVersion = (a: AppVersion, b: AppVersion) => a.version === b.version && a.buildId === b.buildId;
const invalidManifest = 'Le manifeste de version est invalide. Réessayez la vérification.';

/** Pure controller with injected I/O. A valid deployed manifest is authoritative,
 * including a deliberate rollback; a malformed response never creates a gate. */
export function createAppUpdateMonitor(options: AppUpdateOptions) {
  const now = options.now || Date.now;
  const listeners = new Set<() => void>();
  let state: AppUpdateState = { available: false, latestVersion: null, latestBuildId: null, checking: false, error: null, lastCheckedAt: null };
  let generation = 0;
  let operation: Promise<boolean> | undefined;
  let cancelRequest: (() => void) | undefined;
  const clearRemembered = () => { try { options.storage?.removeItem(APP_UPDATE_STORAGE_KEY); } catch { /* Storage may be unavailable. */ } };
  try {
    const raw = options.storage?.getItem(APP_UPDATE_STORAGE_KEY);
    if (raw) {
      const cached = JSON.parse(raw), required = parseAppVersion(cached?.required), detectedOn = parseAppVersion(cached?.detectedOn);
      if (cached?.schema === 1 && required && detectedOn && sameVersion(detectedOn, options.current) &&
        required.buildId !== options.current.buildId) {
        const lastCheckedAt = typeof cached.checkedAt === 'number' && Number.isFinite(cached.checkedAt) && cached.checkedAt > 0 && cached.checkedAt <= now() + 300000 ? cached.checkedAt : null;
        state = { ...state, available: true, latestVersion: required.version, latestBuildId: required.buildId, lastCheckedAt };
      } else clearRemembered(); // A different installed build must verify its own deployment.
    }
  } catch { clearRemembered(); }
  const publish = (patch: Partial<AppUpdateState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const checkNow = (): Promise<boolean> => {
    if (operation) return operation;
    const request = ++generation;
    // Schedule the work after operation is assigned, so simultaneous subscribers share it.
    const pending = Promise.resolve().then(async () => {
      if (request !== generation) return false;
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const interrupted = new Promise<never>((_resolve, reject) => {
        cancelRequest = () => { abort.abort(); reject(new Error('cancelled')); };
        timer = setTimeout(() => { abort.abort(); reject(new Error('La vérification de version a expiré. Réessayez.')); }, options.timeoutMs ?? APP_UPDATE_TIMEOUT_MS);
      });
      publish({ checking: true, error: null });
      try {
        const latest = await Promise.race([interrupted, (async () => {
          const response = await options.fetch(`/version.json?ts=${now()}`, { cache: 'no-store', signal: abort.signal,
            headers: { 'Cache-Control': 'no-cache' } });
          if (!response.ok) throw new Error('La version disponible ne peut pas être vérifiée. Réessayez.');
          let value: unknown;
          try { value = await response.json(); } catch { throw new Error(invalidManifest); }
          const manifest = parseAppVersion(value);
          if (!manifest || (manifest.buildId === options.current.buildId && manifest.version !== options.current.version)) throw new Error(invalidManifest);
          return manifest;
        })()]);
        if (request !== generation) return false;
        const available = !sameVersion(latest, options.current);
        const checkedAt = now();
        if (available) {
          try { options.storage?.setItem(APP_UPDATE_STORAGE_KEY, JSON.stringify({ schema: 1, required: latest, detectedOn: options.current, checkedAt })); }
          catch { /* Detection still works when private browsing denies storage. */ }
        } else clearRemembered();
        publish({ available, latestVersion: latest.version, latestBuildId: latest.buildId, lastCheckedAt: checkedAt, error: null });
        return true;
      } catch (error) {
        if (request === generation) publish({ error: error instanceof Error && [invalidManifest,
          'La version disponible ne peut pas être vérifiée. Réessayez.', 'La vérification de version a expiré. Réessayez.'].includes(error.message)
          ? error.message : 'Connexion indisponible pour vérifier la mise à jour. Réessayez.' });
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (request === generation) { cancelRequest = undefined; publish({ checking: false }); }
      }
    }).finally(() => { if (operation === pending) operation = undefined; });
    operation = pending;
    return pending;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    checkNow,
    cancelPending() {
      generation++; const cancel = cancelRequest; cancelRequest = undefined; operation = undefined; cancel?.();
      if (state.checking) publish({ checking: false });
    },
  };
}
