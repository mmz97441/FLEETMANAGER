// ============================================================================
// clientMetrics.ts — Analytics in-memory pour un client expéditeur
// Pur TypeScript (aucune dépendance React / Firebase). Aucune sortie console.
// ============================================================================

import { Package, PackageStatus, PackageMovement } from '../types';
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
  deliveryRate: number; // 0-100 = delivered / (delivered+failed+inDelivery) *100, 0 if denom 0
  punctualityRate: number | null; // % delivered on/before ETA; null si aucun n'avait d'ETA
  avgDelayHours: number | null; // moyenne h entre 1er mouvement et mouvement DELIVERED
  pharmacies: number; // points de livraison distincts (adresse+ville normalisés)
  weightTotal: number;
  byDay: { date: string; delivered: number; total: number }[]; // asc chronologique (YYYY-MM-DD)
  byPharmacy: { name: string; count: number; delivered: number }[]; // desc par count, top 10
  byZone: { zone: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
}

export interface ClientMetricsWithTrend extends ClientMetrics {
  previous: Pick<ClientMetrics, 'total' | 'deliveryRate' | 'punctualityRate' | 'avgDelayHours'>;
}

// ----------------------------------------------------------------------------
// Helpers privés (module)
// ----------------------------------------------------------------------------

/** Parse robuste d'une date ISO. Renvoie null si absente/invalide. */
function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Clé "YYYY-MM-DD" locale d'une Date. */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Dernier mouvement avec action === 'DELIVERED' (ou null). */
function deliveredMovement(p: Package): PackageMovement | null {
  const movements = p.movements;
  if (!Array.isArray(movements) || movements.length === 0) return null;
  for (let i = movements.length - 1; i >= 0; i--) {
    if (movements[i] && movements[i].action === 'DELIVERED') return movements[i];
  }
  return null;
}

/** Timestamp du 1er mouvement, sinon createdAt. */
function firstMovementTs(p: Package): string | undefined {
  const movements = p.movements;
  if (Array.isArray(movements) && movements.length > 0 && movements[0]) {
    return movements[0].timestamp || p.createdAt;
  }
  return p.createdAt;
}

// Clé de point de livraison = placeKey (utils/address.ts), cohérente avec le
// dispatch : adresse+CP+ville normalisés (accents/espaces). Avant, cette copie
// locale (address|city sans CP ni accents) comptait les points différemment.
const pointKey = placeKey;

/** Un colis est "livré" au sens statut. */
function isDelivered(p: Package): boolean {
  return p.status === PackageStatus.DELIVERED;
}

// ----------------------------------------------------------------------------
// Fenêtres temporelles
// ----------------------------------------------------------------------------

interface DateRange {
  start: Date | null; // inclus ; null = pas de borne basse
  end: Date | null; // exclu ; null = pas de borne haute
}

/** Fenêtre "courante" pour une période donnée, relative à `now`. */
function currentRange(period: MetricPeriod, now: Date): DateRange {
  switch (period) {
    case '7d': {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start, end: now };
    }
    case '30d': {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start, end: now };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: now };
    }
    case 'all':
    default:
      return { start: null, end: null };
  }
}

/** Fenêtre "précédente" comparable (même longueur, décalée en arrière). */
function previousRange(period: MetricPeriod, now: Date): DateRange | null {
  switch (period) {
    case '7d': {
      const end = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      return { start, end };
    }
    case '30d': {
      const end = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      return { start, end };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end };
    }
    case 'all':
    default:
      return null; // pas de fenêtre précédente pour 'all'
  }
}

/** True si `d` est dans [start, end) (bornes nulles = illimité). */
function inRange(d: Date | null, range: DateRange): boolean {
  if (!d) return false;
  if (range.start && d < range.start) return false;
  if (range.end && d >= range.end) return false;
  return true;
}

/** Applique les filtres pharmacy/zone (sans la période). */
function matchesDimensions(p: Package, filters: MetricsFilters): boolean {
  if (filters.pharmacy && p.contactName !== filters.pharmacy) return false;
  if (filters.zone && (p.zone as string) !== filters.zone) return false;
  return true;
}

/** Filtre par plage de dates + dimensions (usage interne, ex. fenêtre précédente). */
function filterByRange(packages: Package[], range: DateRange, filters: MetricsFilters): Package[] {
  if (!Array.isArray(packages)) return [];
  return packages.filter((p) => {
    if (!p) return false;
    if (!inRange(toDate(p.createdAt), range)) return false;
    return matchesDimensions(p, filters);
  });
}

// ----------------------------------------------------------------------------
// API publique
// ----------------------------------------------------------------------------

/**
 * Filtre les colis selon la période (fenêtre courante) + pharmacy + zone.
 */
export function filterPackages(packages: Package[], filters: MetricsFilters): Package[] {
  if (!Array.isArray(packages)) return [];
  const now = new Date();
  const range = currentRange(filters.period, now);
  return filterByRange(packages, range, filters);
}

