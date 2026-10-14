// Real client service code against a local emulator; owner token bypasses rules.
// Rules and authorized proof writes are covered separately by test:emulated.
import { afterAll, expect, it, vi } from 'vitest';
vi.mock('../../src/firebaseConfig', async () => {
  const { initializeApp } = await import('firebase/app');
  const { initializeFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  const app = initializeApp({ projectId: 'demo-fleet-production-audit' }, 'logistics-audit');
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, '127.0.0.1', 8189, { mockUserToken: 'owner' });
  return { db, default: app, storage: {}, auth: {} };
});
vi.mock('../../src/services/logService', () => ({ reportError: vi.fn() }));
import { db } from '../../src/firebaseConfig';
import { doc, setDoc, getDoc, terminate } from 'firebase/firestore';
import { editMissionStop } from '../../src/services/missionStopEditor';
import { commitStopOutcome, updatePackageFields } from '../../src/services/missionService';
import { finalizePickup } from '../../src/services/pickupService';
import { MissionStatus, StopStatus, PackageStatus } from '../../src/types';
afterAll(() => terminate(db));
async function seed(name: string, extra = {}) {
  const id = 'audit-' + name;
  await setDoc(doc(db, 'missions', id), { driverId: 'audit-driver', status: MissionStatus.DISPATCHED, date: '2026-10-14', stops: [{ id: 'stop', type: 'DELIVERY', status: StopStatus.PENDING, contactName: 'Pharmacie A', address: '1 rue Ancienne', city: 'Saint-Denis', postalCode: '97400', packageIds: [id], packageCount: 1, ...extra }] });
  await setDoc(doc(db, 'packages', id), { externalId: id, clientId: 'audit-client', status: PackageStatus.IN_DELIVERY, missionId: id, stopId: 'stop', currentDriverId: 'audit-driver', contactName: 'Pharmacie A', address: '1 rue Ancienne', movements: [], createdAt: '2026-10-12T05:00:00Z' });
  return id;
}
it('LOG-04: editing the stop leaves the parcel address unchanged; editing the parcel leaves the stop unchanged', async () => {
  const id = await seed('edit');
  await editMissionStop(id, 'stop', { contactName: 'Pharmacie A', address: '2 rue Corrigée', city: 'Saint-Denis', postalCode: '97400', serviceTime: 5 });
  expect((await getDoc(doc(db, 'packages', id))).data()?.address).toBe('1 rue Ancienne');
  await updatePackageFields(id, { address: '3 rue Autre' });
  expect((await getDoc(doc(db, 'missions', id))).data()?.stops[0].address).toBe('2 rue Corrigée');
});
it('LOG-07: failure reason is only unstructured movement text on the parcel', async () => {
  const id = await seed('failure');
  await commitStopOutcome({ missionId: id, stopId: 'stop', stopPatch: { status: StopStatus.FAILED }, packageOutcomes: [{ packageId: id, status: PackageStatus.FAILED, movement: { action: 'FAILED', notes: 'Établissement fermé — portail fermé' } }] });
  const pkg = (await getDoc(doc(db, 'packages', id))).data()!;
  expect(pkg.status).toBe(PackageStatus.FAILED);
  expect(pkg.failureReason).toBeUndefined();
  expect(pkg.failureNotes).toBeUndefined();
});
it('LOG-10: replaying an offline outcome stamps its movement at synchronization time', async () => {
  const id = await seed('offline');
  const actualVisit = '2026-10-12T19:59:00Z';
  await commitStopOutcome({ missionId: id, stopId: 'stop', stopPatch: { status: StopStatus.COMPLETED, completionTime: actualVisit }, packageOutcomes: [{ packageId: id, status: PackageStatus.DELIVERED, movement: { action: 'DELIVERED' } }] });
  expect((await getDoc(doc(db, 'missions', id))).data()?.stops[0].completionTime).toBe(actualVisit);
  expect((await getDoc(doc(db, 'packages', id))).data()?.movements[0].timestamp).not.toBe(actualVisit);
});
it('LOG-11: finalizing a partial pickup retains the missing parcel assignment', async () => {
  const id = await seed('pickup', { type: 'PICKUP' });
  await updatePackageFields(id, { status: PackageStatus.PENDING });
  await finalizePickup({ missionId: id, stopId: 'stop', clientId: 'audit-client', clientName: 'Expéditeur fictif', driverId: 'audit-driver', driverName: 'Fictif', vehicleId: '', vehiclePlate: '', address: '1 rue Ancienne', expectedPackageIds: [id], scannedPackageIds: [], missingPackageIds: [id], unknownBarcodes: [] });
  expect((await getDoc(doc(db, 'missions', id))).data()?.stops[0].status).toBe(StopStatus.COMPLETED);
  expect((await getDoc(doc(db, 'packages', id))).data()).toMatchObject({ status: PackageStatus.PENDING, missionId: id, stopId: 'stop', currentDriverId: 'audit-driver' });
});
