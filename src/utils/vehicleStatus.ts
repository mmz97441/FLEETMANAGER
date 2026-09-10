import { VehicleStatus } from '../types';

/** Unknown or negative statuses must never make a vehicle available for dispatch. */
export const mapDbStatusToApp = (value: unknown): VehicleStatus => {
  const status = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[_\s]+/g, ' ').trim();
  if (['immobilise', 'immobilized', 'hors service', 'out of service', 'inactif', 'inactive'].includes(status)) return VehicleStatus.IMMOBILIZED;
  if (['maintenance', 'en maintenance', 'garage', 'au garage'].includes(status)) return VehicleStatus.MAINTENANCE;
  if (['actif', 'active', 'en service'].includes(status)) return VehicleStatus.ACTIVE;
  if (['disponible', 'idle'].includes(status)) return VehicleStatus.IDLE;
  return VehicleStatus.ISSUE;
};
