/**
 * Mapping centralisé entre ViewState et les routes URL.
 * Garantit la compatibilité avec le système de navigation existant.
 */
import { ViewState } from './types';

// ViewState → chemin URL
export const VIEW_TO_PATH: Record<ViewState, string> = {
  dashboard: '/',
  vehicles: '/vehicles',
  drivers: '/drivers',
  fuel: '/fuel',
  maintenance: '/maintenance',
  issues: '/issues',
  users: '/users',
  permissions: '/permissions',
  help: '/help',
  map: '/map',
  ai_advisor: '/ai',
  documents: '/documents',
  company_docs: '/company-docs',
  leaves: '/leaves',
  absences: '/absences',
  quotes: '/quotes',
  settings: '/settings',
  company_settings: '/company-settings',
  activity_logs: '/activity-logs',
  error_logs: '/error-logs',
  president_overview: '/vue-de-dieu',
  fleet_map: '/carte-chauffeurs',
  tours_overview: '/suivi-tournees',
  client_tracking: '/client/suivi',
  missions: '/missions',
  notifications_settings: '/notifications-settings',
  api_diagnostic: '/api-diagnostic',
  delivery_schedule: '/delivery-schedule',
  zone_management: '/zone-management',
  hub_operations: '/hub-operations',
  driver_tour: '/driver-tour',
  driver_preview: '/driver-preview',
  import_export: '/import-export',
  client_dashboard: '/client',
  client_list: '/client/requests',
  client_team: '/client/team',
  client_shipments: '/client/shipments',
  client_analytics: '/client/statistiques',
  client_recipients: '/client/destinataires',
  client_company: '/client/entreprise',
  client_help: '/client/aide',
};

// Chemin URL → ViewState (inverse)
const pathToViewEntries = Object.entries(VIEW_TO_PATH).map(
  ([view, path]) => [path, view] as [string, ViewState]
);
// Trier par longueur décroissante pour matcher les routes les plus spécifiques en premier
pathToViewEntries.sort((a, b) => b[0].length - a[0].length);

export const PATH_TO_VIEW = new Map<string, ViewState>(pathToViewEntries);

/**
 * Convertit un chemin URL en ViewState.
 * Retourne 'dashboard' si aucune correspondance n'est trouvée.
 */
export function pathToView(pathname: string): ViewState {
  // Correspondance exacte d'abord
  const exact = PATH_TO_VIEW.get(pathname);
  if (exact) return exact;

  // Fallback: dashboard
  return 'dashboard';
}

/**
 * Convertit un ViewState en chemin URL.
 */
export function viewToPath(view: ViewState): string {
  return VIEW_TO_PATH[view] || '/';
}
