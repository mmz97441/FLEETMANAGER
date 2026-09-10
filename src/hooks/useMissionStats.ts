/**
 * HOOK : useMissionStats
 * 
 * Fournit les statistiques missions en temps réel pour le Dashboard.
 * S'abonne aux missions et colis du jour pour calculer les KPIs opérationnels.
 */

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { todayISO, localDatePart } from '../utils/date';
import { buildOperationalQueue, OperationalTask } from '../utils/operationalQueue';
import { Mission, MissionStatus, Package, PackageStatus, Zone } from '../types';

// === Types ===

export interface MissionDayStats {
  // Missions
  totalMissions: number;
  missionsInProgress: number;
  missionsCompleted: number;
  missionsDispatched: number;
  missionsDraft: number;

  // Colis
  totalPackages: number;
  deliveredPackages: number;
  failedPackages: number;
  inDeliveryPackages: number;
  pendingPackages: number;

  // Taux
  deliveryRate: number; // % livrés / total assignés
  failureRate: number;  // % échoués / total traités

  // Par zone
  zoneStats: ZoneStat[];

  // Missions actives (pour le widget)
  activeMissions: ActiveMission[];

  // Loading
  loading: boolean;
  error: string | null;
  tasks: OperationalTask[];
  retry: () => void;
  packagesAvailable: boolean;
}

export interface ZoneStat {
  zone: Zone;
  totalPackages: number;
  delivered: number;
  failed: number;
  inProgress: number;
  rate: number;
}

export interface ActiveMission {
  id: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  zone: Zone;
  status: MissionStatus;
  totalStops: number;
  completedStops: number;
  deliveredPackages: number;
  totalPackages: number;
  progress: number; // 0-100
}

// === Hook ===

interface MissionStatsOptions { enabled?: boolean; driverId?: string; includePackages?: boolean }

export const useMissionStats = (date?: string, { enabled = true, driverId, includePackages = true }: MissionStatsOptions = {}): MissionDayStats => {
  const today = date || todayISO();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [missionsReady, setMissionsReady] = useState(false);
  const [packagesReady, setPackagesReady] = useState(false);
  const [missionError, setMissionError] = useState<string | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const missionKey = JSON.stringify(missions.map(mission => mission.id).sort());

  useEffect(() => {
    setMissions([]); setMissionsReady(false); setMissionError(null);
    if (!enabled) return;
    // All missions in the authorized day/scope: no arbitrary cap hiding an urgent task.
    const constraints = [where('date', '==', today)];
    if (driverId) constraints.push(where('driverId', '==', driverId));
    return onSnapshot(query(collection(db, 'missions'), ...constraints), snapshot => {
      setMissions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mission)));
      setMissionsReady(true); setMissionError(null);
    }, () => { setMissionError('Les tournées ne peuvent pas être chargées. Vérifiez la connexion et vos droits, puis réessayez.'); setMissionsReady(true); });
  }, [today, enabled, driverId, revision]);

  useEffect(() => {
    setPackages([]); setPackagesReady(false); setPackageError(null);
    if (!enabled || !missionsReady || missionError) return;
    if (!includePackages) { setPackagesReady(true); return; }
    const ids: string[] = JSON.parse(missionKey);
    if (!ids.length) { setPackagesReady(true); return; }
    // Query packages by their actual mission, including parcels imported long ago.
    // Groups of ten keep each Firestore `in` query bounded without truncating records.
    const groups: string[][] = [];
    for (let index = 0; index < ids.length; index += 10) groups.push(ids.slice(index, index + 10));
    const snapshots = new Map<number, Package[]>();
    const failed = new Set<number>();
    return (() => {
      const unsubscribers = groups.map((group, index) => onSnapshot(query(collection(db, 'packages'), where('missionId', 'in', group)), snapshot => {
        snapshots.set(index, snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Package)));
        failed.delete(index);
        setPackages([...new Map([...snapshots.values()].flat().map(pkg => [pkg.id, pkg])).values()]);
        setPackagesReady(groups.every((_, groupIndex) => snapshots.has(groupIndex) || failed.has(groupIndex)));
        setPackageError(failed.size ? 'Certains colis ne peuvent pas être chargés. Les indicateurs de livraison sont indisponibles.' : null);
      }, () => { failed.add(index); setPackagesReady(groups.every((_, groupIndex) => snapshots.has(groupIndex) || failed.has(groupIndex))); setPackageError('Les colis ne peuvent pas être chargés. Les indicateurs de livraison sont indisponibles.'); }));
      return () => unsubscribers.forEach(unsubscribe => unsubscribe());
    })();
  }, [enabled, includePackages, missionKey, missionsReady, missionError, revision]);

  const loading = enabled && (!missionsReady || (!missionError && !packagesReady));
  return {
    ...computeStats(missions, packages, today, loading),
    error: missionError || packageError,
    tasks: !missionError && missionsReady ? buildOperationalQueue(missions) : [],
    retry: () => setRevision(value => value + 1),
    packagesAvailable: includePackages,
  };
};

