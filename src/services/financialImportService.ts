/**
 * SERVICE D'IMPORT EXCEL MULTI-FEUILLES — DONNÉES FINANCIÈRES
 *
 * Parse un classeur Excel contenant :
 *  - Feuille "IDENTIFICATION ENTREPRISE" → données d'identification + indicateurs financiers
 *  - Feuille "RÉPARTITION DU CA PAR PRODUIT" → ventilation du CA par produit
 *
 * Détecte automatiquement le type de chaque feuille et extrait les données.
 */

import * as XLSX from 'xlsx';
import {
  ClientFinancialData,
  FinancialIndicator,
  ProductRevenue,
  ProductFamily,
  FinancialSheetType,
  ParsedFinancialSheet,
} from '../types';
import { getProductFamilies, addProductFamily } from './firestore';

// ============================================================================
// DÉTECTION DU TYPE DE FEUILLE
// ============================================================================

/**
 * Mots-clés pour détecter une feuille "IDENTIFICATION ENTREPRISE"
 */
const IDENTIFICATION_KEYWORDS = [
  'identification', 'entreprise', 'raison sociale', 'siret',
  'ca ht', 'chiffre d\'affaires', 'marge commerciale',
  'valeur ajoutée', 'ebe', 'excédent brut', 'résultat d\'exploitation',
  'résultat net', 'bfr', 'besoin en fonds', 'trésorerie',
  'analyse financière'
];

/**
 * Mots-clés pour détecter une feuille "RÉPARTITION DU CA PAR PRODUIT"
 */
const PRODUCT_BREAKDOWN_KEYWORDS = [
  'répartition', 'produit', 'carburant', 'gaz', 'tabac',
  'ca par produit', 'ventilation', 'répartition du ca'
];

/**
 * Normalise une chaîne pour la comparaison (minuscules, sans accents, sans espaces multiples)
 */
const normalize = (str: string): string => {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Détecte le type d'une feuille Excel à partir de son nom et de son contenu
 */
const detectSheetType = (sheetName: string, data: any[][]): FinancialSheetType => {
  const normalizedName = normalize(sheetName);

  // D'abord, vérifier le nom de la feuille
  if (normalizedName.includes('identification') || normalizedName.includes('entreprise')) {
    return 'identification';
  }
  if (normalizedName.includes('repartition') || normalizedName.includes('produit')) {
    return 'product_breakdown';
  }

  // Ensuite, scanner le contenu (premières 20 lignes)
  const contentText = data.slice(0, 20)
    .flat()
    .filter(cell => typeof cell === 'string')
    .map(normalize)
    .join(' ');

  const identScore = IDENTIFICATION_KEYWORDS.filter(kw => contentText.includes(normalize(kw))).length;
  const productScore = PRODUCT_BREAKDOWN_KEYWORDS.filter(kw => contentText.includes(normalize(kw))).length;

  if (identScore >= 3) return 'identification';
  if (productScore >= 2) return 'product_breakdown';

  return 'unknown';
};

// ============================================================================
// PARSING DU CLASSEUR
// ============================================================================

/**
 * Lit toutes les feuilles d'un classeur Excel et retourne les données brutes + type détecté
 */
export const parseFinancialWorkbook = (file: File): Promise<ParsedFinancialSheet[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        const sheets: ParsedFinancialSheet[] = workbook.SheetNames.map(sheetName => {
          const worksheet = workbook.Sheets[sheetName];

          // Convertir en tableau de tableaux (pas de header auto)
          const rawData = XLSX.utils.sheet_to_json<any[]>(worksheet, {
            header: 1,
            raw: false,
            defval: ''
          });

          const type = detectSheetType(sheetName, rawData);

          return {
            sheetName,
            type,
            rawData,
            parsed: type !== 'unknown',
            error: type === 'unknown' ? `Type de feuille non reconnu : "${sheetName}"` : undefined
          };
        });

        resolve(sheets);
      } catch (error) {
        reject(new Error('Erreur lors de la lecture du classeur Excel'));
      }
    };

    reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
    reader.readAsBinaryString(file);
  });
};

// ============================================================================
// EXTRACTION DES DONNÉES FINANCIÈRES (Feuille "IDENTIFICATION ENTREPRISE")
// ============================================================================

/**
 * Cherche une valeur numérique dans une ligne à partir d'un index de colonne
 */
