// ============================================================================
// clientInsights.ts — Insights automatiques et DÉTERMINISTES pour un client
// expéditeur, calculés à partir de ses colis.
// Pur TypeScript (aucune dépendance React / Firebase / API). Aucune sortie
// console. Toujours correct, instantané, gratuit.
// ============================================================================

import { Package, PackageStatus } from '../types';
import {
  computeClientMetrics,
  filterPackages,
  ClientMetricsWithTrend,
} from './clientMetrics';

// ----------------------------------------------------------------------------
// Types exportés
// ----------------------------------------------------------------------------

export interface Insight {
  id: string;
  kind: 'positive' | 'warning' | 'critical' | 'info';
  title: string;
  detail: string;
}

// ----------------------------------------------------------------------------
// Helpers privés (module)
// ----------------------------------------------------------------------------

/** Arrondi entier. */
function round0(n: number): number {
  return Math.round(n);
}

/** Arrondi à 1 décimale. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Formatage lisible d'un délai en heures. */
function formatDelay(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${round0(hours * 60)} min`;
  return `${round1(hours)} h`;
}

/** Formatage d'un taux (0-100) ou tiret si inconnu. */
function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${round0(rate)}%`;
}

/** Ordre de sévérité pour le tri (plus petit = plus prioritaire). */
function severityOrder(kind: Insight['kind']): number {
  switch (kind) {
    case 'critical':
      return 0;
    case 'warning':
      return 1;
    case 'positive':
      return 2;
    case 'info':
    default:
      return 3;
  }
}

/** Un colis compte comme "échec" (échoué ou retourné). */
function isFailure(p: Package): boolean {
  return p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED;
}

interface DimensionStat {
  label: string;
  total: number;
  failed: number;
}

/** Agrège total + échecs par dimension (clé -> stat) à partir d'une liste. */
function aggregateFailures(
  packages: Package[],
  keyOf: (p: Package) => string,
): Map<string, DimensionStat> {
  const map = new Map<string, DimensionStat>();
  for (const p of packages) {
    if (!p) continue;
    const label = keyOf(p);
    const entry = map.get(label) || { label, total: 0, failed: 0 };
    entry.total++;
    if (isFailure(p)) entry.failed++;
    map.set(label, entry);
  }
  return map;
}

// ----------------------------------------------------------------------------
// API publique
// ----------------------------------------------------------------------------

const MIN_DIMENSION_VOLUME = 5;

/**
 * Produit des insights "ce qui compte" pour un client, sur les 30 derniers
 * jours. Déterministe : mêmes colis en entrée → mêmes insights en sortie.
 * Renvoie au plus 5 insights, triés par sévérité (critical, warning,
 * positive, info).
 */
