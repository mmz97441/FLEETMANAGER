import { scanPackage, scanReceiptLabel } from '../services/scanService';
import { useOperationalDay } from '../hooks/useOperationalDay';
import PackageScanInfo from './PackageScanInfo';
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

import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { packageScanCodes } from '../utils/barcode';
import { todayISO } from '../utils/date';
import {
  Package as PackageIcon, Truck, ArrowDownToLine, ArrowUpFromLine,
  ScanBarcode, CheckCircle, AlertTriangle, Search, Filter,
  Loader2, Building2, MapPin, X, UserCheck, ChevronDown
} from 'lucide-react';
import {
  Hub, Package, PackageStatus, PACKAGE_STATUS_COLORS,
  Zone, ZONE_COLORS, User, UserRole, Vehicle, Mission, MissionStatus
} from '../types';
import {
  updatePackageStatus,
  subscribeToPackages,
  subscribeToHubs,
  subscribeToMissions,
  findPackageByCode
} from '../services/missionService';

import Modal from './shared/Modal';
import { receivePackagesAtHubCF } from '../services/cloudFunctions';

import BarcodeScanner from './Scanner';

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
  const [dataReady, setDataReady] = useState({ hubs: false, packages: false, missions: false });
  const [dataError, setDataError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [scanHistory, setScanHistory] = useState<{ type: 'success' | 'error' | 'warning'; message: string; time: string }[]>([]);
  const [confirmReceptionAll, setConfirmReceptionAll] = useState(false);
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // UI
  const [activeTab, setActiveTab] = useState<HubOpsTab>('reception');
  const [selectedHubId, setSelectedHubId] = useState<string>('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState<'reception' | 'loading' | null>(null);
  const [processing, setProcessing] = useState(false);
  const receptionLock = useRef(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  // Scan state
  const [scannedCodes, setScannedCodes] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Loading
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [wrongColisAlert, setWrongColisAlert] = useState<WrongColisAlert | null>(null);
  const [loadingComplete, setLoadingComplete] = useState(false);

  const today = useOperationalDay();
  const loadingQueue = useRef(Promise.resolve());
  const [scanPending, setScanPending] = useState(0);
  const isDriver = currentUser.role === UserRole.DRIVER;

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================

  useEffect(() => {
    setDataReady({ hubs: false, packages: false, missions: false });
    setDataError('');
    const fail = () => setDataError('Impossible de charger les opérations du hub. Vérifiez le réseau et réessayez. Les listes précédentes peuvent être incomplètes.');
    const unsub1 = subscribeToHubs(data => { setHubs(data); setDataReady(previous => ({ ...previous, hubs: true })); }, fail);
    const unsub2 = subscribeToPackages(data => { setPackages(data); setDataReady(previous => ({ ...previous, packages: true })); }, isDriver ? { driverId: currentUser.id } : undefined, fail);
    const unsub3 = subscribeToMissions(data => { setMissions(data); setDataReady(previous => ({ ...previous, missions: true })); }, { date: today, ...(isDriver ? { driverId: currentUser.id } : {}) }, fail);
    const timeout = window.setTimeout(() => setDataReady(previous => {
      if (!previous.hubs || !previous.packages || !previous.missions) fail();
      return previous;
    }), 15000);
    return () => { unsub1(); unsub2(); unsub3(); clearTimeout(timeout); };
  }, [today, reloadKey, isDriver, currentUser.id]);
  useEffect(() => () => clearTimeout(notificationTimer.current), []);
  const dataLoading = !dataReady.hubs || !dataReady.packages || !dataReady.missions;

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
    packages.filter(p => (
      p.status === PackageStatus.COLLECTED || p.status === PackageStatus.PENDING ||
      (p.status === PackageStatus.AT_HUB && (p.missionId || p.stopId || p.currentDriverId || p.currentVehicleId))
    ) && (!isDriver || p.currentDriverId === currentUser.id)),
    [packages, isDriver, currentUser.id]
  );

  // --- CHARGEMENT : colis SORTED assignés au chauffeur sélectionné ---
  const driverPackages = useMemo(() => {
    if (!selectedDriverId) return { toLoad: [], loaded: [], all: [] };

    // Colis assignés à ce chauffeur par GMPRO (currentDriverId set au dispatch)
    const assigned = packages.filter(p =>
      p.currentDriverId === selectedDriverId &&
      (p.status === PackageStatus.SORTED || p.status === PackageStatus.LOADED || p.status === PackageStatus.IN_DELIVERY)
    );

    const toLoad = assigned
      .filter(p => p.status === PackageStatus.SORTED)
      .sort((a, b) => a.contactName.localeCompare(b.contactName, 'fr'));

    const loaded = assigned
      .filter(p => [PackageStatus.LOADED, PackageStatus.IN_DELIVERY].includes(p.status) && (p.missionDate === today || missions.some(m => m.id === p.missionId && m.date === today)))
      .sort((a, b) => a.contactName.localeCompare(b.contactName, 'fr'));

    return { toLoad, loaded, all: [...toLoad, ...loaded] };
  }, [packages, selectedDriverId, missions, today]);

  // Mission du chauffeur pour afficher le contexte
  const driverMission = useMemo(() => {
    if (!selectedDriverId) return null;
    return missions.find(m => m.driverId === selectedDriverId && [MissionStatus.IN_PROGRESS, MissionStatus.DISPATCHED].includes(m.status)) || null;
  }, [missions, selectedDriverId]);

  // Véhicule du chauffeur
  const driverVehicle = useMemo(() => {
    if (!driverMission?.vehicleId) return null;
    return vehicles.find(v => v.id === driverMission.vehicleId) || null;
  }, [driverMission, vehicles]);

  // Barcodes attendus pour le scanner (tracking interne + N° colis client + N° commande)
  const expectedBarcodes = useMemo(() =>
    driverPackages.toLoad.flatMap(p => packageScanCodes(p)),
    [driverPackages.toLoad]
  );

  // Drivers qui ont des colis à charger (pour le dropdown admin)
  const selectableDrivers = useMemo(() => drivers.filter(d => !d.isDisabled), [drivers]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const showNotif = (type: 'success' | 'error' | 'warning', message: string) => {
    clearTimeout(notificationTimer.current);
    setNotification({ type, message });
    setScanHistory(previous => [{ type, message, time: new Date().toLocaleTimeString('fr-FR') }, ...previous].slice(0, 6));
    if (type === 'success') notificationTimer.current = setTimeout(() => setNotification(null), 7000);
  };

  // --- RÉCEPTION : Scan un colis → AT_HUB ---
  const handleReceptionScan = async (barcode: string) => {
    if (receptionLock.current) return;
    if (!selectedHub?.isActive) { showNotif('warning', 'Sélectionnez un hub actif avant la réception.'); return; }
    receptionLock.current = true;
    setProcessing(true);
    try {
      const pkg = await findPackageByCode(barcode);
      if (!pkg) { showNotif('warning', `Code ${barcode} — colis non trouvé`); return; }
      if (![PackageStatus.COLLECTED, PackageStatus.PENDING, PackageStatus.AT_HUB].includes(pkg.status)) {
        showNotif('warning', `${barcode} — statut ${pkg.status}, réception non applicable`); return;
      }
      const result = await receivePackagesAtHubCF(selectedHubId, [pkg.id]);
      if (result.receivedCount > 0) {
        setScannedCodes(prev => prev.includes(barcode) ? prev : [...prev, barcode]);
        showNotif('success', `${barcode} — ${pkg.contactName} réceptionné et disponible au hub`);
      } else {
        showNotif('warning', `${barcode} — réception déjà confirmée au hub`);
      }
    } catch (err) {
      console.error('Reception error:', err);
      showNotif('error', err instanceof Error ? err.message : `Réception non confirmée pour ${barcode}. Réessayez sans risque de doublon.`);
    } finally {
      receptionLock.current = false;
      setProcessing(false);
    }
  };

  // Chaque lot est atomique ; le message compte uniquement les réponses serveur.
  const handleReceptionAll = async () => {
    if (receptionLock.current || receptionPackages.length === 0) return;
    if (!selectedHub?.isActive) { showNotif('warning', 'Sélectionnez un hub actif avant la réception.'); return; }
    receptionLock.current = true;
    setProcessing(true);
    let received = 0, alreadyReceived = 0, confirmed = 0;
    const ids = receptionPackages.map(pkg => pkg.id);
    try {
      for (let offset = 0; offset < ids.length; offset += 150) {
        const result = await receivePackagesAtHubCF(selectedHubId, ids.slice(offset, offset + 150));
        received += result.receivedCount;
        alreadyReceived += result.alreadyReceivedCount;
        confirmed += result.confirmedPackageIds.length;
      }
      showNotif('success', `${received} colis réceptionné(s)${alreadyReceived ? `, ${alreadyReceived} déjà confirmé(s)` : ''}.`);
    } catch (err) {
      showNotif('warning', `${received} colis réceptionné(s), ${alreadyReceived} déjà confirmé(s), ${ids.length - confirmed} non confirmé(s). ${err instanceof Error ? err.message : 'Réessayez la réception.'}`);
    } finally {
      receptionLock.current = false;
      setProcessing(false);
    }
  };

  // --- CHARGEMENT : Scan un colis → vérification chauffeur ---
  const handleLoadingScan = async (barcode: string, driverId: string) => {
    if (!driverId) { showNotif('warning', 'Choisissez le chauffeur avant de scanner.'); return; }
    showNotif('warning', `${barcode} — confirmation en cours…`);
    const receipt = await scanPackage({ code: barcode, driverId, source: 'hub-loading' });
    showNotif(receipt.accepted && receipt.outcome !== 'already_scanned' ? 'success' : 'warning', scanReceiptLabel(receipt));
    if (receipt.accepted) setScannedCodes(prev => [...new Set([...prev, barcode])]);
  };

  // Scanner dispatch
  const openScanner = (mode: 'reception' | 'loading') => {
    setScanMode(mode);
    setShowScanner(true);
  };

  const handleScanResult = (barcode: string) => {
    // Capture the selected driver before enqueueing, even if the operator switches views.
    const driverId = selectedDriverId, mode = scanMode;
    setScanPending(n => n + 1);
    loadingQueue.current = loadingQueue.current.then(async () => {
      try {
        if (mode === 'reception') await handleReceptionScan(barcode);
        else if (mode === 'loading') await handleLoadingScan(barcode, driverId);
      } catch { showNotif('error', `${barcode} — scan non confirmé. Vérifiez la connexion puis scannez à nouveau.`); }
      finally { setScanPending(n => Math.max(0, n - 1)); }
    });
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
          <label htmlFor="operations-hub" className="text-sm font-medium text-slate-600">Hub :</label>
          <select
            id="operations-hub"
            disabled={processing || showScanner || dataLoading}
            value={selectedHubId}
            onChange={(e) => setSelectedHubId(e.target.value)}
            className="min-w-0 max-w-full min-h-11 px-3 py-2 border border-slate-200 rounded-xl text-base font-medium bg-white focus:ring-2 focus:ring-indigo-200 outline-none"
          >
            {!activeHubs.length && <option value="">{dataLoading ? 'Chargement…' : 'Aucun hub actif'}</option>}
            {activeHubs.map(h => (
              <option key={h.id} value={h.id}>{h.name} — Zone {h.zone}</option>
            ))}
          </select>
        </div>
      </div>

      {dataError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"><p>{dataError}</p><button type="button" onClick={() => setReloadKey(value => value + 1)} className="min-h-11 mt-2 px-3 rounded-lg border border-red-300 font-bold">Réessayer le chargement</button></div> : dataLoading ? <div role="status" className="rounded-xl bg-slate-50 p-4 text-slate-700 flex items-center gap-2"><Loader2 className="animate-spin" size={20} />Chargement des hubs, colis et tournées…</div> : !activeHubs.length ? <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">Aucun hub actif n’est configuré. Demandez au bureau d’activer un hub avant de réceptionner des colis.</div> : null}
      {/* Notification */}
      {notification && (
        <div role={notification.type === 'success' ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 ${
          notification.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
          notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-amber-50 text-amber-700 border border-amber-200'
        }`}>
          {notification.type === 'success' ? <CheckCircle size={16} /> :
           notification.type === 'error' ? <X size={16} /> :
           <AlertTriangle size={16} />}
          <p className="flex-1">{notification.message}</p>
          <button type="button" aria-label="Masquer le message" onClick={() => setNotification(null)} className="min-w-11 min-h-11 rounded-lg border border-current"><X size={18} className="mx-auto" /></button>
        </div>
      )}

      {scanHistory.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="min-h-11 py-2 cursor-pointer text-sm font-bold">Dernières opérations ({scanHistory.length})</summary><ol className="space-y-2 text-sm">{scanHistory.map((item, index) => <li key={`${item.time}-${index}`} className={item.type === 'success' ? 'text-green-800' : item.type === 'error' ? 'text-red-800' : 'text-amber-900'}>{item.time} · {item.message}</li>)}</ol></details>}
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
              <span className={`text-2xl font-black ${tab.color}`}>{dataLoading || dataError ? '—' : tab.count}</span>
            </div>
            <p className="text-sm font-bold text-slate-700">{tab.label}</p>
          </button>
        ))}
      </div>

      {/* ================================================================== */}
      {/* TAB: RÉCEPTION                                                     */}
      {/* ================================================================== */}
      {activeTab === 'reception' && !dataLoading && !dataError && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => openScanner('reception')}
              disabled={processing || !selectedHub?.isActive}
              className="min-h-11 flex-1 flex items-center justify-center gap-2 py-3.5 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-200 active:scale-95 transition-transform"
            >
              <ScanBarcode size={18} />
              Scanner les colis entrants
            </button>
            <button
              onClick={() => setConfirmReceptionAll(true)}
              disabled={processing || receptionPackages.length === 0 || !selectedHub?.isActive}
              className="min-h-11 flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-800 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40"
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
              <button onClick={() => setScannedCodes([])} className="min-h-11 text-sm text-green-600 underline">
                Réinitialiser
              </button>
            </div>
          )}

          {/* Recherche */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="search"
              aria-label="Rechercher les colis à réceptionner"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par code, destinataire, client..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-200 outline-none"
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
                          <p className="text-sm font-medium text-slate-800">{pkg.contactName}<PackageScanInfo pkg={pkg} /></p>
                          <p className="text-sm text-slate-500">{pkg.barcode || pkg.orderNumber} • {pkg.clientName}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-0.5 rounded text-sm font-bold ${ZONE_COLORS[pkg.zone as Zone]?.bg || 'bg-slate-100'} ${ZONE_COLORS[pkg.zone as Zone]?.text || 'text-slate-600'}`}>
                          {pkg.zone}
                        </span>
                        <p className="text-sm text-slate-600 mt-0.5">{pkg.city}</p>
                      </div>
                    </div>
                  ))
                }
              </div>
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-sm text-slate-500">
                {filterPackages(receptionPackages).length} colis en attente
              </div>
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <ArrowDownToLine size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-700 font-medium">{searchTerm ? 'Aucun colis ne correspond à cette recherche' : 'Aucun colis en attente de réception'}</p>
              <p className="text-sm text-slate-600 mt-1">{searchTerm ? 'Essayez le numéro complet, le destinataire ou le client.' : 'Les colis à réceptionner apparaissent après leur création ou leur enlèvement.'}</p>
              {searchTerm && <button type="button" className="min-h-11 px-3 mt-2 underline font-bold" onClick={() => setSearchTerm('')}>Effacer la recherche</button>}
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB: CHARGEMENT                                                    */}
      {/* ================================================================== */}
      {activeTab === 'loading' && !dataLoading && !dataError && (
        <div className="space-y-4">

          {/* Sélection chauffeur (admin uniquement) */}
          {!isDriver && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <label htmlFor="operations-driver" className="text-sm font-bold text-slate-700 block mb-2">
                <UserCheck size={14} className="inline mr-1" />
                Chauffeur
              </label>
              {selectableDrivers.length > 0 ? (
                <select
                  id="operations-driver"
                  value={selectedDriverId}
                  onChange={(e) => {
                    setSelectedDriverId(e.target.value);
                    setScannedCodes([]);
                    setLoadingComplete(false);
                  }}
                  className="w-full min-h-11 px-3 py-2.5 border border-slate-200 rounded-xl text-base font-medium bg-white"
                >
                  <option value="">— Sélectionner un chauffeur —</option>
                  {selectableDrivers.map(d => {
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
                <p className="text-sm text-slate-600 italic">
                  Aucun chauffeur actif disponible. Vérifiez les comptes chauffeurs.
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
                    Tournée {driverMission.zone} — {driverVehicle?.plate || 'Véhicule'}
                  </p>
                  <p className="text-sm text-indigo-600">
                    {driverMission.totalPackages} colis • {driverMission.stops?.length || 0} arrêts
                  </p>
                </div>
              </div>
              {driverPackages.toLoad.length === 0 && driverPackages.loaded.length > 0 && (
                <span className="px-3 py-1 bg-green-500 text-white text-sm font-bold rounded-lg">
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
          {selectedDriverId && (
            <button
              onClick={() => openScanner('loading')}
              className="min-h-11 w-full flex items-center justify-center gap-2 py-4 bg-amber-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-200 active:scale-95 transition-transform"
            >
              <ScanBarcode size={20} />
              Scanner ({driverPackages.toLoad.length} restant{driverPackages.toLoad.length > 1 ? 's' : ''})
            </button>
          )}

          {/* Chargement terminé */}
          {loadingComplete && (
            <div className="bg-green-50 border-2 border-green-300 rounded-xl p-6 text-center">
              <CheckCircle size={40} className="mx-auto text-green-700 mb-2" />
              <p className="text-lg font-black text-green-700">Chargement terminé !</p>
              <p className="text-sm text-green-600 mt-1">
                {driverPackages.loaded.length} colis chargés — le chauffeur peut partir
              </p>
              <button
                onClick={resetLoading}
                className="min-h-11 mt-4 px-6 py-2 bg-green-700 text-white rounded-xl text-sm font-bold active:scale-95 transition-transform"
              >
                Nouveau chargement
              </button>
            </div>
          )}

          {/* Recherche */}
          {selectedDriverId && driverPackages.all.length > 0 && (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                type="search"
                aria-label="Rechercher les colis à charger"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher un colis..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-base focus:ring-2 focus:ring-indigo-200 outline-none"
              />
            </div>
          )}

          {selectedDriverId && searchTerm && driverPackages.all.length > 0 && filterPackages(driverPackages.all).length === 0 && <div role="status" className="rounded-xl bg-white border border-slate-200 p-4 text-slate-700">Aucun colis ne correspond à « {searchTerm} ». <button type="button" onClick={() => setSearchTerm('')} className="min-h-11 px-2 font-bold underline">Effacer la recherche</button></div>}
          {/* === LISTE DES COLIS — RESTANTS === */}
          {selectedDriverId && filterPackages(driverPackages.toLoad).length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                <PackageIcon size={14} className="text-amber-600" />
                <span className="text-sm font-bold text-amber-700 uppercase tracking-wide">
                  À charger — {filterPackages(driverPackages.toLoad).length} colis
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[350px] overflow-y-auto">
                {filterPackages(driverPackages.toLoad).map(pkg => (
                  <div key={pkg.id} className="px-4 py-3 flex items-center gap-3 hover:bg-amber-50/30">
                    <div className="w-6 h-6 rounded border-2 border-slate-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800">{pkg.contactName}<PackageScanInfo pkg={pkg} /></p>
                      <p className="text-sm text-slate-500 truncate">
                        {pkg.barcode || pkg.orderNumber} • {pkg.postalCode} {pkg.city}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-sm font-bold flex-shrink-0 ${ZONE_COLORS[pkg.zone as Zone]?.bg || 'bg-slate-100'} ${ZONE_COLORS[pkg.zone as Zone]?.text || 'text-slate-600'}`}>
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
                <span className="text-sm font-bold text-green-700 uppercase tracking-wide">
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
                      <p className="text-sm font-medium text-green-800">{pkg.contactName}<PackageScanInfo pkg={pkg} /></p>
                      <p className="text-sm text-green-600 truncate">
                        {pkg.barcode || pkg.orderNumber} • {pkg.postalCode} {pkg.city}
                      </p>
                    </div>
                    <span className="text-sm text-green-700 font-bold flex-shrink-0">✓</span>
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
              <p className="text-sm text-slate-600 mt-1">pour voir ses colis à charger</p>
            </div>
          )}

          {/* État vide — chauffeur sans colis */}
          {selectedDriverId && driverPackages.all.length === 0 && !loadingComplete && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <PackageIcon size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">Aucun colis assigné</p>
              <p className="text-sm text-slate-600 mt-1">
                Les colis apparaissent ici après l’affectation de la tournée par le bureau
              </p>
            </div>
          )}
        </div>
      )}

      {/* ================================================================== */}
      {/* ALERTE MAUVAIS COLIS                                               */}
      {/* ================================================================== */}
      {wrongColisAlert && (
        <Modal isOpen onClose={() => setWrongColisAlert(null)} title="Colis affecté à un autre chauffeur" closeOnOverlay={false} bodyClassName="!p-0">
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
                <p className="text-sm text-red-600 mt-1">{wrongColisAlert.packageName}</p>
              </div>

              <p className="text-center text-sm text-slate-600 font-medium">
                Ce colis est assigné à :
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <UserCheck size={18} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-slate-500 uppercase tracking-wide font-bold">Chauffeur</p>
                    <p className="text-sm font-bold text-slate-800">{wrongColisAlert.assignedDriverName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <Truck size={18} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-slate-500 uppercase tracking-wide font-bold">Véhicule</p>
                    <p className="text-sm font-bold text-slate-800">{wrongColisAlert.assignedVehiclePlate}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <MapPin size={18} className="text-slate-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-slate-500 uppercase tracking-wide font-bold">Zone</p>
                    <p className="text-sm font-bold text-slate-800">{wrongColisAlert.assignedZone}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bouton */}
            <div className="px-6 pb-6">
              <button
                onClick={() => setWrongColisAlert(null)}
                className="min-h-11 w-full py-3.5 bg-slate-800 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              >
                OK, compris
              </button>
            </div>
          </div>
        </Modal>
      )}
      <Modal isOpen={confirmReceptionAll} onClose={() => setConfirmReceptionAll(false)} title="Confirmer la réception au hub" preventClose={processing}>
        <p className="text-base text-slate-800">Confirmez que les <b>{receptionPackages.length} colis</b> en attente sont physiquement présents à <b>{selectedHub?.name || 'ce hub'}</b>. La recherche ne réduit pas ce lot.</p>
        <p className="mt-3 text-sm text-slate-600">Pour une réception partielle, fermez cette fenêtre puis scannez uniquement les colis présents.</p>
        <button type="button" disabled={processing || !selectedHub?.isActive} onClick={() => { setConfirmReceptionAll(false); void handleReceptionAll(); }} className="mt-4 min-h-12 w-full bg-blue-700 text-white rounded-xl px-4 py-3 font-bold">Confirmer la présence des {receptionPackages.length} colis</button>
      </Modal>

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
            forwardDuplicates={scanMode === 'loading'}
            busy={scanPending > 0}
            onClose={() => { setShowScanner(false); setScanMode(null); }}
            expectedBarcodes={scanMode === 'loading' ? expectedBarcodes : []}
            alreadyScanned={scannedCodes}
            flashMessage={notification ? { type: notification.type === 'success' ? 'ok' : 'warn', text: notification.message } : null}

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
