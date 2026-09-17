import { pathToView } from '../routes';

const actions = new Set([
  'session.start', 'network.online', 'network.offline', 'page.visible', 'page.hidden',
  'ui.button', 'ui.link', 'ui.field', 'ui.submit', 'navigation',
  'scanner.open', 'scanner.close', 'scanner.manual', 'scanner.camera', 'scanner.code.read',
  'document.open', 'document.read', 'document.sign',
  'directory.load', 'scan.confirm',
]);
type Breadcrumb = { at: string; action: string; page: string; phase?: string; operationId?: string; durationMs?: number };
const breadcrumbs: Breadcrumb[] = [];
const operations = new Map<string, { action: string; startedAt: string }>();
let sessionId = '';
const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `diag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const page = () => typeof location === 'undefined' ? 'unknown' : pathToView(location.pathname);

/** Only fixed action names and route keys. Never DOM text, input values, document URLs or parcel codes. */
export function recordDiagnosticAction(action: string): void {
  if (!actions.has(action)) return;
  breadcrumbs.push({ at: new Date().toISOString(), action, page: page() });
  if (breadcrumbs.length > 20) breadcrumbs.shift();
}

export function resetRuntimeDiagnostics(): void {
  breadcrumbs.length = 0;
  operations.clear();
  sessionId = newId();
  recordDiagnosticAction('session.start');
}

export function beginDiagnosticOperation(action: 'directory.load' | 'scan.confirm') {
  if (!sessionId) sessionId = newId();
  const session = sessionId, operationId = newId(), started = Date.now();
  recordDiagnosticAction(action);
  Object.assign(breadcrumbs[breadcrumbs.length - 1], { phase: 'start', operationId });
  if (operations.size >= 8) operations.delete(operations.keys().next().value!);
  operations.set(operationId, { action, startedAt: new Date(started).toISOString() });
  let finished = false;
  return {
    id: operationId,
    finish(phase: 'success' | 'failure' | 'refused') {
      if (finished || session !== sessionId) return;
      finished = true;
      operations.delete(operationId);
      recordDiagnosticAction(action);
      Object.assign(breadcrumbs[breadcrumbs.length - 1], { phase, operationId, durationMs: Math.max(0, Date.now() - started) });
    },
  };
}

export function captureRuntimeDiagnostics() {
  if (!sessionId) sessionId = newId();
  const connection = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  return {
    sessionId,
    buildId: typeof __BUILD_ID__ === 'undefined' ? 'unknown' : __BUILD_ID__,
    page: page(),
    online: typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' ? null : navigator.onLine,
    visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
    connectionType: ['slow-2g', '2g', '3g', '4g'].includes(connection?.effectiveType || '') ? connection!.effectiveType : null,
    saveData: typeof connection?.saveData === 'boolean' ? connection.saveData : null,
    breadcrumbs: breadcrumbs.map(item => ({ ...item })),
    pendingOperations: [...operations].map(([id, value]) => ({ id, ...value })),
  };
}

/** Keep an asset filename only for our bundles. Other resources retain only their origin. */
export function diagnosticResource(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, typeof location === 'undefined' ? 'https://invalid.local' : location.origin);
    if (!['https:', 'http:'].includes(url.protocol)) return 'resource';
    return /^\/assets\/[\w.-]+\.(js|css)$/.test(url.pathname) ? `${url.origin}${url.pathname}` : url.origin;
  } catch { return 'resource'; }
}

type ErrorReporter = (context: string, error: unknown, options?: { extra?: Record<string, unknown>; userMessage?: string; level?: 'error' | 'warning' }) => void;

export function installRuntimeDiagnostics(report: ErrorReporter, flush: () => Promise<void>) {
  const onError = (event: Event) => {
    if ('message' in event) {
      const error = event as ErrorEvent;
      report('window.error', error.error || error.message, {
        extra: { filename: diagnosticResource(error.filename), lineno: error.lineno, colno: error.colno, opaque: error.message === 'Script error.' && !error.error },
      });
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.tagName === 'SCRIPT' || (target.tagName === 'LINK' && target.getAttribute('rel') === 'stylesheet')) {
      report('resource.load', 'Une ressource de l’application n’a pas pu être chargée.', {
        extra: { resource: diagnosticResource(target.getAttribute('src') || target.getAttribute('href') || ''), type: target.tagName.toLowerCase() },
        userMessage: 'Une partie de l’application n’a pas pu se charger. Terminez vos saisies avant de recharger la page.',
      });
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => report('window.unhandledrejection', event.reason);
  const onInteraction = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('[data-diagnostic-action],button,[role="button"],a,input,select,textarea');
    if (!target) return;
    const explicit = target.getAttribute('data-diagnostic-action');
    if (explicit && actions.has(explicit)) recordDiagnosticAction(explicit);
    else recordDiagnosticAction(target.tagName === 'A' ? 'ui.link' : ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ? 'ui.field' : 'ui.button');
  };
  const onSubmit = () => recordDiagnosticAction('ui.submit');
  const flushSafely = () => { void flush().catch(() => {}); };
  const onOnline = () => { recordDiagnosticAction('network.online'); flushSafely(); };
  const onOffline = () => recordDiagnosticAction('network.offline');
  const onVisibility = () => {
    recordDiagnosticAction(document.visibilityState === 'visible' ? 'page.visible' : 'page.hidden');
    if (document.visibilityState === 'visible' && navigator.onLine) flushSafely();
  };
  const onNavigation = () => recordDiagnosticAction('navigation');
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('popstate', onNavigation);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('click', onInteraction, true);
  document.addEventListener('submit', onSubmit, true);
  return () => {
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('popstate', onNavigation);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('click', onInteraction, true);
    document.removeEventListener('submit', onSubmit, true);
  };
}
