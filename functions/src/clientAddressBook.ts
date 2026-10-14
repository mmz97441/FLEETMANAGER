import * as functions from 'firebase-functions/v1';
import type { Firestore } from 'firebase-admin/firestore';
import { addressBookIdentity, addressBookFieldErrors } from './addressBookIdentity';
export { addressBookIdentity } from './addressBookIdentity';

interface Dependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
}

function fields(raw: any) {
  const value = (key: string, max: number, required = false) => {
    const text = typeof raw?.[key] === 'string' ? raw[key].trim() : '';
    if ((required && !text) || text.length > max) throw new functions.https.HttpsError('invalid-argument', `Champ destinataire invalide : ${key}.`);
    return text;
  };
  const result = { contactName: value('contactName', 200, true), address: value('address', 500, true), city: value('city', 200, true),
    contactPhone: value('contactPhone', 100, true), contactEmail: value('contactEmail', 254), notes: value('notes', 3000) };
  if (result.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail))
    throw new functions.https.HttpsError('invalid-argument', 'Corrigez l’adresse email ou laissez le champ vide.');
  return result;
}

export async function saveClientAddressHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role);
  if (!manager && String(caller.role).toLowerCase() !== 'client') throw new functions.https.HttpsError('permission-denied', 'Carnet réservé au client et à l’exploitation.');
  const companyName = manager ? String(data?.address?.companyName || '').trim() : String(caller.companyName || '').trim();
  if (!companyName || companyName.length > 200) throw new functions.https.HttpsError('failed-precondition', 'Votre entreprise doit être renseignée par votre responsable avant d’utiliser le carnet.');
  const editable = fields(data?.address), type = data?.address?.type;
  const errors = addressBookFieldErrors(editable);
  if (Object.keys(errors).length) throw new functions.https.HttpsError('invalid-argument', Object.values(errors).join(' '));
  if (!['pickup', 'delivery', 'both'].includes(type)) throw new functions.https.HttpsError('invalid-argument', 'Usage de l’adresse invalide.');
  const newRef = deps.db.collection('savedAddresses').doc();
  return deps.db.runTransaction(async tx => {
    // The query is inside the transaction: concurrent saves of the same new
    // recipient cannot both decide that it is absent, including legacy IDs.
    const rows = await tx.get(deps.db.collection('savedAddresses').where('companyName', '==', companyName));
    const matches = rows.docs.filter(row => addressBookIdentity(row.data()) === addressBookIdentity(editable));
    if (matches.length > 1) throw new functions.https.HttpsError('failed-precondition', 'Plusieurs fiches existent pour ce destinataire. Faites contrôler ces doublons avant de réessayer.');
    const now = new Date().toISOString();
    if (matches.length) {
      const existing = matches[0], previousType = existing.data().type;
      const nextType = previousType === type || previousType === 'both' ? previousType : 'both';
      if (nextType !== previousType) tx.update(existing.ref, { type: nextType, updatedAt: now });
      return { id: existing.id, outcome: nextType === previousType ? 'existing' : 'usage_extended' };
    }
    tx.create(newRef, { ...editable, label: String(data?.address?.label || editable.contactName).trim().slice(0, 200),
      companyName, createdBy: caller.id, type, usageCount: 0, createdAt: now, updatedAt: now });
    return { id: newRef.id, outcome: 'created' };
  });
}

export async function updateClientAddressHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role), editable = fields(data?.fields);
  if (typeof data?.id !== 'string' || !data.id || data.id.includes('/')) throw new functions.https.HttpsError('invalid-argument', 'Destinataire invalide.');
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.collection('savedAddresses').doc(data.id), snap = await tx.get(ref), previous = snap.data();
    if (!previous) throw new functions.https.HttpsError('not-found', 'Ce destinataire a été supprimé.');
    if (!manager && (String(caller.role).toLowerCase() !== 'client' || !caller.companyName || caller.companyName !== previous.companyName))
      throw new functions.https.HttpsError('permission-denied', 'Ce destinataire appartient à une autre entreprise.');
    // Legacy incomplete places may still have their email/notes cleared. A new
    // identity, however, must be usable by the shipment workflow.
    if (addressBookIdentity(previous) !== addressBookIdentity(editable)) {
      const errors = addressBookFieldErrors(editable);
      if (Object.keys(errors).length) throw new functions.https.HttpsError('invalid-argument', Object.values(errors).join(' '));
    }
    const rows = await tx.get(deps.db.collection('savedAddresses').where('companyName', '==', previous.companyName));
    if (rows.docs.some(row => row.id !== snap.id && addressBookIdentity(row.data()) === addressBookIdentity(editable)))
      throw new functions.https.HttpsError('already-exists', 'Ce destinataire existe déjà dans le carnet. Modifiez sa fiche existante.');
    tx.update(ref, { ...editable, label: editable.contactName, updatedAt: new Date().toISOString() });
    return { id: snap.id };
  });
}
