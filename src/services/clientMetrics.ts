// ============================================================================
// clientMetrics.ts — Analytics in-memory pour un client expéditeur
// Pur TypeScript (aucune dépendance React / Firebase). Aucune sortie console.
// ============================================================================

import { Package, PackageStatus } from '../types';
// Source de vérité UNIQUE du regroupement par point de livraison.
import { placeKey } from '../utils/address';

// ----------------------------------------------------------------------------
// Types exportés
// ----------------------------------------------------------------------------

export type MetricPeriod = '7d' | '30d' | 'month' | 'all';

export interface MetricsFilters {
  period: MetricPeriod;
  pharmacy?: string;
  zone?: string;
}

export interface ClientMetrics {
  total: number;
  delivered: number;
  failed: number;
  inDelivery: number;
  pending: number;
  deliveryRate: number; // Success / decided attempts; no work in progress in denominator.
  resolved: number;
  workInProgress: number;
  undatedOutcomes: number;
  etaAdherenceRate: number | null;
  punctualityRate: number | null; // % within the customer promise, independently of route ETA.
  avgDelayHours: number | null; // moyenne h entre 1er mouvement et mouvement DELIVERED
  pharmacies: number; // points de livraison distincts (adresse+ville normalisés)
  weightTotal: number;
  byDay: { date: string; delivered: number; failed: number; total: number }[]; // asc chronologique (YYYY-MM-DD)
  byPharmacy: { name: string; count: number; delivered: number }[]; // desc par count, top 10
  byZone: { zone: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
}

export interface ClientMetricsWithTrend extends ClientMetrics {
  previous: Pick<ClientMetrics, 'total' | 'resolved' | 'deliveryRate' | 'punctualityRate' | 'avgDelayHours'>;
}

// Cohort dimensions and event metrics deliberately have separate clocks.
// A parcel created last month and handed over today contributes to today's
// delivered count, never to today's created volume.
import { summarizeLogistics, inLogisticsRange, logisticsDay, LogisticsRange, currentDimensions, matchesLogisticsDimensions, LogisticsDimensions } from './logisticsMetrics';

export function metricsRange(period: MetricPeriod, now = new Date(), previous = false): LogisticsRange | undefined {
  if (period === 'all') return undefined;
  const today = logisticsDay(now);
  const anchor = new Date(`${today}T00:00:00Z`);
  const key = (date: Date) => date.toISOString().slice(0, 10);
  if (period === 'month') {
    const month = anchor.getUTCMonth() - (previous ? 1 : 0);
    return { start: key(new Date(Date.UTC(anchor.getUTCFullYear(), month, 1))),
      end: previous ? key(new Date(Date.UTC(anchor.getUTCFullYear(), month + 1, 0))) : today };
  }
  const days = period === '7d' ? 7 : 30;
  const end = new Date(anchor.getTime() - (previous ? days : 0) * 86400000);
  return { start: key(new Date(end.getTime() - (days - 1) * 86400000)), end: key(end) };
}

const matchesDimensions = (p: Package, filters: MetricsFilters) => matchesLogisticsDimensions(currentDimensions(p), filters);

/** Creation cohort, for lists of shipments created during the chosen period. */
export function filterPackages(packages: Package[], filters: MetricsFilters): Package[] {
  const range = metricsRange(filters.period);
  return (Array.isArray(packages) ? packages : []).filter(p => p && matchesDimensions(p, filters) && inLogisticsRange(p.createdAt, range));
}

function computeCore(packages: Package[], range?: LogisticsRange, dimensions?: LogisticsDimensions): ClientMetrics {
  const summary = summarizeLogistics(packages, range, dimensions);
  const byPharmacy = new Map<string, { name: string; count: number; delivered: number }>();
  const byZone = new Map<string, number>();
  const statuses = new Map<string, number>();
  for (const p of summary.created) {
    const name = p.contactName?.trim() || '—';
    const entry = byPharmacy.get(name) || { name, count: 0, delivered: 0 };
    entry.count++;
    if (p.status === PackageStatus.DELIVERED) entry.delivered++;
    byPharmacy.set(name, entry);
    byZone.set(p.zone || '—', (byZone.get(p.zone || '—') || 0) + 1);
    statuses.set(p.status, (statuses.get(p.status) || 0) + 1);
  }
  return {
    total: summary.total, delivered: summary.delivered, failed: summary.failed,
    pending: summary.pending, inDelivery: summary.inDelivery, deliveryRate: summary.deliveryRate,
    punctualityRate: summary.punctualityRate, etaAdherenceRate: summary.etaAdherenceRate,
    avgDelayHours: summary.avgDelayHours, resolved: summary.resolved,
    workInProgress: summary.workInProgress, undatedOutcomes: summary.undatedOutcomes,
    pharmacies: new Set(summary.created.map(placeKey)).size,
    weightTotal: summary.created.reduce((sum, p) => sum + (Number.isFinite(p.weight) ? p.weight! : 0), 0),
    byDay: summary.byDay,
    byPharmacy: [...byPharmacy.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    byZone: [...byZone].map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count),
    statusBreakdown: [...statuses].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
  };
}

export function computeClientMetrics(packages: Package[], filters: MetricsFilters): ClientMetricsWithTrend {
  const list = (Array.isArray(packages) ? packages : []).filter(Boolean);
  const now = new Date();
  const current = computeCore(list, metricsRange(filters.period, now), filters);
  const previous = filters.period === 'all'
    ? { total: 0, resolved: 0, deliveryRate: 0, punctualityRate: null, avgDelayHours: null }
    : computeCore(list, metricsRange(filters.period, now, true), filters);
  return { ...current, previous };
}
