/**
 * SERVICE D'IMPORT EXCEL
 * 
 * Parse les fichiers Excel des clients et crée les colis
 */

import * as XLSX from 'xlsx';
import {
  Package, PackageStatus, Zone, ImportBatch, ImportBatchStatus,
  ImportBatchError, ImportBatchZoneBreakdown, PackageMovement, User
} from '../types';
import {
  getZoneFromPostalCode,
  extractPostalCodeFromAddress,
  addPackagesBatch,
  addImportBatch,
  getHubByZone
} from './missionService';

/**
 * Génère un suffixe de barcode collision-résistant (10 chars base36 = ~3.7e15 combinaisons).
 * Avant : 5 chars base36 = ~60M → collision quasi-garantie sur gros imports.
 * Préfère crypto.randomUUID() (CSPRNG) avec fallback Math.random pour les vieux navigateurs.
 */
function generateBarcodeSuffix(length = 10): string {
  let raw: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    // UUID v4 → 32 chars hex. On les convertit en base36 et on prend `length` chars.
    raw = crypto.randomUUID().replace(/-/g, '');
    const num = BigInt('0x' + raw);
    raw = num.toString(36).toUpperCase();
  } else {
    // Fallback : concaténation de plusieurs Math.random pour avoir assez d'entropie
    raw = (Math.random().toString(36) + Math.random().toString(36))
      .replace(/[^a-z0-9]/g, '')
      .toUpperCase();
  }
  return raw.slice(0, length).padEnd(length, '0');
}

// Structure attendue du fichier client
interface ClientFileRow {
  Id: string;                    // "C0004911-15087911"
  Address: string;               // "6 RUE DE L ETANG ZI BEL AIR,97450,SAINT LOUIS"
  Floor: string | number;        // "0"
  Elevator: string | number;     // "0"
  Order_Number: string | number; // "15087911"
  Contact: string;               // "DOM PIECES AUTOMOBILE"
  Telephone: string;             // "0262260303"
  Comment: string;               // "Facture"
  Start: string;                 // "08:00"
  End: string;                   // "10:00"
  Volume: string | number;       // "0"
  Weight: string | number;       // "0"
  Service_Time: string | number; // "30"
  Tour: string;                  // "PREM"
}

export interface ImportResult {
  success: boolean;
  batchId?: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: ImportBatchError[];
  packages: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[];
  zoneBreakdown: ImportBatchZoneBreakdown[];
}

// Variantes d'en-têtes rencontrées dans les fichiers clients (fautes de frappe,
// espaces au lieu d'underscores, libellés français). Clé = en-tête en minuscules.
const HEADER_ALIASES: Record<string, keyof ClientFileRow> = {
  'id': 'Id',
  'numéro colis': 'Id',
  'numero colis': 'Id',
  'address': 'Address',
  'adress': 'Address',
  'adresse': 'Address',
  'floor': 'Floor',
  'etage': 'Floor',
  'étage': 'Floor',
  'elevator': 'Elevator',
  'ascenseur': 'Elevator',
  'order_number': 'Order_Number',
  'order number': 'Order_Number',
  'n° commande': 'Order_Number',
  'contact': 'Contact',
  'telephone': 'Telephone',
  'téléphone': 'Telephone',
  'comment': 'Comment',
  'commentaire': 'Comment',
  'start': 'Start',
  'end': 'End',
  'volume': 'Volume',
  'weight': 'Weight',
  'poids': 'Weight',
  'service_time': 'Service_Time',
  'service time': 'Service_Time',
  'tour': 'Tour',
  'tournée': 'Tour',
  'tournee': 'Tour'
};

/**
 * Normalise les clés d'une ligne vers les noms de colonnes canoniques.
 * Les colonnes inconnues sont conservées telles quelles.
 */
const canonicalizeRow = (row: Record<string, unknown>): ClientFileRow => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const canonical = HEADER_ALIASES[key.trim().toLowerCase()] || key;
    // Ne pas écraser une valeur déjà présente par une valeur vide (colonnes dupliquées)
    if (!(canonical in normalized) || normalized[canonical] === '') {
      normalized[canonical] = value;
    }
  }
  return normalized as unknown as ClientFileRow;
};

