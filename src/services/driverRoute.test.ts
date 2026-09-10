import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionStatus, PackageStatus, StopStatus, type MissionStop } from '../types';

const state = vi.hoisted(() => ({
  docs: new Map<string, any>(),
  transactions: [] as { path: string; patch: any }[][],
  beforeTransaction: undefined as (() => void) | undefined,
}));
vi.mock('../firebaseConfig', () => ({ db: {}, default: {} }));
vi.mock('./gmproService', () => ({ geocodeAddress: vi.fn(), getGoogleMapsApiKey: () => '' }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
vi.mock('firebase/firestore', async original => {
  const real = await original<any>();
  const ref = (path: string) => ({ path, id: path.split('/').slice(-1)[0] });
  const snapshot = (reference: { path: string; id: string }) => ({
    ...reference, ref: reference,
    exists: () => state.docs.has(reference.path),
    data: () => structuredClone(state.docs.get(reference.path)),
  });
  return {
    ...real,
    doc: (_db: unknown, collection: string, id: string) => ref(`${collection}/${id}`),
    getDoc: async (reference: any) => snapshot(reference),
    runTransaction: async (_db: unknown, action: (tx: any) => Promise<unknown>) => {
      state.beforeTransaction?.();
      const writes: { path: string; patch: any }[] = [];
      const result = await action({
        get: async (reference: any) => snapshot(reference),
        update: (reference: any, patch: any) => writes.push({ path: reference.path, patch }),
      });
      for (const write of writes) state.docs.set(write.path, { ...state.docs.get(write.path), ...write.patch });
      state.transactions.push(writes);
      return result;
    },
  };
});

import { optimizeDriverMission } from './missionService';
const stop = (id: string, lat: number, extra: Partial<MissionStop> = {}): MissionStop => ({
  id, sequence: Number(id.slice(1)) || 1, type: 'DELIVERY', status: StopStatus.PENDING,
  coordinates: { lat, lng: 55 }, address: `Rue ${id}`, city: 'Saint-Denis', postalCode: '97400', contactName: id,
  packageIds: [id], packageCount: 1, serviceTime: 5,
  estimatedArrival: '2026-09-10T04:30:00Z', estimatedDeparture: '2026-09-10T04:35:00Z',
  durationFromPrevious: 30, distanceFromPrevious: 10,
  ...extra,
});
const mission = () => state.docs.get('missions/m');
const run = () => optimizeDriverMission('m', { lat: -21, lng: 55 });

beforeEach(() => {
  state.docs.clear();
  state.transactions.length = 0;
  state.beforeTransaction = undefined;
  state.docs.set('missions/m', {
    status: MissionStatus.IN_PROGRESS, driverId: 'driver',
    totalDistance: 50, estimatedDuration: 120,
    stops: [stop('s1', -20), stop('s2', -20.9), stop('s3', -20.8)],
  });
  for (const id of ['s1', 's2', 's3', 's4']) state.docs.set(`packages/${id}`, {
    missionId: 'm', status: PackageStatus.IN_DELIVERY, estimatedDeliveryAt: '2026-09-10T04:30:00Z',
  });
});

describe('driver route reorder', () => {
  it('clears old predecessor metrics and parcel ETAs when changing the route order', async () => {
    await expect(run()).resolves.toBe(3);
    expect(mission().stops.map((item: any) => item.id)).toEqual(['s2', 's3', 's1']);
    for (const item of mission().stops) {
      expect(item).not.toHaveProperty('estimatedArrival');
      expect(item).not.toHaveProperty('estimatedDeparture');
      expect(item).not.toHaveProperty('durationFromPrevious');
      expect(item).not.toHaveProperty('distanceFromPrevious');
      expect(state.docs.get(`packages/${item.id}`).estimatedDeliveryAt).toBeNull();
    }
    expect(mission()).toMatchObject({ totalDistance: null, estimatedDuration: null });
  });

  it.each([{ timeWindowStart: '09:00' }, { timeWindowEnd: '10:00' }])('refuses local distance-only ordering when a customer window exists: %j', async window => {
    mission().stops[0] = { ...mission().stops[0], ...window };
    await expect(run()).rejects.toThrow('créneaux clients');
    expect(state.transactions).toEqual([]);
  });

  it('rechecks windows added while geocoding before writing anything', async () => {
    state.beforeTransaction = () => { mission().stops[0].timeWindowStart = '09:00'; };
    await expect(run()).rejects.toThrow('créneaux clients');
    expect(state.transactions).toEqual([]);
    expect(state.docs.get('packages/s1').estimatedDeliveryAt).not.toBeNull();
  });

  it('preserves an outcome committed meanwhile, including its proof and historical ETA', async () => {
    state.beforeTransaction = () => {
      mission().stops[0] = { ...mission().stops[0], status: StopStatus.COMPLETED, proofSyncPending: true, completionTime: '2026-09-10T04:35:00Z' };
      state.docs.get('packages/s1').status = PackageStatus.DELIVERED;
    };
    await expect(run()).resolves.toBe(2);
    expect(mission().stops[0]).toMatchObject({
      id: 's1', status: StopStatus.COMPLETED, proofSyncPending: true,
      completionTime: '2026-09-10T04:35:00Z', estimatedArrival: '2026-09-10T04:30:00Z',
    });
    expect(state.docs.get('packages/s1').estimatedDeliveryAt).toBe('2026-09-10T04:30:00Z');
    expect(state.transactions[0].filter(write => write.path.startsWith('packages/')).map(write => write.path).sort()).toEqual(['packages/s2', 'packages/s3']);
  });

  it('preserves stops added during geocoding and clears their now-unreliable ETA too', async () => {
    state.beforeTransaction = () => { mission().stops.push(stop('s4', -20.7)); };
    await expect(run()).resolves.toBe(4);
    expect(mission().stops.map((item: any) => item.id)).toEqual(['s2', 's3', 's1', 's4']);
    expect(state.docs.get('packages/s4').estimatedDeliveryAt).toBeNull();
  });

  it('rejects a parcel transferred out concurrently instead of changing its new mission ETA', async () => {
    state.beforeTransaction = () => { state.docs.get('packages/s2').missionId = 'other'; };
    await expect(run()).rejects.toThrow('affectation');
    expect(state.transactions).toEqual([]);
    expect(state.docs.get('packages/s2').estimatedDeliveryAt).not.toBeNull();
  });

  it('rejects a tour closed while the route was being calculated', async () => {
    state.beforeTransaction = () => { mission().status = MissionStatus.COMPLETED; };
    await expect(run()).rejects.toThrow('clôturée');
    expect(state.transactions).toEqual([]);
  });
});
