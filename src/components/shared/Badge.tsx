import React from 'react';
import { LucideIcon } from 'lucide-react';

export type BadgeVariant = 
  | 'default' 
  | 'success' 
  | 'warning' 
  | 'danger' 
  | 'info' 
  | 'purple'
  | 'slate';

export type BadgeSize = 'xs' | 'sm' | 'md';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: LucideIcon;
  pulse?: boolean;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-slate-100 text-slate-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  slate: 'bg-slate-200 text-slate-600'
};

const sizeClasses: Record<BadgeSize, { wrapper: string; icon: number }> = {
  xs: { wrapper: 'px-1.5 py-0.5 text-[10px]', icon: 10 },
  sm: { wrapper: 'px-2 py-0.5 text-xs', icon: 12 },
  md: { wrapper: 'px-2.5 py-1 text-sm', icon: 14 }
};

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  icon: Icon,
  pulse = false,
  className = ''
}) => {
  const s = sizeClasses[size];

  return (
    <span 
      className={`
        inline-flex items-center gap-1 font-bold rounded-full
        ${variantClasses[variant]}
        ${s.wrapper}
        ${pulse ? 'animate-pulse' : ''}
        ${className}
      `}
    >
      {Icon && <Icon size={s.icon} />}
      {children}
    </span>
  );
};

export default Badge;

// Composants pré-configurés pour usage rapide
export const SuccessBadge: React.FC<Omit<BadgeProps, 'variant'>> = (props) => (
  <Badge variant="success" {...props} />
);

export const DangerBadge: React.FC<Omit<BadgeProps, 'variant'>> = (props) => (
  <Badge variant="danger" {...props} />
);

export const WarningBadge: React.FC<Omit<BadgeProps, 'variant'>> = (props) => (
  <Badge variant="warning" {...props} />
);

export const InfoBadge: React.FC<Omit<BadgeProps, 'variant'>> = (props) => (
  <Badge variant="info" {...props} />
);
