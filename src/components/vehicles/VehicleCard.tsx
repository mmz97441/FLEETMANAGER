/**
 * VehicleCard - Carte véhicule pour la vue grille
 */

import React from 'react';
import { Truck, Gauge, AlertTriangle, Edit, User as UserIcon, Plus } from 'lucide-react';
import { Vehicle, VehicleStatus, Issue, MaintenanceLog } from '../../types';
import { 
  getEffectiveStatus, 
  getMaintenanceHealth, 
  getActiveIssuesCount,
  getDriverId
} from '../../hooks/useVehicles';
import VehicleStatusBadge from './VehicleStatusBadge';

interface VehicleCardProps {
  vehicle: Vehicle;
  issues: Issue[];
  maintenanceLogs: MaintenanceLog[];
  driverName: string | null;
  showActions: boolean;
  onSelect?: () => void;
  onViewIncidents?: () => void;
  onEdit: () => void;
  onAssignDriver?: () => void; // Nouveau
}

const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  issues,
  maintenanceLogs,
  driverName,
  showActions,
  onSelect,
  onViewIncidents,
  onEdit,
  onAssignDriver
}) => {
  const health = getMaintenanceHealth(vehicle);
  const activeIssues = getActiveIssuesCount(vehicle.id, issues);
  const { status: effectiveStatus, isRepairing } = getEffectiveStatus(vehicle, issues, maintenanceLogs);
  const hasDriver = !!getDriverId(vehicle);

  // Couleur de la barre latérale selon le statut
  const getBorderColor = () => {
    if (effectiveStatus === VehicleStatus.ACTIVE) return 'bg-emerald-500';
    if (effectiveStatus === VehicleStatus.MAINTENANCE || isRepairing) return 'bg-orange-500';
    if (effectiveStatus === VehicleStatus.ISSUE) return 'bg-red-500';
    return 'bg-slate-400';
  };

  return (
    <div 
      onClick={onSelect}
      className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md hover:border-brand-200 transition-all group cursor-pointer relative overflow-hidden"
    >
      {/* Barre latérale colorée */}
      <div className={`absolute top-0 left-0 w-1 h-full ${getBorderColor()}`} />
      
      {/* Badge incident */}
      {activeIssues > 0 && (
        <div 
          onClick={(e) => { e.stopPropagation(); onViewIncidents?.(); }}
          className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-bl-xl flex items-center gap-1 shadow-sm z-10 animate-pulse cursor-pointer hover:bg-red-700 hover:scale-105 transition-all"
          title="Cliquez pour voir les incidents"
        >
          <AlertTriangle size={12} /> {activeIssues} Incident{activeIssues > 1 ? 's' : ''}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start mb-4 pl-3">
        <div className="flex items-center gap-3">
          <div className="bg-slate-50 p-2.5 rounded-xl text-slate-600 border border-slate-100">
            <Truck size={24} />
          </div>
          <div>
            <h3 className="font-mono font-bold text-lg text-slate-900">{vehicle.plate}</h3>
            <p className="text-xs text-slate-500 font-medium">{vehicle.model}</p>
            {/* Section chauffeur cliquable */}
            {showActions && onAssignDriver ? (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignDriver(); }}
                className={`mt-1 text-[10px] font-medium flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                  hasDriver 
                    ? 'bg-brand-50 text-brand-600 hover:bg-brand-100' 
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {hasDriver ? (
                  <>
                    <UserIcon size={10} />
                    {driverName || 'Chauffeur inconnu'}
                  </>
                ) : (
                  <>
                    <Plus size={10} />
                    Assigner
                  </>
                )}
              </button>
            ) : hasDriver ? (
              <p className="text-[10px] text-brand-600 font-medium flex items-center gap-1 mt-0.5">
                <UserIcon size={10} />
                {driverName || 'Chauffeur inconnu'}
              </p>
            ) : null}
          </div>
        </div>
        <VehicleStatusBadge status={effectiveStatus} isRepairing={isRepairing} size="sm" />
      </div>

      {/* Contenu */}
      <div className="pl-3 space-y-4">
        {/* Kilométrage */}
        <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Gauge size={14}/> Kilométrage
          </span>
          <span className="font-mono font-bold text-slate-800">
            {vehicle.currentMileage.toLocaleString()}
          </span>
        </div>

        {/* Barre d'usure */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-bold text-slate-400 uppercase">Maintenance</span>
            <span className={`font-bold ${health.percentage > 90 ? 'text-red-500' : 'text-slate-600'}`}>
              {Math.round(health.percentage)}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-full rounded-full ${health.color}`} 
              style={{ width: `${health.percentage}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 uppercase font-bold">Prochain CT</span>
            <span className="text-xs font-medium text-slate-700">
              {vehicle.technicalControlDate 
                ? new Date(vehicle.technicalControlDate).toLocaleDateString('fr-FR') 
                : '-'}
            </span>
          </div>
          {showActions && (
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="text-brand-600 hover:bg-brand-50 p-2 rounded-full transition-colors"
            >
              <Edit size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleCard;
