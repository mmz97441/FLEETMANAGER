import * as functions from 'firebase-functions/v1';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';
import { allowedClientRequestKinds, CLIENT_REQUEST_LABELS, CLIENT_REQUEST_STATUS_LABELS, ClientRequestKind, ClientRequestStatus } from './clientRequestModel';

interface Dependencies { db: Firestore; requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>; isAdminCaller: (role: unknown) => boolean }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
const fail = (message: string): never => { throw new functions.https.HttpsError('invalid-argument', message); };
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail('Texte invalide ou trop long.');
const belongsTo = (parcel: any, client: any) => parcel.clientId === client.id || (!!client.companyName && parcel.clientName === client.companyName);

export async function createClientRequestHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role);
  if (!manager && String(caller.role).toLowerCase() !== 'client') throw new functions.https.HttpsError('permission-denied', 'Demande réservée au client et à l’exploitation.');
  if (!validId(data?.requestId) || !validId(data.packageId) || !validId(data.clientId)) fail('Références de demande invalides.');
  if (!manager && data.clientId !== caller.id) throw new functions.https.HttpsError('permission-denied', 'Cette demande appartient à un autre client.');
  const kind = data.kind as ClientRequestKind;
  if (!Object.prototype.hasOwnProperty.call(CLIENT_REQUEST_LABELS, kind)) fail('Choisissez le motif de la demande.');
  const message = text(data.message, 3000);
  if (message.length < 10) fail('Décrivez votre demande en au moins 10 caractères.');
  const requestedAddress = kind === 'ADDRESS' ? {
    contactName: text(data.requestedAddress?.contactName, 200), address: text(data.requestedAddress?.address, 500),
    postalCode: text(data.requestedAddress?.postalCode, 20), city: text(data.requestedAddress?.city, 200), contactPhone: text(data.requestedAddress?.contactPhone, 100),
  } : null;
  if (requestedAddress && (Object.values(requestedAddress).some(value => !value) || !/^\d{5}$/.test(requestedAddress.postalCode))) fail('Complétez le destinataire, la rue, le code postal à cinq chiffres, la ville et le téléphone proposés.');
  const requestedDate = kind === 'REDELIVERY' ? text(data.requestedDate || '', 10) : '';
  const parsedDate = Date.parse(`${requestedDate}T12:00:00Z`);
  if (requestedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== requestedDate)) fail('Date de présentation invalide.');
  const fingerprint = hash(JSON.stringify([data.clientId, data.packageId, kind, message, requestedAddress, requestedDate]));
  const id = hash(`${caller.id}|${data.requestId}`), ref = deps.db.collection('client_requests').doc(id);
  return deps.db.runTransaction(async tx => {
    const old = await tx.get(ref);
    if (old.exists) {
      if (old.data()!.actorId !== caller.id || old.data()!.fingerprint !== fingerprint) throw new functions.https.HttpsError('failed-precondition', 'Cette référence contient déjà une autre demande.');
      return { id, reference: old.data()!.reference };
    }
    if (requestedDate && requestedDate < new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)) fail('Choisissez une date de présentation à partir d’aujourd’hui, en heure de La Réunion.');
    const clientSnap = await tx.get(deps.db.collection('users').doc(data.clientId));
    const client = { ...clientSnap.data(), id: clientSnap.id } as any;
    const packageSnap = await tx.get(deps.db.collection('packages').doc(data.packageId)), parcel = packageSnap.data();
    if (!clientSnap.exists || String(client.role).toLowerCase() !== 'client' || client.isDisabled || !parcel || !belongsTo(parcel, client))
      throw new functions.https.HttpsError('permission-denied', 'Ce colis n’appartient pas à ce client ou n’est plus disponible.');
    if (!allowedClientRequestKinds(parcel).includes(kind)) throw new functions.https.HttpsError('failed-precondition', 'Le statut du colis a changé. Actualisez sa fiche pour choisir une demande adaptée.');
    const previous = await tx.get(deps.db.collection('client_requests').where('packageId', '==', data.packageId));
    const active = previous.docs.find(row => row.data().kind === kind && ['OPEN', 'IN_PROGRESS'].includes(row.data().status));
    if (active) throw new functions.https.HttpsError('already-exists', `Une demande est déjà ouverte : ${active.data().reference}. Consultez son suivi.`, { requestId: active.id });
    const users = await tx.get(deps.db.collection('users'));
    const recipients = users.docs.filter(user => !user.data().isDisabled && deps.isAdminCaller(user.data().role));
    if (recipients.length > 400) throw new functions.https.HttpsError('resource-exhausted', 'La demande ne peut pas encore être distribuée. Contactez l’exploitation.');
    const now = new Date().toISOString(), reference = `DC-${id.slice(0, 10).toUpperCase()}`;
    const packageReference = String(parcel.externalId || parcel.carrierBarcode || parcel.barcode || parcel.orderNumber || packageSnap.id);
    tx.create(ref, { reference, actorId: caller.id, clientId: client.id, companyName: client.companyName || '', fingerprint,
      packageId: packageSnap.id, packageReference, packageStatus: String(parcel.status || 'Statut inconnu'), recipientName: parcel.contactName || '', kind, message,
      requestedAddress, requestedDate: requestedDate || null, status: 'OPEN', response: '', version: 1, createdAt: now, updatedAt: now,
      history: [{ status: 'OPEN', timestamp: now, actorName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), response: '' }] });
    for (const user of recipients) tx.create(deps.db.collection('notifications').doc(`client-request-${id}-${user.id}`), {
      recipientId: user.id, type: 'system', priority: 'high', title: 'Demande client à traiter',
      message: `${reference} · ${packageReference} · ${CLIENT_REQUEST_LABELS[kind]}`, actionType: 'navigate', actionTarget: 'missions',
      metadata: { clientRequestId: id, packageId: packageSnap.id }, read: false, createdAt: now, _createdAt: FieldValue.serverTimestamp() });
    return { id, reference };
  });
}

