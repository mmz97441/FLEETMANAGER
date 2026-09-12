/**
 * VehicleCard - Carte véhicule pour la vue grille
 */

import React from 'react';
import { Truck, Gauge, AlertTriangle, Edit, Trash2, User as UserIcon, Plus, ArrowRightLeft, MapPin } from 'lucide-react';
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
  allVehicles?: Vehicle[];
  onSelect?: () => void;
  onViewIncidents?: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  onAssignDriver?: () => void;
  onAssignReplacement?: () => void;
}

const VehicleCard: React.FC<VehicleCardProps> = ({
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
  const controlOverdue = !!vehicle.technicalControlDate && new Date(vehicle.technicalControlDate) < new Date();
  const vehicleType = ({ 'Heavy Truck': 'Poids lourd', Van: 'Utilitaire', Car: 'Véhicule léger', Trailer: 'Remorque', Electric: 'Électrique' } as Record<string, string>)[vehicle.type] || vehicle.type;
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

  // Couleur de la barre latérale selon le statut
  const getBorderColor = () => {
    if (isImmobilized) return 'bg-red-600';
    if (isReplacement) return 'bg-amber-500';
    if (effectiveStatus === VehicleStatus.ACTIVE) return 'bg-emerald-500';
    if (effectiveStatus === VehicleStatus.MAINTENANCE || isRepairing) return 'bg-orange-500';
    if (effectiveStatus === VehicleStatus.ISSUE) return 'bg-red-500';
    return 'bg-slate-400';
  };

  return (
    <div
      className="ui-panel min-w-0 p-4 relative [overflow-wrap:anywhere]"
    >
      {/* Barre latérale colorée */}
      <div className={`absolute top-0 left-0 w-1 h-full ${getBorderColor()}`} />

      {/* Badge incident */}
      {activeIssues > 0 && (
        <button type="button" aria-label={`Voir les incidents de ${vehicle.plate}`}
          onClick={(e) => { e.stopPropagation(); onViewIncidents?.(); }}
          className="ui-button ui-button-secondary mb-3 text-sm flex items-center gap-1 z-10 cursor-pointer hover:scale-105"
          title="Cliquez pour voir les incidents"
        >
          <AlertTriangle size={16} /> {activeIssues} Incident{activeIssues > 1 ? 's' : ''}
        </button>
      )}

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start mb-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl border flex-shrink-0 ${
            isImmobilized
              ? 'bg-red-50 text-red-600 border-red-200'
              : isReplacement
                ? 'bg-amber-50 text-amber-600 border-amber-200'
                : 'bg-slate-50 text-slate-600 border-slate-100'
          }`}>
            <Truck size={24} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h3><button type="button" onClick={onSelect} aria-label={`Ouvrir le véhicule ${vehicle.plate}`} className="ui-button ui-button-ghost font-mono text-lg">{vehicle.plate}</button></h3>
              {isReplacement && (
                <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-sm font-bold border border-amber-200 flex-shrink-0">
                  Remplacement
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 font-medium min-w-0 break-words">{vehicle.model}</p>
            <p className="mt-1 text-sm text-slate-600">{vehicleType}</p>

            {/* Indicateurs de remplacement */}
            {isImmobilized && replacementVehicle && (
              <div className="mt-1 flex items-center gap-1 text-sm text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <ArrowRightLeft size={16} />
                Remplacé par {replacementVehicle.plate}
              </div>
            )}
            {isImmobilized && !replacementVehicle && showActions && onAssignReplacement && (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignReplacement(); }}
                className="ui-button ui-button-secondary mt-1 flex items-center gap-1 text-sm border"
              >
                <Plus size={16} />
                Affecter remplacement
              </button>
            )}
            {isReplacement && replacedVehicle && (
              <div className="mt-1 flex items-center gap-1 text-sm text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                <ArrowRightLeft size={16} />
                Remplace {replacedVehicle.plate}
              </div>
            )}
            {vehicle.immobilizedLocation && isImmobilized && (
              <div className="mt-1 flex items-center gap-1 text-sm text-red-500 min-w-0">
                <MapPin size={16} className="flex-shrink-0" />
                <span className="min-w-0 break-words">{vehicle.immobilizedLocation}</span>
              </div>
            )}

            {/* Section chauffeur cliquable */}
            {showActions && onAssignDriver ? (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignDriver(); }}
                className="ui-button ui-button-secondary mt-1 min-w-0 max-w-full text-sm"
              >
                {hasDriver ? (
                  <>
                    <UserIcon size={16} />
                    {driverName || 'Chauffeur inconnu'}
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Assigner
                  </>
                )}
              </button>
            ) : hasDriver ? (
              <p className="text-sm text-brand-600 font-medium flex items-center gap-1 mt-0.5">
                <UserIcon size={16} />
                {driverName || 'Chauffeur inconnu'}
              </p>
            ) : null}
          </div>
        </div>
        <VehicleStatusBadge status={effectiveStatus} isRepairing={isRepairing} isReplacement={isReplacement} size="sm" />
      </div>

      {/* Contenu */}
      <div className="space-y-4">
        {/* Kilométrage */}
        <div className="flex flex-wrap justify-between items-center gap-2 border-b border-slate-200 py-2">
          <span className="text-sm text-slate-500 flex items-center gap-1">
            <Gauge size={14}/> Kilométrage
          </span>
          <span className="font-mono font-bold text-slate-800">
            {vehicle.currentMileage.toLocaleString('fr-FR')} km
          </span>
        </div>

        {/* Barre d'usure */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-bold text-slate-600 uppercase">Maintenance</span>
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

        <p className={`text-sm ${health.remaining < 0 ? 'text-red-800' : 'text-slate-600'}`}>{health.remaining > 0 ? `Entretien dans ${health.remaining.toLocaleString('fr-FR')} km` : 'Échéance d’entretien atteinte'}</p>
        {/* Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
          <div className="flex flex-col">
            <span className={`text-sm font-semibold ${controlOverdue ? 'text-red-800' : 'text-slate-600'}`}>{controlOverdue ? 'Contrôle technique dépassé' : 'Contrôle technique'}</span>
            <span className="text-sm font-medium text-slate-700">
              {vehicle.technicalControlDate
                ? new Date(vehicle.technicalControlDate).toLocaleDateString('fr-FR')
                : '-'}
            </span>
          </div>
        </div>
        {showActions && <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-button ui-button-secondary" onClick={onEdit} aria-label={`Modifier le véhicule ${vehicle.plate}`}><Edit size={18} />Modifier</button>
          {onDelete && <button type="button" className="ui-button ui-button-secondary" onClick={onDelete} aria-label={`Supprimer le véhicule ${vehicle.plate}`}><Trash2 size={18} />Supprimer</button>}
        </div>}
      </div>
    </div>
  );
};

export default VehicleCard;
