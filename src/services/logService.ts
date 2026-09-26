/**
 * SERVICE DE LOG D'ERREURS + MESSAGES UTILISATEUR
 *
 * Objectif : plus AUCUNE erreur silencieuse dans l'app.
 *
 * `reportError(context, error, options)` fait 3 choses à la fois :
 *   1. console.error (dev)
 *   2. affiche un message visible à l'utilisateur (toast) — sauf si silent:true
 *   3. persiste l'erreur dans Firestore (collection `error_logs`) pour que
 *      la direction puisse consulter ce qui s'est passé, pour tout le monde,
 *      en tout temps. Fallback localStorage si Firestore est indisponible.
 *
 * Utilisable partout : services (hors React) comme composants. Les composants
 * peuvent aussi afficher des messages directs via notifySuccess/notifyError/…
 * ou le hook useToast().
 */

import app, { db } from '../firebaseConfig';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { withDeadline } from '../utils/asyncDeadline';
import { noteStorageFailure } from '../utils/storageRecovery';
import { recordSupportErrorReference } from '../utils/supportContext';
import { captureRuntimeDiagnostics, resetRuntimeDiagnostics } from '../utils/runtimeDiagnostics';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

export type LogLevel = 'error' | 'warning' | 'info' | 'success';

/** Un enregistrement du journal d'erreurs (collection Firestore `error_logs`). */
export interface ErrorLogRecord {
  id: string;
  referenceId?: string;
  level: 'error' | 'warning';
  context: string;
  message: string;
  stack: string | null;
  extra: Record<string, unknown> | null;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  url: string | null;
  userAgent: string | null;
  appVersion: string | null;
  createdAt: string;
}

export interface UserMessage {
  id: string;
  level: LogLevel;
  message: string;
  /** durée d'affichage en ms (0 = ne pas auto-fermer) */
  durationMs: number;
  group?: 'runtime';
}

// ============================================================================
// CONTEXTE UTILISATEUR (renseigné après connexion)
// ============================================================================

let currentContext: { userId?: string; userName?: string; userRole?: string } = {};

/** À appeler à la connexion / déconnexion pour attacher l'auteur aux logs. */
export const setLogUser = (
  u?: { id: string; firstName?: string; lastName?: string; role?: unknown } | null
): void => {
  if (currentContext.userId !== u?.id) resetRuntimeDiagnostics();
  currentContext = u
    ? {
        userId: u.id,
        userName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || undefined,
        userRole: u.role != null ? String(u.role) : undefined,
      }
    : {};
  // Une fois connecté, on tente de vider le tampon local vers Firestore.
  if (u) void flushLocalErrorLogs();
};

// ============================================================================
// ÉMETTEUR DE MESSAGES UI (pont services -> React)
// ============================================================================

const listeners = new Set<(m: UserMessage) => void>();

/** S'abonner aux messages à afficher (utilisé par le ToastProvider). */
export const onUserMessage = (cb: (m: UserMessage) => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

const genId = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const emit = (level: LogLevel, message: string, durationMs?: number, group?: 'runtime'): void => {
  const msg: UserMessage = {
    id: genId(),
    level,
    message,
    durationMs: durationMs ?? (level === 'error' ? 8000 : level === 'warning' ? 6000 : 4000),
    ...(group ? { group } : {}),
  };
  listeners.forEach(l => { try { l(msg); } catch { /* un listener ne doit pas casser les autres */ } });
};

/** Affiche un message visible sans forcément loguer une erreur. */
export const notify = (level: LogLevel, message: string, durationMs?: number): void =>
  emit(level, message, durationMs);
export const notifySuccess = (message: string, durationMs?: number): void => emit('success', message, durationMs);
export const notifyError = (message: string, durationMs?: number): void => emit('error', message, durationMs);
export const notifyWarning = (message: string, durationMs?: number): void => emit('warning', message, durationMs);
export const notifyInfo = (message: string, durationMs?: number): void => emit('info', message, durationMs);

// ============================================================================
// TAMPON LOCAL (fallback quand Firestore est indisponible / hors-ligne / non authentifié)
// ============================================================================

const LS_KEY = 'fleet_error_logs';
const LS_MAX = 50;
const memoryBuffer = new Map<string, Record<string, unknown>>();

const readLocal = (): Record<string, unknown>[] => {
  let entries: Record<string, unknown>[] = [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) entries = parsed.filter(entry => entry && typeof entry === 'object');
  } catch { /* Memory still allows an online report when storage is unavailable. */ }
  return [...new Map([...entries, ...memoryBuffer.values()].map(e => [String(e.referenceId || JSON.stringify(e)), e])).values()].slice(-LS_MAX);
};

const bufferLocal = (entry: Record<string, unknown>): void => {
  memoryBuffer.set(String(entry.referenceId), entry);
  if (memoryBuffer.size > LS_MAX) memoryBuffer.delete(memoryBuffer.keys().next().value!);
  try {
    const arr = readLocal();
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  } catch { /* Keep the in-memory copy until an acknowledged upload. */ }
};

/** Erreurs bufferisées localement (consultable même hors-ligne). */
export const getLocalErrorLogs = (): Record<string, unknown>[] => readLocal();

