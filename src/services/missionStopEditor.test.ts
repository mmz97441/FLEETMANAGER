import { beforeEach, expect, it, vi } from 'vitest';
import { MissionStatus, PackageStatus, StopStatus } from '../types';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), commits: 0 }));
vi.mock('../firebaseConfig', () => ({ db: {}, default: {} }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => vi.fn(async () => ({ data: {} })) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  runTransaction: async (_db: unknown, work: (tx: any) => Promise<any>) => {
    const writes: { path: string; patch: any }[] = [];
    const result = await work({ get: async (path: string) => { if (writes.length) throw new Error('read after write'); return { exists: () => state.docs.has(path), data: () => structuredClone(state.docs.get(path)) }; }, update: (path: string, patch: any) => writes.push({ path, patch }) });
    writes.forEach(w => state.docs.set(w.path, { ...state.docs.get(w.path), ...w.patch }));
    state.commits++; return result;
  },
}));
import { deleteMissionStop, editMissionStop, reorderStops } from './missionStopEditor';
const patch = { contactName: 'Changed', address: '12 rue Test', city: 'Saint-Denis', postalCode: '97400', serviceTime: 5, notes: null };
beforeEach(() => {
  state.docs.clear(); state.commits = 0;
  state.docs.set('missions/m', { status: MissionStatus.DISPATCHED, driverId: 'd', hubName: 'Hub', zone: 'Nord', deliveredPackages: 1, stops: [
    { id: 'a', status: StopStatus.PENDING, sequence: 1, contactName: 'Original', packageIds: ['p'], packageCount: 1 },
    { id: 'b', status: StopStatus.COMPLETED, sequence: 2, contactName: 'Other fresh stop', packageIds: ['q'], packageCount: 1, proofSyncPending: true },
  ] });
  state.docs.set('packages/p', { missionId: 'm', stopId: 'a', currentDriverId: 'd', status: PackageStatus.IN_DELIVERY, movements: [{ action: 'LOADED' }] });
});

it('rejects empty address, invalid duration, invalid or reversed time slots before a write', async () => {
  for (const invalid of [{ address: '   ' }, { serviceTime: 0 }, { serviceTime: 481 }, { serviceTime: 1.5 }, { timeWindowStart: '12:00', timeWindowEnd: '09:00' }]) await expect(editMissionStop('m', 'a', { ...patch, ...invalid })).rejects.toThrow();
  expect(state.commits).toBe(0);
});

it('reorders fresh stops and rejects a stale or duplicated set of stop IDs', async () => {
  await expect(reorderStops('m', ['a', 'a'])).rejects.toThrow('changé');
  await expect(reorderStops('m', ['a'])).rejects.toThrow('changé');
  await reorderStops('m', ['b', 'a']);
  expect(state.docs.get('missions/m').stops[0]).toMatchObject({ id: 'b', sequence: 1, proofSyncPending: true });
});
it('atomically removes a pending stop and records the return without losing parcel history', async () => {
  expect(await deleteMissionStop('m', 'a', { id: 'admin', firstName: 'Admin', lastName: 'Test' })).toEqual({ returnedPackages: 1 });
  expect(state.docs.get('missions/m').stops.map((s: any) => s.id)).toEqual(['b']);
  expect(state.docs.get('packages/p')).toMatchObject({ status: PackageStatus.RETURN_REQUESTED, missionId: 'm' });
  expect(state.docs.get('packages/p').movements).toHaveLength(2);
  expect(state.commits).toBe(1);
});
it('does not delete the stop or alter parcels when a parcel was delivered or transferred concurrently', async () => {
  for (const changed of [{ status: PackageStatus.DELIVERED }, { missionId: 'other' }, { currentDriverId: 'other' }]) {
    const original = structuredClone(state.docs.get('packages/p'));
    Object.assign(state.docs.get('packages/p'), changed);
    await expect(deleteMissionStop('m', 'a', { id: 'admin', firstName: 'Admin', lastName: 'Test' })).rejects.toThrow('transféré');
    expect(state.docs.get('missions/m').stops).toHaveLength(2);
    state.docs.set('packages/p', original);
  }
  expect(state.commits).toBe(0);
});
