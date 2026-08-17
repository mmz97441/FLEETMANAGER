/**
 * Publie la position du chauffeur connecté ~toutes les 30s, tant qu'il est
 * connecté (tournée ou non), pour l'afficher sur la carte dispatch.
 * - Ne fait rien si l'utilisateur n'est pas un chauffeur.
 * - Silencieux si la permission GPS est refusée (réessaie au tick suivant).
 */
import { useEffect, useRef } from 'react';
import { User } from '../types';
import { publishDriverLocation } from '../services/driverLocationService';

const INTERVAL_MS = 30000;

export function useDriverLocationPublisher(currentUser: User | null): void {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const role = String(currentUser.role || '').toLowerCase();
    const isDriver = role.includes('chauff') || role.includes('driver');
    if (!isDriver) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    let cancelled = false;

    const push = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          const c = pos.coords;
          publishDriverLocation({
            driverId: currentUser.id,
            driverName: `${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email,
            lat: c.latitude,
            lng: c.longitude,
            accuracy: c.accuracy != null && !Number.isNaN(c.accuracy) ? c.accuracy : undefined,
            heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : undefined,
            speed: c.speed != null && !Number.isNaN(c.speed) ? c.speed : undefined,
          }).catch(() => { /* écriture non bloquante */ });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);
}
