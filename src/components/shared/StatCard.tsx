import React from 'react';
import { LucideIcon, ArrowUpRight } from 'lucide-react';
import Trend from './Trend';
import type { TrendMeaning } from '../../utils/uiTrend';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
  trend?: number;
  trendLabel?: string;
  trendMeaning?: TrendMeaning;
  trendInverted?: boolean; // Si true, négatif = bien (ex: coûts)
  onClick?: () => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'gradient' | 'bordered';
  gradientFrom?: string;
  gradientTo?: string;
  borderColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon: Icon,
  trend, trendLabel, trendInverted = false, trendMeaning = 'neutral', onClick,
  className = '', size = 'md' }) => {
  const padding = size === 'sm' ? 'p-3' : size === 'lg' ? 'p-5' : 'p-4';
  return <div className={`ui-panel relative min-w-0 ${padding} ${onClick ? 'group hover:border-brand-600' : ''} ${className}`}>
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {Icon && <Icon size={20} aria-hidden="true" className="shrink-0 text-brand-700" />}
    </div>
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="ui-number text-2xl font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</p>
      {subtitle && <span className="text-sm text-slate-600">{subtitle}</span>}
    </div>
    {trend !== undefined && <div className="mt-2"><Trend value={trend} meaning={trendInverted ? 'lower-is-better' : trendMeaning} comparison={trendLabel} /></div>}
    {onClick && <button type="button" aria-label={`Voir le détail : ${title}`} onClick={onClick} className="absolute inset-0 rounded-xl text-brand-700"><ArrowUpRight aria-hidden="true" size={16} className="absolute bottom-2 right-2" /></button>}
  </div>;
};
export default StatCard;
