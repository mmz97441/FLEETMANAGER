import { splitRequestedDelivery } from './shipmentContract';

export function quoteWindowLabel(value: unknown): string {
  const window = value as { start?: string; end?: string; label?: string } | undefined;
  return window?.start || window?.end ? `${window.start || 'début de journée'} – ${window.end || 'fin de journée'}${window.label ? ` (${window.label})` : ''} (La Réunion)` : 'Aucun créneau indiqué';
}

/** datetime-local inputs describe Réunion time, regardless of the device zone. */
export function earliestRequestedTime(base: Date | string, delayHours: number): string {
  const instant = typeof base === 'string' ? new Date(`${base}+04:00`) : base;
  if (!Number.isFinite(instant.getTime())) return '';
  const wall = new Date(instant.getTime() + (4 + delayHours) * 3_600_000);
  if (wall.getUTCHours() >= 17) {
    wall.setUTCDate(wall.getUTCDate() + 1);
    wall.setUTCHours(8, 0, 0, 0);
  }
  return wall.toISOString().slice(0, 16);
}

export function requestedDateTimeLabel(value: unknown): string {
  if (!value) return 'À convenir';
  try {
    const fields = splitRequestedDelivery(String(value));
    const day = new Date(`${fields.requestedDeliveryDate}T12:00:00+04:00`).toLocaleDateString('fr-FR', { timeZone: 'Indian/Reunion' });
    return `${day}${fields.requestedDeliveryTime ? ` à ${fields.requestedDeliveryTime}` : ''} (La Réunion)`;
  } catch { return 'Date à vérifier'; }
}