/**
 * Parse un fichier Excel et extrait les données
 */
export const parseExcelFile = async (file: File): Promise<ClientFileRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convertir en JSON avec header
        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
          raw: false,
          defval: ''
        });

        resolve(jsonData.map(canonicalizeRow));
      } catch (error) {
        reject(new Error('Erreur lors de la lecture du fichier Excel'));
      }
    };

    reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
    reader.readAsBinaryString(file);
  });
};

/**
 * Parse l'adresse pour extraire rue, code postal et ville
 */
const parseAddress = (fullAddress: string): { address: string; postalCode: string; city: string } => {
  // Formats rencontrés :
  //   "6 RUE DE L ETANG ZI BEL AIR,97450,SAINT LOUIS"
  //   "2 RUE SAINT JOSEPH OUVRIER,,97400,SAINT DENIS"          (complément vide)
  //   "14 RUE DU GENERAL DE GAULLE,CENTRE COMMERCIAL,97438,SAINTE MARIE"
  // → on localise le code postal parmi les segments au lieu de supposer sa position
  const parts = fullAddress.split(',').map(p => p.trim());
  const cpIndex = parts.findIndex(p => /^974\d{2}$/.test(p));

  if (cpIndex !== -1) {
    return {
      address: parts.slice(0, cpIndex).filter(Boolean).join(', '),
      postalCode: parts[cpIndex],
      city: parts.slice(cpIndex + 1).filter(Boolean).join(' ')
    };
  }

  if (parts.length === 2) {
    return {
      address: parts[0],
      postalCode: '',
      city: parts[1]
    };
  }

  // Adresse sans virgules ("144 RUE GEORGES POMPIDOU  97433 SALAZIE") :
  // on découpe autour du code postal — avant = rue, après = ville
  const cp = extractPostalCodeFromAddress(fullAddress);
  if (cp) {
    const cpIndex = fullAddress.indexOf(cp);
    return {
      address: fullAddress.slice(0, cpIndex).replace(/[\s.,]+$/, '').trim(),
      postalCode: cp,
      city: fullAddress.slice(cpIndex + cp.length).trim()
    };
  }

  return {
    address: fullAddress,
    postalCode: '',
    city: ''
  };
};

/**
 * Convertit une ligne du fichier en Package
 */
const rowToPackage = async (
  row: ClientFileRow,
  rowIndex: number,
  clientId: string,
  clientName: string,
  importBatchId: string
): Promise<{ package: Omit<Package, 'id' | 'createdAt' | 'updatedAt'> | null; error: ImportBatchError | null }> => {
  
  // Validation des champs obligatoires
  if (!row.Address) {
    return { package: null, error: { row: rowIndex, field: 'Address', message: 'Adresse manquante' } };
  }
  if (!row.Order_Number) {
    return { package: null, error: { row: rowIndex, field: 'Order_Number', message: 'Numéro de commande manquant' } };
  }
  if (!row.Contact) {
    return { package: null, error: { row: rowIndex, field: 'Contact', message: 'Contact manquant' } };
  }
  
  // Parser l'adresse
  const { address, postalCode, city } = parseAddress(row.Address);
  
  if (!postalCode) {
    return { package: null, error: { row: rowIndex, field: 'Address', message: 'Code postal non détecté dans l\'adresse' } };
  }
  
  // Détecter la zone
  const zone = await getZoneFromPostalCode(postalCode);
  if (!zone) {
    return { package: null, error: { row: rowIndex, field: 'Address', message: `Code postal ${postalCode} non reconnu` } };
  }
  
  // Parser les autres champs
  const floor = typeof row.Floor === 'string' ? parseInt(row.Floor) || 0 : row.Floor || 0;
  const hasElevator = row.Elevator === '1' || row.Elevator === 1 || row.Elevator === 'true';
  const volume = typeof row.Volume === 'string' ? parseFloat(row.Volume) || 0 : row.Volume || 0;
  const weight = typeof row.Weight === 'string' ? parseFloat(row.Weight) || 0 : row.Weight || 0;
  const serviceTime = typeof row.Service_Time === 'string' ? parseInt(row.Service_Time) || 5 : row.Service_Time || 5;
  const orderNumber = String(row.Order_Number);
  
  // Générer un tracking number unique FleetGenius
  // Format : GFL-YYMMDD-XXXXXXXXXX (10 chars CSPRNG, ~3.7e15 combinaisons)
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const trackingNumber = `GFL-${dateStr}-${generateBarcodeSuffix()}`;
  
  // Créer le mouvement initial
  const initialMovement: PackageMovement = {
    timestamp: new Date().toISOString(),
    action: 'IMPORTED',
    notes: `Importé depuis ${row.Tour || 'fichier client'}`
  };
  
  const pkg: Omit<Package, 'id' | 'createdAt' | 'updatedAt'> = {
    clientId,
    clientName,
    importBatchId,
    externalId: row.Id || '',
    orderNumber,
    barcode: trackingNumber, // Tracking FleetGenius unique (GFL-YYMMDD-XXXXX)
    address,
    city,
    postalCode,
    zone,
    floor,
    hasElevator,
    contactName: row.Contact,
    contactPhone: row.Telephone || undefined,
    timeWindowStart: row.Start || undefined,
    timeWindowEnd: row.End || undefined,
    serviceTime,
    comment: row.Comment || undefined,
    volume: volume || undefined,
    weight: weight || undefined,
    status: PackageStatus.PENDING,
    movements: [initialMovement]
  };
  
  return { package: pkg, error: null };
};

