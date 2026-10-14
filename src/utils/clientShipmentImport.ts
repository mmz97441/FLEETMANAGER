import * as XLSX from 'xlsx';
import { carrierBarcodeError, individualReferenceError, type CarrierBarcodeFormat } from './carrierBarcodeValidation';
import { decodeClientCsv } from './clientImportFile';
import { shipmentFieldErrors } from './shipmentContract';

export interface ParsedClientShipmentRow {
  line: number;               // numéro de ligne dans le fichier (1 = entêtes)
  colisNumber: string;
  carrierBarcode: string;
  carrierBarcodeFormat: CarrierBarcodeFormat;
  contactName: string;
  address: string;
  postalCode: string;
  city: string;
  contactPhone: string;
  contactEmail: string;
  weight: string;
  clientReference: string;
  comment: string;
  requestedDeliveryDate: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  serviceTime: string;
  floor: string;
  errors: string[];
}

// Normalisation d'entête : minuscule + suppression des accents.
// IMPORTANT : plage unicode de combinaison (accents) via échappement, jamais de
// caractère combinant collé littéralement.
const normalize = (s: string): string =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Alias d'entêtes acceptés (déjà normalisés). Couvre le modèle DELIVREX ET les
// exports courants (ex. fichier tournée : « Numéro colis », « Contact », « Adress »,
// « Order Number », « Comment », « Weight »…).
const HEADER_ALIASES: Record<keyof Omit<ParsedClientShipmentRow, 'line' | 'errors'>, string[]> = {
  carrierBarcodeFormat: ['format transporteur'],
  carrierBarcode: ['code boiron', 'code transporteur', 'carrierbarcode', 'carrier_barcode', 'carrier barcode', 'barcode boiron'],
  colisNumber: ['id', 'numero de colis', 'numero colis', 'n° colis', 'n colis', 'colis', 'code colis', 'br', 'barcode', 'code barre'],
  contactName: ['nom du destinataire', 'destinataire', 'nom', 'pharmacie', 'contact', 'client', 'raison sociale'],
  address: ['adresse', 'adress', 'address'],
  postalCode: ['code postal', 'cp', 'postal code', 'zip'],
  city: ['ville', 'city', 'commune'],
  contactPhone: ['telephone', 'tel', 'phone', 'gsm', 'mobile', 'portable'],
  contactEmail: ['email', 'e-mail', 'mail', 'courriel'],
  weight: ['poids (kg)', 'poids', 'weight'],
  clientReference: ['reference', 'ref', 'order number', 'order_number', 'numero de commande', 'n° commande', 'commande', 'order'],
  comment: ['remarque', 'consignes', 'note', 'comment', 'commentaire', 'instructions'],
  requestedDeliveryDate: ['date de livraison', 'date livraison', 'delivery date', 'delivery_date', 'requested_delivery_date', 'requesteddeliverydate'],
  timeWindowStart: ['start', 'debut', 'heure debut', 'time_window_start', 'timewindowstart', 'a partir de'],
  timeWindowEnd: ['end', 'fin', 'heure fin', 'time_window_end', 'timewindowend', 'avant'],
  serviceTime: ['service_time', 'service time', 'servicetime', 'duree', 'duree sur place', 'duree (min)'],
  floor: ['floor', 'etage'],
};

// Éclate une adresse « tout-en-un » (rue + CP + ville) en trois morceaux.
// Ex. « 19 RUE ADRIEN LAGOURGUE  97424 PITON SAINT LEU »
//   → { street: '19 RUE ADRIEN LAGOURGUE', postalCode: '97424', city: 'PITON SAINT LEU' }
const splitAddress = (full: string): { street: string; postalCode: string; city: string } => {
  const s = String(full || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/(97\d{3}|98\d{3}|\d{5})/); // Réunion/Outre-mer 97xxx/98xxx, sinon 5 chiffres
  if (!m) return { street: s, postalCode: '', city: '' };
  const cp = m[1];
  const idx = s.indexOf(cp);
  const street = s.slice(0, idx).trim().replace(/[,;]+$/, '').trim();
  const city = s.slice(idx + cp.length).trim().replace(/^[,;]+/, '').trim();
  return { street: street || s, postalCode: cp, city };
};

