/**
 * FORMATAGE — source de vérité UNIQUE (nombres, €, poids, distance, durée)
 *
 * Avant : `formatCurrency`/`formatNumber` écrits dans validation.ts mais JAMAIS
 * importés (code mort), et ~30 sites en `.toFixed(2)+' €'` (point, sans
 * séparateur de milliers) OU `.toLocaleString('fr-FR')+' €'` (virgule + espaces)
 * → 3 rendus différents du même euro. On fige une convention fr-FR ici.
 *
 * Convention € : Intl EUR fr-FR → « 12 345,60 € » (espace milliers, virgule
 * décimale, symbole après). Nombre : « 12 345 ». kg/km : 1 décimale, virgule.
 */

/** Nombre au format français : « 12 345 » (séparateur de milliers). */
export const formatNumberFr = (n: number, maximumFractionDigits = 0): string =>
  (Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { maximumFractionDigits });

/** Montant en euros : « 12 345,60 € » (2 décimales par défaut). */
export const formatEuro = (amount: number, fractionDigits = 2): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(amount) ? amount : 0);

/** Poids : « 12,5 kg » (1 décimale, sans zéro inutile). '' si absent. */
export const formatWeight = (kg?: number | null): string =>
  kg == null || !Number.isFinite(kg) ? '' : `${(+kg).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;

/** Distance : « 12,3 km » (1 décimale). */
export const formatDistance = (km?: number | null): string =>
  km == null || !Number.isFinite(km) ? '' : `${(+km).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

/** Durée en minutes → « 45 min » ou « 1 h 30 » / « 2 h ». */
export const formatDuration = (minutes?: number | null): string => {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${String(rem).padStart(2, '0')}`;
};