/**
 * Importe un fichier Excel et crée les colis
 */
export const importExcelFile = async (
  file: File,
  client: User,
  importedBy: User
): Promise<ImportResult> => {
  const result: ImportResult = {
    success: false,
    totalRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    packages: [],
    zoneBreakdown: []
  };
  
  try {
    // Parser le fichier
    const rows = await parseExcelFile(file);
    result.totalRows = rows.length;
    
    if (rows.length === 0) {
      result.errors.push({ row: 0, message: 'Fichier vide ou format non reconnu' });
      return result;
    }
    
    // Générer un ID pour le batch d'import
    const batchId = `IMP-${Date.now()}`;
    
    // Extraire le nom de la tournée du premier row
    const tourName = rows[0]?.Tour || file.name.replace(/\.[^/.]+$/, '');
    
    // Convertir chaque ligne en Package
    const zonePackages: Record<Zone, Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[]> = {
      [Zone.NORD]: [],
      [Zone.EST]: [],
      [Zone.SUD]: [],
      [Zone.OUEST]: []
    };
    
    for (let i = 0; i < rows.length; i++) {
      const { package: pkg, error } = await rowToPackage(
        rows[i],
        i + 2, // +2 car row 1 = header, et on commence à 1
        client.id,
        client.companyName || `${client.firstName} ${client.lastName}`,
        batchId
      );
      
      if (error) {
        result.errors.push(error);
        result.errorCount++;
      } else if (pkg) {
        result.packages.push(pkg);
        zonePackages[pkg.zone].push(pkg);
        result.successCount++;
      }
    }
    
    // Créer la répartition par zone
    for (const zone of [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST]) {
      if (zonePackages[zone].length > 0) {
        const hub = await getHubByZone(zone);
        result.zoneBreakdown.push({
          zone,
          count: zonePackages[zone].length,
          packageIds: [], // Sera rempli après création
          hubId: hub?.id,
          hubName: hub?.name,
          dispatched: false
        });
      }
    }
    
    // Sauvegarder les colis si au moins un est valide
    if (result.packages.length > 0) {
      const packageIds = await addPackagesBatch(result.packages);
      
      // Mettre à jour les packageIds dans zoneBreakdown
      let idIndex = 0;
      for (const breakdown of result.zoneBreakdown) {
        const zoneCount = zonePackages[breakdown.zone].length;
        breakdown.packageIds = packageIds.slice(idIndex, idIndex + zoneCount);
        idIndex += zoneCount;
      }
      
      // Créer le batch d'import
      const importBatch: Omit<ImportBatch, 'id'> = {
        clientId: client.id,
        clientName: client.companyName || `${client.firstName} ${client.lastName}`,
        fileName: file.name,
        tourName,
        totalRows: result.totalRows,
        successCount: result.successCount,
        errorCount: result.errorCount,
        errors: result.errors,
        zoneBreakdown: result.zoneBreakdown,
        importedBy: importedBy.id,
        importedByName: `${importedBy.firstName} ${importedBy.lastName}`,
        importedAt: new Date().toISOString(),
        status: result.errorCount > 0 ? ImportBatchStatus.COMPLETED : ImportBatchStatus.COMPLETED
      };
      
      result.batchId = await addImportBatch(importBatch);
      result.success = true;
    }
    
    return result;
    
  } catch (error) {
    console.error('Erreur import Excel:', error);
    result.errors.push({ row: 0, message: error instanceof Error ? error.message : 'Erreur inconnue' });
    return result;
  }
};

