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

import { matchesParcelScanCode, parcelDisplayCode } from '../../functions/src/scanCode';
export { extractScanTokens, orderReferenceHint, orderReferenceMessage } from '../../functions/src/scanCode';

/** A decoded label needs an individual carton code; this is not a network error. */
export class ScanIdentificationError extends Error {
  name = 'ScanIdentificationError';
}

export interface ScannableCodes {
  carrierBarcode?: string;
  barcode?: string;
  externalId?: string;
  orderNumber?: string;
  clientReference?: string;
}

/** Individual sender/carrier/internal identifiers. A shared clientReference is
 * only an order lookup hint and never confirms a carton. The server checks
 * uniqueness across senders before accepting any of these codes. */
export const packageScanCodes = (pkg: ScannableCodes): string[] =>
  [pkg.carrierBarcode, pkg.barcode, pkg.externalId, pkg.orderNumber]
    .filter((c): c is string => !!c && c.trim() !== '')
    .map(c => c.trim().toUpperCase());

/** Match complete individual identifiers using the same parser as the server. */
export const packageMatchesCode = (pkg: ScannableCodes, code: string): boolean => matchesParcelScanCode(pkg, code);

/** The sender's individual reference, with legacy and internal label fallbacks. */
export const packageDisplayCode = parcelDisplayCode;

/**
 * Assigne chaque code scanné à AU PLUS UN colis (glouton, 1:1), et renvoie
 * l'ensemble des IDs de colis effectivement couverts par un scan DISTINCT.
 *
 * Pourquoi : compter « les colis dont un code matche » sur-compte quand plusieurs
 * colis partagent un identifiant (ex. N° de commande présent dans `orderNumber` de
 * plusieurs cartons — cas réel des anciens imports) : un seul scan validerait tout
 * l'arrêt. Avec l'assignation 1:1, un scan = un colis au plus, donc le chauffeur
 * doit voir chaque carton. On ne peut PAS simplement exclure `orderNumber` du
 * matching : pour certains colis c'est leur SEUL code.
 */
export const matchScansToPackages = <T extends { id: string } & ScannableCodes>(
  packages: T[],
  scannedCodes: string[]
): Set<string> => {
  // Codes distincts (un même code physique scanné 2× = 1 seule entrée).
  const codes = [...new Set(
    scannedCodes.map(c => (c || '').trim().toUpperCase()).filter(Boolean)
  )];

  // Matching BIPARTITE MAXIMUM (algorithme de Kuhn / chemins augmentants) entre
  // les codes scannés et les colis : un code ↔ un colis, en MAXIMISANT le nombre
  // de colis couverts. Un simple glouton pouvait sous-compter (ex. un code partagé
  // assigné à un colis qui avait AUSSI un code distinct, privant un autre colis
  // dont c'était le seul code). Le matching maximum évite ce faux « manquant ».
  const adj: number[][] = codes.map(code =>
    packages.map((_, i) => i).filter(i => packageMatchesCode(packages[i], code))
  );
  const pkgToCode = new Array(packages.length).fill(-1);
  const augment = (codeIdx: number, visited: boolean[]): boolean => {
    for (const pkgIdx of adj[codeIdx]) {
      if (visited[pkgIdx]) continue;
      visited[pkgIdx] = true;
      if (pkgToCode[pkgIdx] === -1 || augment(pkgToCode[pkgIdx], visited)) {
        pkgToCode[pkgIdx] = codeIdx;
        return true;
      }
    }
    return false;
  };
  for (let c = 0; c < codes.length; c++) {
    augment(c, new Array(packages.length).fill(false));
  }

  const matched = new Set<string>();
  packages.forEach((p, i) => { if (pkgToCode[i] !== -1) matched.add(p.id); });
  return matched;
};
