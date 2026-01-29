/**
 * VehicleFormModal - Formulaire véhicule utilisant Modal partagé
 */

import React, { useMemo } from 'react';
import { 
  Truck, Calendar, Settings, Hash, Tag, Gauge, Wrench, 
  Plus, Trash2, Info, AlertTriangle, User as UserIcon
} from 'lucide-react';
import { User, VehicleStatus, CustomDeadline, Vehicle } from '../../types';
import { VehicleFormData, FormTab } from '../../hooks/useVehicleForm';
import Modal from '../shared/Modal';
import { getVehicleForDriver } from '../../services/assignmentService';

interface VehicleFormModalProps {
  isOpen: boolean;
  editingId: string | null;
  activeTab: FormTab;
  formData: VehicleFormData;
  isPL: boolean;
  availableDrivers: User[];
  vehicles?: Vehicle[]; // Pour vérifier les conflits
  onClose: () => void;
  onTabChange: (tab: FormTab) => void;
  onFieldChange: <K extends keyof VehicleFormData>(field: K, value: VehicleFormData[K]) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onAddDeadline: () => void;
  onUpdateDeadline: (index: number, field: keyof CustomDeadline, value: string) => void;
  onRemoveDeadline: (index: number) => void;
}

// Composants de formulaire inline
const FormInput = ({ label, icon: Icon, ...props }: any) => (
  <div>
    <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5 ml-1">{label}</label>
    <div className="relative">
      {Icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Icon size={18} /></div>}
      <input 
        {...props}
        className={`w-full ${Icon ? 'pl-10' : 'pl-4'} pr-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all shadow-sm hover:border-slate-400 ${props.className || ''}`}
      />
    </div>
  </div>
);

const FormSelect = ({ label, children, ...props }: any) => (
  <div>
    <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5 ml-1">{label}</label>
    <select 
      {...props}
      className="w-full pl-4 pr-10 py-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all shadow-sm hover:border-slate-400 appearance-none cursor-pointer"
    >
      {children}
    </select>
  </div>
);