/**
 * Regroupe les colis par adresse pour créer les stops
 */
export const groupPackagesByAddress = (
  packages: Package[]
): Map<string, Package[]> => {
  const groups = new Map<string, Package[]>();
  
  for (const pkg of packages) {
    // Clé = adresse normalisée
    const key = `${pkg.address.toLowerCase().trim()}|${pkg.postalCode}|${pkg.city.toLowerCase().trim()}`;
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(pkg);
  }
  
  return groups;
};

/**
 * Valide le format d'un fichier avant import
 */
export const validateExcelFormat = async (file: File): Promise<{ valid: boolean; errors: string[] }> => {
  const errors: string[] = [];
  
  try {
    const rows = await parseExcelFile(file);
    
    if (rows.length === 0) {
      errors.push('Le fichier est vide');
      return { valid: false, errors };
    }
    
    // Vérifier les colonnes obligatoires
    const firstRow = rows[0];
    const requiredFields = ['Address', 'Order_Number', 'Contact'];

    const missing = requiredFields.filter(field => !(field in firstRow));
    for (const field of missing) {
      errors.push(`Colonne obligatoire manquante: ${field}`);
    }
    if (missing.length > 0) {
      // Aide au diagnostic : montrer ce que contient réellement le fichier
      errors.push(`Colonnes trouvées dans le fichier: ${Object.keys(firstRow).join(', ')}`);
    }
    
    // Vérifier quelques lignes
    const sampleSize = Math.min(5, rows.length);
    let validAddresses = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      const postalCode = extractPostalCodeFromAddress(rows[i].Address || '');
      if (postalCode) validAddresses++;
    }
    
    if (validAddresses === 0) {
      errors.push('Aucune adresse valide détectée (format attendu: RUE,CODE_POSTAL,VILLE)');
    }
    
    return { valid: errors.length === 0, errors };
    
  } catch (error) {
    errors.push('Impossible de lire le fichier Excel');
    return { valid: false, errors };
  }
};

// ============================================================================
// IMPORT AVEC REVUE (Phase 2 — Post-Import Review)
// ============================================================================

/**
 * Ligne de revue — ce que la table de revue affiche et permet d'éditer.
 */
export interface ReviewRow {
  _rowIndex: number;              // Numéro de ligne original Excel (2-based)
  _status: 'valid' | 'warning' | 'error' | 'deleted';
  _errors: string[];              // Messages d'erreur pour cette ligne
  _warnings: string[];            // Avertissements (non bloquants)
  _multiColis?: { index: number; total: number }; // Colis i/N d'un même point de livraison

  // Champs éditables
  externalId: string;
  orderNumber: string;
  address: string;
  postalCode: string;
  city: string;
  zone: Zone | '';
  contactName: string;
  contactPhone: string;
  floor: number;
  hasElevator: boolean;
  timeWindowStart: string;
  timeWindowEnd: string;
  serviceTime: number;
  comment: string;
  volume: number;
  weight: number;

  // Raw data pour référence
  _rawAddress: string;
}

export interface ReviewResult {
  rows: ReviewRow[];
  totalRows: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  fileName: string;
}

/**
 * Parse un fichier Excel et retourne les lignes PRÊTES POUR REVUE
 * (ne crée rien en base).
 */
