import { createStopForm } from './missionStopForm';
import type { PendingManualStop } from './pendingManualStop';

export interface DriverManualStopForm {
  contactName: string;
  address: string;
  postalCode: string;
  city: string;
  contactPhone: string;
}

export const emptyDriverManualStop = (): DriverManualStopForm => ({ contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });

/** Same complete journal shape as the office, so either entry point can resume it. */
export function makeDriverManualStopRequest(mission: { id: string; date: string }, form: DriverManualStopForm, requestId: string): PendingManualStop {
  return { missionId: mission.id, date: mission.date, requestId,
    form: createStopForm({ contactName: form.contactName.trim() || 'Arrêt manuel', address: form.address.trim(), postalCode: form.postalCode.trim(), city: form.city.trim(), contactPhone: form.contactPhone.trim() }) };
}
