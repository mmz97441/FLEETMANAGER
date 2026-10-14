import { normAddr } from './deliveryAddress';
import { shipmentFieldErrors } from './shipmentContract';

/** A shared phone or building never identifies a recipient on its own. */
export const addressBookIdentity = (address: { address?: string; city?: string; contactName?: string }) =>
  JSON.stringify([normAddr(address.contactName), normAddr(address.address), normAddr(address.city)]);

/** SavedAddress retains its historical combined postal-code/city field. */
export function addressBookFieldErrors(address: { address?: string; city?: string; contactName?: string }) {
  const city = (address.city || '').trim(), codes = city.match(/\b\d{5}\b/g) || [];
  const errors = shipmentFieldErrors({ ...address, postalCode: codes.length === 1 ? codes[0] : '', city: city.replace(/\b\d{5}\b/g, '').trim() });
  if (errors.postalCode || errors.city) errors.city = 'Indiquez un code postal à 5 chiffres et la ville (ex. 97400 Saint-Denis).';
  delete errors.postalCode;
  return errors;
}