export const parseExcelForReview = async (file: File): Promise<ReviewResult> => {
  const rawRows = await parseExcelFile(file);
  const reviewRows: ReviewRow[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const errors: string[] = [];
    const warnings: string[] = [];

    // Parse adresse
    const { address, postalCode, city } = parseAddress(raw.Address || '');

    // Validations
    if (!raw.Address) errors.push('Adresse manquante');
    if (!raw.Order_Number) errors.push('N° commande manquant');
    if (!raw.Contact) errors.push('Contact manquant');

    if (!postalCode && raw.Address) errors.push('Code postal non détecté');

    // Détecter zone
    let zone: Zone | '' = '';
    if (postalCode) {
      const detected = await getZoneFromPostalCode(postalCode);
      if (detected) {
        zone = detected;
      } else {
        errors.push(`Code postal ${postalCode} non reconnu`);
      }
    }

    // Warnings non bloquants
    if (!raw.Telephone) warnings.push('Pas de téléphone');
    if (!raw.Start && !raw.End) warnings.push('Pas de créneau horaire');
    const svcTime = typeof raw.Service_Time === 'string' ? parseInt(raw.Service_Time) || 5 : raw.Service_Time || 5;
    if (svcTime > 60) warnings.push(`Temps de service élevé (${svcTime} min)`);

    const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

    reviewRows.push({
      _rowIndex: i + 2,
      _status: status,
      _errors: errors,
      _warnings: warnings,
      externalId: raw.Id || '',
      orderNumber: String(raw.Order_Number || ''),
      address,
      postalCode,
      city,
      zone,
      contactName: raw.Contact || '',
      contactPhone: raw.Telephone || '',
      floor: typeof raw.Floor === 'string' ? parseInt(raw.Floor) || 0 : raw.Floor || 0,
      hasElevator: raw.Elevator === '1' || raw.Elevator === 1 || raw.Elevator === 'true',
      timeWindowStart: raw.Start || '',
      timeWindowEnd: raw.End || '',
      serviceTime: svcTime,
      comment: raw.Comment || '',
      volume: typeof raw.Volume === 'string' ? parseFloat(raw.Volume) || 0 : raw.Volume || 0,
      weight: typeof raw.Weight === 'string' ? parseFloat(raw.Weight) || 0 : raw.Weight || 0,
      _rawAddress: raw.Address || ''
    });
  }

  annotateMultiColisAndDuplicates(reviewRows);

  return {
    rows: reviewRows,
    totalRows: reviewRows.length,
    validCount: reviewRows.filter(r => r._status === 'valid').length,
    warningCount: reviewRows.filter(r => r._status === 'warning').length,
    errorCount: reviewRows.filter(r => r._status === 'error').length,
    fileName: file.name
  };
};

// ── Regroupement par POINT DE LIVRAISON (secure le nombre de colis à déposer) ──
// Objectif : tous les colis destinés au MÊME point physique comptent ensemble
// (ex. pharmacie qui reçoit 6 cartons sur 2 commandes) → le chauffeur voit le
// bon total. On NE se base PAS sur le n° de commande (2 commandes = 1 point) ni
// sur le nom (trop variable entre imports : "SARL PHCIE" vs "PHARMACIE" → ça
// scinderait le groupe et sous-compterait). Clé fiable = adresse + CP + ville.
// Renfort : même téléphone + même CP = même client (rattrape les fautes de
// frappe dans l'adresse).

const normalizeAddr = (s?: string): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/[^a-z0-9]+/g, ' ')                      // ponctuation → espace
    .trim();

const normalizePhone = (s?: string): string => (s || '').replace(/\D/g, '');

const addrKey = (r: ReviewRow): string =>
  `${normalizeAddr(r.address)}|${(r.postalCode || '').trim()}|${normalizeAddr(r.city)}`;

/** Téléphone exploitable comme signal (≥ 6 chiffres), sinon vide. */
const phoneSignal = (r: ReviewRow): string => {
  const p = normalizePhone(r.contactPhone);
  return p.length >= 6 ? p : '';
};

/** Deux lignes = même point de livraison ? (adresse identique OU même tél+CP) */
const sameDeliveryPoint = (a: ReviewRow, b: ReviewRow): boolean => {
  if (addrKey(a) === addrKey(b)) return true;
  const pa = phoneSignal(a), pb = phoneSignal(b);
  return !!pa && pa === pb && (a.postalCode || '').trim() === (b.postalCode || '').trim();
};