// Récupère la valeur d'une colonne en cherchant l'entête par égalité normalisée.
const getField = (row: Record<string, any>, field: keyof typeof HEADER_ALIASES): string => {
  const aliases = HEADER_ALIASES[field];
  for (const key of Object.keys(row)) {
    if (aliases.includes(normalize(key))) {
      const v = row[key];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
};


const getOriginalField = (row: Record<string, unknown>, field: keyof typeof HEADER_ALIASES): unknown => {
  const key = Object.keys(row).find(key => HEADER_ALIASES[field].includes(normalize(key)) && row[key] !== '');
  return key ? row[key] : undefined;
};
function importDate(value: string, original: unknown): string {
  if (typeof original === 'number') {
    const date = XLSX.SSF.parse_date_code(original);
    if (date && !date.H && !date.M && !date.S) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  const french = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  return french ? `${french[3]}-${french[2].padStart(2,'0')}-${french[1].padStart(2,'0')}` : value;
}
function importTime(value: string, original: unknown): string {
  if (typeof original === 'number' && original >= 0 && original < 1) {
    const minutes = Math.round(original * 1440);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return /^\d:\d{2}$/.test(value) ? `0${value}` : value;
}
export function parseClientShipmentWorkbook(buffer: ArrayBuffer, fileName: string): { rows: ParsedClientShipmentRow[]; ignoredColumns: string[] } {
  const wb = /\.csv$/i.test(fileName)
    ? XLSX.read(decodeClientCsv(buffer), { type: 'string', raw: true, sheetRows: 10002 })
    : XLSX.read(buffer, { type: 'array', sheetRows: 10002 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });
  const originalCells = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: true });
  if (raw.length > 10000) throw new Error('Limite de 10 000 lignes par fichier.');
  if (!raw.length) throw new Error('Aucune ligne trouvée dans le fichier.');
      // 1er passage : lecture + mapping des colonnes
      const parsed: ParsedClientShipmentRow[] = raw.map((r, i) => {
        const addressRaw = getField(r, 'address');
        let street = addressRaw;
        let postalCode = getField(r, 'postalCode');
        let city = getField(r, 'city');
        // Adresse « tout-en-un » : si CP/ville absents, on les extrait de l'adresse.
        if (!postalCode || !city) {
          const sp = splitAddress(addressRaw);
          if (sp.postalCode) {
            if (!postalCode) postalCode = sp.postalCode;
            if (!city) city = sp.city;
            street = sp.street; // on ne garde que la rue dans l'adresse
          }
        }
        return {
          line: Number.isInteger(r.__rowNum__) ? r.__rowNum__ + 1 : i + 2,               // ligne 1 = entêtes
          colisNumber: getField(r, 'colisNumber'),
          carrierBarcode: getField(r, 'carrierBarcode'),
          carrierBarcodeFormat: getField(r, 'carrierBarcodeFormat').toLowerCase() === 'boiron' || Object.keys(r).some(key => ['code boiron', 'barcode boiron'].includes(normalize(key)) && String(r[key] || '').trim()) ? 'boiron' : 'generic',
          contactName: getField(r, 'contactName'),
          address: street,
          postalCode,
          city,
          contactPhone: getField(r, 'contactPhone'),
          contactEmail: getField(r, 'contactEmail'),
          weight: getField(r, 'weight'),
          clientReference: getField(r, 'clientReference'),
          comment: getField(r, 'comment'),
          requestedDeliveryDate: importDate(getField(r, 'requestedDeliveryDate'), getOriginalField(originalCells[i] || {}, 'requestedDeliveryDate')),
          timeWindowStart: importTime(getField(r, 'timeWindowStart'), getOriginalField(originalCells[i] || {}, 'timeWindowStart')),
          timeWindowEnd: importTime(getField(r, 'timeWindowEnd'), getOriginalField(originalCells[i] || {}, 'timeWindowEnd')),
          serviceTime: getField(r, 'serviceTime'), floor: getField(r, 'floor'),
          errors: Object.entries(originalCells[i] || {}).some(([key, value]) => HEADER_ALIASES.carrierBarcode.includes(normalize(key)) && typeof value === 'number')
            ? ['Code transporteur numérique : utilisez une cellule texte et recopiez le code complet depuis l’étiquette.'] : Object.entries(originalCells[i] || {}).some(([key, value]) => HEADER_ALIASES.colisNumber.includes(normalize(key)) && typeof value === 'number') ? ['Numéro de colis numérique : utilisez une cellule texte pour préserver les zéros initiaux.'] : [],
        };
      });

      // Comptage des numéros de colis (pour repérer les doublons dans le fichier)
      const counts = new Map<string, number>();
      const carrierCounts = new Map<string, number>();
      for (const p of parsed) {
        const key = p.colisNumber.trim().toUpperCase();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
        if (p.carrierBarcode) carrierCounts.set(p.carrierBarcode.toUpperCase(), (carrierCounts.get(p.carrierBarcode.toUpperCase()) || 0) + 1);
      }

      // 2e passage : contrôle qualité, une liste d'erreurs par ligne
      for (const p of parsed) {
        const carrierError = carrierBarcodeError(p.carrierBarcode, p.clientReference, p.carrierBarcodeFormat);
        if (carrierError) p.errors.push(carrierError);
        if (p.carrierBarcode && (carrierCounts.get(p.carrierBarcode.toUpperCase()) || 0) > 1) p.errors.push('Code transporteur attribué à plusieurs lignes');
        const num = p.colisNumber.trim();
        if (!num) {
          p.errors.push('Numéro de colis manquant');
        } else {
          const referenceError = individualReferenceError(num);
          if (referenceError) p.errors.push(referenceError);
          if ((counts.get(num.toUpperCase()) || 0) > 1) {
            p.errors.push('Numéro de colis en double dans le fichier');
          }
        }
        p.errors.push(...Object.values(shipmentFieldErrors({ ...p, serviceTime: p.serviceTime ? Number(p.serviceTime.replace(',', '.')) : undefined })));
        if (!p.contactPhone.trim()) p.errors.push('Téléphone manquant');
        if (p.floor && (!Number.isInteger(Number(p.floor)) || Math.abs(Number(p.floor)) > 200)) p.errors.push('Étage invalide');
        if (p.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contactEmail)) p.errors.push('Email invalide');
        if (p.weight && (!Number.isFinite(Number(p.weight.replace(',', '.'))) || Number(p.weight.replace(',', '.')) < 0)) p.errors.push('Poids invalide (kilogrammes positifs ou nuls)');
      }


  const aliases = Object.values(HEADER_ALIASES).flat();
  const ignoredColumns = [...new Set(raw.flatMap(row => Object.keys(row).filter(key => !aliases.includes(normalize(key)) && String(row[key] ?? '').trim())))];
  return { rows: parsed, ignoredColumns };
}