const extractNumber = (row: any[], colIndex: number): number => {
  if (!row || colIndex >= row.length) return 0;
  const val = row[colIndex];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // Nettoyer : enlever espaces, €, remplacer virgule par point
    const cleaned = val.replace(/[€\s]/g, '').replace(/,/g, '.').replace(/\u00a0/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
};

/**
 * Cherche une ligne dont la première cellule contient un mot-clé
 */
const findRow = (data: any[][], keywords: string[]): any[] | null => {
  for (const row of data) {
    if (!row || !row[0]) continue;
    const cellText = normalize(String(row[0]));
    if (keywords.some(kw => cellText.includes(normalize(kw)))) {
      return row;
    }
  }
  return null;
};

/**
 * Extrait un indicateur financier (N et N-1) depuis une ligne
 * Cherche les colonnes de valeurs numériques après le label
 */
const extractIndicator = (data: any[][], keywords: string[]): FinancialIndicator => {
  const row = findRow(data, keywords);
  if (!row) return { yearN: 0, yearN1: 0 };

  // Trouver les colonnes numériques (après la colonne label)
  const numericCols: number[] = [];
  for (let i = 1; i < row.length; i++) {
    const val = extractNumber(row, i);
    if (val !== 0 || String(row[i]).trim() === '0') {
      numericCols.push(i);
    }
  }

  if (numericCols.length >= 2) {
    return {
      yearN: extractNumber(row, numericCols[0]),
      yearN1: extractNumber(row, numericCols[1])
    };
  } else if (numericCols.length === 1) {
    return {
      yearN: extractNumber(row, numericCols[0]),
      yearN1: 0
    };
  }

  return { yearN: 0, yearN1: 0 };
};

/**
 * Extrait une valeur texte d'une ligne identifiée par mot-clé
 */
const extractTextValue = (data: any[][], keywords: string[]): string => {
  const row = findRow(data, keywords);
  if (!row) return '';
  // Retourner la première cellule non-vide après le label
  for (let i = 1; i < row.length; i++) {
    const val = String(row[i] || '').trim();
    if (val) return val;
  }
  return '';
};

export interface ParsedIdentification {
  companyName: string;
  siret: string;
  naf: string;
  address: string;
  activity: string;
  legalForm: string;
  caHT: FinancialIndicator;
  margeCommerciale: FinancialIndicator;
  valeurAjoutee: FinancialIndicator;
  ebe: FinancialIndicator;
  resultatExploitation: FinancialIndicator;
  resultatNet: FinancialIndicator;
  bfr: FinancialIndicator;
  tresorerie: FinancialIndicator;
}

/**
 * Parse la feuille "IDENTIFICATION ENTREPRISE"
 */
export const parseIdentificationSheet = (data: any[][]): ParsedIdentification => {
  return {
    // Identification
    companyName: extractTextValue(data, ['raison sociale', 'nom', 'entreprise', 'société', 'dénomination']),
    siret: extractTextValue(data, ['siret', 'siren']),
    naf: extractTextValue(data, ['naf', 'ape', 'code naf']),
    address: extractTextValue(data, ['adresse', 'siège', 'siege social']),
    activity: extractTextValue(data, ['activité', 'activite', 'objet social']),
    legalForm: extractTextValue(data, ['forme juridique', 'statut juridique', 'forme légale']),

    // Indicateurs financiers
    caHT: extractIndicator(data, ['ca ht', 'chiffre d\'affaires', 'chiffre d\'affaire']),
    margeCommerciale: extractIndicator(data, ['marge commerciale']),
    valeurAjoutee: extractIndicator(data, ['valeur ajoutée', 'valeur ajoutee']),
    ebe: extractIndicator(data, ['ebe', 'excédent brut', 'excedent brut']),
    resultatExploitation: extractIndicator(data, ['résultat d\'exploitation', 'resultat d\'exploitation', 'résultat exploitation']),
    resultatNet: extractIndicator(data, ['résultat net', 'resultat net']),
    bfr: extractIndicator(data, ['bfr', 'besoin en fonds de roulement', 'besoin fonds roulement']),
    tresorerie: extractIndicator(data, ['trésorerie', 'tresorerie', 'trésorerie nette'])
  };
};

// ============================================================================
// EXTRACTION RÉPARTITION DU CA PAR PRODUIT (Feuille 2)
// ============================================================================

export interface ParsedProductBreakdown {
  products: ProductRevenue[];
  totalCA: number;
}

/**
 * Parse la feuille "RÉPARTITION DU CA PAR PRODUIT"
 */
export const parseProductBreakdownSheet = (data: any[][]): ParsedProductBreakdown => {
  const products: ProductRevenue[] = [];
  let totalCA = 0;

  // Trouver la ligne d'en-tête (contient "produit" ou "désignation" et "ca" ou "montant")
  let headerRowIndex = -1;
  let productColIndex = -1;
  let caColIndex = -1;
  let percentColIndex = -1;

  for (let i = 0; i < Math.min(data.length, 15); i++) {
    const row = data[i];
    if (!row) continue;

    for (let j = 0; j < row.length; j++) {
      const cellText = normalize(String(row[j] || ''));
      if (cellText.includes('produit') || cellText.includes('designation') || cellText.includes('libelle') || cellText.includes('activite') || cellText.includes('activité')) {
        productColIndex = j;
        headerRowIndex = i;
      }
      if (cellText.includes('ca ht') || cellText.includes('ca') || cellText.includes('montant') || cellText.includes('chiffre')) {
        caColIndex = j;
      }
      if (cellText.includes('%') || cellText.includes('part') || cellText.includes('repartition') || cellText.includes('pourcentage')) {
        percentColIndex = j;
      }
    }

    if (headerRowIndex >= 0) break;
  }

  // Si pas de header détecté, essayer une heuristique :
  // Colonne 0 = texte (produit), Colonne 1 = nombre (CA), Colonne 2 = nombre/% (percentage)
  if (headerRowIndex < 0) {
    headerRowIndex = 0; // Commencer dès la première ligne non-vide
    // Trouver la première ligne avec du contenu
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every((c: any) => !String(c || '').trim())) continue;

      const firstCell = normalize(String(row[0] || ''));
      // Skip les lignes de titre / header
      if (firstCell.includes('repartition') || firstCell.includes('produit') || firstCell.includes('designation')) {
        headerRowIndex = i;
        continue;
      }

      // Si la première cellule est un texte et la deuxième un nombre, c'est probablement une ligne de données
      if (firstCell && !firstCell.includes('total')) {
        productColIndex = 0;
        caColIndex = 1;
        percentColIndex = 2;
        headerRowIndex = i - 1;
        break;
      }
    }
  }

  // Parser les lignes de données (après le header)
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    const productName = String(row[productColIndex >= 0 ? productColIndex : 0] || '').trim();
    if (!productName) continue;

    // Ignorer les lignes "total"
    if (normalize(productName).includes('total')) {
      // Extraire le total si disponible
      const totalVal = extractNumber(row, caColIndex >= 0 ? caColIndex : 1);
      if (totalVal > 0) totalCA = totalVal;
      continue;
    }

    const caHT = extractNumber(row, caColIndex >= 0 ? caColIndex : 1);
    let percentage = extractNumber(row, percentColIndex >= 0 ? percentColIndex : 2);

    // Si le pourcentage est > 1, c'est déjà en %, sinon convertir
    if (percentage > 0 && percentage <= 1) {
      percentage = percentage * 100;
    }

    if (productName && (caHT > 0 || percentage > 0)) {
      products.push({
        product: productName,
        caHT,
        percentage: Math.round(percentage * 100) / 100
      });
    }
  }

  // Calculer le total si pas trouvé
  if (totalCA === 0 && products.length > 0) {
    totalCA = products.reduce((sum, p) => sum + p.caHT, 0);
  }

  // Recalculer les pourcentages si manquants et total disponible
  if (totalCA > 0) {
    for (const p of products) {
      if (p.percentage === 0 && p.caHT > 0) {
        p.percentage = Math.round((p.caHT / totalCA) * 10000) / 100;
      }
    }
  }

  return { products, totalCA };
};

