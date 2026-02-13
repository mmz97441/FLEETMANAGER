/**
 * useVehicles - Hook personnalisé pour la gestion des véhicules
 * Centralise la logique métier : permissions, filtrage, tri, stats
 */

import { useMemo, useState, useCallback } from 'react';
import { Vehicle, User, Issue, MaintenanceLog, VehicleStatus, UserRole, IssueStatus } from '../types';
import { usePermissions, Permission } from '../usePermissions';

// === TYPES ===
export type SortOption = 'plate' | 'wear_desc' | 'wear_asc';
export type ViewMode = 'list' | 'grid';

export interface VehicleStats {
  total: number;
  active: number;
  maintenance: number;
  issues: number;
  immobilized: number;  // Nouveau: véhicules immobilisés
  replacements: number; // Nouveau: véhicules de remplacement
  totalKm: number;
}

export interface MaintenanceHealth {
  percentage: number;
  color: string;
  remaining: number;
  isOverdue: boolean;
}

export interface EffectiveStatus {
  status: VehicleStatus;
  isRepairing: boolean;
}

// === FONCTIONS UTILITAIRES (exportées pour réutilisation) ===

export const normalizeRole = (role: string | UserRole): UserRole => {
  const r = String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (r.includes('admin')) return UserRole.ADMIN;
  if (r.includes('presiden')) return UserRole.PRESIDENT;
  if (r.includes('direction') || r.includes('directeur')) return UserRole.DIRECTOR;
  if (r.includes('secret')) return UserRole.SECRETARY;
  if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
  if (r.includes('mecan') || r.includes('mech')) return UserRole.MECHANIC;
  if (r.includes('client')) return UserRole.CLIENT;
  return role as UserRole;
};

export const getDriverId = (vehicle: Vehicle): string | null => {
  return vehicle.assignedDriverId || vehicle.driverId || null;
};

export const getEffectiveStatus = (
  vehicle: Vehicle, 
  issues: Issue[], 
  maintenanceLogs: MaintenanceLog[]
): EffectiveStatus => {
  // 0. Si véhicule explicitement immobilisé
  if (vehicle.status === VehicleStatus.IMMOBILIZED) {
    return { status: VehicleStatus.IMMOBILIZED, isRepairing: false };
  }
  
  // 1. Maintenance active (Logs "Pending") ?
  const hasActiveMaintenance = maintenanceLogs.some(
    m => m.vehicleId === vehicle.id && m.status === 'Pending'
  );
  if (hasActiveMaintenance) {
    return { status: VehicleStatus.MAINTENANCE, isRepairing: true };
  }

  // 2. Incident ouvert ?
  const activeIssue = issues.find(
    i => i.vehicleId === vehicle.id && i.status !== IssueStatus.RESOLVED
  );
  if (activeIssue) {
    // Si l'incident a immobilisé le véhicule
    if (activeIssue.vehicleImmobilized) {
      return { status: VehicleStatus.IMMOBILIZED, isRepairing: false };
    }
    // Si l'incident est "En réparation" (IN_PROGRESS) → MAINTENANCE
    if (activeIssue.status === IssueStatus.IN_PROGRESS) {
      return { status: VehicleStatus.MAINTENANCE, isRepairing: true };
    }
    return { status: VehicleStatus.ISSUE, isRepairing: false };
  }

  // 3. Fallback au statut déclaré
  if (vehicle.status === VehicleStatus.MAINTENANCE) {
    return { status: VehicleStatus.MAINTENANCE, isRepairing: true };
  }
  if (vehicle.status === VehicleStatus.ISSUE) {
    return { status: VehicleStatus.ISSUE, isRepairing: false };
  }

  return { status: vehicle.status, isRepairing: false };
};

