import { beforeEach, it, expect, vi } from 'vitest';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { StopStatus } from '../types';
const calls = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'driver' } },
  commit: vi.fn(),
  proof: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('../firebaseConfig', () => ({ auth: calls.auth }));
vi.mock('./missionService', () => ({ commitStopOutcome: calls.commit }));
vi.mock('./podService', () => ({
  uploadAndCreatePOD: calls.proof,
  uploadFailurePOD: calls.failure,
}));
beforeEach(() => {
  calls.auth.currentUser = { uid: 'driver' };
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { onLine: true });
  calls.commit.mockReset().mockResolvedValue({ allDone: true, stops: [] });
  calls.proof.mockReset().mockResolvedValue({ id: 'proof' });
  calls.failure.mockReset().mockResolvedValue(true);
});
const entry = () => ({
  id: 'driver/mission/stop',
  userId: 'driver',
  kind: 'success' as const,
  createdAt: '2026-09-09',
  action: { missionId: 'mission', stopId: 'stop', stopPatch: {} },
  proof: {
    missionId: 'mission',
    stopId: 'stop',
    packageIds: ['p'],
    driverId: 'driver',
    driverName: 'Test',
    vehicleId: 'v',
    vehiclePlate: 'TEST',
    photosBase64: ['photo-data'],
    signatureBase64: 'signature-data',
    coordinates: { lat: 1, lng: 1 },
  },
});
it('keeps photos and signatures across reload after upload failure', async () => {
  const outbox = await import('./deliveryOutbox');
  calls.proof.mockResolvedValueOnce(null);
  await expect(outbox.submitDelivery(entry())).rejects.toThrow();
  vi.resetModules();
  const reloaded = await import('./deliveryOutbox');
  const rows = await reloaded.pendingDeliveries('driver');
  expect(rows).toHaveLength(1);
  expect(rows[0].proof.photosBase64).toEqual(['photo-data']);
  expect(rows[0].committed).toBe(true);
  expect(await reloaded.pendingDeliveries('another-driver')).toEqual([]);
  await reloaded.syncDeliveries('driver');
  expect(await reloaded.pendingDeliveries('driver')).toEqual([]);
  expect(calls.proof).toHaveBeenLastCalledWith(expect.objectContaining({ recordedAt: entry().createdAt }));
});
it('persists the full action without starting network writes offline', async () => {
  vi.stubGlobal('navigator', { onLine: false });
  const outbox = await import('./deliveryOutbox');
  await expect(outbox.submitDelivery(entry())).rejects.toThrow();
  expect(calls.commit).not.toHaveBeenCalled();
  expect(await outbox.pendingDeliveries('driver')).toHaveLength(1);
});
it('reopens a browser-closed IndexedDB connection and retains photos and signatures', async () => {
  const factory = indexedDB;
  let connection!: IDBDatabase;
  const open = factory.open.bind(factory);
  vi.spyOn(factory, 'open').mockImplementation((...args) => {
    const request = open(...args); request.addEventListener('success', () => { connection = request.result; }); return request;
  });
  const outbox = await import('./deliveryOutbox'); calls.proof.mockResolvedValueOnce(null);
  await expect(outbox.submitDelivery(entry())).rejects.toThrow();
  forceCloseDatabase(connection as unknown as Parameters<typeof forceCloseDatabase>[0]); await new Promise(resolve => setTimeout(resolve, 10));
  const pending = await outbox.pendingDeliveries('driver');
  expect(pending[0].proof.photosBase64).toEqual(['photo-data']); expect(pending[0].kind).toBe('success');
  if (pending[0].kind === 'success') expect(pending[0].proof.signatureBase64).toBe('signature-data');
  await outbox.syncDeliveries('driver'); expect(await outbox.pendingDeliveries('driver')).toEqual([]);
});
it('does not drop a delivery when the atomic commit fails', async () => {
  calls.commit.mockRejectedValue(new Error('Conflict'));
  const outbox = await import('./deliveryOutbox');
  await expect(outbox.submitDelivery(entry())).rejects.toThrow('Conflict');
  expect(calls.proof).not.toHaveBeenCalled();
  expect(await outbox.pendingDeliveries('driver')).toHaveLength(1);
});

