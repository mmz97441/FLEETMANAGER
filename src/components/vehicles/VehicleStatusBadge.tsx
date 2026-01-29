/**
 * VehicleStatusBadge - Badge de statut véhicule
 */

import React from 'react';
import { CheckCircle2, Wrench, AlertTriangle, PauseCircle, Loader } from 'lucide-react';
import { VehicleStatus } from '../../types';

interface VehicleStatusBadgeProps {
  status: VehicleStatus;
  isRepairing?: boolean;
  size?: 'sm' | 'md';
}

const VehicleStatusBadge: React.FC<VehicleStatusBadgeProps> = ({ 
  status, 
  isRepairing = false,
  size = 'md'
}) => {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5'
  };

  const iconSize = size === 'sm' ? 10 : 12;
  const s = sizeClasses[size];

  const getConfig = () => {
    switch (status) {
      case VehicleStatus.ACTIVE:
        return {
          label: 'En service',
          icon: CheckCircle2,
          className: 'bg-emerald-100 text-emerald-700 border-emerald-200'
        };
      case VehicleStatus.MAINTENANCE:
        return {
          label: isRepairing ? 'En réparation' : 'Maintenance',
          icon: isRepairing ? Loader : Wrench,
          className: 'bg-orange-100 text-orange-700 border-orange-200',
          animate: isRepairing
        };
      case VehicleStatus.ISSUE:
        return {
          label: 'Problème',
          icon: AlertTriangle,
          className: 'bg-red-100 text-red-700 border-red-200 animate-pulse'
        };
      case VehicleStatus.IDLE:
        return {
          label: 'Au repos',
          icon: PauseCircle,
          className: 'bg-slate-100 text-slate-600 border-slate-200'
        };
      default:
        return {
          label: status,
          icon: CheckCircle2,
          className: 'bg-slate-100 text-slate-600 border-slate-200'
        };
    }
  };

  const config = getConfig();
  const Icon = config.icon;

  return (
    <span 
      className={`
        inline-flex items-center font-bold rounded-full border
        ${s}
        ${config.className}
      `}
    >
      <Icon 
        size={iconSize} 
        className={config.animate ? 'animate-spin' : ''} 
      />
      {config.label}
    </span>
  );
};

export default VehicleStatusBadge;