/**
 * Calcule le sous-ensemble "previous" (pour comparaison de deltas).
 */
function computeCore(packages: Package[]): ClientMetrics {
  const list = Array.isArray(packages) ? packages.filter((p): p is Package => !!p) : [];

  let delivered = 0;
  let failed = 0;
  let inDelivery = 0;
  let pending = 0;
  let weightTotal = 0;

  const points = new Set<string>();
  const byDayMap = new Map<string, { date: string; delivered: number; total: number }>();
  const byPharmacyMap = new Map<string, { name: string; count: number; delivered: number }>();
  const byZoneMap = new Map<string, number>();
  const statusMap = new Map<string, number>();

  // Ponctualité
  let punctualDenom = 0; // colis livrés AYANT une ETA
  let punctualNum = 0;

  // Délai moyen
  let delaySum = 0;
  let delayCount = 0;

  for (const p of list) {
    const del = isDelivered(p);
    if (del) delivered++;
    else if (p.status === PackageStatus.FAILED) failed++;
    else if (p.status === PackageStatus.IN_DELIVERY) inDelivery++;
    else if (p.status === PackageStatus.PENDING) pending++;

    if (typeof p.weight === 'number' && Number.isFinite(p.weight)) {
      weightTotal += p.weight;
    }

    points.add(pointKey(p));

    // byDay (fenêtre = colis présents, groupés par jour de createdAt)
    const created = toDate(p.createdAt);
    if (created) {
      const key = dayKey(created);
      const entry = byDayMap.get(key) || { date: key, delivered: 0, total: 0 };
      entry.total++;
      if (del) entry.delivered++;
      byDayMap.set(key, entry);
    }

    // byPharmacy (nom = contactName)
    const name = (p.contactName || '').trim() || '—';
    const ph = byPharmacyMap.get(name) || { name, count: 0, delivered: 0 };
    ph.count++;
    if (del) ph.delivered++;
    byPharmacyMap.set(name, ph);

    // byZone
    const zoneKey = (p.zone as string) || '—';
    byZoneMap.set(zoneKey, (byZoneMap.get(zoneKey) || 0) + 1);

    // statusBreakdown
    const st = (p.status as string) || '—';
    statusMap.set(st, (statusMap.get(st) || 0) + 1);

    // Ponctualité + délai : basés sur le mouvement DELIVERED
    const dm = deliveredMovement(p);
    if (dm) {
      const dmTs = toDate(dm.timestamp);
      const eta = toDate(p.estimatedDeliveryAt);
      if (eta && dmTs) {
        punctualDenom++;
        if (dmTs <= eta) punctualNum++;
      }
      const startTs = toDate(firstMovementTs(p));
      if (startTs && dmTs) {
        const hours = (dmTs.getTime() - startTs.getTime()) / (1000 * 60 * 60);
        if (hours >= 0 && hours <= 720) {
          delaySum += hours;
          delayCount++;
        }
      }
    }
  }

  const total = list.length;
  const rateDenom = delivered + failed + inDelivery;
  const deliveryRate = rateDenom > 0 ? (delivered / rateDenom) * 100 : 0;
  const punctualityRate = punctualDenom > 0 ? (punctualNum / punctualDenom) * 100 : null;
  const avgDelayHours = delayCount > 0 ? delaySum / delayCount : null;

  const byDay = Array.from(byDayMap.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const byPharmacy = Array.from(byPharmacyMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const byZone = Array.from(byZoneMap.entries())
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count);

  const statusBreakdown = Array.from(statusMap.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    delivered,
    failed,
    inDelivery,
    pending,
    deliveryRate,
    punctualityRate,
    avgDelayHours,
    pharmacies: points.size,
    weightTotal,
    byDay,
    byPharmacy,
    byZone,
    statusBreakdown,
  };
}

/**
 * Calcule toutes les métriques pour un client, plus la fenêtre précédente
 * comparable exposée via `previous`.
 */
export function computeClientMetrics(packages: Package[], filters: MetricsFilters): ClientMetricsWithTrend {
  const now = new Date();
  const currentList = filterPackages(packages, filters);
  const current = computeCore(currentList);

  const prevRange = previousRange(filters.period, now);
  let previous: ClientMetricsWithTrend['previous'];

  if (!prevRange) {
    // 'all' → pas de fenêtre précédente
    previous = {
      total: 0,
      deliveryRate: 0,
      punctualityRate: null,
      avgDelayHours: null,
    };
  } else {
    const prevList = filterByRange(packages, prevRange, filters);
    const prev = computeCore(prevList);
    previous = {
      total: prev.total,
      deliveryRate: prev.deliveryRate,
      punctualityRate: prev.punctualityRate,
      avgDelayHours: prev.avgDelayHours,
    };
  }

  return { ...current, previous };
}
