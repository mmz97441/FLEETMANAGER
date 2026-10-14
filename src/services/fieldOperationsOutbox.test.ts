import { beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const calls = vi.hoisted(() => ({ auth: { currentUser: { uid: 'driver' } }, pickup: vi.fn(), upload: vi.fn(), callable: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {}, auth: calls.auth }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => calls.callable }));
vi.mock('./pickupService', () => ({ finalizePickup: calls.pickup }));
vi.mock('./podService', () => ({ uploadProofPhoto: calls.upload }));
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('navigator', { onLine: true });
  calls.auth.currentUser = { uid: 'driver' };
  calls.pickup.mockReset().mockResolvedValue({ id: 'manifest' }); calls.upload.mockReset().mockResolvedValue('https://example.invalid/photo'); calls.callable.mockReset().mockResolvedValue({ data: { success: true } });
});
const pickup = () => ({ id: 'driver/pickup/m/s', userId: 'driver', missionId: 'm', createdAt: '2026-10-01T08:30:00Z', kind: 'pickup' as const,
  payload: { missionId: 'm', stopId: 's', clientId: 'client', clientName: 'Expéditeur', driverId: 'driver', driverName: 'Test', vehicleId: '', vehiclePlate: '',
    address: 'Adresse collecte', expectedPackageIds: ['p', 'missing'], scannedPackageIds: ['p'], missingPackageIds: ['missing'], unknownBarcodes: [], signatureBase64: 'signature' } });
const returned = () => ({ id: 'driver/return/p/m', userId: 'driver', missionId: 'm', createdAt: '2026-10-01T09:00:00Z', kind: 'return' as const,
  payload: { packageId: 'p', expectedMissionId: 'm', requestId: 'fixed-return-request', photosBase64: ['photo1', 'photo2'], signatureBase64: 'signature',
    proof: { packageId: 'p', missionId: 'm', driverId: 'driver', driverName: 'Test', hubId: 'hub', hubName: 'Hub', reason: 'OTHER' as const, reasonLabel: 'Absent',
      photoUrls: [] as string[], coordinates: null, timestamp: '2026-10-01T09:00:00Z' } } });
