import { describe, expect, it } from 'vitest';
import { Mission, MissionStatus, StopStatus } from '../types';
import { buildOperationalQueue } from './operationalQueue';
import { missionStatusLabel, packageStatusLabel } from './operationalLabels';

const mission = (patch: Partial<Mission> = {}) => ({ id: 'tour-1', date: '2026-09-10', status: MissionStatus.DRAFT, stops: [], zone: 'NORD', ...patch } as Mission);

describe('operational priorities', () => {
  it('puts explicit proof and delivery problems before assignment tasks', () => {
    const rows = buildOperationalQueue([mission(), mission({ id: 'tour-2', driverId: 'driver', status: MissionStatus.IN_PROGRESS, stops: [{ id: 'stop', status: StopStatus.FAILED, proofSyncPending: true } as never] })]);
    expect(rows.map(row => row.priority)).toEqual(['urgent', 'urgent', 'action']);
    expect(rows.every(row => row.date === '2026-09-10' && row.missionId)).toBe(true);
  });
  it('does not infer missing proofs or reopen completed/cancelled work', () => {
    expect(buildOperationalQueue([mission({ status: MissionStatus.COMPLETED }), mission({ id: 'cancelled', status: MissionStatus.CANCELLED, stops: [{ proofSyncPending: true } as never] })])).toEqual([]);
  });
  it('retains an explicitly pending proof even on a completed mission', () => {
    expect(buildOperationalQueue([mission({ status: MissionStatus.COMPLETED, stops: [{ proofSyncPending: true } as never] })])).toMatchObject([{ id: 'tour-1:proof', priority: 'urgent' }]);
  });
  it('distinguishes unassigned, ready to dispatch and already assigned', () => {
    expect(buildOperationalQueue([mission()])[0].id).toBe('tour-1:unassigned');
    expect(buildOperationalQueue([mission({ driverId: 'driver' })])[0].id).toBe('tour-1:dispatch');
    expect(buildOperationalQueue([mission({ driverId: 'driver', status: MissionStatus.DISPATCHED })])).toEqual([]);
  });
  it('keeps persisted values while explaining assignment and physical return', () => {
    expect(MissionStatus.DISPATCHED).toBe('Dispatché');
    expect(missionStatusLabel(MissionStatus.DISPATCHED)).toBe('Affectée au chauffeur');
    expect(packageStatusLabel('À retourner')).toBe('Retour à remettre');
    expect(packageStatusLabel('Retourné')).toBe('Retour reçu');
  });
});