const annotateMultiColisAndDuplicates = (reviewRows: ReviewRow[]): void => {
  const active = reviewRows.filter(r => r._status !== 'deleted');

  // Union-Find : on relie les lignes qui partagent l'adresse OU le téléphone,
  // pour former les composantes = points de livraison réels.
  const parent = active.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i: number, j: number) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; };

  const byAddr = new Map<string, number>();
  const byPhone = new Map<string, number>();
  active.forEach((r, i) => {
    const ak = addrKey(r);
    if (byAddr.has(ak)) union(i, byAddr.get(ak)!); else byAddr.set(ak, i);
    const pk = phoneSignal(r);
    if (pk) {
      const pcKey = `${pk}|${(r.postalCode || '').trim()}`;
      if (byPhone.has(pcKey)) union(i, byPhone.get(pcKey)!); else byPhone.set(pcKey, i);
    }
  });

  // Regrouper par composante
  const groups = new Map<number, ReviewRow[]>();
  active.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(r);
  });

  for (const group of groups.values()) {
    if (group.length > 1) {
      group.forEach((r, i) => { r._multiColis = { index: i + 1, total: group.length }; });
    } else {
      group[0]._multiColis = undefined;
    }
  }

  // Vrai doublon = le même N° colis présent sur plusieurs lignes
  const byColis = new Map<string, ReviewRow[]>();
  for (const r of active) {
    const cKey = r.externalId.trim().toUpperCase();
    if (!cKey) continue;
    if (!byColis.has(cKey)) byColis.set(cKey, []);
    byColis.get(cKey)!.push(r);
  }
  for (const [colis, dups] of byColis) {
    if (dups.length > 1) {
      for (const r of dups) {
        r._warnings.push(`Doublon : N° colis ${colis} présent sur ${dups.length} lignes`);
        if (r._status === 'valid') r._status = 'warning';
      }
    }
  }
};

/**
 * Re-valide une seule ligne (après édition inline).
 */
export const revalidateRow = async (row: ReviewRow, allRows: ReviewRow[]): Promise<ReviewRow> => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.address) errors.push('Adresse manquante');
  if (!row.orderNumber) errors.push('N° commande manquant');
  if (!row.contactName) errors.push('Contact manquant');
  if (!row.postalCode) errors.push('Code postal manquant');

  let zone: Zone | '' = row.zone;
  if (row.postalCode) {
    const detected = await getZoneFromPostalCode(row.postalCode);
    if (detected) {
      zone = detected;
    } else {
      errors.push(`Code postal ${row.postalCode} non reconnu`);
    }
  }

  if (!row.contactPhone) warnings.push('Pas de téléphone');
  if (!row.timeWindowStart && !row.timeWindowEnd) warnings.push('Pas de créneau horaire');
  if (row.serviceTime > 60) warnings.push(`Temps de service élevé (${row.serviceTime} min)`);

  // Vrai doublon = même N° colis qu'une autre ligne
  const colisKey = row.externalId.trim().toUpperCase();
  if (colisKey) {
    const dup = allRows.find(r =>
      r._rowIndex !== row._rowIndex &&
      r._status !== 'deleted' &&
      r.externalId.trim().toUpperCase() === colisKey
    );
    if (dup) warnings.push(`Doublon : N° colis ${row.externalId} aussi présent ligne ${dup._rowIndex}`);
  }

  // Multi-colis : même POINT DE LIVRAISON (adresse+CP+ville, ou tél+CP) — quel
  // que soit le n° de commande. Aligné sur annotateMultiColisAndDuplicates.
  const updated = { ...row, zone };
  const groupRowIndexes = allRows
    .filter(r => r._rowIndex !== row._rowIndex && r._status !== 'deleted' && sameDeliveryPoint(r, updated))
    .map(r => r._rowIndex)
    .concat(row._rowIndex)
    .sort((a, b) => a - b);
  const multiColis = groupRowIndexes.length > 1
    ? { index: groupRowIndexes.indexOf(row._rowIndex) + 1, total: groupRowIndexes.length }
    : undefined;

  return {
    ...updated,
    _multiColis: multiColis,
    _errors: errors,
    _warnings: warnings,
    _status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid'
  };
};

