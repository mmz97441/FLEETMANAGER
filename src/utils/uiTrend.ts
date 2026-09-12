export type TrendMeaning = 'neutral' | 'lower-is-better' | 'higher-is-better';
export type TrendTone = 'neutral' | 'positive' | 'negative';

/** A zero or missing baseline cannot establish a percentage change. */
export function trendPercent(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return NaN;
  return ((current - previous) / previous) * 100;
}

/** Direction is a fact. A performance judgement requires an explicit meaning. */
export function trendTone(value: number, meaning: TrendMeaning = 'neutral'): TrendTone {
  if (!Number.isFinite(value) || value === 0 || meaning === 'neutral') return 'neutral';
  const good = meaning === 'lower-is-better' ? value < 0 : value > 0;
  return good ? 'positive' : 'negative';
}

export const trendClasses: Record<TrendTone, string> = {
  neutral: 'text-slate-600', positive: 'text-green-800', negative: 'text-red-800',
};

export function trendLabel(value: number): string {
  if (!Number.isFinite(value)) return 'Comparaison indisponible';
  if (value === 0) return 'Stable';
  return `${value > 0 ? 'Hausse' : 'Baisse'} de ${Math.abs(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}
