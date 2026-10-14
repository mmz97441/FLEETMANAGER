import { addressBookIdentity, addressBookFieldErrors } from '../../functions/src/addressBookIdentity';
export { addressBookIdentity, addressBookFieldErrors } from '../../functions/src/addressBookIdentity';
import type { SavedAddress } from '../types';
export interface RecipientImportRow {
  line: number; contactName: string; address: string; city: string; contactPhone: string; contactEmail?: string; notes?: string;
  _status: 'ok' | 'duplicate' | 'invalid' | 'confirmed' | 'unconfirmed'; _reason?: string;
}
const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function pick(row: Record<string, any>, aliases: string[]) {
  const keys = Object.keys(row), nonempty = (key: string) => row[key] != null && String(row[key]).trim() !== '';
  const key = keys.find(key => aliases.includes(norm(key)) && nonempty(key)) || keys.find(key => aliases.some(alias => norm(key).includes(alias)) && nonempty(key));
  return key ? String(row[key]).trim() : '';
}
export function parseRecipientImport(raw: Record<string, any>[], existing: SavedAddress[]): RecipientImportRow[] {
  // A pickup-only address is valid for import: the server extends its usage to both.
  const known = new Set(existing.filter(row => row.type === 'delivery' || row.type === 'both').map(addressBookIdentity)), seen = new Set<string>();
  return raw.map((row, index) => {
    const cp = pick(row, ['code postal', 'cp', 'postal', 'zip']);
    let city = pick(row, ['ville', 'commune', 'city']);
    if (cp && !norm(city).startsWith(norm(cp))) city = `${cp} ${city}`.trim();
    const parsed: RecipientImportRow = { line: Number.isInteger(row.__rowNum__) ? row.__rowNum__ + 1 : index + 2,
      contactName: pick(row, ['nom', 'destinataire', 'client', 'pharmacie', 'name', 'raison sociale']), address: pick(row, ['adresse', 'rue', 'address']), city,
      contactPhone: pick(row, ['telephone', 'tel', 'phone', 'portable', 'mobile', 'gsm']), contactEmail: pick(row, ['email', 'mail', 'courriel', 'e-mail']) || undefined,
      notes: pick(row, ['notes', 'consignes', 'instructions', 'commentaire', 'commentaires']) || undefined, _status: 'ok' };
    const errors = Object.values(addressBookFieldErrors(parsed));
    if (!parsed.contactPhone) errors.push('Indiquez le téléphone du destinataire.');
    if (parsed.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.contactEmail)) errors.push('Email invalide.');
    const key = addressBookIdentity(parsed);
    if (errors.length) { parsed._status = 'invalid'; parsed._reason = errors.join(' '); }
    else if (known.has(key) || seen.has(key)) { parsed._status = 'duplicate'; parsed._reason = seen.has(key) ? 'Doublon dans le fichier' : 'Déjà dans le carnet : même destinataire, rue et ville.'; }
    else seen.add(key);
    return parsed;
  });
}
