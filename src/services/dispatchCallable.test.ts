import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), callable: vi.fn() }));
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: mocks.callable.mockImplementation(() => mocks.invoke),
}));
vi.mock('../firebaseConfig', () => ({ default: {} }));
import { dispatchMissionsCF } from './cloudFunctions';

describe('atomic dispatch callable boundary', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.callable.mockClear(); });
  it('retains the retry token and omits absent optional fields at every depth', async () => {
    mocks.invoke.mockResolvedValue({ data: { missionIds: ['m'], packageCount: 1, replayed: false } });
    const payload = { requestId: 'stable-retry', missions: [{ driverId: 'driver', vehicleId: undefined,
      stops: [{ id: 'stop', estimatedArrival: undefined, coordinates: undefined, packageIds: ['p'] }] }] };
    const result = await dispatchMissionsCF(payload as unknown as Parameters<typeof dispatchMissionsCF>[0]);
    expect(mocks.callable).toHaveBeenCalledWith(expect.anything(), 'dispatchMissions');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith({ requestId: 'stable-retry', missions: [
      { driverId: 'driver', stops: [{ id: 'stop', packageIds: ['p'] }] },
    ] });
    expect(result.missionIds).toEqual(['m']);
  });
  it('propagates transaction conflicts instead of reporting partial success', async () => {
    const conflict = new Error('Le colis a déjà été affecté.');
    mocks.invoke.mockRejectedValue(conflict);
    await expect(dispatchMissionsCF({ requestId: 'same-request', missions: [] })).rejects.toBe(conflict);
  });
});
