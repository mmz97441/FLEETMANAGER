// ============================================================================
// aiAnalytics.ts — Analytics en langage naturel, SANS hallucination de chiffres
// ----------------------------------------------------------------------------
// Principe : le LLM NE PRODUIT AUCUN CHIFFRE. Il se contente d'interpréter la
// question FR de l'utilisateur en une « spec » contrainte (grammaire fermée).
// Tous les nombres sont ensuite calculés par NOTRE code déterministe
// (executeSpec, qui s'appuie sur clientMetrics). => zéro chiffre inventé.
//
// Pipeline runQuery :
//   1. Interprétation LLM  -> JSON strict (AnalyticsSpec)
//   2. Validation          -> enums + pharmacies/zones connues
//   3. Auto-cohérence      -> 2 interprétations ; désaccord => on demande à préciser
//   4. Calcul déterministe -> executeSpec (SEULE source de nombres)
//   5. Narratif template   -> construit à partir des valeurs calculées (pas de LLM)
// ============================================================================

import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { Package, PackageStatus, PackageMovement } from '../types';
import {
  filterPackages,
  computeClientMetrics,
  MetricPeriod,
  MetricsFilters, metricsRange,
} from './clientMetrics';
import { summarizeLogistics, logisticsDay, outcomeEventsInRange, LogisticsRange } from './logisticsMetrics';

// ----------------------------------------------------------------------------
// Grammaire fermée (seules ces valeurs sont valides)
// ----------------------------------------------------------------------------

type Metric =
  | 'volume'
  | 'delivered'
  | 'deliveryRate'
  | 'punctualityRate'
  | 'avgDelayHours'
  | 'failRate'
  | 'weight';

type Dimension = 'none' | 'pharmacy' | 'zone' | 'day' | 'status';

type ChartType = 'kpi' | 'line' | 'bar' | 'donut' | 'table';

const METRICS: readonly Metric[] = [
  'volume',
  'delivered',
  'deliveryRate',
  'punctualityRate',
  'avgDelayHours',
  'failRate',
  'weight',
];
const DIMENSIONS: readonly Dimension[] = ['none', 'pharmacy', 'zone', 'day', 'status'];
const PERIODS: readonly MetricPeriod[] = ['7d', '30d', 'month', 'all'];
const CHARTS: readonly ChartType[] = ['kpi', 'line', 'bar', 'donut', 'table'];

// ----------------------------------------------------------------------------
// Exports publics
// ----------------------------------------------------------------------------

export const SUGGESTED_QUESTIONS: string[] = [
  'Taux de livraison par zone ce mois',
  'Colis par pharmacie sur 30 jours',
  'Ponctualité cette semaine',
  "Où ai-je le plus d'échecs ?",
  'Combien de colis livrés ce mois ?',
  'Répartition par statut',
];

export interface AnalyticsSpec {
  metric: Metric;
  dimension: Dimension;
  period: MetricPeriod;
  pharmacy?: string;
  zone?: string;
  chart: ChartType;
}

export interface QueryResult {
  title: string;
  narrative: string;
  explain: string;
  chart: 'kpi' | 'line' | 'bar' | 'donut' | 'table';
  kpi?: { label: string; value: string; suffix?: string };
  series?: { name: string; value: number }[];
}

// ----------------------------------------------------------------------------
// LLM (même pattern que geminiService.ts)
// ----------------------------------------------------------------------------

const ERROR_REFORMULATE =
  'Reformule ta question (ex. "taux de livraison par zone ce mois").';
const ERROR_CLARIFY =
  'Question ambiguë : précise la mesure et le regroupement (ex. "taux de livraison par zone ce mois").';

// ----------------------------------------------------------------------------
// Libellés FR (pour narratif / titres) — déterministes
// ----------------------------------------------------------------------------

const METRIC_LABEL: Record<Metric, string> = {
  volume: 'Colis créés',
  delivered: 'Colis livrés',
  deliveryRate: 'Taux de livraison',
  punctualityRate: 'Ponctualité',
  avgDelayHours: 'Délai moyen',
  failRate: "Taux d'échec",
  weight: 'Poids',
};