const VehicleFormModal: React.FC<VehicleFormModalProps> = ({
  isOpen,
  editingId,
  activeTab,
  formData,
  isPL,
  availableDrivers,
  onClose,
  onTabChange,
  onFieldChange,
  onSubmit,
  onAddDeadline,
  onUpdateDeadline,
  onRemoveDeadline
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingId ? 'Modifier Véhicule' : 'Nouveau Véhicule'}
      subtitle={editingId ? 'Mettre à jour les informations et le statut.' : 'Ajouter un véhicule à la flotte.'}
      size="2xl"
      headerIcon={<Truck size={20} />}
      bodyClassName="p-0"
    >
      {/* Tabs */}
      <div className="flex border-b border-slate-100 px-6 bg-white">
        <button 
          onClick={() => onTabChange('general')} 
          className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'general' 
              ? 'border-brand-600 text-brand-600' 
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Truck size={18} /> Général
        </button>
        <button 
          onClick={() => onTabChange('dates')} 
          className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'dates' 
              ? 'border-brand-600 text-brand-600' 
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Calendar size={18} /> Dates
          {isPL && <span className="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded font-bold">PL</span>}
        </button>
        <button 
          onClick={() => onTabChange('custom')} 
          className={`py-4 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'custom' 
              ? 'border-brand-600 text-brand-600' 
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Settings size={18} /> Personnalisé
        </button>
      </div>
      
      {/* Form Content */}
      <div className="p-6 bg-slate-50/50">
        <form onSubmit={onSubmit} className="space-y-6">
          
          {/* TAB: GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-5 animate-fade-in">
              <div className="grid grid-cols-2 gap-5">
                <FormInput 
                  label="Immatriculation" 
                  icon={Hash}
                  placeholder="AA-123-BB" 
                  required 
                  value={formData.plate} 
                  onChange={(e: any) => onFieldChange('plate', e.target.value.toUpperCase())}
                  className="font-mono uppercase tracking-wider"
                />
                <FormInput 
                  label="Marque" 
                  icon={Tag}
                  placeholder="Renault" 
                  value={formData.make} 
                  onChange={(e: any) => onFieldChange('make', e.target.value)}
                />
                <div className="col-span-2">
                  <FormInput 
                    label="Modèle" 
                    icon={Truck}
                    placeholder="Master L2H2 dCi 150" 
                    required 
                    value={formData.model} 
                    onChange={(e: any) => onFieldChange('model', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <FormSelect 
                  label="Type de Véhicule"
                  value={formData.type}
                  onChange={(e: any) => onFieldChange('type', e.target.value)}
                >
                  <option value="Van">Utilitaire (VUL)</option>
                  <option value="Heavy Truck">Poids Lourd (PL)</option>
                  <option value="Car">Véhicule Léger (VL)</option>
                  <option value="Trailer">Remorque</option>
                  <option value="Electric">Électrique</option>
                </FormSelect>

                <FormSelect 
                  label="Statut"
                  value={formData.status}
                  onChange={(e: any) => onFieldChange('status', e.target.value as VehicleStatus)}
                >
                  <option value={VehicleStatus.ACTIVE}>En Service</option>
                  <option value={VehicleStatus.MAINTENANCE}>En Maintenance</option>
                  <option value={VehicleStatus.ISSUE}>Problème Signalé</option>
                  <option value={VehicleStatus.IDLE}>Suspendu</option>
                </FormSelect>

                <FormSelect 
                  label="Chauffeur Assigné"
                  value={formData.assignedDriverId || ''} 
                  onChange={(e: any) => onFieldChange('assignedDriverId', e.target.value || '')}
                >
                  <option value="">Non assigné</option>
                  {availableDrivers.map(d => (
                    <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                  ))}
                </FormSelect>

                <FormSelect 
                  label="Mode d'acquisition"
                  value={formData.acquisitionType}
                  onChange={(e: any) => onFieldChange('acquisitionType', e.target.value)}
                >
                  <option value="Achat">Achat</option>
                  <option value="LOA">LOA</option>
                  <option value="LLD">LLD</option>
                  <option value="Location courte durée">Location courte durée</option>
                </FormSelect>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <FormInput 
                  label="Kilométrage Actuel"
                  icon={Gauge}
                  type="number"
                  placeholder="0" 
                  required 
                  value={formData.currentMileage} 
                  onChange={(e: any) => onFieldChange('currentMileage', Number(e.target.value))}
                />
                <FormInput 
                  label="Intervalle Maintenance (km)"
                  icon={Wrench}
                  type="number" 
                  placeholder="15000" 
                  value={formData.maintenanceInterval} 
                  onChange={(e: any) => onFieldChange('maintenanceInterval', Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {/* TAB: DATES */}
          {activeTab === 'dates' && (
            <div className="space-y-5 animate-fade-in">
              <div className="grid grid-cols-2 gap-5">
                <FormInput label="Contrôle Technique" type="date" value={formData.technicalControlDate} onChange={(e: any) => onFieldChange('technicalControlDate', e.target.value)} />
                <FormInput label="Extincteur" type="date" value={formData.fireExtinguisherDate} onChange={(e: any) => onFieldChange('fireExtinguisherDate', e.target.value)} />
              </div>

              {isPL && (
                <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                  <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2 mb-4">
                    <Info size={16}/> Spécifique Poids Lourd
                  </h4>
                  <div className="grid grid-cols-2 gap-5">
                    <FormInput label="Chronotachygraphe" type="date" value={formData.chronotachygraphDate} onChange={(e: any) => onFieldChange('chronotachygraphDate', e.target.value)} />
                    <FormInput label="Limiteur de vitesse" type="date" value={formData.speedLimiterDate} onChange={(e: any) => onFieldChange('speedLimiterDate', e.target.value)} />
                    <FormInput label="Hayon" type="date" value={formData.tailgateDate} onChange={(e: any) => onFieldChange('tailgateDate', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: CUSTOM */}
          {activeTab === 'custom' && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-slate-800">Échéances Personnalisées</h4>
                <button type="button" onClick={onAddDeadline} className="flex items-center gap-1 text-sm font-bold text-brand-600 hover:text-brand-700">
                  <Plus size={16} /> Ajouter
                </button>
              </div>

              {(formData.customDeadlines || []).length === 0 ? (
                <div className="text-center py-8 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                  <Calendar size={40} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Aucune échéance personnalisée</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(formData.customDeadlines || []).map((deadline, index) => (
                    <div key={deadline.id || index} className="flex gap-3 items-end bg-white p-3 rounded-xl border border-slate-200">
                      <div className="flex-1">
                        <FormInput label="Libellé" placeholder="Ex: Vidange boîte" value={deadline.label} onChange={(e: any) => onUpdateDeadline(index, 'label', e.target.value)} />
                      </div>
                      <div className="w-40">
                        <FormInput label="Date" type="date" value={deadline.date} onChange={(e: any) => onUpdateDeadline(index, 'date', e.target.value)} />
                      </div>
                      <button type="button" onClick={() => onRemoveDeadline(index)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg mb-1">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Submit */}
          <div className="pt-4 border-t border-slate-200">
            <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white py-3.5 rounded-xl font-bold shadow-lg transition-all">
              {editingId ? 'Enregistrer les modifications' : 'Ajouter le véhicule'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

export default VehicleFormModal;
