import app, { auth, db } from '../firebaseConfig';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import type { User } from '../types';
import type { ClientRequest, ClientRequestKind, ClientRequestStatus, RequestedAddress } from '../../functions/src/clientRequestModel';
export { allowedClientRequestKinds, CLIENT_REQUEST_LABELS, CLIENT_REQUEST_STATUS_LABELS } from '../../functions/src/clientRequestModel';
export type { ClientRequest, ClientRequestKind, ClientRequestStatus, RequestedAddress };

export interface ClientRequestDraft { requestId: string; clientId: string; packageId: string; kind: ClientRequestKind; message: string; requestedAddress?: RequestedAddress; requestedDate?: string }
const draftKey = (uid: string, clientId: string, packageId: string) => `fleet-client-request-v1:${uid}:${clientId}:${packageId}`;
export function readClientRequestDraft(clientId: string, packageId: string): ClientRequestDraft | null {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Reconnectez-vous avant de préparer une demande.');
  const raw = localStorage.getItem(draftKey(uid, clientId, packageId));
  if (!raw) return null;
  const draft = JSON.parse(raw) as ClientRequestDraft;
  if (!draft || draft.clientId !== clientId || draft.packageId !== packageId || typeof draft.requestId !== 'string' || typeof draft.message !== 'string')
    throw new Error('La demande conservée sur cet appareil nécessite un contrôle. Contactez l’exploitation.');
  return draft;
}
export function reserveClientRequestDraft(draft: ClientRequestDraft): ClientRequestDraft {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Reconnectez-vous avant d’envoyer votre demande.');
  const old = readClientRequestDraft(draft.clientId, draft.packageId);
  if (old) return old;
  localStorage.setItem(draftKey(uid, draft.clientId, draft.packageId), JSON.stringify(draft));
  return draft;
}
export async function submitClientRequest(draft: ClientRequestDraft): Promise<{ id: string; reference: string }> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Reconnectez-vous avant d’envoyer votre demande.');
  const saved = reserveClientRequestDraft(draft);
  if (saved.requestId !== draft.requestId || JSON.stringify(saved) !== JSON.stringify(draft)) throw new Error('Une demande précédente reste à vérifier. Reprenez-la avant d’en envoyer une autre.');
  const call = httpsCallable<ClientRequestDraft, { id: string; reference: string }>(getFunctions(app, 'europe-west1'), 'createClientRequest');
  let result: { id: string; reference: string };
  try { result = (await call(saved)).data; }
  catch (error: any) {
    // These server rejections explicitly precede a committed request. An
    // unavailable/deadline result is uncertain and must retain the same intent.
    if (auth.currentUser?.uid === uid && ['invalid-argument', 'permission-denied', 'failed-precondition', 'already-exists', 'not-found', 'unauthenticated']
      .some(code => error?.code === code || error?.code === `functions/${code}`)) {
      try { localStorage.removeItem(draftKey(uid, draft.clientId, draft.packageId)); } catch { /* Preserve the retry if local cleanup is unavailable. */ }
    }
    throw error;
  }
  if (auth.currentUser?.uid !== uid) throw new Error('La session a changé. Votre demande reste conservée pour vérification.');
  try { localStorage.removeItem(draftKey(uid, draft.clientId, draft.packageId)); } catch { /* Server receipt makes the retained retry safe. */ }
  return result;
}
export function subscribeClientRequests(user: User, options: { manager?: boolean; activeOnly?: boolean; count?: number }, next: (rows: ClientRequest[]) => void, error: (error: Error) => void) {
  const filters = options.manager ? (options.activeOnly ? [where('status', 'in', ['OPEN', 'IN_PROGRESS'])] : []) :
    [where(user.companyName ? 'companyName' : 'clientId', '==', user.companyName || user.id)];
  return onSnapshot(query(collection(db, 'client_requests'), ...filters, orderBy('createdAt', 'desc'), limit(options.count || 50)),
    snapshot => next(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as ClientRequest))), error);
}
export function subscribeClientRequest(id: string, next: (request: ClientRequest) => void, error: (error: Error) => void) {
  return onSnapshot(doc(db, 'client_requests', id), snapshot => {
    if (snapshot.exists()) next({ ...snapshot.data(), id: snapshot.id } as ClientRequest);
    else error(new Error('Cette demande n’est plus disponible. Votre réponse non envoyée reste visible.'));
  }, error);
}
export async function updateClientRequest(request: ClientRequest, status: ClientRequestStatus, response: string, operationId: string) {
  const call = httpsCallable(getFunctions(app, 'europe-west1'), 'updateClientRequest');
  await call({ id: request.id, expectedVersion: request.version, status, response, operationId });
}