export function getClientInsights(packages: Package[]): Insight[] {
  const list = Array.isArray(packages) ? packages : [];

  const metrics: ClientMetricsWithTrend = computeClientMetrics(list, { period: '30d' });
  const { previous } = metrics;

  // Cas: aucune donnée exploitable sur la période.
  if (metrics.total === 0) {
    return [
      {
        id: 'no-data',
        kind: 'info',
        title: 'Pas encore de données',
        detail: 'Créez des expéditions pour voir vos indicateurs.',
      },
    ];
  }

  // Liste filtrée (même fenêtre que les métriques) pour les analyses
  // par dimension que le moteur de métriques n'expose pas.
  const filtered = filterPackages(list, { period: '30d' });

  const insights: Insight[] = [];

  // --- Règle 1 : Ponctualité (baisse / hausse) ---
  if (metrics.punctualityRate !== null && previous.punctualityRate !== null) {
    const delta = metrics.punctualityRate - previous.punctualityRate;
    const pts = round0(Math.abs(delta));
    const current = round0(metrics.punctualityRate);
    if (delta <= -5) {
      insights.push({
        id: 'punctuality-drop',
        kind: 'warning',
        title: 'Ponctualité en baisse',
        detail: `−${pts} pts vs période précédente (actuel ${current}%)`,
      });
    } else if (delta >= 5) {
      insights.push({
        id: 'punctuality-rise',
        kind: 'positive',
        title: `Ponctualité en hausse (+${pts} pts)`,
        detail: `Actuel ${current}% vs ${round0(previous.punctualityRate)}% avant`,
      });
    }
  }

  // --- Règle 2 : Taux de livraison sous l'objectif ---
  if (metrics.deliveryRate < 90) {
    insights.push({
      id: 'delivery-rate-low',
      kind: 'warning',
      title: "Taux de livraison sous l'objectif",
      detail: `${round0(metrics.deliveryRate)}% (objectif 95%)`,
    });
  }

  // --- Règle 3 : Concentration d'échecs (par zone puis par pharmacie) ---
  const globalTotal = filtered.length;
  const globalFailed = filtered.reduce((acc, p) => acc + (isFailure(p) ? 1 : 0), 0);
  const globalFailureRate = globalTotal > 0 ? (globalFailed / globalTotal) * 100 : 0;

  if (globalFailureRate > 0) {
    const zoneStats = aggregateFailures(filtered, (p) => (p.zone as string) || '—');
    const pharmacyStats = aggregateFailures(filtered, (p) => (p.contactName || '').trim() || '—');

    const evalDimension = (
      stats: Map<string, DimensionStat>,
      idPrefix: string,
    ): void => {
      const entries = Array.from(stats.values())
        .filter((s) => s.total >= MIN_DIMENSION_VOLUME)
        .map((s) => ({ ...s, rate: (s.failed / s.total) * 100 }))
        .filter((s) => s.rate >= 2 * globalFailureRate)
        // Tri déterministe : pire taux d'abord, puis label.
        .sort((a, b) => (b.rate - a.rate) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

      for (const s of entries) {
        insights.push({
          id: `${idPrefix}-${s.label}`,
          kind: 'critical',
          title: `Échecs concentrés — ${s.label}`,
          detail: `${round0(s.rate)}% d'échecs vs ${round0(globalFailureRate)}% en moyenne`,
        });
      }
    };

    evalDimension(zoneStats, 'failure-hotspot-zone');
    evalDimension(pharmacyStats, 'failure-hotspot-pharmacy');
  }

  // --- Règle 4 : Concentration sur une pharmacie ---
  const topPharmacy = metrics.byPharmacy[0];
  if (topPharmacy && metrics.total > 0) {
    const share = topPharmacy.count / metrics.total;
    if (share >= 0.3) {
      insights.push({
        id: 'concentration',
        kind: 'info',
        title: `${topPharmacy.name} = ${round0(share * 100)}% de vos colis`,
        detail: `${topPharmacy.count} colis sur ${metrics.total} concentrés sur un seul point.`,
      });
    }
  }

  // --- Règle 5 : Évolution des délais ---
  if (metrics.avgDelayHours !== null && previous.avgDelayHours !== null && previous.avgDelayHours > 0) {
    const current = metrics.avgDelayHours;
    const prev = previous.avgDelayHours;
    if (current > prev * 1.2) {
      insights.push({
        id: 'delay-up',
        kind: 'warning',
        title: 'Délais en hausse',
        detail: `${formatDelay(current)} en moyenne vs ${formatDelay(prev)} avant`,
      });
    } else if (current < prev * 0.8) {
      insights.push({
        id: 'delay-down',
        kind: 'positive',
        title: 'Livraisons plus rapides',
        detail: `${formatDelay(current)} en moyenne vs ${formatDelay(prev)} avant`,
      });
    }
  }

  // --- Règle 6 : Tendance de volume ---
  if (previous.total > 0) {
    const delta = metrics.total - previous.total;
    const variation = Math.abs(delta) / previous.total;
    if (variation >= 0.25) {
      const direction = delta >= 0 ? 'hausse' : 'baisse';
      insights.push({
        id: 'volume-trend',
        kind: 'info',
        title: `Volume en ${direction} de ${round0(variation * 100)}%`,
        detail: `${metrics.total} colis vs ${previous.total} sur la période précédente.`,
      });
    }
  }

  // --- Règle 7 : Tout roule (si aucun warning ni critical) ---
  const hasAlert = insights.some((i) => i.kind === 'warning' || i.kind === 'critical');
  if (!hasAlert) {
    insights.push({
      id: 'all-good',
      kind: 'positive',
      title: 'Tout roule',
      detail: `Taux ${formatRate(metrics.deliveryRate)} · ponctualité ${formatRate(metrics.punctualityRate)} · délai moyen ${formatDelay(metrics.avgDelayHours)}`,
    });
  }

  // Tri par sévérité (stable) puis plafond à 5.
  const sorted = insights
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => (severityOrder(a.insight.kind) - severityOrder(b.insight.kind)) || (a.index - b.index))
    .map((x) => x.insight);

  return sorted.slice(0, 5);
}
