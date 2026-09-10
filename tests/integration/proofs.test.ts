import { beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
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
    db: ctx.firestore(),
    storage: ctx.storage(),
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
  coordinates: { lat: -20, lng: 55 },
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
        { id: 'stop', type: 'DELIVERY', status: 'Terminé', packageIds: ['proof-package'], proofSyncPending: true },
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
  const mission = (await getDoc(doc(config.db, 'missions', 'proof-mission'))).data()!;
  expect(mission.stops[0].proofSyncPending).toBe(false);
  expect(mission.stops[1]).toMatchObject({ id: 'other-stop', status: 'En attente' });
  const replay = await uploadAndCreatePOD(proof);
  expect(replay?.signatureUrl).toBe(result?.signatureUrl);
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
      stops: [{ id: 'stop', type: 'DELIVERY', status: 'Échec', packageIds: ['proof-package'], proofSyncPending: true }],
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
