import { createStopForm, StopForm } from './missionStopForm';

export interface PendingManualStop { missionId: string; date: string; requestId: string; form: StopForm; }
type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const pendingManualStopKey = (userId: string) => `fleet:manual-stop:v1:${userId}`;

export function readPendingManualStop(storage: JournalStorage, userId: string): PendingManualStop | null {
  const raw = storage.getItem(pendingManualStopKey(userId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value.missionId !== 'string' || !value.missionId || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.requestId) || !value.form || !Object.keys(createStopForm()).every(key => typeof value.form[key] === 'string')) throw new Error('invalid');
    return value;
  } catch { throw new Error('La demande d’arrêt conservée dans ce navigateur est illisible. Contactez l’exploitation pour vérifier la tournée avant de créer un autre arrêt.'); }
}

async function withJournalLock<T>(userId: string, operation: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(pendingManualStopKey(userId), async () => operation());
  // Synchronous compare/write/read fallback; supported browsers serialize tabs with Web Locks.
  return operation();
}

export async function reservePendingManualStop(storage: JournalStorage, userId: string, request: PendingManualStop): Promise<PendingManualStop> {
  return withJournalLock(userId, () => {
    const existing = readPendingManualStop(storage, userId);
    if (existing && existing.requestId !== request.requestId) throw new Error('Une autre demande d’arrêt est déjà en attente sur cet appareil. Fermez ce formulaire puis reprenez la demande conservée.');
    if (existing && JSON.stringify(existing) !== JSON.stringify(request)) throw new Error('Le contenu de la demande initiale doit être conservé. Fermez puis rouvrez le formulaire pour reprendre cette demande.');
    const record = existing || request;
    const serialized = JSON.stringify(record);
    storage.setItem(pendingManualStopKey(userId), serialized);
    if (storage.getItem(pendingManualStopKey(userId)) !== serialized) throw new Error('La demande n’a pas pu être conservée. Aucun arrêt supplémentaire n’a été envoyé.');
    return record;
  });
}

export async function clearPendingManualStop(storage: JournalStorage, userId: string, requestId: string): Promise<boolean> {
  return withJournalLock(userId, () => {
    const current = readPendingManualStop(storage, userId);
    if (!current) return true;
    if (current.requestId !== requestId) return false;
    storage.removeItem(pendingManualStopKey(userId));
    return true;
  });
}
