/**
 * ReplacementModal - Modal d'affectation de véhicule de remplacement
 * 
 * Permet d'affecter un véhicule de remplacement à un véhicule immobilisé
 * - Soit un véhicule existant du parc
 * - Soit un nouveau véhicule (location, prêt)
 */

import React, { useState, useMemo } from 'react';
import { 
  X, Truck, Calendar, User, Building2, MapPin, 
  Plus, AlertTriangle, ArrowRight, Check
} from 'lucide-react';
import { Vehicle, VehicleStatus, VehicleOwnership, ReplacementSource, User as UserType } from '../types';

interface ReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  immobilizedVehicle: Vehicle;
  availableVehicles: Vehicle[];  // Véhicules disponibles du parc
  users: UserType[];
  onConfirm: (data: ReplacementData) => Promise<void>;
}

export interface ReplacementData {
  // Mode
  useExistingVehicle: boolean;
  
  // Si véhicule existant
  existingVehicleId?: string;
  
  // Si nouveau véhicule
  newVehicle?: {
    plate: string;
    model: string;
    source: ReplacementSource;
    provider: string;        // Hertz, Europcar, etc.
    dailyCost?: number;      // Coût journalier
  };
  
  // Commun
  startDate: string;
  endDate?: string;          // Optionnel
  assignedDriverId?: string; // Chauffeur assigné
}

