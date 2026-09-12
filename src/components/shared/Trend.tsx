import React from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { trendClasses, trendLabel, trendTone, TrendMeaning } from '../../utils/uiTrend';

export default function Trend({ value, meaning = 'neutral', comparison = 'par rapport au mois précédent' }: { value: number; meaning?: TrendMeaning; comparison?: string }) {
  const Icon = !Number.isFinite(value) || value === 0 ? Minus : value > 0 ? TrendingUp : TrendingDown;
  return <span className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm leading-snug ${trendClasses[trendTone(value, meaning)]}`}>
    <Icon size={16} aria-hidden="true" />
    <span>{trendLabel(value)}</span>
    <span className="text-slate-600">{comparison}</span>
  </span>;
}
