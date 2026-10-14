import { createHash } from 'crypto';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { normalizeScanCode, parcelCodeFields, parcelIndividualCodes, parcelScanCodes, type ParcelScanCodes } from './scanCode';

export const parcelReferenceId = (code: string): string => createHash('sha256').update(normalizeScanCode(code)).digest('hex');
export interface ReferenceReservation {
  ref: DocumentReference; code: string; packageIds: string[];
  referenceKind: 'individual' | 'order';
}
/** Read before any transaction writes. Every alias participates in serialization:
 * shared order references are allowed, but cannot collide with an individual label. */
export async function readIndividualReferenceReservations(tx: Transaction, db: Firestore,
  items: Array<{ id: string; parcel: ParcelScanCodes }>): Promise<ReferenceReservation[]> {
  const requests = new Map<string, Map<string, boolean>>();
  const collision = () => new functions.https.HttpsError('already-exists',
    'Cette référence identifie déjà un autre colis ou expéditeur. Utilisez une référence individuelle unique.');
  for (const { id, parcel } of items) {
    const individual = parcelIndividualCodes(parcel);
    for (const code of parcelScanCodes(parcel)) {
      if (!requests.has(code)) requests.set(code, new Map());
      const owners = requests.get(code)!;
      owners.set(id, !!owners.get(id) || individual.includes(code));
    }
  }
  for (const owners of requests.values()) if (owners.size > 1 && [...owners.values()].some(Boolean)) throw collision();
  return Promise.all([...requests].map(async ([code, owners]) => {
    const ref = db.collection('parcel_reference_index').doc(parcelReferenceId(code));
    const individual = [...owners.values()].some(Boolean);
    const canonical = db.collection('packages').where('scanCodes', 'array-contains', code);
    const [reservation, ...matches] = await Promise.all([tx.get(ref),
      // Shared orders can contain many cartons. Inspect all aliases so a legacy
      // mixed-case individual label cannot hide behind the first two cartons.
      tx.get(individual ? canonical.limit(2) : canonical),
      ...parcelCodeFields.map(field => tx.get(db.collection('packages').where(field, 'in', [...new Set([code, code.toLowerCase()])]).limit(2)))]);
    const known = reservation.data() as { packageId?: string; packageIds?: string[]; ambiguous?: boolean; referenceKind?: string } | undefined;
    const documents = new Map(matches.flatMap(snapshot => 'docs' in snapshot ? snapshot.docs.map(doc => [doc.id, doc] as const) : []));
    const knownIds = [...new Set([...(known?.packageIds || []), ...(known?.packageId ? [known.packageId] : [])])];
    const allIds = [...new Set([...owners.keys(), ...knownIds, ...documents.keys()])];
    if (individual) {
      if (known?.ambiguous || allIds.length > 1) throw collision();
    } else {
      const individualOwners = new Set([...documents].filter(([, doc]) => parcelIndividualCodes(doc.data()).includes(code)).map(([id]) => id));
      if (known?.referenceKind === 'collision') throw collision();
      // Older reservations have no classification. Preserve unknown owners
      // conservatively until the controlled migration has inspected them.
      if (known?.referenceKind !== 'order') for (const id of knownIds)
        if (known?.referenceKind === 'individual' || !documents.has(id)) individualOwners.add(id);
      if ([...individualOwners].some(id => allIds.some(other => other !== id))) throw collision();
    }
    return { ref, code, packageIds: allIds.slice(0, 2), referenceKind: individual ? 'individual' as const : 'order' as const };
  }));
}
export function writeIndividualReferenceReservations(tx: Transaction, reservations: ReferenceReservation[], createdBy: string, at: string): void {
  for (const { ref, code, packageIds, referenceKind } of reservations) tx.set(ref, {
    code, packageId: packageIds.length === 1 ? packageIds[0] : null, packageIds,
    referenceKind, ambiguous: packageIds.length > 1, updatedAt: at, updatedBy: createdBy,
  });
}
/** Optional write trigger safety net for server paths predating the canonical index. */
export async function repairParcelScanCodes(db: Firestore, packageId: string): Promise<void> {
  await db.runTransaction(async tx => {
    const ref = db.collection('packages').doc(packageId), snap = await tx.get(ref);
    if (!snap.exists) return;
    const pkg = snap.data()!, scanCodes = parcelScanCodes(pkg);
    if (JSON.stringify(pkg.scanCodes) !== JSON.stringify(scanCodes)) tx.update(ref, { scanCodes });
  });
}
