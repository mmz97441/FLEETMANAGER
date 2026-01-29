import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
  trend?: number;
  trendLabel?: string;
  trendInverted?: boolean; // Si true, négatif = bien (ex: coûts)
  onClick?: () => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'gradient' | 'bordered';
  gradientFrom?: string;
  gradientTo?: string;
  borderColor?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-brand-600',
  iconBgColor = 'bg-brand-50',
  trend,
  trendLabel,
  trendInverted = false,
  onClick,
  className = '',
  size = 'md',
  variant = 'default',
  gradientFrom = 'from-brand-500',
  gradientTo = 'to-brand-600',
  borderColor = 'border-slate-200'
}) => {
  // Tailles
  const sizeClasses = {
    sm: {
      padding: 'p-3',
      title: 'text-xs',
      value: 'text-xl',
      subtitle: 'text-[10px]',
      icon: 16,
      iconWrapper: 'p-2'
    },
    md: {
      padding: 'p-4',
      title: 'text-sm',
      value: 'text-2xl sm:text-3xl',
      subtitle: 'text-xs',
      icon: 20,
      iconWrapper: 'p-2.5'
    },
    lg: {
      padding: 'p-5',
      title: 'text-sm',
      value: 'text-3xl sm:text-4xl',
      subtitle: 'text-sm',
      icon: 24,
      iconWrapper: 'p-3'
    }
  };

  const s = sizeClasses[size];

  // Tendance
  const renderTrend = () => {
    if (trend === undefined) return null;
    
    const isPositive = trend > 0;
    const isGood = trendInverted ? !isPositive : isPositive;
    const TrendIcon = isPositive ? TrendingUp : TrendingDown;
    const color = isGood ? 'text-green-600' : 'text-red-600';
    
    return (
      <div className={`flex items-center gap-1 ${s.subtitle} font-medium ${color}`}>
        <TrendIcon size={14} />
        <span>{Math.abs(trend).toFixed(1)}%</span>
        {trendLabel && <span className="text-slate-400 ml-1">{trendLabel}</span>}
      </div>
    );
  };

  // Variantes de style
  const baseClasses = `rounded-2xl transition-all ${s.padding} ${onClick ? 'cursor-pointer' : ''}`;
  
  const variantClasses = {
    default: `bg-white shadow-sm hover:shadow-md ${onClick ? 'group' : ''}`,
    gradient: `bg-gradient-to-br ${gradientFrom} ${gradientTo} text-white shadow-lg`,
    bordered: `bg-white border-2 ${borderColor} shadow-sm hover:shadow-md`
  };

  const textColor = variant === 'gradient' ? 'text-white/80' : 'text-slate-500';
  const valueColor = variant === 'gradient' ? 'text-white' : 'text-slate-800';
  const subtitleColor = variant === 'gradient' ? 'text-white/70' : 'text-slate-400';

  return (
    <div 
      onClick={onClick}
      className={`${baseClasses} ${variantClasses[variant]} ${className} relative overflow-hidden`}
    >
      {/* Icon de fond (style ghost) */}
      {Icon && variant === 'default' && (
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <Icon size={60} className={iconColor} />
        </div>
      )}

      <div className="relative z-10">
        {/* Header avec icône */}
        <div className="flex items-center justify-between mb-2">
          {Icon && variant !== 'default' && (
            <div className={`${iconBgColor} ${s.iconWrapper} rounded-xl ${variant === 'gradient' ? 'bg-white/20' : ''}`}>
              <Icon size={s.icon} className={variant === 'gradient' ? 'text-white' : iconColor} />
            </div>
          )}
          {Icon && variant === 'default' && (
            <div className={`${iconBgColor} ${s.iconWrapper} rounded-xl`}>
              <Icon size={s.icon} className={iconColor} />
            </div>
          )}
        </div>

        {/* Title */}
        <p className={`${s.title} font-semibold ${textColor} uppercase tracking-wide`}>
          {title}
        </p>

        {/* Value */}
        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
          <h3 className={`${s.value} font-bold ${valueColor}`}>
            {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
          </h3>
          {subtitle && (
            <span className={`${s.subtitle} ${subtitleColor}`}>{subtitle}</span>
          )}
        </div>

        {/* Trend */}
        {renderTrend()}
      </div>

      {/* Hint cliquable */}
      {onClick && variant === 'default' && (
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-slate-400 font-medium">Cliquer →</span>
        </div>
      )}
    </div>
  );
};

export default StatCard;
