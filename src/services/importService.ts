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
 * Normalise un numéro de téléphone vers le format international +262
 * Gère la notation scientifique Excel (ex: 2.62693E+11 → +262693...)
 * Formats acceptés :
 *   0692XXXXXX → +262692XXXXXX
 *   262692XXXXXX → +262692XXXXXX
 *   +262692XXXXXX → +262692XXXXXX
 *   2.62693E+11 → +262693...
 */
const normalizePhone = (phone: string | number | undefined): string | undefined => {
  if (phone === undefined || phone === null || phone === '') return undefined;

  // Convertir number → string sans notation scientifique
  let str = typeof phone === 'number'
    ? Number.isFinite(phone) ? BigInt(Math.round(phone)).toString() : String(phone)
    : String(phone).trim();

  // Gérer la notation scientifique sous forme de string ("2.62693E+11")
  if (/[\dEe.+]+E[+\-]?\d+/i.test(str)) {
    try { str = BigInt(Math.round(Number(str))).toString(); } catch { /* keep as-is */ }
  }

  // Retirer tout sauf chiffres et + initial
  const plus = str.startsWith('+');
  str = str.replace(/\D/g, '');

  if (!str || str.length < 6) return undefined;

  // Déjà en international +262...
  if (plus && str.startsWith('262')) return `+${str}`;

  // International sans + (262XXXXXXXXX, 12 digits)
  if (str.startsWith('262') && str.length >= 12) return `+${str}`;

  // Local avec 0 (0692XXXXXX, 10 digits) → +262692XXXXXX
  if (str.startsWith('0') && str.length === 10) return `+262${str.substring(1)}`;

  // 9 digits sans 0 (692XXXXXX) → +262692XXXXXX
  if (str.length === 9 && /^[26]/.test(str)) return `+262${str}`;

  // Format inconnu, retourner tel quel avec +
  return plus ? `+${str}` : str;
};

/**
 * Parse un nombre potentiellement au format français (virgule décimale)
 * Ex: "12,50" → 12.5, "1 234,56" → 1234.56
 */
const parseFrenchNumber = (val: string | number | undefined | null): number => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  // Retirer espaces de milliers, remplacer virgule par point
  const cleaned = String(val).replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

/**
 * Extraire code postal + ville depuis le champ "Commune" du format plateforme
 * Ex: "97450 SAINT LOUIS" → { postalCode: "97450", city: "SAINT LOUIS" }
 * Ex: "97400 Saint-Denis" → { postalCode: "97400", city: "Saint-Denis" }
 */
const parseCommune = (commune: string | undefined): { postalCode: string; city: string } => {
  if (!commune) return { postalCode: '', city: '' };
  const trimmed = commune.trim();
  // Chercher un code postal en début (97XXX ou autre format 5 digits)
  const match = trimmed.match(/^(\d{5})\s+(.+)$/);
  if (match) {
    return { postalCode: match[1], city: match[2].trim() };
  }
  // Sinon chercher un code postal n'importe où
  const cpMatch = trimmed.match(/\b(\d{5})\b/);
  if (cpMatch) {
    const city = trimmed.replace(cpMatch[0], '').trim();
    return { postalCode: cpMatch[1], city };
  }
  return { postalCode: '', city: trimmed };
};

/**
 * Mapper les statuts de la plateforme vers PackageStatus
 */
const mapPlatformStatus = (status: string | undefined): PackageStatus => {
  if (!status) return PackageStatus.PENDING;
  const s = status.trim().toLowerCase();
  if (s.includes('livré') || s.includes('livre') || s.includes('delivered')) return PackageStatus.DELIVERED;
  if (s.includes('transit') || s.includes('expédié') || s.includes('expedie')) return PackageStatus.IN_TRANSIT;
  if (s.includes('retour') || s.includes('return')) return PackageStatus.RETURN_REQUESTED;
  if (s.includes('échec') || s.includes('echoué') || s.includes('failed')) return PackageStatus.FAILED;
  if (s.includes('collecté') || s.includes('collected')) return PackageStatus.COLLECTED;
  if (s.includes('hub') || s.includes('entrepôt') || s.includes('entrepot')) return PackageStatus.AT_HUB;
  return PackageStatus.PENDING;
};

