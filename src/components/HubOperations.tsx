/**
 * HUB OPERATIONS — v3.2.1
 * 
 * 2 workflows :
 * 
 * 1. RÉCEPTION — Colis collectés (COLLECTED) → arrivée hub (AT_HUB)
 *    Scan ou réception en masse. 
 *    Après ça, le Dispatch (GMPRO) peut optimiser.
 *    
 * 2. CHARGEMENT — Le chauffeur scanne SES colis pré-assignés par GMPRO
 *    Colis SORTED assignés à ce chauffeur → LOADED
 *    Si mauvais colis → alerte avec nom du bon chauffeur
 *    Liste triée par destinataire (alpha), mise à jour au scan
 */

import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import {
  Package as PackageIcon, Truck, ArrowDownToLine, ArrowUpFromLine,
  ScanBarcode, CheckCircle, AlertTriangle, Search, Filter,
  Loader2, Building2, MapPin, X, UserCheck, ChevronDown
} from 'lucide-react';
import {
  Hub, Package, PackageStatus, PACKAGE_STATUS_COLORS,
  Zone, ZONE_COLORS, User, UserRole, Vehicle, Mission
} from '../types';
import {
  updatePackageStatus,
  subscribeToPackages,
  subscribeToHubs,
  subscribeToMissions
} from '../services/missionService';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

// ============================================================================
// TYPES
// ============================================================================

type HubOpsTab = 'reception' | 'loading';

interface WrongColisAlert {
  barcode: string;
  packageName: string;
  assignedDriverName: string;
  assignedVehiclePlate: string;
  assignedZone: string;
}

