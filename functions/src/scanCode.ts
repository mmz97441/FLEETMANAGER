/** Pure scan parsing, shared by the browser and the callable. */
export function normalizeScanCode(raw: string): string {
  // AIM symbology identifiers are metadata supplied by some scanners.
  return raw.trim().replace(/^\][A-Za-z][0-9]/, '').trim().toUpperCase();
}

export function extractScanTokens(raw: string): string[] {
  const code = normalizeScanCode(raw);
  const tokens = new Set<string>(code ? [code] : []);
  for (const token of code.split(/[\s;|,:\u001d]+/).filter(Boolean)) tokens.add(token);
  for (const match of code.match(/GFL-[A-Z0-9]+-[A-Z0-9]+/g) || []) tokens.add(match);
  for (const match of code.match(/[A-Z]{2,5}\d{2,}/g) || []) tokens.add(match);
  for (const digits of code.match(/\d{6,}/g) || []) {
    tokens.add(digits);
  }
  return [...tokens];
}

export function containsIndividualCode(raw: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const code = value.trim().toUpperCase();
  if (!code) return false;
  const scanned = normalizeScanCode(raw);
  if (scanned === code) return true;
  if (code.length < 4) return false;
  // BR1234 must not validate BR123, nor a longer numeric identifier.
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}($|[^A-Z0-9])`).test(scanned);
}

/** Observed Boiron numeric labels contain an order reference after "00".
 * This is ONLY a search hint: the import has no mapping from this label to an
 * individual carton. Never use it to confirm a parcel, even for one result. */
export function orderReferenceHint(raw: string): string | null {
  const code = normalizeScanCode(raw);
  return /^00\d{20}$/.test(code) ? code.slice(2, 10) : null;
}

export function orderReferenceMessage(reference: string): string {
  return `Commande ${reference} retrouvée. Scannez le code individuel DELIVREX ou saisissez le numéro BR… imprimé sur ce carton. Aucun colis ajouté avec ce code de commande.`;
}

export const parcelCodeFields = ['carrierBarcode', 'barcode', 'externalId', 'orderNumber'] as const;
export interface ParcelScanCodes { carrierBarcode?: string; barcode?: string; externalId?: string; orderNumber?: string }
export function exactScanCandidates(raw: string): string[] {
  return [...new Set([raw.trim(), normalizeScanCode(raw)].filter(Boolean))];
}
/** Keep complete references and leading zeroes; never guess a carton from a shortened number. */
export function individualScanCandidates(raw: string): string[] {
  return [...new Set([...exactScanCandidates(raw), ...extractScanTokens(raw).filter(token => containsIndividualCode(raw, token))])];
}
export function matchesParcelScanCode(parcel: ParcelScanCodes, raw: string): boolean {
  const candidates = individualScanCandidates(raw).map(value => value.toUpperCase());
  return parcelCodeFields.some(field => typeof parcel[field] === 'string' && candidates.includes(parcel[field]!.trim().toUpperCase())) ||
    [parcel.carrierBarcode, parcel.externalId, parcel.barcode].some(value => containsIndividualCode(raw, value));
}
export function parcelDisplayCode(parcel: ParcelScanCodes): string {
  const external = parcel.externalId?.trim();
  if (external) return external;
  // Preserve older Boiron imports that stored the physical BR in orderNumber.
  const br = [parcel.orderNumber, parcel.barcode].find(code => /^BR[-A-Z0-9]+$/i.test(code?.trim() || ''));
  return br?.trim().toUpperCase() || parcel.carrierBarcode?.trim() || parcel.barcode?.trim() || parcel.orderNumber?.trim() || '';
}

/** Original labels remain untouched; this array is the server-owned lookup index. */
export function parcelScanCodes(parcel: ParcelScanCodes): string[] {
  return [...new Set(parcelCodeFields.flatMap(field => typeof parcel[field] === 'string' && parcel[field]!.trim()
    ? [normalizeScanCode(parcel[field]!)] : []))].sort();
}
/** An order reference is an individual label only on legacy order-only parcels. */
export function parcelIndividualCodes(parcel: ParcelScanCodes): string[] {
  const codes = parcelScanCodes({ carrierBarcode: parcel.carrierBarcode, barcode: parcel.barcode, externalId: parcel.externalId });
  return codes.length ? codes : parcelScanCodes({ orderNumber: parcel.orderNumber });
}
export type CarrierBarcodeFormat = 'generic' | 'boiron';
export function individualReferenceError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Référence numérique : conservez le numéro du colis dans une cellule texte pour préserver les zéros initiaux.';
  const code = value.trim();
  if (!code) return 'Numéro de colis manquant.';
  if (code.length > 200 || /[\x00-\x1f\x7f]/.test(code)) return 'Référence invalide : 200 caractères maximum, sans caractères de contrôle.';
  return null;
}
export function carrierBarcodeValidationError(value: unknown, reference: unknown, format: CarrierBarcodeFormat = 'generic'): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!['generic', 'boiron'].includes(format)) return 'Format de code transporteur inconnu : choisissez generic ou boiron.';
  const error = individualReferenceError(value);
  if (error) return error;
  const code = normalizeScanCode(value as string);
  if (format === 'boiron') {
    if (!/^00\d{20}$/.test(code)) return 'Le code Boiron doit contenir exactement 22 chiffres, avec ses zéros initiaux.';
    if (orderReferenceHint(code) !== String(reference || '').trim()) return 'Le code Boiron ne correspond pas à la référence de commande.';
  }
  return null;
}
