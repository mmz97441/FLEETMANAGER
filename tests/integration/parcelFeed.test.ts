import { afterAll, expect, it, vi } from 'vitest';
vi.mock('../../src/firebaseConfig', async () => {
  const { initializeApp } = await import('firebase/app');
  const { initializeFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  const app = initializeApp({ projectId: 'demo-fleet-production-audit' }, 'parcel-feed-integration');
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, '127.0.0.1', 8189, { mockUserToken: 'owner' });
  return { db };
});
import { db } from '../../src/firebaseConfig';
import { doc, writeBatch, updateDoc, terminate } from 'firebase/firestore';
import { subscribeParcelFeed, type ParcelCoverage } from '../../src/services/parcelFeed';
import { PackageStatus, type Package } from '../../src/types';
afterAll(() => terminate(db));
it('keeps every active parcel, pages both client scopes and refreshes all history including undated records', async () => {
  const prefix = 'feed-' + crypto.randomUUID(), batch = writeBatch(db);
  for (let i = 0; i < 120; i++) batch.set(doc(db, 'packages', `${prefix}-active-${i}`), { status: PackageStatus.IN_DELIVERY, clientId: prefix, clientName: prefix });
  for (let i = 0; i < 7; i++) batch.set(doc(db, 'packages', `${prefix}-history-${i}`), { status: i % 2 ? PackageStatus.RETURNED : PackageStatus.DELIVERED, ...(i % 2 ? { clientName: prefix } : { clientId: prefix }) });
  await batch.commit();
  let parcels: Package[] = [], coverage: ParcelCoverage | undefined;
  const controller = subscribeParcelFeed({ scopes: [{ field: 'clientId', value: prefix }, { field: 'clientName', value: prefix }], pageSize: 3,
    onChange: (items, current) => { parcels = items; coverage = current; } });
  try {
    await vi.waitFor(() => expect(coverage?.activeCount).toBe(120));
    expect(coverage?.historyComplete).toBe(false); expect(coverage?.historyCount).toBe(6);
    await controller.loadMore(); expect(coverage?.historyComplete).toBe(true); expect(parcels).toHaveLength(127);
    await updateDoc(doc(db, 'packages', `${prefix}-active-119`), { status: PackageStatus.DELIVERED });
    await vi.waitFor(() => expect(coverage?.activeCount).toBe(119));
    const all = await controller.loadAll(); expect(all).toHaveLength(127);
    expect(all.filter(p => [PackageStatus.DELIVERED, PackageStatus.RETURNED].includes(p.status))).toHaveLength(8);
    expect(all.filter(p => !p.createdAt)).toHaveLength(127);
  } finally { controller.unsubscribe(); }
});
