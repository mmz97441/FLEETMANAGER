import { createRequire } from 'node:module';
import { beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
vi.hoisted(() => { process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit'; process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189'; process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'; });
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (_: unknown, name: string) => async (data: unknown) => {
    const { createRequire } = await import('node:module');
    const service = createRequire(import.meta.url)('../../functions/lib/index.js');
    return { data: await service[name].run(data, { auth: { uid: 'proof-driver', token: {} } }) };
  },
}));
vi.mock('../../src/firebaseConfig', async () => {
  const { initializeTestEnvironment } =
    await import('@firebase/rules-unit-testing');
  const env = await initializeTestEnvironment({
    projectId: 'demo-fleet-production-audit',
    firestore: { host: '127.0.0.1', port: 8189 },
    storage: { host: '127.0.0.1', port: 9199 },
  });
  const ctx = env.authenticatedContext('proof-driver');
  return {
    default: {},
    db: ctx.firestore(),
    storage: ctx.storage('gs://demo-fleet-production-audit.appspot.com'),
    auth: { currentUser: { uid: 'proof-driver' } },
    testEnv: env,
  };
});
import * as config from '../../src/firebaseConfig';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { uploadAndCreatePOD, uploadFailurePOD } from '../../src/services/podService';
const env = (config as any).testEnv;
const proof = {
  missionId: 'proof-mission',
  stopId: 'stop',
  packageIds: ['proof-package'],
  driverId: 'proof-driver',
  driverName: 'Fictif',
  vehicleId: 'v',
  vehiclePlate: 'TEST',
  recipientName: 'Réceptionnaire fictif',
  photosBase64: ['data:image/jpeg;base64,AQID'],
  signatureBase64: 'data:image/png;base64,AQID',
  coordinates: { lat: -20, lng: 55 }, recordedAt: '2026-09-10T08:00:00Z',
};
beforeEach(async () => {
  vi.stubGlobal('Image', class {
    onerror?: () => void;
    set src(_value: string) { this.onerror?.(); }
  });
  await env.withSecurityRulesDisabled(async (ctx: any) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'proof-driver'), {
      id: 'proof-driver',
      role: 'Chauffeur',
    });
    await setDoc(doc(db, 'missions', 'proof-mission'), {
      driverId: 'proof-driver',
      status: 'En cours',
      stops: [
        { id: 'stop', type: 'DELIVERY', completionTime: proof.recordedAt, status: 'Terminé', packageIds: ['proof-package'], proofSyncPending: true },
        { id: 'other-stop', type: 'DELIVERY', status: 'En attente', packageIds: [] },
      ],
    });
    await setDoc(doc(db, 'packages', 'proof-package'), {
      currentDriverId: 'proof-driver',
      missionId: 'proof-mission',
      stopId: 'stop',
      clientId: 'clientA',
      status: 'Livré',
    });
    await setDoc(doc(db, 'packages', 'proof-unowned'), {
      currentDriverId: 'other-driver',
      missionId: 'proof-mission',
      stopId: 'stop',
      clientId: 'clientB',
      status: 'Livré',
    });
    await deleteDoc(doc(db, 'proofs_of_delivery', 'proof-mission_stop'));
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => env.cleanup());
it('saves optional proof fields and its package reference atomically under real rules', async () => {
  const result = await uploadAndCreatePOD(proof);
  expect(result).not.toBeNull();
  const pkg = (
    await getDoc(doc(config.db, 'packages', 'proof-package'))
  ).data()!;
  expect(pkg.pod.signatureUrl).toBeTruthy();
  expect(pkg.pod.reservesNote).toBeNull();
  expect(pkg.pod.photoUrls).toHaveLength(1);
  expect(pkg.pod.packageIds).toBeUndefined();
  expect(pkg.deliveryAttempts[0]).toMatchObject({ outcome: 'SUCCESS', recordedAt: proof.recordedAt });
  const mission = (await getDoc(doc(config.db, 'missions', 'proof-mission'))).data()!;
  expect(mission.stops[0].proofSyncPending).toBe(false);
  expect(mission.stops[1]).toMatchObject({ id: 'other-stop', status: 'En attente' });
  const replay = await uploadAndCreatePOD(proof);
  expect(replay?.signatureUrl).toBe(result?.signatureUrl);
});

it('one photo and one signature form a single shared proof for three distinct BR parcels', async () => {
  const ids = ['proof-package', 'proof-package-two', 'proof-package-three'];
  await env.withSecurityRulesDisabled(async (ctx: any) => {
    for (const [i, id] of ids.entries()) await setDoc(doc(ctx.firestore(), 'packages', id), {
      externalId: `BR100${i}`, currentDriverId: 'proof-driver', missionId: 'proof-mission', stopId: 'stop', clientId: 'clientA', status: 'Livré',
    });
    await setDoc(doc(ctx.firestore(), 'missions', 'proof-mission'), {
      driverId: 'proof-driver', status: 'En cours', stops: [{ id: 'stop', type: 'DELIVERY', completionTime: proof.recordedAt, status: 'Terminé', packageIds: ids, proofSyncPending: true }],
    });
  });
  const groupedProof = { ...proof, packageIds: ids };
  const result = await uploadAndCreatePOD(groupedProof);
  expect(result).not.toBeNull();
  const saved = (await getDoc(doc(config.db, 'proofs_of_delivery', 'proof-mission_stop'))).data()!;
  expect(saved.packageIds).toEqual(ids);
  expect(saved.photoUrls).toHaveLength(1);
  expect(saved.signatureUrl).toBeTruthy();
  for (const id of ids) {
    const parcel = (await getDoc(doc(config.db, 'packages', id))).data()!;
    expect(parcel.pod.photoUrls).toEqual(saved.photoUrls);
    expect(parcel.pod.signatureUrl).toBe(saved.signatureUrl);
    expect(parcel.pod.recipientName).toBe(proof.recipientName);
  }
  const replay = await uploadAndCreatePOD(groupedProof);
  expect(replay?.timestamp).toBe(result?.timestamp);
});
it('does not publish proof or partial references when any package is unauthorized', async () => {
  const result = await uploadAndCreatePOD({
    ...proof,
    packageIds: ['proof-package', 'proof-unowned'],
  });
  expect(result).toBeNull();
  expect(
    (
      await getDoc(doc(config.db, 'proofs_of_delivery', 'proof-mission_stop'))
    ).exists(),
  ).toBe(false);
  expect(
    (await getDoc(doc(config.db, 'packages', 'proof-package'))).data()?.pod,
  ).toBeUndefined();
  expect((await getDoc(doc(config.db, 'missions', 'proof-mission'))).data()?.stops[0].proofSyncPending).toBe(true);
});

