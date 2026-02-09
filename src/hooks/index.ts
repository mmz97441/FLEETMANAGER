// Hooks personnalisés - FleetGenius Pro

// Role normalization utility
export { normalizeRole } from '../utils/roleUtils';

// Véhicules
export {
  useVehicles,
  getDriverId,
  getEffectiveStatus,
  getMaintenanceHealth,
  getActiveIssuesCount,
  formatVehicleType
} from './useVehicles';

export type {
  SortOption,
  ViewMode,
  VehicleStats,
  MaintenanceHealth,
  EffectiveStatus
} from './useVehicles';

// Formulaire véhicule
export { 
  useVehicleForm,
  getInitialFormData
} from './useVehicleForm';

export type {
  FormTab,
  VehicleFormData,
  ConfirmState
} from './useVehicleForm';
