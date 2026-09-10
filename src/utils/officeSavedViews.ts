import { PackageStatus, Zone } from '../types';

const allowed: Record<string, readonly string[]> = {
  tab: ['missions', 'packages'], zone: ['all', ...Object.values(Zone)],
  status: ['all', 'failed', ...Object.values(PackageStatus)], scope: ['all', 'date'],
  sort: ['orderNumber', 'externalId', 'contactName', 'city', 'zone', 'status', 'createdAt'], dir: ['asc', 'desc'], pageSize: ['50', '100'],
};

/** Bookmarks contain filters only, never recipients, package IDs or a stale action selection. */
export function officeViewParams(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => typeof value === 'string' && allowed[key]?.includes(value)));
}

export interface OfficeSavedView { id: string; label: string; params: Record<string, string>; }
export function readOfficeSavedViews(raw: string | null): OfficeSavedView[] {
  try {
    const values: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(values)) return [];
    return values.slice(0, 8).flatMap(value => {
      if (!value || typeof value.id !== 'string' || typeof value.label !== 'string') return [];
      const params = officeViewParams(value.params);
      return params.tab ? [{ id: value.id.slice(0, 100), label: value.label.slice(0, 120), params }] : [];
    });
  } catch { return []; }
}
