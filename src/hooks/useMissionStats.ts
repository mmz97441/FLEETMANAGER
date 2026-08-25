/**
 * HOOK : useMissionStats
 * 
 * Fournit les statistiques missions en temps réel pour le Dashboard.
 * S'abonne aux missions et colis du jour pour calculer les KPIs opérationnels.
 */

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { todayISO, localDatePart } from '../utils/date';
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

export const useMissionStats = (date?: string): MissionDayStats => {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);

  const today = date || todayISO();

  // Abonnement missions du jour
  useEffect(() => {
    const q = query(
      collection(db, 'missions'),
      where('date', '==', today),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mission));
      setMissions(data);
      setLoading(false);
    }, (err) => {
      console.error('useMissionStats missions error:', err);
      setLoading(false);
    });

    return unsub;
  }, [today]);

  // Abonnement colis (les 500 plus récents, filtrés côté client)
  useEffect(() => {
    const q = query(
      collection(db, 'packages'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Package));
      setPackages(data);
    }, (err) => {
      console.error('useMissionStats packages error:', err);
    });

    return unsub;
  }, []);

  // Calcul des stats
  const stats = computeStats(missions, packages, today, loading);

  return stats;
};

// === Calculs ===

function computeStats(
  missions: Mission[], 
  allPackages: Package[], 
  today: string,
  loading: boolean
): MissionDayStats {
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