it('does not replay another account’s pending delivery', async () => {
  const outbox = await import('./deliveryOutbox');
  calls.auth.currentUser = { uid: 'another-driver' };
  await expect(outbox.submitDelivery(entry())).rejects.toThrow('Reconnectez');
  expect(calls.commit).not.toHaveBeenCalled();
  expect(await outbox.pendingDeliveries('driver')).toHaveLength(1);
});

it('preserves the first pending intention across concurrent tabs',async()=>{
 vi.stubGlobal('navigator',{onLine:false});
 const firstTab=await import('./deliveryOutbox');vi.resetModules();
 const secondTab=await import('./deliveryOutbox');
 const original=entry(), changed={...entry(),proof:{...entry().proof,photosBase64:['different-photo']}};
 await Promise.allSettled([firstTab.submitDelivery(original),secondTab.submitDelivery(changed)]);
 const rows=await firstTab.pendingDeliveries('driver');
 expect(rows).toHaveLength(1);expect(rows[0].proof.photosBase64).toEqual(['photo-data']);
 expect(calls.commit).not.toHaveBeenCalled();
});

it('blocks closing while the delivery is local and while its photos await upload', async () => {
  const outbox = await import('./deliveryOutbox');
  vi.stubGlobal('navigator', { onLine: false });
  await expect(outbox.submitDelivery(entry())).rejects.toThrow();
  await expect(outbox.assertMissionReadyToClose('driver', 'mission', [
    { status: StopStatus.ARRIVED },
  ])).rejects.toThrow('attendent encore leur envoi');

  vi.stubGlobal('navigator', { onLine: true });
  calls.proof.mockResolvedValueOnce(null);
  await outbox.syncDeliveries('driver');
  expect((await outbox.pendingDeliveries('driver', 'mission'))[0].committed).toBe(true);
  await expect(outbox.assertMissionReadyToClose('driver', 'mission', [
    { status: StopStatus.COMPLETED, proofSyncPending: true },
  ])).rejects.toThrow('attendent encore leur envoi');

  await outbox.syncDeliveries('driver');
  await expect(outbox.assertMissionReadyToClose('driver', 'mission', [
    { status: StopStatus.COMPLETED, proofSyncPending: false },
  ])).resolves.toBeUndefined();
});

it('scopes the local closure check to the current driver and mission', async () => {
  const outbox = await import('./deliveryOutbox');
  calls.proof.mockResolvedValue(null);
  await expect(outbox.submitDelivery(entry())).rejects.toThrow();
  await expect(outbox.assertMissionReadyToClose('driver', 'other-mission', [
    { status: StopStatus.FAILED },
  ])).resolves.toBeUndefined();
  await expect(outbox.assertMissionReadyToClose('other-driver', 'mission', [
    { status: StopStatus.COMPLETED },
  ])).resolves.toBeUndefined();
  expect(await outbox.pendingDeliveries('driver', 'other-mission')).toEqual([]);
});

it.each([StopStatus.PENDING, StopStatus.ARRIVED])('blocks closing an untreated stop (%s)', async (status) => {
  const outbox = await import('./deliveryOutbox');
  await expect(outbox.assertMissionReadyToClose('driver', 'mission', [
    { status }, { status: StopStatus.COMPLETED },
  ])).rejects.toThrow('1 arrêt(s) restent à traiter');
});

it('blocks closing when a proof from another device is pending', async () => {
  const outbox = await import('./deliveryOutbox');
  await expect(outbox.assertMissionReadyToClose('driver', 'mission', [
    { status: StopStatus.FAILED, proofSyncPending: true },
  ])).rejects.toThrow('Synchronisez l’appareil');
});

it('requires a connection and a readable outbox before closing', async () => {
  const outbox = await import('./deliveryOutbox');
  vi.stubGlobal('navigator', { onLine: false });
  await expect(outbox.assertMissionReadyToClose('driver', 'mission', [
    { status: StopStatus.COMPLETED },
  ])).rejects.toThrow('Une connexion est nécessaire');

  vi.resetModules();
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('Storage unavailable'); } });
  const unavailable = await import('./deliveryOutbox');
  await expect(unavailable.assertMissionReadyToClose('driver', 'mission', [
    { status: StopStatus.COMPLETED },
  ])).rejects.toThrow('Impossible de vérifier les envois');
});
