/**
 * GÉO — source de vérité UNIQUE (distances + géolocalisation)
 *
 * Avant : `haversine*` défini 2× (gmproService + missionService) et
 * `getCurrentPosition` promisifié ~7× avec des timeouts/options hétérogènes,
 * alors que la politique GPS est stricte (livraison/départ). Centralisé ici.
 */

export interface LatLng { lat: number; lng: number }

/** Distance en KILOMÈTRES entre deux points (formule de haversine, R=6371 km). */
export const haversineKm = (a: LatLng, b: LatLng): number => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/**
 * Position GPS courante, promisifiée, en { lat, lng }.
 * Options par défaut adaptées à la politique GPS stricte : haute précision,
 * timeout 10 s, pas de cache (position fraîche). Un appelant peut surcharger.
 */
export const getCurrentPosition = (
  options: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
): Promise<LatLng> =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('GPS non supporté'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      options
    );
  });

/**
 * Position GPS ROBUSTE pour le déverrouillage chauffeur.
 *
 * Cause terrain de « GPS activé mais l'app ne le reconnaît pas » : la HAUTE
 * PRÉCISION (GPS satellite) peut mettre >15 s à accrocher un 1er point (démarrage
 * à froid, en voiture, ville dense, Android bas de gamme) → TIMEOUT classé à tort
 * « GPS coupé ». Ici on tente d'abord la haute précision (court), puis on REPLIE
 * automatiquement sur la BASSE précision (position réseau/cellulaire, quasi
 * instantanée) avec un cache plus large. On ne rejette qu'après les deux essais —
 * sauf refus explicite de permission, propagé immédiatement (inutile de réessayer).
 */
export const getPositionRobust = async (): Promise<LatLng> => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('GPS non supporté');
  }
  try {
    // 1er essai : précis mais borné dans le temps.
    return await getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  } catch (err: any) {
    // Permission refusée = inutile de retenter (même verdict en basse précision).
    if (err && typeof err.code === 'number' && err.code === 1 /* PERMISSION_DENIED */) {
      throw err;
    }
    // Repli : basse précision, timeout large, cache jusqu'à 5 min → accroche presque
    // toujours dès que la localisation OS est réellement active.
    return await getCurrentPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 });
  }
};

/**
 * Détecte un navigateur INTÉGRÉ (in-app webview : WhatsApp, Facebook, Instagram,
 * Gmail, etc.) où la géolocalisation est souvent bloquée. Sert à conseiller au
 * chauffeur d'ouvrir dans Chrome/Safari plutôt que de le laisser tourner en rond.
 */
export const isInAppBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|WeChat|MicroMessenger|GSA\/|FB_IAB|Snapchat|Twitter/i.test(ua);
};