interface HubOperationsProps {
  currentUser: User;
  vehicles: Vehicle[];
  users: User[];
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const HubOperations: React.FC<HubOperationsProps> = ({ currentUser, vehicles, users }) => {
  // Data
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  
  // UI
  const [activeTab, setActiveTab] = useState<HubOpsTab>('reception');
  const [selectedHubId, setSelectedHubId] = useState<string>('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState<'reception' | 'loading' | null>(null);
  const [processing, setProcessing] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  
  // Scan state
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Loading
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [wrongColisAlert, setWrongColisAlert] = useState<WrongColisAlert | null>(null);
  const [loadingComplete, setLoadingComplete] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const isDriver = currentUser.role === UserRole.DRIVER;

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================

  useEffect(() => {
    const unsub1 = subscribeToHubs(setHubs);
    const unsub2 = subscribeToPackages(setPackages);
    const unsub3 = subscribeToMissions(setMissions, { date: today });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [today]);

  // Auto-select hub
  useEffect(() => {
    if (hubs.length > 0 && !selectedHubId) {
      const userHub = hubs.find(h => h.zone === (currentUser as any).zone && h.isActive);
      setSelectedHubId(userHub?.id || hubs.filter(h => h.isActive)[0]?.id || '');
    }
  }, [hubs, selectedHubId, currentUser]);

  // Auto-select driver si c'est un chauffeur
  useEffect(() => {
    if (isDriver && !selectedDriverId) {
      setSelectedDriverId(currentUser.id);
    }
  }, [isDriver, currentUser.id, selectedDriverId]);

  // ============================================================================
  // DATA DÉRIVÉE
  // ============================================================================

  const selectedHub = useMemo(() => hubs.find(h => h.id === selectedHubId), [hubs, selectedHubId]);
  const activeHubs = useMemo(() => hubs.filter(h => h.isActive), [hubs]);
  
  const drivers = useMemo(() => 
    users.filter(u => u.role === UserRole.DRIVER && !u.isDisabled),
    [users]
  );

  // --- RÉCEPTION : colis PENDING ou COLLECTED à réceptionner ---
  const receptionPackages = useMemo(() => 
    packages.filter(p => p.status === PackageStatus.COLLECTED || p.status === PackageStatus.PENDING),
    [packages]
  );

  // --- CHARGEMENT : colis SORTED assignés au chauffeur sélectionné ---
  const driverPackages = useMemo(() => {
    if (!selectedDriverId) return { toLoad: [], loaded: [], all: [] };
    
    // Colis assignés à ce chauffeur par GMPRO (currentDriverId set au dispatch)
    const assigned = packages.filter(p => 
      p.currentDriverId === selectedDriverId &&
      (p.status === PackageStatus.SORTED || p.status === PackageStatus.LOADED)
    );

    const toLoad = assigned
      .filter(p => p.status === PackageStatus.SORTED)
      .sort((a, b) => a.contactName.localeCompare(b.contactName, 'fr'));
    
    const loaded = assigned
      .filter(p => p.status === PackageStatus.LOADED)
      .sort((a, b) => a.contactName.localeCompare(b.contactName, 'fr'));

    return { toLoad, loaded, all: assigned };
  }, [packages, selectedDriverId]);

  // Mission du chauffeur pour afficher le contexte
  const driverMission = useMemo(() => {
    if (!selectedDriverId) return null;
    return missions.find(m => m.driverId === selectedDriverId && m.status !== 'Terminée') || null;
  }, [missions, selectedDriverId]);

  // Véhicule du chauffeur
  const driverVehicle = useMemo(() => {
    if (!driverMission?.vehicleId) return null;
    return vehicles.find(v => v.id === driverMission.vehicleId) || null;
  }, [driverMission, vehicles]);

  // Barcodes attendus pour le scanner
  const expectedBarcodes = useMemo(() => 
    driverPackages.toLoad.map(p => (p.barcode || p.orderNumber).toUpperCase()),
    [driverPackages.toLoad]
  );

  // Drivers qui ont des colis à charger (pour le dropdown admin)
  const driversWithPackages = useMemo(() => {
    const driverIds = new Set(
      packages
        .filter(p => p.status === PackageStatus.SORTED && p.currentDriverId)
        .map(p => p.currentDriverId!)
    );
    return drivers.filter(d => driverIds.has(d.id));
  }, [packages, drivers]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const showNotif = (type: 'success' | 'error' | 'warning', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // --- RÉCEPTION : Scan un colis → AT_HUB ---
  const handleReceptionScan = async (barcode: string) => {
    const pkg = packages.find(p => 
      (p.barcode || p.orderNumber).toUpperCase() === barcode.toUpperCase()
    );

    if (!pkg) {
      showNotif('warning', `Code ${barcode} — colis non trouvé`);
      return;
    }

    if (pkg.status === PackageStatus.AT_HUB) {
      showNotif('warning', `${barcode} — déjà au hub`);
      return;
    }

    if (pkg.status !== PackageStatus.COLLECTED && pkg.status !== PackageStatus.PENDING) {
      showNotif('warning', `${barcode} — statut ${pkg.status}, réception non applicable`);
      return;
    }

    try {
      await updatePackageStatus(pkg.id, PackageStatus.AT_HUB, {
        action: 'HUB_ARRIVAL',
        hubId: selectedHubId,
        hubName: selectedHub?.name || '',
        notes: `Réceptionné au ${selectedHub?.name || 'hub'}`
      }, {
        currentHubId: selectedHubId
      });

      setScannedCodes(prev => [...prev, barcode]);
      showNotif('success', `✅ ${barcode} — ${pkg.contactName} réceptionné`);
    } catch (err) {
      console.error('Reception error:', err);
      showNotif('error', `❌ Erreur réception ${barcode}`);
    }
  };

  // --- RÉCEPTION EN MASSE ---
  const handleReceptionAll = async () => {
    if (receptionPackages.length === 0) return;
    setProcessing(true);

    let success = 0;
    let errors = 0;

    for (const pkg of receptionPackages) {
      try {
        await updatePackageStatus(pkg.id, PackageStatus.AT_HUB, {
          action: 'HUB_ARRIVAL',
          hubId: selectedHubId,
          hubName: selectedHub?.name || '',
          notes: `Réception en masse au ${selectedHub?.name || 'hub'}`
        }, { currentHubId: selectedHubId });
        success++;
      } catch { errors++; }
    }

    showNotif(errors === 0 ? 'success' : 'warning',
      `${success} colis réceptionnés${errors > 0 ? `, ${errors} erreurs` : ''}`
    );
    setProcessing(false);
    setScannedCodes([]);
  };

  // --- CHARGEMENT : Scan un colis → vérification chauffeur ---
  const handleLoadingScan = async (barcode: string) => {
    const pkg = packages.find(p =>
      (p.barcode || p.orderNumber).toUpperCase() === barcode.toUpperCase()
    );

    if (!pkg) {
      showNotif('warning', `Code ${barcode} — colis non trouvé dans le système`);
      return;
    }

    // Déjà chargé ?
    if (pkg.status === PackageStatus.LOADED && pkg.currentDriverId === selectedDriverId) {
      showNotif('warning', `${barcode} — déjà chargé`);
      return;
    }

    // === VÉRIFICATION : est-ce le bon chauffeur ? ===
    if (pkg.currentDriverId && pkg.currentDriverId !== selectedDriverId) {
      // MAUVAIS CHAUFFEUR → Alerte
      const assignedDriver = drivers.find(d => d.id === pkg.currentDriverId);
      const assignedVehicle = vehicles.find(v => v.id === pkg.currentVehicleId);
      
      setWrongColisAlert({
        barcode: pkg.barcode || pkg.orderNumber,
        packageName: pkg.contactName,
        assignedDriverName: assignedDriver 
          ? `${assignedDriver.firstName} ${assignedDriver.lastName}` 
          : 'Chauffeur inconnu',
        assignedVehiclePlate: assignedVehicle?.licensePlate || 'Véhicule non assigné',
        assignedZone: pkg.zone || 'Non définie'
      });
      
      // Vibration erreur longue
      try { navigator.vibrate?.([500]); } catch {}
      return;
    }

    // Vérification statut
    if (pkg.status !== PackageStatus.SORTED && pkg.status !== PackageStatus.AT_HUB) {
      showNotif('warning', `${barcode} — statut ${pkg.status}, chargement non applicable`);
      return;
    }

    // === BON COLIS → Charger ===
    const driver = drivers.find(d => d.id === selectedDriverId);
    const vehicle = driverVehicle || vehicles.find(v => v.id === pkg.currentVehicleId);

    try {
      await updatePackageStatus(pkg.id, PackageStatus.LOADED, {
        action: 'LOADED',
        driverId: selectedDriverId,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : '',
        vehicleId: vehicle?.id || '',
        vehiclePlate: vehicle?.licensePlate || '',
        hubId: selectedHubId,
        hubName: selectedHub?.name || '',
        notes: `Chargé dans ${vehicle?.licensePlate || 'véhicule'}`
      }, {
        currentDriverId: selectedDriverId,
        currentVehicleId: vehicle?.id
      });

      setScannedCodes(prev => [...prev, barcode]);
      
      // Vérifier si tout est chargé
      const remainingAfter = driverPackages.toLoad.length - 1;
      if (remainingAfter <= 0) {
        setLoadingComplete(true);
      }
      
      showNotif('success', `✅ ${pkg.contactName} — chargé`);
    } catch (err) {
      console.error('Loading error:', err);
      showNotif('error', `❌ Erreur chargement ${barcode}`);
    }
  };

  // Scanner dispatch
  const openScanner = (mode: 'reception' | 'loading') => {
    setScanMode(mode);
    setShowScanner(true);
  };

  const handleScanResult = (barcode: string) => {
    if (scanMode === 'reception') handleReceptionScan(barcode);
    else if (scanMode === 'loading') handleLoadingScan(barcode);
  };

  // Reset chargement
  const resetLoading = () => {
    setScannedCodes([]);
    setLoadingComplete(false);
    if (!isDriver) setSelectedDriverId('');
  };

  // ============================================================================
  // FILTRAGE
  // ============================================================================

  const filterPackages = (pkgs: Package[]) => {
    if (!searchTerm) return pkgs;
    const term = searchTerm.toLowerCase();
    return pkgs.filter(p =>
      (p.barcode || '').toLowerCase().includes(term) ||
      p.orderNumber.toLowerCase().includes(term) ||
      p.contactName.toLowerCase().includes(term) ||
      p.city.toLowerCase().includes(term) ||
      p.clientName.toLowerCase().includes(term)
    );
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const tabs: { id: HubOpsTab; label: string; icon: React.ElementType; count: number; color: string }[] = [
    { id: 'reception', label: 'Réception', icon: ArrowDownToLine, count: receptionPackages.length, color: 'text-blue-600' },
    { id: 'loading', label: 'Chargement', icon: ArrowUpFromLine, count: driverPackages.toLoad.length, color: 'text-amber-600' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Building2 size={22} className="text-indigo-600" />
            Opérations Hub
          </h1>
          <p className="text-sm text-slate-500">Réception et chargement des colis</p>
        </div>

        {/* Sélecteur de hub */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Hub :</label>
          <select
            value={selectedHubId}
            onChange={(e) => setSelectedHubId(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium bg-white focus:ring-2 focus:ring-indigo-200 outline-none"
          >
            {activeHubs.map(h => (
              <option key={h.id} value={h.id}>{h.name} — Zone {h.zone}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          {notification.type === 'success' ? <CheckCircle size={16} /> :
           notification.type === 'error' ? <X size={16} /> :
           <AlertTriangle size={16} />}
          {notification.message}
        </div>
      )}

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-3">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setScannedCodes([]); setSearchTerm(''); setLoadingComplete(false); }}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              activeTab === tab.id
                ? 'border-indigo-300 bg-indigo-50 shadow-md'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <tab.icon size={18} className={tab.color} />
              <span className={`text-2xl font-black ${tab.color}`}>{tab.count}</span>
            </div>
            <p className="text-xs font-bold text-slate-700">{tab.label}</p>
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* TAB: RÉCEPTION                                                     */}
      {/* ================================================================== */}
      {activeTab === 'reception' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => openScanner('reception')}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-200 active:scale-95 transition-transform"
            >
              <ScanBarcode size={18} />
              Scanner les colis entrants
            </button>
            <button
              onClick={handleReceptionAll}
              disabled={processing || receptionPackages.length === 0}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-800 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40"
            >
              {processing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              Tout réceptionner ({receptionPackages.length})
            </button>
          </div>

          {scannedCodes.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center justify-between">
              <span className="text-sm font-bold text-green-700">
                ✅ {scannedCodes.length} colis réceptionnés cette session
              </span>
              <button onClick={() => setScannedCodes([])} className="text-xs text-green-600 underline">
                Réinitialiser
              </button>
            </div>
          )}

          {/* Recherche */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par code, destinataire, client..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
            />
          </div>

          {/* Liste colis en attente de réception */}
          {filterPackages(receptionPackages).length > 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                {filterPackages(receptionPackages)
                  .sort((a, b) => a.contactName.localeCompare(b.contactName, 'fr'))
                  .map(pkg => (
                    <div key={pkg.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                          <PackageIcon size={14} className="text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{pkg.contactName}</p>
                          <p className="text-[11px] text-slate-500">{pkg.barcode || pkg.orderNumber} • {pkg.clientName}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ZONE_COLORS[pkg.zone as Zone]?.bg || 'bg-slate-100'} ${ZONE_COLORS[pkg.zone as Zone]?.text || 'text-slate-600'}`}>
                          {pkg.zone}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5">{pkg.city}</p>
                      </div>
                    </div>
                  ))
                }
              </div>
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                {filterPackages(receptionPackages).length} colis en attente
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <ArrowDownToLine size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">Aucun colis en attente de réception</p>
              <p className="text-xs text-slate-400 mt-1">Les colis apparaissent ici après l'enlèvement par le chauffeur</p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB: CHARGEMENT                                                    */}
      {/* ================================================================== */}
      {activeTab === 'loading' && (
        <div className="space-y-4">

          {/* Sélection chauffeur (admin uniquement) */}
          {!isDriver && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <label className="text-sm font-bold text-slate-700 block mb-2">
                <UserCheck size={14} className="inline mr-1" />
                Chauffeur
              </label>
              {driversWithPackages.length > 0 ? (
                <select
                  value={selectedDriverId}
                  onChange={(e) => {
                    setSelectedDriverId(e.target.value);
                    setScannedCodes([]);
                    setLoadingComplete(false);
                  }}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white"
                >
                  <option value="">— Sélectionner un chauffeur —</option>
                  {driversWithPackages.map(d => {
                    const pkgCount = packages.filter(p => 
                      p.currentDriverId === d.id && p.status === PackageStatus.SORTED
                    ).length;
                    return (
                      <option key={d.id} value={d.id}>
                        {d.firstName} {d.lastName} — {pkgCount} colis à charger
                      </option>
                    );
                  })}
                </select>
              ) : (
                <p className="text-sm text-slate-400 italic">
                  Aucun chauffeur avec des colis dispatchés. Lancez le dispatch dans l'onglet Missions d'abord.
                </p>
              )}
            </div>
          )}

          {/* Contexte mission */}
          {selectedDriverId && driverMission && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Truck size={18} className="text-indigo-600" />
                <div>
                  <p className="text-sm font-bold text-indigo-800">
                    Mission {driverMission.zone} — {driverVehicle?.licensePlate || 'Véhicule'}
                  </p>
                  <p className="text-xs text-indigo-600">
                    {driverMission.totalPackages} colis • {driverMission.stops?.length || 0} stops
                  </p>
                </div>
              </div>
              {driverPackages.toLoad.length === 0 && driverPackages.loaded.length > 0 && (
                <span className="px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-lg">
                  ✅ Complet
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          {selectedDriverId && driverPackages.all.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-700">
                  {driverPackages.loaded.length} / {driverPackages.all.length} chargés
                </span>
                <span className="text-sm font-bold text-amber-600">
                  {driverPackages.toLoad.length} restant{driverPackages.toLoad.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-400 to-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${driverPackages.all.length > 0 ? (driverPackages.loaded.length / driverPackages.all.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Bouton scanner */}
          {selectedDriverId && driverPackages.toLoad.length > 0 && (
            <button
              onClick={() => openScanner('loading')}
              className="w-full flex items-center justify-center gap-2 py-4 bg-amber-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-200 active:scale-95 transition-transform"
            >
              <ScanBarcode size={20} />
              Scanner ({driverPackages.toLoad.length} restant{driverPackages.toLoad.length > 1 ? 's' : ''})
            </button>
          )}

          {/* Chargement terminé */}
          {loadingComplete && (
            <div className="bg-green-50 border-2 border-green-300 rounded-xl p-6 text-center">
              <CheckCircle size={40} className="mx-auto text-green-500 mb-2" />
              <p className="text-lg font-black text-green-700">Chargement terminé !</p>
              <p className="text-sm text-green-600 mt-1">
                {driverPackages.loaded.length} colis chargés — le chauffeur peut partir
              </p>
              <button
                onClick={resetLoading}
                className="mt-4 px-6 py-2 bg-green-600 text-white rounded-xl text-sm font-bold active:scale-95 transition-transform"
              >
                Nouveau chargement
              </button>
            </div>
          )}

          {/* Recherche */}
          {selectedDriverId && driverPackages.all.length > 0 && (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher un colis..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
              />
            </div>
          )}

          {/* === LISTE DES COLIS — RESTANTS === */}
          {selectedDriverId && filterPackages(driverPackages.toLoad).length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                <PackageIcon size={14} className="text-amber-600" />
                <span className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                  À charger — {filterPackages(driverPackages.toLoad).length} colis
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[350px] overflow-y-auto">
                {filterPackages(driverPackages.toLoad).map(pkg => (
                  <div key={pkg.id} className="px-4 py-3 flex items-center gap-3 hover:bg-amber-50/30">
                    <div className="w-6 h-6 rounded border-2 border-slate-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800">{pkg.contactName}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {pkg.barcode || pkg.orderNumber} • {pkg.postalCode} {pkg.city}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${ZONE_COLORS[pkg.zone as Zone]?.bg || 'bg-slate-100'} ${ZONE_COLORS[pkg.zone as Zone]?.text || 'text-slate-600'}`}>
                      {pkg.zone}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* === LISTE DES COLIS — CHARGÉS === */}
          {selectedDriverId && filterPackages(driverPackages.loaded).length > 0 && (
            <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-green-50 border-b border-green-200 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600" />
                <span className="text-xs font-bold text-green-700 uppercase tracking-wide">
                  Chargés — {filterPackages(driverPackages.loaded).length} colis
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[200px] overflow-y-auto">
                {filterPackages(driverPackages.loaded).map(pkg => (
                  <div key={pkg.id} className="px-4 py-2.5 flex items-center gap-3 bg-green-50/30">
                    <div className="w-6 h-6 rounded bg-green-100 border-2 border-green-400 flex items-center justify-center flex-shrink-0">
                      <CheckCircle size={12} className="text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-800 line-through opacity-70">{pkg.contactName}</p>
                      <p className="text-[11px] text-green-600 truncate">
                        {pkg.barcode || pkg.orderNumber} • {pkg.postalCode} {pkg.city}
                      </p>
                    </div>
                    <span className="text-[10px] text-green-500 font-bold flex-shrink-0">✓</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* État vide — pas de chauffeur sélectionné */}
          {!selectedDriverId && !isDriver && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <UserCheck size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">Sélectionnez un chauffeur</p>
              <p className="text-xs text-slate-400 mt-1">pour voir ses colis à charger</p>
            </div>
          )}

          {/* État vide — chauffeur sans colis */}
          {selectedDriverId && driverPackages.all.length === 0 && !loadingComplete && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <PackageIcon size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">Aucun colis assigné</p>
              <p className="text-xs text-slate-400 mt-1">
                Les colis apparaissent ici après le dispatch (GMPRO) dans l'onglet Missions
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* ALERTE MAUVAIS COLIS                                               */}
      {/* ================================================================== */}
      {wrongColisAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
            {/* Header rouge */}
            <div className="bg-red-600 px-6 py-4 text-center">
              <AlertTriangle size={36} className="mx-auto text-white mb-2" />
              <p className="text-lg font-black text-white">Mauvais colis !</p>
            </div>
            
            {/* Contenu */}
            <div className="p-6 space-y-4">
              <div className="bg-red-50 rounded-xl p-4 text-center">
                <p className="text-sm font-mono font-bold text-red-800">{wrongColisAlert.barcode}</p>
                <p className="text-xs text-red-600 mt-1">{wrongColisAlert.packageName}</p>
              </div>
              
              <p className="text-center text-sm text-slate-600 font-medium">
                Ce colis est assigné à :
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <UserCheck size={18} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Chauffeur</p>
                    <p className="text-sm font-bold text-slate-800">{wrongColisAlert.assignedDriverName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <Truck size={18} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Véhicule</p>
                    <p className="text-sm font-bold text-slate-800">{wrongColisAlert.assignedVehiclePlate}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <MapPin size={18} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Zone</p>
                    <p className="text-sm font-bold text-slate-800">{wrongColisAlert.assignedZone}</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Bouton */}
            <div className="px-6 pb-6">
              <button
                onClick={() => setWrongColisAlert(null)}
                className="w-full py-3.5 bg-slate-800 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              >
                OK, compris
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SCANNER (plein écran, lazy-loaded)                                 */}
      {/* ================================================================== */}
      {showScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 size={32} className="animate-spin mx-auto mb-3" />
              <p className="text-sm">Chargement du scanner...</p>
            </div>
          </div>
        }>
          <BarcodeScanner
            onScan={handleScanResult}
            onClose={() => { setShowScanner(false); setScanMode(null); }}
            expectedBarcodes={scanMode === 'loading' ? expectedBarcodes : []}
            alreadyScanned={scannedCodes}
            title={
              scanMode === 'reception'
                ? `Réception — ${selectedHub?.name || 'Hub'}`
                : `Chargement — ${driverPackages.toLoad.length} restant${driverPackages.toLoad.length > 1 ? 's' : ''}`
            }
          />
        </Suspense>
      )}
    </div>
  );
};

export default HubOperations;
