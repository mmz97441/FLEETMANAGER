/**
 * Publie la position du chauffeur connecté ~toutes les 30s, tant qu'il est
 * connecté (tournée ou non) :
 *  - pour la carte dispatch interne (collection driverLocations) ;
 *  - ET, s'il a une tournée EN COURS, dénormalise sa position + le nombre de
 *    colis restants dans un document par client de la tournée (suivi live côté expéditeur).
 * Ne fait rien si l'utilisateur n'est pas un chauffeur. Silencieux si GPS refusé.
 */
import { useEffect, useRef } from 'react';
import { localDatePart } from '../utils/date';
import { User, Mission, MissionStatus } from '../types';
import { publishDriverLocation } from '../services/driverLocationService';
import { subscribeToMissions, publishLiveTrackingForMission } from '../services/missionService';

const INTERVAL_MS = 30000;

export function useDriverLocationPublisher(currentUser: User | null): void {
  const timerRef = useRef<number | null>(null);
  const activeMissionRef = useRef<Mission | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const role = String(currentUser.role || '').toLowerCase();
    const isDriver = role.includes('chauff') || role.includes('driver');
    if (!isDriver) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    let cancelled = false;
    let publishing = false;
    const driverName = `${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email;

    // Suit la tournée EN COURS du chauffeur (pour le suivi live côté client)
    const unsubMissions = subscribeToMissions(
      (missions) => {
        activeMissionRef.current =
          missions.find(m => m.status === MissionStatus.IN_PROGRESS && m.date === localDatePart(new Date().toISOString())) || null;
      },
      { driverId: currentUser.id }
    );

    const push = () => {
      if (publishing || !navigator.onLine || document.visibilityState === 'hidden') return;
      publishing = true;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) {publishing = false; return;}
          const c = pos.coords;
          const lat = c.latitude;
          const lng = c.longitude;

          // 1) position pour la carte dispatch interne
          await publishDriverLocation({
            driverId: currentUser.id,
            driverName,
            lat,
            lng,
            accuracy: c.accuracy != null && !Number.isNaN(c.accuracy) ? c.accuracy : undefined,
            heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : undefined,
            speed: c.speed != null && !Number.isNaN(c.speed) ? c.speed : undefined,
          }).catch(() => { /* écriture non bloquante */ });

          // 2) un document de suivi par client, sans réécrire les colis
          const mission = activeMissionRef.current;
          if (mission) {
            await publishLiveTrackingForMission(mission, { lat, lng }, driverName)
              .catch(() => { /* non bloquant */ });
          }
          publishing = false;
        },
        () => { publishing = false; },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }
      );
    };

    push(); // premier envoi immédiat
    timerRef.current = window.setInterval(push, INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      unsubMissions();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);
}
