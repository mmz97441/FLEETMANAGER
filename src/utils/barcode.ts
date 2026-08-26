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
  clientReference?: string;
}

/**
 * Codes servant à VALIDER un colis à la livraison : uniquement le code DELIVREX
 * DISTINCT par colis (barcode / externalId / orderNumber, ex. BR1018).
 * On N'INCLUT PAS clientReference (= le n° de commande du client, PARTAGÉ entre
 * tous les colis d'une commande) : sinon scanner ce code partagé validerait
 * plusieurs colis d'un coup et bloquerait le 2e en « déjà scanné ».
 *
 * POLITIQUE (asymétrie VOULUE, ne pas « corriger ») : la RECHERCHE d'un colis en
 * base (findPackageByCode / findDispatchedPackageByCode dans missionService)
 * inclut, elle, clientReference en DERNIER recours — c'est de l'IDENTIFICATION
 * (retrouver le colis pour l'afficher/prendre en charge), pas de la VALIDATION.
 * Identifier par n° de commande est acceptable ; valider une livraison dessus ne
 * l'est pas. Ces deux couches ne doivent donc PAS être « unifiées » sur ce point.
 */
export const packageScanCodes = (pkg: ScannableCodes): string[] =>
  [pkg.barcode, pkg.externalId, pkg.orderNumber]
    .filter((c): c is string => !!c && c.trim() !== '')
    .map(c => c.trim().toUpperCase());

/**
 * Extrait les identifiants candidats d'un code scanné. Le DataMatrix DELIVREX
 * peut encoder une chaîne enrichie : on en isole le code colis à préfixe client
 * (BR1018, AUT0451, AUR…) — préfixe GÉNÉRIQUE, non codé en dur — et les suites
 * de chiffres (fallback), en retirant un éventuel rang final (…003).
 */
export const extractScanTokens = (raw: string): string[] => {
  const s = raw.trim().toUpperCase();
  const tokens = new Set<string>();
  if (s) tokens.add(s);
  // Code colis DELIVREX : 2 à 5 lettres (préfixe client) suivies de chiffres.
  for (const m of s.match(/[A-Z]{2,5}\d{2,}/g) || []) tokens.add(m);
  for (const d of s.match(/\d{6,}/g) || []) {   // suites de ≥6 chiffres (fallback)
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
