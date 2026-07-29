/**
 * CORRESPONDANCE CODES-BARRES
 *
 * Un colis physique peut porter plusieurs codes scannables :
 * - le tracking interne FleetGenius (barcode, ex: GFL-260716-XXXXXXXXXX) si ré-étiqueté
 * - le N° colis du client (externalId, ex: BR0513) — l'étiquette d'origine sur le carton
 * - le N° de commande (orderNumber) en dernier recours
 *
 * Le scan doit reconnaître n'importe lequel de ces codes, sinon les chauffeurs
 * sont obligés de ré-étiqueter chaque carton au dépôt.
 */

export interface ScannableCodes {
  barcode?: string;
  externalId?: string;
  orderNumber?: string;
}

/** Tous les codes scannables d'un colis, normalisés en majuscules. */
export const packageScanCodes = (pkg: ScannableCodes): string[] =>
  [pkg.barcode, pkg.externalId, pkg.orderNumber]
    .filter((c): c is string => !!c && c.trim() !== '')
    .map(c => c.trim().toUpperCase());

/**
 * Extrait les identifiants candidats d'un code scanné. Les étiquettes 2D
 * (DataMatrix BOIRON) encodent parfois une chaîne enrichie : on en isole le
 * N° colis (BR1018), les suites de chiffres (N° commande 13937412) et la
 * version sans suffixe de rang ("13937412003" → "13937412").
 */
export const extractScanTokens = (raw: string): string[] => {
  const s = raw.trim().toUpperCase();
  const tokens = new Set<string>();
  if (s) tokens.add(s);
  const br = s.match(/BR\d{3,}/);          // N° colis client (externalId)
  if (br) tokens.add(br[0]);
  for (const d of s.match(/\d{6,}/g) || []) {   // suites de ≥6 chiffres (N° commande)
    tokens.add(d);
    if (d.length > 8) tokens.add(d.slice(0, d.length - 3)); // retire le rang (…003)
  }
  return [...tokens];
};

/**
 * Le code scanné correspond-il à ce colis ? Vrai si :
 * - correspondance exacte (tracking GFL, N° colis BR…, N° commande), ou
 * - le payload 2D scanné contient l'identifiant unique du colis (BR… ou GFL…).
 * On n'étend pas la correspondance « contient » au N° de commande (partagé
 * entre colis d'un même envoi) pour éviter de valider plusieurs colis d'un coup.
 */
export const packageMatchesCode = (pkg: ScannableCodes, scannedCode: string): boolean => {
  const scanned = scannedCode.trim().toUpperCase();
  if (!scanned) return false;
  const codes = packageScanCodes(pkg);
  if (codes.length === 0) return false;
  // Correspondance sur un des identifiants extraits (BR…, N° commande, sans rang)
  if (extractScanTokens(scanned).some(t => codes.includes(t))) return true;
  // Payload 2D enrichi contenant un identifiant UNIQUE du colis (BR… / GFL…)
  for (const unique of [pkg.externalId, pkg.barcode]) {
    const c = unique?.trim().toUpperCase();
    if (c && c.length >= 4 && scanned.includes(c)) return true;
  }
  return false;
};

/** Le code affiché au chauffeur : celui de l'étiquette physique en priorité. */
export const packageDisplayCode = (pkg: ScannableCodes): string =>
  pkg.externalId || pkg.barcode || pkg.orderNumber || '';
