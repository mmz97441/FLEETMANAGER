import app, { auth } from '../firebaseConfig';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { finalizePickup } from './pickupService';
import { uploadProofPhoto } from './podService';
import { cleanUndefined } from '../utils/firestore';
import type { ReturnProof } from '../types';
import { withUpdateOperation } from './updateSafety';

type PickupParams = Parameters<typeof finalizePickup>[0];
export type FieldOperation = {
  id: string; userId: string; createdAt: string; missionId?: string;
} & (
  | { kind: 'pickup'; payload: PickupParams }
  | { kind: 'return'; payload: { packageId: string; expectedMissionId: string | null; requestId: string;
      photosBase64: string[]; signatureBase64?: string; proof: ReturnProof } }
);
export const fieldOperationEvent = 'fleet-field-operation-change';
let opening: Promise<IDBDatabase> | undefined;
function openDB() {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fleet-field-operations', 1);
    let settled = false;
    const timeout = setTimeout(() => { settled = true; reject(new Error('Le stockage local ne répond pas. Gardez l’application ouverte.')); }, 8000);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('operations', { keyPath: 'id' });
      request.result.createObjectStore('drafts', { keyPath: 'id' });
    };
    request.onerror = () => { settled = true; clearTimeout(timeout); reject(request.error); };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timeout);
      request.result.onclose = () => { opening = undefined; };
      request.result.onversionchange = () => { request.result.close(); opening = undefined; };
      resolve(request.result);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
async function transaction<T>(storeName: string, write: boolean, action: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const work = async () => {
    const db = await openDB();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, write ? 'readwrite' : 'readonly');
      let result: T;
      action(tx.objectStore(storeName), value => { result = value; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return write ? withUpdateOperation(work) : work();
}
const changed = () => window.dispatchEvent(new Event(fieldOperationEvent));
export async function fieldOperations(userId: string) {
  return transaction<FieldOperation[]>('operations', false, (store, done) => {
    const r = store.getAll(); r.onsuccess = () => done(r.result.filter((e: FieldOperation) => e.userId === userId));
  });
}
export async function saveFieldDraft<T>(id: string, userId: string, value: T): Promise<void> {
  await transaction<void>('drafts', true, (store, done) => { store.put({ id: `${userId}/${id}`, userId, value }); done(); });
}
export async function readFieldDraft<T>(id: string, userId: string): Promise<T | null> {
  return transaction<T | null>('drafts', false, (store, done) => {
    const request = store.get(`${userId}/${id}`); request.onsuccess = () => done(request.result?.userId === userId ? request.result.value : null);
  });
}
export async function clearFieldDraft(id: string, userId: string): Promise<void> {
  await transaction<void>('drafts', true, (store, done) => { store.delete(`${userId}/${id}`); done(); });
}
async function update(entry: FieldOperation | string) {
  await transaction<void>('operations', true, (store, done) => { if (typeof entry === 'string') store.delete(entry); else store.put(entry); done(); });
  changed();
}
const running = new Map<string, Promise<void>>();
function checkSession(entry: FieldOperation) {
  if (auth.currentUser?.uid !== entry.userId) throw new Error('Reconnectez le compte ayant enregistré cette opération.');
  if (!navigator.onLine) throw new Error('Conservé sur ce téléphone. L’envoi reprendra au retour du réseau.');
}
async function perform(entry: FieldOperation) {
  checkSession(entry);
  if (entry.kind === 'pickup') {
    if (entry.payload.driverId !== entry.userId) throw new Error('Le chauffeur de cet enlèvement ne correspond pas au compte.');
    await finalizePickup({ ...entry.payload, recordedAt: entry.createdAt });
    await clearFieldDraft(`pickup/${entry.payload.missionId}/${entry.payload.stopId}`, entry.userId);
  } else {
    const payload = entry.payload;
    // Persist each uploaded URL before the final call. An acknowledgement lost
    // after server commit must be replayable even after assignment is released.
    for (let i = payload.proof.photoUrls.length; i < payload.photosBase64.length; i++) {
      checkSession(entry);
      payload.proof.photoUrls.push(await uploadProofPhoto(payload.photosBase64[i], payload.packageId, 'return'));
      checkSession(entry);
      await update(entry);
    }
    if (payload.signatureBase64 && !payload.proof.signatureUrl) {
      checkSession(entry);
      payload.proof.signatureUrl = await uploadProofPhoto(payload.signatureBase64, payload.packageId, 'return-signature');
      checkSession(entry);
      await update(entry);
    }
    checkSession(entry);
    await httpsCallable(getFunctions(app, 'europe-west1'), 'returnPackage')(cleanUndefined({
      packageId: payload.packageId, expectedMissionId: payload.expectedMissionId, requestId: payload.requestId,
      extra: { returnProof: { ...payload.proof, timestamp: entry.createdAt, requestId: payload.requestId } },
    }));
    await clearFieldDraft(`return/${payload.packageId}/${payload.expectedMissionId || 'unassigned'}`, entry.userId);
  }
  await update(entry.id);
}
/** First local intent wins across tabs. Never overwrite scans/proofs on retry. */
export async function submitFieldOperation(entry: FieldOperation): Promise<void> {
  return withUpdateOperation(async () => {
    const retained = await transaction<FieldOperation>('operations', true, (store, done) => {
      const r = store.get(entry.id);
      r.onsuccess = () => { const saved = r.result || entry; if (!r.result) store.add(entry); done(saved); };
    });
    changed();
    if (retained.userId !== entry.userId) throw new Error('Cette opération appartient à un autre compte.');
    const existing = running.get(retained.id);
    if (existing) return existing;
    const work = perform(retained).finally(() => running.delete(retained.id));
    running.set(retained.id, work);
    return work;
  });
}
