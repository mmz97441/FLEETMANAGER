/**
 * Publie la position du chauffeur connecté ~toutes les 30s, tant qu'il est
 * connecté (tournée ou non) :
 *  - pour la carte dispatch interne (collection driverLocations) ;
 *  - ET, s'il a une tournée EN COURS, dénormalise sa position + le nombre de
 *    colis restants sur CHAQUE colis de la tournée (suivi live côté expéditeur).
 * Ne fait rien si l'utilisateur n'est pas un chauffeur. Silencieux si GPS refusé.
 */
import { useEffect, useRef } from 'react';
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
    const driverName = `${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email;

    // Suit la tournée EN COURS du chauffeur (pour le suivi live côté client)
    const unsubMissions = subscribeToMissions(
      (missions) => {
        activeMissionRef.current =
          missions.find(m => m.status === MissionStatus.IN_PROGRESS) || null;
      },
      { driverId: currentUser.id }
    );

    const push = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const c = pos.coords;
          const lat = c.latitude;
          const lng = c.longitude;

          // 1) position pour la carte dispatch interne
          publishDriverLocation({
            driverId: currentUser.id,
            driverName,
            lat,
            lng,
            accuracy: c.accuracy != null && !Number.isNaN(c.accuracy) ? c.accuracy : undefined,
            heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : undefined,
            speed: c.speed != null && !Number.isNaN(c.speed) ? c.speed : undefined,
          }).catch(() => { /* écriture non bloquante */ });

          // 2) suivi live dénormalisé sur les colis de la tournée en cours
          const mission = activeMissionRef.current;
          if (mission) {
            publishLiveTrackingForMission(mission, { lat, lng }, driverName)
              .catch(() => { /* non bloquant */ });
          }
        },
        () => { /* permission refusée / GPS coupé → on retentera au prochain tick */ },
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