export const getMaintenanceHealth = (vehicle: Vehicle): MaintenanceHealth => {
  const interval = vehicle.maintenanceInterval || 15000;
  const last = vehicle.lastMaintenanceMileage || 0;
  const current = vehicle.currentMileage;
  const used = current - last;
  const percentage = Math.min((used / interval) * 100, 100);
  const isOverdue = used >= interval;
  
  let color = 'bg-emerald-500';
  if (percentage > 90) color = 'bg-red-500';
  else if (percentage > 75) color = 'bg-orange-500';
  
  return { percentage, color, remaining: interval - used, isOverdue };
};

export const getActiveIssuesCount = (vehicleId: string, issues: Issue[]): number => {
  return issues.filter(
    i => i.vehicleId === vehicleId && i.status !== IssueStatus.RESOLVED
  ).length;
};

export const formatVehicleType = (type: string): string => {
  switch (type) {
    case 'Heavy Truck': return 'Poids Lourd';
    case 'Van': return 'Utilitaire';
    case 'Car': return 'Véhicule Léger';
    case 'Trailer': return 'Remorque';
    case 'Electric': return 'Électrique';
    default: return type;
  }
};

// === HOOK PRINCIPAL ===

interface UseVehiclesParams {
  vehicles: Vehicle[];
  users: User[];
  currentUser: User;
  issues: Issue[];
  maintenanceLogs: MaintenanceLog[];
}

interface UseVehiclesReturn {
  // Permissions
  effectiveRole: UserRole;
  canManage: boolean;
  canView: boolean;
  isDriver: boolean;
  
  // Filtres (state)
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filterStatus: string;
  setFilterStatus: (status: string) => void;
  sortBy: SortOption;
  setSortBy: (sort: SortOption) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  
  // Données calculées
  accessibleVehicles: Vehicle[];
  filteredVehicles: Vehicle[];
  stats: VehicleStats;
  availableDrivers: User[];
  
  // Helpers
  getDriverName: (vehicleId: string) => string | null;
  getVehicleStatus: (vehicle: Vehicle) => EffectiveStatus;
  getVehicleHealth: (vehicle: Vehicle) => MaintenanceHealth;
  getVehicleIssuesCount: (vehicleId: string) => number;
}