const sendDiagnostics = (data: { entries: Record<string, unknown>[] }) => httpsCallable<{ entries: Record<string, unknown>[] }, { acknowledged: string[] }>(getFunctions(app, 'europe-west1'), 'recordClientErrors', { timeout: 15000 })(data);
let flushing: Promise<void> | null = null;
/** The local copy precedes the network call. Stable references make uncertain retries safe. */
export const flushLocalErrorLogs = (): Promise<void> => {
  if (flushing) return flushing;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();
  if (!currentContext.userId) return Promise.resolve();
  const uid = currentContext.userId;
  if (!readLocal().some(e => !e.userId || e.userId === uid)) return Promise.resolve();
  const task = (async () => {
    while (currentContext.userId === uid) {
      const pending = readLocal().filter(e => !e.userId || e.userId === uid).slice(0, 20);
      if (!pending.length) break;
      // Older buffered entries did not always have a reference. Persist one before sending.
      for (const entry of pending) if (!entry.referenceId) {
        const all = readLocal(), index = all.findIndex(e => JSON.stringify(e) === JSON.stringify(entry));
        entry.referenceId = `legacy-${genId()}`;
        if (index >= 0) { all[index] = entry; try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch {} }
      }
      try {
        const result = await withDeadline(sendDiagnostics({ entries: pending }), 18000, new Error('Diagnostic en attente du réseau.'));
        const acknowledged = new Set(result.data.acknowledged);
        const sent = new Set(pending.map(e => e.referenceId).filter(id => acknowledged.has(String(id))));
        if (!sent.size) break;
        const remaining = readLocal().filter(e => !sent.has(e.referenceId));
        for (const id of sent) memoryBuffer.delete(String(id));
        if (remaining.length) localStorage.setItem(LS_KEY, JSON.stringify(remaining));
        else localStorage.removeItem(LS_KEY);
      } catch { break; } // Keep the entire uncertain batch; never recurse through reportError.
    }
  })();
  flushing = task;
  void task.finally(() => { flushing = null; }).catch(() => {});
  return task;
};

// ============================================================================
// REPORT D'ERREUR
// ============================================================================

const serializeError = (error: unknown): { message: string; stack: string | null } => {
  // Errors from another window/realm do not pass instanceof Error.
  if (error && typeof error === 'object' && typeof (error as Error).message === 'string') return {
    message: (error as Error).message,
    stack: typeof (error as Error).stack === 'string' ? (error as Error).stack! : null,
  };
  if (typeof error === 'string') return { message: error, stack: null };
  try { return { message: JSON.stringify(error) ?? String(error), stack: null }; }
  catch { return { message: String(error), stack: null }; }
};

interface ReportOptions {
  /** Message affiché à l'utilisateur (défaut : message générique + contexte). */
  userMessage?: string;
  /** Ne pas afficher de toast (utile pour des erreurs non bloquantes). */
  silent?: boolean;
  /** Données additionnelles utiles au diagnostic. */
  extra?: Record<string, unknown>;
  /** Niveau (défaut error). warning = anomalie non bloquante. */
  level?: 'error' | 'warning';
}

const persist = async (entry: Record<string, unknown>): Promise<void> => {
  bufferLocal(entry);
  await flushLocalErrorLogs();
};

/**
 * Signale une erreur : console + message utilisateur + persistance.
 * @param context où l'erreur s'est produite (ex: "pickup.claim", "import.parse")
 */
export const reportError = (context: string, error: unknown, opts: ReportOptions = {}): void => {
  noteStorageFailure(error);
  const { message, stack } = serializeError(error);
  const level = opts.level ?? 'error';
  const referenceId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `error-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Background warnings must not overwrite the last error the user experienced.
  if (!opts.silent) recordSupportErrorReference(referenceId);

  const entry: Record<string, unknown> = {
    referenceId,
    level,
    context,
    message,
    stack,
    extra: {
      ...opts.extra,
      errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code: string }).code).slice(0, 100) : null,
      diagnostics: captureRuntimeDiagnostics(),
    },
    userId: currentContext.userId ?? null,
    userName: currentContext.userName ?? null,
    userRole: currentContext.userRole ?? null,
    url: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null,
    createdAt: new Date().toISOString(),
  };

  // 1) console
  console.error(`[${context}]`, error, opts.extra ?? '');

  // 2) message visible
  if (!opts.silent) {
    const fallback =
      level === 'warning'
        ? `Attention : ${message}`
        : `Un problème est survenu (${context}). Il a été enregistré, réessayez ou contactez la direction.`;
    emit(level, opts.userMessage || fallback, undefined, ['window.error', 'window.unhandledrejection', 'resource.load'].includes(context) ? 'runtime' : undefined);
  }

  // 3) persistance (best-effort, non bloquante)
  void persist(entry);
};

// ============================================================================
// LECTURE (back-office admin)
// ============================================================================

/** Souscrit au journal d'erreurs en temps réel (derniers N, plus récents d'abord). */
export const subscribeToErrorLogs = (
  callback: (logs: ErrorLogRecord[]) => void,
  limitCount = 200,
  onError?: (err: unknown) => void
): (() => void) => {
  const q = query(collection(db, 'error_logs'), orderBy('createdAt', 'desc'), limit(limitCount));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as ErrorLogRecord))),
    err => {
      // NE PAS renvoyer un tableau vide silencieux : un refus de droits ressemblerait
      // alors à "aucune erreur". On remonte l'échec pour l'afficher clairement.
      console.error('[logService] lecture error_logs impossible', err);
      if (onError) onError(err);
    }
  );
};

/**
 * Enveloppe une action async : logue et affiche toute erreur, renvoie null en cas d'échec.
 * Pratique pour supprimer les catch silencieux : `await guard('pickup.claim', () => claim(...))`.
 */
export const guard = async <T>(
  context: string,
  fn: () => Promise<T>,
  opts?: ReportOptions
): Promise<T | null> => {
  try {
    return await fn();
  } catch (error) {
    reportError(context, error, opts);
    return null;
  }
};