export async function updateClientRequestHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context);
  if (!deps.isAdminCaller(caller.role)) throw new functions.https.HttpsError('permission-denied', 'Le traitement des demandes est réservé à l’exploitation.');
  if (!validId(data?.id) || !validId(data.operationId) || !Number.isInteger(data.expectedVersion)) fail('Référence de traitement invalide.');
  const status = data.status as ClientRequestStatus, response = text(data.response || '', 3000);
  if (!['IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(status)) fail('Statut de demande invalide.');
  if (['RESOLVED', 'REJECTED'].includes(status) && response.length < 10) fail('Expliquez au client le résultat du traitement en au moins 10 caractères.');
  const key = hash(`${caller.id}|${data.operationId}`), receiptRef = deps.db.collection('client_request_operations').doc(key), ref = deps.db.collection('client_requests').doc(data.id);
  const fingerprint = hash(JSON.stringify([data.id, data.expectedVersion, status, response]));
  return deps.db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()!.fingerprint !== fingerprint) throw new functions.https.HttpsError('failed-precondition', 'Cette opération correspond à une autre réponse.');
      return { id: data.id };
    }
    const snap = await tx.get(ref), request = snap.data();
    if (!request) throw new functions.https.HttpsError('not-found', 'Demande introuvable.');
    if (request.version !== data.expectedVersion || ['RESOLVED', 'REJECTED'].includes(request.status))
      throw new functions.https.HttpsError('failed-precondition', 'Cette demande a déjà été traitée ou modifiée. Relisez son suivi avant de répondre.');
    const now = new Date().toISOString(), nextVersion = request.version + 1;
    const history = [...request.history, { status, response, timestamp: now, actorName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim() }];
    tx.update(ref, { status, response, version: nextVersion, updatedAt: now, assignedTo: caller.id, history });
    tx.create(receiptRef, { fingerprint, actorId: caller.id, requestId: snap.id, createdAt: now });
    tx.create(deps.db.collection('notifications').doc(`client-request-result-${snap.id}-${nextVersion}`), {
      recipientId: request.clientId, type: 'system', priority: 'normal', title: `${request.reference} · ${CLIENT_REQUEST_STATUS_LABELS[status]}`,
      message: response || 'L’exploitation a pris en charge votre demande.', actionType: 'navigate', actionTarget: 'client_shipments',
      metadata: { clientRequestId: snap.id, packageId: request.packageId }, read: false, createdAt: now, _createdAt: FieldValue.serverTimestamp() });
    // Request workflow never edits the parcel, its mission, movements or proofs.
    return { id: snap.id };
  });
}
