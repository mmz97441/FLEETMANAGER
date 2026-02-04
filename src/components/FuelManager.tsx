
import React, { useState, useMemo, useEffect } from 'react';
import { FuelLog, Vehicle, User, UserRole } from '../types';
import { Droplet, Plus, TrendingUp, DollarSign, Calendar, Filter, X, Save, Car, ChevronDown, ChevronUp, Route, Gauge, Download, Eye, FileText, User as UserIcon, Search, Check, ExternalLink, Lock, Camera, Upload, AlertCircle, Edit2, AlertTriangle } from 'lucide-react';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { usePermissions, Permission } from '../usePermissions';

interface FuelManagerProps {
  logs: FuelLog[];
  vehicles: Vehicle[];
  users: User[];
  currentUser: User;
  onAddLog: (log: FuelLog) => Promise<void>;
  onUpdateLog?: (log: FuelLog) => Promise<void>;
}

export const FuelManager: React.FC<FuelManagerProps> = ({ logs, vehicles, users, currentUser, onAddLog, onUpdateLog }) => {
  
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewFuel = hasPermission(Permission.FUEL_VIEW);
  const canViewAllFuel = hasPermission(Permission.FUEL_VIEW_ALL);
  const canViewCosts = hasPermission(Permission.FUEL_VIEW_COSTS);
  const canCreateFuel = hasPermission(Permission.FUEL_CREATE);
  const canEditFuel = hasPermission(Permission.FUEL_EDIT);
  const canDeleteFuel = hasPermission(Permission.FUEL_DELETE);
  const canExportFuel = hasPermission(Permission.FUEL_EXPORT);
  
  // Helper: obtenir l'ID du chauffeur assigné (supporte driverId ET assignedDriverId)
  const getDriverId = (v: Vehicle) => v.assignedDriverId || v.driverId || null;
  
  // Filtrer les véhicules selon les permissions
  const accessibleVehicles = useMemo(() => {
    if (canViewAllFuel) return vehicles;
    if (canViewFuel) {
      return vehicles.filter(v => getDriverId(v) === currentUser.id);
    }
    return [];
  }, [vehicles, currentUser, canViewAllFuel, canViewFuel]);

  // Filtrer les logs selon les permissions
  const accessibleLogs = useMemo(() => {
    if (canViewAllFuel) return logs;
    if (canViewFuel) {
      const myVehicleIds = accessibleVehicles.map(v => v.id);
      return logs.filter(l => myVehicleIds.includes(l.vehicleId));
    }
    return [];
  }, [logs, accessibleVehicles, canViewAllFuel, canViewFuel]);

  // === TOUS LES HOOKS DOIVENT ÊTRE ICI (avant tout return conditionnel) ===
  
  // Filters State
  const getLastLogMonth = () => {
      if (accessibleLogs.length === 0) return new Date().toISOString().slice(0, 7);
      const sorted = [...accessibleLogs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return sorted[0].date.slice(0, 7);
  };

  const [monthFilter, setMonthFilter] = useState(() => getLastLogMonth());
  const [dateFilter, setDateFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  
  // Custom Select State (Searchable Dropdown)
  const [isVehicleSelectOpen, setIsVehicleSelectOpen] = useState(false);
  const [vehicleSearchTerm, setVehicleSearchTerm] = useState('');

  // Modal State (Add only)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showAdBlue, setShowAdBlue] = useState(false); 
  
  // EDIT MODAL STATE
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<FuelLog | null>(null);
  const [editForm, setEditForm] = useState({
    mileage: '' as any,
    volume: '' as any,
    cost: '' as any,
    adBlueVolume: '' as any,
    adBlueCost: '' as any
  });
  const [editMileageError, setEditMileageError] = useState<string | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);
  
  // CONFIRMATION STATE
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingLog, setPendingLog] = useState<FuelLog | null>(null);

  // PHOTO STATE (OBLIGATOIRE)
  const [receiptPhoto, setReceiptPhoto] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  
  // VALIDATION KM STATE
  const [mileageError, setMileageError] = useState<string | null>(null);
  const [mileageWarning, setMileageWarning] = useState<string | null>(null);

  const [newLog, setNewLog] = useState({
      vehicleId: '',
      date: new Date().toISOString().slice(0, 10),
      mileage: '' as any,
      volume: '' as any,
      cost: '' as any,
      adBlueVolume: '' as any,
      adBlueCost: '' as any
  });

  // === VALIDATION KILOMÉTRAGE ===
  // Récupère le dernier kilométrage connu pour un véhicule
  const getLastMileageForVehicle = (vehicleId: string): number | null => {
    if (!vehicleId) return null;
    
    const vehicleLogs = logs
      .filter(l => l.vehicleId === vehicleId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    if (vehicleLogs.length === 0) {
      // Pas de logs, vérifier le km initial du véhicule
      const vehicle = vehicles.find(v => v.id === vehicleId);
      return vehicle?.mileage || null;
    }
    
    return vehicleLogs[0].mileage;
  };

  // Valide le kilométrage saisi
  const validateMileage = (mileageStr: string, vehicleId: string): { valid: boolean; error?: string; warning?: string } => {
    const mileage = Number(mileageStr);
    
    // Vérifications de base
    if (isNaN(mileage) || mileage < 0) {
      return { valid: false, error: 'Le kilométrage doit être un nombre positif' };
    }
    
    // Limite absolue (aucun véhicule ne dépasse 2 millions de km)
    if (mileage > 2000000) {
      return { valid: false, error: '⚠️ Kilométrage impossible (max 2 000 000 km). Vérifiez votre saisie.' };
    }
    
    // Limite haute pour camions (1 million km max réaliste)
    if (mileage > 1000000) {
      return { valid: true, warning: '⚠️ Kilométrage très élevé. Êtes-vous sûr ?' };
    }
    
    const lastMileage = getLastMileageForVehicle(vehicleId);
    
    if (lastMileage !== null) {
      // Le km ne peut pas être inférieur au dernier relevé
      if (mileage < lastMileage) {
        return { 
          valid: false, 
          error: `❌ Le kilométrage ne peut pas être inférieur au dernier relevé (${lastMileage.toLocaleString()} km)` 
        };
      }
      
      // Différence depuis le dernier plein
      const diff = mileage - lastMileage;
      
      // Plus de 1500 km depuis le dernier plein = BLOQUÉ
      if (diff > 1500) {
        return { 
          valid: false, 
          error: `❌ +${diff.toLocaleString()} km depuis le dernier plein. Maximum autorisé : 1 500 km. Vérifiez votre saisie.` 
        };
      }
      
      // Plus de 1200 km = warning (proche de la limite)
      if (diff > 1200) {
        return { 
          valid: true, 
          warning: `⚠️ +${diff.toLocaleString()} km depuis le dernier plein (proche de la limite de 1 500 km)` 
        };
      }
    }
    
    return { valid: true };
  };

  // Handler pour le changement de kilométrage avec validation temps réel
  const handleMileageChange = (value: string) => {
    setNewLog(prev => ({ ...prev, mileage: value }));
    setMileageError(null);
    setMileageWarning(null);
    
    if (value && newLog.vehicleId) {
      const validation = validateMileage(value, newLog.vehicleId);
      if (!validation.valid && validation.error) {
        setMileageError(validation.error);
      } else if (validation.warning) {
        setMileageWarning(validation.warning);
      }
    }
  };

  // Handler pour le changement de véhicule (re-valide le km si déjà saisi)
  const handleVehicleChange = (vehicleId: string) => {
    setNewLog(prev => ({ ...prev, vehicleId }));
    setMileageError(null);
    setMileageWarning(null);
    
    // Pré-remplir avec le dernier km connu + suggestion
    const lastMileage = getLastMileageForVehicle(vehicleId);
    if (lastMileage && !newLog.mileage) {
      // Ne pas pré-remplir, mais afficher une indication
    }
    
    // Re-valider si km déjà saisi
    if (newLog.mileage && vehicleId) {
      const validation = validateMileage(newLog.mileage, vehicleId);
      if (!validation.valid && validation.error) {
        setMileageError(validation.error);
      } else if (validation.warning) {
        setMileageWarning(validation.warning);
      }
    }
  };

  useEffect(() => {
      if (accessibleVehicles.length === 1) {
          const singleVehicleId = accessibleVehicles[0].id;
          setVehicleFilter(singleVehicleId);
          setNewLog(prev => ({ ...prev, vehicleId: singleVehicleId }));
      } else {
          if (vehicleFilter !== 'all' && !accessibleVehicles.find(v => v.id === vehicleFilter)) {
              setVehicleFilter('all');
          }
      }
  }, [accessibleVehicles]);

  const availableMonths = useMemo(() => {
      const months = new Set(accessibleLogs.map(l => l.date.slice(0, 7)));
      months.add(new Date().toISOString().slice(0, 7));
      return Array.from(months).sort().reverse();
  }, [accessibleLogs]);

  const availableDates = useMemo(() => {
      if (!monthFilter || monthFilter === 'all') return [];
      const dates = new Set(
          accessibleLogs
          .filter(l => l.date.startsWith(monthFilter))
          .map(l => l.date.slice(0, 10))
      );
      return Array.from(dates).sort().reverse();
  }, [accessibleLogs, monthFilter]);

  const filteredLogs = useMemo(() => {
    return accessibleLogs.filter(log => {
        let matchesDate = true;
        if (dateFilter && dateFilter !== 'all') {
            matchesDate = log.date.startsWith(dateFilter);
        } else if (monthFilter && monthFilter !== 'all') {
            matchesDate = log.date.startsWith(monthFilter);
        }
        const matchesVehicle = vehicleFilter === 'all' || log.vehicleId === vehicleFilter;
        return matchesDate && matchesVehicle;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [accessibleLogs, monthFilter, dateFilter, vehicleFilter]);

  // --- STATS CALCULATION ---
  const stats = useMemo(() => {
    const logsByVehicle: Record<string, FuelLog[]> = {};
    accessibleLogs.forEach(log => {
        if (!logsByVehicle[log.vehicleId]) logsByVehicle[log.vehicleId] = [];
        logsByVehicle[log.vehicleId].push(log);
    });

    Object.values(logsByVehicle).forEach(vLogs => {
        vLogs.sort((a, b) => a.mileage - b.mileage);
    });

    const totalCost = filteredLogs.reduce((acc, log) => acc + log.cost + (log.adBlueCost || 0), 0);
    const totalVolume = filteredLogs.reduce((acc, log) => acc + log.volume, 0);
    const avgPrice = totalVolume > 0 ? filteredLogs.reduce((acc, log) => acc + log.cost, 0) / totalVolume : 0; 

    let periodDistance = 0;
    let periodConsumptionVolume = 0;

    filteredLogs.forEach(log => {
        const vehicleLogs = logsByVehicle[log.vehicleId];
        if (!vehicleLogs) return;

        const currentIndex = vehicleLogs.findIndex(l => l.id === log.id);
        
        if (currentIndex > 0) {
            const prevLog = vehicleLogs[currentIndex - 1];
            const dist = log.mileage - prevLog.mileage;
            
            if (dist > 0) {
                periodDistance += dist;
                periodConsumptionVolume += log.volume;
            }
        }
    });

    const avgConsumption = periodDistance > 0 ? (periodConsumptionVolume / periodDistance) * 100 : 0;

    return { totalCost, totalVolume, avgPrice, periodDistance, avgConsumption };
  }, [filteredLogs, accessibleLogs]);

  const getVehicle = (id: string) => {
    return accessibleVehicles.find(veh => veh.id === id);
  };

  const getDriver = (vehicle: Vehicle | undefined) => {
      if (!vehicle || !vehicle.assignedDriverId) return null;
      return users.find(u => u.id === vehicle.assignedDriverId);
  };

  const getRowMetrics = (log: FuelLog) => {
      const vehicleLogs = accessibleLogs
        .filter(l => l.vehicleId === log.vehicleId)
        .sort((a, b) => a.mileage - b.mileage);
      
      const currentIndex = vehicleLogs.findIndex(l => l.id === log.id);
      
      if (currentIndex > 0) {
          const prevLog = vehicleLogs[currentIndex - 1];
          const distance = log.mileage - prevLog.mileage;
          if (distance > 0) {
              const consumption = (log.volume / distance) * 100;
              return { distance, consumption: consumption.toFixed(2) };
          }
      }
      return { distance: null, consumption: null };
  };

  const formatMonthLabel = (yyyyMm: string) => {
      if (!yyyyMm) return '';
      const [y, m] = yyyyMm.split('-');
      const date = new Date(parseInt(y), parseInt(m) - 1);
      return date.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  };

  const formatDateLabel = (yyyyMmDd: string) => {
      if (!yyyyMmDd) return '';
      return new Date(yyyyMmDd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  };

  // Handler pour la sélection de photo
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPhotoError(null);
    
    if (file) {
      // Vérifier le type
      if (!file.type.startsWith('image/')) {
        setPhotoError('Le fichier doit être une image');
        return;
      }
      // Vérifier la taille (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setPhotoError('L\'image ne doit pas dépasser 5 Mo');
        return;
      }
      
      setReceiptPhoto(file);
      // Créer preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setReceiptPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      // Reset erreurs
      setPhotoError(null);
      setMileageError(null);
      
      // === VALIDATION 1: PHOTO OBLIGATOIRE ===
      if (!receiptPhoto) {
        setPhotoError('📸 La photo du ticket est OBLIGATOIRE pour valider le plein');
        return;
      }
      
      // === VALIDATION 2: CHAMPS REQUIS ===
      if (!newLog.vehicleId || !newLog.mileage || !newLog.volume || !newLog.cost) {
        return;
      }
      
      // === VALIDATION 3: KILOMÉTRAGE ===
      const mileageValidation = validateMileage(newLog.mileage, newLog.vehicleId);
      if (!mileageValidation.valid) {
        setMileageError(mileageValidation.error || 'Kilométrage invalide');
        return;
      }
      
      // Si warning mais valide, on continue (l'utilisateur a été prévenu)

      setIsUploading(true);
      
      try {
        // Upload de la photo vers Firebase Storage
        const storage = getStorage();
        const fileName = `fuel-receipts/${newLog.vehicleId}/${Date.now()}_${receiptPhoto.name}`;
        const storageRef = ref(storage, fileName);
        
        await uploadBytes(storageRef, receiptPhoto);
        const receiptUrl = await getDownloadURL(storageRef);

        const logEntry: FuelLog = {
            id: 'f-' + Date.now(),
            vehicleId: newLog.vehicleId,
            date: new Date(newLog.date).toISOString(),
            mileage: Number(newLog.mileage),
            volume: Number(newLog.volume),
            cost: Number(newLog.cost),
            fullTank: true,
            adBlueVolume: showAdBlue && newLog.adBlueVolume ? Number(newLog.adBlueVolume) : undefined,
            adBlueCost: showAdBlue && newLog.adBlueCost ? Number(newLog.adBlueCost) : undefined,
            receiptUrl: receiptUrl, // Photo du bon
        };

        setPendingLog(logEntry);
        setIsConfirmOpen(true);
      } catch (error) {
        console.error('Erreur upload photo:', error);
        setPhotoError('Erreur lors de l\'envoi de la photo. Réessayez.');
      } finally {
        setIsUploading(false);
      }
  };

  const executeAddLog = async () => {
      if (pendingLog) {
          await onAddLog(pendingLog);
          setIsModalOpen(false);
          setNewLog({ 
              vehicleId: accessibleVehicles.length === 1 ? accessibleVehicles[0].id : '', 
              date: new Date().toISOString().slice(0, 10), 
              mileage: '', 
              volume: '', 
              cost: '', 
              adBlueVolume: '', 
              adBlueCost: '' 
          });
          setShowAdBlue(false);
          // Reset photo state
          setReceiptPhoto(null);
          setReceiptPreview(null);
          setPhotoError(null);
      }
      setIsConfirmOpen(false);
      setPendingLog(null);
  };

  // === FONCTIONS D'ÉDITION ===
  
  // Vérifie si l'utilisateur peut modifier ce log
  const canEditThisLog = (log: FuelLog): boolean => {
    if (!onUpdateLog) return false;
    
    const userRole = String(currentUser.role || '').toLowerCase();
    
    // Président, Directeur, Secrétariat peuvent tout modifier
    if (userRole.includes('président') || userRole.includes('president') || 
        userRole.includes('directeur') || userRole.includes('direction') ||
        userRole.includes('secrétariat') || userRole.includes('secretariat') ||
        userRole.includes('admin')) {
      return true;
    }
    
    // Le chauffeur peut modifier ses propres pleins
    const vehicle = vehicles.find(v => v.id === log.vehicleId);
    if (vehicle) {
      const driverId = vehicle.assignedDriverId || vehicle.driverId;
      if (driverId === currentUser.id) {
        return true;
      }
    }
    
    return false;
  };

  // Ouvre le modal d'édition
  const handleOpenEdit = (log: FuelLog) => {
    setEditingLog(log);
    setEditForm({
      mileage: log.mileage.toString(),
      volume: log.volume.toString(),
      cost: log.cost.toString(),
      adBlueVolume: log.adBlueVolume?.toString() || '',
      adBlueCost: log.adBlueCost?.toString() || ''
    });
    setEditMileageError(null);
    setIsEditModalOpen(true);
  };

  // Valide le km pour l'édition (moins strict car correction)
  const validateEditMileage = (mileageStr: string): { valid: boolean; error?: string } => {
    const mileage = Number(mileageStr);
    
    if (isNaN(mileage) || mileage < 0) {
      return { valid: false, error: 'Le kilométrage doit être un nombre positif' };
    }
    
    if (mileage > 2000000) {
      return { valid: false, error: '⚠️ Kilométrage impossible (max 2 000 000 km)' };
    }
    
    return { valid: true };
  };

  // Handler changement km en édition
  const handleEditMileageChange = (value: string) => {
    setEditForm(prev => ({ ...prev, mileage: value }));
    setEditMileageError(null);
    
    if (value) {
      const validation = validateEditMileage(value);
      if (!validation.valid) {
        setEditMileageError(validation.error || 'Erreur');
      }
    }
  };

  // Sauvegarde les modifications
  const handleSaveEdit = async () => {
    if (!editingLog || !onUpdateLog) return;
    
    // Validation
    const validation = validateEditMileage(editForm.mileage);
    if (!validation.valid) {
      setEditMileageError(validation.error || 'Erreur');
      return;
    }
    
    if (!editForm.mileage || !editForm.volume || !editForm.cost) {
      return;
    }
    
    setIsEditSaving(true);
    
    try {
      const updatedLog: FuelLog = {
        ...editingLog,
        mileage: Number(editForm.mileage),
        volume: Number(editForm.volume),
        cost: Number(editForm.cost),
        adBlueVolume: editForm.adBlueVolume ? Number(editForm.adBlueVolume) : undefined,
        adBlueCost: editForm.adBlueCost ? Number(editForm.adBlueCost) : undefined,
        // Ajouter un flag de modification
        lastModifiedAt: new Date().toISOString(),
        lastModifiedBy: currentUser.id,
        lastModifiedByName: `${currentUser.firstName} ${currentUser.lastName}`
      };
      
      await onUpdateLog(updatedLog);
      setIsEditModalOpen(false);
      setEditingLog(null);
    } catch (error) {
      console.error('Erreur modification:', error);
      alert('Erreur lors de la modification');
    } finally {
      setIsEditSaving(false);
    }
  };

  const downloadCSV = () => {
    if (filteredLogs.length === 0) return;
    const headers = ["Date", "Véhicule", "Chauffeur", "Kilométrage", "Distance (km)", "Conso (L/100)", "Volume (L)", "Coût Total (€)", "AdBlue (L)", "AdBlue (€)"];
    const rows = filteredLogs.map(log => {
        const vehicle = getVehicle(log.vehicleId);
        const driver = getDriver(vehicle);
        const driverName = driver ? `${driver.firstName} ${driver.lastName}` : '-';
        const { distance, consumption } = getRowMetrics(log);
        const totalCost = log.cost + (log.adBlueCost || 0);

        return [
            new Date(log.date).toLocaleDateString('fr-FR'),
            vehicle ? `${vehicle.plate} - ${vehicle.model}` : log.vehicleId,
            driverName,
            log.mileage,
            distance || '',
            consumption ? consumption.replace('.', ',') : '',
            log.volume.toFixed(2).replace('.', ','),
            totalCost.toFixed(2).replace('.', ','),
            log.adBlueVolume ? log.adBlueVolume.toFixed(2).replace('.', ',') : '',
            log.adBlueCost ? log.adBlueCost.toFixed(2).replace('.', ',') : ''
        ];
    });

    const csvContent = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Carburant_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper for Initials
  const getInitials = (name: string) => {
      const parts = name.split(' ');
      return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
  };

  // --- LOGIC FOR CUSTOM SELECT ---
  const filteredVehiclesForSelect = accessibleVehicles.filter(v => 
    v.plate.toLowerCase().includes(vehicleSearchTerm.toLowerCase()) || 
    v.model.toLowerCase().includes(vehicleSearchTerm.toLowerCase())
  );

  const currentVehicleLabel = vehicleFilter === 'all' 
    ? 'Tous les véhicules' 
    : accessibleVehicles.find(v => v.id === vehicleFilter)?.plate + ' - ' + accessibleVehicles.find(v => v.id === vehicleFilter)?.model;

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewFuel) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès à la gestion du carburant.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in relative pb-12">
      
      {/* --- STATS GRID (PREMIUM) --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {[
            canViewCosts && { label: 'Coût Période', value: stats.totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Volume Total', value: `${stats.totalVolume.toFixed(0)} L`, icon: Droplet, color: 'text-sky-600', bg: 'bg-sky-50' },
            canViewCosts && { label: 'Prix Moyen/L', value: `${stats.avgPrice.toFixed(3)} €`, icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
            { label: 'Distance', value: `${stats.periodDistance.toLocaleString()} km`, icon: Route, color: 'text-orange-600', bg: 'bg-orange-50' },
            { label: 'Conso. Moyenne', value: `${stats.avgConsumption > 0 ? stats.avgConsumption.toFixed(1) : '-'} L/100`, icon: Gauge, color: 'text-emerald-600', bg: 'bg-emerald-50' }
        ].filter(Boolean).map((stat, idx) => (
            <div key={idx} className="bg-white p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] border border-slate-100 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300">
                <div className="flex justify-between items-start mb-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                    <div className={`p-2 rounded-xl ${stat.bg} ${stat.color}`}>
                        <stat.icon size={18} />
                    </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">{stat.value}</h3>
            </div>
        ))}
      </div>

      {/* --- TOOLBAR --- */}
      <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4 sticky top-4 z-20">
          <div className="flex items-center gap-2 w-full md:w-auto p-2 overflow-visible">
             
             {/* Custom Searchable Vehicle Select */}
             <div className="relative group min-w-[240px]">
                <button 
                    onClick={() => {
                        if (accessibleVehicles.length > 1) {
                            setIsVehicleSelectOpen(!isVehicleSelectOpen);
                            setVehicleSearchTerm(''); 
                        }
                    }}
                    className={`w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-sm rounded-xl pl-4 pr-3 py-2.5 outline-none transition-all ${isVehicleSelectOpen ? 'ring-2 ring-brand-500/20 border-brand-500' : ''} ${accessibleVehicles.length === 1 ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Car size={16} className="text-slate-400 flex-shrink-0" />
                        <span className="truncate max-w-[180px]">{currentVehicleLabel}</span>
                    </div>
                    {accessibleVehicles.length > 1 && <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
                </button>

                {isVehicleSelectOpen && (
                    <>
                        <div className="fixed inset-0 z-20" onClick={() => setIsVehicleSelectOpen(false)}></div>
                        <div className="absolute top-[calc(100%+8px)] left-0 w-80 bg-white rounded-xl shadow-xl border border-slate-100 z-30 overflow-hidden flex flex-col animate-fade-in">
                            <div className="p-3 border-b border-slate-50">
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                    <input 
                                        autoFocus
                                        type="text" 
                                        placeholder="Rechercher immatriculation..." 
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-lg text-sm border-none outline-none focus:ring-2 focus:ring-brand-100 text-slate-800 placeholder:text-slate-400"
                                        value={vehicleSearchTerm}
                                        onChange={(e) => setVehicleSearchTerm(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="max-h-64 overflow-y-auto custom-scrollbar p-1">
                                <button 
                                    onClick={() => { setVehicleFilter('all'); setIsVehicleSelectOpen(false); }}
                                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-bold flex items-center justify-between mb-1 ${vehicleFilter === 'all' ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}
                                >
                                    <span>Tous les véhicules</span>
                                    {vehicleFilter === 'all' && <Check size={14} />}
                                </button>
                                {filteredVehiclesForSelect.map(v => (
                                    <button 
                                        key={v.id}
                                        onClick={() => { setVehicleFilter(v.id); setIsVehicleSelectOpen(false); }}
                                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center justify-between group ${vehicleFilter === v.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                                    >
                                        <div className="flex flex-col">
                                            <span className={`font-bold ${vehicleFilter === v.id ? 'text-brand-700' : 'text-slate-800'}`}>{v.plate}</span>
                                            <span className={`text-xs ${vehicleFilter === v.id ? 'text-brand-500' : 'text-slate-500'}`}>{v.model}</span>
                                        </div>
                                        {vehicleFilter === v.id && <Check size={14} className="text-brand-600" />}
                                    </button>
                                ))}
                                {filteredVehiclesForSelect.length === 0 && (
                                    <div className="px-4 py-8 text-center text-xs text-slate-400 italic">Aucun véhicule trouvé</div>
                                )}
                            </div>
                        </div>
                    </>
                )}
             </div>

             {/* Month Select */}
             <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-brand-600 transition-colors">
                    <Calendar size={16} />
                </div>
                <select 
                    value={monthFilter}
                    onChange={(e) => { setMonthFilter(e.target.value); setDateFilter(''); }}
                    className="appearance-none bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-sm rounded-xl pl-10 pr-8 py-2.5 outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all cursor-pointer min-w-[160px]"
                >
                    <option value="all">Historique complet</option>
                    {availableMonths.map(m => (
                        <option key={m} value={m}>{formatMonthLabel(m)}</option>
                    ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
             </div>

             {/* Date Select (Optional) */}
             {monthFilter && monthFilter !== 'all' && availableDates.length > 0 && (
                 <div className="relative animate-fade-in">
                    <select 
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="appearance-none bg-white border border-slate-200 text-slate-700 font-medium text-sm rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-brand-500/20 cursor-pointer hover:border-slate-300"
                    >
                        <option value="">Tous les jours</option>
                        {availableDates.map(d => (
                            <option key={d} value={d}>{formatDateLabel(d)}</option>
                        ))}
                    </select>
                 </div>
             )}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto px-2">
              {canExportFuel && (
              <button 
                 onClick={downloadCSV}
                 className="p-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-transparent hover:border-slate-200"
                 title="Exporter en CSV"
              >
                 <Download size={20} />
              </button>
              )}
              
              {canCreateFuel && accessibleVehicles.length > 0 && (
              <button 
                 onClick={() => setIsModalOpen(true)}
                 className="bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-slate-300 hover:shadow-xl transform hover:-translate-y-0.5 active:translate-y-0"
              >
                 <Plus size={18} /> <span className="hidden sm:inline">Nouveau Plein</span>
              </button>
              )}
              
              {canCreateFuel && accessibleVehicles.length === 0 && currentUser.role === UserRole.DRIVER && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 flex items-center gap-2">
                <AlertTriangle size={16} />
                <span>Aucun véhicule assigné — Contactez votre responsable</span>
              </div>
              )}
          </div>
      </div>

      {/* --- TABLE PREMIUM --- */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Véhicule</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Chauffeur</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Kilométrage</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Dist.</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Conso.</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Quantité</th>
                        {canViewCosts && <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Coût Total</th>}
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Reçu</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {filteredLogs.map((log) => {
                        const { distance, consumption } = getRowMetrics(log);
                        const totalCost = log.cost + (log.adBlueCost || 0);
                        const vehicle = getVehicle(log.vehicleId);
                        const driver = getDriver(vehicle);
                        const driverName = driver ? `${driver.firstName} ${driver.lastName}` : 'Inconnu';
                        const hasReceipt = Boolean(log.receiptUrl && log.receiptUrl.length > 5);
                        
                        return (
                        <tr key={log.id} className="hover:bg-slate-50/80 transition-colors group">
                            {/* DATE */}
                            <td className="px-6 py-4 text-slate-600 font-medium text-sm whitespace-nowrap">
                                {new Date(log.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </td>
                            
                            {/* VEHICULE */}
                            <td className="px-6 py-4">
                                <div>
                                    <div className="font-bold text-slate-900 font-mono tracking-tight text-sm">{vehicle ? vehicle.plate : log.vehicleId}</div>
                                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{vehicle ? vehicle.model : ''}</div>
                                </div>
                            </td>

                            {/* CHAUFFEUR (Tooltip amélioré) */}
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    {driver ? (
                                        <div 
                                            className="relative group/avatar cursor-help"
                                            title={driverName} // Fallback natif
                                        >
                                            {driver.avatarUrl ? (
                                                <img src={driver.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-sm" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold border border-indigo-200">
                                                    {getInitials(driver.firstName + ' ' + driver.lastName)}
                                                </div>
                                            )}
                                            {/* Info-bulle Personnalisée (Tooltip) */}
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 text-white text-xs font-medium px-2 py-1 rounded-lg opacity-0 group-hover/avatar:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none shadow-lg">
                                                {driverName}
                                                {/* Petite flèche */}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200" title="Aucun chauffeur">
                                            <UserIcon size={14} />
                                        </div>
                                    )}
                                    <div className="md:hidden text-sm text-slate-700 font-medium">
                                        {driver ? driver.lastName : '-'}
                                    </div>
                                </div>
                            </td>

                            {/* KILOMÉTRAGE */}
                            <td className="px-6 py-4 text-right">
                                <span className="font-mono font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded text-sm">
                                    {log.mileage.toLocaleString()}
                                </span>
                            </td>

                            {/* DISTANCE */}
                            <td className="px-6 py-4 text-right">
                                {distance ? (
                                    <span className="text-xs font-bold text-slate-500 flex items-center justify-end gap-1">
                                        +{distance} <span className="text-[10px] uppercase">km</span>
                                    </span>
                                ) : (
                                    <span className="text-slate-300 text-xs">-</span>
                                )}
                            </td>

                            {/* CONSO */}
                            <td className="px-6 py-4 text-center">
                                {consumption ? (
                                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${
                                        Number(consumption) > 25 ? 'bg-orange-50 text-orange-700 border-orange-100' :
                                        Number(consumption) > 15 ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                        'bg-emerald-50 text-emerald-700 border-emerald-100'
                                    }`}>
                                        {consumption} <span className="text-[10px] opacity-75">L/100</span>
                                    </span>
                                ) : (
                                    <span className="text-slate-300 text-xs italic">N/A</span>
                                )}
                            </td>

                            {/* QUANTITÉ */}
                            <td className="px-6 py-4 text-right">
                                <div className="font-bold text-slate-700 text-sm">{log.volume.toFixed(1)} <span className="text-xs font-normal text-slate-500">L</span></div>
                                {log.adBlueVolume && (
                                    <div className="text-[10px] font-bold text-sky-600 mt-0.5">
                                        + {Number(log.adBlueVolume).toFixed(1)}L AdBlue
                                    </div>
                                )}
                            </td>

                            {/* COÛT */}
                            {canViewCosts && (
                            <td className="px-6 py-4 text-right">
                                <div className="font-mono font-bold text-slate-900">{totalCost.toFixed(2)} €</div>
                            </td>
                            )}

                            {/* ACTIONS */}
                            <td className="px-6 py-4 text-center">
                                {hasReceipt ? (
                                    <button 
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            // SOLUTION INFAILLIBLE : OUVERTURE NOUVEL ONGLET
                                            if (log.receiptUrl) {
                                                window.open(log.receiptUrl, '_blank');
                                            }
                                        }}
                                        className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 p-2 rounded-full transition-all transform hover:scale-110 shadow-sm cursor-pointer z-10 relative group/eye"
                                        title="Voir le reçu (Nouvel onglet)"
                                    >
                                        <Eye size={18} strokeWidth={2.5} />
                                        <ExternalLink size={10} className="absolute top-1 right-1 opacity-0 group-hover/eye:opacity-100 transition-opacity text-indigo-400" />
                                    </button>
                                ) : (
                                    <span className="text-slate-300 cursor-not-allowed" title="Aucun reçu">
                                        <FileText size={18} />
                                    </span>
                                )}
                                
                                {/* Bouton Modifier */}
                                {canEditThisLog(log) && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleOpenEdit(log);
                                        }}
                                        className="text-amber-500 hover:text-amber-700 hover:bg-amber-50 p-2 rounded-full transition-all transform hover:scale-110 shadow-sm cursor-pointer ml-1"
                                        title="Modifier ce plein"
                                    >
                                        <Edit2 size={16} strokeWidth={2.5} />
                                    </button>
                                )}
                            </td>
                        </tr>
                    )})}
                    {filteredLogs.length === 0 && (
                        <tr>
                            <td colSpan={9} className="px-6 py-16 text-center text-slate-500">
                                <div className="flex flex-col items-center justify-center">
                                    <div className="bg-slate-50 p-4 rounded-full mb-3">
                                        <Search size={32} className="text-slate-300" />
                                    </div>
                                    <p className="font-bold text-slate-800">Aucun relevé trouvé</p>
                                    <p className="text-sm mt-1 text-slate-400">Modifiez les filtres ou ajoutez un nouveau plein.</p>
                                </div>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>

      {/* --- ADD MODAL --- */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nouveau Plein"
        subtitle="Saisissez les détails du ticket."
        size="lg"
        headerIcon={<Droplet size={20} />}
      >
        <form onSubmit={handleRequestSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Véhicule</label>
              <div className="relative">
                <Car className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <select 
                  required
                  disabled={accessibleVehicles.length === 1}
                  className={`w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white text-slate-900 font-bold text-sm ${accessibleVehicles.length === 1 ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                  value={newLog.vehicleId}
                  onChange={(e) => setNewLog({...newLog, vehicleId: e.target.value})}
                >
                  {accessibleVehicles.length > 1 && <option value="">Sélectionner un véhicule...</option>}
                  {accessibleVehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.plate} ({v.model})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="date"
                  required
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-bold text-sm"
                  value={newLog.date}
                  onChange={(e) => setNewLog({...newLog, date: e.target.value})}
                />
              </div>
            </div>
          </div>

                        {/* Main Fuel Data */}
                        <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-4">
                             <div>
                                 <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                                   Kilométrage Compteur
                                 </label>
                                 
                                 {/* Indication du dernier km connu */}
                                 {newLog.vehicleId && getLastMileageForVehicle(newLog.vehicleId) && (
                                   <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                                     <Gauge size={12} />
                                     Dernier relevé : <span className="font-bold text-slate-700">{getLastMileageForVehicle(newLog.vehicleId)?.toLocaleString()} km</span>
                                   </p>
                                 )}
                                 
                                 <input 
                                    type="number"
                                    required
                                    min="0"
                                    max="2000000"
                                    placeholder="Ex: 125 000"
                                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 outline-none text-slate-900 font-bold tracking-widest text-lg bg-white placeholder:font-normal placeholder:text-slate-400 placeholder:text-sm ${
                                      mileageError 
                                        ? 'border-red-400 focus:ring-red-500 bg-red-50' 
                                        : mileageWarning 
                                          ? 'border-orange-400 focus:ring-orange-500 bg-orange-50'
                                          : 'border-slate-300 focus:ring-brand-500'
                                    }`}
                                    value={newLog.mileage}
                                    onChange={(e) => handleMileageChange(e.target.value)}
                                />
                                
                                {/* Erreur km */}
                                {mileageError && (
                                  <p className="mt-2 text-sm text-red-600 font-medium flex items-start gap-2 bg-red-50 p-2 rounded-lg">
                                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                                    {mileageError}
                                  </p>
                                )}
                                
                                {/* Warning km */}
                                {mileageWarning && !mileageError && (
                                  <p className="mt-2 text-sm text-orange-600 font-medium flex items-start gap-2 bg-orange-50 p-2 rounded-lg">
                                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                                    {mileageWarning}
                                  </p>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                     <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Volume (L)</label>
                                     <input 
                                        type="number" step="0.01" required min="0" placeholder="0.00"
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-bold bg-white"
                                        value={newLog.volume}
                                        onChange={(e) => setNewLog({...newLog, volume: e.target.value})}
                                    />
                                </div>
                                <div>
                                     <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Coût (€)</label>
                                     <input 
                                        type="number" step="0.01" required min="0" placeholder="0.00"
                                        className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-bold bg-white"
                                        value={newLog.cost}
                                        onChange={(e) => setNewLog({...newLog, cost: e.target.value})}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* AdBlue Toggle Section */}
                        <div className={`rounded-xl border overflow-hidden transition-all duration-300 ${showAdBlue ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
                            <button
                                type="button"
                                onClick={() => setShowAdBlue(!showAdBlue)}
                                className="w-full flex items-center justify-between p-4 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <span className="flex items-center gap-3">
                                    <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${showAdBlue ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white border-slate-300'}`}>
                                        {showAdBlue && <Droplet size={12} fill="currentColor" />}
                                    </div>
                                    Ajouter AdBlue
                                </span>
                                {showAdBlue ? <ChevronUp size={16} className="text-sky-600" /> : <ChevronDown size={16} className="text-slate-400" />}
                            </button>
                            
                            {showAdBlue && (
                                <div className="p-4 pt-0 grid grid-cols-2 gap-4 animate-fade-in border-t border-sky-100">
                                    <div className="mt-4">
                                        <label className="block text-[10px] font-bold text-sky-700 uppercase mb-1">Volume AdBlue</label>
                                        <input 
                                            type="number" step="0.01" min="0" placeholder="0.0 L"
                                            className="w-full px-3 py-2 border border-sky-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm text-slate-900 font-bold bg-white"
                                            value={newLog.adBlueVolume}
                                            onChange={(e) => setNewLog({...newLog, adBlueVolume: e.target.value})}
                                        />
                                    </div>
                                    <div className="mt-4">
                                        <label className="block text-[10px] font-bold text-sky-700 uppercase mb-1">Coût AdBlue</label>
                                        <input 
                                            type="number" step="0.01" min="0" placeholder="0.00 €"
                                            className="w-full px-3 py-2 border border-sky-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm text-slate-900 font-bold bg-white"
                                            value={newLog.adBlueCost}
                                            onChange={(e) => setNewLog({...newLog, adBlueCost: e.target.value})}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* PHOTO BON D'ESSENCE - OBLIGATOIRE */}
                        <div className={`rounded-xl border-2 border-dashed p-4 transition-all ${
                          receiptPhoto 
                            ? 'border-green-300 bg-green-50' 
                            : photoError 
                              ? 'border-red-300 bg-red-50' 
                              : 'border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50'
                        }`}>
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Camera size={16} className="text-brand-500" />
                            Photo du bon d'essence
                            <span className="text-red-500">*</span>
                            <span className="text-[10px] font-normal text-slate-400 normal-case">(obligatoire)</span>
                          </label>
                          
                          {receiptPreview ? (
                            <div className="relative">
                              <img 
                                src={receiptPreview} 
                                alt="Aperçu bon" 
                                className="w-full h-40 object-cover rounded-lg border border-slate-200"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setReceiptPhoto(null);
                                  setReceiptPreview(null);
                                  setPhotoError(null);
                                }}
                                className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                              >
                                <X size={14} />
                              </button>
                              <div className="absolute bottom-2 left-2 px-2 py-1 bg-green-500 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                                <Check size={12} /> Photo ajoutée
                              </div>
                            </div>
                          ) : (
                            <label className="flex flex-col items-center justify-center cursor-pointer py-6">
                              <div className={`p-3 rounded-full mb-2 ${photoError ? 'bg-red-100' : 'bg-slate-200'}`}>
                                <Upload size={24} className={photoError ? 'text-red-500' : 'text-slate-500'} />
                              </div>
                              <span className="text-sm font-medium text-slate-600">
                                Cliquez ou glissez une photo
                              </span>
                              <span className="text-xs text-slate-400 mt-1">
                                JPG, PNG • Max 5 Mo
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={handlePhotoSelect}
                              />
                            </label>
                          )}
                          
                          {photoError && (
                            <div className="mt-2 flex items-center gap-2 text-red-600 text-sm">
                              <AlertCircle size={14} />
                              {photoError}
                            </div>
                          )}
                        </div>

                        {/* Submit Button */}
                        <div className="pt-4">
                            <button 
                                type="submit"
                                disabled={isUploading || !receiptPhoto || !!mileageError}
                                className={`w-full py-4 text-white rounded-xl font-bold text-lg transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-2 transform active:scale-[0.98] ${
                                  isUploading || !receiptPhoto || !!mileageError
                                    ? 'bg-slate-400 cursor-not-allowed'
                                    : 'bg-slate-900 hover:bg-black'
                                }`}
                            >
                                {isUploading ? (
                                  <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Envoi en cours...
                                  </>
                                ) : (
                                  <>
                                    <Save size={20} /> Enregistrer
                                  </>
                                )}
                            </button>
                            {!receiptPhoto && !photoError && (
                              <p className="text-center text-xs text-slate-400 mt-2">
                                📸 Ajoutez la photo du bon pour activer le bouton
                              </p>
                            )}
                            {mileageError && (
                              <p className="text-center text-xs text-red-500 mt-2">
                                ⚠️ Corrigez le kilométrage pour continuer
                              </p>
                            )}
                        </div>
                    </form>
      </Modal>

        {/* CONFIRM MODAL */}
        <ConfirmModal 
            isOpen={isConfirmOpen}
            onClose={() => setIsConfirmOpen(false)}
            onConfirm={executeAddLog}
            title="Enregistrer le plein ?"
            message={`Confirmez-vous l'ajout de ${newLog.volume}L pour ${newLog.cost}€ sur le véhicule ?`}
            type="success"
            confirmLabel="Valider"
        />

        {/* EDIT MODAL */}
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title="Modifier le plein"
          subtitle={editingLog ? `Plein du ${new Date(editingLog.date).toLocaleDateString('fr-FR')}` : ''}
          size="md"
          headerIcon={<Edit2 size={20} />}
        >
          {editingLog && (
            <div className="space-y-5">
              {/* Info véhicule */}
              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-sm text-slate-500">Véhicule</p>
                <p className="font-bold text-slate-800">
                  {(() => {
                    const v = vehicles.find(v => v.id === editingLog.vehicleId);
                    return v ? `${v.plate} - ${v.brand} ${v.model}` : editingLog.vehicleId;
                  })()}
                </p>
              </div>
              
              {/* Kilométrage */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Kilométrage Compteur
                </label>
                <input 
                  type="number"
                  min="0"
                  max="2000000"
                  className={`w-full px-4 py-3 border rounded-xl focus:ring-2 outline-none text-slate-900 font-bold tracking-widest text-lg bg-white ${
                    editMileageError 
                      ? 'border-red-400 focus:ring-red-500 bg-red-50' 
                      : 'border-slate-300 focus:ring-brand-500'
                  }`}
                  value={editForm.mileage}
                  onChange={(e) => handleEditMileageChange(e.target.value)}
                />
                {editMileageError && (
                  <p className="mt-2 text-sm text-red-600 font-medium flex items-start gap-2">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    {editMileageError}
                  </p>
                )}
              </div>
              
              {/* Volume et Coût */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Volume (L)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-bold bg-white"
                    value={editForm.volume}
                    onChange={(e) => setEditForm({...editForm, volume: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Coût (€)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-bold bg-white"
                    value={editForm.cost}
                    onChange={(e) => setEditForm({...editForm, cost: e.target.value})}
                  />
                </div>
              </div>
              
              {/* AdBlue (optionnel) */}
              {(editForm.adBlueVolume || editForm.adBlueCost) && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-sky-50 rounded-xl border border-sky-100">
                  <div>
                    <label className="block text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">AdBlue (L)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      className="w-full px-3 py-2 border border-sky-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm text-slate-900 font-bold bg-white"
                      value={editForm.adBlueVolume}
                      onChange={(e) => setEditForm({...editForm, adBlueVolume: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">AdBlue (€)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      className="w-full px-3 py-2 border border-sky-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm text-slate-900 font-bold bg-white"
                      value={editForm.adBlueCost}
                      onChange={(e) => setEditForm({...editForm, adBlueCost: e.target.value})}
                    />
                  </div>
                </div>
              )}
              
              {/* Photo existante */}
              {editingLog.receiptUrl && (
                <div className="bg-green-50 p-3 rounded-xl border border-green-200">
                  <p className="text-xs font-medium text-green-700 mb-2 flex items-center gap-1">
                    <Check size={14} /> Photo du ticket existante
                  </p>
                  <button
                    type="button"
                    onClick={() => window.open(editingLog.receiptUrl, '_blank')}
                    className="text-sm text-green-600 hover:text-green-800 underline flex items-center gap-1"
                  >
                    <Eye size={14} /> Voir la photo
                  </button>
                </div>
              )}
              
              {/* Boutons */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-3 px-4 border border-slate-300 rounded-xl text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isEditSaving || !!editMileageError || !editForm.mileage || !editForm.volume || !editForm.cost}
                  className={`flex-1 py-3 px-4 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition-colors ${
                    isEditSaving || !!editMileageError || !editForm.mileage || !editForm.volume || !editForm.cost
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-amber-500 hover:bg-amber-600'
                  }`}
                >
                  {isEditSaving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    <>
                      <Save size={18} /> Enregistrer
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </Modal>

    </div>
  );
};
