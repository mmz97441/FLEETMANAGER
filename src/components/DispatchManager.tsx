/**
 * DISPATCH MANAGER
 * 
 * Interface pour créer des missions optimisées et les dispatcher aux chauffeurs
 */

import React, { useState, useMemo } from 'react';
import {
  Package, PackageStatus, Zone, Hub, User, UserRole, Vehicle,
  Mission, MissionStatus, MissionType, MissionStop,
  ZONE_COLORS
} from '../types';
import { optimizeRoute, isGMPROConfigured, getGoogleMapsApiKey } from '../services/gmproService';
import { addMission, updatePackage } from '../services/missionService';
import { logActivity } from '../services/activityLogService';
import { ActivityAction } from '../types';
import Modal from './shared/Modal';
import {
  Route, Package as PackageIcon, MapPin, Users, Truck, Play,
  CheckCircle, Loader2, AlertTriangle, Zap, Clock, Navigation,
  ChevronRight, User as UserIcon, RefreshCw
} from 'lucide-react';

interface DispatchManagerProps {
  packages: Package[];
  hubs: Hub[];
  users: User[];
  vehicles: Vehicle[];
  currentUser: User;
  selectedDate: string;
  onMissionCreated: () => void;
}

interface ZoneStats {
  zone: Zone;
  packageCount: number;
  stopCount: number;
  packages: Package[];
  hub: Hub | null;
  availableDrivers: User[];
}

