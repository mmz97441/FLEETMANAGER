import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className = '',
  size = 'md'
}) => {
  const sizeClasses = {
    sm: {
      wrapper: 'p-4',
      icon: 32,
      iconWrapper: 'w-12 h-12',
      title: 'text-sm',
      description: 'text-xs',
      button: 'text-xs py-2 px-3'
    },
    md: {
      wrapper: 'p-6',
      icon: 40,
      iconWrapper: 'w-16 h-16',
      title: 'text-base',
      description: 'text-sm',
      button: 'text-sm py-2 px-4'
    },
    lg: {
      wrapper: 'p-8',
      icon: 48,
      iconWrapper: 'w-20 h-20',
      title: 'text-lg',
      description: 'text-base',
      button: 'text-base py-2.5 px-5'
    }
  };

  const s = sizeClasses[size];

  return (
    <div className={`flex flex-col items-center justify-center text-center ${s.wrapper} ${className}`}>
      <div className={`${s.iconWrapper} rounded-full bg-slate-100 flex items-center justify-center mb-4`}>
        <Icon size={s.icon} className="text-slate-400" />
      </div>
      
      <h3 className={`font-bold text-slate-700 ${s.title}`}>
        {title}
      </h3>
      
      {description && (
        <p className={`text-slate-500 mt-1 max-w-xs ${s.description}`}>
          {description}
        </p>
      )}
      
      {action && (
        <button
          onClick={action.onClick}
          className={`mt-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-colors ${s.button}`}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
