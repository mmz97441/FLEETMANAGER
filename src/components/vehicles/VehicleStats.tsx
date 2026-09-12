/**
 * VehicleStats - Affichage des KPIs du parc véhicules
 */

import React from 'react';
import { Truck, CheckCircle2, Wrench, AlertTriangle, XOctagon } from 'lucide-react';
import { VehicleStats as VehicleStatsType } from '../../hooks/useVehicles';

interface VehicleStatsProps {
  stats: VehicleStatsType;
  onStatClick?: (stat: 'total' | 'active' | 'maintenance' | 'issues' | 'immobilized') => void;
}

const VehicleStats: React.FC<VehicleStatsProps> = ({ stats, onStatClick }) => {
  const cards = [
    {
      key: 'total' as const,
      label: 'Total du parc',
      value: stats.total,
      icon: Truck,
      bgColor: 'bg-slate-50',
      iconColor: 'text-slate-500',
      valueColor: 'text-slate-800'
    },
    {
      key: 'active' as const,
      label: 'En service',
      value: stats.active,
      icon: CheckCircle2,
      bgColor: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      valueColor: 'text-emerald-600'
    },
    {
      key: 'maintenance' as const,
      label: 'Maintenance',
      value: stats.maintenance,
      icon: Wrench,
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600',
      valueColor: 'text-orange-600'
    },
    {
      key: 'immobilized' as const,
      label: 'Immobilisés',
      value: stats.immobilized,
      icon: XOctagon,
      bgColor: 'bg-red-50',
      iconColor: 'text-red-600',
      valueColor: 'text-red-600',
      pulse: stats.immobilized > 0  // Animation si > 0
    },
    {
      key: 'issues' as const,
      label: 'Alertes',
      value: stats.issues,
      icon: AlertTriangle,
      bgColor: 'bg-amber-50',
      iconColor: 'text-amber-600',
      valueColor: 'text-amber-600'
    }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map(card => {
        const content = <><span className="flex min-w-0 items-start gap-2"><card.icon size={18} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" /><span className="min-w-0 break-words text-sm font-medium text-slate-700">{card.label}</span></span><span className={`mt-2 block text-2xl font-bold tabular-nums ${card.valueColor}`}>{card.value}</span></>;
        return onStatClick
          ? <button key={card.key} type="button" className="ui-panel min-h-11 min-w-0 p-3 text-left" onClick={() => onStatClick(card.key)} aria-label={`${card.label} : ${card.value}, afficher les véhicules`}>{content}</button>
          : <div key={card.key} className="ui-panel min-w-0 p-3">{content}</div>;
      })}
    </div>
  );
};

export default VehicleStats;
