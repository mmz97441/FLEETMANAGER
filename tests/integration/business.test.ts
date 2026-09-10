import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
const gate = vi.hoisted(() => ({
  reads: 0,
  release: null as null | (() => void),
  barrier: null as Promise<void> | null,
}));
vi.mock('firebase/firestore', async (original) => {
  const real = await original<any>();
  return {
    ...real,
    getDoc: async (ref: any) => {
      const snap = await real.getDoc(ref);
      if (ref.path === 'packages/race' && gate.barrier) {
        gate.reads++;
        if (gate.reads === 2) gate.release?.();
        await gate.barrier;
      }
      return snap;
    },
  };
});
vi.mock('../../src/firebaseConfig', async () => {
  const { initializeApp } = await import('firebase/app');
  const { initializeFirestore, connectFirestoreEmulator } =
    await import('firebase/firestore');
  const app = initializeApp(
    { projectId: 'demo-fleet-production-audit' },
    'business-audit',
  );
  const db = initializeFirestore(app, {});
  connectFirestoreEmulator(db, '127.0.0.1', 8189, { mockUserToken: 'owner' });
  return { db, storage: {}, auth: {}, default: app };
});
vi.mock('../../src/services/gmproService', () => ({
  geocodeAddress: vi.fn(),
  getGoogleMapsApiKey: () => '',
}));
vi.mock('../../src/services/logService', () => ({ reportError: vi.fn() }));
vi.mock('../../src/services/notificationService', () => ({
  notifyPackageDelivered: vi.fn(async () => {}),
  notifyPackageFailed: vi.fn(async () => {}),
  notifyPackageInDelivery: vi.fn(async () => {}),
  notifyAdminDeliveryFailure: vi.fn(async () => {}),
}));
import { db } from '../../src/firebaseConfig';
import { setDoc, doc, getDoc, deleteDoc, terminate } from 'firebase/firestore';
import {
  commitStopOutcome,
  updatePackageStatus,
  deleteMission,
  publishLiveTrackingForMission,
} from '../../src/services/missionService';
import { finalizePickup } from '../../src/services/pickupService';
import { StopStatus, MissionStatus, PackageStatus } from '../../src/types';
const stop = (extra = {}) => ({
  id: 's',
  type: 'DELIVERY',
  status: StopStatus.PENDING,
  sequence: 1,
  packageIds: ['p1', 'p2'],
  packageCount: 2,
  ...extra,
});
const mission = (extra = {}) => ({
  driverId: 'driverA',
  status: MissionStatus.IN_PROGRESS,
  stops: [stop()],
  totalPackages: 2,
  deliveredPackages: 0,
  failedPackages: 0,
  ...extra,
});
beforeEach(async () => {
  gate.barrier = null;
  gate.reads = 0;
  await setDoc(doc(db, 'missions', 'test'), mission());
});
afterAll(() => terminate(db));
describe('Production invariants against real services and isolated Firestore', () => {
  it('must reject a nonexistent stop instead of incrementing counters', async () => {
    await expect(
      commitStopOutcome({
        missionId: 'test',
        stopId: 'missing',
        stopPatch: { status: StopStatus.COMPLETED },
        deliveredDelta: 2,
      }),
    ).rejects.toThrow();
  });
  it('must preserve closed mission after a late GPS patch', async () => {
    await setDoc(
      doc(db, 'missions', 'test'),
      mission({
        status: MissionStatus.COMPLETED,
        stops: [stop({ status: StopStatus.COMPLETED })],
        deliveredPackages: 2,
      }),
    );
    await commitStopOutcome({
      missionId: 'test',
      stopId: 's',
      stopPatch: { arrivalCoordinates: { lat: -20, lng: 55 } },
    });
    expect((await getDoc(doc(db, 'missions', 'test'))).data()?.status).toBe(
      MissionStatus.COMPLETED,
    );
  });
  it('must retain consistent total after one delivered and one missing package', async () => {
    await commitStopOutcome({
      missionId: 'test',
      stopId: 's',
      stopPatch: {
        status: StopStatus.COMPLETED,
        packageIds: ['p1'],
        packageCount: 1,
      },
      deliveredDelta: 1,
      failedDelta: 1,
    });
    const m = (await getDoc(doc(db, 'missions', 'test'))).data()!;
    expect(m.deliveredPackages + m.failedPackages).toBeLessThanOrEqual(
      m.totalPackages,
    );
  });
  it('must not change a terminal outcome while retaining incompatible counters', async () => {
    await setDoc(
      doc(db, 'missions', 'test'),
      mission({
        stops: [stop({ status: StopStatus.FAILED })],
        failedPackages: 2,
      }),
    );
    await expect(
      commitStopOutcome({
        missionId: 'test',
        stopId: 's',
        stopPatch: { status: StopStatus.COMPLETED },
        deliveredDelta: 2,
      }),
    ).rejects.toThrow();
    const m = (await getDoc(doc(db, 'missions', 'test'))).data()!;
    expect(m.deliveredPackages).toBe(0);
    expect(m.failedPackages).toBe(2);
  });
  it('must create a pickup manifest when optional signature is absent', async () => {
    await deleteDoc(doc(db, 'pickups', 'pickup_s'));
    await setDoc(
      doc(db, 'missions', 'pickup'),
      mission({
        stops: [
          stop({
            type: 'PICKUP',
            packageIds: ['pickup-package'],
            packageCount: 1,
          }),
        ],
      }),
    );
    await setDoc(doc(db, 'packages', 'pickup-package'), {
      status: PackageStatus.PENDING,
      movements: [],
    });
    const result = await finalizePickup({
      missionId: 'pickup',
      stopId: 's',
      clientId: 'clientA',
      clientName: 'Fictif',
      driverId: 'driverA',
      driverName: 'Audit',
      vehicleId: 'v',
      vehiclePlate: 'TEST',
      address: 'Adresse fictive',
      coordinates: { lat: -20, lng: 55 },
      expectedPackageIds: ['pickup-package'],
      scannedPackageIds: ['pickup-package'],
      missingPackageIds: [],
      unknownBarcodes: [],
    });
    console.log(
      'PICKUP_STATE',
      JSON.stringify({
        result,
        packageStatus: (
          await getDoc(doc(db, 'packages', 'pickup-package'))
        ).data()?.status,
        manifestExists: (await getDoc(doc(db, 'pickups', 'pickup_s'))).exists(),
      }),
    );
    expect(result).not.toBeNull();
  });
  it('must preserve two movements written concurrently', async () => {
    await setDoc(doc(db, 'packages', 'race'), {
      status: PackageStatus.PENDING,
      movements: [],
    });
    gate.barrier = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    await Promise.all([
      updatePackageStatus('race', PackageStatus.COLLECTED, {
        action: 'COLLECTED',
        driverId: 'driverA',
      }),
      updatePackageStatus('race', PackageStatus.IN_DELIVERY, {
        action: 'TRANSFERRED',
        driverId: 'driverB',
      }),
    ]);
    gate.barrier = null;
    const p = (await getDoc(doc(db, 'packages', 'race'))).data()!;
    expect(p.movements).toHaveLength(2);
  });
  it('must not leave packages assigned to a deleted mission', async () => {
    await setDoc(doc(db, 'packages', 'orphan'), {
      missionId: 'test',
      currentDriverId: 'driverA',
      status: PackageStatus.IN_DELIVERY,
    });
    await expect(deleteMission('test')).rejects.toThrow();
    expect((await getDoc(doc(db, 'missions', 'test'))).exists()).toBe(true);
  });
  it('publishes one tracking document per customer without rewriting parcel documents', async () => {
    for (const id of ['tracking-1', 'tracking-2'])
      await setDoc(doc(db, 'packages', id), {
        clientId: 'clientA',
        clientName: 'Société A',
        missionId: 'test',
        currentDriverId: 'driverA',
        status: PackageStatus.IN_DELIVERY,
        updatedAt: 'unchanged',
      });
    const m = {
      id: 'test',
      ...mission({
        stops: [
          stop({ id: 's1', packageIds: ['tracking-1'], packageCount: 1 }),
          stop({
            id: 's2',
            sequence: 2,
            packageIds: ['tracking-2'],
            packageCount: 1,
          }),
        ],
      }),
    } as any;
    await publishLiveTrackingForMission(m, { lat: -20, lng: 55 }, 'Audit');
    const tracking = (
      await getDoc(doc(db, 'client_tracking', 'test_clientA'))
    ).data()!;
    expect(tracking.ranks).toEqual({ 'tracking-1': 0, 'tracking-2': 1 });
    expect(
      (await getDoc(doc(db, 'packages', 'tracking-1'))).data()?.updatedAt,
    ).toBe('unchanged');
  });
});
