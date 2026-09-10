import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const fixture = vi.hoisted(() => {
  process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
  const prefix = `e2e-delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { prefix, driver: `${prefix}-driver`, admin: `${prefix}-admin`, hub: `${prefix}-hub`,
    delivered: `${prefix}-delivered`, failed: `${prefix}-failed` };
});

vi.mock('../../src/firebaseConfig', async () => {
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-fleet-production-audit',
    firestore: { host: '127.0.0.1', port: 8189 },
    storage: { host: '127.0.0.1', port: 9199 },
  });
  const context = testEnv.authenticatedContext(fixture.driver);
  return { db: context.firestore(), storage: context.storage(), testEnv,
    auth: { currentUser: { uid: fixture.driver } }, default: {} };
});

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    if (name !== 'finishMission') throw new Error(`Unexpected callable in this lifecycle test: ${name}`);
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const service = require('../../functions/lib/index.js');
    return { data: await service.finishMission.run(data, {
      auth: { uid: fixture.driver, token: { email_verified: true } },
    }) };
  },
}));

vi.mock('firebase/storage', async original => {
  const real = await original<typeof import('firebase/storage')>();
  return {
    ...real,
    // Real uploads/reads still exercise Storage rules. Production download URLs
    // use HTTPS, while the local emulator necessarily returns HTTP addresses.
    getDownloadURL: async (...args: Parameters<typeof real.getDownloadURL>) =>
      (await real.getDownloadURL(...args)).replace(/^http:/, 'https:'),
  };
});
vi.mock('../../src/services/logService', () => ({ reportError: vi.fn() }));

import * as config from '../../src/firebaseConfig';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { commitStopOutcome, startDriverMission, updateMissionStatus } from '../../src/services/missionService';
import { uploadAndCreatePOD } from '../../src/services/podService';
import { MissionStatus, PackageStatus, StopStatus } from '../../src/types';

const require = createRequire(import.meta.url);
const server = require('../../functions/lib/index.js');
const functionsRequire = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminDb = functionsRequire('firebase-admin/firestore').getFirestore();
const env = (config as any).testEnv;
let missionId: string | undefined;
const context = (uid: string) => ({ auth: { uid, token: { email_verified: true } } });
const parcelIds = [fixture.delivered, fixture.failed];
const location = { lat: -20.9, lng: 55.5 };

beforeEach(() => {
  vi.stubGlobal('Image', class {
    onerror?: () => void;
    set src(_value: string) { this.onerror?.(); }
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  const paths = [`users/${fixture.admin}`, `users/${fixture.driver}`, `hubs/${fixture.hub}`,
    ...parcelIds.map(id => `packages/${id}`)];
  if (missionId) paths.push(`missions/${missionId}`, `proofs_of_delivery/${missionId}_stop`, `notifications/dispatch-${missionId}`);
  await Promise.all(paths.map(path => adminDb.doc(path).delete()));
  await env.cleanup();
  await adminDb.terminate();
});

it('dispatches sorted parcels, starts under driver rules, blocks closure until proof upload, then preserves a partial delivery', async () => {
  await Promise.all([
    adminDb.collection('users').doc(fixture.admin).set({ id: fixture.admin, role: 'Admin' }),
    adminDb.collection('users').doc(fixture.driver).set({ id: fixture.driver, role: 'Chauffeur', status: 'active', firstName: 'Test', lastName: 'Chauffeur' }),
    adminDb.collection('hubs').doc(fixture.hub).set({ name: 'Hub fictif', isActive: true }),
    ...parcelIds.map(id => adminDb.collection('packages').doc(id).set({
      status: 'Trié', address: '28 rue Joseph Bédier', city: 'Saint-Denis', postalCode: '97400',
      clientId: `${fixture.prefix}-client`, movements: [],
    })),
  ]);
  const request = {
    requestId: `${fixture.prefix}-dispatch`,
    missions: [{
      date: '2026-09-12', zone: 'Nord', hubId: fixture.hub, driverId: fixture.driver,
      plannedDepartureTime: '08:00', totalDistance: 20, estimatedDuration: 60,
      stops: [{ id: 'stop', type: 'DELIVERY', packageIds: parcelIds,
        address: '28 rue Joseph Bedier', city: 'Saint Denis', postalCode: '97400',
        contactName: 'Destinataire fictif', serviceTime: 10, durationFromPrevious: 30,
        coordinates: location, estimatedArrival: '2026-09-12T04:30:00Z' }],
    }],
  };
  const dispatch = await server.dispatchMissions.run(request, context(fixture.admin));
  missionId = dispatch.missionIds[0];
  expect(dispatch.packageCount).toBe(2);
  const missionRef = doc(config.db, 'missions', missionId!);
  for (const id of parcelIds) {
    expect((await getDoc(doc(config.db, 'packages', id))).data()).toMatchObject({
      status: PackageStatus.SORTED, missionId, stopId: 'stop', currentDriverId: fixture.driver,
    });
  }

  const startedAt = '2026-09-12T08:00:00+04:00';
  const stops = await startDriverMission(missionId!, { driverId: fixture.driver, driverName: 'Test Chauffeur', startedAt, coordinates: location });
  expect(stops[0].estimatedArrival).toBe('2026-09-12T04:30:00.000Z');
  for (const id of parcelIds) expect((await getDoc(doc(config.db, 'packages', id))).data()?.status).toBe(PackageStatus.IN_DELIVERY);

  const outcome = {
    missionId: missionId!, stopId: 'stop',
    stopPatch: { status: StopStatus.COMPLETED, completionTime: '2026-09-12T04:35:00Z', arrivalCoordinates: location },
    packageOutcomes: [
      { packageId: fixture.delivered, status: PackageStatus.DELIVERED, movement: { action: 'DELIVERED' as const, driverId: fixture.driver } },
      { packageId: fixture.failed, status: PackageStatus.FAILED, movement: { action: 'FAILED' as const, driverId: fixture.driver, notes: 'Colis déclaré non remis' } },
    ],
  };
  await commitStopOutcome(outcome);
  expect((await getDoc(missionRef)).data()).toMatchObject({
    status: MissionStatus.IN_PROGRESS, deliveredPackages: 1, failedPackages: 1,
    stops: [expect.objectContaining({ status: StopStatus.COMPLETED, proofSyncPending: true })],
  });
  await expect(updateDoc(missionRef, { status: MissionStatus.COMPLETED })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(updateMissionStatus(missionId!, MissionStatus.COMPLETED)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect((await getDoc(missionRef)).data()?.status).toBe(MissionStatus.IN_PROGRESS);

  const proof = await uploadAndCreatePOD({
    missionId: missionId!, stopId: 'stop', packageIds: [fixture.delivered],
    driverId: fixture.driver, driverName: 'Test Chauffeur', vehicleId: '', vehiclePlate: '',
    recipientName: 'Destinataire fictif', coordinates: location,
    signatureBase64: 'data:image/png;base64,AQID', photosBase64: ['data:image/jpeg;base64,AQID'],
    recordedAt: '2026-09-12T04:35:00Z',
  });
  expect(proof).not.toBeNull();
  expect(proof?.signatureUrl).toMatch(/^https:/);
  expect((await getDoc(missionRef)).data()?.stops[0].proofSyncPending).toBe(false);
  expect((await getDoc(doc(config.db, 'packages', fixture.delivered))).data()?.pod.packageIds).toEqual([fixture.delivered]);
  expect((await getDoc(doc(config.db, 'packages', fixture.failed))).data()?.pod).toBeUndefined();

  await updateMissionStatus(missionId!, MissionStatus.COMPLETED);
  const closed = (await getDoc(missionRef)).data()!;
  expect(closed).toMatchObject({ status: MissionStatus.COMPLETED, deliveredPackages: 1, failedPackages: 1, totalPackages: 2 });
  expect((await getDoc(doc(config.db, 'packages', fixture.failed))).data()?.status).toBe(PackageStatus.FAILED);
  await commitStopOutcome(outcome);
  await updateMissionStatus(missionId!, MissionStatus.COMPLETED);
  expect((await getDoc(missionRef)).data()).toMatchObject({ completedAt: closed.completedAt, deliveredPackages: 1, failedPackages: 1 });
}, 30_000);
