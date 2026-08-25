/**
 * DISPATCH MANAGER — Multi-véhicules
 * 
 * 1. Sélectionner un secteur (Nord/Sud/Est/Ouest)
 * 2. Sélectionner les chauffeurs disponibles
 * 3. Optimiser → GMPRO répartit les colis sur N chauffeurs
 * 4. Dispatcher toutes les tournées d'un coup
 */

import React, { useState, useMemo } from 'react';
import {
  Package, PackageStatus, Zone, Hub, User, UserRole, Vehicle, VehicleStatus,
  Mission, MissionStatus, MissionType, MissionStop, StopStatus,
  ZONE_COLORS
} from '../types';
import { optimizeMultiVehicle, isGMPROConfigured, getGoogleMapsApiKey, TourResult, OptimizationResult, DriverVehicle } from '../services/gmproService';
import { todayISO } from '../utils/date';
import { addMission, updatePackageStatus } from '../services/missionService';
import { notifyMissionAssigned } from '../services/notificationService';
import { logActivity } from '../services/activityLogService';
import { ActivityAction } from '../types';
import Modal from './shared/Modal';
import {
  Route, Package as PackageIcon, MapPin, Users, Truck, Play,
  CheckCircle, Loader2, AlertTriangle, Zap, Clock, Navigation,
  ChevronRight, User as UserIcon, ChevronDown, ChevronUp, XCircle
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
  const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set());
  const [selectedHubId, setSelectedHubId] = useState<string>('');
  
  // Heure minimum = heure actuelle arrondie au quart d'heure supérieur
  const getMinDepartureTime = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    now.setMinutes(roundedMinutes, 0, 0);
    if (roundedMinutes >= 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    }
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };
  
  const [plannedDepartureTime, setPlannedDepartureTime] = useState<string>(getMinDepartureTime);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [optimResult, setOptimResult] = useState<OptimizationResult | null>(null);
  const [expandedTour, setExpandedTour] = useState<number | null>(null);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  
  // Créneaux de livraison modifiés (packageId → { start, end })
  const [packageTimeWindows, setPackageTimeWindows] = useState<Record<string, { start: string; end: string }>>({});
  
  // Option pour ignorer les créneaux (force inclusion de tous les stops)
  const [ignoreTimeWindows, setIgnoreTimeWindows] = useState(false);
  
  // Filtrer les colis au hub — prêts à être dispatchés
  // FIX v3.7.10: Exclure les colis déjà assignés à une mission (anti-double dispatch)
  const pendingPackages = useMemo(() => 
    packages.filter(p => 
      (p.status === PackageStatus.AT_HUB || p.status === PackageStatus.SORTED) && 
      !p.missionId && 
      !p.currentDriverId
    ),
    [packages]
  );
  
  // Statistiques par zone
  const zoneStats = useMemo((): ZoneStats[] => {
    const stats: ZoneStats[] = [];
    
    for (const zone of Object.values(Zone)) {
      const zonePackages = pendingPackages.filter(p => p.zone === zone);
      const uniqueStops = new Set(zonePackages.map(p => `${p.address}|${p.postalCode}`));
      
      let hub = hubs.find(h => h.zone === zone && h.isActive) || null;
      if (!hub) {
        const zoneCPs = zonePackages.map(p => p.postalCode);
        hub = hubs.find(h => 
          h.isActive && h.assignedPostalCodes?.some(cp => zoneCPs.includes(cp))
        ) || null;
      }
      
      const driversWithZone = users.filter(u => 
        u.role === UserRole.DRIVER && !u.isDisabled && u.zone === zone
      );
      const allDrivers = users.filter(u => 
        u.role === UserRole.DRIVER && !u.isDisabled
      );
      const anyDriverHasZone = users.some(u => 
        u.role === UserRole.DRIVER && !u.isDisabled && u.zone
      );
      
      const availableDrivers = anyDriverHasZone
        ? users.filter(u => u.role === UserRole.DRIVER && !u.isDisabled && (u.zone === zone || !u.zone))
        : allDrivers;
      
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
  
  const selectedZoneStats = useMemo(() => 
    zoneStats.find(s => s.zone === selectedZone) || null,
    [zoneStats, selectedZone]
  );
  
  const departureHub = useMemo(() => {
    if (selectedHubId) return hubs.find(h => h.id === selectedHubId) || null;
    return hubs.find(h => h.isActive) || null;
  }, [selectedHubId, hubs]);
  
  const activeHubs = useMemo(() => hubs.filter(h => h.isActive), [hubs]);
  
  // Trouver le véhicule d'un chauffeur
  const getDriverVehicle = (driverId: string): Vehicle | undefined => {
    return vehicles.find(v => 
      (v.assignedDriverId === driverId || v.driverId === driverId) && 
      (v.status === VehicleStatus.ACTIVE || v.status === VehicleStatus.IDLE)
    );
  };
  
  // Toggle sélection chauffeur
  const toggleDriver = (driverId: string) => {
    setSelectedDriverIds(prev => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });
    // Reset résultat si on change les chauffeurs
    setOptimResult(null);
  };
  
  // Sélectionner/désélectionner tous
  const toggleAllDrivers = () => {
    if (!selectedZoneStats) return;
    if (selectedDriverIds.size === selectedZoneStats.availableDrivers.length) {
      setSelectedDriverIds(new Set());
    } else {
      setSelectedDriverIds(new Set(selectedZoneStats.availableDrivers.map(d => d.id)));
    }
    setOptimResult(null);
  };
  
  // Construire les paires chauffeur/véhicule
  const selectedDriversVehicles = useMemo((): DriverVehicle[] => {
    if (!selectedZoneStats) return [];
    return Array.from(selectedDriverIds)
      .map(id => {
        const driver = selectedZoneStats.availableDrivers.find(d => d.id === id);
        if (!driver) return null;
        return { driver, vehicle: getDriverVehicle(id) };
      })
      .filter(Boolean) as DriverVehicle[];
  }, [selectedDriverIds, selectedZoneStats, vehicles]);
  
  // ============================================================================
  // OPTIMISER LES TOURNÉES
  // ============================================================================
  
  const handleOptimize = async () => {
    if (!selectedZoneStats || selectedDriversVehicles.length === 0 || !departureHub) return;
    
    // Vérifier que l'heure de départ n'est pas dans le passé (si aujourd'hui)
    const isToday = selectedDate === todayISO();
    if (isToday) {
      const minTime = getMinDepartureTime();
      if (plannedDepartureTime < minTime) {
        alert(`L'heure de départ (${plannedDepartureTime}) est dans le passé. Minimum: ${minTime}`);
        setPlannedDepartureTime(minTime);
        return;
      }
    }
    
    setIsOptimizing(true);
    setOptimResult(null);
    setExpandedTour(null);
    
    try {
      const apiKey = getGoogleMapsApiKey();
      
      // Appliquer les créneaux modifiés aux packages (ou les ignorer si option activée)
      const packagesWithUpdatedTimeWindows = selectedZoneStats.packages.map(pkg => {
        if (ignoreTimeWindows) {
          // Ignorer les créneaux — livraison sans contrainte horaire
          return {
            ...pkg,
            timeWindowStart: undefined,
            timeWindowEnd: undefined
          };
        }
        const tw = packageTimeWindows[pkg.id];
        return {
          ...pkg,
          timeWindowStart: tw?.start || undefined,
          timeWindowEnd: tw?.end || undefined
        };
      });
      
      const result = await optimizeMultiVehicle(
        packagesWithUpdatedTimeWindows,
        selectedDriversVehicles,
        departureHub,
        selectedDate,
        apiKey,
        plannedDepartureTime  // Utiliser l'heure de départ du formulaire
      );
      
      setOptimResult(result);
      
      // Ouvrir le premier tour par défaut
      if (result.tours.length > 0) {
        setExpandedTour(0);
      }
      
    } catch (error) {
      console.error('Optimization error:', error);
      setOptimResult({
        success: false,
        tours: [],
        totalDistance: 0,
        totalDuration: 0,
        totalPackages: 0,
        skippedShipments: 0,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
        method: 'fallback'
      });
    }
    
    setIsOptimizing(false);
  };
  
  // ============================================================================
  // DISPATCHER TOUTES LES TOURNÉES
  // ============================================================================
  
  const handleDispatchAll = async () => {
    if (!optimResult || optimResult.tours.length === 0 || !selectedZoneStats) return;
    
    // Empêcher double-clic
    if (isDispatching) return;
    
    setIsDispatching(true);
    
    try {
      for (const tour of optimResult.tours) {
        const hub = selectedZoneStats.hub || departureHub;
        
        const mission: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'> = {
          date: selectedDate,
          zone: selectedZone!,
          hubId: hub?.id || '',
          hubName: hub?.name || 'Départ direct',
          type: MissionType.DELIVERY,
          status: MissionStatus.DISPATCHED,
          plannedDepartureTime,
          driverId: tour.driverId,
          driverName: tour.driverName,
          vehicleId: tour.vehicleId,
          vehiclePlate: tour.vehiclePlate,
          stops: tour.stops,
          totalPackages: tour.packageCount,
          completedStops: 0,
          failedStops: 0,
          deliveredPackages: 0,
          failedPackages: 0,
          totalDistance: tour.totalDistance,
          estimatedDuration: tour.estimatedDuration,
          createdBy: currentUser.id,
          createdByName: `${currentUser.firstName} ${currentUser.lastName}`,
          dispatchedBy: currentUser.id,
          dispatchedByName: `${currentUser.firstName} ${currentUser.lastName}`,
          dispatchedAt: new Date().toISOString()
        };
        
        const missionId = await addMission(mission);
        
        // Mettre à jour le statut des colis
        const packageIds = tour.stops.flatMap(s => s.packageIds);
        for (const pkgId of packageIds) {
          const stop = tour.stops.find(s => s.packageIds.includes(pkgId));
          
          // Construire extraFields sans les valeurs undefined
          const extraFields: Record<string, string | undefined> = {
            missionId,
            stopId: stop?.id,
            currentDriverId: tour.driverId
          };
          // N'ajouter currentVehicleId que s'il existe
          if (tour.vehicleId) {
            extraFields.currentVehicleId = tour.vehicleId;
          }
          
          await updatePackageStatus(pkgId, PackageStatus.SORTED, {
            action: 'SORTED',
            driverId: tour.driverId,
            driverName: tour.driverName,
            notes: `Dispatché mission ${selectedZone} - ${tour.driverName}`
          }, extraFields);
        }
        
        logActivity(currentUser, ActivityAction.ITEM_CREATED, {
          targetType: 'mission',
          targetId: missionId,
          targetName: `Mission ${selectedZone} — ${tour.driverName}`,
          details: {
            metadata: {
              zone: selectedZone,
              driver: tour.driverName,
              stops: tour.stops.length,
              packages: packageIds.length,
              distance: tour.totalDistance
            }
          }
        });
        
        // 🔔 Notifier le chauffeur
        notifyMissionAssigned(
          tour.driverId,
          selectedZone!,
          tour.stops.length,
          tour.vehiclePlate ?? ''
        ).catch(() => {});
      }
      
      // Reset et fermer
      setIsDispatching(false);
      setShowDispatchModal(false);
      setSelectedZone(null);
      setSelectedDriverIds(new Set());
      setSelectedHubId('');
      setOptimResult(null);
      
      onMissionCreated();
      
    } catch (error) {
      console.error('Dispatch error:', error);
      alert('Erreur lors du dispatch. Vérifiez la console pour plus de détails.');
      setIsDispatching(false);
    }
  };
  
  // Ouvrir le modal
  const openDispatchModal = (zone: Zone) => {
    setSelectedZone(zone);
    const zStat = zoneStats.find(s => s.zone === zone);
    // Pré-sélectionner tous les chauffeurs
    setSelectedDriverIds(new Set(zStat?.availableDrivers.map(d => d.id) || []));
    const zoneHub = hubs.find(h => h.zone === zone && h.isActive);
    const firstHub = hubs.find(h => h.isActive);
    setSelectedHubId(zoneHub?.id || firstHub?.id || '');
    setOptimResult(null);
    setExpandedTour(null);
    
    // Mettre à jour l'heure de départ à l'heure actuelle (arrondie)
    const isToday = selectedDate === todayISO();
    if (isToday) {
      setPlannedDepartureTime(getMinDepartureTime());
    }
    
    // Initialiser les créneaux des colis
    const initialTimeWindows: Record<string, { start: string; end: string }> = {};
    zStat?.packages.forEach(pkg => {
      initialTimeWindows[pkg.id] = {
        start: pkg.timeWindowStart || '',
        end: pkg.timeWindowEnd || ''
      };
    });
    setPackageTimeWindows(initialTimeWindows);
    
    setShowDispatchModal(true);
  };
  
  // ============================================================================
  // RENDU
  // ============================================================================
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Dispatch multi-tournées</h2>
          <p className="text-sm text-slate-500">
            Optimisez et répartissez les livraisons sur plusieurs chauffeurs par secteur
          </p>
        </div>
      </div>
      
      {/* Cartes par zone */}
      {zoneStats.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <PackageIcon size={48} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 mb-2">Aucun colis au hub prêt à être dispatché</p>
          <p className="text-sm text-slate-400">
            Réceptionnez les colis au hub pour les dispatcher
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {zoneStats.map(stat => {
            const colors = ZONE_COLORS[stat.zone];
            const hasHub = !!stat.hub;
            const hasDrivers = stat.availableDrivers.length > 0;
            const canDispatch = hasDrivers;
            
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
                <div className={`${colors.bg} px-4 py-3 border-b ${colors.border}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${colors.dot}`} />
                      <span className={`font-bold ${colors.text}`}>{stat.zone}</span>
                    </div>
                    {canDispatch && <ChevronRight size={18} className={colors.text} />}
                  </div>
                </div>
                
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
                  
                  {hasHub ? (
                    <div className="flex items-center gap-2 text-green-600 text-xs bg-green-50 rounded-lg p-2">
                      <CheckCircle size={14} />
                      <span>{stat.hub?.name}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-600 text-xs bg-amber-50 rounded-lg p-2">
                      <AlertTriangle size={14} />
                      <span>Sans hub (optimisation limitée)</span>
                    </div>
                  )}
                  {!hasDrivers && (
                    <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg p-2">
                      <AlertTriangle size={14} />
                      <span>Aucun chauffeur disponible</span>
                    </div>
                  )}
                </div>
                
                {canDispatch && (
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
                    <button className="w-full flex items-center justify-center gap-2 text-brand-600 font-medium text-sm hover:text-brand-700">
                      <Zap size={16} />
                      Optimiser {stat.availableDrivers.length} tournées
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Modal Dispatch Multi-tournées */}
      <Modal
        isOpen={showDispatchModal}
        onClose={() => setShowDispatchModal(false)}
        title={`Dispatch — Zone ${selectedZone}`}
        size="lg"
        headerIcon={<Route size={20} />}
      >
        {selectedZoneStats && (
          <div className="space-y-5">
            {/* Résumé zone */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <PackageIcon size={20} className="mx-auto text-slate-400 mb-1" />
                <p className="text-2xl font-bold text-slate-800">{selectedZoneStats.packageCount}</p>
                <p className="text-xs text-slate-500">Colis</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <MapPin size={20} className="mx-auto text-slate-400 mb-1" />
                <p className="text-2xl font-bold text-slate-800">{selectedZoneStats.stopCount}</p>
                <p className="text-xs text-slate-500">Stops</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <Users size={20} className="mx-auto text-slate-400 mb-1" />
                <p className="text-2xl font-bold text-slate-800">{selectedDriverIds.size}</p>
                <p className="text-xs text-slate-500">Chauffeurs</p>
              </div>
            </div>
            
            {/* Hub de départ */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Hub de départ
              </label>
              {activeHubs.length === 0 ? (
                <div className="flex items-center gap-2 text-amber-600 text-sm bg-amber-50 rounded-xl p-3">
                  <AlertTriangle size={16} />
                  <span>Aucun hub configuré</span>
                </div>
              ) : (
                <select
                  value={selectedHubId}
                  onChange={(e) => { setSelectedHubId(e.target.value); setOptimResult(null); }}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white text-sm"
                >
                  {activeHubs.map(hub => (
                    <option key={hub.id} value={hub.id}>
                      {hub.name} — {hub.city} (Zone {hub.zone})
                    </option>
                  ))}
                </select>
              )}
            </div>
            
            {/* Sélection chauffeurs */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-slate-700">
                  Chauffeurs ({selectedDriverIds.size}/{selectedZoneStats.availableDrivers.length})
                </label>
                <button
                  onClick={toggleAllDrivers}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  {selectedDriverIds.size === selectedZoneStats.availableDrivers.length 
                    ? 'Tout désélectionner' 
                    : 'Tout sélectionner'}
                </button>
              </div>
              
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {selectedZoneStats.availableDrivers.map(driver => {
                  const vehicle = getDriverVehicle(driver.id);
                  const isSelected = selectedDriverIds.has(driver.id);
                  
                  return (
                    <label
                      key={driver.id}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                        isSelected ? 'bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleDriver(driver.id)}
                        className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                      />
                      <UserIcon size={16} className={isSelected ? 'text-brand-600' : 'text-slate-400'} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-brand-800' : 'text-slate-700'}`}>
                          {driver.firstName} {driver.lastName}
                        </p>
                      </div>
                      {vehicle ? (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          {vehicle.plate}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-500">Sans véhicule</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
            
            {/* Heure de départ prévue */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                <Clock size={16} className="text-brand-500" />
                Heure de départ prévue
              </label>
              {(() => {
                const isToday = selectedDate === todayISO();
                const minTime = isToday ? getMinDepartureTime() : '00:00';
                const isPastTime = isToday && plannedDepartureTime < minTime;
                
                return (
                  <>
                    <input
                      type="time"
                      value={plannedDepartureTime}
                      min={minTime}
                      onChange={(e) => {
                        const newTime = e.target.value;
                        // Empêcher de sélectionner une heure passée si c'est aujourd'hui
                        if (isToday && newTime < minTime) {
                          setPlannedDepartureTime(minTime);
                        } else {
                          setPlannedDepartureTime(newTime);
                        }
                      }}
                      className={`w-full px-3 py-2.5 border rounded-lg text-sm font-mono font-bold focus:ring-2 focus:ring-brand-200 outline-none ${
                        isPastTime ? 'border-red-300 text-red-600 bg-red-50' : 'border-slate-200 text-slate-800'
                      }`}
                    />
                    {isPastTime && (
                      <p className="text-xs text-red-500 mt-1">
                        ⚠️ L'heure de départ ne peut pas être dans le passé
                      </p>
                    )}
                    {!isPastTime && (
                      <p className="text-xs text-slate-400 mt-1">
                        {isToday ? `Minimum: ${minTime} (heure actuelle)` : 'Les ETAs seront calculées à partir de cette heure'}
                      </p>
                    )}
                  </>
                );
              })()}
              
              {/* Option ignorer les créneaux */}
              <label className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ignoreTimeWindows}
                  onChange={(e) => setIgnoreTimeWindows(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-700">
                  Ignorer les créneaux de livraison
                </span>
              </label>
              {ignoreTimeWindows && (
                <p className="text-xs text-amber-600 mt-1 ml-6">
                  ⚠️ Tous les stops seront inclus sans contrainte horaire
                </p>
              )}
            </div>
            
            {/* Créneaux de livraison des colis */}
            {!ignoreTimeWindows && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <PackageIcon size={16} className="text-brand-500" />
                  Créneaux de livraison ({selectedZoneStats?.packages.length || 0} colis)
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Modifiez les créneaux si nécessaire avant l'optimisation
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {selectedZoneStats?.packages.map(pkg => (
                  <div key={pkg.id} className="px-4 py-2.5 hover:bg-slate-50 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{pkg.contactName}</p>
                      <p className="text-xs text-slate-500 truncate">{pkg.address}, {pkg.postalCode}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="time"
                        value={packageTimeWindows[pkg.id]?.start || ''}
                        onChange={(e) => setPackageTimeWindows(prev => ({
                          ...prev,
                          [pkg.id]: { ...prev[pkg.id], start: e.target.value }
                        }))}
                        className="w-24 px-2 py-1.5 border border-slate-200 rounded text-xs font-mono focus:ring-2 focus:ring-brand-200 outline-none"
                        placeholder="Début"
                      />
                      <span className="text-slate-400 text-xs">→</span>
                      <input
                        type="time"
                        value={packageTimeWindows[pkg.id]?.end || ''}
                        onChange={(e) => setPackageTimeWindows(prev => ({
                          ...prev,
                          [pkg.id]: { ...prev[pkg.id], end: e.target.value }
                        }))}
                        className="w-24 px-2 py-1.5 border border-slate-200 rounded text-xs font-mono focus:ring-2 focus:ring-brand-200 outline-none"
                        placeholder="Fin"
                      />
                      {(packageTimeWindows[pkg.id]?.start || packageTimeWindows[pkg.id]?.end) && (
                        <button
                          onClick={() => setPackageTimeWindows(prev => ({
                            ...prev,
                            [pkg.id]: { start: '', end: '' }
                          }))}
                          className="p-1 text-slate-400 hover:text-red-500 rounded"
                          title="Supprimer le créneau"
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )}
            
            {/* Bouton Optimiser */}
            <button
              onClick={handleOptimize}
              disabled={isOptimizing || selectedDriverIds.size === 0 || !departureHub}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-brand-500 to-blue-500 text-white rounded-xl font-medium hover:from-brand-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isOptimizing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Optimisation en cours ({selectedDriverIds.size} véhicules)...
                </>
              ) : (
                <>
                  <Zap size={18} />
                  Optimiser {selectedDriverIds.size} tournée{selectedDriverIds.size > 1 ? 's' : ''}
                </>
              )}
            </button>
            
            {/* Résultats multi-tournées */}
            {optimResult && (
              <div className="space-y-3">
                {/* Résumé global */}
                <div className={`p-4 rounded-xl ${
                  optimResult.method === 'gmpro' 
                    ? 'bg-green-50 border border-green-200' 
                    : 'bg-amber-50 border border-amber-200'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    {optimResult.method === 'gmpro' ? (
                      <CheckCircle size={18} className="text-green-600" />
                    ) : (
                      <AlertTriangle size={18} className="text-amber-600" />
                    )}
                    <span className={`font-bold ${
                      optimResult.method === 'gmpro' ? 'text-green-800' : 'text-amber-800'
                    }`}>
                      {optimResult.tours.length} tournée{optimResult.tours.length > 1 ? 's' : ''} {
                        optimResult.method === 'gmpro' ? 'optimisée' : 'répartie'
                      }{optimResult.tours.length > 1 ? 's' : ''}
                    </span>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                      optimResult.method === 'gmpro' 
                        ? 'bg-green-200 text-green-800' 
                        : 'bg-amber-200 text-amber-800'
                    }`}>
                      {optimResult.method === 'gmpro' ? 'GMPRO' : 'Fallback'}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="text-center">
                      <p className="text-slate-500">Distance totale</p>
                      <p className="font-bold text-slate-800">{optimResult.totalDistance} km</p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-500">Durée totale</p>
                      <p className="font-bold text-slate-800">
                        {Math.floor(optimResult.totalDuration / 60)}h{String(optimResult.totalDuration % 60).padStart(2, '0')}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-500">Colis</p>
                      <p className={`font-bold ${
                        optimResult.totalPackages < (selectedZoneStats?.packages.length || 0) 
                          ? 'text-red-600' 
                          : 'text-slate-800'
                      }`}>
                        {optimResult.totalPackages}
                        {optimResult.totalPackages < (selectedZoneStats?.packages.length || 0) && (
                          <span className="text-xs text-red-500 ml-1">
                            / {selectedZoneStats?.packages.length}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  
                  {/* Warning si colis manquants */}
                  {optimResult.totalPackages < (selectedZoneStats?.packages.length || 0) && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm font-bold text-red-700 flex items-center gap-2">
                        <AlertTriangle size={16} />
                        {(selectedZoneStats?.packages.length || 0) - optimResult.totalPackages} colis non inclus !
                      </p>
                      {optimResult.skippedStopNames && optimResult.skippedStopNames.length > 0 && (
                        <div className="mt-2 text-xs text-red-600">
                          <p className="font-medium">Stops non routés :</p>
                          <ul className="list-disc list-inside mt-1">
                            {optimResult.skippedStopNames.map((name, i) => (
                              <li key={i}>{name}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="text-xs text-red-600 mt-2">
                        <strong>Solutions :</strong> Sélectionnez plus de chauffeurs, étendez la plage horaire,
                        ou retirez les créneaux de livraison.
                      </p>
                    </div>
                  )}
                  
                  {optimResult.error && (
                    <p className="mt-2 text-xs text-amber-700">{optimResult.error}</p>
                  )}
                </div>
                
                {/* Détail par tournée */}
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
                  {optimResult.tours.map((tour, idx) => (
                    <div key={idx}>
                      {/* En-tête tournée */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 cursor-pointer"
                        onClick={() => setExpandedTour(expandedTour === idx ? null : idx)}
                      >
                        <div className="w-8 h-8 rounded-full bg-brand-500 text-white text-sm font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">
                            {tour.driverName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {tour.vehiclePlate || 'Sans véhicule'} • {tour.stops.length} stops • {tour.packageCount} colis
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-slate-700">{tour.totalDistance} km</p>
                          <p className="text-xs text-slate-500">~{tour.estimatedDuration} min</p>
                        </div>
                        {expandedTour === idx ? (
                          <ChevronUp size={16} className="text-slate-400" />
                        ) : (
                          <ChevronDown size={16} className="text-slate-400" />
                        )}
                      </div>
                      
                      {/* Détail des stops */}
                      {expandedTour === idx && (
                        <div className="bg-slate-50 border-t border-slate-100">
                          {/* Départ hub */}
                          <div className="flex items-center gap-3 px-4 py-2 text-xs text-slate-500">
                            <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">H</div>
                            <span>Départ: {departureHub?.name || 'Hub'}</span>
                          </div>
                          
                          {tour.stops.map((stop, si) => (
                            <div key={stop.id} className="flex items-center gap-3 px-4 py-2 border-t border-slate-100">
                              <div className="w-5 h-5 rounded-full bg-brand-400 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                {stop.sequence}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-slate-700 truncate">{stop.contactName}</p>
                                <p className="text-[11px] text-slate-400 truncate">{stop.address}, {stop.postalCode} {stop.city}</p>
                              </div>
                              <span className="text-[11px] text-slate-500 shrink-0">{stop.packageCount} col.</span>
                            </div>
                          ))}
                          
                          {/* Retour hub */}
                          <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
                            <div className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex items-center justify-center">H</div>
                            <span>Retour: {departureHub?.name || 'Hub'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => setShowDispatchModal(false)}
                className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleDispatchAll}
                disabled={!optimResult || optimResult.tours.length === 0 || isDispatching}
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
                    Dispatcher {optimResult?.tours.length || 0} tournée{(optimResult?.tours.length || 0) > 1 ? 's' : ''}
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
