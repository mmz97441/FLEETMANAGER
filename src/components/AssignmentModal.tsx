/**
 * Modal d'assignation Véhicule ↔ Chauffeur
 * 
 * Mode vehicle-to-driver: Sélectionner un chauffeur pour un véhicule
 * Mode driver-to-vehicle: Sélectionner un véhicule pour un chauffeur
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Vehicle, User, UserRole, VehicleStatus } from '../types';
import { 
  Truck, User as UserIcon, AlertTriangle, Check, X, Search, 
  ArrowRight, Ban, Loader2
} from 'lucide-react';
import Modal from './shared/Modal';
import {
  checkAssignmentConflicts,
  assignDriverToVehicle,
  getDriverCurrentVehicle,
  getVehicleCurrentDriver,
  getDriverFullName,
  AssignmentCheck
} from '../services/assignmentService';

// ============================================================================
// TYPES
// ============================================================================

interface AssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'vehicle-to-driver' | 'driver-to-vehicle';
  
  // Mode vehicle-to-driver: on a le véhicule, on cherche le chauffeur
  selectedVehicle?: Vehicle;
  
  // Mode driver-to-vehicle: on a le chauffeur, on cherche le véhicule  
  selectedDriver?: User;
  
  // Données
  vehicles: Vehicle[];
  users: User[];
  
  // Callback
  onAssignmentComplete?: () => void;
}

// ============================================================================
// COMPOSANT
// ============================================================================

const AssignmentModal: React.FC<AssignmentModalProps> = ({
  isOpen,
  onClose,
  mode,
  selectedVehicle,
  selectedDriver,
  vehicles,
  users,
  onAssignmentComplete
}) => {
  // === ÉTATS ===
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conflictCheck, setConflictCheck] = useState<AssignmentCheck | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedId(null);
      setConflictCheck(null);
      setShowConfirmation(false);
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  // === DONNÉES FILTRÉES ===
  
  // Liste des chauffeurs (pour mode vehicle-to-driver)
  const availableDrivers = useMemo(() => {
    if (mode !== 'vehicle-to-driver') return [];
    
    return users
      .filter(u => {
        const role = (u.role || '').toLowerCase();
        return role.includes('chauffeur') || role === 'driver' || u.role === UserRole.DRIVER;
      })
      .filter(u => {
        if (!searchTerm) return true;
        const fullName = `${u.firstName} ${u.lastName}`.toLowerCase();
        return fullName.includes(searchTerm.toLowerCase()) ||
               u.email.toLowerCase().includes(searchTerm.toLowerCase());
      });
  }, [users, mode, searchTerm]);

  // Liste des véhicules (pour mode driver-to-vehicle)
  const availableVehicles = useMemo(() => {
    if (mode !== 'driver-to-vehicle') return [];
    
    return vehicles.filter(v => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return v.plate.toLowerCase().includes(search) ||
             v.model.toLowerCase().includes(search);
    });
  }, [vehicles, mode, searchTerm]);

  // Assignation actuelle
  const currentAssignment = useMemo(() => {
    if (mode === 'vehicle-to-driver' && selectedVehicle) {
      const driver = getVehicleCurrentDriver(selectedVehicle, users);
      return driver ? {
        type: 'driver' as const,
        id: driver.id,
        label: getDriverFullName(driver)
      } : null;
    }
    
    if (mode === 'driver-to-vehicle' && selectedDriver) {
      const vehicle = getDriverCurrentVehicle(selectedDriver.id, vehicles);
      return vehicle ? {
        type: 'vehicle' as const,
        id: vehicle.id,
        label: `${vehicle.plate} - ${vehicle.model}`
      } : null;
    }
    
    return null;
  }, [mode, selectedVehicle, selectedDriver, vehicles, users]);

  // === HANDLERS ===

  // Sélectionner un élément
  const handleSelect = (id: string) => {
    setSelectedId(id);
    setError(null);
    setShowConfirmation(false);
    
    // Vérifier les conflits
    let vehicleId: string;
    let driverId: string;
    
    if (mode === 'vehicle-to-driver' && selectedVehicle) {
      vehicleId = selectedVehicle.id;
      driverId = id;
    } else if (mode === 'driver-to-vehicle' && selectedDriver) {
      vehicleId = id;
      driverId = selectedDriver.id;
    } else {
      return;
    }
    
    const check = checkAssignmentConflicts(vehicleId, driverId, vehicles, users);
    setConflictCheck(check);
  };

  // Effectuer l'assignation
  const handleAssign = async () => {
    if (!selectedId) return;
    
    // Si conflit et pas encore confirmé, demander confirmation
    if (conflictCheck && !conflictCheck.canAssign && !showConfirmation) {
      setShowConfirmation(true);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      let vehicleId: string;
      let driverId: string;
      
      if (mode === 'vehicle-to-driver' && selectedVehicle) {
        vehicleId = selectedVehicle.id;
        driverId = selectedId;
      } else if (mode === 'driver-to-vehicle' && selectedDriver) {
        vehicleId = selectedId;
        driverId = selectedDriver.id;
      } else {
        throw new Error("Configuration invalide");
      }
      
      const result = await assignDriverToVehicle(vehicleId, driverId, vehicles);
      
      if (result.success) {
        onAssignmentComplete?.();
        onClose();
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'assignation");
    } finally {
      setLoading(false);
    }
  };

  // Libérer l'assignation actuelle
  const handleUnassign = async () => {
    setLoading(true);
    setError(null);
    
    try {
      let vehicleId: string | null = null;
      
      if (mode === 'vehicle-to-driver' && selectedVehicle) {
        vehicleId = selectedVehicle.id;
      } else if (mode === 'driver-to-vehicle' && currentAssignment?.type === 'vehicle') {
        vehicleId = currentAssignment.id;
      }
      
      if (!vehicleId) {
        setError("Impossible de libérer");
        return;
      }
      
      const result = await assignDriverToVehicle(vehicleId, null, vehicles);
      
      if (result.success) {
        onAssignmentComplete?.();
        onClose();
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || "Erreur lors de la libération");
    } finally {
      setLoading(false);
    }
  };

  // === RENDER ===
  
  const modalTitle = mode === 'vehicle-to-driver'
    ? `Assigner un chauffeur • ${selectedVehicle?.plate || ''}`
    : `Assigner un véhicule • ${selectedDriver ? `${selectedDriver.firstName} ${selectedDriver.lastName}` : ''}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="md"
      headerIcon={mode === 'vehicle-to-driver' ? <UserIcon size={20} /> : <Truck size={20} />}
    >
      <div className="space-y-4">
        
        {/* Assignation actuelle */}
        {currentAssignment && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {currentAssignment.type === 'driver' ? (
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <UserIcon className="text-blue-600" size={20} />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Truck className="text-blue-600" size={20} />
                  </div>
                )}
                <div>
                  <p className="text-xs text-blue-600 font-medium">Actuellement assigné</p>
                  <p className="font-bold text-blue-800">{currentAssignment.label}</p>
                </div>
              </div>
              <button
                onClick={handleUnassign}
                disabled={loading}
                className="px-3 py-2 bg-white border border-blue-300 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-100 transition-colors flex items-center gap-2"
              >
                <Ban size={14} />
                Libérer
              </button>
            </div>
          </div>
        )}

        {/* Modal de confirmation de conflit */}
        {showConfirmation && conflictCheck?.conflict && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={24} />
              <div className="flex-1">
                <p className="font-bold text-amber-800 mb-1">
                  {conflictCheck.conflict.type === 'BOTH' ? 'Double changement requis' :
                   conflictCheck.conflict.type === 'VEHICLE_ALREADY_ASSIGNED' ? 'Véhicule déjà assigné' :
                   'Chauffeur déjà affecté'}
                </p>
                <p className="text-sm text-amber-700 whitespace-pre-line">
                  {conflictCheck.message}
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleAssign}
                    disabled={loading}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 transition-colors flex items-center gap-2"
                  >
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Confirmer le changement
                  </button>
                  <button
                    onClick={() => setShowConfirmation(false)}
                    disabled={loading}
                    className="px-4 py-2 bg-white border border-amber-300 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-50 transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Erreur */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="text-red-500 flex-shrink-0" size={20} />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Recherche et liste */}
        {!showConfirmation && (
          <>
            {/* Barre de recherche */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder={mode === 'vehicle-to-driver' 
                  ? "Rechercher un chauffeur..." 
                  : "Rechercher un véhicule..."
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm"
              />
            </div>

            {/* Liste */}
            <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              
              {/* Liste des chauffeurs */}
              {mode === 'vehicle-to-driver' && (
                availableDrivers.length === 0 ? (
                  <div className="p-6 text-center text-slate-500">
                    <UserIcon className="mx-auto mb-2 text-slate-300" size={32} />
                    <p className="font-medium">Aucun chauffeur trouvé</p>
                  </div>
                ) : (
                  availableDrivers.map(driver => {
                    const driverVehicle = getDriverCurrentVehicle(driver.id, vehicles);
                    const isSelected = selectedId === driver.id;
                    const isCurrent = currentAssignment?.id === driver.id;
                    
                    return (
                      <button
                        key={driver.id}
                        onClick={() => !isCurrent && handleSelect(driver.id)}
                        disabled={isCurrent}
                        className={`w-full p-4 flex items-center gap-4 text-left transition-all ${
                          isSelected 
                            ? 'bg-brand-50 border-l-4 border-brand-500' 
                            : isCurrent
                              ? 'bg-blue-50/50 opacity-60 cursor-not-allowed'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                          isSelected ? 'bg-brand-500' : isCurrent ? 'bg-blue-400' : 'bg-slate-400'
                        }`}>
                          {driver.firstName[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold truncate ${isSelected ? 'text-brand-700' : 'text-slate-800'}`}>
                            {driver.firstName} {driver.lastName}
                          </p>
                          {driverVehicle ? (
                            <p className="text-xs text-orange-600 font-medium flex items-center gap-1 mt-0.5">
                              <Truck size={12} />
                              A déjà : {driverVehicle.plate}
                            </p>
                          ) : (
                            <p className="text-xs text-green-600 font-medium mt-0.5">✓ Disponible</p>
                          )}
                        </div>
                        {isSelected && <Check className="text-brand-500 flex-shrink-0" size={24} />}
                        {isCurrent && (
                          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-bold">
                            Actuel
                          </span>
                        )}
                      </button>
                    );
                  })
                )
              )}

              {/* Liste des véhicules */}
              {mode === 'driver-to-vehicle' && (
                availableVehicles.length === 0 ? (
                  <div className="p-6 text-center text-slate-500">
                    <Truck className="mx-auto mb-2 text-slate-300" size={32} />
                    <p className="font-medium">Aucun véhicule trouvé</p>
                  </div>
                ) : (
                  availableVehicles.map(vehicle => {
                    const vehicleDriver = getVehicleCurrentDriver(vehicle, users);
                    const isSelected = selectedId === vehicle.id;
                    const isCurrent = currentAssignment?.id === vehicle.id;
                    
                    return (
                      <button
                        key={vehicle.id}
                        onClick={() => !isCurrent && handleSelect(vehicle.id)}
                        disabled={isCurrent}
                        className={`w-full p-4 flex items-center gap-4 text-left transition-all ${
                          isSelected 
                            ? 'bg-brand-50 border-l-4 border-brand-500' 
                            : isCurrent
                              ? 'bg-blue-50/50 opacity-60 cursor-not-allowed'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                          isSelected ? 'bg-brand-500 text-white' : isCurrent ? 'bg-blue-100 text-blue-500' : 'bg-slate-100 text-slate-500'
                        }`}>
                          <Truck size={24} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`font-bold ${isSelected ? 'text-brand-700' : 'text-slate-800'}`}>
                              {vehicle.plate}
                            </p>
                            <span className={`w-2 h-2 rounded-full ${
                              vehicle.status === VehicleStatus.ACTIVE ? 'bg-green-500' : 
                              vehicle.status === VehicleStatus.MAINTENANCE ? 'bg-orange-500' : 'bg-red-500'
                            }`}></span>
                          </div>
                          <p className="text-xs text-slate-500 truncate">{vehicle.model}</p>
                          {vehicleDriver ? (
                            <p className="text-xs text-orange-600 font-medium flex items-center gap-1 mt-0.5">
                              <UserIcon size={12} />
                              Assigné à : {getDriverFullName(vehicleDriver)}
                            </p>
                          ) : (
                            <p className="text-xs text-green-600 font-medium mt-0.5">✓ Disponible</p>
                          )}
                        </div>
                        {isSelected && <Check className="text-brand-500 flex-shrink-0" size={24} />}
                        {isCurrent && (
                          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-bold">
                            Actuel
                          </span>
                        )}
                      </button>
                    );
                  })
                )
              )}
            </div>

            {/* Bouton d'assignation */}
            {selectedId && (
              <button
                onClick={handleAssign}
                disabled={loading}
                className="w-full py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Assignation en cours...
                  </>
                ) : (
                  <>
                    <ArrowRight size={18} />
                    Assigner
                    {conflictCheck && !conflictCheck.canAssign && (
                      <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                        Changement requis
                      </span>
                    )}
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

export default AssignmentModal;
