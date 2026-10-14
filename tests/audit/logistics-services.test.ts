// Real client service code against a local emulator; owner token bypasses rules.
// Rules and authorized proof writes are covered separately by test:emulated.
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: 'audit-office' }));
vi.mock('firebase/functions', async () => {
  const { createRequire } = await import('node:module');
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Local emulator required');
  process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
  const require = createRequire(process.cwd() + '/functions/package.json');
  const functions = require('./lib/index.js');
  return { getFunctions: () => ({}), httpsCallable: (_f: unknown, name: string) => async (data: unknown) => ({ data: await functions[name].run(data, { auth: { uid: state.actor, token: { auth_time: 200 } } }) }) };
});
vi.mock('../../src/firebaseConfig', async () => {
  const { initializeApp } = await import('firebase/app');
  const { initializeFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  const app = initializeApp({ projectId: 'demo-fleet-production-audit' }, 'logistics-audit');
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, '127.0.0.1', 8189, { mockUserToken: 'owner' });
  return { db, default: app, storage: {}, auth: { currentUser: { uid: 'audit-driver' } } };
});
vi.mock('../../src/services/logService', () => ({ reportError: vi.fn() }));
import { db } from '../../src/firebaseConfig';
import { doc, setDoc, getDoc, terminate } from 'firebase/firestore';
import { editMissionStop } from '../../src/services/missionStopEditor';
import { commitStopOutcome, updatePackageFields } from '../../src/services/missionService';
import { finalizePickup } from '../../src/services/pickupService';
import { MissionStatus, StopStatus, PackageStatus } from '../../src/types';
afterAll(() => terminate(db));
beforeEach(async () => {
  state.actor = 'audit-office';
  await setDoc(doc(db, 'users', 'audit-office'), { role: 'President', firstName: 'Bureau fictif' });
  await setDoc(doc(db, 'users', 'audit-driver'), { role: 'Chauffeur', firstName: 'Chauffeur fictif' });
});
async function seed(name: string, extra = {}) {
  const id = 'audit-' + name + '-' + crypto.randomUUID();
  await setDoc(doc(db, 'missions', id), { driverId: 'audit-driver', status: MissionStatus.DISPATCHED, date: '2026-10-14', stops: [{ id: 'stop', type: 'DELIVERY', status: StopStatus.PENDING, contactName: 'Pharmacie A', address: '1 rue Ancienne', city: 'Saint-Denis', postalCode: '97400', packageIds: [id], packageCount: 1, ...extra }] });
  await setDoc(doc(db, 'packages', id), { externalId: id, clientId: 'audit-client', status: PackageStatus.IN_DELIVERY, missionId: id, stopId: 'stop', currentDriverId: 'audit-driver', contactName: 'Pharmacie A', address: '1 rue Ancienne', city: 'Saint-Denis', postalCode: '97400', movements: [], createdAt: '2026-10-12T05:00:00Z' });
  return id;
}
it('LOG-04: editing either representation updates its corresponding delivery destination atomically', async () => {
  const id = await seed('edit');
  await editMissionStop(id, 'stop', { contactName: 'Pharmacie A', address: '2 rue Corrigée', city: 'Saint-Denis', postalCode: '97400', serviceTime: 5 });
  expect((await getDoc(doc(db, 'packages', id))).data()?.address).toBe('2 rue Corrigée');
  await updatePackageFields(id, { address: '3 rue Autre' });
  expect((await getDoc(doc(db, 'missions', id))).data()?.stops[0].address).toBe('3 rue Autre');
});
it('LOG-07: failure reason is retained structurally with the corresponding attempt', async () => {
  const id = await seed('failure');
  state.actor = 'audit-driver';
  await commitStopOutcome({ recordedAt: new Date().toISOString(), missionId: id, stopId: 'stop', stopPatch: { status: StopStatus.FAILED }, packageOutcomes: [{ packageId: id, status: PackageStatus.FAILED, failureReason: 'Établissement fermé', failureNotes: 'portail fermé', movement: { action: 'FAILED', notes: 'Établissement fermé — portail fermé' } }] });
  const pkg = (await getDoc(doc(db, 'packages', id))).data()!;
  expect(pkg.status).toBe(PackageStatus.FAILED);
  expect(pkg.failureReason).toBe('Établissement fermé');
  expect(pkg.failureNotes).toBe('portail fermé');
  expect(pkg.deliveryAttempts).toHaveLength(1);
  expect(pkg.deliveryAttempts[0]).toMatchObject({ failureReason: 'Établissement fermé', outcome: 'FAILURE' });
});
it('LOG-10: replaying an offline outcome preserves field time separately from server receipt', async () => {
  const id = await seed('offline');
  const actualVisit = '2026-10-14T00:01:00Z';
  state.actor = 'audit-driver';
  await commitStopOutcome({ missionId: id, stopId: 'stop', stopPatch: { status: StopStatus.COMPLETED, completionTime: actualVisit }, packageOutcomes: [{ packageId: id, status: PackageStatus.DELIVERED, movement: { action: 'DELIVERED' } }] });
  expect((await getDoc(doc(db, 'missions', id))).data()?.stops[0].completionTime).toBe(actualVisit);
  expect((await getDoc(doc(db, 'packages', id))).data()?.movements[0].timestamp).toBe(actualVisit);
  expect((await getDoc(doc(db, 'packages', id))).data()?.movements[0].receivedAt).not.toBe(actualVisit);
});
it('LOG-11: finalizing a partial pickup releases missing parcels while retaining the manifest', async () => {
  const id = await seed('pickup', { type: 'PICKUP' });
  await setDoc(doc(db, 'packages', id), { status: PackageStatus.PENDING }, { merge: true });
  state.actor = 'audit-driver';
  await finalizePickup({ missionId: id, stopId: 'stop', clientId: 'audit-client', clientName: 'Expéditeur fictif', driverId: 'audit-driver', driverName: 'Fictif', vehicleId: '', vehiclePlate: '', address: '1 rue Ancienne', expectedPackageIds: [id], scannedPackageIds: [], missingPackageIds: [id], unknownBarcodes: [] });
  expect((await getDoc(doc(db, 'missions', id))).data()?.stops[0].status).toBe(StopStatus.COMPLETED);
  expect((await getDoc(doc(db, 'pickups', `${id}_stop`))).data()?.missingPackageIds).toEqual([id]);
  expect((await getDoc(doc(db, 'packages', id))).data()).toMatchObject({ status: PackageStatus.PENDING, missionId: null, stopId: null, currentDriverId: null, pickupMissing: { missionId: id, stopId: 'stop' } });
});
