import { isCalendarDate, shipmentFieldErrors, splitRequestedDelivery } from './shipmentContract';
export function shipmentMigrationPlan(id: string, parcel: any, quote?: any): { addressIssues: Record<string, string>; patch?: Record<string, unknown>; reason?: string } {
  const allErrors = shipmentFieldErrors(parcel);
  const addressIssues = Object.fromEntries(Object.entries(allErrors).filter(([field]) => ['contactName', 'address', 'city', 'postalCode'].includes(field)));
  const result = { addressIssues };
  if (!parcel.requestedDeliveryDate || isCalendarDate(parcel.requestedDeliveryDate)) return result;
  if (!['En attente', 'Collecté', 'Au hub', 'Trié', 'En transit', 'Chargé'].includes(parcel.status)) return { ...result, reason: 'historical-or-terminal' };
  if (parcel.missionId || parcel.stopId || parcel.currentDriverId) return { ...result, reason: 'assigned-plan' };
  if (!quote || quote.convertedToPackageId !== id || quote.deliveryDate !== parcel.requestedDeliveryDate) return { ...result, reason: 'unproven-quote-source' };
  let date;
  try { date = splitRequestedDelivery(parcel.requestedDeliveryDate); } catch { return { ...result, reason: 'invalid-date' }; }
  if (parcel.requestedDeliveryTime && parcel.requestedDeliveryTime !== date.requestedDeliveryTime) return { ...result, reason: 'conflicting-time' };
  const note = date.requestedDeliveryTime ? `Heure de livraison souhaitée : ${date.requestedDeliveryTime} (La Réunion)` : '';
  return { ...result, patch: { ...date,
    ...(note && !String(parcel.comment || '').includes(note) ? { comment: [parcel.comment, note].filter(Boolean).join(' | ') } : {}),
    shipmentContractMigration: { version: 1, originalRequestedDeliveryDate: parcel.requestedDeliveryDate },
  } };
}
