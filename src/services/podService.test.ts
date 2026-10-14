import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PackageStatus, StopStatus } from '../types';

const state = vi.hoisted(() => ({
  documents: new Map<string, Record<string, any>>(),
  transactions: [] as { path: string; patch: Record<string, any>; create: boolean }[][],
  upload: vi.fn(),
  download: vi.fn(),
  beforeTransaction: undefined as (() => void) | undefined,
}));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {}, storage: {} }));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => path,
  uploadString: state.upload,
  getDownloadURL: state.download,
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  getDoc: vi.fn(async (path: string) => ({ exists: () => state.documents.has(path), data: () => structuredClone(state.documents.get(path)) })),
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(),
}));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => async (data: unknown) => {
    const { publishDeliveryProofHandler } = await import('../../functions/src/publishDeliveryProof');
    const db = {
      collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }),
      runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
        state.beforeTransaction?.();
        const writes: typeof state.transactions[number] = [];
        const result = await callback({
          get: async (ref: any) => ({ exists: state.documents.has(ref.path), ref, data: () => structuredClone(state.documents.get(ref.path)) }),
          create: (ref: any, patch: any) => writes.push({ path: ref.path, patch, create: true }),
          update: (ref: any, patch: any) => writes.push({ path: ref.path, patch, create: false }),
        });
        writes.forEach(write => state.documents.set(write.path, write.create ? write.patch : { ...state.documents.get(write.path), ...write.patch }));
        state.transactions.push(writes);
        return result;
      },
    };
    return { data: await publishDeliveryProofHandler(data, {} as any, { db: db as any,
      requireActiveCaller: async () => ({ id: 'driver', role: 'Chauffeur', firstName: 'Chauffeur' }),
    }) };
  },
}));

import { uploadAndCreatePOD, uploadFailurePOD } from './podService';

const base = {
  missionId: 'mission', stopId: 'stop', packageIds: ['parcel'],
  driverId: 'driver', driverName: 'Chauffeur', vehicleId: 'vehicle', vehiclePlate: 'TEST',
  photosBase64: ['data:image/jpeg;base64,photo'], recordedAt: '2026-09-10T08:00:00Z',
};
const failure = () => { const pkg = state.documents.get('packages/parcel'); if (pkg) pkg.status = PackageStatus.FAILED; const mission = state.documents.get('missions/mission'); if (mission) mission.stops[0].status = StopStatus.FAILED; return { ...base, failureReason: 'Absent', coordinates: null }; };
const success = () => ({ ...base, recipientName: 'Client', signatureBase64: 'signature', coordinates: { lat: -21, lng: 55 } });
const proofPath = 'proofs_of_delivery/mission_stop';
const mission = () => state.documents.get('missions/mission')!;
const parcel = () => state.documents.get('packages/parcel')!;

