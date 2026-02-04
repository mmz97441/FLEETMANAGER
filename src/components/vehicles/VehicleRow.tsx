/**
 * VehicleRow - Ligne de véhicule dans la vue tableau
 */

import React from 'react';
import { Truck, AlertCircle, Edit, Trash2, User as UserIcon, Plus, ArrowRightLeft, MapPin } from 'lucide-react';
import { Vehicle, Issue, MaintenanceLog, VehicleStatus } from '../../types';
import { 
  getEffectiveStatus, 
  getMaintenanceHealth, 
  getActiveIssuesCount,
  getDriverId
} from '../../hooks/useVehicles';
import VehicleStatusBadge from './VehicleStatusBadge';

interface VehicleRowProps {
  vehicle: Vehicle;
  issues: Issue[];
  maintenanceLogs: MaintenanceLog[];
  driverName: string | null;
  showActions: boolean;
  allVehicles?: Vehicle[];  // Pour trouver le véhicule de remplacement/remplacé
  onSelect?: () => void;
  onViewIncidents?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssignDriver?: () => void;
  onAssignReplacement?: () => void;  // Nouveau: affecter un remplacement
}

const VehicleRow: React.FC<VehicleRowProps> = ({
  vehicle,
  issues,
  maintenanceLogs,
  driverName,
  showActions,
  allVehicles = [],
  onSelect,
  onViewIncidents,
  onEdit,
  onDelete,
  onAssignDriver,
  onAssignReplacement
}) => {
  const health = getMaintenanceHealth(vehicle);
  const ctDate = vehicle.technicalControlDate ? new Date(vehicle.technicalControlDate) : null;
  const isCtUrgent = ctDate && ctDate < new Date();
  const activeIssues = getActiveIssuesCount(vehicle.id, issues);
  const { status: effectiveStatus, isRepairing } = getEffectiveStatus(vehicle, issues, maintenanceLogs);
  const hasDriver = !!getDriverId(vehicle);
  
  // Infos de remplacement
  const isImmobilized = vehicle.status === VehicleStatus.IMMOBILIZED || effectiveStatus === VehicleStatus.IMMOBILIZED;
  const isReplacement = vehicle.isReplacement;
  const replacementVehicle = vehicle.currentReplacementId 
    ? allVehicles.find(v => v.id === vehicle.currentReplacementId)
    : null;
  const replacedVehicle = vehicle.replacesVehicleId
    ? allVehicles.find(v => v.id === vehicle.replacesVehicleId)
    : null;

  const formatVehicleType = (type: string) => {
    switch (type) {
      case 'Heavy Truck': return 'Poids Lourd';
      case 'Van': return 'Utilitaire';
      default: return type;
    }
  };

  return (
    <tr 
      className={`hover:bg-slate-50/80 transition-colors group cursor-pointer ${
        isImmobilized ? 'bg-red-50/50' : ''
      } ${isReplacement ? 'bg-amber-50/50' : ''}`}
      onClick={onSelect}
    >
      {/* Identité véhicule */}
      <td className="px-6 py-4">
        <div className="flex items-center gap-3 relative">
          <div className={`p-2 rounded-lg transition-all border relative ${
            isImmobilized 
              ? 'bg-red-100 text-red-600 border-red-200' 
              : isReplacement
                ? 'bg-amber-100 text-amber-600 border-amber-200'
                : 'bg-slate-100 text-slate-500 border-transparent group-hover:bg-white group-hover:shadow-sm group-hover:border-slate-200'
          }`}>
            <Truck size={20} />
            {activeIssues > 0 && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center text-[10px] text-white font-bold border-2 border-white animate-pulse">
                {activeIssues}
              </div>
            )}
            {isImmobilized && !activeIssues && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center border-2 border-white animate-pulse">
                <span className="text-white text-[8px]">!</span>
              </div>
            )}
          </div>
          <div>
            <div className="font-mono font-bold text-slate-900 text-sm tracking-tight flex items-center gap-2">
              {vehicle.plate}
              {activeIssues > 0 && (
                <span 
                  onClick={(e) => { e.stopPropagation(); onViewIncidents?.(); }}
                  title="Voir les incidents"
                  className="bg-red-50 text-red-600 px-1.5 rounded text-[10px] uppercase font-bold border border-red-100 cursor-pointer hover:bg-red-600 hover:text-white transition-colors"
                >
                  Incident
                </span>
              )}
              {isReplacement && (
                <span className="bg-amber-100 text-amber-700 px-1.5 rounded text-[10px] uppercase font-bold border border-amber-200">
                  Remplacement
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 font-medium">{vehicle.model}</div>
            
            {/* Indicateur de remplacement */}
            {isImmobilized && replacementVehicle && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <ArrowRightLeft size={10} />
                Remplacé par {replacementVehicle.plate}
              </div>
            )}
            {isImmobilized && !replacementVehicle && showActions && onAssignReplacement && (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignReplacement(); }}
                className="mt-1 flex items-center gap-1 text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 hover:bg-red-100 transition-colors"
              >
                <Plus size={10} />
                Affecter remplacement
              </button>
            )}
            {isReplacement && replacedVehicle && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                <ArrowRightLeft size={10} />
                Remplace {replacedVehicle.plate}
              </div>
            )}
            {vehicle.immobilizedLocation && isImmobilized && (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-red-500">
                <MapPin size={10} />
                {vehicle.immobilizedLocation}
              </div>
            )}
            
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
                    Assigner chauffeur
                  </>
                )}
              </button>
            ) : hasDriver ? (
              <div className="text-[10px] text-brand-600 font-medium flex items-center gap-1 mt-0.5">
                <UserIcon size={10} />
                {driverName || 'Chauffeur inconnu'}
              </div>
            ) : null}
          </div>
        </div>
      </td>

      {/* Type */}
      <td className="px-6 py-4 text-center">
        <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">
          {formatVehicleType(vehicle.type)}
        </span>
      </td>

      {/* Statut */}
      <td className="px-6 py-4 text-center">
        <VehicleStatusBadge status={effectiveStatus} isRepairing={isRepairing} isReplacement={isReplacement} />
      </td>

      {/* Barre d'usure */}
      <td className="px-6 py-4 min-w-[180px]">
        <div className="w-full">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Usure</span>
            <span className={`text-[10px] font-bold ${health.percentage > 90 ? 'text-red-600' : 'text-slate-600'}`}>
              {health.remaining > 0 ? `Reste ${health.remaining.toLocaleString()} km` : 'DÉPASSÉ'}
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${health.color}`} 
              style={{ width: `${health.percentage}%` }}
            />
          </div>
        </div>
      </td>

      {/* Kilométrage */}
      <td className="px-6 py-4 text-right">
        <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded text-sm group-hover:bg-white group-hover:shadow-sm transition-all border border-transparent group-hover:border-slate-200">
          {vehicle.currentMileage.toLocaleString()} km
        </span>
      </td>

      {/* Date CT */}
      <td className="px-6 py-4 text-center">
        {ctDate ? (
          <div className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded ${isCtUrgent ? 'text-red-600 bg-red-50' : 'text-slate-600 bg-slate-50'}`}>
            {isCtUrgent && <AlertCircle size={12} />}
            {ctDate.toLocaleDateString('fr-FR')}
          </div>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-6 py-4 text-right">
        {showActions && (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-2 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              title="Modifier"
            >
              <Edit size={18} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Supprimer"
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
};

export default VehicleRow;
