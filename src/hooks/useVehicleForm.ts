/**
 * useVehicleForm - Hook pour la gestion du formulaire véhicule
 * Gère l'état du formulaire, les modals, la validation
 */

import { useState, useCallback } from 'react';
import { Vehicle, VehicleStatus, CustomDeadline } from '../types';

// === TYPES ===
export type FormTab = 'general' | 'dates' | 'custom';

export interface VehicleFormData extends Partial<Vehicle> {
  plate: string;
  model: string;
  make: string;
  type: string;
  status: VehicleStatus;
  currentMileage: number;
  maintenanceInterval: number;
  acquisitionType: string;
  assignedDriverId: string;
  technicalControlDate: string;
  fireExtinguisherDate: string;
  chronotachygraphDate: string;
  speedLimiterDate: string;
  tailgateDate: string;
  customDeadlines: CustomDeadline[];
}

export interface ConfirmState {
  isOpen: boolean;
  type: 'DELETE' | 'CONFIRM';
  title: string;
  message: string;
  vehicleId?: string;
}

// === INITIAL STATE ===
export const getInitialFormData = (): VehicleFormData => ({
  plate: '', 
  model: '', 
  make: '',
  type: 'Van', 
  status: VehicleStatus.ACTIVE, 
  currentMileage: 0, 
  maintenanceInterval: 15000, 
  acquisitionType: 'Achat',
  assignedDriverId: '',
  technicalControlDate: '',
  fireExtinguisherDate: '',
  chronotachygraphDate: '',
  speedLimiterDate: '',
  tailgateDate: '',
  customDeadlines: []
});

