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

/** Le code scanné correspond-il à ce colis (tracking interne, N° colis client ou N° commande) ? */
export const packageMatchesCode = (pkg: ScannableCodes, scannedCode: string): boolean =>
  packageScanCodes(pkg).includes(scannedCode.trim().toUpperCase());

/** Le code affiché au chauffeur : celui de l'étiquette physique en priorité. */
export const packageDisplayCode = (pkg: ScannableCodes): string =>
  pkg.externalId || pkg.barcode || pkg.orderNumber || '';