it('records failure without fake GPS and releases the guard under real rules', async () => {
  await env.withSecurityRulesDisabled(async (ctx: any) => {
    await setDoc(doc(ctx.firestore(), 'missions', 'proof-mission'), {
      driverId: 'proof-driver', status: 'En cours',
      stops: [{ id: 'stop', type: 'DELIVERY', completionTime: proof.recordedAt, status: 'Échec', packageIds: ['proof-package'], proofSyncPending: true }],
    });
    await setDoc(doc(ctx.firestore(), 'packages', 'proof-package'), {
      currentDriverId: 'proof-driver', missionId: 'proof-mission', stopId: 'stop', status: 'Échec',
    });
  });
  const result = await uploadFailurePOD({ ...proof, failureReason: 'Absent', coordinates: null });
  expect(result).toBe(true);
  expect((await getDoc(doc(config.db, 'proofs_of_delivery', 'proof-mission_stop'))).data()).toMatchObject({
    coordinates: null, locationStatus: 'unavailable', type: 'FAILURE',
  });
  expect((await getDoc(doc(config.db, 'missions', 'proof-mission'))).data()?.stops[0].proofSyncPending).toBe(false);
  const parcel = (await getDoc(doc(config.db, 'packages', 'proof-package'))).data()!;
  expect(parcel.failurePod).toMatchObject({ type: 'FAILURE', coordinates: null, failureReason: 'Absent' });
  expect(parcel.failurePod.packageIds).toBeUndefined();
  expect(parcel.deliveryAttempts[0].proof.type).toBe('FAILURE');
});

it('releases a stale guard on retry while keeping the existing proof immutable', async () => {
  const original = await uploadAndCreatePOD(proof);
  expect(original).not.toBeNull();
  await env.withSecurityRulesDisabled(async (ctx: any) => {
    const reference = doc(ctx.firestore(), 'missions', 'proof-mission');
    const saved = (await getDoc(reference)).data()!;
    await setDoc(reference, {
      ...saved,
      stops: saved.stops.map((stop: any) => stop.id === 'stop' ? { ...stop, proofSyncPending: true } : stop),
    });
  });
  const replay = await uploadAndCreatePOD(proof);
  expect(replay?.photoUrls).toEqual(original?.photoUrls);
  expect(replay?.timestamp).toBe(original?.timestamp);
  expect((await getDoc(doc(config.db, 'missions', 'proof-mission'))).data()?.stops[0].proofSyncPending).toBe(false);
});

it('exposes only the owning sender’s failed-attempt projection from a mixed-sender stop', async () => {
  await env.withSecurityRulesDisabled(async (ctx: any) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'proof-client-a'), { role: 'Client' });
    await setDoc(doc(db, 'users', 'proof-client-b'), { role: 'Client' });
    await setDoc(doc(db, 'packages', 'proof-package'), {
      missionId: proof.missionId, stopId: proof.stopId, currentDriverId: proof.driverId,
      status: 'Livré', clientId: 'proof-client-a', externalId: 'BR-A',
    });
    await setDoc(doc(db, 'packages', 'proof-failed-b'), {
      missionId: proof.missionId, stopId: proof.stopId, currentDriverId: proof.driverId,
      status: 'Échec', clientId: 'proof-client-b', externalId: 'EXP-B/0042', failureReason: 'Colis non remis',
    });
    await setDoc(doc(db, 'missions', proof.missionId), {
      driverId: proof.driverId, status: 'En cours', stops: [{ id: proof.stopId, type: 'DELIVERY',
        status: 'Terminé', completionTime: proof.recordedAt, proofSyncPending: true,
        packageIds: ['proof-package', 'proof-failed-b'],
      }],
    });
  });
  expect(await uploadAndCreatePOD(proof)).not.toBeNull();
  const clientDb = env.authenticatedContext('proof-client-b').firestore();
  const pkg = (await getDoc(doc(clientDb, 'packages', 'proof-failed-b'))).data()!;
  expect(pkg.failurePod).toMatchObject({ packageId: 'proof-failed-b', type: 'FAILURE', failureReason: 'Colis non remis' });
  expect(pkg.failurePod.packageIds).toBeUndefined();
  expect(pkg.failurePod.signatureUrl).toBeUndefined();
  expect(pkg.failurePod.recipientName).toBeUndefined();
  expect(pkg.deliveryAttempts[0].proof.type).toBe('FAILURE');
  await expect(getDoc(doc(clientDb, 'packages', 'proof-package'))).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(getDoc(doc(clientDb, 'proofs_of_delivery', `${proof.missionId}_${proof.stopId}`))).rejects.toMatchObject({ code: 'permission-denied' });
});
