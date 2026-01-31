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
    barcode: orderNumber, // Par défaut, le code barre = numéro de commande
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
    groups.get(key)!.push(pkg);
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
