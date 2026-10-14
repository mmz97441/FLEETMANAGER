import { shipmentFieldErrors } from '../utils/shipmentContract';
import { decodeClientCsv } from '../utils/clientImportFile';
import { importReference } from '../utils/importManifest';
import { carrierBarcodeError, individualReferenceError, type CarrierBarcodeFormat } from '../utils/carrierBarcodeValidation';
import { indexImportedPackageIds } from '../utils/importedPackageIds';
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
  getHubByZone,
  getPackagesByIds
} from './missionService';
// Source de vérité UNIQUE du regroupement par point de livraison (cf. address.ts).
import { recipientKey, sameDeliveryRecipient, intersectDeliveryWindows } from '../utils/address';

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
  Carrier_Barcode?: string | number;
  Carrier_Barcode_Format?: CarrierBarcodeFormat;
  _referenceNumeric?: boolean;
  Client_Reference?: string;
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

async function reconcileImportedPackages(result: ImportResult, packageIds: string[]): Promise<void> {
  const confirmed = await getPackagesByIds(packageIds);
  const byId = new Map(confirmed.map(parcel => [parcel.id, parcel]));
  if (packageIds.some(id => !byId.has(id))) throw new Error('Des colis n’ont pas pu être relus. Reprenez le même fichier pour vérifier les confirmations.');
  result.packages = packageIds.map(id => byId.get(id)!);
  const available = confirmed.filter(parcel => !parcel.missionId && !parcel.currentDriverId &&
    [PackageStatus.PENDING, PackageStatus.AT_HUB, PackageStatus.SORTED].includes(parcel.status));
  const byZone = indexImportedPackageIds(available, available.map(parcel => parcel.id));
  result.zoneBreakdown = [];
  for (const [zone, ids] of byZone) {
    const hub = await getHubByZone(zone as Zone);
    result.zoneBreakdown.push({ zone: zone as Zone, count: ids.length, packageIds: ids,
      hubId: hub?.id, hubName: hub?.name, dispatched: false });
  }
}

// Variantes d'en-têtes rencontrées dans les fichiers clients (fautes de frappe,
// espaces au lieu d'underscores, libellés français). Clé = en-tête en minuscules.
const HEADER_ALIASES: Record<string, keyof ClientFileRow> = {
  'code boiron': 'Carrier_Barcode',
  'format transporteur': 'Carrier_Barcode_Format',
  'code transporteur': 'Carrier_Barcode',
  'carrierbarcode': 'Carrier_Barcode',
  'référence': 'Client_Reference',
  'reference': 'Client_Reference',
  'clientreference': 'Client_Reference',
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
/**
 * Restaure un numéro de téléphone dont le tableur a mangé le 0 initial : une cellule
 * typée NOMBRE ("0262260303") est lue "262260303" (9 chiffres) par XLSX raw:false.
 * Sans ça, le chauffeur appelle un numéro injoignable. On ne touche pas aux formats
 * internationaux explicites (+262…, 00…).
 */
const parseServiceTime = (value: unknown): number => value === '' || value == null ? 5 : Number(value);

const normalizeImportedPhone = (raw: unknown): string => {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s || s.startsWith('+') || s.startsWith('00')) return s;
  const digits = s.replace(/\D/g, '');
  if (/^\d{9}$/.test(digits)) return '0' + digits; // 9 chiffres → 0 perdu, on le remet
  return s;
};

