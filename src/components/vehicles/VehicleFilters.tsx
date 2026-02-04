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
    <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4 sticky top-4 z-20">
      {/* Recherche et Filtres */}
      <div className="flex flex-col md:flex-row items-center gap-2 w-full md:w-auto p-2">
        {/* Recherche */}
        <div className="relative group w-full md:w-64">
          <Search 
            size={16} 
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-600 transition-colors"
          />
          <input 
            type="text" 
            placeholder="Rechercher (Plaque, Modèle)..." 
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-brand-100 outline-none transition-all placeholder:text-slate-400 text-slate-800"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        
        {/* Tri */}
        <div className="relative group w-full md:w-auto">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-brand-600 transition-colors">
            <ArrowUpDown size={16} />
          </div>
          <select 
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortOption)}
            className="appearance-none w-full md:w-auto bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-sm rounded-xl pl-10 pr-8 py-2.5 outline-none cursor-pointer transition-all border-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="wear_desc">+ Usés d'abord</option>
            <option value="wear_asc">- Usés d'abord</option>
            <option value="plate">Par Immat.</option>
          </select>
        </div>

        {/* Filtre statut */}
        <div className="relative group w-full md:w-auto">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-hover:text-brand-600 transition-colors">
            <Filter size={16} />
          </div>
          <select 
            value={filterStatus}
            onChange={(e) => onFilterChange(e.target.value)}
            className="appearance-none w-full md:w-auto bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-sm rounded-xl pl-10 pr-8 py-2.5 outline-none cursor-pointer transition-all border-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="all">Tous statuts</option>
            <option value={VehicleStatus.ACTIVE}>En service</option>
            <option value={VehicleStatus.MAINTENANCE}>Maintenance</option>
            <option value={VehicleStatus.ISSUE}>En alerte</option>
            <option value={VehicleStatus.IMMOBILIZED}>Immobilisé</option>
            <option value={VehicleStatus.IDLE}>Au repos</option>
            <option value="replacement">Remplacements</option>
          </select>
        </div>
      </div>

      {/* Actions droite */}
      <div className="flex items-center gap-3 w-full md:w-auto px-2">
        {/* Toggle vue */}
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button 
            onClick={() => onViewModeChange('list')} 
            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-400'}`}
          >
            <List size={20} />
          </button>
          <button 
            onClick={() => onViewModeChange('grid')} 
            className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-400'}`}
          >
            <LayoutGrid size={20} />
          </button>
        </div>
        
        {/* Bouton Ajouter */}
        {showAddButton && (
          <button 
            onClick={onAddClick}
            className="bg-slate-900 hover:bg-black text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-sm"
          >
            <Plus size={18} /> 
            <span className="hidden sm:inline">Ajouter</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default VehicleFilters;
