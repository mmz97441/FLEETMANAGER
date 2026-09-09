import { beforeEach, afterAll, it, expect, vi } from 'vitest';
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
import { uploadAndCreatePOD } from '../../src/services/podService';
const env = (config as any).testEnv;
const proof = {
  missionId: 'proof-mission',
  stopId: 'stop',
  packageIds: ['proof-package'],
  driverId: 'proof-driver',
  driverName: 'Fictif',
  vehicleId: 'v',
  vehiclePlate: 'TEST',
  photosBase64: [],
  signatureBase64: 'data:image/png;base64,AQID',
  coordinates: { lat: -20, lng: 55 },
};
beforeEach(async () =>
  env.withSecurityRulesDisabled(async (ctx: any) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'proof-driver'), {
      id: 'proof-driver',
      role: 'Chauffeur',
    });
    await setDoc(doc(db, 'missions', 'proof-mission'), {
      driverId: 'proof-driver',
      status: 'En cours',
    });
    await setDoc(doc(db, 'packages', 'proof-package'), {
      currentDriverId: 'proof-driver',
      clientId: 'clientA',
      status: 'Livré',
    });
    await setDoc(doc(db, 'packages', 'proof-unowned'), {
      currentDriverId: 'other-driver',
      clientId: 'clientB',
      status: 'Livré',
    });
    await deleteDoc(doc(db, 'proofs_of_delivery', 'proof-mission_stop'));
  }),
);
afterAll(() => env.cleanup());
it('saves optional proof fields and its package reference atomically under real rules', async () => {
  const result = await uploadAndCreatePOD(proof);
  expect(result).not.toBeNull();
  const pkg = (
    await getDoc(doc(config.db, 'packages', 'proof-package'))
  ).data()!;
  expect(pkg.pod.signatureUrl).toBeTruthy();
  expect(pkg.pod.reservesNote).toBeNull();
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
});
