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
