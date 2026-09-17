import { beforeEach, expect, it, vi } from 'vitest';
const { call, storage } = vi.hoisted(() => ({ call: vi.fn(), storage: new Map<string, string>() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: () => call }));
vi.mock('../firebaseConfig', () => ({ default: {} }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
const result = { accepted: true, missionId: 'today', missionDate: '2026-09-17', outcome: 'confirmed' };
beforeEach(() => { storage.clear(); call.mockReset(); vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-17T05:00:00Z')); });
it('reuses an uncertain request after reload and does not show a receipt on network failure', async () => {
  let service = await import('./scanService');
  call.mockRejectedValueOnce({ code: 'functions/deadline-exceeded' });
  await expect(service.scanPackage({ code: 'BR1', driverId: 'd', source: 'driver-claim' })).rejects.toMatchObject({ code: 'functions/deadline-exceeded' });
  const first = call.mock.calls[0][0]; expect(storage.size).toBe(1);
  vi.resetModules(); service = await import('./scanService');
  call.mockResolvedValueOnce({ data: { ...result, requestId: first.requestId, replayed: true } });
  const receipt = await service.scanPackage({ code: 'BR1', driverId: 'd', source: 'driver-claim', targetMissionId: 'different-view' });
  expect(receipt.replayed).toBe(true); expect(call.mock.calls[1][0]).toEqual(first);
  expect([...storage.keys()].some(k => k.includes('.pending.'))).toBe(false);
});
it('a second physical scan gets a new request while concurrent callback noise shares the same request', async () => {
  const service = await import('./scanService');
  call.mockResolvedValue({ data: result });
  const input = { code: 'BR2', driverId: 'd', source: 'driver-claim' as const };
  const a = service.scanPackage(input), b = service.scanPackage(input);
  expect(a).toBe(b); await a; expect(call).toHaveBeenCalledTimes(1);
  await service.scanPackage(input); expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls[1][0].requestId).not.toEqual(call.mock.calls[0][0].requestId);
});
it('every entry uses the selected current tour and expires it at Réunion midnight', async () => {
  const service = await import('./scanService'); call.mockResolvedValue({ data: result });
  service.rememberScanMission('d', 'chosen-tour', '2026-09-17');
  await service.scanPackage({ code: 'BR3', driverId: 'd', source: 'hub-loading' });
  expect(call.mock.calls[0][0].targetMissionId).toBe('chosen-tour');
  vi.setSystemTime(new Date('2026-09-17T20:00:00Z'));
  await service.scanPackage({ code: 'BR3', driverId: 'd', source: 'driver-claim' });
  expect(call.mock.calls[1][0].targetMissionId).toBeUndefined();
  expect(call.mock.calls[1][0].requestId).not.toBe(call.mock.calls[0][0].requestId);
});
it('a business refusal is confirmed and clears its pending intent', async () => {
  const service = await import('./scanService'); call.mockResolvedValue({ data: { ...result, accepted: false, outcome: 'terminal' } });
  expect((await service.scanPackage({ code: 'BR4', driverId: 'd', source: 'transfer' })).accepted).toBe(false);
  expect([...storage.keys()].some(k => k.includes('.pending.'))).toBe(false);
});