/**
 * Confirme l'import après revue — écrit les lignes validées en base.
 * Ne traite que les lignes avec _status === 'valid' ou 'warning'.
 */
export const confirmReviewedImport = async (
  rows: ReviewRow[],
  client: User,
  importedBy: User,
  fileName: string
): Promise<ImportResult> => {
  const result: ImportResult = {
    success: false,
    totalRows: rows.length,
    successCount: 0,
    errorCount: 0,
    errors: [],
    packages: [],
    zoneBreakdown: []
  };

  const batchId = `IMP-${Date.now()}`;
  const clientName = client.companyName || `${client.firstName} ${client.lastName}`;
  const zonePackages: Record<Zone, Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[]> = {
    [Zone.NORD]: [],
    [Zone.EST]: [],
    [Zone.SUD]: [],
    [Zone.OUEST]: []
  };

  for (const row of rows) {
    // Ignorer lignes supprimées ou en erreur
    if (row._status === 'deleted' || row._status === 'error') {
      if (row._status === 'error') {
        result.errorCount++;
        result.errors.push({ row: row._rowIndex, message: row._errors.join(', ') });
      }
      continue;
    }

    if (!row.zone) {
      result.errorCount++;
      result.errors.push({ row: row._rowIndex, message: 'Zone non définie' });
      continue;
    }

    const initialMovement: PackageMovement = {
      timestamp: new Date().toISOString(),
      action: 'IMPORTED',
      notes: `Importé et validé depuis ${fileName}`
    };

    const pkg: Omit<Package, 'id' | 'createdAt' | 'updatedAt'> = {
      clientId: client.id,
      clientName,
      importBatchId: batchId,
      externalId: row.externalId,
      orderNumber: row.orderNumber,
      barcode: `GFL-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${generateBarcodeSuffix()}`,
      address: row.address,
      city: row.city,
      postalCode: row.postalCode,
      zone: row.zone as Zone,
      floor: row.floor,
      hasElevator: row.hasElevator,
      contactName: row.contactName,
      contactPhone: row.contactPhone || undefined,
      timeWindowStart: row.timeWindowStart || undefined,
      timeWindowEnd: row.timeWindowEnd || undefined,
      serviceTime: row.serviceTime || 5,
      comment: row.comment || undefined,
      volume: row.volume || undefined,
      weight: row.weight || undefined,
      status: PackageStatus.PENDING,
      movements: [initialMovement]
    };

    result.packages.push(pkg);
    zonePackages[row.zone as Zone].push(pkg);
    result.successCount++;
  }

  // Zone breakdown
  for (const zone of [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST]) {
    if (zonePackages[zone].length > 0) {
      const hub = await getHubByZone(zone);
      result.zoneBreakdown.push({
        zone,
        count: zonePackages[zone].length,
        packageIds: [],
        hubId: hub?.id,
        hubName: hub?.name,
        dispatched: false
      });
    }
  }

  // Sauvegarder les colis
  if (result.packages.length > 0) {
    const packageIds = await addPackagesBatch(result.packages);

    let idIndex = 0;
    for (const breakdown of result.zoneBreakdown) {
      const zoneCount = zonePackages[breakdown.zone].length;
      breakdown.packageIds = packageIds.slice(idIndex, idIndex + zoneCount);
      idIndex += zoneCount;
    }

    const importBatch: Omit<ImportBatch, 'id'> = {
      clientId: client.id,
      clientName,
      fileName,
      totalRows: result.totalRows,
      successCount: result.successCount,
      errorCount: result.errorCount,
      errors: result.errors,
      zoneBreakdown: result.zoneBreakdown,
      importedBy: importedBy.id,
      importedByName: `${importedBy.firstName} ${importedBy.lastName}`,
      importedAt: new Date().toISOString(),
      status: result.errorCount > 0 ? ImportBatchStatus.COMPLETED : ImportBatchStatus.COMPLETED
    };

    result.batchId = await addImportBatch(importBatch);
    result.success = true;
  }

  return result;
};