it('retains scans and signature drafts across reload, isolated by user and stop', async () => {
  let outbox = await import('./fieldOperationsOutbox');
  await outbox.saveFieldDraft('pickup/m/s', 'driver', { scans: ['EXP0001'], signature: 'signed' });
  vi.resetModules(); outbox = await import('./fieldOperationsOutbox');
  expect(await outbox.readFieldDraft('pickup/m/s', 'driver')).toEqual({ scans: ['EXP0001'], signature: 'signed' });
  expect(await outbox.readFieldDraft('pickup/m/s', 'another')).toBeNull(); expect(await outbox.readFieldDraft('pickup/m/other', 'driver')).toBeNull();
});
it('persists an offline pickup without writes and replays its original field time after reload', async () => {
  let outbox = await import('./fieldOperationsOutbox'); vi.stubGlobal('navigator', { onLine: false });
  await expect(outbox.submitFieldOperation(pickup())).rejects.toThrow('Conservé'); expect(calls.pickup).not.toHaveBeenCalled();
  vi.resetModules(); outbox = await import('./fieldOperationsOutbox'); const rows = await outbox.fieldOperations('driver');
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ payload: { signatureBase64: 'signature', missingPackageIds: ['missing'] } });
  vi.stubGlobal('navigator', { onLine: true }); await outbox.submitFieldOperation(rows[0]);
  expect(calls.pickup).toHaveBeenCalledWith(expect.objectContaining({ recordedAt: pickup().createdAt })); expect(await outbox.fieldOperations('driver')).toEqual([]);
});
it('first confirmation wins over a changed retry partition', async () => {
  const outbox = await import('./fieldOperationsOutbox'); calls.pickup.mockRejectedValueOnce(new Error('Network'));
  await expect(outbox.submitFieldOperation(pickup())).rejects.toThrow();
  const edited = pickup(); edited.payload.scannedPackageIds = ['p', 'missing']; edited.payload.missingPackageIds = [];
  await outbox.submitFieldOperation(edited);
  expect(calls.pickup).toHaveBeenLastCalledWith(expect.objectContaining({ scannedPackageIds: ['p'], missingPackageIds: ['missing'] }));
});
it('retries a return after lost acknowledgement without uploading again or changing its time/request', async () => {
  let outbox = await import('./fieldOperationsOutbox'); calls.callable.mockRejectedValueOnce(new Error('Lost acknowledgement'));
  await expect(outbox.submitFieldOperation(returned())).rejects.toThrow('Lost'); expect(calls.upload).toHaveBeenCalledTimes(3);
  vi.resetModules(); outbox = await import('./fieldOperationsOutbox');
  await outbox.submitFieldOperation((await outbox.fieldOperations('driver'))[0]); expect(calls.upload).toHaveBeenCalledTimes(3);
  expect(calls.callable).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: 'fixed-return-request', expectedMissionId: 'm', extra: { returnProof: expect.objectContaining({ timestamp: returned().createdAt, photoUrls: ['https://example.invalid/photo', 'https://example.invalid/photo'] }) } }));
  expect(await outbox.fieldOperations('driver')).toEqual([]);
});
it('partial photo upload failure retains originals and resumes remaining uploads', async () => {
  const outbox = await import('./fieldOperationsOutbox'); calls.upload.mockResolvedValueOnce('https://example.invalid/first').mockRejectedValueOnce(new Error('Upload failure'));
  await expect(outbox.submitFieldOperation(returned())).rejects.toThrow('Upload failure');
  const saved = (await outbox.fieldOperations('driver'))[0]; expect(saved).toMatchObject({ payload: { photosBase64: ['photo1', 'photo2'], proof: { photoUrls: ['https://example.invalid/first'] } } });
  await outbox.submitFieldOperation(saved); expect(calls.upload).toHaveBeenCalledTimes(4);
});
it('a changed session cannot submit pickup or return saved by another driver', async () => {
  const outbox = await import('./fieldOperationsOutbox'); calls.auth.currentUser = { uid: 'another' };
  await expect(outbox.submitFieldOperation(pickup())).rejects.toThrow('Reconnectez');
  await expect(outbox.submitFieldOperation(returned())).rejects.toThrow('Reconnectez');
  expect(calls.pickup).not.toHaveBeenCalled(); expect(calls.upload).not.toHaveBeenCalled(); expect(await outbox.fieldOperations('another')).toEqual([]); expect(await outbox.fieldOperations('driver')).toHaveLength(2);
});
it('concurrent clicks share a single in-process request', async () => {
  const outbox = await import('./fieldOperationsOutbox');
  let release!: () => void; calls.pickup.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}); }));
  const one = outbox.submitFieldOperation(pickup()), two = outbox.submitFieldOperation(pickup());
  await vi.waitFor(() => expect(calls.pickup).toHaveBeenCalledTimes(1)); release(); await Promise.all([one, two]);
  expect(calls.pickup).toHaveBeenCalledTimes(1);
});
it('a session change during photo upload stops before signature and server mutation', async () => {
  const outbox = await import('./fieldOperationsOutbox');
  calls.upload.mockImplementationOnce(async () => { calls.auth.currentUser = { uid: 'another' }; return 'https://example.invalid/photo'; });
  await expect(outbox.submitFieldOperation(returned())).rejects.toThrow('Reconnectez');
  expect(calls.upload).toHaveBeenCalledTimes(1); expect(calls.callable).not.toHaveBeenCalled();
  expect(await outbox.fieldOperations('driver')).toHaveLength(1);
});
it('return drafts are isolated between delivery attempts of the same carton', async () => {
  const outbox = await import('./fieldOperationsOutbox');
  await outbox.saveFieldDraft('return/p/first-tour', 'driver', { photos: ['photo'], requestId: 'first-return' });
  expect(await outbox.readFieldDraft('return/p/second-tour', 'driver')).toBeNull();
  expect(await outbox.readFieldDraft('return/p/first-tour', 'another')).toBeNull();
});
