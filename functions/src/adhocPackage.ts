import { readIndividualReferenceReservations, writeIndividualReferenceReservations } from './parcelReferenceIndex';
import { parcelScanCodes } from './scanCode';
import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'crypto';
import { normalizeScanCode, orderReferenceHint } from './scanCode';
import { scanBusinessDay } from './scanPackage';

export async function createAdHocPackageHandler(data: any, context: functions.https.CallableContext, deps: {
  db: Firestore; requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>; isAdminCaller: (role: unknown) => boolean;
}) {
  const caller = await deps.requireActiveCaller(context);
  if (!['chauffeur', 'chauffeuse'].includes(String(caller.role).trim().toLowerCase()))
    throw new functions.https.HttpsError('permission-denied', 'Création terrain réservée au chauffeur connecté.');
  const code = typeof data?.code === 'string' ? normalizeScanCode(data.code) : '';
  if (data?.verifiedMissing !== true || !code || code.length > 200 ||
      !['clientId', 'contactName', 'address', 'city', 'postalCode'].every(key => typeof data?.[key] === 'string' && data[key].trim() && data[key].length <= 300) || data.clientId.includes('/'))
    throw new functions.https.HttpsError('invalid-argument', 'Vérifiez avec le bureau que le colis est absent de l’import, puis complétez les coordonnées du carton.');
  if (orderReferenceHint(code)) throw new functions.https.HttpsError('failed-precondition', 'Scannez le code individuel BR du carton. Une étiquette de commande ne permet pas de créer un colis.');
  const { db } = deps;
  const id = `adhoc-${createHash('sha256').update(`adhoc/${data.clientId}/${code}`).digest('hex')}`;
  return db.runTransaction(async tx => {
    const client = (await tx.get(db.collection('users').doc(data.clientId))).data();
    if (!client || client.isDisabled || String(client.role).trim().toLowerCase() !== 'client')
      throw new functions.https.HttpsError('failed-precondition', 'Sélectionnez un expéditeur actif.');
    if (/boiron/i.test(client.companyName || '') && !/^BR[-A-Z0-9]+$/.test(code))
      throw new functions.https.HttpsError('invalid-argument', 'Pour Boiron, utilisez le numéro BR individuel imprimé sur le carton.');
    const existing = await tx.get(db.collection('packages').doc(id));
    const matches = await Promise.all(['externalId', 'barcode', 'carrierBarcode', 'orderNumber'].map(field =>
      tx.get(db.collection('packages').where(field, '==', code).limit(2))));
    const others = new Map(matches.flatMap(s => s.docs).filter(d => d.id !== id).map(d => [d.id, d]));
    if (others.size || (existing.exists && existing.data()!.clientId !== data.clientId))
      throw new functions.https.HttpsError('already-exists', 'Ce code existe déjà. Reprenez le scan ou faites vérifier l’étiquette par le bureau. Aucun nouveau colis créé.');
    if (existing.exists) return { package: { ...existing.data(), id } };
    const references = await readIndividualReferenceReservations(tx, db, [{ id, parcel: { externalId: code } }]);
    const now = new Date().toISOString(), name = `${caller.firstName || ''} ${caller.lastName || ''}`.trim();
    const pkg = { clientId: data.clientId, clientName: client.companyName || '', externalId: code, barcode: code, orderNumber: code,
      importBatchId: `MANUEL-${scanBusinessDay(new Date(now))}`, contactName: data.contactName.trim(), address: data.address.trim(),
      city: data.city.trim(), postalCode: data.postalCode.trim(), contactPhone: typeof data.contactPhone === 'string' ? data.contactPhone.slice(0, 50) : '',
      zone: ['Nord', 'Sud', 'Est', 'Ouest'].includes(data.zone) ? data.zone : 'Nord', status: 'En attente',
      currentDriverId: caller.id, serviceTime: 5, reconciliationRequired: true,
      comment: 'Créé après vérification déclarée avec le bureau — à réconcilier avec l’import.',
      movements: [{ action: 'IMPORTED', timestamp: now, driverId: caller.id, driverName: name, notes: 'Absence dans l’import vérifiée avec le bureau, selon le chauffeur.' }],
      createdAt: now, updatedAt: now };
    writeIndividualReferenceReservations(tx, references, caller.id, now);
    tx.create(db.collection('packages').doc(id), { ...pkg, scanCodes: parcelScanCodes(pkg) });
    tx.create(db.collection('activity_logs').doc(), { userId: caller.id, userName: name, userRole: caller.role,
      action: 'PACKAGE_CREATED_ADHOC', category: 'Livraison', targetType: 'package', targetId: id, targetName: code,
      description: `${name} a créé ${code} après vérification déclarée avec le bureau. Réconciliation nécessaire.`, outcome: 'success',
      details: { metadata: { code, client: pkg.clientName, verifiedMissing: true } }, createdAt: now });
    return { package: { ...pkg, id } };
  });
}
