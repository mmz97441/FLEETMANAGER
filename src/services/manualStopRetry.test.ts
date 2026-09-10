import { beforeEach, expect, it, vi } from 'vitest';
import { MissionStatus } from '../types';
const state = vi.hoisted(() => ({ mission: {} as any, writes: 0 }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {} }));
vi.mock('./gmproService', () => ({ geocodeAddress: vi.fn(), getGoogleMapsApiKey: vi.fn() }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), onSnapshot: vi.fn(), writeBatch: vi.fn(), Timestamp: vi.fn(),
  runTransaction: async (_db: unknown, work: (tx: any) => Promise<any>) => work({
    get: async () => ({ id: 'm', exists: () => true, data: () => structuredClone(state.mission) }),
    update: (_ref: unknown, patch: any) => { state.mission = { ...state.mission, ...patch }; state.writes++; },
  }),
}));
import { addManualStopToMission } from './missionService';
const payload = { contactName: 'Recipient', address: '12 rue Test', city: 'Saint-Denis', postalCode: '97400', serviceTime: 5 };
const requestId = '47b10dc9-8536-4fe6-b8ad-21e11e67d14e';
beforeEach(() => { state.mission = { status: MissionStatus.DISPATCHED, stops: [] }; state.writes = 0; });
it('reuses the same stop after an ambiguous response instead of adding another one', async () => {
  await addManualStopToMission('m', payload, requestId);
  await addManualStopToMission('m', payload, requestId);
  expect(state.mission.stops).toHaveLength(1); expect(state.writes).toBe(1);
  expect(state.mission.stops[0].id).toBe('manual-'+requestId);
});
it('confirms an already committed request after closure, but refuses a new stop', async () => {
  await addManualStopToMission('m', payload, requestId);
  state.mission.status = MissionStatus.COMPLETED;
  await expect(addManualStopToMission('m', payload, requestId)).resolves.toBeUndefined();
  await expect(addManualStopToMission('m', payload, 'different-request')).rejects.toThrow('clôturée');
  expect(state.writes).toBe(1);
});
it('does not silently change an existing request when the retry payload differs', async () => {
  await addManualStopToMission('m', payload, requestId);
  await expect(addManualStopToMission('m', { ...payload, address: 'Different' }, requestId)).rejects.toThrow('autres informations');
  expect(state.mission.stops[0].address).toBe(payload.address); expect(state.writes).toBe(1);
});