// ============================================================================
// ORCHESTRATION COMPLÈTE
// ============================================================================

export interface FinancialImportPreview {
  sheets: ParsedFinancialSheet[];
  identification: ParsedIdentification | null;
  productBreakdown: ParsedProductBreakdown | null;
  fileName: string;
  hasIdentification: boolean;
  hasProductBreakdown: boolean;
  detectedSheetCount: number;
  unknownSheets: string[];
}

/**
 * Parse complet d'un classeur Excel financier.
 * Retourne un aperçu prêt à être affiché avant confirmation.
 */
export const parseFinancialExcel = async (file: File): Promise<FinancialImportPreview> => {
  const sheets = await parseFinancialWorkbook(file);

  let identification: ParsedIdentification | null = null;
  let productBreakdown: ParsedProductBreakdown | null = null;
  const unknownSheets: string[] = [];

  for (const sheet of sheets) {
    if (sheet.type === 'identification') {
      identification = parseIdentificationSheet(sheet.rawData);
      sheet.parsed = true;
    } else if (sheet.type === 'product_breakdown') {
      productBreakdown = parseProductBreakdownSheet(sheet.rawData);
      sheet.parsed = true;
    } else {
      unknownSheets.push(sheet.sheetName);
    }
  }

  return {
    sheets,
    identification,
    productBreakdown,
    fileName: file.name,
    hasIdentification: identification !== null,
    hasProductBreakdown: productBreakdown !== null,
    detectedSheetCount: sheets.filter(s => s.type !== 'unknown').length,
    unknownSheets
  };
};