/**
 * Calculer le statut de paiement
 */
const computePaymentStatus = (total: number, paid: number): 'paid' | 'partial' | 'unpaid' | 'overpaid' => {
  if (total <= 0) return 'paid'; // Gratuit ou négatif = rien à payer
  if (paid >= total) return paid > total ? 'overpaid' : 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
};

/**
 * Détecte le format du fichier (legacy vs plateforme) à partir des en-têtes
 */
export type ImportFormat = 'legacy' | 'platform';

const detectFormat = (headers: string[]): ImportFormat => {
  const h = headers.map(s => s.trim());
  // Plateforme : colonnes françaises spécifiques
  if (h.includes('Référence') || h.includes('Client Nom') || h.includes('Commune') || h.includes('Montant Total')) {
    return 'platform';
  }
  return 'legacy';
};

// Structure du fichier plateforme
interface PlatformFileRow {
  'Date Création'?: string;
  'Référence'?: string;
  'Statut Colis'?: string;
  'Paiement'?: string;
  'Référence Client'?: string;
  'Client Intitulé'?: string;
  'Client Nom'?: string;
  'Email'?: string;
  'Téléphone Mobile'?: string;
  'Forfait'?: string;
  'Intitulé Colis'?: string;
  'Volume (en cm3)'?: string | number;
  'Volume (en kg)'?: string | number;
  'Poids (en kg)'?: string | number;
  'Frais transport'?: string | number;
  'Total taxes & douanes'?: string | number;
  'Montant Total'?: string | number;
  'Total Payé'?: string | number;
  'Adresse Ligne 1'?: string;
  'Adresse Ligne 2'?: string;
  'Commune'?: string;
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
  Quantity?: string | number;    // "3" — nombre de colis pour ce destinataire (défaut 1)
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
        const jsonData = XLSX.utils.sheet_to_json<ClientFileRow>(worksheet, {
          raw: false,
          defval: ''
        });
        
        resolve(jsonData);
      } catch (error) {
        reject(new Error('Erreur lors de la lecture du fichier Excel'));
      }
    };
    
    reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
    reader.readAsBinaryString(file);
  });
};

/**
 * Parse un fichier Excel/CSV de manière générique (sans typage de colonnes)
 */