const DispatchManager: React.FC<DispatchManagerProps> = ({
  packages,
  hubs,
  users,
  vehicles,
  currentUser,
  selectedDate,
  onMissionCreated
}) => {
  // États
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [optimizedStops, setOptimizedStops] = useState<MissionStop[]>([]);
  const [optimizationResult, setOptimizationResult] = useState<{
    success: boolean;
    totalDistance: number;
    estimatedDuration: number;
    error?: string;
  } | null>(null);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  
  // Filtrer les colis en attente
  const pendingPackages = useMemo(() => 
    packages.filter(p => 
      p.status === PackageStatus.PENDING && 
      p.createdAt.startsWith(selectedDate)
    ),
    [packages, selectedDate]
  );
  
  // Statistiques par zone
  const zoneStats = useMemo((): ZoneStats[] => {
    const stats: ZoneStats[] = [];
    
    for (const zone of Object.values(Zone)) {
      const zonePackages = pendingPackages.filter(p => p.zone === zone);
      
      // Compter les stops uniques (groupés par adresse)
      const uniqueStops = new Set(
        zonePackages.map(p => `${p.address}|${p.postalCode}`)
      );
      
      // Trouver le hub de cette zone
      const hub = hubs.find(h => h.zone === zone && h.isActive) || null;
      
      // Chauffeurs disponibles pour cette zone
      const availableDrivers = users.filter(u => 
        u.role === UserRole.DRIVER && 
        !u.isDisabled && 
        (u.zone === zone || !u.zone) // Zone assignée ou polyvalent
      );
      
      stats.push({
        zone,
        packageCount: zonePackages.length,
        stopCount: uniqueStops.size,
        packages: zonePackages,
        hub,
        availableDrivers
      });
    }
    
    return stats.filter(s => s.packageCount > 0);
  }, [pendingPackages, hubs, users]);
  
  // Zone sélectionnée avec ses stats
  const selectedZoneStats = useMemo(() => 
    zoneStats.find(s => s.zone === selectedZone) || null,
    [zoneStats, selectedZone]
  );
  
  // Véhicule du chauffeur sélectionné
  const selectedVehicle = useMemo(() => {
    if (!selectedDriver) return null;
    return vehicles.find(v => v.driverId === selectedDriver && v.status === 'active') || null;
  }, [selectedDriver, vehicles]);
  
  // Optimiser la tournée
  const handleOptimize = async () => {
    if (!selectedZoneStats || !selectedZoneStats.hub) return;
    
    setIsOptimizing(true);
    setOptimizationResult(null);
    
    try {
      const apiKey = getGoogleMapsApiKey();
      
      if (!apiKey) {
        // Mode fallback sans optimisation
        const stops = createSimpleStops(selectedZoneStats.packages);
        setOptimizedStops(stops);
        setOptimizationResult({
          success: true,
          totalDistance: stops.length * 5,
          estimatedDuration: stops.length * 15,
          error: 'API non configurée - ordre par défaut'
        });
      } else {
        const result = await optimizeRoute(
          selectedZoneStats.packages,
          selectedZoneStats.hub,
          selectedDate,
          apiKey
        );
        
        setOptimizedStops(result.stops);
        setOptimizationResult({
          success: result.success,
          totalDistance: result.totalDistance,
          estimatedDuration: result.estimatedDuration,
          error: result.error
        });
      }
    } catch (error) {
      console.error('Optimization error:', error);
      // Fallback
      const stops = createSimpleStops(selectedZoneStats.packages);
      setOptimizedStops(stops);
      setOptimizationResult({
        success: false,
        totalDistance: stops.length * 5,
        estimatedDuration: stops.length * 15,
        error: 'Erreur d\'optimisation - ordre par défaut'
      });
    }
    
    setIsOptimizing(false);
  };
  
  // Créer des stops simples (sans optimisation)
  const createSimpleStops = (packages: Package[]): MissionStop[] => {
    const groups = new Map<string, Package[]>();
    
    for (const pkg of packages) {
      const key = `${pkg.address}|${pkg.postalCode}|${pkg.city}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(pkg);
    }
    
    const stops: MissionStop[] = [];
    let sequence = 1;
    
    for (const [, pkgs] of groups) {
      const firstPkg = pkgs[0];
      stops.push({
        id: `stop-${Date.now()}-${sequence}`,
        sequence,
        type: 'DELIVERY',
        address: firstPkg.address,
        city: firstPkg.city,
        postalCode: firstPkg.postalCode,
        coordinates: firstPkg.coordinates,
        floor: firstPkg.floor,
        hasElevator: firstPkg.hasElevator,
        contactName: firstPkg.contactName,
        contactPhone: firstPkg.contactPhone,
        packageIds: pkgs.map(p => p.id),
        packageCount: pkgs.length,
        timeWindowStart: firstPkg.timeWindowStart,
        timeWindowEnd: firstPkg.timeWindowEnd,
        serviceTime: Math.max(5, pkgs.length * 5),
        status: 'PENDING' as any
      });
      sequence++;
    }
    
    return stops;
  };
  
  // Dispatcher la mission
  const handleDispatch = async () => {
    if (!selectedZoneStats || !selectedDriver || optimizedStops.length === 0) return;
    
    setIsDispatching(true);
    
    try {
      const driver = users.find(u => u.id === selectedDriver);
      const hub = selectedZoneStats.hub;
      
      if (!driver || !hub) {
        throw new Error('Chauffeur ou hub non trouvé');
      }
      
      // Créer la mission
      const mission: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'> = {
        date: selectedDate,
        zone: selectedZone!,
        hubId: hub.id,
        hubName: hub.name,
        type: MissionType.DELIVERY,
        status: MissionStatus.ASSIGNED,
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        vehicleId: selectedVehicle?.id,
        vehiclePlate: selectedVehicle?.plateNumber,
        stops: optimizedStops,
        stopCount: optimizedStops.length,
        packageCount: optimizedStops.reduce((sum, s) => sum + s.packageCount, 0),
        completedStops: 0,
        deliveredPackages: 0,
        failedPackages: 0,
        totalDistance: optimizationResult?.totalDistance || 0,
        estimatedDuration: optimizationResult?.estimatedDuration || 0
      };
      
      const missionId = await addMission(mission);
      
      // Mettre à jour le statut des colis
      const packageIds = optimizedStops.flatMap(s => s.packageIds);
      for (const pkgId of packageIds) {
        await updatePackage({
          id: pkgId,
          status: PackageStatus.ASSIGNED,
          missionId,
          assignedDriverId: driver.id,
          assignedAt: new Date().toISOString()
        } as any);
      }
      
      // Logger l'activité
      logActivity(currentUser, ActivityAction.ITEM_CREATED, {
        targetType: 'mission',
        targetId: missionId,
        targetName: `Mission ${selectedZone}`,
        details: {
          metadata: {
            zone: selectedZone,
            driver: driver.firstName + ' ' + driver.lastName,
            stops: optimizedStops.length,
            packages: packageIds.length
          }
        }
      });
      
      // Reset
      setShowDispatchModal(false);
      setSelectedZone(null);
      setSelectedDriver('');
      setOptimizedStops([]);
      setOptimizationResult(null);
      
      onMissionCreated();
      
    } catch (error) {
      console.error('Dispatch error:', error);
    }
    
    setIsDispatching(false);
  };
  
  // Ouvrir le modal de dispatch
  const openDispatchModal = (zone: Zone) => {
    setSelectedZone(zone);
    setSelectedDriver('');
    setOptimizedStops([]);
    setOptimizationResult(null);
    setShowDispatchModal(true);
  };
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Dispatch des missions</h2>
          <p className="text-sm text-slate-500">
            Créez et optimisez les tournées par zone, puis assignez aux chauffeurs
          </p>
        </div>
      </div>
      
      {/* Cartes par zone */}
      {zoneStats.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <PackageIcon size={48} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 mb-2">Aucun colis en attente de dispatch</p>
          <p className="text-sm text-slate-400">
            Importez des colis pour commencer à créer des missions
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {zoneStats.map(stat => {
            const colors = ZONE_COLORS[stat.zone];
            const hasHub = !!stat.hub;
            const hasDrivers = stat.availableDrivers.length > 0;
            const canDispatch = hasHub && hasDrivers;
            
            return (
              <div
                key={stat.zone}
                className={`bg-white rounded-xl border-2 overflow-hidden transition-all ${
                  canDispatch 
                    ? 'border-slate-200 hover:border-brand-300 hover:shadow-lg cursor-pointer' 
                    : 'border-slate-200 opacity-60'
                }`}
                onClick={() => canDispatch && openDispatchModal(stat.zone)}
              >
                {/* Header zone */}
                <div className={`${colors.bg} px-4 py-3 border-b ${colors.border}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${colors.dot}`} />
                      <span className={`font-bold ${colors.text}`}>{stat.zone}</span>
                    </div>
                    {canDispatch && (
                      <ChevronRight size={18} className={colors.text} />
                    )}
                  </div>
                </div>
                
                {/* Stats */}
                <div className="p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2 text-slate-600">
                      <PackageIcon size={16} />
                      <span className="text-sm">Colis</span>
                    </div>
                    <span className="text-xl font-bold text-slate-800">{stat.packageCount}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2 text-slate-600">
                      <MapPin size={16} />
                      <span className="text-sm">Stops</span>
                    </div>
                    <span className="text-lg font-bold text-slate-700">{stat.stopCount}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Users size={16} />
                      <span className="text-sm">Chauffeurs</span>
                    </div>
                    <span className={`text-lg font-bold ${hasDrivers ? 'text-green-600' : 'text-red-500'}`}>
                      {stat.availableDrivers.length}
                    </span>
                  </div>
                  
                  {/* Warnings */}
                  {!hasHub && (
                    <div className="flex items-center gap-2 text-amber-600 text-xs bg-amber-50 rounded-lg p-2">
                      <AlertTriangle size={14} />
                      <span>Hub non configuré</span>
                    </div>
                  )}
                  {!hasDrivers && hasHub && (
                    <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg p-2">
                      <AlertTriangle size={14} />
                      <span>Aucun chauffeur disponible</span>
                    </div>
                  )}
                </div>
                
                {/* Action */}
                {canDispatch && (
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
                    <button className="w-full flex items-center justify-center gap-2 text-brand-600 font-medium text-sm hover:text-brand-700">
                      <Zap size={16} />
                      Créer mission
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Modal Dispatch */}
      <Modal
        isOpen={showDispatchModal}
        onClose={() => setShowDispatchModal(false)}
        title={`Créer mission - Zone ${selectedZone}`}
        size="lg"
        headerIcon={<Route size={20} />}
      >
        {selectedZoneStats && (
          <div className="space-y-6">
            {/* Résumé */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <PackageIcon size={24} className="mx-auto text-slate-400 mb-2" />
                <p className="text-2xl font-bold text-slate-800">{selectedZoneStats.packageCount}</p>
                <p className="text-xs text-slate-500">Colis</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <MapPin size={24} className="mx-auto text-slate-400 mb-2" />
                <p className="text-2xl font-bold text-slate-800">{selectedZoneStats.stopCount}</p>
                <p className="text-xs text-slate-500">Stops</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <Clock size={24} className="mx-auto text-slate-400 mb-2" />
                <p className="text-2xl font-bold text-slate-800">
                  {optimizationResult ? `~${Math.round(optimizationResult.estimatedDuration / 60)}h` : '-'}
                </p>
                <p className="text-xs text-slate-500">Durée estimée</p>
              </div>
            </div>
            
            {/* Étape 1: Sélectionner un chauffeur */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                1. Sélectionner un chauffeur <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedDriver}
                onChange={(e) => setSelectedDriver(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white"
              >
                <option value="">Choisir un chauffeur...</option>
                {selectedZoneStats.availableDrivers.map(driver => {
                  const vehicle = vehicles.find(v => v.driverId === driver.id && v.status === 'active');
                  return (
                    <option key={driver.id} value={driver.id}>
                      {driver.firstName} {driver.lastName}
                      {vehicle ? ` - ${vehicle.plateNumber}` : ' (sans véhicule)'}
                    </option>
                  );
                })}
              </select>
              
              {selectedDriver && selectedVehicle && (
                <div className="mt-2 flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-lg p-2">
                  <Truck size={16} />
                  <span>Véhicule: {selectedVehicle.plateNumber}</span>
                </div>
              )}
            </div>
            
            {/* Étape 2: Optimiser */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                2. Optimiser la tournée
              </label>
              
              <button
                onClick={handleOptimize}
                disabled={isOptimizing || !selectedDriver}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-brand-500 to-blue-500 text-white rounded-xl font-medium hover:from-brand-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isOptimizing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Optimisation en cours...
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    {isGMPROConfigured() ? 'Optimiser avec Google GMPRO' : 'Calculer l\'itinéraire'}
                  </>
                )}
              </button>
              
              {/* Résultat optimisation */}
              {optimizationResult && (
                <div className={`mt-3 p-4 rounded-xl ${
                  optimizationResult.success ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {optimizationResult.success ? (
                      <CheckCircle size={18} className="text-green-600" />
                    ) : (
                      <AlertTriangle size={18} className="text-amber-600" />
                    )}
                    <span className={`font-medium ${optimizationResult.success ? 'text-green-800' : 'text-amber-800'}`}>
                      {optimizationResult.success ? 'Tournée optimisée !' : 'Optimisation partielle'}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500">Distance:</span>
                      <span className="ml-2 font-bold text-slate-800">
                        {optimizationResult.totalDistance.toFixed(1)} km
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Durée:</span>
                      <span className="ml-2 font-bold text-slate-800">
                        {Math.round(optimizationResult.estimatedDuration)} min
                      </span>
                    </div>
                  </div>
                  
                  {optimizationResult.error && (
                    <p className="mt-2 text-xs text-amber-700">{optimizationResult.error}</p>
                  )}
                </div>
              )}
            </div>
            
            {/* Aperçu des stops */}
            {optimizedStops.length > 0 && (
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Aperçu de la tournée ({optimizedStops.length} stops)
                </label>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                  {optimizedStops.map((stop, i) => (
                    <div 
                      key={stop.id}
                      className={`flex items-center gap-3 px-4 py-2 ${i > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      <div className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {stop.sequence}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {stop.contactName}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {stop.address}, {stop.city}
                        </p>
                      </div>
                      <div className="text-xs text-slate-500 shrink-0">
                        {stop.packageCount} colis
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                onClick={() => setShowDispatchModal(false)}
                className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleDispatch}
                disabled={!selectedDriver || optimizedStops.length === 0 || isDispatching}
                className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDispatching ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Dispatch en cours...
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    Dispatcher la mission
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

export default DispatchManager;
