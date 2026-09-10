import { beforeEach, expect, it, vi } from 'vitest';
import { MissionStatus, PackageStatus, StopStatus } from '../types';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), commits: 0 }));
vi.mock('../firebaseConfig', () => ({ db: {} }));
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
it('edits only editable fields while preserving fresh proof data on other stops', async () => {
  await editMissionStop('m', 'a', patch);
  const mission = state.docs.get('missions/m');
  expect(mission.stops[0].contactName).toBe('Changed'); expect(mission.stops[0].notes).toBeNull();
  expect(mission.stops[1]).toMatchObject({ contactName: 'Other fresh stop', status: StopStatus.COMPLETED, proofSyncPending: true });
  expect(mission.deliveredPackages).toBe(1);
});
it('rejects empty address, invalid duration, partial or reversed time slots before a write', async () => {
  for (const invalid of [{ address: '   ' }, { serviceTime: 0 }, { serviceTime: 481 }, { serviceTime: 1.5 }, { timeWindowStart: '09:00' }, { timeWindowStart: '12:00', timeWindowEnd: '09:00' }]) await expect(editMissionStop('m', 'a', { ...patch, ...invalid })).rejects.toThrow();
  expect(state.commits).toBe(0);
});
it('rejects changes when the driver has started or the stop is already processed', async () => {
  await expect(editMissionStop('m', 'b', patch)).rejects.toThrow('traitement');
  state.docs.get('missions/m').status = MissionStatus.IN_PROGRESS;
  await expect(editMissionStop('m', 'a', patch)).rejects.toThrow('démarré');
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
it('invalidates coordinates and all pending estimates when an address changes, retaining completed proof history', async () => {
  const mission = state.docs.get('missions/m');
  Object.assign(mission.stops[0], { ...patch, address: 'Ancienne adresse', coordinates: { lat: -20, lng: 55 }, estimatedArrival: 'old', estimatedDeparture: 'old', distanceFromPrevious: 10 });
  Object.assign(mission.stops[1], { estimatedArrival: 'historical', arrivalCoordinates: { lat: -21, lng: 56 } });
  Object.assign(mission, { totalDistance: 99, estimatedDuration: 120 });
  state.docs.get('packages/p').estimatedDeliveryAt = 'old';
  await editMissionStop('m', 'a', patch);
  const result = state.docs.get('missions/m');
  expect(result.stops[0]).not.toHaveProperty('coordinates');
  expect(result.stops[0]).not.toHaveProperty('estimatedArrival');
  expect(result.stops[1]).toMatchObject({ estimatedArrival: 'historical', arrivalCoordinates: { lat: -21, lng: 56 }, proofSyncPending: true });
  expect(result).toMatchObject({ totalDistance: null, estimatedDuration: null });
  expect(state.docs.get('packages/p').estimatedDeliveryAt).toBeNull();
});
it('keeps valid route data when only contact details change', async () => {
  Object.assign(state.docs.get('missions/m').stops[0], { ...patch, coordinates: { lat: -20, lng: 55 }, estimatedArrival: 'valid' });
  await editMissionStop('m', 'a', { ...patch, contactName: 'Nouveau contact' });
  expect(state.docs.get('missions/m').stops[0]).toMatchObject({ coordinates: { lat: -20, lng: 55 }, estimatedArrival: 'valid' });
});
it('aborts address correction if a downstream parcel was transferred during editing', async () => {
  state.docs.get('packages/p').missionId = 'other';
  await expect(editMissionStop('m', 'a', patch)).rejects.toThrow('affectation');
  expect(state.commits).toBe(0);
  expect(state.docs.get('missions/m').stops[0].contactName).toBe('Original');
});
