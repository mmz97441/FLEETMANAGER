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

import { db } from '../firebaseConfig';
import { recordSupportErrorReference } from '../utils/supportContext';
import { captureRuntimeDiagnostics, resetRuntimeDiagnostics } from '../utils/runtimeDiagnostics';
import { collection, addDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

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

const readLocal = (): Record<string, unknown>[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry === 'object').slice(-LS_MAX) : [];
  } catch { return []; }
};

const bufferLocal = (entry: Record<string, unknown>): void => {
  try {
    const arr = readLocal();
    arr.push(entry);
    while (arr.length > LS_MAX) arr.shift();
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  } catch { /* localStorage plein ou indisponible : on abandonne silencieusement */ }
};

/** Erreurs bufferisées localement (consultable même hors-ligne). */
export const getLocalErrorLogs = (): Record<string, unknown>[] => readLocal();

let flushing: Promise<void> | null = null;
/** One flush per tab. Remove only confirmed entries, never overwrite errors buffered during a request. */
export const flushLocalErrorLogs = (): Promise<void> => {
  if (flushing) return flushing;
  const task = (async () => {
    for (const entry of readLocal()) {
      try { await addDoc(collection(db, 'error_logs'), entry); }
      catch { break; }
      try {
        const remaining = readLocal();
        const index = remaining.findIndex(candidate => entry.referenceId
          ? candidate.referenceId === entry.referenceId
          : JSON.stringify(candidate) === JSON.stringify(entry));
        if (index >= 0) remaining.splice(index, 1);
        if (remaining.length) localStorage.setItem(LS_KEY, JSON.stringify(remaining));
        else localStorage.removeItem(LS_KEY);
      } catch { /* Storage is best-effort; never touch business outboxes. */ }
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
  try {
    await addDoc(collection(db, 'error_logs'), entry);
  } catch (e) {
    // Firestore indisponible (hors-ligne, non authentifié, règle) -> tampon local
    bufferLocal(entry);
    console.warn('[logService] error_logs indisponible, bufferisé en local', e);
  }
};

/**
 * Signale une erreur : console + message utilisateur + persistance.
 * @param context où l'erreur s'est produite (ex: "pickup.claim", "import.parse")
 */
export const reportError = (context: string, error: unknown, opts: ReportOptions = {}): void => {
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
