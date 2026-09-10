import { VIEW_TO_PATH, pathToView } from '../routes';
import type { ViewState } from '../types';

export function notificationDestination(notification: { actionType?: string; actionTarget?: string; metadata?: Record<string, unknown> }): { view: ViewState; params: Record<string, string> } | null {
  if (notification.actionType !== 'navigate' || !notification.actionTarget) return null;
  const target = notification.actionTarget;
  let view: ViewState;
  if (Object.prototype.hasOwnProperty.call(VIEW_TO_PATH, target)) view = target as ViewState;
  else if (target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) {
    const url = new URL(target, 'https://fleet.invalid');
    if (!Object.values(VIEW_TO_PATH).includes(url.pathname)) return null;
    view = pathToView(url.pathname);
  } else return null;
  const params: Record<string, string> = {};
  if (['missions', 'tours_overview', 'fleet_map', 'driver_tour', 'client_shipments', 'client_tracking'].includes(view)) {
    for (const [key, source] of [['mission', 'missionId'], ['package', 'packageId']]) {
      const value = notification.metadata?.[source];
      if (typeof value === 'string' && value && value.length <= 200 && !value.includes('/')) params[key] = value;
    }
    if (view === 'missions') params.tab = params.package ? 'packages' : 'missions';
    if (params.package) params.scope = 'all';
  }
  return { view, params };
}
