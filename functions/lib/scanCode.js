"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeScanCode = normalizeScanCode;
exports.extractScanTokens = extractScanTokens;
exports.containsIndividualCode = containsIndividualCode;
exports.orderReferenceHint = orderReferenceHint;
exports.orderReferenceMessage = orderReferenceMessage;
/** Pure scan parsing, shared by the browser and the callable. */
function normalizeScanCode(raw) {
    // AIM symbology identifiers are metadata supplied by some scanners.
    return raw.trim().replace(/^\][A-Za-z][0-9]/, '').trim().toUpperCase();
}
function extractScanTokens(raw) {
    const code = normalizeScanCode(raw);
    const tokens = new Set(code ? [code] : []);
    for (const match of code.match(/GFL-[A-Z0-9]+-[A-Z0-9]+/g) || [])
        tokens.add(match);
    for (const match of code.match(/[A-Z]{2,5}\d{2,}/g) || [])
        tokens.add(match);
    for (const digits of code.match(/\d{6,}/g) || []) {
        tokens.add(digits);
        if (digits.length > 8)
            tokens.add(digits.slice(0, -3));
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
//# sourceMappingURL=scanCode.js.map