// === Calculs ===

function computeStats(
  missions: Mission[], 
  allPackages: Package[], 
  today: string,
  loading: boolean
): Omit<MissionDayStats, 'error' | 'tasks' | 'retry' | 'packagesAvailable'> {
  // Filtrer les colis qui ont un missionId dans les missions du jour
  const missionIds = new Set(missions.map(m => m.id));
  const todayPackages = allPackages.filter(p => 
    (p.missionId && missionIds.has(p.missionId)) ||
    localDatePart(p.createdAt || '') === today
  );

  // Stats missions
  const missionsInProgress = missions.filter(m => m.status === MissionStatus.IN_PROGRESS).length;
  const missionsCompleted = missions.filter(m => m.status === MissionStatus.COMPLETED).length;
  const missionsDispatched = missions.filter(m => m.status === MissionStatus.DISPATCHED).length;
  const missionsDraft = missions.filter(m => m.status === MissionStatus.DRAFT || m.status === MissionStatus.OPTIMIZED).length;

  // Stats colis
  const deliveredPackages = todayPackages.filter(p => p.status === PackageStatus.DELIVERED).length;
  const failedPackages = todayPackages.filter(p => p.status === PackageStatus.FAILED).length;
  const inDeliveryPackages = todayPackages.filter(p => p.status === PackageStatus.IN_DELIVERY).length;
  const pendingPackages = todayPackages.filter(p => 
    [PackageStatus.PENDING, PackageStatus.AT_HUB, PackageStatus.SORTED, PackageStatus.LOADED].includes(p.status)
  ).length;

  // Taux
  const totalProcessed = deliveredPackages + failedPackages;
  const deliveryRate = todayPackages.length > 0 ? (deliveredPackages / todayPackages.length) * 100 : 0;
  const failureRate = totalProcessed > 0 ? (failedPackages / totalProcessed) * 100 : 0;

  // Par zone
  const zones = [...new Set(missions.map(m => m.zone).filter(Boolean))] as Zone[];
  const zoneStats: ZoneStat[] = zones.map(zone => {
    const zoneMissions = missions.filter(m => m.zone === zone);
    const zoneMissionIds = new Set(zoneMissions.map(m => m.id));
    const zonePackages = todayPackages.filter(p => p.missionId && zoneMissionIds.has(p.missionId));
    const delivered = zonePackages.filter(p => p.status === PackageStatus.DELIVERED).length;
    const failed = zonePackages.filter(p => p.status === PackageStatus.FAILED).length;
    const inProgress = zonePackages.filter(p => p.status === PackageStatus.IN_DELIVERY).length;

    return {
      zone,
      totalPackages: zonePackages.length,
      delivered,
      failed,
      inProgress,
      rate: zonePackages.length > 0 ? (delivered / zonePackages.length) * 100 : 0
    };
  });

  // Missions actives (pour le widget live)
  const activeMissions: ActiveMission[] = missions
    .filter(m => m.status === MissionStatus.IN_PROGRESS || m.status === MissionStatus.DISPATCHED)
    .map(m => {
      const totalStops = m.stops?.length || 0;
      const completedStops = m.completedStops || 0;
      const delivered = m.deliveredPackages || 0;
      const total = m.totalPackages || 0;
      const progress = totalStops > 0 ? (completedStops / totalStops) * 100 : 0;

      return {
        id: m.id,
        driverId: m.driverId || '',
        driverName: m.driverName || 'Non assigné',
        vehiclePlate: m.vehiclePlate || '-',
        zone: m.zone,
        status: m.status,
        totalStops,
        completedStops,
        deliveredPackages: delivered,
        totalPackages: total,
        progress
      };
    })
    .sort((a, b) => b.progress - a.progress);

  return {
    totalMissions: missions.length,
    missionsInProgress,
    missionsCompleted,
    missionsDispatched,
    missionsDraft,
    totalPackages: todayPackages.length,
    deliveredPackages,
    failedPackages,
    inDeliveryPackages,
    pendingPackages,
    deliveryRate,
    failureRate,
    zoneStats,
    activeMissions,
    loading
  };
}

export default useMissionStats;