// ============================================================================
// MATCHING FAMILLES DE PRODUIT
// ============================================================================

/**
 * Statut d'un produit par rapport au référentiel
 */
export interface ProductMatchStatus {
  product: ProductRevenue;
  matchedFamily: ProductFamily | null;  // null = nouvelle famille à créer
  isNew: boolean;
}

/**
 * Compare les produits du fichier Excel avec les familles existantes.
 * Matching par nom normalisé (insensible casse + accents).
 */
export const matchProductsToFamilies = async (
  products: ProductRevenue[]
): Promise<ProductMatchStatus[]> => {
  const families = await getProductFamilies();

  return products.map(product => {
    const normalizedProduct = normalize(product.product);

    // Chercher une correspondance exacte (normalisée)
    const match = families.find(f => f.normalizedName === normalizedProduct);

    return {
      product,
      matchedFamily: match || null,
      isNew: !match
    };
  });
};

/**
 * Crée les familles de produit manquantes et retourne les produits
 * enrichis avec leur productFamilyId.
 */
export const ensureProductFamilies = async (
  matchStatuses: ProductMatchStatus[]
): Promise<ProductRevenue[]> => {
  const enriched: ProductRevenue[] = [];

  for (const status of matchStatuses) {
    let familyId: string;

    if (status.matchedFamily) {
      // Famille existante → utiliser son ID
      familyId = status.matchedFamily.id;
    } else {
      // Nouvelle famille → créer automatiquement
      familyId = await addProductFamily({
        name: status.product.product,
        normalizedName: normalize(status.product.product),
        createdAt: new Date().toISOString(),
        createdBy: 'import'
      });
    }

    enriched.push({
      ...status.product,
      productFamilyId: familyId
    });
  }

  return enriched;
};

/**
 * Construit l'objet ClientFinancialData final prêt pour Firestore.
 * Les productBreakdown doivent déjà avoir leur productFamilyId renseigné.
 */
export const buildClientFinancialData = (
  preview: FinancialImportPreview,
  importedBy: { id: string; firstName: string; lastName: string },
  enrichedProducts?: ProductRevenue[],
  clientId?: string
): Omit<ClientFinancialData, 'id'> => {
  const ident = preview.identification;

  return {
    companyName: ident?.companyName || 'Non renseigné',
    siret: ident?.siret || undefined,
    naf: ident?.naf || undefined,
    address: ident?.address || undefined,
    activity: ident?.activity || undefined,
    legalForm: ident?.legalForm || undefined,

    caHT: ident?.caHT || { yearN: 0, yearN1: 0 },
    margeCommerciale: ident?.margeCommerciale || { yearN: 0, yearN1: 0 },
    valeurAjoutee: ident?.valeurAjoutee || { yearN: 0, yearN1: 0 },
    ebe: ident?.ebe || { yearN: 0, yearN1: 0 },
    resultatExploitation: ident?.resultatExploitation || { yearN: 0, yearN1: 0 },
    resultatNet: ident?.resultatNet || { yearN: 0, yearN1: 0 },
    bfr: ident?.bfr || { yearN: 0, yearN1: 0 },
    tresorerie: ident?.tresorerie || { yearN: 0, yearN1: 0 },

    productBreakdown: enrichedProducts || preview.productBreakdown?.products || [],

    clientId: clientId || undefined,

    fileName: preview.fileName,
    importedBy: importedBy.id,
    importedByName: `${importedBy.firstName} ${importedBy.lastName}`,
    importedAt: new Date().toISOString()
  };
};
