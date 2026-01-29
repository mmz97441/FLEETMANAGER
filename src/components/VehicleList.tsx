/**
 * VehicleList - Composant principal de gestion du parc véhicules
 * Version refactorisée utilisant les hooks et composants modulaires
 * 
 * Fonctionnalités préservées :
 * - Affichage liste/grille
 * - Filtrage par statut, recherche, tri
 * - Cloisonnement par rôle (chauffeur voit son véhicule)
 * - Création/Édition/Suppression véhicules
 * - KPIs (stats du parc)
 * - Statut dynamique basé sur incidents/maintenances
 * - Échéances personnalisées
 * - Champs spécifiques Poids Lourd
 */

import React, { useState } from 'react';
import { Vehicle, User, FuelLog, MaintenanceLog, Issue } from '../types';
import { useVehicles } from '../hooks/useVehicles';
import { useVehicleForm } from '../hooks/useVehicleForm';

// Composants modulaires
import VehicleStats from './vehicles/VehicleStats';
import VehicleFilters from './vehicles/VehicleFilters';
import VehicleRow from './vehicles/VehicleRow';
import VehicleCard from './vehicles/VehicleCard';
import VehicleFormModal from './vehicles/VehicleFormModal';
import ConfirmModal from './ConfirmModal';
import AssignmentModal from './AssignmentModal';

// === PROPS ===
interface VehicleListProps {
  vehicles: Vehicle[];
  users: User[];
  currentUser: User;
  logs: FuelLog[];
  maintenanceLogs: MaintenanceLog[];
  issues: Issue[]; 
  onAddVehicle: (vehicle: Vehicle) => Promise<void>;
  onUpdateVehicle: (vehicle: Vehicle) => Promise<void>;
  onDeleteVehicle: (id: string) => Promise<void>;
  onSelectVehicle?: (id: string) => void; 
  onViewIncidents?: (vehicleId: string) => void; 
}

// === COMPOSANT ===
export const VehicleList: React.FC<VehicleListProps> = ({ 
  vehicles, 
  users, 
  currentUser, 
  logs, 
  maintenanceLogs, 
  issues,
  onAddVehicle, 
  onUpdateVehicle, 
  onDeleteVehicle,
  onSelectVehicle, 
  onViewIncidents 
}) => {
  
  // État pour le modal d'assignation
  const [assignmentModal, setAssignmentModal] = useState<{
    isOpen: boolean;
    vehicle: Vehicle | null;
  }>({ isOpen: false, vehicle: null });

  const openAssignmentModal = (vehicle: Vehicle) => {
    setAssignmentModal({ isOpen: true, vehicle });
  };

  const closeAssignmentModal = () => {
    setAssignmentModal({ isOpen: false, vehicle: null });
  };
  
  // === HOOK: Logique métier véhicules ===
  const {
    // Permissions
    canManage,
    
    // Filtres
    searchTerm,
    setSearchTerm,
    filterStatus,
    setFilterStatus,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    
    // Données
    filteredVehicles,
    stats,
    availableDrivers,
    
    // Helpers
    getDriverName
  } = useVehicles({
    vehicles,
    users,
    currentUser,
    issues,
    maintenanceLogs
  });

  // === HOOK: Formulaire véhicule ===
  const {
    // Modal
    isModalOpen,
    editingId,
    activeTab,
    formData,
    isPL,
    
    // Confirmation
    confirmState,
    
    // Actions modal
    openAdd,
    openEdit,
    closeModal,
    setActiveTab,
    
    // Actions form
    updateField,
    handleSubmit,
    
    // Custom deadlines
    addCustomDeadline,
    updateCustomDeadline,
    removeCustomDeadline,
    
    // Confirmation
    requestDelete,
    confirmDelete,
    cancelConfirm
  } = useVehicleForm({
    onAdd: onAddVehicle,
    onUpdate: onUpdateVehicle,
    onDelete: onDeleteVehicle
  });

  // === RENDER ===
  return (
    <div className="space-y-6 animate-fade-in relative pb-10">
      
      {/* KPIs */}
      <VehicleStats stats={stats} />

      {/* Filtres et Actions */}
      <VehicleFilters
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
        sortBy={sortBy}
        onSortChange={setSortBy}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showAddButton={canManage}
        onAddClick={openAdd}
      />

      {/* Vue Liste */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Véhicule</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Type</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Statut</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Usure Maint.</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Kilométrage</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Prochain CT</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVehicles.map((vehicle) => (
                  <VehicleRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    issues={issues}
                    maintenanceLogs={maintenanceLogs}
                    driverName={getDriverName(vehicle.id)}
                    showActions={canManage}
                    onSelect={() => onSelectVehicle?.(vehicle.id)}
                    onViewIncidents={() => onViewIncidents?.(vehicle.id)}
                    onEdit={() => openEdit(vehicle)}
                    onDelete={() => requestDelete(vehicle)}
                    onAssignDriver={() => openAssignmentModal(vehicle)}
                  />
                ))}
              </tbody>
            </table>
            
            {/* Empty State */}
            {filteredVehicles.length === 0 && (
              <div className="p-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-1">Aucun véhicule trouvé</h3>
                <p className="text-slate-500 text-sm">
                  {searchTerm || filterStatus !== 'all' 
                    ? 'Essayez de modifier vos filtres de recherche' 
                    : 'Commencez par ajouter un véhicule à votre flotte'}
                </p>
                {canManage && !searchTerm && filterStatus === 'all' && (
                  <button 
                    onClick={openAdd}
                    className="mt-4 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl font-bold text-sm"
                  >
                    Ajouter un véhicule
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vue Grille */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVehicles.map(vehicle => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              issues={issues}
              maintenanceLogs={maintenanceLogs}
              driverName={getDriverName(vehicle.id)}
              showActions={canManage}
              onSelect={() => onSelectVehicle?.(vehicle.id)}
              onViewIncidents={() => onViewIncidents?.(vehicle.id)}
              onEdit={() => openEdit(vehicle)}
              onAssignDriver={() => openAssignmentModal(vehicle)}
            />
          ))}
          
          {/* Empty State Grid */}
          {filteredVehicles.length === 0 && (
            <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-slate-200">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-700 mb-1">Aucun véhicule trouvé</h3>
              <p className="text-slate-500 text-sm">
                {searchTerm || filterStatus !== 'all' 
                  ? 'Essayez de modifier vos filtres de recherche' 
                  : 'Commencez par ajouter un véhicule à votre flotte'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal Formulaire */}
      <VehicleFormModal
        isOpen={isModalOpen}
        editingId={editingId}
        activeTab={activeTab}
        formData={formData}
        isPL={isPL}
        availableDrivers={availableDrivers}
        onClose={closeModal}
        onTabChange={setActiveTab}
        onFieldChange={updateField}
        onSubmit={handleSubmit}
        onAddDeadline={addCustomDeadline}
        onUpdateDeadline={updateCustomDeadline}
        onRemoveDeadline={removeCustomDeadline}
      />

      {/* Modal Confirmation Suppression */}
      <ConfirmModal 
        isOpen={confirmState.isOpen}
        onClose={cancelConfirm}
        onConfirm={confirmDelete}
        title={confirmState.title}
        message={confirmState.message}
        type="danger"
        confirmLabel="Supprimer"
      />

      {/* Modal d'assignation chauffeur */}
      <AssignmentModal
        isOpen={assignmentModal.isOpen}
        onClose={closeAssignmentModal}
        mode="vehicle-to-driver"
        selectedVehicle={assignmentModal.vehicle || undefined}
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

export default VehicleList;
