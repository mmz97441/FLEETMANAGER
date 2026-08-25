/**
 * POINT DE LIVRAISON — source de vérité UNIQUE
 *
 * « Deux colis vont-ils au même endroit ? » est une règle métier critique
 * (elle sécurise le nombre exact de colis à déposer chez le client). Elle doit
 * être définie ICI, une seule fois, et importée partout : dispatch (gmproService),
 * transfert en route (missionService), import client (importService) et filet de
 * sécurité chauffeur (DriverMissionView).
 *
 * ⚠️ Ne JAMAIS réécrire une variante locale de ces fonctions. Toute duplication
 * finit par diverger (cf. bug Boiron v4.2.1 : une copie non normalisée du
 * dispatch splittait 4 colis d'une même adresse en 4 arrêts). Si la règle doit
 * changer, elle change ICI et nulle part ailleurs.
 *
 * Règle : on regroupe par ADRESSE + CP + VILLE (normalisés), avec un renfort
 * TÉLÉPHONE (même tél + même CP = même client, rattrape les fautes de frappe).
 * JAMAIS par n° de commande ni par nom de contact (trop variables entre imports).
 */

/** Champs minimaux nécessaires pour situer un point de livraison. */
export interface PlaceLike {
  address?: string;
  postalCode?: string;
  city?: string;
  contactPhone?: string;
}

/**
 * Normalise un libellé d'adresse pour comparer deux écritures « à l'œil »
 * identiques : minuscules, accents retirés, ponctuation/espaces multiples
 * réduits à un seul espace. Ex. "28  RUE JOSEPH BÉDIER " → "28 rue joseph bedier".
 */
export const normAddr = (s?: string): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9]+/g, ' ')                      // ponctuation → espace
    .trim();

/** Téléphone → chiffres uniquement (retire espaces, +, points, tirets…). */
export const normPhone = (s?: string): string => (s || '').replace(/\D/g, '');

/**
 * Clé de regroupement d'un point de livraison : adresse + CP + ville normalisés.
 * Deux colis avec la même clé = même arrêt. JAMAIS le nom ni le n° de commande.
 */
export const placeKey = (p: PlaceLike): string =>
  `${normAddr(p.address)}|${(p.postalCode || '').trim()}|${normAddr(p.city)}`;

/** Téléphone exploitable comme signal de regroupement (≥ 6 chiffres), sinon ''. */
export const phoneSignal = (p: PlaceLike): string => {
  const s = normPhone(p.contactPhone);
  return s.length >= 6 ? s : '';
};

/**
 * Deux points = même livraison ? Adresse identique OU (même téléphone + même CP).
 * Le repli téléphone rattrape les adresses mal saisies pour un même client.
 */
export const sameDeliveryPoint = (a: PlaceLike, b: PlaceLike): boolean => {
  if (placeKey(a) === placeKey(b)) return true;
  const pa = phoneSignal(a), pb = phoneSignal(b);
  return !!pa && pa === pb && (a.postalCode || '').trim() === (b.postalCode || '').trim();
};
