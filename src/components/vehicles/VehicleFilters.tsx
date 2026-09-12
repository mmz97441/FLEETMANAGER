/**
 * VehicleFilters - Barre de filtres et recherche
 */

import React from 'react';
import { Search, ArrowUpDown, LayoutGrid, List, Plus, Filter } from 'lucide-react';
import { VehicleStatus } from '../../types';
import { SortOption } from '../../hooks/useVehicles';

interface VehicleFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterStatus: string;
  onFilterChange: (value: string) => void;
  sortBy: SortOption;
  onSortChange: (value: SortOption) => void;
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  showAddButton: boolean;
  onAddClick: () => void;
}

const VehicleFilters: React.FC<VehicleFiltersProps> = ({
  searchTerm,
  onSearchChange,
  filterStatus,
  onFilterChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  showAddButton,
  onAddClick
}) => {
  return (
    <div className="ui-panel flex flex-wrap items-end gap-3 p-3">
      <label className="min-w-0 flex-1 basis-64 text-sm font-semibold text-slate-700">Rechercher un véhicule
        <input type="search" value={searchTerm} onChange={event => onSearchChange(event.target.value)} placeholder="Immatriculation ou modèle" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-base font-normal" />
      </label>
      <label className="min-w-0 flex-1 basis-40 text-sm font-semibold text-slate-700">Trier
        <select value={sortBy} onChange={event => onSortChange(event.target.value as SortOption)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base font-normal">
          <option value="wear_desc">Plus usés d’abord</option><option value="wear_asc">Moins usés d’abord</option><option value="plate">Immatriculation</option>
        </select>
      </label>
      <label className="min-w-0 flex-1 basis-40 text-sm font-semibold text-slate-700">Statut
        <select value={filterStatus} onChange={event => onFilterChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base font-normal">
          <option value="all">Tous les statuts</option><option value={VehicleStatus.ACTIVE}>En service</option><option value={VehicleStatus.MAINTENANCE}>Maintenance</option><option value={VehicleStatus.ISSUE}>En alerte</option><option value={VehicleStatus.IMMOBILIZED}>Immobilisé</option><option value={VehicleStatus.IDLE}>Au repos</option><option value="replacement">Remplacements</option>
        </select>
      </label>
      <div className="hidden gap-2 md:flex" aria-label="Présentation des véhicules">
        <button type="button" className="ui-filter" aria-label="Afficher le tableau des véhicules" aria-pressed={viewMode === 'list'} onClick={() => onViewModeChange('list')}><List size={20} /></button>
        <button type="button" className="ui-filter" aria-label="Afficher les cartes des véhicules" aria-pressed={viewMode === 'grid'} onClick={() => onViewModeChange('grid')}><LayoutGrid size={20} /></button>
      </div>
      {showAddButton && <button type="button" onClick={onAddClick} className="ui-button ui-button-primary"><Plus size={18} />Ajouter un véhicule</button>}
    </div>
  );
};

export default VehicleFilters;
