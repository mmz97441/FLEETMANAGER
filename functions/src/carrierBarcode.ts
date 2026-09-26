import type { Firestore, Transaction } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'crypto';
import { normalizeScanCode, orderReferenceHint } from './scanCode';

export function validatedCarrierBarcode(value: unknown, reference: unknown): string {
  if (typeof value !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Le code Boiron doit être conservé comme texte, avec ses zéros initiaux.');
  const code = normalizeScanCode(value), order = orderReferenceHint(code);
  if (!order || order !== String(reference || '').trim())
    throw new functions.https.HttpsError('invalid-argument', 'Le code Boiron doit comporter 22 chiffres et correspondre à la référence de commande du colis.');
  return code;
}

/** Read phase only. The registry serializes concurrent associations/imports. */
export async function checkCarrierBarcode(tx: Transaction, db: Firestore, code: string, packageId: string) {
  const ref = db.collection('carrier_barcodes').doc(createHash('sha256').update(code).digest('hex'));
  const [reservation, matches] = await Promise.all([
    tx.get(ref),
    Promise.all(['carrierBarcode', 'barcode', 'externalId', 'orderNumber'].map(field => tx.get(db.collection('packages').where(field, '==', code).limit(2)))),
  ]);
  if (reservation.exists && reservation.data()!.packageId !== packageId)
    throw new functions.https.HttpsError('already-exists', 'Ce code Boiron est déjà associé à un autre colis. Faites vérifier les étiquettes.');
  for (const existing of matches) {
    if (existing.docs.some(d => d.id !== packageId))
      throw new functions.https.HttpsError('already-exists', 'Ce code identifie déjà un autre colis. Aucune association modifiée.');
  }
  return { ref, exists: reservation.exists };
}

export async function associateCarrierBarcodeHandler(data: any, context: functions.https.CallableContext, deps: {
  db: Firestore; requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>; isAdminCaller: (role: unknown) => boolean;
}) {
  const caller = await deps.requireActiveCaller(context);
  if (!deps.isAdminCaller(caller.role)) throw new functions.https.HttpsError('permission-denied', 'Association réservée au bureau.');
  if (typeof data?.packageId !== 'string' || !data.packageId || data.packageId.length > 200 || data.packageId.includes('/') || data?.verified !== true)
    throw new functions.https.HttpsError('invalid-argument', 'Vérifiez les deux étiquettes du même carton avant de confirmer.');
  return deps.db.runTransaction(async tx => {
    const ref = deps.db.collection('packages').doc(data.packageId), snap = await tx.get(ref), pkg = snap.data();
    if (!pkg) throw new functions.https.HttpsError('not-found', 'Colis introuvable.');
    const code = validatedCarrierBarcode(data.code, pkg.clientReference);
    if (pkg.carrierBarcode && pkg.carrierBarcode !== code) throw new functions.https.HttpsError('already-exists', 'Ce colis possède déjà un autre code Boiron. Faites vérifier le carton.');
    const reservation = await checkCarrierBarcode(tx, deps.db, code, ref.id);
    if (reservation.exists && pkg.carrierBarcode === code) return { success: true, replayed: true };
    const at = new Date().toISOString();
    tx.set(reservation.ref, { packageId: ref.id, code, createdAt: at, createdBy: caller.id });
    tx.update(ref, { carrierBarcode: code, updatedAt: at });
    tx.create(deps.db.collection('activity_logs').doc(), {
      userId: caller.id, userName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), userRole: caller.role,
      action: 'PACKAGE_BARCODE_ASSOCIATED', category: 'Livraison', targetType: 'package', targetId: ref.id,
      targetName: pkg.externalId || pkg.barcode || '', description: 'Correspondance des deux étiquettes du carton vérifiée par le bureau.',
      outcome: 'success', details: { carrierBarcode: code, clientReference: pkg.clientReference }, createdAt: at,
    });
    return { success: true, replayed: false };
  });
}
