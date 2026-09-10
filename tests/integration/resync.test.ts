import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const race = vi.hoisted(() => ({
  afterMissionList: null as null | (() => Promise<void>),
  afterMissionRead: null as null | (() => Promise<void>),
}));
vi.mock('firebase/firestore', async (original) => {
  const real = await original<any>();
  return {
    ...real,
    getDocs: async (reference: any) => {
      const snapshot = await real.getDocs(reference);
      if (reference.path === 'missions' && race.afterMissionList) {
        const mutation = race.afterMissionList;
        race.afterMissionList = null;
        await mutation();
      }
      return snapshot;
    },
    runTransaction: (db: any, callback: any, options: any) => real.runTransaction(db, (transaction: any) => callback(new Proxy(transaction, {
      get(target, key) {
        if (key === 'get') return async (reference: any) => {
          const snapshot = await target.get(reference);
          if (reference.path === 'missions/resync-audit-mission' && race.afterMissionRead) {
            const mutation = race.afterMissionRead;
            race.afterMissionRead = null;
            await mutation();
          }
          return snapshot;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })), options),
  };
});
vi.mock('../../src/firebaseConfig', async () => {
  const { initializeApp } = await import('firebase/app');
  const { initializeFirestore, connectFirestoreEmulator } = await import('firebase/firestore');
  // The service intentionally scans every mission, so isolate its whole project
  // from the business/proof fixtures executed concurrently by Vitest.
  const app = initializeApp({ projectId: 'demo-fleet-resync-audit' }, 'resync-audit');
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, '127.0.0.1', 8189, { mockUserToken: 'owner' });
  return { db, default: app };
});
vi.mock('../../src/services/gmproService', () => ({ geocodeAddress: vi.fn(), getGoogleMapsApiKey: () => '' }));
vi.mock('../../src/services/logService', () => ({ reportError: vi.fn() }));

import { db } from '../../src/firebaseConfig';
import { deleteDoc, doc, getDoc, setDoc, terminate, writeBatch } from 'firebase/firestore';
import { resyncPackageStatusesFromStops } from '../../src/services/missionService';
import { PackageStatus, StopStatus } from '../../src/types';

const missionId = 'resync-audit-mission';
const stopId = 'resync-stop';
const driverId = 'resync-audit-driver';
const ids = ['resync-p1', 'resync-p2', 'resync-p3', 'resync-p4'];
const missionRef = doc(db, 'missions', missionId);
const proofRef = doc(db, 'proofs_of_delivery', `${missionId}_${stopId}`);
const packageRef = (id: string) => doc(db, 'packages', id);
const cleanup = () => Promise.all([deleteDoc(missionRef), deleteDoc(proofRef), ...ids.map(id => deleteDoc(packageRef(id)))]);
const seed = async (statuses: PackageStatus[] = [PackageStatus.IN_DELIVERY], proofPatch: Record<string, unknown> | null = {}) => {
  const selected = ids.slice(0, statuses.length);
  await setDoc(missionRef, {
    driverId, status: 'En cours', deliveredPackages: 0, failedPackages: 0,
    stops: [{ id: stopId, type: 'DELIVERY', status: StopStatus.COMPLETED, packageIds: selected }],
  });
  await Promise.all(selected.map((id, index) => setDoc(packageRef(id), {
    missionId, stopId, currentDriverId: driverId, status: statuses[index], movements: [],
  })));
  if (proofPatch !== null) await setDoc(proofRef, {
    missionId, stopId, driverId, type: 'SUCCESS', packageIds: selected,
    photoUrls: ['https://storage.test/photo'], signatureUrl: 'https://storage.test/signature',
    recipientName: 'Réceptionnaire fictif', coordinates: { lat: -21, lng: 55 },
    timestamp: '2026-09-10T08:00:00Z', ...proofPatch,
  });
};
beforeEach(async () => { race.afterMissionList = null; race.afterMissionRead = null; await cleanup(); });
afterAll(async () => { await cleanup(); await terminate(db); });

it('does not manufacture a delivered status from a completed stop without a proof', async () => {
  await seed(undefined, null);
  const result = await resyncPackageStatusesFromStops();
  expect(result.fixedDelivered).toBe(0);
  expect(result.skippedUnproven).toBeGreaterThanOrEqual(1);
  expect((await getDoc(packageRef(ids[0]))).data()).toMatchObject({ status: PackageStatus.IN_DELIVERY, movements: [] });
});

it('restores a proven active parcel and its proof exactly once with consistent counters', async () => {
  await seed();
  expect((await resyncPackageStatusesFromStops()).fixedDelivered).toBe(1);
  const first = (await getDoc(packageRef(ids[0]))).data()!;
  expect(first).toMatchObject({ status: PackageStatus.DELIVERED, pod: { packageId: ids[0], missionId, stopId } });
  expect(first.movements).toHaveLength(1);
  expect((await getDoc(missionRef)).data()?.deliveredPackages).toBe(1);
  expect((await resyncPackageStatusesFromStops()).fixedDelivered).toBe(0);
  expect((await getDoc(packageRef(ids[0]))).data()?.movements).toHaveLength(1);
});

it('requires explicit proof coverage for every parcel of a partial delivery', async () => {
  await seed([PackageStatus.IN_DELIVERY, PackageStatus.IN_DELIVERY], { packageIds: [ids[0]] });
  const result = await resyncPackageStatusesFromStops();
  expect(result.fixedDelivered).toBe(1);
  expect(result.skippedUnproven).toBeGreaterThanOrEqual(1);
  expect((await getDoc(packageRef(ids[1]))).data()?.status).toBe(PackageStatus.IN_DELIVERY);
  expect((await getDoc(missionRef)).data()?.deliveredPackages).toBe(1);
});

it('never applies an old stop proof to a parcel now assigned to another tour', async () => {
  await seed();
  await setDoc(packageRef(ids[0]), { missionId: 'new-mission', stopId: 'new-stop', currentDriverId: 'new-driver', status: PackageStatus.IN_DELIVERY });
  const result = await resyncPackageStatusesFromStops();
  expect(result.fixedDelivered).toBe(0);
  expect(result.skippedReassigned).toBeGreaterThanOrEqual(1);
  expect((await getDoc(packageRef(ids[0]))).data()).toEqual({ missionId: 'new-mission', stopId: 'new-stop', currentDriverId: 'new-driver', status: PackageStatus.IN_DELIVERY });
});

it('preserves failed, requested-return, returned and already-delivered decisions', async () => {
  const statuses = [PackageStatus.FAILED, PackageStatus.RETURN_REQUESTED, PackageStatus.RETURNED, PackageStatus.DELIVERED];
  await seed(statuses);
  expect((await resyncPackageStatusesFromStops()).fixedDelivered).toBe(0);
  for (let index = 0; index < ids.length; index++) {
    expect((await getDoc(packageRef(ids[index]))).data()).toMatchObject({ status: statuses[index], movements: [] });
  }
});

it('rechecks the stop after discovery instead of trusting an obsolete completed snapshot', async () => {
  await seed();
  race.afterMissionList = async () => {
    const mission = (await getDoc(missionRef)).data()!;
    await setDoc(missionRef, { ...mission, stops: [{ ...mission.stops[0], status: StopStatus.ARRIVED }] });
  };
  expect((await resyncPackageStatusesFromStops()).fixedDelivered).toBe(0);
  expect((await getDoc(packageRef(ids[0]))).data()?.status).toBe(PackageStatus.IN_DELIVERY);
});

it('deduplicates concurrent repairs without duplicating movements or counters', async () => {
  await seed();
  const results = await Promise.all([resyncPackageStatusesFromStops(), resyncPackageStatusesFromStops()]);
  expect(results.reduce((sum, result) => sum + result.fixedDelivered, 0)).toBe(1);
  expect((await getDoc(packageRef(ids[0]))).data()?.movements).toHaveLength(1);
  expect((await getDoc(missionRef)).data()?.deliveredPackages).toBe(1);
});

it('preserves the counter and stop of another delivery committed during the repair', async () => {
  await seed([PackageStatus.IN_DELIVERY, PackageStatus.IN_DELIVERY], { packageIds: [ids[0]] });
  const mission = (await getDoc(missionRef)).data()!;
  const stops = [
    { ...mission.stops[0], packageIds: [ids[0]] },
    { id: 'second-stop', type: 'DELIVERY', status: StopStatus.ARRIVED, packageIds: [ids[1]] },
  ];
  await setDoc(missionRef, { ...mission, stops });
  await setDoc(packageRef(ids[1]), { missionId, stopId: 'second-stop', currentDriverId: driverId, status: PackageStatus.IN_DELIVERY });
  race.afterMissionRead = async () => {
    const batch = writeBatch(db);
    batch.update(missionRef, { stops: [stops[0], { ...stops[1], status: StopStatus.COMPLETED }], deliveredPackages: 1 });
    batch.update(packageRef(ids[1]), { status: PackageStatus.DELIVERED });
    await batch.commit();
  };
  expect((await resyncPackageStatusesFromStops()).fixedDelivered).toBe(1);
  const final = (await getDoc(missionRef)).data()!;
  expect(final.deliveredPackages).toBe(2);
  expect(final.stops[1].status).toBe(StopStatus.COMPLETED);
});

it.each([
  { type: 'FAILURE' }, { photoUrls: [] }, { signatureUrl: '' },
  { missionId: 'wrong-mission' }, { coordinates: null },
])('rejects an incompatible or incomplete server proof: %j', async (proofPatch) => {
  await seed(undefined, proofPatch);
  expect((await resyncPackageStatusesFromStops()).fixedDelivered).toBe(0);
  expect((await getDoc(packageRef(ids[0]))).data()?.status).toBe(PackageStatus.IN_DELIVERY);
});
