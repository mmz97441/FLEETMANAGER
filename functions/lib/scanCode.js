"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parcelCodeFields = void 0;
exports.normalizeScanCode = normalizeScanCode;
exports.extractScanTokens = extractScanTokens;
exports.containsIndividualCode = containsIndividualCode;
exports.orderReferenceHint = orderReferenceHint;
exports.orderReferenceMessage = orderReferenceMessage;
exports.exactScanCandidates = exactScanCandidates;
exports.individualScanCandidates = individualScanCandidates;
exports.matchesParcelScanCode = matchesParcelScanCode;
exports.parcelDisplayCode = parcelDisplayCode;
/** Pure scan parsing, shared by the browser and the callable. */
function normalizeScanCode(raw) {
    // AIM symbology identifiers are metadata supplied by some scanners.
    return raw.trim().replace(/^\][A-Za-z][0-9]/, '').trim().toUpperCase();
}
function extractScanTokens(raw) {
    const code = normalizeScanCode(raw);
    const tokens = new Set(code ? [code] : []);
    for (const token of code.split(/[\s;|,:\u001d]+/).filter(Boolean))
        tokens.add(token);
    for (const match of code.match(/GFL-[A-Z0-9]+-[A-Z0-9]+/g) || [])
        tokens.add(match);
    for (const match of code.match(/[A-Z]{2,5}\d{2,}/g) || [])
        tokens.add(match);
    for (const digits of code.match(/\d{6,}/g) || []) {
        tokens.add(digits);
    }
    return [...tokens];
}
function containsIndividualCode(raw, value) {
    if (typeof value !== 'string')
        return false;
    const code = value.trim().toUpperCase();
    if (!code)
        return false;
    const scanned = normalizeScanCode(raw);
    if (scanned === code)
        return true;
    if (code.length < 4)
        return false;
    // BR1234 must not validate BR123, nor a longer numeric identifier.
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Z0-9])${escaped}($|[^A-Z0-9])`).test(scanned);
}
/** Observed Boiron numeric labels contain an order reference after "00".
 * This is ONLY a search hint: the import has no mapping from this label to an
 * individual carton. Never use it to confirm a parcel, even for one result. */
function orderReferenceHint(raw) {
    const code = normalizeScanCode(raw);
    return /^00\d{20}$/.test(code) ? code.slice(2, 10) : null;
}
function orderReferenceMessage(reference) {
    return `Commande ${reference} retrouvée. Scannez le code individuel DELIVREX ou saisissez le numéro BR… imprimé sur ce carton. Aucun colis ajouté avec ce code de commande.`;
}
exports.parcelCodeFields = ['carrierBarcode', 'barcode', 'externalId', 'orderNumber'];
function exactScanCandidates(raw) {
    return [...new Set([raw.trim(), normalizeScanCode(raw)].filter(Boolean))];
}
/** Keep complete references and leading zeroes; never guess a carton from a shortened number. */
function individualScanCandidates(raw) {
    return [...new Set([...exactScanCandidates(raw), ...extractScanTokens(raw).filter(token => containsIndividualCode(raw, token))])];
}
function matchesParcelScanCode(parcel, raw) {
    const candidates = individualScanCandidates(raw).map(value => value.toUpperCase());
    return exports.parcelCodeFields.some(field => typeof parcel[field] === 'string' && candidates.includes(parcel[field].trim().toUpperCase())) ||
        [parcel.carrierBarcode, parcel.externalId, parcel.barcode].some(value => containsIndividualCode(raw, value));
}
function parcelDisplayCode(parcel) {
    const external = parcel.externalId?.trim();
    if (external)
        return external;
    // Preserve older Boiron imports that stored the physical BR in orderNumber.
    const br = [parcel.orderNumber, parcel.barcode].find(code => /^BR[-A-Z0-9]+$/i.test(code?.trim() || ''));
    return br?.trim().toUpperCase() || parcel.carrierBarcode?.trim() || parcel.barcode?.trim() || parcel.orderNumber?.trim() || '';
}
//# sourceMappingURL=scanCode.js.map