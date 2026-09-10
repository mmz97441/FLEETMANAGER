import { Mission, MissionStatus, StopStatus } from '../types';

export interface OperationalTask {
  id: string;
  priority: 'urgent' | 'action';
  label: string;
  detail: string;
  missionId: string;
  date: string;
}

/** Tasks come from authoritative mission state, never from a guessed missing POD. */
export function buildOperationalQueue(missions: Mission[]): OperationalTask[] {
  const tasks: OperationalTask[] = [];
  for (const mission of missions) {
    if (mission.status === MissionStatus.CANCELLED) continue;
    const detail = `${mission.zone || 'Zone non précisée'} · ${mission.driverName || 'Sans chauffeur'}`;
    const push = (kind: string, priority: OperationalTask['priority'], label: string) => tasks.push({
      id: `${mission.id}:${kind}`, priority, label, detail, missionId: mission.id, date: mission.date,
    });
    const pendingProofs = (mission.stops || []).filter(stop => stop.proofSyncPending).length;
    if (pendingProofs) push('proof', 'urgent', `${pendingProofs} preuve(s) en attente de synchronisation`);
    if (mission.status === MissionStatus.COMPLETED) continue;
    const failed = (mission.stops || []).filter(stop => stop.status === StopStatus.FAILED).length;
    if (failed) push('failed', 'urgent', `${failed} arrêt(s) en difficulté`);
    if (!mission.driverId) push('unassigned', 'action', 'Tournée sans chauffeur affecté');
    else if ([MissionStatus.DRAFT, MissionStatus.OPTIMIZED].includes(mission.status)) push('dispatch', 'action', 'Tournée à transmettre au chauffeur');
  }
  return tasks.sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || a.id.localeCompare(b.id));
}
