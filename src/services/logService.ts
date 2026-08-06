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
import { collection, addDoc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

export type LogLevel = 'error' | 'warning' | 'info' | 'success';

/** Un enregistrement du journal d'erreurs (collection Firestore `error_logs`). */
export interface ErrorLogRecord {
  id: string;
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
}

// ============================================================================
// CONTEXTE UTILISATEUR (renseigné après connexion)
// ============================================================================

let currentContext: { userId?: string; userName?: string; userRole?: string } = {};

/** À appeler à la connexion / déconnexion pour attacher l'auteur aux logs. */
export const setLogUser = (
  u?: { id: string; firstName?: string; lastName?: string; role?: unknown } | null
): void => {
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

const emit = (level: LogLevel, message: string, durationMs?: number): void => {
  const msg: UserMessage = {
    id: genId(),
    level,
    message,
    durationMs: durationMs ?? (level === 'error' ? 8000 : level === 'warning' ? 6000 : 4000),
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
    return raw ? JSON.parse(raw) : [];
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

/** Tente de renvoyer vers Firestore les erreurs stockées localement. */
export const flushLocalErrorLogs = async (): Promise<void> => {
  const arr = readLocal();
  if (arr.length === 0) return;
  const remaining: Record<string, unknown>[] = [];
  for (const entry of arr) {
    try {
      await addDoc(collection(db, 'error_logs'), entry);
    } catch {
      remaining.push(entry); // toujours pas possible : on garde pour plus tard
    }
  }
  try {
    if (remaining.length > 0) localStorage.setItem(LS_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
};

// ============================================================================
// REPORT D'ERREUR
// ============================================================================

const serializeError = (error: unknown): { message: string; stack: string | null } => {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? null };
  if (typeof error === 'string') return { message: error, stack: null };
  try { return { message: JSON.stringify(error), stack: null }; }
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

  const entry: Record<string, unknown> = {
    level,
    context,
    message,
    stack,
    extra: opts.extra ?? null,
    userId: currentContext.userId ?? null,
    userName: currentContext.userName ?? null,
    userRole: currentContext.userRole ?? null,
    url: typeof location !== 'undefined' ? location.href : null,
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
    emit(level, opts.userMessage || fallback);
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
  limitCount = 200
): (() => void) => {
  const q = query(collection(db, 'error_logs'), orderBy('createdAt', 'desc'), limit(limitCount));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as ErrorLogRecord))),
    err => { console.error('[logService] lecture error_logs impossible', err); callback([]); }
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
