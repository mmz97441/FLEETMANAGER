/**
 * VehicleFormModal - Formulaire véhicule utilisant Modal partagé
 */

import React, { useEffect, useRef, useState } from 'react';
import { 
  Truck, Calendar, Settings, Hash, Tag, Gauge, Wrench, 
  Plus, Trash2, Info, AlertTriangle, User as UserIcon
} from 'lucide-react';
import { User, VehicleStatus, CustomDeadline, Vehicle } from '../../types';
import { VehicleFormData, FormTab } from '../../hooks/useVehicleForm';
import Modal from '../shared/Modal';
import { FormInput, FormSelect } from '../shared/FormInput';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
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
  const initialForm = useRef('');
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) initialForm.current = JSON.stringify(formData);
  wasOpen.current = isOpen;
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);
  const [saveError, setSaveError] = useState('');
  const dirty = isOpen && initialForm.current !== JSON.stringify(formData);
  const requestClose = useUnsavedChanges(dirty, saving);
  useEffect(() => { if (isOpen) setSaveError(''); }, [isOpen]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingLock.current) return;
    if (!formData.plate.trim() || !formData.model.trim()) { setSaveError('L’immatriculation et le modèle sont obligatoires.'); onTabChange('general'); return; }
    savingLock.current = true; setSaving(true); setSaveError('');
    try { await onSubmit(event); } catch (error) { setSaveError(`Le véhicule n’a pas été enregistré. Votre saisie est conservée. ${error instanceof Error ? error.message : ''}`); }
    finally { savingLock.current = false; setSaving(false); }
  };
  return (
    <Modal
      mobileFullscreen
      isOpen={isOpen}
      onClose={() => void requestClose(onClose)} busy={saving} preventClose={saving}
      title={editingId ? 'Modifier le véhicule' : 'Nouveau véhicule'}
      subtitle={editingId ? 'Mettre à jour les informations et le statut.' : 'Ajouter un véhicule à la flotte.'}
      size="2xl"
      headerIcon={<Truck size={20} />}
      bodyClassName="p-0"
      footer={<button type="submit" form="vehicle-edit-form" disabled={saving} className="ui-button ui-button-primary w-full">{saving ? 'Enregistrement…' : editingId ? 'Enregistrer les modifications' : 'Ajouter le véhicule'}</button>}
    >
      <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3" aria-label="Sections du véhicule">
        {([['general', 'Général', Truck], ['dates', 'Dates', Calendar], ['custom', 'Personnalisé', Settings]] as const).map(([tab, label, Icon]) => <button key={tab} type="button" disabled={saving} aria-pressed={activeTab === tab} onClick={() => onTabChange(tab)} className="ui-filter"><Icon size={18} />{label}</button>)}
      </div>
      {/* Form Content */}
      <div className="p-4 sm:p-6">
        <form id="vehicle-edit-form" onSubmit={submit}><fieldset disabled={saving} className="min-w-0 space-y-6">{saveError && <p role="alert" className="ui-notice ui-notice-danger">{saveError}</p>}
          
          {/* TAB: GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-5 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
                <div className="sm:col-span-2">
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
                <FormSelect label="Type de véhicule" value={formData.type} onChange={event => onFieldChange('type', event.target.value)} options={[{value:'Van',label:'Utilitaire (VUL)'},{value:'Heavy Truck',label:'Poids lourd (PL)'},{value:'Car',label:'Véhicule léger (VL)'},{value:'Trailer',label:'Remorque'},{value:'Electric',label:'Électrique'}]} />
                <FormSelect label="Statut" value={formData.status} onChange={event => onFieldChange('status', event.target.value as VehicleStatus)} options={[{value:VehicleStatus.ACTIVE,label:'En service'},{value:VehicleStatus.MAINTENANCE,label:'En maintenance'},{value:VehicleStatus.ISSUE,label:'Problème signalé'},{value:VehicleStatus.IDLE,label:'Suspendu'}]} />
                <FormSelect label="Chauffeur assigné" value={formData.assignedDriverId || ''} onChange={event => onFieldChange('assignedDriverId', event.target.value || '')} options={[{value:'',label:'Non assigné'},...availableDrivers.map(driver => ({value:driver.id,label:driver.firstName+' '+driver.lastName}))]} />
                <FormSelect label="Mode d’acquisition" value={formData.acquisitionType} onChange={event => onFieldChange('acquisitionType', event.target.value)} options={['Achat','LOA','LLD','Location courte durée'].map(value => ({value,label:value}))} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FormInput label="Contrôle Technique" type="date" value={formData.technicalControlDate} onChange={(e: any) => onFieldChange('technicalControlDate', e.target.value)} />
                <FormInput label="Extincteur" type="date" value={formData.fireExtinguisherDate} onChange={(e: any) => onFieldChange('fireExtinguisherDate', e.target.value)} />
              </div>

              {isPL && (
                <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                  <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2 mb-4">
                    <Info size={16}/> Spécifique Poids Lourd
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
                <h4 className="font-bold text-slate-800">Échéances personnalisées</h4>
                <button type="button" onClick={onAddDeadline} className="ui-button ui-button-secondary flex items-center gap-1 text-sm">
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
                    <div key={deadline.id || index} className="flex flex-wrap gap-3 items-end border-b border-slate-200 pb-3">
                      <div className="flex-1">
                        <FormInput label="Libellé" placeholder="Ex: Vidange boîte" value={deadline.label} onChange={(e: any) => onUpdateDeadline(index, 'label', e.target.value)} />
                      </div>
                      <div className="min-w-0 flex-1 basis-40">
                        <FormInput label="Date" type="date" value={deadline.date} onChange={(e: any) => onUpdateDeadline(index, 'date', e.target.value)} />
                      </div>
                      <button type="button" onClick={() => onRemoveDeadline(index)} aria-label={`Retirer l’échéance ${deadline.label || index + 1}`} className="ui-button ui-button-danger mb-1">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          </fieldset>
        </form>
      </div>
    </Modal>
  );
};

export default VehicleFormModal;
