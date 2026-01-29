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
      label: 'Total Parc',
      value: stats.total,
      icon: Truck,
      bgColor: 'bg-slate-50',
      iconColor: 'text-slate-500',
      valueColor: 'text-slate-800'
    },
    {
      key: 'active' as const,
      label: 'En Service',
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map(card => (
        <div 
          key={card.key}
          onClick={() => onStatClick?.(card.key)}
          className={`
            bg-white p-4 rounded-2xl shadow-sm border border-slate-100 
            flex items-center justify-between
            ${onStatClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}
            ${card.pulse ? 'animate-pulse' : ''}
          `}
        >
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {card.label}
            </p>
            <h3 className={`text-2xl font-extrabold ${card.valueColor}`}>
              {card.value}
            </h3>
          </div>
          <div className={`${card.bgColor} p-3 rounded-xl ${card.iconColor}`}>
            <card.icon size={24} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default VehicleStats;