export const useVehicles = ({
  vehicles,
  users,
  currentUser,
  issues,
  maintenanceLogs
}: UseVehiclesParams): UseVehiclesReturn => {
  
  // === STATE ===
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('plate');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // === PERMISSIONS (via hook) ===
  const { hasPermission } = usePermissions();
  
  const effectiveRole = useMemo(() => normalizeRole(currentUser.role), [currentUser.role]);
  
  const permissions = useMemo(() => {
    const canViewAll = hasPermission(Permission.VEHICLES_VIEW_ALL);
    const canView = hasPermission(Permission.VEHICLES_VIEW);
    const canManage = hasPermission(Permission.VEHICLES_CREATE) || hasPermission(Permission.VEHICLES_EDIT);
    const canAssign = hasPermission(Permission.VEHICLES_ASSIGN);
    const isDriver = canView && !canViewAll; // Accès limité = chauffeur
    
    return { canView, canViewAll, canManage, canAssign, isDriver };
  }, [hasPermission]);

  // === VÉHICULES ACCESSIBLES (selon permissions) ===
  const accessibleVehicles = useMemo(() => {
    if (permissions.canViewAll) return vehicles;
    if (permissions.canView) {
      // Accès limité: uniquement son véhicule
      return vehicles.filter(v => getDriverId(v) === currentUser.id);
    }
    return [];
  }, [vehicles, currentUser.id, permissions.canViewAll, permissions.canView]);

  // === CHAUFFEURS DISPONIBLES ===
  const availableDrivers = useMemo(() => {
    return users.filter(u => {
      const role = normalizeRole(u.role);
      return role === UserRole.DRIVER;
    });
  }, [users]);

  // === HELPER: NOM DU CHAUFFEUR ===
  const getDriverName = useCallback((vehicleId: string): string | null => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    const driverId = vehicle ? getDriverId(vehicle) : null;
    if (!driverId) return null;
    const driver = users.find(u => u.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : null;
  }, [vehicles, users]);

  // === HELPERS STATUT/SANTÉ ===
  const getVehicleStatus = useCallback((vehicle: Vehicle): EffectiveStatus => {
    return getEffectiveStatus(vehicle, issues, maintenanceLogs);
  }, [issues, maintenanceLogs]);

  const getVehicleHealth = useCallback((vehicle: Vehicle): MaintenanceHealth => {
    return getMaintenanceHealth(vehicle);
  }, []);

  const getVehicleIssuesCount = useCallback((vehicleId: string): number => {
    return getActiveIssuesCount(vehicleId, issues);
  }, [issues]);

  // === STATISTIQUES ===
  const stats = useMemo((): VehicleStats => {
    let active = 0;
    let maintenance = 0;
    let issuesCount = 0;
    let immobilized = 0;
    let replacements = 0;
    
    accessibleVehicles.forEach(v => {
      // Compteur remplacements
      if (v.isReplacement) {
        replacements++;
      }
      
      const { status } = getEffectiveStatus(v, issues, maintenanceLogs);
      if (status === VehicleStatus.ACTIVE) active++;
      if (status === VehicleStatus.MAINTENANCE) maintenance++;
      if (status === VehicleStatus.ISSUE) issuesCount++;
      if (status === VehicleStatus.IMMOBILIZED) immobilized++;
    });

    // Ajouter les alertes d'échéance maintenance
    accessibleVehicles.forEach(v => {
      const health = getMaintenanceHealth(v);
      if (health.isOverdue) issuesCount++;
    });

    const totalKm = accessibleVehicles.reduce((acc, v) => acc + (v.currentMileage || 0), 0);
    
    return { 
      total: accessibleVehicles.length, 
      active, 
      maintenance, 
      issues: issuesCount,
      immobilized,
      replacements,
      totalKm 
    };
  }, [accessibleVehicles, issues, maintenanceLogs]);

  // === FILTRAGE ET TRI ===
  const filteredVehicles = useMemo(() => {
    let filtered = accessibleVehicles.filter(v => {
      // Recherche
      const matchesSearch = 
        v.plate.toLowerCase().includes(searchTerm.toLowerCase()) || 
        v.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.make || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      // Filtre basé sur le statut EFFECTIF
      const { status } = getEffectiveStatus(v, issues, maintenanceLogs);
      
      // Filtre spécial "replacement" pour les véhicules de remplacement
      if (filterStatus === 'replacement') {
        return matchesSearch && v.isReplacement === true;
      }
      
      const matchesStatus = filterStatus === 'all' || status === filterStatus;
      
      return matchesSearch && matchesStatus;
    });

    // Tri
    return filtered.sort((a, b) => {
      if (sortBy === 'wear_desc') {
        const healthA = getMaintenanceHealth(a).percentage;
        const healthB = getMaintenanceHealth(b).percentage;
        const diff = healthB - healthA;
        if (Math.abs(diff) > 0.1) return diff;
        
        // Tri secondaire : Nombre d'incidents
        const issuesA = getActiveIssuesCount(a.id, issues);
        const issuesB = getActiveIssuesCount(b.id, issues);
        return issuesB - issuesA;
      }
      if (sortBy === 'wear_asc') {
        return getMaintenanceHealth(a).percentage - getMaintenanceHealth(b).percentage;
      }
      // Par plaque
      return a.plate.localeCompare(b.plate);
    });
  }, [accessibleVehicles, searchTerm, filterStatus, sortBy, issues, maintenanceLogs]);

  return {
    // Permissions
    effectiveRole,
    canManage: permissions.canManage,
    canView: permissions.canView,
    isDriver: permissions.isDriver,
    
    // Filtres (state)
    searchTerm,
    setSearchTerm,
    filterStatus,
    setFilterStatus,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    
    // Données
    accessibleVehicles,
    filteredVehicles,
    stats,
    availableDrivers,
    
    // Helpers
    getDriverName,
    getVehicleStatus,
    getVehicleHealth,
    getVehicleIssuesCount
  };
};

export default useVehicles;