const DIMENSION_LABEL: Record<Dimension, string> = {
  none: 'global',
  pharmacy: 'par pharmacie',
  zone: 'par zone',
  day: 'par jour',
  status: 'par statut',
};

const PERIOD_PHRASE: Record<MetricPeriod, string> = {
  '7d': 'sur les 7 derniers jours',
  '30d': 'sur les 30 derniers jours',
  month: 'ce mois-ci',
  all: "sur tout l'historique",
};

const PERIOD_SHORT: Record<MetricPeriod, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  month: 'ce mois',
  all: 'tout',
};

// ----------------------------------------------------------------------------
// Helpers déterministes (locaux — clientMetrics n'exporte pas ceux-ci)
// ----------------------------------------------------------------------------

function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function deliveredMovement(p: Package): PackageMovement | null {
  const movements = p.movements;
  if (!Array.isArray(movements) || movements.length === 0) return null;
  for (let i = movements.length - 1; i >= 0; i--) {
    if (movements[i] && movements[i].action === 'DELIVERED') return movements[i];
  }
  return null;
}

function firstMovementTs(p: Package): string | undefined {
  const movements = p.movements;
  if (Array.isArray(movements) && movements.length > 0 && movements[0]) {
    return movements[0].timestamp || p.createdAt;
  }
  return p.createdAt;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Formatte un nombre d'heures en "Xh", "XhYY" ou "Y min". */
function formatDelay(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  const totalMin = Math.round(hours * 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Espace comme séparateur de milliers (FR). */
function formatInt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

// ----------------------------------------------------------------------------
// Calcul d'UNE métrique sur un sous-ensemble de colis (source de vérité)
// Renvoie null quand la métrique n'est pas définie (dénominateur nul, etc.).
// ----------------------------------------------------------------------------

function computeMetricValue(list: Package[], metric: Metric, range?: LogisticsRange): number | null {
  const summary = summarizeLogistics(list, range);
  switch (metric) {
    case 'volume': return summary.total;
    case 'delivered': return summary.delivered;
    case 'weight': return round1(summary.created.reduce((sum, p) => sum + (Number.isFinite(p.weight) ? p.weight! : 0), 0));
    case 'deliveryRate': return summary.resolved ? Math.round(summary.deliveryRate) : null;
    case 'failRate': return summary.resolved ? Math.round(100 - summary.deliveryRate) : null;
    case 'punctualityRate': return summary.punctualityRate === null ? null : Math.round(summary.punctualityRate);
    case 'avgDelayHours': return summary.avgDelayHours === null ? null : round1(summary.avgDelayHours);
    default: return null;
  }
}

/** Vraie si la métrique est un pourcentage (affichage / suffixe). */
function isRateMetric(metric: Metric): boolean {
  return metric === 'deliveryRate' || metric === 'punctualityRate' || metric === 'failRate';
}

/** Clé de regroupement d'un colis pour une dimension. null => à ignorer. */
function groupKey(p: Package, dimension: Dimension): string | null {
  switch (dimension) {
    case 'pharmacy':
      return (p.contactName || '').trim() || '—';
    case 'zone':
      return (p.zone as string) || '—';
    case 'status':
      return (p.status as string) || '—';
    case 'day': {
      const d = toDate(p.createdAt);
      return d ? logisticsDay(d) : null;
    }
    default:
      return null;
  }
}

// ----------------------------------------------------------------------------
// executeSpec — calcul déterministe (SEULE source de nombres)
// ----------------------------------------------------------------------------

interface ExecOutput {
  chart: ChartType;
  kpi?: { label: string; value: string; suffix?: string };
  series?: { name: string; value: number }[];
}

/** Chart par défaut selon la dimension. */
function defaultChartFor(dimension: Dimension): ChartType {
  if (dimension === 'day') return 'line';
  if (dimension === 'status') return 'donut';
  return 'bar'; // pharmacy / zone
}

/** Retient le chart demandé s'il est cohérent pour un regroupement, sinon défaut. */
function resolveGroupedChart(spec: AnalyticsSpec): ChartType {
  const fallback = defaultChartFor(spec.dimension);
  const requested = spec.chart;
  if (requested === 'line' || requested === 'bar' || requested === 'donut' || requested === 'table') {
    return requested;
  }
  return fallback;
}

function executeSpec(packages: Package[], spec: AnalyticsSpec): ExecOutput {
  const filters: MetricsFilters = {
    period: spec.period,
    pharmacy: spec.pharmacy,
    zone: spec.zone,
  };

  const range = metricsRange(spec.period);
  const dimensional = packages.filter(p => (!spec.pharmacy || p.contactName === spec.pharmacy) && (!spec.zone || p.zone === spec.zone));
  const filtered = ['volume', 'weight'].includes(spec.metric) ? filterPackages(packages, filters) : dimensional;

  // --- KPI (dimension none) : on s'appuie sur computeClientMetrics ---
  if (spec.dimension === 'none') {
    const m = computeClientMetrics(packages, filters);
    const label = METRIC_LABEL[spec.metric];

    let kpi: { label: string; value: string; suffix?: string };
    switch (spec.metric) {
      case 'volume':
        kpi = { label, value: formatInt(m.total), suffix: 'colis' };
        break;
      case 'delivered':
        kpi = { label, value: formatInt(m.delivered), suffix: 'colis' };
        break;
      case 'deliveryRate':
        kpi = m.resolved ? { label, value: String(Math.round(m.deliveryRate)), suffix: '%' } : { label, value: '—' };
        break;
      case 'punctualityRate':
        kpi =
          m.punctualityRate === null
            ? { label, value: '—' }
            : { label, value: String(Math.round(m.punctualityRate)), suffix: '%' };
        break;
      case 'avgDelayHours':
        kpi = { label, value: formatDelay(m.avgDelayHours) };
        break;
      case 'failRate': {
        const v = computeMetricValue(filtered, 'failRate', range);
        kpi = { label, value: v === null ? '—' : String(v), suffix: v === null ? undefined : '%' };
        break;
      }
      case 'weight':
        kpi = { label, value: formatInt(m.weightTotal), suffix: 'kg' };
        break;
      default:
        kpi = { label, value: '—' };
    }

    return { chart: 'kpi', kpi };
  }

  // --- Regroupement (pharmacy / zone / status / day) -> series[] ---
  const groups = new Map<string, Package[]>();
  const eventMetric = !['volume', 'weight'].includes(spec.metric);
  const groupingList = spec.dimension === 'day' && eventMetric
    ? outcomeEventsInRange(dimensional, range).filter(event => event.timestamp).map(event => ({
        ...event.package,
        movements: (event.package.movements || []).filter(movement => !['DELIVERED', 'FAILED'].includes(movement.action)),
        pod: undefined, failurePod: undefined,
        status: event.outcome === 'SUCCESS' ? PackageStatus.DELIVERED : PackageStatus.FAILED,
        deliveryAttempts: [{ id: event.id, missionId: '', stopId: '', driverId: event.driverId || '',
          outcome: event.outcome, recordedAt: event.timestamp!, failureReason: event.reason,
          promisedDeliveryAt: event.promisedDeliveryAt, estimatedDeliveryAt: event.estimatedDeliveryAt }],
      })) : filtered;
  for (const p of groupingList) {
    if (!p) continue;
    const key = spec.dimension === 'day' && eventMetric ? logisticsDay(p.deliveryAttempts![0].recordedAt) : groupKey(p, spec.dimension);
    if (key === null) continue;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  let series: { name: string; value: number }[] = [];
  for (const [name, pkgs] of groups.entries()) {
    const value = computeMetricValue(pkgs, spec.metric, range);
    if (value === null) continue; // métrique non définie pour ce groupe
    series.push({ name, value });
  }

  if (spec.dimension === 'day') {
    // Chronologique ascendant
    series.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } else {
    // Décroissant par valeur
    series.sort((a, b) => b.value - a.value);
    if (spec.dimension === 'pharmacy') series = series.slice(0, 10);
  }

  return { chart: resolveGroupedChart(spec), series };
}

// ----------------------------------------------------------------------------
// Narratif déterministe (aucun LLM ici => impossible d'inventer un chiffre)
// ----------------------------------------------------------------------------

/** Formatte la valeur d'un point de série pour le narratif. */
function formatSeriesValue(metric: Metric, value: number): string {
  if (isRateMetric(metric)) return `${value}%`;
  if (metric === 'avgDelayHours') return formatDelay(value);
  if (metric === 'weight') return `${formatInt(value)} kg`;
  return `${formatInt(value)} colis`;
}

function buildNarrative(spec: AnalyticsSpec, out: ExecOutput): string {
  const periodPhrase = PERIOD_PHRASE[spec.period];

  if (spec.dimension === 'none' && out.kpi) {
    const { kpi } = out;
    const valueStr = kpi.suffix ? `${kpi.value}${kpi.suffix === '%' ? '%' : ' ' + kpi.suffix}` : kpi.value;
    switch (spec.metric) {
      case 'volume':
      case 'delivered':
        return `${valueStr} ${periodPhrase}.`;
      case 'deliveryRate':
        return `Taux de livraison : ${valueStr} ${periodPhrase}.`;
      case 'punctualityRate':
        return kpi.value === '—'
          ? `Ponctualité : donnée indisponible ${periodPhrase} (aucune échéance client connue).`
          : `Ponctualité : ${valueStr} ${periodPhrase}.`;
      case 'avgDelayHours':
        return kpi.value === '—'
          ? `Délai moyen : donnée indisponible ${periodPhrase}.`
          : `Délai moyen : ${valueStr} ${periodPhrase}.`;
      case 'failRate':
        return kpi.value === '—'
          ? `Taux d'échec : donnée indisponible ${periodPhrase}.`
          : `Taux d'échec : ${valueStr} ${periodPhrase}.`;
      case 'weight':
        return `Poids total : ${valueStr} ${periodPhrase}.`;
      default:
        return `${valueStr} ${periodPhrase}.`;
    }
  }

  const series = out.series || [];
  if (series.length === 0) {
    return `Aucune donnée exploitable ${periodPhrase}.`;
  }

  const dimWord =
    spec.dimension === 'zone'
      ? series.length > 1
        ? 'zones'
        : 'zone'
      : spec.dimension === 'pharmacy'
      ? series.length > 1
        ? 'pharmacies'
        : 'pharmacie'
      : spec.dimension === 'status'
      ? series.length > 1
        ? 'statuts'
        : 'statut'
      : series.length > 1
      ? 'jours'
      : 'jour';

  // Le "leader" = plus grande valeur (pour 'day' on prend aussi le max).
  const leader = series.reduce((best, cur) => (cur.value > best.value ? cur : best), series[0]);
  const leaderVal = formatSeriesValue(spec.metric, leader.value);

  return `${series.length} ${dimWord} — ${leader.name} en tête avec ${leaderVal}.`;
}

function buildTitle(spec: AnalyticsSpec): string {
  const metric = METRIC_LABEL[spec.metric];
  if (spec.dimension === 'none') {
    return `${metric} — ${PERIOD_SHORT[spec.period]}`;
  }
  return `${metric} ${DIMENSION_LABEL[spec.dimension]}`;
}

function buildExplain(spec: AnalyticsSpec): string {
  const method = ['volume', 'weight'].includes(spec.metric) ? 'Date de création'
    : spec.metric === 'punctualityRate' ? 'Heure terrain comparée au jour/créneau promis (hors ETA)'
    : 'Heure terrain des tentatives ; succès / (succès + échecs décidés), hors colis en cours';
  return `${METRIC_LABEL[spec.metric]} · ${DIMENSION_LABEL[spec.dimension]} · ${PERIOD_SHORT[spec.period]} · ${method} · fuseau La Réunion`;

}

// ----------------------------------------------------------------------------
// Interprétation LLM -> AnalyticsSpec (validation stricte)
// ----------------------------------------------------------------------------

function isMetric(v: unknown): v is Metric {
  return typeof v === 'string' && (METRICS as readonly string[]).includes(v);
}
function isDimension(v: unknown): v is Dimension {
  return typeof v === 'string' && (DIMENSIONS as readonly string[]).includes(v);
}
function isPeriod(v: unknown): v is MetricPeriod {
  return typeof v === 'string' && (PERIODS as readonly string[]).includes(v);
}
function isChart(v: unknown): v is ChartType {
  return typeof v === 'string' && (CHARTS as readonly string[]).includes(v);
}

/** Extrait le 1er objet JSON d'une chaîne (retire les fences ```json éventuels). */
function parseJsonLoose(raw: string): unknown {
  if (!raw) return null;
  let text = raw.trim();
  // Retire les fences Markdown
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return null;
  }
}

/**
 * Valide un objet brut contre la grammaire + les listes connues.
 * Une pharmacy/zone inconnue est simplement ignorée (mise à undefined).
 * Renvoie null si un champ obligatoire est manquant/invalide.
 */
function validateSpec(
  parsed: unknown,
  context: { pharmacies: string[]; zones: string[] }
): AnalyticsSpec | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  if (!isMetric(obj.metric)) return null;
  if (!isDimension(obj.dimension)) return null;
  if (!isPeriod(obj.period)) return null;

  const chart: ChartType = isChart(obj.chart) ? obj.chart : 'kpi';

  let pharmacy: string | undefined;
  if (typeof obj.pharmacy === 'string' && obj.pharmacy.trim()) {
    const candidate = obj.pharmacy.trim();
    if (context.pharmacies.includes(candidate)) pharmacy = candidate;
  }

  let zone: string | undefined;
  if (typeof obj.zone === 'string' && obj.zone.trim()) {
    const candidate = obj.zone.trim();
    if (context.zones.includes(candidate)) zone = candidate;
  }

  return { metric: obj.metric, dimension: obj.dimension, period: obj.period, chart, pharmacy, zone };
}

/** Un appel LLM -> AnalyticsSpec validée (ou null). */
async function interpretOnce(
  question: string,
  context: { pharmacies: string[]; zones: string[] }
): Promise<AnalyticsSpec | null> {
  const call = httpsCallable<{question: string; context: typeof context}, {text: string}>(getFunctions(app, 'europe-west1'), 'interpretAnalytics');
  const response = await call({question, context});
  return validateSpec(parseJsonLoose(response.data.text || ''), context);
}

// ----------------------------------------------------------------------------
// runQuery — orchestration complète
// ----------------------------------------------------------------------------

export async function runQuery(
  packages: Package[],
  question: string,
  context: { pharmacies: string[]; zones: string[] }
): Promise<QueryResult | { error: string }> {
  if (!question || !question.trim()) {
    return { error: ERROR_REFORMULATE };
  }

  const safeContext = {
    pharmacies: Array.isArray(context?.pharmacies) ? context.pharmacies : [],
    zones: Array.isArray(context?.zones) ? context.zones : [],
  };

  // Both interpretations must agree on metric, period and every filter.
  let first: AnalyticsSpec | null, second: AnalyticsSpec | null;
  try {
    [first, second] = await Promise.all([interpretOnce(question,safeContext),interpretOnce(question,safeContext)]);
  } catch {
    return {error: 'L’analyse en langage naturel est indisponible. Les statistiques restent accessibles ; réessayez plus tard.'};
  }
  if (!first || !second) return {error: ERROR_REFORMULATE};
  if (JSON.stringify(first) !== JSON.stringify(second)) return {error: ERROR_CLARIFY};

  const spec = first;

  // 4. Calcul déterministe (seule source de nombres)
  const out = executeSpec(packages, spec);

  // 5. Narratif template (aucun LLM)
  const result: QueryResult = {
    title: buildTitle(spec),
    narrative: buildNarrative(spec, out),
    explain: buildExplain(spec),
    chart: out.chart,
    kpi: out.kpi,
    series: out.series,
  };

  return result;
}
