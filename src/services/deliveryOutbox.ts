import { auth } from '../firebaseConfig';
import { MissionStop, StopStatus } from '../types';
import { commitStopOutcome } from './missionService';
import { uploadAndCreatePOD, uploadFailurePOD } from './podService';

type Action = Parameters<typeof commitStopOutcome>[0];
type SuccessProof = Parameters<typeof uploadAndCreatePOD>[0];
type FailureProof = Parameters<typeof uploadFailurePOD>[0];
export type PendingDelivery = {
  id: string;
  userId: string;
  action: Action;
  createdAt: string;
  committed?: boolean;
} & (
  | { kind: 'success'; proof: SuccessProof }
  | { kind: 'failure'; proof: FailureProof }
);
const CHANGE = 'fleet-outbox-change';
let dbPromise: Promise<IDBDatabase> | undefined;
function openDB(): Promise<IDBDatabase> {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('fleet-delivery-outbox', 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore('deliveries', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = undefined;
        reject(req.error);
      };
    });
  return dbPromise;
}
async function write(entry: PendingDelivery | string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('deliveries', 'readwrite');
    const store = tx.objectStore('deliveries');
    if (typeof entry === 'string') store.delete(entry);
    else store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  window.dispatchEvent(new Event(CHANGE));
}
export async function pendingDeliveries(
  userId: string,
  missionId?: string,
): Promise<PendingDelivery[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('deliveries').objectStore('deliveries').getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as PendingDelivery[]).filter(
          (e) => e.userId === userId && (!missionId || e.action.missionId === missionId),
        ),
      );
    req.onerror = () => reject(req.error);
  });
}

/** Local guard; the server also rechecks the latest stops, parcels and proofs. */
export async function assertMissionReadyToClose(
  userId: string,
  missionId: string,
  stops: Pick<MissionStop, 'status' | 'proofSyncPending'>[],
): Promise<void> {
  let pending: PendingDelivery[];
  try {
    pending = await pendingDeliveries(userId, missionId);
  } catch {
    throw new Error('Impossible de vérifier les envois conservés sur cet appareil. Gardez la tournée ouverte et réessayez.');
  }
  if (pending.length) {
    throw new Error(`${pending.length} livraison(s) ou preuve(s) de cette tournée attendent encore leur envoi. Connectez cet appareil et utilisez « Réessayer » dans le bandeau de synchronisation avant de clôturer.`);
  }
  const remaining = stops.filter((stop) => ![
    StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED,
  ].includes(stop.status)).length;
  if (remaining) {
    throw new Error(`${remaining} arrêt(s) restent à traiter. Enregistrez la livraison ou son échec, ou faites réaffecter les colis par le bureau avant de clôturer.`);
  }
  if (stops.some((stop) => stop.proofSyncPending)) {
    throw new Error('Des preuves de cette tournée attendent leur envoi. Synchronisez l’appareil ayant enregistré ces arrêts avant de clôturer.');
  }
  if (!navigator.onLine) {
    throw new Error('Une connexion est nécessaire pour vérifier et clôturer la tournée. Vos enregistrements restent conservés sur cet appareil.');
  }
}
const running = new Map<
  string,
  Promise<Awaited<ReturnType<typeof commitStopOutcome>>>
>();
async function perform(entry: PendingDelivery) {
  // Do not await Firestore writes while offline: preserve the entire intent locally.
  if (!navigator.onLine) throw new Error('En attente du réseau');
  if (auth.currentUser?.uid !== entry.userId)
    throw new Error('Reconnectez le compte ayant enregistré cette livraison.');
  const result = await commitStopOutcome(entry.action);
  if (!entry.committed) {
    entry = { ...entry, committed: true };
    await write(entry);
  }
  if (auth.currentUser?.uid !== entry.userId)
    throw new Error('La session a changé ; preuves conservées.');
  const proof =
    entry.kind === 'success'
      ? await uploadAndCreatePOD({ ...entry.proof, recordedAt: entry.createdAt })
      : await uploadFailurePOD({ ...entry.proof, recordedAt: entry.createdAt });
  if (!proof)
    throw new Error(
      'Livraison enregistrée ; preuves en attente de synchronisation.',
    );
  await write(entry.id);
  return result;
}
function run(entry: PendingDelivery) {
  const existing = running.get(entry.id);
  if (existing) return existing;
  const task = perform(entry).finally(() => running.delete(entry.id));
  running.set(entry.id, task);
  return task;
}
export async function submitDelivery(entry: PendingDelivery) {
  // One IndexedDB transaction also protects the original intention across tabs.
  const db = await openDB();
  const saved = await new Promise<PendingDelivery>((resolve, reject) => {
    const tx = db.transaction('deliveries', 'readwrite');
    const store = tx.objectStore('deliveries');
    const request = store.get(entry.id);
    let original = entry;
    request.onsuccess = () => {
      if (request.result) original = request.result as PendingDelivery;
      else store.add(entry);
    };
    tx.oncomplete = () => resolve(original);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  window.dispatchEvent(new Event(CHANGE));
  return run(saved);
}
export async function syncDeliveries(userId: string) {
  const pending = await pendingDeliveries(userId);
  const observation = pending.length ? startUxTask('sync', 'driver') : null;
  const errors: string[] = [];
  for (const entry of pending) {
    try {
      await run(entry);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  observation?.finish(errors.length ? 'error' : 'success', { items: pending.length, errors: errors.length });
  return errors;
}
export const outboxChangeEvent = CHANGE;
import { startUxTask } from '../utils/uxMetrics';