// === HOOK ===
interface UseVehicleFormParams {
  onAdd: (vehicle: Vehicle) => Promise<void>;
  onUpdate: (vehicle: Vehicle) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface UseVehicleFormReturn {
  // État modal
  isModalOpen: boolean;
  editingId: string | null;
  activeTab: FormTab;
  
  // État formulaire
  formData: VehicleFormData;
  isPL: boolean;
  
  // État confirmation
  confirmState: ConfirmState;
  
  // Actions modal
  openAdd: () => void;
  openEdit: (vehicle: Vehicle) => void;
  closeModal: () => void;
  setActiveTab: (tab: FormTab) => void;
  
  // Actions formulaire
  updateField: <K extends keyof VehicleFormData>(field: K, value: VehicleFormData[K]) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  
  // Actions custom deadlines
  addCustomDeadline: () => void;
  updateCustomDeadline: (index: number, field: keyof CustomDeadline, value: string) => void;
  removeCustomDeadline: (index: number) => void;
  
  // Actions confirmation
  requestDelete: (vehicle: Vehicle) => void;
  confirmDelete: () => Promise<void>;
  cancelConfirm: () => void;
}

export const useVehicleForm = ({
  onAdd,
  onUpdate,
  onDelete
}: UseVehicleFormParams): UseVehicleFormReturn => {
  
  // === MODAL STATE ===
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FormTab>('general');
  
  // === FORM STATE ===
  const [formData, setFormData] = useState<VehicleFormData>(getInitialFormData());
  
  // === CONFIRM STATE ===
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    type: 'DELETE',
    title: '',
    message: ''
  });

  // Détection PL (Poids Lourd)
  const isPL = formData.type === 'Heavy Truck';

  // === ACTIONS MODAL ===
  const openAdd = useCallback(() => {
    setFormData(getInitialFormData());
    setEditingId(null);
    setActiveTab('general');
    setIsModalOpen(true);
  }, []);

  const openEdit = useCallback((vehicle: Vehicle) => {
    setFormData({
      ...getInitialFormData(),
      ...vehicle,
      plate: vehicle.plate || '',
      model: vehicle.model || '',
      make: vehicle.make || '',
      type: vehicle.type || 'Van',
      status: vehicle.status || VehicleStatus.ACTIVE,
      currentMileage: vehicle.currentMileage || 0,
      maintenanceInterval: vehicle.maintenanceInterval || 15000,
      acquisitionType: vehicle.acquisitionType || 'Achat',
      assignedDriverId: vehicle.assignedDriverId || vehicle.driverId || '',
      technicalControlDate: vehicle.technicalControlDate || '',
      fireExtinguisherDate: vehicle.fireExtinguisherDate || '',
      chronotachygraphDate: vehicle.chronotachygraphDate || '',
      speedLimiterDate: vehicle.speedLimiterDate || '',
      tailgateDate: vehicle.tailgateDate || '',
      customDeadlines: vehicle.customDeadlines || []
    });
    setEditingId(vehicle.id);
    setActiveTab('general');
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData(getInitialFormData());
  }, []);

  // === ACTIONS FORMULAIRE ===
  const updateField = useCallback(<K extends keyof VehicleFormData>(
    field: K, 
    value: VehicleFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    const vehicleData: Vehicle = {
      id: editingId || `v-${Date.now()}`,
      plate: formData.plate.toUpperCase(),
      model: formData.model,
      make: formData.make,
      type: formData.type,
      status: formData.status,
      currentMileage: formData.currentMileage,
      lastMaintenanceMileage: formData.lastMaintenanceMileage || 0,
      maintenanceInterval: formData.maintenanceInterval,
      acquisitionType: formData.acquisitionType,
      assignedDriverId: formData.assignedDriverId || undefined,
      driverId: formData.assignedDriverId || null, // Compatibilité ancien champ
      technicalControlDate: formData.technicalControlDate || undefined,
      fireExtinguisherDate: formData.fireExtinguisherDate || undefined,
      chronotachygraphDate: formData.chronotachygraphDate || undefined,
      speedLimiterDate: formData.speedLimiterDate || undefined,
      tailgateDate: formData.tailgateDate || undefined,
      customDeadlines: formData.customDeadlines || []
    };

    if (editingId) {
      await onUpdate(vehicleData);
    } else {
      await onAdd(vehicleData);
    }
    
    closeModal();
  }, [editingId, formData, onAdd, onUpdate, closeModal]);

  // === CUSTOM DEADLINES ===
  const addCustomDeadline = useCallback(() => {
    const newDeadline: CustomDeadline = {
      id: `cd-${Date.now()}`,
      label: '',
      date: ''
    };
    setFormData(prev => ({
      ...prev,
      customDeadlines: [...(prev.customDeadlines || []), newDeadline]
    }));
  }, []);

  const updateCustomDeadline = useCallback((
    index: number, 
    field: keyof CustomDeadline, 
    value: string
  ) => {
    setFormData(prev => {
      const updated = [...(prev.customDeadlines || [])];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, customDeadlines: updated };
    });
  }, []);

  const removeCustomDeadline = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      customDeadlines: (prev.customDeadlines || []).filter((_, i) => i !== index)
    }));
  }, []);

  // === CONFIRMATION DELETE ===
  const requestDelete = useCallback((vehicle: Vehicle) => {
    setConfirmState({
      isOpen: true,
      type: 'DELETE',
      title: 'Supprimer ce véhicule ?',
      message: `Êtes-vous sûr de vouloir supprimer le véhicule ${vehicle.plate} ? Cette action est irréversible.`,
      vehicleId: vehicle.id
    });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (confirmState.vehicleId) {
      await onDelete(confirmState.vehicleId);
    }
    setConfirmState(prev => ({ ...prev, isOpen: false, vehicleId: undefined }));
  }, [confirmState.vehicleId, onDelete]);

  const cancelConfirm = useCallback(() => {
    setConfirmState(prev => ({ ...prev, isOpen: false }));
  }, []);

  return {
    // État modal
    isModalOpen,
    editingId,
    activeTab,
    
    // État formulaire
    formData,
    isPL,
    
    // État confirmation
    confirmState,
    
    // Actions modal
    openAdd,
    openEdit,
    closeModal,
    setActiveTab,
    
    // Actions formulaire
    updateField,
    handleSubmit,
    
    // Actions custom deadlines
    addCustomDeadline,
    updateCustomDeadline,
    removeCustomDeadline,
    
    // Actions confirmation
    requestDelete,
    confirmDelete,
    cancelConfirm
  };
};

export default useVehicleForm;