const canonicalizeRow = (row: Record<string, unknown>): ClientFileRow => {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const canonical = HEADER_ALIASES[key.trim().toLowerCase()] || key;
    if (['code boiron', 'barcode boiron'].includes(key.trim().toLowerCase()) && value) normalized.Carrier_Barcode_Format = 'boiron';
    // Ne pas écraser une valeur déjà présente par une valeur vide (colonnes dupliquées)
    if (!(canonical in normalized) || normalized[canonical] === '') {
      normalized[canonical] = value;
    }
  }
  if (typeof normalized.Carrier_Barcode_Format === 'string') normalized.Carrier_Barcode_Format = normalized.Carrier_Barcode_Format.toLowerCase();
  // Restaurer le 0 initial des téléphones perdu par le typage numérique du tableur.
  if (normalized.Telephone != null) normalized.Telephone = normalizeImportedPhone(normalized.Telephone);
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
        const workbook = /\.csv$/i.test(file.name)
          ? XLSX.read(decodeClientCsv(Uint8Array.from(String(data), char => char.charCodeAt(0)).buffer), { type: 'string', raw: true })
          : XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convertir en JSON avec header
        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
          raw: false,
          defval: ''
        });

        const originals = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { raw: true, defval: '' });
        resolve(jsonData.map((data, i) => {
          const row = canonicalizeRow(data), original = canonicalizeRow(originals[i] || {});
          if (typeof original.Carrier_Barcode === 'number') row.Carrier_Barcode = original.Carrier_Barcode;
          row._referenceNumeric = typeof original.Id === 'number' || (!original.Id && typeof original.Order_Number === 'number');
          return row;
        }));
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
  
  const carrierError = carrierBarcodeError(row.Carrier_Barcode, row.Client_Reference || row.Order_Number, row.Carrier_Barcode_Format);
  if (carrierError) return { package: null, error: { row: rowIndex, field: 'Code transporteur', message: carrierError } };
  // Validation des champs obligatoires
  if (!row.Address) {
    return { package: null, error: { row: rowIndex, field: 'Address', message: 'Adresse manquante' } };
  }
  const referenceError = individualReferenceError(row._referenceNumeric ? 1 : row.Id || String(row.Order_Number || ''));
  if (referenceError) return { package: null, error: { row: rowIndex, field: 'Id', message: referenceError } };
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
  const serviceTime = parseServiceTime(row.Service_Time);
  const fieldErrors = shipmentFieldErrors({ contactName: row.Contact, address, city, postalCode, serviceTime, timeWindowStart: row.Start, timeWindowEnd: row.End });
  if (Object.keys(fieldErrors).length) return { package: null, error: { row: rowIndex, message: Object.values(fieldErrors).join(' ') } };
  const orderNumber = String(row.Order_Number || row.Id);
  
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
    clientReference: row.Client_Reference || String(row.Order_Number || ''),
    ...(row.Carrier_Barcode ? { carrierBarcode: String(row.Carrier_Barcode).trim(), carrierBarcodeFormat: row.Carrier_Barcode_Format || 'generic' } : {}),
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
      const packageIds = await addPackagesBatch(result.packages, { clientId: client.id, references: result.packages.map(importReference), fileName: file.name, rejectedRows: result.errorCount });
      
      await reconcileImportedPackages(result, packageIds);
      
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
        status: result.errorCount > 0 ? ImportBatchStatus.INCOMPLETE : ImportBatchStatus.COMPLETED
      };
      
      result.batchId = await addImportBatch(importBatch);
      result.success = true;
    }
    
    return result;
    
  } catch (error) {
    result.successCount = Number((error as { confirmedCount?: number })?.confirmedCount) || 0;
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
    const group = [...groups.values()].find(items => sameDeliveryRecipient(items[0], pkg) && intersectDeliveryWindows([...items, pkg]) !== null);
    if (group) group.push(pkg); else groups.set(`${recipientKey(pkg)}|${groups.size}`, [pkg]);
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
    const requiredFields = ['Address', 'Contact'];
    if (!('Id' in firstRow) && !('Order_Number' in firstRow)) errors.push('Colonne obligatoire manquante : Id (numéro individuel du colis)');

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
  carrierBarcode?: string;
  carrierBarcodeFormat?: CarrierBarcodeFormat;
  clientReference?: string;
  _carrierNumeric?: boolean;
  _referenceNumeric?: boolean;
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
    const referenceError = individualReferenceError(raw._referenceNumeric ? 1 : raw.Id || String(raw.Order_Number || ''));
    if (referenceError) errors.push(referenceError);
    if (!raw.Contact) errors.push('Contact manquant');
    const carrierError = carrierBarcodeError(raw.Carrier_Barcode, raw.Client_Reference || raw.Order_Number, raw.Carrier_Barcode_Format);
    if (carrierError) errors.push(carrierError);

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
    const svcTime = parseServiceTime(raw.Service_Time);
    errors.push(...Object.values(shipmentFieldErrors({ contactName: raw.Contact, address, city, postalCode, serviceTime: svcTime, timeWindowStart: raw.Start, timeWindowEnd: raw.End })));
    if (svcTime > 60) warnings.push(`Temps de service élevé (${svcTime} min)`);

    const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

    reviewRows.push({
      _rowIndex: i + 2,
      _status: status,
      _errors: errors,
      _warnings: warnings,
      carrierBarcode: String(raw.Carrier_Barcode || '').trim(),
      carrierBarcodeFormat: raw.Carrier_Barcode_Format || 'generic',
      clientReference: raw.Client_Reference || String(raw.Order_Number || ''),
      _carrierNumeric: typeof raw.Carrier_Barcode === 'number',
      _referenceNumeric: raw._referenceNumeric,
      externalId: raw.Id || '',
      orderNumber: String(raw.Order_Number || raw.Id || ''),
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

// A shared count denotes one compatible visit for the same named recipient.
const annotateMultiColisAndDuplicates = (reviewRows: ReviewRow[]): void => {
  const active = reviewRows.filter(r => r._status !== 'deleted');
  const groups: ReviewRow[][] = [];
  for (const row of active) {
    const group = groups.find(items => sameDeliveryRecipient(items[0], row) && intersectDeliveryWindows([...items, row]) !== null);
    if (group) group.push(row); else groups.push([row]);
  }
  for (const group of groups) {
    group.forEach((row, index) => { row._multiColis = group.length > 1 ? { index: index + 1, total: group.length } : undefined; });
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
  const carrierError = carrierBarcodeError(row._carrierNumeric ? 1 : row.carrierBarcode, row.clientReference || row.orderNumber, row.carrierBarcodeFormat);
  if (carrierError) errors.push(carrierError);
  const warnings: string[] = [];

  if (!row.address) errors.push('Adresse manquante');
  const referenceError = individualReferenceError(row._referenceNumeric ? 1 : row.externalId || row.orderNumber);
  if (referenceError) errors.push(referenceError);
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
  errors.push(...Object.values(shipmentFieldErrors(row)));
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

  const updated = { ...row, zone };
  const copies = allRows.map(item => item._rowIndex === row._rowIndex ? { ...updated, _warnings: [...warnings] } : { ...item, _warnings: [...item._warnings] });
  annotateMultiColisAndDuplicates(copies);
  const multiColis = copies.find(item => item._rowIndex === row._rowIndex)?._multiColis;

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
  // Dédup INTER-IMPORTS : codes colis déjà en base pour ce client (+ ceux du fichier
  // courant au fil de l'eau) → ré-importer un fichier ne crée plus de colis en double.
  const existingCodes = new Set<string>(); // File duplicates only; the server confirms existing records on every retry.
  let skippedDuplicates = 0;
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

    // Colis déjà existant (import précédent OU ligne précédente du même fichier) → on saute.
    const dupKey = (row.externalId || '').trim().toUpperCase();
    if (dupKey && existingCodes.has(dupKey)) {
      skippedDuplicates++;
      result.errors.push({ row: row._rowIndex, message: `Doublon ignoré : colis ${row.externalId} déjà en base (non recréé)` });
      continue;
    }
    if (dupKey) existingCodes.add(dupKey);

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
      clientReference: row.clientReference || row.orderNumber,
      ...(row.carrierBarcode ? { carrierBarcode: row.carrierBarcode, carrierBarcodeFormat: row.carrierBarcodeFormat || 'generic' } : {}),
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

  if (skippedDuplicates > 0) {
    result.errors.push({ row: 0, message: `${skippedDuplicates} références répétées dans le fichier — ignorées (aucun doublon créé).` });
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
    const packageIds = await addPackagesBatch(result.packages, { clientId: client.id, references: result.packages.map(importReference), fileName, rejectedRows: result.errorCount });
    await reconcileImportedPackages(result, packageIds);

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
      status: result.errorCount > 0 ? ImportBatchStatus.INCOMPLETE : ImportBatchStatus.COMPLETED
    };

    result.batchId = await addImportBatch(importBatch);
    result.success = true;
  }

  return result;
};
