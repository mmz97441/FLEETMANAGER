/**
 * Détecte automatiquement qu'une nouvelle version de l'app est en ligne et
 * recharge la page — pour que les chauffeurs (onglet ouvert toute la journée)
 * ne restent jamais bloqués sur une ancienne version (scanner, correctifs…).
 *
 * Compare le BUILD_ID embarqué au moment du build avec /version.json (servi
 * frais). Vérifie au démarrage, quand l'onglet redevient visible, au retour
 * réseau, et périodiquement.
 */
import { useEffect, useRef } from 'react';

const POLL_MS = 5 * 60 * 1000; // 5 min

export function useAutoUpdate(): void {
  const reloadingRef = useRef(false);

  useEffect(() => {
    let timer: number | null = null;

    const check = async () => {
      if (reloadingRef.current) return;
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const latest = data?.buildId;
        if (typeof latest === 'string' && latest && latest !== __BUILD_ID__) {
          reloadingRef.current = true;
          window.location.reload();
        }
      } catch {
        /* réseau indisponible → on retentera au prochain déclencheur */
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    check(); // au démarrage
    timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);

    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, []);
}
