import type { MissionStop } from '../types';

export const STOP_FIELDS = ['contactName', 'contactPhone', 'address', 'postalCode', 'city', 'timeWindowStart', 'timeWindowEnd', 'serviceTime', 'notes'] as const;
export type StopField = typeof STOP_FIELDS[number];
export type StopForm = Record<StopField, string>;
export type StopFormErrors = Partial<Record<StopField, string>>;

export function createStopForm(stop?: Partial<MissionStop>): StopForm {
  return Object.fromEntries(STOP_FIELDS.map(key => [key, String(stop?.[key] ?? (key === 'serviceTime' ? 5 : ''))])) as StopForm;
}

/** Do not silently restore old values or truncate an invalid duration. */
export function validateStopForm(form: StopForm): StopFormErrors {
  const errors: StopFormErrors = {};
  for (const key of ['contactName', 'address', 'postalCode', 'city'] as const) {
    if (!form[key].trim()) errors[key] = 'Ce champ est obligatoire.';
  }
  if (form.postalCode.trim() && !/^\d{5}$/.test(form.postalCode.trim())) errors.postalCode = 'Indiquez un code postal de 5 chiffres.';
  const duration = Number(form.serviceTime);
  if (!form.serviceTime.trim() || !Number.isInteger(duration) || duration < 1 || duration > 480) {
    errors.serviceTime = 'Indiquez une durée entière de 1 à 480 minutes.';
  }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (form.timeWindowStart && !time.test(form.timeWindowStart)) errors.timeWindowStart = 'Indiquez une heure valide.';
  if (form.timeWindowEnd && !time.test(form.timeWindowEnd)) errors.timeWindowEnd = 'Indiquez une heure valide.';
  if (form.timeWindowStart && !form.timeWindowEnd) errors.timeWindowEnd = 'Renseignez la fin du créneau ou effacez son début.';
  if (form.timeWindowEnd && !form.timeWindowStart) errors.timeWindowStart = 'Renseignez le début du créneau ou effacez sa fin.';
  if (form.timeWindowStart && form.timeWindowEnd && form.timeWindowStart >= form.timeWindowEnd) errors.timeWindowEnd = 'La fin doit être après le début, le même jour.';
  return errors;
}

export function stopFormPayload(form: StopForm) {
  return {
    contactName: form.contactName.trim(), address: form.address.trim(), city: form.city.trim(), postalCode: form.postalCode.trim(),
    contactPhone: form.contactPhone.trim() || null, timeWindowStart: form.timeWindowStart || null,
    timeWindowEnd: form.timeWindowEnd || null, notes: form.notes.trim() || null, serviceTime: Number(form.serviceTime),
  };
}
