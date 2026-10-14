/** Pure shipment rules shared by import, self-service creation and conversion. */
export interface ShipmentFields {
  contactName?: unknown; address?: unknown; postalCode?: unknown; city?: unknown;
  requestedDeliveryDate?: unknown; timeWindowStart?: unknown; timeWindowEnd?: unknown; serviceTime?: unknown;
}
export const isCalendarDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const isDeliveryTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function shipmentFieldErrors(fields: ShipmentFields): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!text(fields.contactName)) errors.contactName = 'Indiquez le nom du destinataire.';
  if (!text(fields.address)) errors.address = 'Indiquez la rue et le numéro du destinataire.';
  if (!text(fields.postalCode)) errors.postalCode = 'Indiquez le code postal du destinataire.';
  else if (!/^\d{5}$/.test(text(fields.postalCode))) errors.postalCode = 'Le code postal doit contenir 5 chiffres.';
  if (!text(fields.city)) errors.city = 'Indiquez la ville du destinataire.';
  if (fields.requestedDeliveryDate != null && fields.requestedDeliveryDate !== '' && !isCalendarDate(fields.requestedDeliveryDate)) errors.requestedDeliveryDate = 'Indiquez une date de livraison valide (AAAA-MM-JJ).';
  for (const field of ['timeWindowStart', 'timeWindowEnd'] as const) if (fields[field] != null && fields[field] !== '' && !isDeliveryTime(fields[field])) errors[field] = 'Indiquez une heure au format HH:MM.';
  if (isDeliveryTime(fields.timeWindowStart) && isDeliveryTime(fields.timeWindowEnd) && fields.timeWindowEnd <= fields.timeWindowStart) errors.timeWindowEnd = 'La fin du créneau doit suivre le début.';
  if (fields.serviceTime != null && (typeof fields.serviceTime !== 'number' || !Number.isFinite(fields.serviceTime) || fields.serviceTime < 1 || fields.serviceTime > 480)) errors.serviceTime = 'La durée sur place doit être comprise entre 1 et 480 minutes.';
  return errors;
}
/** Bare datetimes originate from a Réunion datetime-local input. Explicit offsets
 * are converted to Réunion, never interpreted using the server/browser timezone. */
export function splitRequestedDelivery(value: unknown): { requestedDeliveryDate: string; requestedDeliveryTime?: string } {
  if (isCalendarDate(value)) return { requestedDeliveryDate: value };
  if (typeof value !== 'string') throw new Error('Date de livraison invalide.');
  const local = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::([0-5]\d)(?:\.\d{1,3})?)?$/);
  if (local && isCalendarDate(local[1]) && isDeliveryTime(local[2])) return { requestedDeliveryDate: local[1], requestedDeliveryTime: local[2] };
  const zoned = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/);
  if (zoned && isCalendarDate(zoned[1]) && isDeliveryTime(zoned[2]) && Number.isFinite(Date.parse(value))) {
    const reunion = new Date(Date.parse(value) + 4 * 60 * 60 * 1000).toISOString();
    return { requestedDeliveryDate: reunion.slice(0, 10), requestedDeliveryTime: reunion.slice(11, 16) };
  }
  throw new Error('Date de livraison invalide.');
}
export function quoteShipmentFields(quote: any) {
  const destination = text(quote.destination), street = text(quote.destinationAddress);
  // The explicit city field takes precedence: a five-digit street/building
  // number is not a postal code. Legacy full addresses are accepted only when
  // their trailing municipality agrees with the separate destination field.
  const destinationCodes = [...new Set(destination.match(/\b\d{5}\b/g) || [])];
  if (destinationCodes.length > 1) throw new Error('Plusieurs codes postaux de destination sont indiqués. Faites vérifier l’adresse.');
  const city = destination.replace(/\b\d{5}\b/g, '').replace(/^[\s,;()]+|[\s,;()]+$/g, '').trim();
  const cityKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const suffixes = [...street.matchAll(/\b(\d{5})\b/g)].filter(match =>
    cityKey(street.slice(match.index! + match[0].length)) === cityKey(city) && !!cityKey(city));
  const postalCode = destinationCodes[0] || (suffixes.length === 1 ? suffixes[0][1] : '');
  const duplicateSuffix = suffixes.find(match => match[1] === postalCode);
  const address = duplicateSuffix ? street.slice(0, duplicateSuffix.index).replace(/[\s,;]+$/, '') : street;
  const fields = {
    contactName: text(quote.destinationContact?.name), address, postalCode, city,
    ...(quote.deliveryDate || quote.requestedDeliveryDate ? splitRequestedDelivery(quote.deliveryDate || quote.requestedDeliveryDate) : {}),
    timeWindowStart: text(quote.deliveryTimeWindow?.start) || null,
    timeWindowEnd: text(quote.deliveryTimeWindow?.end) || null,
  };
  const errors = shipmentFieldErrors(fields);
  if (Object.keys(errors).length) throw new Error(Object.values(errors).join(' '));
  return fields;
}