beforeEach(() => {
  process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
  state.documents.clear();
  state.transactions.length = 0;
  state.beforeTransaction = undefined;
  state.upload.mockReset().mockResolvedValue(undefined);
  state.download.mockReset().mockImplementation(async (path: string) => `https://firebasestorage.googleapis.com/v0/b/demo-fleet-production-audit.appspot.com/o/${encodeURIComponent(path)}?token=test`);
  state.documents.set('missions/mission', {
    driverId: 'driver',
    stops: [
      { id: 'stop', type: 'DELIVERY', completionTime: base.recordedAt, status: StopStatus.COMPLETED, proofSyncPending: true, packageIds: ['parcel'] },
      { id: 'other-stop', status: StopStatus.PENDING, packageIds: ['other-parcel'] },
    ],
  });
  state.documents.set('packages/parcel', {
    missionId: 'mission', stopId: 'stop', currentDriverId: 'driver', status: PackageStatus.DELIVERED,
  });
  // Let image decoding fall back to the original image; no DOM/network needed.
  vi.stubGlobal('Image', class {
    onerror?: () => void;
    set src(_value: string) { this.onerror?.(); }
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('records missing GPS honestly and saves the failure proof before allowing closure', async () => {
  expect(await uploadFailurePOD(failure())).toBe(true);
  const proof = state.documents.get(proofPath)!;
  expect(proof.coordinates).toBeNull();
  expect(proof.locationStatus).toBe('unavailable');
  expect(proof.photoUrls).toHaveLength(1);
  expect(mission().stops[0].proofSyncPending).toBe(false);
  expect(mission().stops[1]).toEqual({ id: 'other-stop', status: StopStatus.PENDING, packageIds: ['other-parcel'] });
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0].map((write) => write.path)).toEqual([proofPath, 'packages/parcel', 'missions/mission']);
});

it('retains a captured failure position without inventing a fallback', async () => {
  expect(await uploadFailurePOD({ ...failure(), coordinates: { lat: -21, lng: 55 } })).toBe(true);
  expect(state.documents.get(proofPath)).toMatchObject({
    coordinates: { lat: -21, lng: 55 }, locationStatus: 'captured',
  });
});

it('keeps the closure guard when the required failure photo is missing', async () => {
  expect(await uploadFailurePOD({ ...failure(), photosBase64: [] })).toBe(false);
  expect(state.documents.has(proofPath)).toBe(false);
  expect(mission().stops[0].proofSyncPending).toBe(true);
});

it('keeps the closure guard if photo upload fails, including its retry', async () => {
  vi.useFakeTimers();
  state.upload.mockRejectedValue(new Error('Network unavailable'));
  const result = uploadFailurePOD(failure());
  await vi.runAllTimersAsync();
  expect(await result).toBe(false);
  expect(state.upload).toHaveBeenCalledTimes(2);
  expect(state.documents.has(proofPath)).toBe(false);
  expect(mission().stops[0].proofSyncPending).toBe(true);
});

it('publishes the delivered parcel proof and removes the closure guard together', async () => {
  expect(await uploadAndCreatePOD(success())).toMatchObject({ packageId: 'parcel' });
  expect(parcel().pod.photoUrls).toHaveLength(1);
  expect(parcel().pod.signatureUrl).toContain('https://firebasestorage.googleapis.com/');
  expect(mission().stops[0].proofSyncPending).toBe(false);
  expect(state.transactions).toHaveLength(1);
  expect(state.transactions[0].map((write) => write.path)).toEqual([proofPath, 'packages/parcel', 'missions/mission']);
});

it('refuses to attach the old proof to a parcel reassigned during upload', async () => {
  state.beforeTransaction = () => state.documents.set('packages/parcel', { ...parcel(), missionId: 'new-mission' });
  expect(await uploadAndCreatePOD(success())).toBeNull();
  expect(state.documents.has(proofPath)).toBe(false);
  expect(parcel().pod).toBeUndefined();
  expect(mission().stops[0].proofSyncPending).toBe(true);
});

it.each(['SUCCESS', 'FAILURE'] as const)('releases a stale guard when the %s proof already exists', async (type) => {
  const existing = {
    ...base, type, coordinates: type === 'SUCCESS' ? { lat: -21, lng: 55 } : null,
    photoUrls: ['https://storage.test/already-uploaded'], timestamp: '2026-09-10T08:00:00Z',
  };
  state.documents.set(proofPath, existing);
  const result = type === 'SUCCESS' ? await uploadAndCreatePOD(success()) : await uploadFailurePOD(failure());
  expect(result).toBeTruthy();
  expect(state.upload).not.toHaveBeenCalled();
  expect(state.documents.get(proofPath)).toEqual(existing);
  expect(mission().stops[0].proofSyncPending).toBe(false);
  expect(state.transactions[0].map((write) => write.path)).toEqual(['packages/parcel', 'missions/mission']);
});

it('preserves changes to other stops made while media upload is in progress', async () => {
  state.beforeTransaction = () => {
    mission().stops[1] = { ...mission().stops[1], status: StopStatus.ARRIVED, arrivalTime: '2026-09-10T08:01:00Z' };
  };
  expect(await uploadFailurePOD(failure())).toBe(true);
  expect(mission().stops[1]).toMatchObject({ status: StopStatus.ARRIVED, arrivalTime: '2026-09-10T08:01:00Z' });
});

it('does not accept an existing failure proof for a different parcel set', async () => {
  state.documents.set(proofPath, { ...base, packageIds: ['different-parcel'], type: 'FAILURE' });
  expect(await uploadFailurePOD(failure())).toBe(false);
  expect(mission().stops[0].proofSyncPending).toBe(true);
});

it('does not release a guard using a proof filed under the wrong mission or stop', async () => {
  state.documents.set(proofPath, { ...base, missionId: 'other-mission', type: 'FAILURE' });
  expect(await uploadFailurePOD(failure())).toBe(false);
  expect(mission().stops[0].proofSyncPending).toBe(true);
  expect(state.transactions).toHaveLength(0);
});

it.each(['SUCCESS', 'FAILURE'] as const)('keeps the original %s event time after offline synchronization', async (type) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T18:00:00Z'));
  const recordedAt = '2026-09-10T08:00:00Z';
  const result = type === 'SUCCESS'
    ? await uploadAndCreatePOD({ ...success(), recordedAt })
    : await uploadFailurePOD({ ...failure(), recordedAt });
  expect(result).toBeTruthy();
  expect(state.documents.get(proofPath)).toMatchObject({
    timestamp: recordedAt, createdAt: '2026-09-10T18:00:00.000Z',
  });
});