const ReplacementModal: React.FC<ReplacementModalProps> = ({
  isOpen,
  onClose,
  immobilizedVehicle,
  availableVehicles,
  users,
  onConfirm
}) => {
  const [mode, setMode] = useState<'existing' | 'new'>('new');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Formulaire véhicule existant
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  
  // Formulaire nouveau véhicule
  const [newPlate, setNewPlate] = useState('');
  const [newModel, setNewModel] = useState('');
  const [source, setSource] = useState<ReplacementSource>(ReplacementSource.RENTAL);
  const [provider, setProvider] = useState('');
  const [dailyCost, setDailyCost] = useState('');
  
  // Commun
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [assignedDriverId, setAssignedDriverId] = useState(
    immobilizedVehicle.assignedDriverId || immobilizedVehicle.driverId || ''
  );

  // Filtrer les véhicules disponibles (en service ou disponible, pas de remplacement)
  const filteredAvailableVehicles = useMemo(() => {
    return availableVehicles.filter(v => 
      v.id !== immobilizedVehicle.id &&
      (v.status === VehicleStatus.ACTIVE || v.status === VehicleStatus.IDLE) &&
      !v.isReplacement
    );
  }, [availableVehicles, immobilizedVehicle.id]);

  // Filtrer les chauffeurs
  const drivers = useMemo(() => {
    return users.filter(u => 
      u.role === 'Chauffeur' || 
      u.role?.toLowerCase().includes('chauff')
    );
  }, [users]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validation
    if (mode === 'existing' && !selectedVehicleId) {
      setError('Veuillez sélectionner un véhicule');
      return;
    }
    
    if (mode === 'new') {
      if (!newPlate.trim()) {
        setError('Veuillez saisir l\'immatriculation');
        return;
      }
      if (!newModel.trim()) {
        setError('Veuillez saisir le modèle');
        return;
      }
      if (!provider.trim()) {
        setError('Veuillez saisir le nom du fournisseur');
        return;
      }
    }
    
    if (!startDate) {
      setError('Veuillez saisir la date de début');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const data: ReplacementData = {
        useExistingVehicle: mode === 'existing',
        startDate,
        endDate: endDate || undefined,
        assignedDriverId: assignedDriverId || undefined,
      };
      
      if (mode === 'existing') {
        data.existingVehicleId = selectedVehicleId;
      } else {
        data.newVehicle = {
          plate: newPlate.toUpperCase().trim(),
          model: newModel.trim(),
          source,
          provider: provider.trim(),
          dailyCost: dailyCost ? parseFloat(dailyCost) : undefined,
        };
      }
      
      await onConfirm(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-xl">
                <Truck size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Véhicule de remplacement</h2>
                <p className="text-white/80 text-sm">
                  Pour {immobilizedVehicle.plate} - {immobilizedVehicle.model}
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
          
          {/* Alerte véhicule immobilisé */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-medium text-red-800">Véhicule immobilisé</p>
              <p className="text-sm text-red-600">
                {immobilizedVehicle.immobilizedReason || 'Raison non spécifiée'}
                {immobilizedVehicle.immobilizedLocation && (
                  <span className="block mt-1">
                    <MapPin size={12} className="inline mr-1" />
                    {immobilizedVehicle.immobilizedLocation}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Sélection du mode */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              Type de remplacement
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  mode === 'existing'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Truck size={24} className={mode === 'existing' ? 'text-brand-600' : 'text-slate-400'} />
                <p className={`font-medium mt-2 ${mode === 'existing' ? 'text-brand-700' : 'text-slate-700'}`}>
                  Véhicule du parc
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Utiliser un véhicule disponible
                </p>
              </button>
              
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  mode === 'new'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Plus size={24} className={mode === 'new' ? 'text-brand-600' : 'text-slate-400'} />
                <p className={`font-medium mt-2 ${mode === 'new' ? 'text-brand-700' : 'text-slate-700'}`}>
                  Location / Prêt
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Nouveau véhicule temporaire
                </p>
              </button>
            </div>
          </div>

          {/* Mode: Véhicule existant */}
          {mode === 'existing' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Sélectionner un véhicule disponible
                </label>
                {filteredAvailableVehicles.length === 0 ? (
                  <div className="bg-slate-50 rounded-xl p-4 text-center text-slate-500">
                    Aucun véhicule disponible
                  </div>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {filteredAvailableVehicles.map(v => (
                      <label
                        key={v.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                          selectedVehicleId === v.id
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="existingVehicle"
                          value={v.id}
                          checked={selectedVehicleId === v.id}
                          onChange={(e) => setSelectedVehicleId(e.target.value)}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedVehicleId === v.id ? 'border-brand-500' : 'border-slate-300'
                        }`}>
                          {selectedVehicleId === v.id && (
                            <div className="w-3 h-3 bg-brand-500 rounded-full" />
                          )}
                        </div>
                        <Truck size={18} className="text-slate-400" />
                        <div className="flex-1">
                          <p className="font-medium text-slate-800">{v.plate}</p>
                          <p className="text-xs text-slate-500">{v.model}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          v.status === VehicleStatus.IDLE
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {v.status}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mode: Nouveau véhicule */}
          {mode === 'new' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Immatriculation *
                  </label>
                  <input
                    type="text"
                    value={newPlate}
                    onChange={(e) => setNewPlate(e.target.value)}
                    placeholder="AB-123-CD"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent uppercase"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Modèle *
                  </label>
                  <input
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    placeholder="Iveco Daily"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Source
                </label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as ReplacementSource)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                >
                  <option value={ReplacementSource.RENTAL}>Location (Hertz, Europcar...)</option>
                  <option value={ReplacementSource.LOAN}>Prêt partenaire</option>
                  <option value={ReplacementSource.OTHER}>Autre</option>
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Fournisseur *
                  </label>
                  <input
                    type="text"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="HERTZ, Transport Martin..."
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Coût/jour (€)
                  </label>
                  <input
                    type="number"
                    value={dailyCost}
                    onChange={(e) => setDailyCost(e.target.value)}
                    placeholder="150"
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Dates et chauffeur (commun) */}
          <div className="border-t border-slate-200 pt-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  <Calendar size={14} className="inline mr-1" />
                  Date début *
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  <Calendar size={14} className="inline mr-1" />
                  Date fin prévue
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                <User size={14} className="inline mr-1" />
                Chauffeur assigné
              </label>
              <select
                value={assignedDriverId}
                onChange={(e) => setAssignedDriverId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              >
                <option value="">-- Aucun --</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.firstName} {d.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Récapitulatif visuel */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-3">Récapitulatif</p>
            <div className="flex items-center justify-center gap-4">
              <div className="text-center">
                <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <Truck size={24} className="text-red-600" />
                </div>
                <p className="text-sm font-bold text-slate-800">{immobilizedVehicle.plate}</p>
                <p className="text-xs text-red-600">Immobilisé</p>
              </div>
              
              <ArrowRight size={24} className="text-slate-400" />
              
              <div className="text-center">
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <Truck size={24} className="text-amber-600" />
                </div>
                <p className="text-sm font-bold text-slate-800">
                  {mode === 'existing' 
                    ? (filteredAvailableVehicles.find(v => v.id === selectedVehicleId)?.plate || '???')
                    : (newPlate || '???')
                  }
                </p>
                <p className="text-xs text-amber-600">Remplacement</p>
              </div>
            </div>
          </div>

          {/* Erreur */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="border-t border-slate-200 p-4 bg-slate-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl transition-colors font-medium"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-medium hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Enregistrement...
              </>
            ) : (
              <>
                <Check size={18} />
                Confirmer
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReplacementModal;
