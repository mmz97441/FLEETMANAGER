
import React, { useState, useMemo } from 'react';
import { User, Vehicle, LeaveRequest, UserRole, LeaveStatus, VehicleStatus, Zone, ZONE_COLORS } from '../types';
import { ShieldCheck, ShieldAlert, Truck, Calendar, CheckCircle2, AlertCircle, Clock, Battery, MapPin, Edit, X, Save, Plus, Lock } from 'lucide-react';
import Modal from './shared/Modal';
import AssignmentModal from './AssignmentModal';
import { getVehicleForDriver } from '../services/assignmentService';
import { usePermissions, Permission } from '../usePermissions';

interface DriverListProps {
  users: User[];
  vehicles: Vehicle[];
  leaves: LeaveRequest[];
  currentUser?: User; // Optional pour compatibilité, mais nécessaire pour l'édit
  onUpdateUser?: (user: User) => void;
}

const DriverList: React.FC<DriverListProps> = ({ users, vehicles, leaves, currentUser, onUpdateUser }) => {
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewDrivers = hasPermission(Permission.DRIVERS_VIEW);
  const canViewDetail = hasPermission(Permission.DRIVERS_VIEW_DETAIL);
  const canEdit = hasPermission(Permission.DRIVERS_EDIT);

  // === HOOKS (doivent être appelés avant tout return conditionnel) ===
  const [editingDriver, setEditingDriver] = useState<User | null>(null);
  
  // État pour le modal d'assignation
  const [assignmentModal, setAssignmentModal] = useState<{
    isOpen: boolean;
    driver: User | null;
  }>({ isOpen: false, driver: null });

  // Filtrer uniquement les chauffeurs
  const drivers = users.filter(u => u.role === UserRole.DRIVER);

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewDrivers) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès à la liste des chauffeurs.
        </p>
      </div>
    );
  }

  const getDriverStatus = (userId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const currentLeave = leaves.find(l => 
        l.userId === userId && 
        l.status === LeaveStatus.APPROVED &&
        l.startDate <= today && 
        l.endDate >= today
    );

    if (currentLeave) {
        return { status: 'OnLeave', label: 'En Congés', leave: currentLeave };
    }
    return { status: 'Active', label: 'Actif', leave: null };
  };

  // Utilise le service centralisé pour trouver le véhicule
  const getAssignedVehicle = (userId: string) => {
      return getVehicleForDriver(userId, vehicles);
  };

  const getSafetyScore = (id: string) => {
      const seed = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
      return 70 + (seed % 30); 
  };

  const handleSaveDriver = (e: React.FormEvent) => {
      e.preventDefault();
      if (editingDriver && onUpdateUser) {
          onUpdateUser(editingDriver);
          setEditingDriver(null);
          // Feedback utilisateur simple
          alert("Profil chauffeur mis à jour avec succès.");
      }
  };
  
  // Ouvrir le modal d'assignation
  const openAssignmentModal = (driver: User) => {
    setAssignmentModal({ isOpen: true, driver });
  };
  
  const closeAssignmentModal = () => {
    setAssignmentModal({ isOpen: false, driver: null });
  };

  return (
    <div className="space-y-6 animate-fade-in relative">
        <div className="flex justify-between items-center">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Effectif Chauffeurs</h2>
                <p className="text-slate-600 font-medium">Vue d'ensemble de la disponibilité et des affectations.</p>
            </div>
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 shadow-sm">
                Total : {drivers.length} Chauffeurs
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {drivers.map((driver) => {
            const { status, label, leave } = getDriverStatus(driver.id);
            const vehicle = getAssignedVehicle(driver.id);
            const score = getSafetyScore(driver.id);
            const isOnLeave = status === 'OnLeave';

            return (
            <div key={driver.id} className={`bg-white rounded-2xl p-0 shadow-sm border transition-all hover:shadow-md relative group ${isOnLeave ? 'border-orange-200' : 'border-slate-200'}`}>
                
                {/* Header Card */}
                <div className={`p-6 border-b ${isOnLeave ? 'bg-orange-50 border-orange-100' : 'bg-white border-slate-100'} rounded-t-2xl relative`}>
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <img src={driver.avatarUrl} alt={driver.firstName} className="w-16 h-16 rounded-full border-4 border-white shadow-sm object-cover" />
                                <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${isOnLeave ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">{driver.firstName} {driver.lastName}</h3>
                                <p className="text-xs text-slate-600 font-bold">{driver.email}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                        isOnLeave ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                                    }`}>
                                        {isOnLeave ? <Clock size={10} /> : <CheckCircle2 size={10} />}
                                        {label}
                                    </div>
                                    {driver.zone ? (
                                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${ZONE_COLORS[driver.zone].bg} ${ZONE_COLORS[driver.zone].text}`}>
                                            <span className={`w-2 h-2 rounded-full ${ZONE_COLORS[driver.zone].dot}`}></span>
                                            {driver.zone}
                                        </div>
                                    ) : (
                                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-500 border border-dashed border-slate-300">
                                            <MapPin size={10} />
                                            Zone non définie
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* EDIT BUTTON - Always visible */}
                    {canEdit && (
                        <button 
                            onClick={() => setEditingDriver(driver)}
                            className="absolute top-4 right-4 p-2 bg-brand-50 hover:bg-brand-100 text-brand-600 hover:text-brand-700 rounded-full shadow-sm border border-brand-200 transition-all"
                            title="Modifier ce chauffeur"
                        >
                            <Edit size={16} />
                        </button>
                    )}
                </div>

                <div className="p-6 space-y-4">
                    
                    {/* Infos Congés */}
                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="flex items-center gap-2">
                            <Calendar size={18} className="text-brand-600" />
                            <span className="text-sm font-bold text-slate-600">Solde Congés</span>
                        </div>
                        <span className="text-lg font-bold text-slate-800">{driver.leaveBalance} <span className="text-xs font-normal text-slate-500">jours</span></span>
                    </div>

                    {/* Info Véhicule */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-slate-500 uppercase font-bold">Véhicule Assigné</p>
                            {canEdit && !isOnLeave && (
                                <button
                                    onClick={() => openAssignmentModal(driver)}
                                    className="text-xs text-brand-600 hover:text-brand-700 font-bold flex items-center gap-1 hover:underline"
                                >
                                    {vehicle ? <Edit size={12} /> : <Plus size={12} />}
                                    {vehicle ? 'Changer' : 'Assigner'}
                                </button>
                            )}
                        </div>
                        {isOnLeave ? (
                            <div className="border border-dashed border-orange-200 bg-orange-50 rounded-xl p-3 flex flex-col items-center text-center">
                                <AlertCircle className="text-orange-400 mb-1" size={20} />
                                <span className="text-sm font-bold text-orange-700">Non disponible</span>
                                <span className="text-xs text-orange-700 font-medium">Retour le {new Date(leave!.endDate).toLocaleDateString()}</span>
                            </div>
                        ) : vehicle ? (
                            <div 
                                onClick={() => canEdit && openAssignmentModal(driver)}
                                className={`bg-gradient-to-r from-brand-50 to-slate-50 rounded-xl p-3 border border-brand-200 ${canEdit ? 'cursor-pointer hover:border-brand-400 hover:shadow-sm' : ''} transition-all`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-brand-100 p-2 rounded-lg">
                                            <Truck size={18} className="text-brand-600" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-brand-900 text-sm">{vehicle.plate}</p>
                                            <p className="text-xs text-slate-600 font-medium">{vehicle.model}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className={`w-2 h-2 rounded-full ${vehicle.status === VehicleStatus.ACTIVE ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                                        <span className={`text-[10px] font-bold ${vehicle.status === VehicleStatus.ACTIVE ? 'text-green-600' : 'text-orange-600'}`}>
                                            {vehicle.status === VehicleStatus.ACTIVE ? 'Actif' : vehicle.status}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                                    <MapPin size={12} /> {vehicle.location?.address || 'En déplacement'}
                                </div>
                                {canEdit && (
                                    <div className="mt-2 pt-2 border-t border-brand-200 text-center">
                                        <span className="text-[10px] text-brand-600 font-medium">Cliquer pour modifier l'assignation</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <button 
                                onClick={() => canEdit && openAssignmentModal(driver)}
                                disabled={!canEdit}
                                className={`w-full border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center transition-all ${
                                    canEdit 
                                        ? 'border-brand-300 text-brand-500 bg-brand-50/50 hover:border-brand-500 hover:bg-brand-100/50 cursor-pointer' 
                                        : 'border-slate-300 text-slate-400'
                                }`}
                            >
                                <Truck size={28} className="mb-2" />
                                <span className="font-bold text-sm">Aucun véhicule</span>
                                {canEdit && (
                                    <span className="text-xs mt-1 flex items-center gap-1">
                                        <Plus size={12} /> Cliquer pour assigner
                                    </span>
                                )}
                            </button>
                        )}
                    </div>

                    {/* Score Sécurité */}
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-xs text-slate-500 uppercase font-bold">Score Eco-Conduite</span>
                            <span className={`font-bold ${score > 80 ? 'text-green-600' : score > 60 ? 'text-orange-600' : 'text-red-600'}`}>
                                {score}/100
                            </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div 
                                className={`h-full rounded-full ${score > 80 ? 'bg-green-500' : score > 60 ? 'bg-orange-400' : 'bg-red-500'}`} 
                                style={{ width: `${score}%` }}
                            ></div>
                        </div>
                    </div>

                </div>
            </div>
            );
        })}
        </div>

        {/* --- MODAL EDIT DRIVER --- */}
        <Modal
            isOpen={!!editingDriver}
            onClose={() => setEditingDriver(null)}
            title="Modifier Chauffeur"
            size="lg"
            headerIcon={<Edit size={20} />}
        >
            {editingDriver && (
                <form onSubmit={handleSaveDriver} className="space-y-6">
                    {/* Identité */}
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">Identité</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Prénom</label>
                                <input 
                                    type="text" required
                                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium"
                                    value={editingDriver.firstName}
                                    onChange={(e) => setEditingDriver({...editingDriver, firstName: e.target.value})}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Nom</label>
                                <input 
                                    type="text" required
                                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium"
                                    value={editingDriver.lastName}
                                    onChange={(e) => setEditingDriver({...editingDriver, lastName: e.target.value})}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
                            <input 
                                type="email" disabled
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-600 font-medium cursor-not-allowed"
                                value={editingDriver.email}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Zone géographique</label>
                            <div className="grid grid-cols-4 gap-2">
                                {Object.values(Zone).map((zone) => {
                                    const colors = ZONE_COLORS[zone];
                                    const isSelected = editingDriver.zone === zone;
                                    return (
                                        <button
                                            key={zone}
                                            type="button"
                                            onClick={() => setEditingDriver({...editingDriver, zone})}
                                            className={`py-2 px-3 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 ${
                                                isSelected 
                                                    ? `${colors.bg} ${colors.text} ${colors.border} ring-2 ring-offset-1 ring-slate-400` 
                                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                            }`}
                                        >
                                            <span className={`w-3 h-3 rounded-full ${colors.dot}`}></span>
                                            {zone}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-slate-500 mt-1">Secteur d'affectation du chauffeur</p>
                        </div>
                    </div>

                            {/* Congés */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">Ressources Humaines</h4>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">Solde de Congés (Jours)</label>
                                    <div className="relative">
                                        <input 
                                            type="number" step="0.5"
                                            className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none font-bold text-slate-900"
                                            value={editingDriver.leaveBalance}
                                            onChange={(e) => setEditingDriver({...editingDriver, leaveBalance: Number(e.target.value)})}
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 font-medium">Jours</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">Ne modifiez que pour régularisation manuelle.</p>
                                </div>
                            </div>

                            {/* Spécificités Chauffeur */}
                            <div className="space-y-4">
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">Qualifications & Permis</h4>
                                
                                <label className="flex items-center gap-3 p-3 border border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                                    <input 
                                        type="checkbox"
                                        className="w-5 h-5 text-brand-600 rounded focus:ring-brand-500 border-gray-300"
                                        checked={editingDriver.isHeavyGoodsDriver || false}
                                        onChange={(e) => setEditingDriver({...editingDriver, isHeavyGoodsDriver: e.target.checked})}
                                    />
                                    <span className="text-sm font-bold text-slate-800">Chauffeur Poids Lourd (PL)</span>
                                </label>

                                {editingDriver.isHeavyGoodsDriver && (
                                    <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 animate-fade-in">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Date FIMO (Initiale)</label>
                                            <input 
                                                type="date"
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 font-medium"
                                                value={editingDriver.fimoDate || ''}
                                                onChange={(e) => setEditingDriver({...editingDriver, fimoDate: e.target.value})}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Date FCO (Validité)</label>
                                            <input 
                                                type="date"
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 font-medium"
                                                value={editingDriver.fcoDate || ''}
                                                onChange={(e) => setEditingDriver({...editingDriver, fcoDate: e.target.value})}
                                            />
                                        </div>
                                    </div>
                                )}

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Dernier Scan Permis</label>
                                <input 
                                    type="date"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium"
                                    value={editingDriver.driverLicenseScanDate || ''}
                                    onChange={(e) => setEditingDriver({...editingDriver, driverLicenseScanDate: e.target.value})}
                                />
                            </div>
                        </div>

                        <button 
                            type="submit"
                            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-lg"
                        >
                            <Save size={20} /> Enregistrer les modifications
                        </button>
                    </form>
                )}
        </Modal>
        
        {/* Modal d'assignation de véhicule */}
        <AssignmentModal
          isOpen={assignmentModal.isOpen}
          onClose={closeAssignmentModal}
          mode="driver-to-vehicle"
          selectedDriver={assignmentModal.driver || undefined}
          vehicles={vehicles}
          users={users}
          onAssignmentComplete={() => {
            // Le listener Firestore mettra à jour automatiquement
            closeAssignmentModal();
          }}
        />
    </div>
  );
};

export default DriverList;