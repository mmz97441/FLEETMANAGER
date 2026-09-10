export interface ClientShipmentFields {
  contactName: string;
  address: string;
  postalCode: string;
  city: string;
  contactPhone: string;
  contactEmail: string;
  packageCount: number;
  weight: string;
}

export type ClientShipmentErrors = Partial<Record<keyof ClientShipmentFields, string>>;

/** Client-side guidance only; the server remains responsible for authorization. */
export function validateClientShipment(fields: ClientShipmentFields): ClientShipmentErrors {
  const errors: ClientShipmentErrors = {};
  if (!fields.contactName.trim()) errors.contactName = 'Indiquez le nom du destinataire.';
  if (!fields.address.trim()) errors.address = 'Indiquez la rue et le numéro du destinataire.';
  if (!fields.postalCode.trim() && !fields.city.trim()) errors.city = 'Indiquez une ville ou un code postal.';
  if (fields.postalCode.trim() && !/^\d{5}$/.test(fields.postalCode.trim())) errors.postalCode = 'Le code postal doit contenir 5 chiffres.';
  if (!fields.contactPhone.trim()) errors.contactPhone = 'Indiquez un téléphone pour joindre le destinataire.';
  if (fields.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contactEmail.trim())) errors.contactEmail = 'Indiquez une adresse email valide, ou laissez ce champ vide.';
  if (!Number.isInteger(fields.packageCount) || fields.packageCount < 1 || fields.packageCount > 50) errors.packageCount = 'Indiquez un nombre entier entre 1 et 50 colis.';
  if (fields.weight.trim() && (!Number.isFinite(Number(fields.weight)) || Number(fields.weight) < 0)) errors.weight = 'Indiquez un poids positif ou nul en kilogrammes.';
  return errors;
}

/** A rejected row is counted once even when it also has validation errors. */
export function shipmentImportCounts<T extends { line: number; errors: string[] }>(rows: T[], confirmedLines: ReadonlySet<number>) {
  const duplicates = rows.filter(row => row.errors.some(error => /double|doublon/i.test(error)));
  const invalid = rows.filter(row => row.errors.length > 0 && !duplicates.includes(row));
  const confirmed = rows.filter(row => confirmedLines.has(row.line));
  const pending = rows.filter(row => row.errors.length === 0 && !confirmedLines.has(row.line));
  return { total: rows.length, confirmed: confirmed.length, duplicates: duplicates.length, invalid: invalid.length, pending: pending.length };
}