const parseExcelFileGeneric = async (file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Extraire les en-têtes
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
        const headers: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
          headers.push(cell ? String(cell.v).trim() : `Col${c}`);
        }

        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, {
          raw: false,
          defval: ''
        });

        resolve({ headers, rows });
      } catch (error) {
        reject(new Error('Erreur lors de la lecture du fichier'));
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
  // Format attendu: "6 RUE DE L ETANG ZI BEL AIR,97450,SAINT LOUIS"
  const parts = fullAddress.split(',').map(p => p.trim());
  
  if (parts.length >= 3) {
    return {
      address: parts[0],
      postalCode: parts[1],
      city: parts[2]
    };
  } else if (parts.length === 2) {
    // Essayer de détecter le code postal
    const cp = extractPostalCodeFromAddress(fullAddress);
    if (cp) {
      return {
        address: parts[0],
        postalCode: cp,
        city: parts[1].replace(cp, '').trim()
      };
    }
    return {
      address: parts[0],
      postalCode: '',
      city: parts[1]
    };
  }
  
  return {
    address: fullAddress,
    postalCode: extractPostalCodeFromAddress(fullAddress) || '',
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
  // Format : GFL-YYMMDD-XXXXX (ex: GFL-260202-A3F7K)
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  const trackingNumber = `GFL-${dateStr}-${rand}`;
  
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
    contactPhone: normalizePhone(row.Telephone),
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
    
    for (const field of requiredFields) {
      if (!(field in firstRow)) {
        errors.push(`Colonne obligatoire manquante: ${field}`);
      }
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

  // Champs éditables
  externalId: string;
  orderNumber: string;
  address: string;
  postalCode: string;
  city: string;
  zone: Zone | '';
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  floor: number;
  hasElevator: boolean;
  timeWindowStart: string;
  timeWindowEnd: string;
  serviceTime: number;
  comment: string;
  volume: number;
  weight: number;
  quantity: number;              // Nombre de colis pour ce destinataire (défaut 1)

  // Champs financiers (format plateforme)
  amountTotal: number;
  amountPaid: number;
  amountDue: number;
  paymentStatus: 'paid' | 'partial' | 'unpaid' | 'overpaid';
  shippingFees: number;
  taxesAndDuties: number;
  packageLabel: string;
  platformReference: string;
  platformStatus: string;

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
  format: ImportFormat;
}

/**
 * Parse un fichier Excel/CSV et retourne les lignes PRÊTES POUR REVUE
 * Détecte automatiquement le format (legacy vs plateforme).
 */
export const parseExcelForReview = async (file: File): Promise<ReviewResult> => {
  const { headers, rows: rawRows } = await parseExcelFileGeneric(file);
  const format = detectFormat(headers);
  const reviewRows: ReviewRow[] = [];

  if (format === 'platform') {
    // ──── FORMAT PLATEFORME ────
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i] as unknown as PlatformFileRow;
      const errors: string[] = [];
      const warnings: string[] = [];

      // Parse commune → postalCode + city
      const { postalCode, city } = parseCommune(raw['Commune']);
      const addr1 = (raw['Adresse Ligne 1'] || '').trim();
      const addr2 = (raw['Adresse Ligne 2'] || '').trim();
      const address = addr2 ? `${addr1}, ${addr2}` : addr1;

      // Validations
      if (!address) errors.push('Adresse manquante');
      if (!raw['Référence']) errors.push('Référence manquante');
      if (!raw['Client Nom']) errors.push('Nom client manquant');
      if (!postalCode && raw['Commune']) errors.push('Code postal non détecté dans Commune');
      if (!postalCode && !raw['Commune']) errors.push('Commune manquante');

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

      // Financier
      const amountTotal = parseFrenchNumber(raw['Montant Total']);
      const amountPaid = parseFrenchNumber(raw['Total Payé']);
      const amountDue = Math.round((amountTotal - amountPaid) * 100) / 100;
      const paymentStatus = computePaymentStatus(amountTotal, amountPaid);

      // Warnings
      if (!raw['Téléphone Mobile']) warnings.push('Pas de téléphone');
      if (amountDue > 0) warnings.push(`Reste à payer : ${amountDue.toFixed(2)} €`);

      // Doublon
      const refStr = String(raw['Référence'] || '');
      const existingDup = reviewRows.find(r =>
        r.orderNumber === refStr && r._status !== 'deleted'
      );
      if (existingDup) warnings.push(`Doublon possible (même référence que ligne ${existingDup._rowIndex})`);

      const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

      reviewRows.push({
        _rowIndex: i + 2,
        _status: status,
        _errors: errors,
        _warnings: warnings,
        externalId: (raw['Référence Client'] || '').trim(),
        orderNumber: refStr,
        address,
        postalCode,
        city,
        zone,
        contactName: (raw['Client Nom'] || '').trim(),
        contactPhone: normalizePhone(raw['Téléphone Mobile']) || '',
        contactEmail: (raw['Email'] || '').trim(),
        floor: 0,
        hasElevator: false,
        timeWindowStart: '06:00',  // Défaut plateforme
        timeWindowEnd: '20:00',    // Défaut plateforme
        serviceTime: 3,            // Défaut plateforme : 3 min
        comment: '',
        volume: parseFrenchNumber(raw['Volume (en cm3)']) || parseFrenchNumber(raw['Volume (en kg)']),
        weight: parseFrenchNumber(raw['Poids (en kg)']),
        quantity: 1,
        // Financier
        amountTotal,
        amountPaid,
        amountDue,
        paymentStatus,
        shippingFees: parseFrenchNumber(raw['Frais transport']),
        taxesAndDuties: parseFrenchNumber(raw['Total taxes & douanes']),
        packageLabel: (raw['Intitulé Colis'] || '').trim(),
        platformReference: refStr,
        platformStatus: (raw['Statut Colis'] || '').trim(),
        _rawAddress: `${addr1}${addr2 ? ', ' + addr2 : ''}, ${raw['Commune'] || ''}`
      });
    }
  } else {
    // ──── FORMAT LEGACY ────
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i] as unknown as ClientFileRow;
      const errors: string[] = [];
      const warnings: string[] = [];

      const { address, postalCode, city } = parseAddress(raw.Address || '');

      if (!raw.Address) errors.push('Adresse manquante');
      if (!raw.Order_Number) errors.push('N° commande manquant');
      if (!raw.Contact) errors.push('Contact manquant');
      if (!postalCode && raw.Address) errors.push('Code postal non détecté');

      let zone: Zone | '' = '';
      if (postalCode) {
        const detected = await getZoneFromPostalCode(postalCode);
        if (detected) {
          zone = detected;
        } else {
          errors.push(`Code postal ${postalCode} non reconnu`);
        }
      }

      const rawQty = raw.Quantity;
      const quantity = rawQty ? (typeof rawQty === 'string' ? parseInt(rawQty) || 1 : rawQty || 1) : 1;
      if (rawQty && quantity < 1) errors.push('Quantité invalide (doit être ≥ 1)');
      if (quantity > 50) errors.push('Quantité trop élevée (max 50)');

      if (!raw.Telephone) warnings.push('Pas de téléphone');
      if (!raw.Start && !raw.End) warnings.push('Pas de créneau horaire');
      const svcTime = typeof raw.Service_Time === 'string' ? parseInt(raw.Service_Time) || 5 : raw.Service_Time || 5;
      if (svcTime > 60) warnings.push(`Temps de service élevé (${svcTime} min)`);
      if (quantity > 1) warnings.push(`Multi-colis : ${quantity} colis seront générés (${String(raw.Order_Number)} → ${String(Number(raw.Order_Number) + quantity - 1)})`);

      const existingDup = reviewRows.find(r =>
        r.orderNumber === String(raw.Order_Number) && r._status !== 'deleted'
      );
      if (existingDup) warnings.push(`Doublon possible (même N° commande que ligne ${existingDup._rowIndex})`);

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
        contactPhone: normalizePhone(raw.Telephone) || '',
        contactEmail: '',
        floor: typeof raw.Floor === 'string' ? parseInt(raw.Floor) || 0 : raw.Floor || 0,
        hasElevator: raw.Elevator === '1' || raw.Elevator === 1 || raw.Elevator === 'true',
        timeWindowStart: raw.Start || '',
        timeWindowEnd: raw.End || '',
        serviceTime: svcTime,
        comment: raw.Comment || '',
        volume: typeof raw.Volume === 'string' ? parseFloat(raw.Volume) || 0 : raw.Volume || 0,
        weight: typeof raw.Weight === 'string' ? parseFloat(raw.Weight) || 0 : raw.Weight || 0,
        quantity: Math.max(1, quantity),
        // Pas de champs financiers pour le format legacy
        amountTotal: 0,
        amountPaid: 0,
        amountDue: 0,
        paymentStatus: 'paid',
        shippingFees: 0,
        taxesAndDuties: 0,
        packageLabel: '',
        platformReference: '',
        platformStatus: '',
        _rawAddress: raw.Address || ''
      });
    }
  }

  return {
    rows: reviewRows,
    totalRows: reviewRows.length,
    validCount: reviewRows.filter(r => r._status === 'valid').length,
    warningCount: reviewRows.filter(r => r._status === 'warning').length,
    errorCount: reviewRows.filter(r => r._status === 'error').length,
    fileName: file.name,
    format
  };
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

  // Validation quantité
  const qty = row.quantity || 1;
  if (qty < 1) errors.push('Quantité invalide (doit être ≥ 1)');
  if (qty > 50) errors.push('Quantité trop élevée (max 50)');
  if (qty > 1) warnings.push(`Multi-colis : ${qty} colis seront générés (${row.orderNumber} → ${/^\d+$/.test(row.orderNumber) ? String(Number(row.orderNumber) + qty - 1) : `${row.orderNumber}-${qty}`})`);

  const existingDup = allRows.find(r =>
    r._rowIndex !== row._rowIndex &&
    r.orderNumber === row.orderNumber &&
    r._status !== 'deleted'
  );
  if (existingDup) warnings.push(`Doublon possible (même N° commande que ligne ${existingDup._rowIndex})`);

  return {
    ...row,
    zone,
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

    // Nombre de colis à générer pour cette ligne
    const qty = Math.max(1, row.quantity || 1);
    const baseOrderNumber = row.orderNumber;
    const isNumericOrder = /^\d+$/.test(baseOrderNumber);
    const packageGroupId = qty > 1 ? `GRP-${Date.now()}-${Math.random().toString(36).substring(2, 7)}` : undefined;

    for (let q = 0; q < qty; q++) {
      // Générer le numéro de commande incrémenté
      const orderNumber = qty === 1
        ? baseOrderNumber
        : isNumericOrder
          ? String(Number(baseOrderNumber) + q)
          : `${baseOrderNumber}-${q + 1}`;

      const initialMovement: PackageMovement = {
        timestamp: new Date().toISOString(),
        action: 'IMPORTED',
        notes: qty > 1
          ? `Importé depuis ${fileName} — Colis ${q + 1}/${qty} (groupe ${packageGroupId})`
          : `Importé et validé depuis ${fileName}`
      };

      const pkg: Omit<Package, 'id' | 'createdAt' | 'updatedAt'> = {
        clientId: client.id,
        clientName,
        importBatchId: batchId,
        externalId: row.externalId,
        orderNumber,
        barcode: `GFL-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        address: row.address,
        city: row.city,
        postalCode: row.postalCode,
        zone: row.zone as Zone,
        floor: row.floor,
        hasElevator: row.hasElevator,
        contactName: row.contactName,
        contactPhone: normalizePhone(row.contactPhone),
        contactEmail: row.contactEmail || undefined,
        timeWindowStart: row.timeWindowStart || undefined,
        timeWindowEnd: row.timeWindowEnd || undefined,
        serviceTime: row.serviceTime || 5,
        comment: row.comment || undefined,
        volume: row.volume || undefined,
        weight: row.weight || undefined,
        status: PackageStatus.PENDING,
        movements: [initialMovement],
        // Champs multi-colis
        ...(qty > 1 ? {
          packageGroupId,
          packageIndex: q + 1,
          packageTotal: qty
        } : {}),
        // Champs financiers (si renseignés)
        ...(row.amountTotal ? {
          amountTotal: row.amountTotal,
          amountPaid: row.amountPaid,
          amountDue: row.amountDue,
          paymentStatus: row.paymentStatus,
          shippingFees: row.shippingFees || undefined,
          taxesAndDuties: row.taxesAndDuties || undefined,
          packageLabel: row.packageLabel || undefined,
          platformReference: row.platformReference || undefined,
          platformStatus: row.platformStatus || undefined,
        } : {})
      };

      result.packages.push(pkg);
      zonePackages[row.zone as Zone].push(pkg);
    }
    result.successCount += qty;
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
