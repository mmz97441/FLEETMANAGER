import { escapeHtml } from '../utils/html';
import { useUrlParam, updateUrlParams } from '../hooks/useUrlState';
import { confirmAction } from '../services/confirmationService';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
/**
 * MISSION MANAGER
 *
 * Composant principal pour la gestion des missions et tournées
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Mission, MissionStatus, MissionType, MissionStop, StopStatus, Package, PackageStatus,
  ImportBatch, ImportBatchStatus, Hub, Zone, User, UserRole, Vehicle,
  ZONE_COLORS, MISSION_STATUS_COLORS, PACKAGE_STATUS_COLORS,
  Absence, AbsenceStatus
} from '../types';
import { todayISO, localDatePart } from '../utils/date';
import { formatDistance, formatDuration } from '../utils/format';
import {
  subscribeToMissions,
  subscribeToHubs,
  subscribeToPackages,
  subscribeToDispatchablePackages,
  subscribeToImportBatches,
  getPackagesByIds,
  getMissionById,
  calculateMissionStats,
  getAvailableDriversForZone,
  getDriversWithVehicles,
  addHub,
  updateHub,
  deleteHub,
  updatePackageStatus,
  deletePackage,
  updatePackageFields,
  updateMissionStopFields,
  removeMissionStop,
  reorderMissionStops,
  addManualStopToMission,
  DEFAULT_POSTAL_CODE_MAPPINGS,
  MissionStats,
  resyncPackageStatusesFromStops
} from '../services/missionService';
import { notifySuccess, notifyError, notifyInfo } from '../services/logService';
import { importExcelFile, validateExcelFormat, parseExcelForReview, ReviewResult } from '../services/importService';
import { geocodeAddress, getGoogleMapsApiKey, optimizeMultiVehicle, DriverVehicle } from '../services/gmproService';
import { logActivity } from '../services/activityLogService';
import { notifyImportCompleted } from '../services/notificationService';
import { ActivityAction } from '../types';
import { dispatchMissionsCF } from '../services/cloudFunctions';
import { usePermissions, Permission } from '../usePermissions';
import Modal from './shared/Modal';
import PageHeader from './shared/PageHeader';
import MissionStopFields from './MissionStopFields';
import OfficeSavedViews from './OfficeSavedViews';
import { startUxTask } from '../utils/uxMetrics';
import { PendingManualStop, pendingManualStopKey, readPendingManualStop, reservePendingManualStop, clearPendingManualStop } from '../utils/pendingManualStop';
import { createStopForm, validateStopForm, stopFormPayload, StopForm, StopFormErrors } from '../utils/missionStopForm';
import { missionStatusLabel, packageStatusLabel, stopStatusLabel } from '../utils/operationalLabels';
import DispatchManager from './DispatchManager';
import MissionKPIs from './MissionKPIs';
import ImportReviewTable from './ImportReviewTable';
import PackageTimeline from './PackageTimeline';
import PODViewer from './PODViewer';
import StopReorderModal from './StopReorderModal';
import {
  Truck, Package as PackageIcon, MapPin, Upload, Calendar, Clock,
  Users, CheckCircle, XCircle, AlertTriangle, Filter, Search,
  ChevronRight, ChevronDown, ChevronUp, Download, RefreshCw, Play, Pause,
  Eye, Edit, Trash2, Plus, FileSpreadsheet, Route, Loader2,
  Building2, Navigation, BarChart3, TrendingUp, ArrowRight, Phone, Zap,
  Printer, ArrowUp, ArrowDown, GripVertical
} from 'lucide-react';

interface MissionManagerProps {
  currentUser: User;
  users: User[];
  vehicles: Vehicle[];
  absences?: Absence[];
}

type TabType = 'dashboard' | 'dispatch' | 'imports' | 'missions' | 'packages' | 'hubs';

const MissionManager: React.FC<MissionManagerProps> = ({
  currentUser,
  users,
  vehicles,
  absences = []
}) => {
  // Un chauffeur est indisponible s'il a une absence VALIDÉE (accordée) couvrant
  // la date sélectionnée. Les demandes en attente ne bloquent PAS le dispatch.
  const isDriverOnLeave = useCallback((driverId: string, dateISO: string): boolean => {
    return absences.some(a =>
      a.userId === driverId &&
      a.status === AbsenceStatus.APPROVED &&
      a.startDate <= dateISO &&
      dateISO <= a.endDate
    );
  }, [absences]);
  // États
  const [activeTab, setActiveTab] = useUrlParam<TabType>('tab', 'dashboard', ['dashboard', 'dispatch', 'imports', 'missions', 'packages', 'hubs']);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  // Colis dispatchables (AT_HUB/SORTED) SANS plafond 500 → le tableau de dispatch
  // voit TOUJOURS tous les colis à affecter, même sur grosse journée.
  const [dispatchablePackages, setDispatchablePackages] = useState<Package[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  type SourceKey = 'missions' | 'packages' | 'dispatchable' | 'imports' | 'hubs';
  type SourceState = { status: 'loading' | 'ready' | 'error'; receivedAt?: string; error?: string; scope?: string };
  const [sourceStates, setSourceStates] = useState<Record<SourceKey, SourceState>>({ missions: { status: 'loading' }, packages: { status: 'loading' }, dispatchable: { status: 'loading' }, imports: { status: 'loading' }, hubs: { status: 'loading' } });
  const [sourceRetries, setSourceRetries] = useState<Record<SourceKey, number>>({ missions: 0, packages: 0, dispatchable: 0, imports: 0, hubs: 0 });
  const sourceLabels: Record<SourceKey, string> = { missions: 'Tournées', packages: 'Colis', dispatchable: 'Colis à affecter', imports: 'Historique des imports', hubs: 'Hubs' };
  const setSourceState = useCallback((key: SourceKey, next: Partial<SourceState>) => setSourceStates(previous => ({ ...previous, [key]: { ...previous[key], ...next } })), []);

  // Filtres
  const [dateParam] = useUrlParam<string>('date', todayISO());
  const setSelectedDate = (date: string) => updateUrlParams({ date: date === todayISO() ? null : date, page: null, mission: null });
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && localDatePart(new Date(`${dateParam}T12:00:00`)) === dateParam ? dateParam : todayISO();
  const [selectedZone] = useUrlParam<Zone | 'all'>('zone', 'all', ['all', ...Object.values(Zone)]);
  const setSelectedZone = (zone: Zone | 'all') => updateUrlParams({ zone: zone === 'all' ? null : zone, page: null });
  const [searchTerm] = useUrlParam<string>('q', '');
  const setSearchTerm = (value: string) => updateUrlParams({ q: value || null, page: null }, true);
  const [missionSearch, setMissionSearch] = useUrlParam<string>('missionQ', '');
  const [globalPackageSearch, setGlobalPackageSearch] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const packageSearchTask = useRef<ReturnType<typeof startUxTask> | null>(null);
  const [packageSearchVersion, setPackageSearchVersion] = useState(0);
  const [missionParam, setMissionParam] = useUrlParam<string>('mission', '');
  const expandedMissionId = missionParam || null;
  const setExpandedMissionId = (id: string | null) => setMissionParam(id || '');

  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [reviewData, setReviewData] = useState<ReviewResult | null>(null);

  // POD Viewer
  const [viewingPOD, setViewingPOD] = useState<{ pod: any; pkg: Package } | null>(null);

  // Status change (admin)
  const [statusChangePkg, setStatusChangePkg] = useState<Package | null>(null);
  const [isChangingStatus, setIsChangingStatus] = useState(false);

  // Edit/Delete colis (admin)
  const [editingPkg, setEditingPkg] = useState<Package | null>(null);
  const [packageParam, setPackageParam] = useUrlParam<string>('package', '');
  const expandedPkgTimelineId = packageParam || null;
  const setExpandedPkgTimelineId = (id: string | null) => setPackageParam(id || '');
  const [linkedPackage, setLinkedPackage] = useState<Package | null>(null);
  const [linkError, setLinkError] = useState('');
  // Consultation d'un lot d'import
  const [viewingBatch, setViewingBatch] = useState<ImportBatch | null>(null);
  const [batchPackages, setBatchPackages] = useState<Package[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [batchError, setBatchError] = useState('');
  const batchRequest = useRef(0);
  type PkgSortKey = 'orderNumber' | 'externalId' | 'contactName' | 'city' | 'zone' | 'status' | 'createdAt';
  const [pkgSortKey] = useUrlParam<PkgSortKey>('sort', 'createdAt', ['orderNumber', 'externalId', 'contactName', 'city', 'zone', 'status', 'createdAt']);
  const [pkgSortDir] = useUrlParam<'asc' | 'desc'>('dir', 'desc', ['asc', 'desc']);
  const pkgSort = useMemo(() => ({ key: pkgSortKey, dir: pkgSortDir }), [pkgSortKey, pkgSortDir]);
  const togglePkgSort = (key: PkgSortKey) => updateUrlParams({ sort: key, dir: pkgSortKey === key && pkgSortDir === 'asc' ? 'desc' : 'asc', page: null });
  const pkgSortVal = (p: Package, key: PkgSortKey): string =>
    key === 'externalId' ? (p.externalId || '') :
    key === 'contactName' ? (p.contactName || '') :
    key === 'city' ? (p.city || '') :
    key === 'zone' ? String(p.zone || '') :
    key === 'status' ? String(p.status || '') :
    key === 'createdAt' ? (p.createdAt || '') :
    (p.orderNumber || '');
  const [editPkgForm, setEditPkgForm] = useState<Record<string, any>>({});
  const [isSavingPkg, setIsSavingPkg] = useState(false);
  const [deletingPkg, setDeletingPkg] = useState<Package | null>(null);

  // Sélection multiple de colis
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<string>>(new Set());
  const [bulkStatusTarget, setBulkStatusTarget] = useState<PackageStatus | null>(null);

  // Dispatch rapide depuis sélection
  const [showQuickDispatch, setShowQuickDispatch] = useState(false);
  const [quickDispatchDriverId, setQuickDispatchDriverId] = useState<string>('');
  const [quickDispatchTime, setQuickDispatchTime] = useState<string>(() => {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    now.setMinutes(roundedMinutes, 0, 0);
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [quickDispatchHubId, setQuickDispatchHubId] = useState<string>('');
  const [isQuickDispatching, setIsQuickDispatching] = useState(false);
  const quickDispatchLock = useRef(false);
  const quickDispatchAttempt = useRef<{ key: string; request: Parameters<typeof dispatchMissionsCF>[0] } | null>(null);

  // Edit/Delete stops dans tournée (admin)
  const [editingStop, setEditingStop] = useState<{ mission: Mission; stop: MissionStop } | null>(null);
  const [editStopForm, setEditStopForm] = useState<StopForm>(createStopForm);
  const [stopErrors, setStopErrors] = useState<StopFormErrors>({});
  const [stopSaveError, setStopSaveError] = useState('');
  const stopMutationLock = useRef(false);
  const newStopRequestId = useRef<string>(crypto.randomUUID());
  const [pendingStop, setPendingStop] = useState<PendingManualStop | null>(null);
  const [pendingStopJournalError, setPendingStopJournalError] = useState('');
  const pendingStopKey = pendingManualStopKey(currentUser.id);
  useEffect(() => {
    const read = () => {
      try { setPendingStop(readPendingManualStop(localStorage, currentUser.id)); setPendingStopJournalError(''); }
      catch (error) { setPendingStop(null); setPendingStopJournalError(error instanceof Error ? error.message : 'Le navigateur ne peut pas lire la demande d’arrêt conservée.'); }
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === pendingStopKey || event.key === null) read(); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [pendingStopKey, currentUser.id]);
  const [deletingStop, setDeletingStop] = useState<{ mission: Mission; stop: MissionStop } | null>(null);
  const [addingStopToMission, setAddingStopToMission] = useState<Mission | null>(null);
  const [newStopForm, setNewStopForm] = useState<StopForm>(createStopForm);

  // Réordonnancement des stops
  const [reorderingMission, setReorderingMission] = useState<Mission | null>(null);

  // Gestion des hubs
  const [showHubModal, setShowHubModal] = useState(false);
  const [editingHub, setEditingHub] = useState<Hub | null>(null);
  const [isSavingHub, setIsSavingHub] = useState(false);
  const [hubToDelete, setHubToDelete] = useState<Hub | null>(null);
  const [hubForm, setHubForm] = useState({
    name: '',
    zone: '' as Zone | '',
    address: '',
    city: '',
    postalCode: '',
    contactPhone: '',
    openingTime: '07:00',
    closingTime: '18:00',
    assignedPostalCodes: '' // Séparés par virgule
  });

  const initialHubForm = useRef(hubForm);
  const [hubError, setHubError] = useState('');
  const [isDeletingHub, setIsDeletingHub] = useState(false);
  const requestHubClose = useUnsavedChanges(showHubModal && JSON.stringify(hubForm) !== JSON.stringify(initialHubForm.current), isSavingHub);
  const requestImportClose = useUnsavedChanges((showImportModal || !!reviewData) && !importResult?.success && (!!importFile || !!selectedClient), isImporting);

  const logConfirmedActivity = (...args: Parameters<typeof logActivity>) => logActivity(...args).catch(() => { notifyInfo('L’opération est enregistrée, mais le journal est momentanément indisponible.'); });

  const packageDirty = !!editingPkg && Object.entries(editPkgForm).some(([key, value]) => String(value ?? '') !== String((editingPkg as any)[key] ?? ''));
  const requestPackageClose = useUnsavedChanges(packageDirty, isSavingPkg);
  const closePackageEditor = () => void requestPackageClose(() => { setEditingPkg(null); updateUrlParams({ edit: null }, true); });
  const requestQuickClose = useUnsavedChanges(showQuickDispatch && !!quickDispatchDriverId, isQuickDispatching);
  const closeQuickDispatch = () => void requestQuickClose(() => setShowQuickDispatch(false));

  const stopDirty = !!editingStop && JSON.stringify(editStopForm) !== JSON.stringify(createStopForm(editingStop.stop));
  const requestStopClose = useUnsavedChanges(stopDirty, !!editingStop && isSavingPkg);
  const closeStopEditor = () => void requestStopClose(() => setEditingStop(null));
  const newStopDirty = !!addingStopToMission && JSON.stringify(newStopForm) !== JSON.stringify(createStopForm());
  const requestNewStopClose = useUnsavedChanges(newStopDirty, !!addingStopToMission && isSavingPkg);
  const closeNewStop = () => void requestNewStopClose(() => setAddingStopToMission(null));

  // Each source owns its readiness/error; a date change never rereads stable histories.
  useEffect(() => {
    let active = true;
    setSourceState('missions', { status: 'loading', error: undefined, scope: selectedDate });
    setMissions([]);
    const unsubscribe = subscribeToMissions(value => {
      if (!active) return;
      setMissions(value);
      setSourceState('missions', { status: 'ready', receivedAt: new Date().toISOString(), error: undefined, scope: selectedDate });
    }, { date: selectedDate }, error => {
      if (active) setSourceState('missions', { status: 'error', error: error.message || 'Lecture indisponible', scope: selectedDate });
    });
    return () => { active = false; unsubscribe(); };
  }, [selectedDate, sourceRetries.missions, setSourceState]);

  useEffect(() => {
    let active = true;
    setSourceState('packages', { status: 'loading', error: undefined });
    const measurement = startUxTask('load_packages', currentUser.role);
    const unsubscribe = subscribeToPackages(value => {
      if (!active) return;
      setPackages(value);
      measurement.finish('success', { items: value.length });
      setSourceState('packages', { status: 'ready', receivedAt: new Date().toISOString(), error: undefined });
    }, undefined, error => {
      if (active) { measurement.finish('error', { errors: 1 }); setSourceState('packages', { status: 'error', error: error.message || 'Lecture indisponible' }); }
    });
    return () => { active = false; unsubscribe(); };
  }, [sourceRetries.packages, setSourceState]);

  useEffect(() => {
    let active = true;
    setSourceState('dispatchable', { status: 'loading', error: undefined });
    const unsubscribe = subscribeToDispatchablePackages(value => {
      if (!active) return;
      setDispatchablePackages(value);
      setSourceState('dispatchable', { status: 'ready', receivedAt: new Date().toISOString(), error: undefined });
    }, error => {
      if (active) setSourceState('dispatchable', { status: 'error', error: error.message || 'Lecture indisponible' });
    });
    return () => { active = false; unsubscribe(); };
  }, [sourceRetries.dispatchable, setSourceState]);

  useEffect(() => {
    let active = true;
    setSourceState('imports', { status: 'loading', error: undefined });
    const unsubscribe = subscribeToImportBatches(value => {
      if (!active) return;
      setImportBatches(value);
      setSourceState('imports', { status: 'ready', receivedAt: new Date().toISOString(), error: undefined });
    }, undefined, error => {
      if (active) setSourceState('imports', { status: 'error', error: error.message || 'Lecture indisponible' });
    });
    return () => { active = false; unsubscribe(); };
  }, [sourceRetries.imports, setSourceState]);

  useEffect(() => {
    let active = true;
    setSourceState('hubs', { status: 'loading', error: undefined });
    const unsubscribe = subscribeToHubs(value => {
      if (!active) return;
      setHubs(value);
      setSourceState('hubs', { status: 'ready', receivedAt: new Date().toISOString(), error: undefined });
    }, error => {
      if (active) setSourceState('hubs', { status: 'error', error: error.message || 'Lecture indisponible' });
    });
    return () => { active = false; unsubscribe(); };
  }, [sourceRetries.hubs, setSourceState]);

  // Calcul des stats
  const stats = useMemo(() => calculateMissionStats(missions), [missions]);

  // Filtrage des missions
  const filteredMissions = useMemo(() => {
    let result = missions;

    if (selectedZone !== 'all') {
      result = result.filter(m => m.zone === selectedZone);
    }

    if (missionSearch) {
      const term = missionSearch.toLowerCase();
      result = result.filter(m =>
        m.driverName?.toLowerCase().includes(term) ||
        m.vehiclePlate?.toLowerCase().includes(term) ||
        (m.hubName || '').toLowerCase().includes(term)
      );
    }

    return result;
  }, [missions, selectedZone, missionSearch]);

  // Clients disponibles pour l'import
  const clients = useMemo(() =>
    users.filter(u => u.role === UserRole.CLIENT),
    [users]
  );

  // Packages visibles : tous les actifs (non terminés) + livrés/échoués du jour sélectionné
  const todayPackages = useMemo(() => {
    const activeStatuses = [
      PackageStatus.PENDING, PackageStatus.COLLECTED, PackageStatus.AT_HUB,
      PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED,
      PackageStatus.IN_DELIVERY
    ];
    return packages.filter(p =>
      activeStatuses.includes(p.status) ||
      localDatePart(p.createdAt) === selectedDate ||
      localDatePart(p.updatedAt || '') === selectedDate
    );
  }, [packages, selectedDate]);

  // Vue de suivi des colis : par défaut TOUS les colis (suivi global), avec la
  // date en filtre optionnel. Évite que l'admin ne voie rien à cause du filtre jour.
  const [dateScope] = useUrlParam<'all' | 'date'>('scope', 'all', ['all', 'date']);
  const colisAllDates = dateScope === 'all';
  const setColisAllDates = (next: boolean | ((previous: boolean) => boolean)) => updateUrlParams({ scope: (typeof next === 'function' ? next(colisAllDates) : next) ? null : 'date', page: null });
  const colisView = useMemo(
    () => {
      const base = colisAllDates ? packages : todayPackages;
      return linkedPackage && !base.some(pkg => pkg.id === linkedPackage.id) ? [linkedPackage, ...base] : base;
    },
    [colisAllDates, packages, todayPackages, linkedPackage]
  );

  // Filtre statut de l'onglet Colis (piloté par les cartes cliquables du
  // tableau de bord et les cartes stats de l'onglet Colis).
  type StatusFilter = PackageStatus | 'all' | 'failed';
  const [pkgStatusFilter] = useUrlParam<StatusFilter>('status', 'all', ['all', 'failed', ...Object.values(PackageStatus)]);
  const setPkgStatusFilter = (next: StatusFilter | ((previous: StatusFilter) => StatusFilter)) => {
    const status = typeof next === 'function' ? next(pkgStatusFilter) : next;
    updateUrlParams({ status: status === 'all' ? null : status, page: null });
  };
  const [packagePageParam, setPackagePage] = useUrlParam<string>('page', '1');
  const [packagePageSizeParam] = useUrlParam<'50' | '100'>('pageSize', '50', ['50', '100']);

  const matchesPkgStatusFilter = useCallback((p: Package) => {
    if (pkgStatusFilter === 'all') return true;
    if (pkgStatusFilter === 'failed') return p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED;
    return p.status === pkgStatusFilter;
  }, [pkgStatusFilter]);

  useEffect(() => {
    let active = true;
    setLinkError('');
    if (!packageParam) { setLinkedPackage(null); return; }
    getPackagesByIds([packageParam]).then(found => {
      if (!active) return;
      setLinkedPackage(found[0] || null);
      if (!found[0]) setLinkError('Le colis de ce lien est introuvable ou inaccessible. Vérifiez son identifiant.');
      else if (new URLSearchParams(window.location.search).get('edit') === '1') {
        setEditingPkg(found[0]); setEditPkgForm({ ...found[0] });
      }
    }).catch(() => { if (active) setLinkError('Impossible de charger le colis lié. Réessayez avec une connexion disponible.'); });
    return () => { active = false; };
  }, [packageParam]);
  useEffect(() => {
    let active = true;
    if (!missionParam) return;
    getMissionById(missionParam).then(mission => {
      if (!active) return;
      if (!mission) { setLinkError('La tournée de ce lien est introuvable ou inaccessible.'); return; }
      if (mission.date !== new URLSearchParams(window.location.search).get('date')) {
        updateUrlParams({ date: mission.date }, true);
      }
    }).catch(() => { if (active) setLinkError('Impossible de charger la tournée liée. Vérifiez la connexion.'); });
    return () => { active = false; };
  }, [missionParam]);

  const filteredPackages = useMemo(() => colisView.filter(pkg => {
    if (!matchesPkgStatusFilter(pkg)) return false;
    if (selectedZone !== 'all' && pkg.zone !== selectedZone) return false;
    if (packageParam && pkg.id === packageParam) return true;
    const term = searchTerm.toLowerCase().trim();
    return !term || [pkg.orderNumber, pkg.externalId, pkg.barcode, pkg.contactName, pkg.address, pkg.city]
      .some(value => (value || '').toLowerCase().includes(term));
  }).sort((a, b) => {
    if (a.id === packageParam) return -1;
    if (b.id === packageParam) return 1;
    const direction = pkgSort.dir === 'asc' ? 1 : -1;
    const first = pkgSortVal(a, pkgSort.key), second = pkgSortVal(b, pkgSort.key);
    return first < second ? -direction : first > second ? direction : 0;
  }), [colisView, matchesPkgStatusFilter, selectedZone, searchTerm, pkgSort, packageParam]);
  const packagePageSize = Number(packagePageSizeParam);
  const packagePageCount = Math.max(1, Math.ceil(filteredPackages.length / packagePageSize));
  const packagePage = Math.min(packagePageCount, /^\d+$/.test(packagePageParam) ? Math.max(1, Number(packagePageParam)) : 1);
  const packagePageStart = (packagePage - 1) * packagePageSize;
  const visiblePackages = filteredPackages.slice(packagePageStart, packagePageStart + packagePageSize);
  const selectableVisibleIds = visiblePackages.filter(pkg => !pkg.missionId && !pkg.currentDriverId).map(pkg => pkg.id);
  const selectedOutsideFilter = [...selectedPackageIds].filter(id => !filteredPackages.some(pkg => pkg.id === id)).length;
  const selectedOtherPages = [...selectedPackageIds].filter(id => filteredPackages.some(pkg => pkg.id === id) && !visiblePackages.some(pkg => pkg.id === id)).length;

  // Resynchronisation des statuts colis ↔ arrêts (répare les "En livraison"
  // bloqués alors que l'arrêt est terminé).
  const [isResyncing, setIsResyncing] = useState(false);
  const handleResyncStatuses = useCallback(async () => {
    if (isResyncing) return;
    setIsResyncing(true);
    notifyInfo('Analyse des statuts colis…');
    try {
      const res = await resyncPackageStatusesFromStops();
      if (res.fixedDelivered > 0) {
        notifySuccess(`${res.fixedDelivered} statut(s) rétabli(s) en "Livré" à partir des preuves de remise enregistrées.`);
      } else if (res.completedStopPackages === 0) {
        notifyInfo('Aucun colis d’un arrêt terminé à vérifier.');
      } else if (!res.skippedUnproven && !res.skippedReassigned && !res.failed) {
        notifySuccess('Statuts déjà à jour, rien à corriger.');
      }
      if (res.skippedUnproven > 0) notifyInfo(`${res.skippedUnproven} colis conservé(s) sans changement : preuve de remise absente ou incomplète. Vérifiez les preuves avant toute correction.`);
      if (res.skippedReassigned > 0) notifyInfo(`${res.skippedReassigned} colis conservé(s) sans changement : affectation différente de l’ancien arrêt.`);
      if (res.failed > 0) notifyError(`${res.failed} tournée(s) n’ont pas pu être vérifiées (voir Journal d’erreurs).`);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Échec de la resynchronisation');
    }
    setIsResyncing(false);
  }, [isResyncing]);

  // Drill-down depuis le tableau de bord : ouvre l'onglet Colis pré-filtré
  // sur le statut cliqué. scope='today' respecte la date sélectionnée,
  // 'all' bascule en suivi global (semaine / mois n'ont pas d'équivalent jour).
  const handleDrillToPackages = useCallback((
    status: PackageStatus | 'all' | 'failed',
    scope: 'today' | 'all'
  ) => {
    setPkgStatusFilter(status);
    setColisAllDates(scope === 'all');
    setSearchTerm('');
    setActiveTab('packages');
  }, []);

  // Permissions via le hook
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canImport = !permissionsLoading && hasPermission(Permission.MISSIONS_IMPORT);
  const canDispatch = !permissionsLoading && hasPermission(Permission.MISSIONS_DISPATCH);
  const canManageHubs = !permissionsLoading && hasPermission(Permission.HUBS_MANAGE);
  useEffect(() => {
    if (permissionsLoading) return;
    if ((activeTab === 'dispatch' && !canDispatch) || (activeTab === 'hubs' && !canManageHubs)) {
      setActiveTab('dashboard', true);
    }
  }, [activeTab, permissionsLoading, canDispatch, canManageHubs, setActiveTab]);

  // === IMPRESSION TOURNÉE ===
  // === RÉORDONNANCEMENT DES STOPS ===
  const handleSaveReorderedStops = async (mission: Mission, newStops: MissionStop[]) => {
    try {
      await reorderMissionStops(mission.id, newStops.map(stop => stop.id));

      // Log de l'activité
      await logConfirmedActivity(currentUser, ActivityAction.MISSION_UPDATED, {
        targetType: 'mission',
        targetId: mission.id,
        targetName: `Tournée ${mission.driverName || 'Non assigné'}`,
        details: { changes: [`Ordre des arrêts modifié manuellement (${newStops.length} arrêts)`] }
      });

      console.log('✅ Ordre des stops sauvegardé');
    } catch (error) {
      console.error('❌ Erreur sauvegarde ordre:', error);
      throw error;
    }
  };

  const handlePrintMission = (mission: Mission) => {
    const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const stopsHtml = sortedStops.map((stop, i) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${escapeHtml(stop.sequence)}</td>
        <td style="padding:8px;border:1px solid #ddd;">
          <strong>${escapeHtml(stop.contactName || '-')}</strong><br/>
          <span style="color:#555;">${escapeHtml(stop.address)}, ${escapeHtml(stop.postalCode)} ${escapeHtml(stop.city)}</span>
          ${stop.floor != null ? `<br/><small>Étage ${escapeHtml(stop.floor)}${stop.hasElevator ? ' (ascenseur)' : ' (sans asc.)'}</small>` : ''}
        </td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${escapeHtml(stop.contactPhone || '-')}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${escapeHtml(stop.packageCount)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${stop.timeWindowStart && stop.timeWindowEnd ? `${escapeHtml(stop.timeWindowStart)} - ${escapeHtml(stop.timeWindowEnd)}` : '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;font-size:11px;">${escapeHtml(stop.notes || '')}</td>
        <td style="padding:8px;border:1px solid #ddd;width:60px;"></td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tournée - ${escapeHtml(mission.driverName)} - ${escapeHtml(mission.date)}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 3px solid #333; padding-bottom: 12px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
          .meta-item { background: #f5f5f5; padding: 8px 12px; border-radius: 4px; }
          .meta-label { font-size: 10px; text-transform: uppercase; color: #888; }
          .meta-value { font-size: 14px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th { background: #333; color: white; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
          tr:nth-child(even) { background: #f9f9f9; }
          .hub-row { background: #e8f0fe !important; font-weight: bold; }
          .signature-block { margin-top: 30px; display: flex; justify-content: space-between; }
          .signature-box { border: 1px solid #ccc; padding: 12px; width: 45%; text-align: center; }
          .signature-label { font-size: 11px; color: #888; margin-bottom: 40px; }
          .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #aaa; }
          @media print {
            body { padding: 10px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>🚛 Feuille de Route</h1>
            <p style="color:#666;">Tournée ${escapeHtml(mission.zone)} — ${new Date(mission.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <div style="text-align:right;">
            <p style="font-size:12px;color:#888;">Imprimé le ${new Date().toLocaleString('fr-FR')}</p>
            <button class="no-print" onclick="window.print()" style="margin-top:8px;padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">
              🖨️ Imprimer
            </button>
          </div>
        </div>

        <div class="meta">
          <div class="meta-item">
            <div class="meta-label">Chauffeur</div>
            <div class="meta-value">${escapeHtml(mission.driverName || 'Non assigné')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Véhicule</div>
            <div class="meta-value">${escapeHtml(mission.vehiclePlate || '-')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Hub de départ</div>
            <div class="meta-value">${escapeHtml(mission.hubName || '-')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Nombre d’arrêts</div>
            <div class="meta-value">${sortedStops.length}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Total colis</div>
            <div class="meta-value">${escapeHtml(mission.totalPackages)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Distance / Durée estimée</div>
            <div class="meta-value">${formatDistance(mission.totalDistance) || '-'} / ${formatDuration(mission.estimatedDuration) || '-'}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:40px;">N°</th>
              <th>Adresse / Contact</th>
              <th style="width:110px;">Téléphone</th>
              <th style="width:50px;">Colis</th>
              <th style="width:110px;">Créneau</th>
              <th>Notes</th>
              <th style="width:60px;">Signat.</th>
            </tr>
          </thead>
          <tbody>
            <tr class="hub-row">
              <td style="padding:8px;border:1px solid #ddd;text-align:center;">🏁</td>
              <td colspan="6" style="padding:8px;border:1px solid #ddd;">DÉPART — ${escapeHtml(mission.hubName)}</td>
            </tr>
            ${stopsHtml}
            <tr class="hub-row">
              <td style="padding:8px;border:1px solid #ddd;text-align:center;">🏁</td>
              <td colspan="6" style="padding:8px;border:1px solid #ddd;">RETOUR — ${escapeHtml(mission.hubName)}</td>
            </tr>
          </tbody>
        </table>

        <div class="signature-block">
          <div class="signature-box">
            <div class="signature-label">Signature Chauffeur (départ)</div>
            <div style="border-bottom:1px solid #ccc;margin-bottom:8px;height:40px;"></div>
            <small>Heure de départ : ___________</small>
          </div>
          <div class="signature-box">
            <div class="signature-label">Signature Chauffeur (retour)</div>
            <div style="border-bottom:1px solid #ccc;margin-bottom:8px;height:40px;"></div>
            <small>Heure de retour : ___________</small>
          </div>
        </div>

        <div class="footer">
          FleetGenius — Feuille de route générée automatiquement
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const renderSavedViews = () => <OfficeSavedViews userId={currentUser.id}
    label={`${activeTab === 'missions' ? 'Tournées' : 'Colis'} · ${selectedZone === 'all' ? 'Toutes zones' : selectedZone}${activeTab === 'packages' ? ` · ${pkgStatusFilter === 'all' ? 'Tous statuts' : packageStatusLabel(pkgStatusFilter)} · ${({orderNumber:'Commande',externalId:'Référence',contactName:'Destinataire',city:'Ville',zone:'Zone',status:'Statut',createdAt:'Date de création'})[pkgSortKey]} ${pkgSortDir === 'asc' ? 'croissant' : 'décroissant'}` : ''}`}
    params={{ tab: activeTab, zone: selectedZone, ...(activeTab === 'packages' ? { status: pkgStatusFilter, scope: dateScope, sort: pkgSortKey, dir: pkgSortDir, pageSize: packagePageSizeParam } : {}) }}
    onApply={params => { setSelectedPackageIds(new Set()); setGlobalPackageSearch(''); updateUrlParams({ tab: null, zone: null, status: null, scope: null, sort: null, dir: null, pageSize: null, ...params, q: null, missionQ: null, date: null, page: null, package: null, mission: null, edit: null }); }} />;

  // Handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!importFile || !selectedClient) return;

    const client = users.find(u => u.id === selectedClient);
    if (!client) return;

    setIsImporting(true);

    try {
      // Valider le format d'abord
      const validation = await validateExcelFormat(importFile);
      if (!validation.valid) {
        setImportResult({
          success: false,
          errors: validation.errors.map((msg, i) => ({ row: 0, message: msg }))
        });
        setIsImporting(false);
        return;
      }

      // Parser pour revue (NE crée PAS les colis en base)
      const review = await parseExcelForReview(importFile);
      setReviewData(review);
      setShowImportModal(false); // Ferme le modal de sélection fichier
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({
        success: false,
        errors: [{ row: 0, message: 'Erreur lors de la lecture du fichier' }]
      });
    }

    setIsImporting(false);
  };

  const closeImportModal = () => void requestImportClose(() => {
    setShowImportModal(false);
    setImportFile(null);
    setSelectedClient('');
    setImportResult(null);
    setReviewData(null);
  });

  // === GESTION DES HUBS ===

  const openHubModal = (hub?: Hub) => {
    setHubError('');
    if (hub) {
      // Mode édition
      setEditingHub(hub);
      setHubForm({
        name: hub.name,
        zone: hub.zone,
        address: hub.address,
        city: hub.city,
        postalCode: hub.postalCode,
        contactPhone: hub.contactPhone || '',
        openingTime: hub.openingTime || '07:00',
        closingTime: hub.closingTime || '18:00',
        assignedPostalCodes: hub.assignedPostalCodes?.join(', ') || ''
      });
    } else {
      // Mode création
      setEditingHub(null);
      setHubForm({
        name: '',
        zone: '',
        address: '',
        city: '',
        postalCode: '',
        contactPhone: '',
        openingTime: '07:00',
        closingTime: '18:00',
        assignedPostalCodes: ''
      });
    }
    initialHubForm.current = hub ? { name: hub.name, zone: hub.zone, address: hub.address, city: hub.city, postalCode: hub.postalCode, contactPhone: hub.contactPhone || '', openingTime: hub.openingTime || '07:00', closingTime: hub.closingTime || '18:00', assignedPostalCodes: hub.assignedPostalCodes?.join(', ') || '' } : { name: '', zone: '', address: '', city: '', postalCode: '', contactPhone: '', openingTime: '07:00', closingTime: '18:00', assignedPostalCodes: '' };
    setShowHubModal(true);
  };

  const closeHubModal = () => void requestHubClose(() => { setShowHubModal(false); setEditingHub(null); });

  const handleHubFormChange = (field: string, value: string) => {
    setHubForm(prev => ({ ...prev, [field]: value }));

    // Auto-remplir les codes postaux selon la zone sélectionnée
    if (field === 'zone' && value && !editingHub) {
      const zoneCodes = DEFAULT_POSTAL_CODE_MAPPINGS
        .filter(m => m.zone === value)
        .map(m => m.postalCode);
      setHubForm(prev => ({ ...prev, assignedPostalCodes: zoneCodes.join(', ') }));
    }
  };

  const handleSaveHub = async () => {
    if (!hubForm.name || !hubForm.zone || !hubForm.address || !hubForm.city || !hubForm.postalCode) {
      return;
    }

    setIsSavingHub(true);

    try {
      const hubData: any = {
        name: hubForm.name,
        zone: hubForm.zone as Zone,
        address: hubForm.address,
        city: hubForm.city,
        postalCode: hubForm.postalCode,
        contactPhone: hubForm.contactPhone || undefined,
        openingTime: hubForm.openingTime,
        closingTime: hubForm.closingTime,
        assignedPostalCodes: hubForm.assignedPostalCodes
          .split(',')
          .map(cp => cp.trim())
          .filter(cp => cp.length > 0),
        isActive: true
      };

      // Géocoder automatiquement l'adresse du hub
      const apiKey = getGoogleMapsApiKey();
      if (apiKey) {
        const coords = await geocodeAddress(hubForm.address, hubForm.city, hubForm.postalCode, apiKey);
        if (coords) {
          hubData.coordinates = coords;
        }
      }

      if (editingHub) {
        // Mise à jour
        await updateHub({ ...editingHub, ...hubData });
        logConfirmedActivity(currentUser, ActivityAction.ITEM_UPDATED, {
          targetType: 'mission',
          targetId: editingHub.id,
          targetName: hubData.name,
          details: { metadata: { zone: hubData.zone } }
        });
      } else {
        // Création
        const hubId = await addHub(hubData);
        logConfirmedActivity(currentUser, ActivityAction.ITEM_CREATED, {
          targetType: 'mission',
          targetId: hubId,
          targetName: hubData.name,
          details: { metadata: { zone: hubData.zone } }
        });
      }

      setShowHubModal(false); setEditingHub(null); notifySuccess('Hub enregistré.');
    } catch (error) {
      setHubError('Enregistrement impossible. Votre saisie est conservée ; réessayez.');
    }

    setIsSavingHub(false);
  };

  const handleDeleteHub = async () => {
    if (!hubToDelete || isDeletingHub) return;
    setIsDeletingHub(true); setHubError('');

    try {
      await deleteHub(hubToDelete.id);
      logConfirmedActivity(currentUser, ActivityAction.ITEM_DELETED, {
        targetType: 'mission',
        targetId: hubToDelete.id,
        targetName: hubToDelete.name,
        details: { metadata: { zone: hubToDelete.zone } }
      });
      setHubToDelete(null);
    } catch (error) {
      setHubError('Suppression impossible. Vérifiez les tournées liées à ce hub puis réessayez.');
    } finally { setIsDeletingHub(false); }
  };

  const toggleHubActive = async (hub: Hub) => {
    try {
      await updateHub({ ...hub, isActive: !hub.isActive });
      logConfirmedActivity(currentUser, ActivityAction.STATUS_CHANGED, {
        targetType: 'mission',
        targetId: hub.id,
        targetName: hub.name,
        details: {
          before: { isActive: hub.isActive },
          after: { isActive: !hub.isActive }
        }
      });
    } catch (error) {
      notifyError('Le changement d’état du hub n’a pas été enregistré. Réessayez.');
    }
  };

  const renderTabs = () => {
    const tabs = [
      { id: 'dashboard', label: 'Tableau de bord', icon: BarChart3 },
      ...(canDispatch ? [{ id: 'dispatch', label: 'Préparer les tournées', icon: Zap }] : []),
      { id: 'imports', label: 'Imports', icon: Upload },
      { id: 'missions', label: 'Suivre les tournées', icon: Route },
      { id: 'packages', label: 'Colis', icon: PackageIcon },
      ...(canManageHubs ? [{ id: 'hubs', label: 'Configurer les hubs', icon: Building2 }] : []),
    ];
    return <>
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2 sm:flex sm:flex-wrap">
        <label className="min-w-0 text-sm font-semibold text-slate-700 sm:hidden">Vue
          <select aria-label="Vue de l’exploitation" value={activeTab} onChange={event => setActiveTab(event.target.value as TabType)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base font-normal">
            {tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </select>
        </label>
        <label htmlFor="office-working-date" className="min-w-0 text-sm font-semibold text-slate-700 sm:flex sm:items-center sm:gap-2">Date de travail
          <input type="date" id="office-working-date" aria-label="Date des tournées" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base sm:mt-0 sm:w-auto" />
        </label>
      </div>
      <div className="hidden sm:flex border-b border-slate-200 mb-3 overflow-x-auto" aria-label="Vues de l’exploitation">
        {tabs.map(tab => <button type="button" key={tab.id} onClick={() => setActiveTab(tab.id as TabType)} aria-current={activeTab === tab.id ? 'page' : undefined}
          className={`flex items-center gap-2 min-h-11 px-4 py-3 font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-800'}`}>
          <tab.icon size={18} />{tab.label}
        </button>)}
      </div>
    </>;
  };

  // Render Dashboard
  const renderDashboard = () => (
    <MissionKPIs
      missions={missions}
      packages={packages}
      users={users}
      selectedDate={selectedDate}
      onDrillDown={handleDrillToPackages}
      onOpenMissions={() => setActiveTab('missions')}
    />
  );

  // Ouvre la consultation d'un lot d'import (colis importés)
  const openBatch = async (batch: ImportBatch) => {
    const request = ++batchRequest.current;
    setBatchError('');
    setViewingBatch(batch);
    setBatchPackages([]);
    setLoadingBatch(true);
    try {
      const ids = (batch.zoneBreakdown || []).flatMap(z => z.packageIds || []);
      const pkgs = ids.length > 0
        ? await getPackagesByIds(ids)
        : packages.filter(p => p.importBatchId === batch.id); // repli si pas d'IDs stockés
      if (request === batchRequest.current) setBatchPackages(pkgs);
    } catch (e) {
      if (request === batchRequest.current) setBatchError('Impossible de charger les colis de cet import. Réessayez.');
    }
    if (request === batchRequest.current) setLoadingBatch(false);
  };

  // Render Imports
  const renderImports = () => (
    <div className="space-y-6">
      {/* Actions */}
      {canImport && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowImportModal(true)}
            className="ui-button ui-button-primary flex items-center gap-2"
          >
            <Upload size={18} />
            Importer un fichier
          </button>
        </div>
      )}

      {/* Liste des imports */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-800">Historique des imports</h3>
        </div>

        {importBatches.length === 0 ? (
          <div className="p-8 text-center">
            <FileSpreadsheet size={48} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">Aucun import pour le moment</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {importBatches.map(batch => (
              <button type="button"
                key={batch.id}
                onClick={() => openBatch(batch)}
                aria-label={`Consulter les colis de l’import ${batch.fileName}`}
                className="min-h-11 w-full p-4 text-left hover:bg-slate-50 focus-visible:outline-blue-700"
              >
                <span className="flex flex-wrap items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                      <FileSpreadsheet size={20} className="text-slate-600" />
                    </span>
                    <span>
                      <span className="block min-w-0 break-words font-medium text-slate-800">{batch.fileName}</span>
                      <span className="block text-sm text-slate-500">
                        {batch.clientName} • {new Date(batch.importedAt).toLocaleString('fr-FR')}
                      </span>
                    </span>
                  </span>

                  <span className="text-right">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-green-600">
                        {batch.successCount} réussis
                      </span>
                      {batch.errorCount > 0 && (
                        <span className="text-sm font-medium text-red-600">
                          {batch.errorCount} erreurs
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-slate-500 mt-1">
                      {batch.totalRows} lignes
                    </span>
                  </span>
                </span>

                {/* Répartition par zone */}
                <span className="mt-3 flex flex-wrap gap-2">
                  {batch.zoneBreakdown.map(zb => {
                    const colors = ZONE_COLORS[zb.zone];
                    return (
                      <span
                        key={zb.zone}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium ${colors.bg} ${colors.text}`}
                      >
                        {zb.zone}: {zb.count}
                        {zb.dispatched && <CheckCircle size={16} />}
                      </span>
                    );
                  })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal consultation d'un lot d'import */}
      {viewingBatch && (
        <Modal mobileFullscreen isOpen onClose={() => { batchRequest.current += 1; setViewingBatch(null); }} title={viewingBatch.fileName} subtitle={`${viewingBatch.clientName} · ${viewingBatch.totalRows} lignes`} size="3xl" footer={<p className="text-sm text-slate-600">{batchPackages.length} colis retrouvés · {viewingBatch.successCount} réussis / {viewingBatch.totalRows} lignes</p>}>
            {/* Erreurs du lot */}
            {viewingBatch.errors && viewingBatch.errors.length > 0 && (
              <div className="mx-4 mt-3 p-2 bg-red-50 border border-red-200 rounded-lg shrink-0">
                <p className="text-sm font-bold text-red-700 mb-1">{viewingBatch.errors.length} ligne(s) en erreur (non importées) :</p>
                <ul className="text-sm text-red-600 list-disc list-inside max-h-20 overflow-y-auto">
                  {viewingBatch.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>{e.row > 0 ? `Ligne ${e.row}: ` : ''}{e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Contenu : colis importés */}
            <div className="overflow-auto p-4">
              {batchError ? (<div role="alert" className="rounded-lg bg-red-50 p-3 text-red-900"><p>{batchError}</p><button type="button" onClick={() => void openBatch(viewingBatch)} className="ui-button ui-button-secondary mt-2 min-h-11 border">Réessayer</button></div>) : loadingBatch ? (
                <div className="py-10 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" /> Chargement des colis…</div>
              ) : batchPackages.length === 0 ? (
                <div className="py-10 text-center text-slate-400">Aucun colis rattaché à ce lot.</div>
              ) : (
                <table className="ui-table w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left">
                      <th className="px-2 py-2 font-bold text-slate-500">N° Colis</th>
                      <th className="px-2 py-2 font-bold text-slate-500">N° Cmd</th>
                      <th className="px-2 py-2 font-bold text-slate-500">Destinataire</th>
                      <th className="px-2 py-2 font-bold text-slate-500">Adresse</th>
                      <th className="px-2 py-2 font-bold text-slate-500">CP / Ville</th>
                      <th className="px-2 py-2 font-bold text-slate-500 text-center">Zone</th>
                      <th className="px-2 py-2 font-bold text-slate-500 text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchPackages.map(p => {
                      const zc = ZONE_COLORS[p.zone] || { bg: 'bg-slate-100', text: 'text-slate-600' };
                      const sc = PACKAGE_STATUS_COLORS[p.status] || { bg: 'bg-slate-100', text: 'text-slate-600' };
                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-2 py-2 font-mono font-bold text-slate-800">{p.externalId || p.barcode || '—'}</td>
                          <td className="px-2 py-2 font-mono text-slate-600">{p.orderNumber}</td>
                          <td className="px-2 py-2">{p.contactName}</td>
                          <td className="px-2 py-2 text-slate-500">{p.address}</td>
                          <td className="px-2 py-2 text-slate-500">{p.postalCode} {p.city}</td>
                          <td className="px-2 py-2 text-center"><span className={`px-1.5 py-0.5 rounded text-sm font-bold ${zc.bg} ${zc.text}`}>{p.zone}</span></td>
                          <td className="px-2 py-2 text-center"><span className={`px-1.5 py-0.5 rounded text-sm font-bold ${sc.bg} ${sc.text}`}>{packageStatusLabel(p.status)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

        </Modal>
      )}
    </div>
  );

  const renderMissionFilters = () => (
        <div className="flex flex-col md:flex-row gap-3 p-3 pt-0">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            aria-label="Rechercher une tournée par chauffeur ou véhicule" placeholder="Rechercher par chauffeur, véhicule..."
            value={missionSearch}
            onChange={(e) => setMissionSearch(e.target.value, true)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>

        <select
          aria-label="Filtrer les tournées par zone"
          value={selectedZone}
          onChange={(e) => setSelectedZone(e.target.value as Zone | 'all')}
          className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white font-medium"
        >
          <option value="all">Toutes les zones</option>
          {Object.values(Zone).map(zone => (
            <option key={zone} value={zone}>{zone}</option>
          ))}
        </select>

        <button type="button" onClick={() => updateUrlParams({ missionQ: null, zone: null, mission: null })} className="ui-button ui-button-secondary min-h-11 border text-sm">Réinitialiser les filtres</button>
        </div>
  );

  // Render Missions
  const renderMissions = () => (
    <div className="space-y-6">
      {/* Liste des missions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filteredMissions.length === 0 ? (
          <div className="p-8 text-center">
            <Route size={48} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">{missionSearch || selectedZone !== 'all' ? 'Aucune tournée ne correspond aux filtres.' : 'Aucune tournée pour cette date.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredMissions.map(mission => {
              const zoneColors = ZONE_COLORS[mission.zone] || { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500' };
              const statusColors = MISSION_STATUS_COLORS[mission.status] || { bg: 'bg-slate-100', text: 'text-slate-700' };
              const progress = mission.totalPackages > 0
                ? Math.round(((mission.deliveredPackages || 0) / mission.totalPackages) * 100)
                : 0;
              const isExpanded = expandedMissionId === mission.id;
              const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);

              return (
                <div key={mission.id}>
                  <div className="min-w-0 p-3 sm:p-4 hover:bg-slate-50 transition-colors">
                    <button type="button" onClick={() => setExpandedMissionId(isExpanded ? null : mission.id)}
                      aria-expanded={isExpanded} aria-controls={`mission-stops-${mission.id}`}
                      aria-label={`${isExpanded ? 'Replier' : 'Développer'} la tournée de ${mission.driverName || 'chauffeur non affecté'}`}
                      className="min-h-11 w-full min-w-0 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-blue-700">
                      <div className="flex items-start gap-2 min-w-0">
                        {isExpanded ? <ChevronDown size={20} className="mt-1 shrink-0 text-blue-700" /> : <ChevronRight size={20} className="mt-1 shrink-0 text-slate-600" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words font-bold text-base text-slate-900">{mission.driverName || 'Non affecté'}</p>
                            <span className={`px-2 py-1 rounded-lg text-sm font-medium ${statusColors.bg} ${statusColors.text}`}>{missionStatusLabel(mission.status)}</span>
                          </div>
                          <p className="mt-1 break-words text-sm text-slate-600">{mission.vehiclePlate || 'Pas de véhicule'} · {mission.hubName}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-700">
                            <span>{mission.stops.length} arrêt{mission.stops.length > 1 ? 's' : ''}</span><span>{mission.totalPackages} colis</span>
                            {mission.totalDistance != null && <span>{formatDistance(mission.totalDistance)}</span>}
                            {mission.estimatedDuration != null && <span>{formatDuration(mission.estimatedDuration)}</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-700"><strong className="text-lg">{progress} %</strong> · {mission.deliveredPackages || 0} livrés{mission.failedPackages > 0 && <span className="text-red-800"> · {mission.failedPackages} échecs</span>}</p>
                      <span className={`rounded-lg px-2 py-1 text-sm ${zoneColors.bg} ${zoneColors.text}`}>{mission.zone}</span>
                    </div>
                    <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden" role="progressbar" aria-label="Colis livrés" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, progress)}>
                      <div className="h-full bg-green-700 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a href={`/missions?tab=missions&date=${encodeURIComponent(mission.date)}&mission=${encodeURIComponent(mission.id)}`} className="min-h-11 inline-flex items-center px-2 text-sm text-blue-800 underline">Lien vers cette tournée</a>
                      <button type="button" onClick={() => handlePrintMission(mission)} className="ui-button ui-button-secondary ml-auto min-h-11 inline-flex items-center gap-2 border text-sm" title="Imprimer la feuille de route"><Printer size={18} />Imprimer</button>
                    </div>
                  </div>

                  {/* Détail de la tournée (expandable) */}
                  {isExpanded && (
                    <div id={`mission-stops-${mission.id}`} className="min-w-0 bg-slate-50 border-t border-slate-200">
                      {/* Résumé de la tournée */}
                      <div className="px-4 py-3 bg-slate-100 border-b border-slate-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold text-slate-700">
                              Itinéraire de la tournée
                            </span>
                            {mission.dispatchedAt && (
                              <span className="text-slate-500">
                                Affectée le {new Date(mission.dispatchedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {mission.dispatchedByName ? ` par ${mission.dispatchedByName}` : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                            {mission.status === MissionStatus.DISPATCHED && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openNewStop(mission);
                                }}
                                className="ui-button ui-button-primary min-h-11 flex items-center gap-1.5 border text-sm"
                                title="Ajouter un arrêt"
                              >
                                <Plus size={14} />
                                Ajouter un arrêt
                              </button>
                            )}
                            {mission.status === MissionStatus.DISPATCHED && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReorderingMission(mission);
                                }}
                                className="ui-button ui-button-secondary min-h-11 flex items-center gap-1.5 border text-sm"
                                title="Réordonner les arrêts"
                              >
                                <GripVertical size={14} />
                                Réordonner
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePrintMission(mission); }}
                              className="ui-button ui-button-secondary min-h-11 flex items-center gap-1.5 border text-sm"
                              title="Imprimer la feuille de route"
                            >
                              <Printer size={14} />
                              Imprimer
                            </button>
                            <span>{sortedStops.filter(s => s.status === 'Terminé').length}/{sortedStops.length} arrêts terminés</span>
                          </div>
                        </div>
                      </div>

                      {/* Départ Hub */}
                      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-200">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm font-bold">
                          <Building2 size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-700">Départ — {mission.hubName}</p>
                        </div>
                      </div>

                      {/* Liste des stops */}
                      {sortedStops.map((stop, index) => {
                        const stopStatusIcon =
                          stop.status === 'Terminé' ? <CheckCircle size={16} className="text-green-500" /> :
                          stop.status === 'Échec' ? <XCircle size={16} className="text-red-500" /> :
                          stop.status === 'Passé' ? <XCircle size={16} className="text-amber-500" /> :
                          stop.status === 'Arrivé' ? <Truck size={16} className="text-blue-500" /> :
                          <div className="w-4 h-4 rounded-full border-2 border-slate-300" />;

                        const stopBg =
                          stop.status === 'Terminé' ? 'bg-green-50' :
                          stop.status === 'Échec' ? 'bg-red-50' :
                          stop.status === 'Passé' ? 'bg-amber-50' :
                          stop.status === 'Arrivé' ? 'bg-blue-50' :
                          '';

                        return (
                          <div key={stop.id} className={`px-4 py-3 border-b border-slate-200 ${stopBg}`}>
                            <div className="flex flex-wrap items-start gap-3">
                              {/* Numéro du stop */}
                              <div className="flex flex-col items-center">
                                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                                  stop.status === 'Terminé' ? 'bg-green-100 text-green-700' :
                                  stop.status === 'Échec' ? 'bg-red-100 text-red-700' :
                                  'bg-slate-200 text-slate-600'
                                }`}>
                                  {stop.sequence}
                                </div>
                                {index < sortedStops.length - 1 && (
                                  <div className="w-0.5 h-6 bg-slate-300 mt-1" />
                                )}
                              </div>

                              {/* Détails du stop */}
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                  {stopStatusIcon}
                                  <p className="min-w-0 break-words font-semibold text-slate-800">
                                    {stop.contactName}
                                  </p>
                                  <span className={`px-1.5 py-0.5 rounded text-sm font-medium ${
                                    stop.status === 'Terminé' ? 'bg-green-100 text-green-700' :
                                    stop.status === 'Échec' ? 'bg-red-100 text-red-700' :
                                    stop.status === 'Passé' ? 'bg-amber-100 text-amber-700' :
                                    stop.status === 'Arrivé' ? 'bg-blue-100 text-blue-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {stopStatusLabel(stop.status)}
                                  </span>
                                </div>
                                <p className="text-sm text-slate-600">
                                  <MapPin size={16} className="inline mr-1" />
                                  {stop.address}, {stop.postalCode} {stop.city}
                                </p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-1 text-sm text-slate-600">
                                  <span className="flex items-center gap-1">
                                    <PackageIcon size={11} />
                                    {stop.packageCount} colis
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Clock size={11} />
                                    ~{stop.serviceTime} min sur place
                                  </span>
                                  {stop.contactPhone && (
                                    <span className="flex items-center gap-1">
                                      <Phone size={11} />
                                      {stop.contactPhone}
                                    </span>
                                  )}
                                  {stop.floor != null && (
                                    <span>
                                      Étage {stop.floor}{stop.hasElevator ? ' (asc.)' : ''}
                                    </span>
                                  )}
                                </div>
                                {stop.timeWindowStart && stop.timeWindowEnd && (
                                  <p className="text-sm text-blue-600 mt-1">
                                    Créneau : {stop.timeWindowStart} - {stop.timeWindowEnd}
                                  </p>
                                )}
                                {stop.notes && (
                                  <p className="text-sm text-amber-800 mt-1 italic">
                                    Notes : {stop.notes}
                                  </p>
                                )}
                                {stop.distanceFromPrevious != null && stop.distanceFromPrevious > 0 && (
                                  <p className="text-sm text-slate-400 mt-1">
                                    ↳ {formatDistance(stop.distanceFromPrevious)} depuis l’arrêt précédent
                                    {stop.durationFromPrevious ? ` (~${formatDuration(stop.durationFromPrevious)})` : ''}
                                  </p>
                                )}

                                {/* POD Status — pour stops traités */}
                                {stop.status === 'Terminé' && (() => {
                                  if (sourceStates.packages.status !== 'ready') return <p className="mt-2 text-sm text-slate-600">{sourceStates.packages.status === 'error' ? 'Preuve momentanément inaccessible — réessayez le chargement des colis.' : 'Chargement de la preuve…'}</p>;
                                  // Chercher le colis correspondant pour voir s'il a un POD
                                  const stopPkg = todayPackages.find(p =>
                                    stop.packageIds?.includes(p.id) && p.pod
                                  );
                                  return stopPkg?.pod ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setViewingPOD({ pod: stopPkg.pod!, pkg: stopPkg }); }}
                                      className="ui-button ui-button-primary inline-flex items-center gap-1.5 mt-2 text-sm cursor-pointer"
                                    >
                                      <Eye size={18} />
                                      {stopPkg.pod?.signatureUrl ? 'Signé' : 'Photo'} — Voir la preuve
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-amber-50 text-amber-800 rounded text-sm font-medium">
                                      Preuve de livraison manquante
                                    </span>
                                  );
                                })()}
                                {stop.status === 'Échec' && (() => {
                                  const hasFailurePhotos = todayPackages.some(p =>
                                    stop.packageIds?.includes(p.id)
                                  );
                                  return (
                                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-red-50 text-red-500 rounded text-sm font-medium">
                                      Échec · {stop.completionTime ? new Date(stop.completionTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Échec'}
                                    </span>
                                  );
                                })()}
                              </div>

                              {/* === BOUTONS D'ACTION STOP (admin) === */}
                              {mission.status === MissionStatus.DISPATCHED && (
                                <div className="basis-full sm:basis-auto flex flex-wrap sm:flex-col gap-2 pt-2 sm:pt-0 ml-11 sm:ml-0">
                                  {/* Monter */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStopUp(mission, stop); }}
                                    disabled={isSavingPkg || index === 0}
                                    className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center border disabled:opacity-40 disabled:cursor-not-allowed"
                                    aria-label="Monter" title="Monter"
                                  >
                                    <ArrowUp size={14} />
                                  </button>
                                  {/* Descendre */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStopDown(mission, stop); }}
                                    disabled={isSavingPkg || index === sortedStops.length - 1}
                                    className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center border disabled:opacity-40 disabled:cursor-not-allowed"
                                    aria-label="Descendre" title="Descendre"
                                  >
                                    <ArrowDown size={14} />
                                  </button>
                                  {/* Modifier */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditStopForm(createStopForm(stop)); setStopErrors({}); setStopSaveError('');
                                      setEditingStop({ mission, stop });
                                    }}
                                    className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center border"
                                    aria-label="Modifier" title="Modifier"
                                  >
                                    <Edit size={14} />
                                  </button>
                                  {/* Supprimer */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setStopSaveError(''); setDeletingStop({ mission, stop }); }}
                                    className="ui-button ui-button-secondary ml-auto sm:ml-0 sm:mt-3 min-h-11 min-w-11 inline-flex items-center justify-center border"
                                    aria-label="Supprimer" title="Supprimer"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Retour Hub */}
                      <div className="px-4 py-2.5 flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-sm font-bold">
                          <Building2 size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-700">Retour — {mission.hubName}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // Changement de statut admin
  const handleStatusChange = async (pkg: Package, newStatus: PackageStatus) => {
    setIsChangingStatus(true);
    try {
      const statusLabels: Record<string, string> = {
        [PackageStatus.PENDING]: 'En attente',
        [PackageStatus.COLLECTED]: 'Collecté',
        [PackageStatus.AT_HUB]: 'Au hub',
        [PackageStatus.SORTED]: 'Trié',
        [PackageStatus.LOADED]: 'Chargé',
        [PackageStatus.IN_DELIVERY]: 'En livraison',
        [PackageStatus.DELIVERED]: 'Livré',
        [PackageStatus.FAILED]: 'Échec',
      };
      await updatePackageStatus(
        pkg.id,
        newStatus,
        {
          action: 'MANUAL_STATUS_CHANGE',
          driverId: currentUser.id,
          driverName: `${currentUser.firstName} ${currentUser.lastName}`,
          notes: `Changement manuel: ${statusLabels[pkg.status] || pkg.status} → ${statusLabels[newStatus] || newStatus}`
        }
      );
      setStatusChangePkg(null);
    } catch (err) {
      notifyError('Le statut n’a pas été modifié. Vérifiez les conditions de cette action puis réessayez.');
    }
    setIsChangingStatus(false);
  };

  // Transitions autorisées par statut (pour l'admin)
  const getAllowedTransitions = (status: PackageStatus): { status: PackageStatus; label: string; color: string }[] => {
    const transitions: Record<string, { status: PackageStatus; label: string; color: string }[]> = {
      [PackageStatus.PENDING]: [
        { status: PackageStatus.COLLECTED, label: 'Collecté', color: 'bg-blue-100 text-blue-700' },
        { status: PackageStatus.AT_HUB, label: 'Au hub', color: 'bg-indigo-100 text-indigo-700' },
      ],
      [PackageStatus.COLLECTED]: [
        { status: PackageStatus.AT_HUB, label: 'Au hub', color: 'bg-indigo-100 text-indigo-700' },
        { status: PackageStatus.PENDING, label: '↩ En attente', color: 'bg-slate-100 text-slate-700' },
      ],
      [PackageStatus.AT_HUB]: [
        { status: PackageStatus.SORTED, label: 'Trié', color: 'bg-purple-100 text-purple-700' },
        { status: PackageStatus.PENDING, label: '↩ En attente', color: 'bg-slate-100 text-slate-700' },
      ],
      [PackageStatus.SORTED]: [
        { status: PackageStatus.LOADED, label: 'Chargé', color: 'bg-amber-100 text-amber-700' },
        { status: PackageStatus.AT_HUB, label: '↩ Au hub', color: 'bg-indigo-100 text-indigo-700' },
      ],
      [PackageStatus.LOADED]: [
        { status: PackageStatus.IN_DELIVERY, label: 'En livraison', color: 'bg-orange-100 text-orange-700' },
        { status: PackageStatus.SORTED, label: '↩ Trié', color: 'bg-purple-100 text-purple-700' },
      ],
      [PackageStatus.IN_DELIVERY]: [
        { status: PackageStatus.DELIVERED, label: 'Livré', color: 'bg-green-100 text-green-700' },
        { status: PackageStatus.FAILED, label: 'Échec', color: 'bg-red-100 text-red-700' },
      ],
      [PackageStatus.FAILED]: [
        { status: PackageStatus.PENDING, label: '↩ Remettre en attente', color: 'bg-slate-100 text-slate-700' },
      ],
      [PackageStatus.DELIVERED]: [],
    };
    return transitions[status] || [];
  };

  // ============================================================================
  // MANIPULATION DES STOPS DANS LES TOURNÉES
  // ============================================================================

  const logStopActivity = (mission: Mission, message: string) => {
    void logConfirmedActivity(currentUser, ActivityAction.MISSION_UPDATED, { targetType: 'mission', targetId: mission.id, targetName: `Tournée ${mission.zone}`, details: { changes: [message] } }).catch(() => notifyInfo('La modification est enregistrée, mais son journal est momentanément indisponible.'));
  };
  const handleMoveStop = async (mission: Mission, stop: MissionStop, offset: number) => {
    if (stopMutationLock.current) return;
    const ids = [...mission.stops].sort((a, b) => a.sequence - b.sequence).map(item => item.id);
    const index = ids.indexOf(stop.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    stopMutationLock.current = true; setIsSavingPkg(true);
    try {
      await reorderMissionStops(mission.id, ids);
      logStopActivity(mission, `Arrêt ${stop.contactName} déplacé`);
      notifySuccess('Ordre des arrêts enregistré.');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Impossible de déplacer cet arrêt. Réessayez après actualisation de la tournée.');
    } finally { stopMutationLock.current = false; setIsSavingPkg(false); }
  };
  const handleMoveStopUp = (mission: Mission, stop: MissionStop) => handleMoveStop(mission, stop, -1);
  const handleMoveStopDown = (mission: Mission, stop: MissionStop) => handleMoveStop(mission, stop, 1);

  const handleDeleteStop = async () => {
    if (!deletingStop || stopMutationLock.current) return;
    const { mission, stop } = deletingStop;
    stopMutationLock.current = true; setIsSavingPkg(true); setStopSaveError('');
    try {
      const result = await removeMissionStop(mission.id, stop.id, currentUser);
      logStopActivity(mission, `Arrêt ${stop.contactName} supprimé`);
      notifySuccess(`Arrêt supprimé. ${result.returnedPackages} colis à retourner au hub.`);
      setDeletingStop(null);
    } catch (error) {
      setStopSaveError(error instanceof Error ? error.message : 'Suppression impossible. La tournée a pu évoluer ; vérifiez son état puis réessayez.');
    } finally { stopMutationLock.current = false; setIsSavingPkg(false); }
  };

  const handleSaveEditStop = async () => {
    if (!editingStop || stopMutationLock.current) return;
    const errors = validateStopForm(editStopForm); setStopErrors(errors); setStopSaveError('');
    if (Object.keys(errors).length) return;
    const { mission, stop } = editingStop;
    stopMutationLock.current = true; setIsSavingPkg(true);
    try {
      await updateMissionStopFields(mission.id, stop.id, stopFormPayload(editStopForm));
      logStopActivity(mission, `Arrêt ${stop.contactName} modifié`);
      notifySuccess('Les modifications de l’arrêt sont enregistrées.');
      setEditingStop(null);
    } catch (error) {
      setStopSaveError(`Enregistrement impossible. Votre saisie est conservée ; réessayez. ${error instanceof Error ? error.message : ''}`);
    } finally { stopMutationLock.current = false; setIsSavingPkg(false); }
  };

  const openNewStop = (mission: Mission) => {
    if (pendingStop && pendingStop.missionId !== mission.id) { notifyInfo('Une demande d’arrêt reste à confirmer sur une autre tournée. Utilisez « Reprendre la demande » avant d’en créer une autre.'); return; }
    setNewStopForm(pendingStop?.form || createStopForm());
    newStopRequestId.current = pendingStop?.requestId || crypto.randomUUID();
    setStopErrors({}); setStopSaveError(''); setAddingStopToMission(mission);
  };
  const resumePendingStop = async () => {
    if (!pendingStop) return;
    try {
      const mission = await getMissionById(pendingStop.missionId);
      if (!mission) { notifyError('La tournée de cette demande est inaccessible. Contactez l’exploitation pour vérifier son état.'); return; }
      openNewStop(mission);
    } catch { notifyError('Impossible de retrouver cette tournée. Votre demande est conservée dans ce navigateur.'); }
  };

  const handleAddNewStop = async () => {
    if (!addingStopToMission || stopMutationLock.current) return;
    // A frozen request may originate from the driver flow, where the postal
    // code is optional. Replay its original contract and payload unchanged.
    const replay = pendingStop?.requestId === newStopRequestId.current && pendingStop.missionId === addingStopToMission.id ? pendingStop : null;
    const errors = replay ? {} : validateStopForm(newStopForm); setStopErrors(errors); setStopSaveError('');
    if (Object.keys(errors).length) return;
    const mission = addingStopToMission;
    const request: PendingManualStop = replay || { missionId: mission.id, date: mission.date, requestId: newStopRequestId.current, form: { ...newStopForm } };
    stopMutationLock.current = true; setIsSavingPkg(true);
    let reserved = false;
    try {
      const journal = await reservePendingManualStop(localStorage, currentUser.id, request);
      reserved = true; setPendingStop(journal);
      const payload = stopFormPayload(journal.form);
      await addManualStopToMission(mission.id, { ...payload, contactPhone: payload.contactPhone || undefined, timeWindowStart: payload.timeWindowStart || undefined, timeWindowEnd: payload.timeWindowEnd || undefined, notes: payload.notes || undefined }, journal.requestId);
      logStopActivity(mission, `Arrêt ajouté : ${payload.contactName}`);
      notifySuccess('L’arrêt est confirmé dans la tournée.');
      try { await clearPendingManualStop(localStorage, currentUser.id, journal.requestId); setPendingStop(readPendingManualStop(localStorage, currentUser.id)); }
      catch { notifyInfo('L’arrêt est confirmé. Sa référence de reprise reste conservée dans ce navigateur ; une nouvelle vérification ne créera pas de doublon.'); }
      setAddingStopToMission(null); setNewStopForm(createStopForm());
    } catch (error) {
      setStopSaveError(`${reserved ? 'Ajout impossible. Votre saisie est conservée ; réessayez.' : 'Demande non envoyée. Le navigateur doit pouvoir conserver sa référence avant tout ajout.'} ${error instanceof Error ? error.message : ''}`);
    } finally { stopMutationLock.current = false; setIsSavingPkg(false); }
  };

  // Render Packages
  const renderPackages = () => (
    <div className="space-y-6">
      {/* Bascule suivi global / jour sélectionné */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-slate-500">
          {colisAllDates
            ? <>Suivi global — <b>{colisView.length}</b> colis (toutes dates)</>
            : <>Colis du <b>{new Date(selectedDate).toLocaleDateString('fr-FR')}</b> — <b>{colisView.length}</b></>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleResyncStatuses}
            disabled={isResyncing}
            title="Vérifie les statuts et les rétablit uniquement à partir d’une preuve de remise existante"
            className="ui-button ui-button-secondary text-sm border flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={16} className={isResyncing ? 'animate-spin' : ''} />
            {isResyncing ? 'Resync…' : 'Resynchroniser les statuts'}
          </button>
          <button
            onClick={() => setColisAllDates(v => !v)} aria-pressed={colisAllDates}
            className="ui-filter"
          >
            <Calendar size={18} />{colisAllDates ? 'Toutes les dates' : 'Date sélectionnée'}
          </button>
        </div>
      </div>

      {/* Stats colis — cartes cliquables pour filtrer la liste par statut */}
      <div className="flex flex-wrap gap-2">
        {([
          { status: 'all' as const, label: 'Tous', bg: 'bg-slate-100', text: 'text-slate-700' },
          { status: PackageStatus.PENDING, label: 'En attente' },
          { status: PackageStatus.AT_HUB, label: 'Au hub' },
          { status: PackageStatus.SORTED, label: 'Triés' },
          { status: PackageStatus.IN_DELIVERY, label: 'En livraison' },
          { status: PackageStatus.DELIVERED, label: 'Livrés' },
          { status: PackageStatus.FAILED, label: 'Échecs' }
        ] as { status: PackageStatus | 'all'; label: string; bg?: string; text?: string }[]).map(({ status, label, bg, text }) => {
          const count = status === 'all'
            ? colisView.length
            : colisView.filter(p => p.status === status).length;
          const colors = status === 'all'
            ? { bg: bg!, text: text! }
            : PACKAGE_STATUS_COLORS[status];
          const isActive = pkgStatusFilter === status;

          return (
            <button
              key={status}
              onClick={() => setPkgStatusFilter(prev => prev === status ? 'all' : status)}
              aria-pressed={isActive} className="ui-filter"
            >
              <span>{label}</span><span className="font-semibold tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Bandeau filtre actif */}
      {pkgStatusFilter !== 'all' && (
        <div className="flex items-center gap-2 text-sm bg-brand-50 border border-brand-200 rounded-xl px-4 py-2">
          <span className="text-brand-700 font-semibold">
            Filtre : {pkgStatusFilter === 'failed' ? 'Échecs + retours' : pkgStatusFilter}
          </span>
          <button
            onClick={() => setPkgStatusFilter('all')}
            className="ui-button ui-button-secondary ml-auto text-sm hover:underline"
          >
            Effacer le filtre
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700" aria-label="Filtres actifs des colis">
        <span>Zone : {selectedZone === 'all' ? 'toutes' : selectedZone}</span><span>· {colisAllDates ? 'Toutes les dates' : 'Colis actifs et date sélectionnée'}</span>
        {searchTerm && <span className="break-all">· Recherche : {searchTerm}</span>}
        <button type="button" onClick={() => updateUrlParams({ q: null, zone: null, status: null, scope: null, sort: null, dir: null, page: null, package: null, edit: null })} className="ui-button ui-button-secondary min-h-11 border">Réinitialiser la vue</button>
      </div>
      {/* Recherche */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          aria-label="Rechercher dans les colis affichés" placeholder="Rechercher par n° colis, n° commande, destinataire, adresse..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
        />
      </div>

      {/* Actions de masse pour sélection */}
      <nav aria-label="Pagination des colis" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <div>
          <p aria-live="polite">{filteredPackages.length ? packagePageStart + 1 : 0}–{Math.min(packagePageStart + packagePageSize, filteredPackages.length)} sur <strong>{filteredPackages.length}</strong> colis filtrés</p>
          <p className="text-sm text-slate-500">La case d’en-tête sélectionne les colis disponibles de cette page. La sélection est conservée entre les pages.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="package-page-size">Par page</label>
          <select id="package-page-size" value={packagePageSizeParam} onChange={event => updateUrlParams({ pageSize: event.target.value === '50' ? null : event.target.value, page: null })} className="rounded-lg border border-slate-300 p-2">
            <option value="50">50</option><option value="100">100</option>
          </select>
          <button type="button" aria-label="Page précédente de colis" disabled={packagePage <= 1} onClick={() => setPackagePage(String(packagePage - 1))} className="ui-button ui-button-secondary border disabled:opacity-40">Précédente</button>
          <span>Page {packagePage} / {packagePageCount}</span>
          <button type="button" aria-label="Page suivante de colis" disabled={packagePage >= packagePageCount} onClick={() => setPackagePage(String(packagePage + 1))} className="ui-button ui-button-secondary border disabled:opacity-40">Suivante</button>
        </div>
      </nav>
      {selectedPackageIds.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-brand-700">
              {selectedPackageIds.size} colis sélectionné{selectedPackageIds.size > 1 ? 's' : ''}, dont {selectedOutsideFilter} hors filtre
              {selectedOtherPages > 0 && ` et ${selectedOtherPages} sur d’autres pages`}
            </span>
            <button
              onClick={() => setSelectedPackageIds(new Set())}
              className="ui-button ui-button-secondary text-sm hover:underline"
            >
              Tout désélectionner
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Bouton Dispatcher */}
            <button
              onClick={() => {
                // Pré-sélectionner le premier hub actif
                const firstHub = hubs.find(h => h.isActive);
                setQuickDispatchHubId(firstHub?.id || '');
                // Mettre à jour l'heure
                const now = new Date();
                const minutes = now.getMinutes();
                const roundedMinutes = Math.ceil(minutes / 15) * 15;
                now.setMinutes(roundedMinutes, 0, 0);
                setQuickDispatchTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
                setShowQuickDispatch(true);
              }}
              className="ui-button ui-button-primary min-h-11 flex items-center gap-1.5 text-sm"
            >
              <Zap size={14} />
              Affecter
            </button>

            <div className="w-px h-5 bg-slate-300 mx-1" />

            <span className="text-sm text-slate-500">Statut :</span>
            {[
              { status: PackageStatus.PENDING, label: 'En attente', color: 'bg-slate-100 text-slate-700' },
              { status: PackageStatus.AT_HUB, label: 'Au hub', color: 'bg-indigo-100 text-indigo-700' },
              { status: PackageStatus.SORTED, label: 'Trié', color: 'bg-purple-100 text-purple-700' },
            ].map(({ status, label, color }) => (
              <button
                key={status}
                disabled={isChangingStatus}
                onClick={async () => {
                  const actionIds = [...selectedPackageIds];
                  const summary = actionIds.map(id => {
                    const pkg = packages.find(item => item.id === id);
                    return `${pkg?.orderNumber || pkg?.externalId || id} — ${pkg?.contactName || 'colis hors liste'}`;
                  }).join('\n');
                  if (!await confirmAction({ title: `Modifier ${actionIds.length} colis`, message: `${selectedOutsideFilter} colis sont hors filtre. Tous les colis ci-dessous passeront vers « ${label} ».\n\n${summary}`, confirmLabel: 'Confirmer la modification', cancelLabel: 'Revoir la sélection' })) return;
                  setIsChangingStatus(true);
                  const failedIds: string[] = [];
                  for (const pkgId of actionIds) {
                    try {
                      await updatePackageStatus(pkgId, status, {
                        action: 'MANUAL_STATUS_CHANGE',
                        driverId: currentUser.id,
                        driverName: `${currentUser.firstName} ${currentUser.lastName}`,
                        notes: `Changement groupé → ${label}`
                      });
                    } catch (e) { failedIds.push(pkgId); console.warn('Erreur:', pkgId, e); }
                  }
                  setSelectedPackageIds(new Set(failedIds));
                  if (failedIds.length) notifyError(`${failedIds.length} colis n’ont pas été modifiés et restent sélectionnés. Consultez leur statut puis réessayez.`);
                  if (actionIds.length > failedIds.length) notifySuccess(`${actionIds.length - failedIds.length} colis modifiés.`);
                  setIsChangingStatus(false);
                }}
                className={`ui-button ui-button-secondary text-sm ${color} hover:opacity-80 disabled:opacity-50 `}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Liste des colis */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="ui-table w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-2 py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Sélectionner les colis disponibles affichés"
                    checked={selectableVisibleIds.length > 0 && selectableVisibleIds.every(id => selectedPackageIds.has(id))}
                    onChange={event => setSelectedPackageIds(previous => {
                      const next = new Set(previous);
                      selectableVisibleIds.forEach(id => event.target.checked ? next.add(id) : next.delete(id));
                      return next;
                    })}
                    className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                  />
                </th>
                {(() => {
                  const SortTh = ({ label, k, align = 'left' }: { label: string; k: PkgSortKey; align?: 'left' | 'center' }) => (
                    <th
                      aria-sort={pkgSort.key === k ? (pkgSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`px-3 py-3 text-${align} text-sm font-bold text-slate-500 uppercase cursor-pointer select-none hover:text-slate-700`}
                    >
                      <button type="button" onClick={() => togglePkgSort(k)} className="ui-button ui-button-secondary min-h-11 text-inherit uppercase" aria-label={`Trier par ${label}`}>{label}{pkgSort.key === k ? (pkgSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
                    </th>
                  );
                  return (
                    <>
                      <SortTh label="N° Commande" k="orderNumber" />
                      <SortTh label="Destinataire" k="contactName" />
                      <th className="px-3 py-3 text-left text-sm font-bold text-slate-500 uppercase">Adresse</th>
                      <SortTh label="Zone" k="zone" align="center" />
                      <th className="px-2 py-3 text-center text-sm font-bold text-slate-500 uppercase">Créneau début</th>
                      <th className="px-2 py-3 text-center text-sm font-bold text-slate-500 uppercase">Créneau fin</th>
                      <SortTh label="Statut" k="status" align="center" />
                      <SortTh label="Importé le" k="createdAt" align="center" />
                      <th className="px-3 py-3 text-center text-sm font-bold text-slate-500 uppercase">Affecté à</th>
                      <th className="px-2 py-3 text-center text-sm font-bold text-slate-500 uppercase">Actions</th>
                      <th className="px-2 py-3 text-center text-sm font-bold text-slate-500 uppercase">Gérer</th>
                    </>
                  );
                })()}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPackages.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    {pkgStatusFilter === 'all'
                      ? 'Aucun colis ne correspond à cette vue'
                      : 'Aucun colis pour ce filtre'}
                  </td>
                </tr>
              ) : (
                visiblePackages
                  .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    const isSelected = selectedPackageIds.has(pkg.id);
                    const isDispatched = !!(pkg.missionId || pkg.currentDriverId);

                    const isTimelineOpen = expandedPkgTimelineId === pkg.id;
                    return (
                      <React.Fragment key={pkg.id}>
                      <tr id={`package-${pkg.id}`}
                        className={`transition-colors ${
                          isDispatched
                            ? 'bg-slate-100 opacity-60 cursor-not-allowed'
                            : isSelected
                              ? 'bg-brand-50 hover:bg-slate-50'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDispatched}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedPackageIds(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.add(pkg.id);
                                } else {
                                  next.delete(pkg.id);
                                }
                                return next;
                              });
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                          />
                        </td>
                        {/* N° commande + N° colis client */}
                        <td className="px-3 py-2">
                          <span className="font-mono font-medium text-slate-800 text-sm">
                            {pkg.orderNumber}
                          </span>
                          {pkg.externalId && (
                            <p className="font-mono text-sm text-slate-400">{pkg.externalId}</p>
                          )}
                        </td>
                        {/* Destinataire */}
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800 text-sm">{pkg.contactName}</p>
                          {pkg.contactPhone && (
                            <p className="text-sm text-slate-500">{pkg.contactPhone}</p>
                          )}
                        </td>
                        {/* Adresse */}
                        <td className="px-3 py-2">
                          <p className="text-sm text-slate-700">{pkg.address}</p>
                          <a href={`/missions?tab=packages&package=${encodeURIComponent(pkg.id)}`} className="text-sm text-blue-700 underline">Lien vers ce colis</a>
                          <p className="text-sm text-slate-500">{pkg.postalCode} {pkg.city}</p>
                        </td>
                        {/* Zone */}
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-1 rounded-lg text-sm font-bold ${zoneColors.bg} ${zoneColors.text}`}>
                            {pkg.zone}
                          </span>
                        </td>
                        {/* Créneau début - modifiable inline */}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="time"
                            aria-label={`Début du créneau de ${pkg.contactName}`} value={pkg.timeWindowStart || ''}
                            onChange={async (e) => {
                              e.stopPropagation();
                              try {
                                await updatePackageFields(pkg.id, { timeWindowStart: e.target.value || undefined });
                              } catch (err) {
                                notifyError('Le créneau n’a pas été enregistré. Réessayez dans la fiche du colis.');
                              }
                            }}
                            className="min-h-11 w-32 px-2 py-2 border border-slate-300 rounded-lg text-base text-center focus:ring-2 focus:ring-brand-700 outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        {/* Créneau fin - modifiable inline */}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="time"
                            aria-label={`Fin du créneau de ${pkg.contactName}`} value={pkg.timeWindowEnd || ''}
                            onChange={async (e) => {
                              e.stopPropagation();
                              try {
                                await updatePackageFields(pkg.id, { timeWindowEnd: e.target.value || undefined });
                              } catch (err) {
                                notifyError('Le créneau n’a pas été enregistré. Réessayez dans la fiche du colis.');
                              }
                            }}
                            className="min-h-11 w-32 px-2 py-2 border border-slate-300 rounded-lg text-base text-center focus:ring-2 focus:ring-brand-700 outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        {/* Statut */}
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-1 rounded-lg text-sm font-medium ${statusColors.bg} ${statusColors.text}`}>
                            {packageStatusLabel(pkg.status)}
                          </span>
                          {isDispatched && (
                            <span className="ml-1 px-2 py-0.5 rounded-lg text-sm font-bold bg-blue-100 text-blue-700">
                              En tournée
                            </span>
                          )}
                        </td>
                        {/* Importé le */}
                        <td className="px-3 py-2 text-center text-sm text-slate-500 whitespace-nowrap">
                          {pkg.createdAt ? (
                            <>
                              {new Date(pkg.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                              <span className="block text-sm text-slate-400">
                                {new Date(pkg.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </>
                          ) : '—'}
                        </td>
                        {/* Affecté à */}
                        <td className="px-3 py-2 text-center">
                          {pkg.currentDriverId ? (
                            <span className="text-sm font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">
                              {(() => {
                                const driver = users.find(u => u.id === pkg.currentDriverId);
                                return driver ? `${driver.firstName} ${driver.lastName}` : 'Chauffeur inconnu';
                              })()}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-300">—</span>
                          )}
                        </td>
                        {/* Actions statut */}
                        <td className="px-2 py-2 text-center">
                          {getAllowedTransitions(pkg.status).length > 0 ? (
                            <div className="relative inline-block">
                              {statusChangePkg?.id === pkg.id ? (
                                <div className="flex flex-col gap-1 min-w-[120px]">
                                  {getAllowedTransitions(pkg.status).map(t => (
                                    <button
                                      key={t.status}
                                      disabled={isChangingStatus}
                                      onClick={(e) => { e.stopPropagation(); handleStatusChange(pkg, t.status); }}
                                      className={`ui-button ui-button-secondary text-sm ${t.color} hover:opacity-80 disabled:opacity-50 `}
                                    >
                                      {isChangingStatus ? '...' : t.label}
                                    </button>
                                  ))}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setStatusChangePkg(null); }}
                                    className="ui-button ui-button-secondary text-sm"
                                  >
                                    Annuler
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setStatusChangePkg(pkg); }}
                                  className="ui-button ui-button-secondary text-sm"
                                >
                                  Changer <ChevronDown size={18} />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-slate-300">—</span>
                          )}
                        </td>
                        {/* Gérer (éditer/supprimer) */}
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPkgTimelineId(isTimelineOpen ? null : pkg.id);
                              }}
                              className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center"
                              title={isTimelineOpen ? 'Masquer le suivi' : 'Suivi du colis (timeline)'}
                            >
                              {isTimelineOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditPkgForm({
                                  contactName: pkg.contactName,
                                  contactPhone: pkg.contactPhone || '',
                                  address: pkg.address,
                                  city: pkg.city,
                                  postalCode: pkg.postalCode,
                                  timeWindowStart: pkg.timeWindowStart || '',
                                  timeWindowEnd: pkg.timeWindowEnd || '',
                                  comment: pkg.comment || '',
                                  weight: pkg.weight || '',
                                  volume: pkg.volume || ''
                                });
                                setEditingPkg(pkg);
                              }}
                              className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center"
                              title="Modifier ce colis"
                            >
                              <Edit size={14} />
                            </button>
                            {(pkg.status === PackageStatus.PENDING || pkg.status === PackageStatus.AT_HUB || pkg.status === PackageStatus.COLLECTED || pkg.status === PackageStatus.SORTED) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingPkg(pkg);
                                }}
                                className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center"
                                title="Supprimer ce colis"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Timeline du colis (vue admin : détails internes inclus) */}
                      {isTimelineOpen && (
                        <tr>
                          <td colSpan={12} className="px-8 py-3 bg-slate-50/70 border-t border-slate-100">
                            <p className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-1">
                              Suivi du colis {pkg.externalId || pkg.barcode || pkg.orderNumber}
                            </p>
                            <PackageTimeline movements={pkg.movements || []} showActors showInternalDetails pod={pkg.pod} />
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* === MODAL ÉDITION COLIS === */}
      {editingPkg && (
        <Modal mobileFullscreen isOpen={true} onClose={closePackageEditor} title="Modifier le colis" preventClose={isSavingPkg} size="lg">
          <div>
            <p className="break-all text-sm font-mono text-slate-600">{editingPkg.orderNumber}</p>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="office-field-1" className="text-sm font-medium text-slate-500 block mb-1">Destinataire</label>
                  <input id="office-field-1" disabled={isSavingPkg} type="text" aria-label="Destinataire" value={editPkgForm.contactName || ''} onChange={e => setEditPkgForm(f => ({...f, contactName: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label htmlFor="office-field-2" className="text-sm font-medium text-slate-500 block mb-1">Téléphone</label>
                  <input id="office-field-2" disabled={isSavingPkg} type="text" aria-label="Téléphone du destinataire" value={editPkgForm.contactPhone || ''} onChange={e => setEditPkgForm(f => ({...f, contactPhone: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label htmlFor="office-field-3" className="text-sm font-medium text-slate-500 block mb-1">Adresse</label>
                <input id="office-field-3" disabled={isSavingPkg} type="text" aria-label="Adresse de livraison" value={editPkgForm.address || ''} onChange={e => setEditPkgForm(f => ({...f, address: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="office-field-4" className="text-sm font-medium text-slate-500 block mb-1">Code postal</label>
                  <input id="office-field-4" disabled={isSavingPkg} type="text" aria-label="Code postal" value={editPkgForm.postalCode || ''} onChange={e => setEditPkgForm(f => ({...f, postalCode: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label htmlFor="office-field-5" className="text-sm font-medium text-slate-500 block mb-1">Ville</label>
                  <input id="office-field-5" disabled={isSavingPkg} type="text" aria-label="Ville" value={editPkgForm.city || ''} onChange={e => setEditPkgForm(f => ({...f, city: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="office-field-6" className="text-sm font-medium text-slate-500 block mb-1">Créneau début</label>
                  <input id="office-field-6" disabled={isSavingPkg} type="time" aria-label="Début du créneau demandé" value={editPkgForm.timeWindowStart || ''} onChange={e => setEditPkgForm(f => ({...f, timeWindowStart: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label htmlFor="office-field-7" className="text-sm font-medium text-slate-500 block mb-1">Créneau fin</label>
                  <input id="office-field-7" disabled={isSavingPkg} type="time" aria-label="Fin du créneau demandé" value={editPkgForm.timeWindowEnd || ''} onChange={e => setEditPkgForm(f => ({...f, timeWindowEnd: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="office-field-8" className="text-sm font-medium text-slate-500 block mb-1">Poids (kg)</label>
                  <input id="office-field-8" disabled={isSavingPkg} type="number" step="0.1" aria-label="Poids en kilogrammes" value={editPkgForm.weight || ''} onChange={e => setEditPkgForm(f => ({...f, weight: e.target.value ? parseFloat(e.target.value) : ''}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label htmlFor="office-field-9" className="text-sm font-medium text-slate-500 block mb-1">Volume (m³)</label>
                  <input id="office-field-9" disabled={isSavingPkg} type="number" step="0.01" aria-label="Volume en mètres cubes" value={editPkgForm.volume || ''} onChange={e => setEditPkgForm(f => ({...f, volume: e.target.value ? parseFloat(e.target.value) : ''}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label htmlFor="office-field-10" className="text-sm font-medium text-slate-500 block mb-1">Commentaire</label>
                <textarea id="office-field-10" disabled={isSavingPkg} aria-label="Commentaire" value={editPkgForm.comment || ''} onChange={e => setEditPkgForm(f => ({...f, comment: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none resize-none h-16" />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={closePackageEditor} className="ui-button ui-button-secondary flex-1 border text-sm">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={async () => {
                  setIsSavingPkg(true);
                  try {
                    const fields: Record<string, any> = {};
                    if (editPkgForm.contactName !== editingPkg.contactName) fields.contactName = editPkgForm.contactName;
                    if (editPkgForm.contactPhone !== (editingPkg.contactPhone || '')) fields.contactPhone = editPkgForm.contactPhone || null;
                    if (editPkgForm.address !== editingPkg.address) fields.address = editPkgForm.address;
                    if (editPkgForm.city !== editingPkg.city) fields.city = editPkgForm.city;
                    if (editPkgForm.postalCode !== editingPkg.postalCode) fields.postalCode = editPkgForm.postalCode;
                    if (editPkgForm.timeWindowStart !== (editingPkg.timeWindowStart || '')) fields.timeWindowStart = editPkgForm.timeWindowStart || null;
                    if (editPkgForm.timeWindowEnd !== (editingPkg.timeWindowEnd || '')) fields.timeWindowEnd = editPkgForm.timeWindowEnd || null;
                    if (editPkgForm.comment !== (editingPkg.comment || '')) fields.comment = editPkgForm.comment || null;
                    if (editPkgForm.weight !== (editingPkg.weight || '')) fields.weight = editPkgForm.weight || null;
                    if (editPkgForm.volume !== (editingPkg.volume || '')) fields.volume = editPkgForm.volume || null;

                    if (Object.keys(fields).length > 0) {
                      await updatePackageFields(editingPkg.id, fields);
                      await logConfirmedActivity(currentUser, ActivityAction.ITEM_UPDATED, {
                        targetType: 'package',
                        targetId: editingPkg.id,
                        targetName: editingPkg.orderNumber,
                        details: { changes: Object.keys(fields), before: {}, after: fields }
                      });
                    }
                    setEditingPkg(null);
                  } catch (err) {
                    notifyError('Enregistrement impossible. Votre saisie est conservée ; réessayez.');
                  }
                  setIsSavingPkg(false);
                }}
                className="ui-button ui-button-primary flex-1 text-sm disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* === MODAL SUPPRESSION COLIS === */}
      {deletingPkg && (
        <Modal isOpen onClose={() => setDeletingPkg(null)} title="Supprimer ce colis ?" role="alertdialog" preventClose={isSavingPkg} busy={isSavingPkg} size="sm">
          <div>
            <div className="p-5 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 size={24} className="text-red-600" />
              </div>

              <p className="text-sm text-slate-500 mb-1">
                <span className="font-mono font-bold">{deletingPkg.orderNumber}</span> — {deletingPkg.contactName}
              </p>
              <p className="text-sm text-red-500 font-medium">
                Cette action est irréversible.
              </p>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button disabled={isSavingPkg} onClick={() => setDeletingPkg(null)} className="ui-button ui-button-secondary flex-1 border text-sm">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={async () => {
                  setIsSavingPkg(true);
                  try {
                    await deletePackage(deletingPkg.id);
                    await logConfirmedActivity(currentUser, ActivityAction.ITEM_DELETED, {
                      targetType: 'package',
                      targetId: deletingPkg.id,
                      targetName: deletingPkg.orderNumber,
                      details: { metadata: { contactName: deletingPkg.contactName, address: deletingPkg.address } }
                    });
                    setDeletingPkg(null);
                  } catch (err) {
                    notifyError('Suppression impossible. Le colis est conservé ; réessayez.');
                  }
                  setIsSavingPkg(false);
                }}
                className="ui-button ui-button-danger flex-1 text-sm disabled:opacity-50"
              >
                {isSavingPkg ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
  const renderHubs = () => (
    <div className="space-y-6">
      {/* Header avec bouton Ajouter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Points de concentration</h2>
          <p className="text-sm text-slate-500">
            Gérez vos hubs et les codes postaux associés à chaque zone
          </p>
        </div>
        <button
          onClick={() => openHubModal()}
          className="ui-button ui-button-primary inline-flex items-center gap-2"
        >
          <Plus size={18} />
          Ajouter un hub
        </button>
      </div>

      {/* Liste des hubs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {hubs.length === 0 ? (
          <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-12 text-center">
            <Building2 size={56} className="mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun hub configuré</h3>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">
              Les hubs sont les points de concentration où vos chauffeurs récupèrent et trient les colis avant livraison.
            </p>
            <button
              onClick={() => openHubModal()}
              className="ui-button ui-button-primary inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Créer votre premier hub
            </button>
          </div>
        ) : (
          hubs.map(hub => {
            const colors = ZONE_COLORS[hub.zone];
            const zoneDrivers = users.filter(u => u.role === UserRole.DRIVER && u.zone === hub.zone && !u.isDisabled);

            return (
              <div key={hub.id} className={`bg-white rounded-xl border-2 overflow-hidden transition-all ${hub.isActive ? 'border-slate-200' : 'border-red-200 opacity-60'}`}>
                {/* Header avec zone */}
                <div className={`${colors.bg} px-4 py-3 border-b ${colors.border}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg ${colors.dot} bg-opacity-20 flex items-center justify-center`}>
                        <Building2 size={20} className={colors.text} />
                      </div>
                      <div>
                        <h3 className={`font-bold ${colors.text}`}>{hub.name}</h3>
                        <span className={`text-sm font-medium ${colors.text} opacity-75`}>Zone {hub.zone}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!hub.isActive && (
                        <span className="px-2 py-1 bg-red-500 text-white text-sm font-bold rounded-lg">
                          Inactif
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contenu */}
                <div className="p-4 space-y-4">
                  {/* Adresse */}
                  <div className="flex items-start gap-3">
                    <MapPin size={18} className="text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{hub.address}</p>
                      <p className="text-sm text-slate-500">{hub.postalCode} {hub.city}</p>
                    </div>
                  </div>

                  {/* Téléphone */}
                  {hub.contactPhone && (
                    <div className="flex items-center gap-3">
                      <Phone size={18} className="text-slate-400 shrink-0" />
                      <p className="text-sm text-slate-700">{hub.contactPhone}</p>
                    </div>
                  )}

                  {/* Horaires */}
                  {hub.openingTime && hub.closingTime && (
                    <div className="flex items-center gap-3">
                      <Clock size={18} className="text-slate-400 shrink-0" />
                      <p className="text-sm text-slate-700">{hub.openingTime} - {hub.closingTime}</p>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="flex gap-4 pt-2">
                    <div className="flex-1 bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-slate-800">{zoneDrivers.length}</p>
                      <p className="text-sm text-slate-500">Chauffeurs</p>
                    </div>
                    <div className="flex-1 bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-slate-800">{hub.assignedPostalCodes?.length || 0}</p>
                      <p className="text-sm text-slate-500">Codes postaux</p>
                    </div>
                  </div>

                  {/* Codes postaux (affichage condensé) */}
                  {hub.assignedPostalCodes && hub.assignedPostalCodes.length > 0 && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-sm font-bold text-slate-500 uppercase mb-2">Codes postaux desservis</p>
                      <div className="flex flex-wrap gap-1">
                        {hub.assignedPostalCodes.slice(0, 8).map(cp => (
                          <span key={cp} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-sm rounded">
                            {cp}
                          </span>
                        ))}
                        {hub.assignedPostalCodes.length > 8 && (
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-600 text-sm rounded font-medium">
                            +{hub.assignedPostalCodes.length - 8}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => toggleHubActive(hub)}
                    className="ui-button ui-button-secondary"
                  >
                    {hub.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openHubModal(hub)}
                      className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center"
                      aria-label="Modifier" title="Modifier"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => { setHubError(''); setHubToDelete(hub); }}
                      className="ui-button ui-button-secondary min-h-11 min-w-11 inline-flex items-center justify-center"
                      aria-label="Supprimer" title="Supprimer"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Info codes postaux */}
      {hubs.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-blue-800 text-sm">
            <strong>À savoir :</strong> Les codes postaux déterminent automatiquement la zone de livraison des colis importés.
            Assurez-vous que chaque code postal de La Réunion est assigné à un hub.
          </p>
        </div>
      )}

    </div>
  );

  useEffect(() => {
    if (!packageSearchTask.current || activeTab !== 'packages') return;
    if (sourceStates.packages.status === 'ready') {
      const task = packageSearchTask.current;
      const frame = requestAnimationFrame(() => { task.finish('success', { items: filteredPackages.length }); if (packageSearchTask.current === task) packageSearchTask.current = null; });
      return () => cancelAnimationFrame(frame);
    }
    if (sourceStates.packages.status === 'error') { packageSearchTask.current.finish('error', { errors: 1 }); packageSearchTask.current = null; }
  }, [activeTab, searchTerm, sourceStates.packages.status, filteredPackages.length, packageSearchVersion]);

  const neededSources: SourceKey[] = activeTab === 'missions' ? ['missions'] : activeTab === 'packages' ? ['packages'] : activeTab === 'dispatch' ? ['dispatchable', 'hubs'] : activeTab === 'imports' ? ['imports'] : activeTab === 'hubs' ? ['hubs'] : ['missions', 'packages'];
  const sourceReady = (key: SourceKey) => sourceStates[key].status === 'ready' && (key !== 'missions' || sourceStates[key].scope === selectedDate);
  const contentReady = neededSources.every(sourceReady);
  const visibleSources = activeTab === 'missions' ? [...neededSources, 'packages' as const] : neededSources;

  return (
    <div className="p-3 sm:p-4 md:p-6" data-office-root>
      <PageHeader title="Exploitation des livraisons" className="mb-3" />
      {renderTabs()}
      <details className="mb-3 rounded-xl border border-slate-200 bg-white" open={globalSearchOpen} onToggle={event => setGlobalSearchOpen(event.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-slate-700">Outils et filtres{(activeTab === 'missions' && (missionSearch || selectedZone !== 'all')) || (activeTab === 'packages' && (searchTerm || selectedZone !== 'all' || pkgStatusFilter !== 'all')) ? ' — filtres actifs' : ''}</summary>
        <p className="px-3 pb-2 text-sm font-semibold text-slate-800">Retrouver un colis dans tout l’historique</p>
        <form className="flex flex-wrap items-end gap-2 px-3 pb-3" onSubmit={event => { event.preventDefault(); packageSearchTask.current?.finish('cancelled'); packageSearchTask.current = startUxTask('find_package', currentUser.role); setPackageSearchVersion(value => value + 1); setSelectedPackageIds(new Set()); updateUrlParams({ tab: 'packages', q: globalPackageSearch.trim() || null, scope: null, status: null, zone: null, mission: null, package: null, edit: null, page: null }); setGlobalSearchOpen(false); }}>
          <label className="flex-1 min-w-0 basis-64 text-sm font-medium text-slate-700">Code colis, commande, destinataire ou adresse
            <input type="search" value={globalPackageSearch} onChange={event => setGlobalPackageSearch(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          <button type="submit" className="ui-button ui-button-primary min-h-11">Rechercher</button>
          <a href="/hub-operations" className="min-h-11 inline-flex items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold">Opérations hub</a>
        </form>
        {activeTab === 'missions' && <div className="border-t border-slate-200 pt-3"><h2 className="px-3 pb-2 text-sm font-semibold">Filtrer les tournées</h2>{renderMissionFilters()}</div>}
        {(activeTab === 'missions' || activeTab === 'packages') && <div className="border-t border-slate-200">{renderSavedViews()}</div>}
      </details>
      {activeTab === 'missions' && (missionSearch || selectedZone !== 'all') && <p className="mb-3 break-words text-sm text-slate-700">Filtres actifs : {missionSearch && `« ${missionSearch} »`}{missionSearch && selectedZone !== 'all' ? ' · ' : ''}{selectedZone !== 'all' ? selectedZone : ''}</p>}
      {pendingStopJournalError && <p role="alert" className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{pendingStopJournalError}</p>}
      {pendingStop && <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">Une demande d’arrêt reste à confirmer — tournée du {pendingStop.date}.</p>
        <p>Reprenez la même demande pour vérifier si elle a été enregistrée.</p>
        <button type="button" onClick={resumePendingStop} className="ui-button ui-button-secondary mt-2 min-h-11 border">Reprendre la demande</button>
      </div>}
      {linkError && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">{linkError}</p>}

      {!visibleSources.every(sourceReady) && <div className="mb-4 space-y-3">
        {visibleSources.filter(key => !sourceReady(key)).map(key => <div key={key} role={sourceStates[key].status === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-4 ${sourceStates[key].status === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          {sourceStates[key].status === 'error' ? <>
            <p className="font-semibold">{sourceLabels[key]} : lecture impossible.</p>
            <p className="mt-1 text-sm">Vérifiez votre connexion et vos droits d’accès, puis réessayez. Ce message ne signifie pas que la liste est vide.</p>
            {sourceStates[key].receivedAt && <p className="mt-1 text-sm">Dernière réception : {new Date(sourceStates[key].receivedAt!).toLocaleString('fr-FR')}. Les données ne sont plus à jour.</p>}
            <button type="button" onClick={() => setSourceRetries(previous => ({ ...previous, [key]: previous[key] + 1 }))} className="ui-button ui-button-secondary mt-3 min-h-11 border">Réessayer — {sourceLabels[key]}</button>
          </> : <p className="flex items-center gap-2"><Loader2 size={20} className="animate-spin shrink-0" />Chargement : {sourceLabels[key].toLowerCase()}{key === 'missions' ? ` du ${new Date(`${selectedDate}T12:00:00`).toLocaleDateString('fr-FR')}` : ''}…</p>}
        </div>)}
      </div>}
      {/* Content */}
      {contentReady && activeTab === 'dashboard' && renderDashboard()}
      {contentReady && activeTab === 'dispatch' && canDispatch && (
        <DispatchManager
          packages={dispatchablePackages}
          hubs={hubs}
          users={users}
          vehicles={vehicles}
          currentUser={currentUser}
          selectedDate={selectedDate}
          onMissionCreated={() => setActiveTab('missions')}
        />
      )}
      {contentReady && activeTab === 'imports' && !reviewData && renderImports()}

      {/* === TABLE DE REVUE POST-IMPORT === */}
      {activeTab === 'imports' && canImport && reviewData && selectedClient && users.find(u => u.id === selectedClient) && (
        <ImportReviewTable
          reviewResult={reviewData}
          client={users.find(u => u.id === selectedClient)!}
          currentUser={currentUser}
          onConfirm={(result) => {
            setImportResult(result);
            setReviewData(null);
            setShowImportModal(true);

            // 🔔 Notifier les admins si import réussi
            if (result.success && result.successCount > 0) {
              const client = users.find(u => u.id === selectedClient);
              const adminIds = users
                .filter(u => ['admin', 'super_admin', 'Admin', 'Super Admin', 'Directeur', 'Exploitant']
                  .some(r => u.role?.toLowerCase() === r.toLowerCase()))
                .map(u => u.id)
                .filter(id => id !== currentUser.id); // Pas se notifier soi-même
              if (adminIds.length > 0) {
                notifyImportCompleted(
                  adminIds,
                  client?.companyName || client?.firstName || 'Client',
                  result.successCount,
                  result.batchId || ''
                ).catch(e => console.warn('[Notif] Erreur notif import:', e));
              }
            }
          }}
          onCancel={() => {
            setReviewData(null);
            setImportFile(null);
            setSelectedClient('');
          }}
        />
      )}
      {contentReady && activeTab === 'missions' && renderMissions()}
      {contentReady && activeTab === 'packages' && renderPackages()}
      {contentReady && activeTab === 'hubs' && canManageHubs && renderHubs()}

      {/* Modal Import */}
      <Modal
      mobileFullscreen
        isOpen={showImportModal}
        onClose={closeImportModal}
        preventClose={isImporting}
        busy={isImporting}
        title="Importer un fichier client"
        size="md"
        headerIcon={<Upload size={20} />}
      >
        <div className="space-y-4">
          {/* Sélection client */}
          <div>
            <label htmlFor="office-field-11" className="block text-sm font-bold text-slate-700 mb-1">
              Client expéditeur <span className="text-red-500">*</span>
            </label>
            <select id="office-field-11"
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value="">Sélectionner un client</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.companyName || `${client.firstName} ${client.lastName}`}
                </option>
              ))}
            </select>
          </div>

          {/* Upload fichier */}
          <div>
            <label htmlFor="excel-upload" className="block text-sm font-bold text-slate-700 mb-1">
              Fichier Excel <span className="text-red-500">*</span>
            </label>
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-brand-400 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="excel-upload"
              />
              <label htmlFor="excel-upload" className="cursor-pointer">
                {importFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileSpreadsheet size={32} className="text-green-500" />
                    <div className="text-left">
                      <p className="font-medium text-slate-800">{importFile.name}</p>
                      <p className="text-sm text-slate-500">
                        {(importFile.size / 1024).toFixed(1)} Ko
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="mx-auto text-slate-400 mb-2" />
                    <p className="text-slate-600">Cliquez pour sélectionner un fichier</p>
                    <p className="text-sm text-slate-400">.xlsx ou .xls</p>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Résultat import */}
          {importResult && (
            <div className={`p-4 rounded-xl ${importResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {importResult.success ? (
                <>
                  <p className="font-bold text-green-800 mb-2">
                    Import réussi
                  </p>
                  <p className="text-sm text-green-700">
                    {importResult.successCount} colis importés sur {importResult.totalRows} lignes
                  </p>
                  {importResult.zoneBreakdown && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {importResult.zoneBreakdown.map((zb: any) => (
                        <span
                          key={zb.zone}
                          className={`px-2 py-1 rounded-lg text-sm font-medium ${ZONE_COLORS[zb.zone as Zone].bg} ${ZONE_COLORS[zb.zone as Zone].text}`}
                        >
                          {zb.zone}: {zb.count} colis
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="font-bold text-red-800 mb-2">
                    Erreurs détectées
                  </p>
                  <ul className="text-sm text-red-700 list-disc list-inside">
                    {importResult.errors?.slice(0, 5).map((err: any, i: number) => (
                      <li key={i}>
                        {err.row > 0 ? `Ligne ${err.row}: ` : ''}{err.message}
                      </li>
                    ))}
                    {importResult.errors?.length > 5 && (
                      <li>... et {importResult.errors.length - 5} autres erreurs</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              disabled={isImporting} onClick={closeImportModal}
              className="ui-button ui-button-secondary"
            >
              {importResult?.success ? 'Fermer' : 'Annuler'}
            </button>
            {!importResult?.success && (
              <button
                onClick={handleImport}
                disabled={!importFile || !selectedClient || isImporting}
                className="ui-button ui-button-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isImporting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Import en cours...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Importer
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Modal Hub (Création/Édition) */}
      <Modal
      mobileFullscreen
        isOpen={showHubModal}
        onClose={closeHubModal}
        preventClose={isSavingHub}
        busy={isSavingHub}
        title={editingHub ? `Modifier ${editingHub.name}` : 'Nouveau hub'}
        size="lg"
        headerIcon={<Building2 size={20} />}
      >
        <div className="space-y-5">
          {hubError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{hubError}</p>}
          {/* Nom et Zone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="office-field-12" className="block text-sm font-bold text-slate-700 mb-1">
                Nom du hub <span className="text-red-500">*</span>
              </label>
              <input id="office-field-12" disabled={isSavingHub}
                type="text"
                value={hubForm.name}
                onChange={(e) => handleHubFormChange('name', e.target.value)}
                placeholder="Ex: Hub Nord Saint-Denis"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="office-field-13" className="block text-sm font-bold text-slate-700 mb-1">
                Zone <span className="text-red-500">*</span>
              </label>
              <select id="office-field-13" disabled={isSavingHub}
                value={hubForm.zone}
                onChange={(e) => handleHubFormChange('zone', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white"
              >
                <option value="">Sélectionner une zone</option>
                {Object.values(Zone).map(zone => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Adresse */}
          <div>
            <label htmlFor="office-field-14" className="block text-sm font-bold text-slate-700 mb-1">
              Adresse <span className="text-red-500">*</span>
            </label>
            <input id="office-field-14" disabled={isSavingHub}
              type="text"
              value={hubForm.address}
              onChange={(e) => handleHubFormChange('address', e.target.value)}
              placeholder="Ex: 15 Rue du Commerce, ZI Chaudron"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>

          {/* Ville et Code postal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="office-field-15" className="block text-sm font-bold text-slate-700 mb-1">
                Ville <span className="text-red-500">*</span>
              </label>
              <input id="office-field-15" disabled={isSavingHub}
                type="text"
                value={hubForm.city}
                onChange={(e) => handleHubFormChange('city', e.target.value)}
                placeholder="Ex: Saint-Denis"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="office-field-16" className="block text-sm font-bold text-slate-700 mb-1">
                Code postal <span className="text-red-500">*</span>
              </label>
              <input id="office-field-16" disabled={isSavingHub}
                type="text"
                value={hubForm.postalCode}
                onChange={(e) => handleHubFormChange('postalCode', e.target.value)}
                placeholder="Ex: 97400"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          {/* Téléphone et Horaires */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="office-field-17" className="block text-sm font-bold text-slate-700 mb-1">
                Téléphone
              </label>
              <input id="office-field-17" disabled={isSavingHub}
                type="tel"
                value={hubForm.contactPhone}
                onChange={(e) => handleHubFormChange('contactPhone', e.target.value)}
                placeholder="0262 XX XX XX"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="office-field-18" className="block text-sm font-bold text-slate-700 mb-1">
                Ouverture
              </label>
              <input id="office-field-18" disabled={isSavingHub}
                type="time"
                value={hubForm.openingTime}
                onChange={(e) => handleHubFormChange('openingTime', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="office-field-19" className="block text-sm font-bold text-slate-700 mb-1">
                Fermeture
              </label>
              <input id="office-field-19" disabled={isSavingHub}
                type="time"
                value={hubForm.closingTime}
                onChange={(e) => handleHubFormChange('closingTime', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          {/* Codes postaux assignés */}
          <div>
            <label htmlFor="office-field-20" className="block text-sm font-bold text-slate-700 mb-1">
              Codes postaux desservis
            </label>
            <textarea id="office-field-20" disabled={isSavingHub}
              value={hubForm.assignedPostalCodes}
              onChange={(e) => handleHubFormChange('assignedPostalCodes', e.target.value)}
              placeholder="97400, 97490, 97419..."
              rows={3}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none"
            />
            <p className="text-sm text-slate-500 mt-1">
              Séparez les codes postaux par des virgules. Ces codes déterminent quels colis seront routés vers ce hub.
            </p>
          </div>

          {/* Info auto-fill */}
          {!editingHub && hubForm.zone && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-blue-800 text-sm">
                Les codes postaux par défaut de la zone <strong>{hubForm.zone}</strong> ont été pré-remplis.
                Vous pouvez les modifier selon vos besoins.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              disabled={isSavingHub} onClick={closeHubModal}
              className="ui-button ui-button-secondary"
            >
              Annuler
            </button>
            <button
              onClick={handleSaveHub}
              disabled={!hubForm.name || !hubForm.zone || !hubForm.address || !hubForm.city || !hubForm.postalCode || isSavingHub}
              className="ui-button ui-button-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingHub ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  {editingHub ? 'Mettre à jour' : 'Créer le hub'}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Confirmation Suppression */}
      <Modal
      mobileFullscreen
        isOpen={!!hubToDelete}
        onClose={() => setHubToDelete(null)}
        preventClose={isDeletingHub}
        busy={isDeletingHub}
        role="alertdialog"
        title="Supprimer ce hub ?"
        size="sm"
        headerIcon={<Trash2 size={20} className="text-red-500" />}
      >
        {hubToDelete && (
          <div className="space-y-4">
            {hubError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{hubError}</p>}
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-800">
                Vous êtes sur le point de supprimer le hub <strong>{hubToDelete.name}</strong> (Zone {hubToDelete.zone}).
              </p>
              <p className="text-red-700 text-sm mt-2">
                Cette action est irréversible. Les codes postaux associés ne seront plus rattachés à aucun hub.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                disabled={isDeletingHub} onClick={() => setHubToDelete(null)}
                className="ui-button ui-button-secondary"
              >
                Annuler
              </button>
              <button
                disabled={isDeletingHub}
                onClick={handleDeleteHub}
                className="ui-button ui-button-danger flex items-center gap-2"
              >
                <Trash2 size={18} />
                Supprimer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {editingStop && <Modal mobileFullscreen isOpen onClose={closeStopEditor} title="Modifier l’arrêt" subtitle={`Arrêt ${editingStop.stop.sequence} — ${editingStop.mission.zone}`} size="lg" preventClose={isSavingPkg} busy={isSavingPkg}
        footer={<div className="flex gap-3"><button type="button" disabled={isSavingPkg} onClick={closeStopEditor} className="ui-button ui-button-secondary min-h-11 flex-1 border">Annuler</button><button type="submit" form="edit-mission-stop" disabled={isSavingPkg} className="ui-button ui-button-primary min-h-11 flex-1 disabled:opacity-50">{isSavingPkg ? 'Enregistrement…' : stopSaveError ? 'Réessayer' : 'Enregistrer'}</button></div>}>
        <form id="edit-mission-stop" noValidate onSubmit={event => { event.preventDefault(); void handleSaveEditStop(); }} className="space-y-4">
          {stopSaveError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{stopSaveError}</p>}
          <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Modifier l’adresse, le créneau ou la durée annule les anciennes estimations. Un nouveau calcul d’itinéraire est nécessaire pour obtenir de nouveaux horaires.</p>
          <MissionStopFields value={editStopForm} onChange={(field, value) => setEditStopForm(previous => ({ ...previous, [field]: value }))} errors={stopErrors} busy={isSavingPkg} />
        </form>
      </Modal>}

      {deletingStop && <Modal isOpen onClose={() => setDeletingStop(null)} role="alertdialog" title="Supprimer cet arrêt ?" size="sm" preventClose={isSavingPkg} busy={isSavingPkg}
        footer={<div className="flex gap-3"><button type="button" disabled={isSavingPkg} onClick={() => setDeletingStop(null)} className="ui-button ui-button-secondary min-h-11 flex-1 border">Annuler</button><button type="button" disabled={isSavingPkg} onClick={handleDeleteStop} className="ui-button ui-button-danger min-h-11 flex-1 disabled:opacity-50">{isSavingPkg ? 'Suppression…' : 'Supprimer'}</button></div>}>
        <div className="space-y-3 text-sm text-slate-700">
          <p className="font-bold text-base">{deletingStop.stop.contactName}</p><p>{deletingStop.stop.address}, {deletingStop.stop.postalCode} {deletingStop.stop.city}</p>
          {deletingStop.stop.packageCount > 0 && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Les colis encore affectés à cet arrêt seront marqués « Retour à remettre ». Le chauffeur devra les remettre au hub. Un colis déjà livré ne peut pas être supprimé par cette action.</p>}
          <p className="rounded-lg bg-blue-50 p-3 text-blue-900">La suppression annule les anciennes estimations. Recalculez l’itinéraire pour obtenir de nouveaux horaires.</p>
          {stopSaveError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">{stopSaveError}</p>}
        </div>
      </Modal>}

      {addingStopToMission && <Modal mobileFullscreen isOpen onClose={closeNewStop} title="Ajouter un arrêt" subtitle={`${addingStopToMission.zone} — ${addingStopToMission.driverName || 'Non affecté'}`} size="lg" preventClose={isSavingPkg} busy={isSavingPkg}
        footer={<div className="flex gap-3"><button type="button" disabled={isSavingPkg} onClick={closeNewStop} className="ui-button ui-button-secondary min-h-11 flex-1 border">Annuler</button><button type="submit" form="add-mission-stop" disabled={isSavingPkg} className="ui-button ui-button-primary min-h-11 flex-1 disabled:opacity-50">{isSavingPkg ? 'Vérification…' : pendingStop?.requestId === newStopRequestId.current ? 'Vérifier cette demande' : 'Ajouter l’arrêt'}</button></div>}>
        <form id="add-mission-stop" noValidate onSubmit={event => { event.preventDefault(); void handleAddNewStop(); }} className="space-y-4">
          {stopSaveError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{stopSaveError}</p>}
          {pendingStop?.requestId === newStopRequestId.current && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Les champs sont verrouillés pour vérifier la demande initiale sans créer un deuxième arrêt. Après confirmation, vous pourrez modifier l’arrêt dans la tournée.</p>}
          <MissionStopFields value={newStopForm} onChange={(field, value) => setNewStopForm(previous => ({ ...previous, [field]: value }))} errors={stopErrors} busy={isSavingPkg || pendingStop?.requestId === newStopRequestId.current} />
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Cet arrêt est ajouté à la fin de la tournée. La commande Réordonner permet ensuite de choisir sa position.</p>
        </form>
      </Modal>}

      {/* POD VIEWER */}
      {viewingPOD && (
        <PODViewer
          pod={viewingPOD.pod}
          onClose={() => setViewingPOD(null)}
          packageInfo={{
            orderNumber: viewingPOD.pkg.orderNumber,
            contactName: viewingPOD.pkg.contactName,
            address: viewingPOD.pkg.address,
            city: `${viewingPOD.pkg.postalCode} ${viewingPOD.pkg.city}`
          }}
          showDriverInfo={true}
        />
      )}

      {/* === MODAL DISPATCH RAPIDE === */}
      {showQuickDispatch && (
        <Modal mobileFullscreen isOpen={showQuickDispatch} onClose={closeQuickDispatch} title="Affecter la sélection" preventClose={isQuickDispatching} size="lg">
          <div>
            <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-brand-500 to-blue-500">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Zap size={20} />
                Affectation de la sélection
              </h3>
              <p className="text-sm text-white/80 mt-1">
                {selectedPackageIds.size} colis sélectionné{selectedPackageIds.size > 1 ? 's' : ''}, dont {selectedOutsideFilter} hors filtre — {selectedDate}
              </p>
            </div>

            <div className="p-4 space-y-4">
              {/* Hub de départ */}
              <div>
                <label htmlFor="office-field-21" className="text-sm font-bold text-slate-700 block mb-1">Hub de départ</label>
                <select id="office-field-21"
                  value={quickDispatchHubId}
                  onChange={(e) => setQuickDispatchHubId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none"
                >
                  <option value="">Sélectionner un hub...</option>
                  {hubs.filter(h => h.isActive).map(hub => (
                    <option key={hub.id} value={hub.id}>
                      {hub.name} — {hub.zone}
                    </option>
                  ))}
                </select>
              </div>

              {/* Chauffeur */}
              <div>
                <label htmlFor="office-field-22" className="text-sm font-bold text-slate-700 block mb-1">Chauffeur</label>
                <select id="office-field-22"
                  value={quickDispatchDriverId}
                  onChange={(e) => setQuickDispatchDriverId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none"
                >
                  <option value="">Sélectionner un chauffeur...</option>
                  {users.filter(u => u.role === UserRole.DRIVER && !u.isDisabled).map(driver => {
                    const vehicle = vehicles.find(v => v.driverId === driver.id || v.assignedDriverId === driver.id);
                    const onLeave = isDriverOnLeave(driver.id, selectedDate);
                    return (
                      <option key={driver.id} value={driver.id} disabled={onLeave}>
                        {driver.firstName} {driver.lastName}
                        {onLeave
                          ? ' — 🌴 en congé (indisponible)'
                          : (vehicle ? ` — ${vehicle.plate}` : ' (sans véhicule)')}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Heure de départ */}
              <div>
                <label htmlFor="office-field-23" className="text-sm font-bold text-slate-700 block mb-1">Heure de départ</label>
                <input id="office-field-23"
                  type="time"
                  value={quickDispatchTime}
                  onChange={(e) => setQuickDispatchTime(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-200 outline-none"
                />
              </div>

              {/* Récapitulatif colis */}
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm font-bold text-slate-600 mb-2">Colis à dispatcher :</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {Array.from(selectedPackageIds).map(pkgId => {
                    const pkg = packages.find(p => p.id === pkgId);
                    if (!pkg) return null;
                    return (
                      <div key={pkgId} className="text-sm text-slate-600 flex items-center gap-2">
                        <span className="font-mono text-slate-400">{pkg.orderNumber}</span>
                        <span>{pkg.contactName}</span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-sm font-bold ${ZONE_COLORS[pkg.zone]?.bg} ${ZONE_COLORS[pkg.zone]?.text}`}>
                          {pkg.zone}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={closeQuickDispatch}
                className="ui-button ui-button-secondary text-sm"
              >
                Annuler
              </button>
              <button
                disabled={!quickDispatchDriverId || !quickDispatchHubId || isQuickDispatching}
                onClick={async () => {
                  if (!quickDispatchDriverId || !quickDispatchHubId || quickDispatchLock.current) return;
                  // Sécurité : refuser un chauffeur en congé validé sur la date
                  if (isDriverOnLeave(quickDispatchDriverId, selectedDate)) {
                    notifyError('Ce chauffeur est en congé validé à cette date. Choisissez un autre chauffeur.');
                    return;
                  }

                  quickDispatchLock.current = true;
                  setIsQuickDispatching(true);
                  const requestKey = JSON.stringify([selectedDate, quickDispatchDriverId, quickDispatchHubId, quickDispatchTime, [...selectedPackageIds].sort()]);
                  try {
                    if (quickDispatchAttempt.current?.key === requestKey) {
                      const result = await dispatchMissionsCF(quickDispatchAttempt.current.request);
                      quickDispatchAttempt.current = null;
                      setShowQuickDispatch(false);
                      setSelectedPackageIds(new Set());
                      setQuickDispatchDriverId('');
                      notifySuccess(`Tournée confirmée avec ${result.packageCount} colis.`);
                      return;
                    }
                    // Récupérer les colis sélectionnés
                    const selectedPkgs = packages.filter(p => selectedPackageIds.has(p.id));
                    if (selectedPkgs.length === 0) {
                      notifyError('Aucun colis sélectionné');
                      setIsQuickDispatching(false);
                      return;
                    }

                    if (selectedPkgs.some(pkg => ![PackageStatus.AT_HUB, PackageStatus.SORTED].includes(pkg.status) || pkg.missionId || pkg.currentDriverId || pkg.stopId)) {
                      notifyError('Tous les colis sélectionnés doivent être au hub ou triés, sans affectation à une tournée. Actualisez la sélection.');
                      return;
                    }
                    // Récupérer le chauffeur et son véhicule
                    const driver = users.find(u => u.id === quickDispatchDriverId);
                    const vehicle = vehicles.find(v => v.driverId === quickDispatchDriverId || v.assignedDriverId === quickDispatchDriverId);
                    const hub = hubs.find(h => h.id === quickDispatchHubId);

                    if (!driver || !hub) {
                      notifyError('Chauffeur ou hub non trouvé');
                      setIsQuickDispatching(false);
                      return;
                    }

                    // Déterminer la zone (prendre celle du premier colis)
                    const zone = selectedPkgs[0].zone;

                    // Préparer le driver/vehicle pour GMPRO
                    const driversVehicles: DriverVehicle[] = [{
                      driver,
                      vehicle
                    }];

                    // Optimiser avec GMPRO
                    const apiKey = getGoogleMapsApiKey();
                    const result = await optimizeMultiVehicle(
                      selectedPkgs,
                      driversVehicles,
                      hub,
                      selectedDate,
                      apiKey,
                      quickDispatchTime
                    );

                    if (!result.success || result.tours.length !== 1 || result.skippedShipments > 0) {
                      notifyError(`Erreur d'optimisation: ${result.error || 'Certains colis n’ont pas pu être planifiés. Vérifiez les adresses et les créneaux avant l’affectation.'}`);
                      setIsQuickDispatching(false);
                      return;
                    }

                    // Créer la mission
                    const tour = result.tours[0];
                    const mission: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'> = {
                      date: selectedDate,
                      zone,
                      hubId: hub.id,
                      hubName: hub.name,
                      type: MissionType.DELIVERY,
                      status: MissionStatus.DISPATCHED,
                      plannedDepartureTime: quickDispatchTime,
                      driverId: driver.id,
                      driverName: `${driver.firstName} ${driver.lastName}`,
                      vehicleId: vehicle?.id || '',
                      vehiclePlate: vehicle?.plate || '',
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

                    const request = { requestId: crypto.randomUUID(), missions: [mission] };
                    quickDispatchAttempt.current = { key: requestKey, request };
                    await dispatchMissionsCF(request);
                    quickDispatchAttempt.current = null;
                    const packageIds = tour.stops.flatMap(s => s.packageIds);

                    // Reset
                    setShowQuickDispatch(false);
                    setSelectedPackageIds(new Set());
                    setQuickDispatchDriverId('');

                    notifySuccess(`Tournée créée avec ${tour.stops.length} arrêts et ${packageIds.length} colis !`);

                  } catch (error) {
                    console.error('Erreur dispatch rapide:', error);
                    notifyError(error instanceof Error ? error.message : 'L’affectation n’a pas pu être confirmée. Réessayez la même demande sans risque de doublon.');
                  } finally {
                    quickDispatchLock.current = false;
                    setIsQuickDispatching(false);
                  }
                }}
                className="ui-button ui-button-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isQuickDispatching ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Affecter {selectedPackageIds.size} colis
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Réordonnancement des stops */}
      {reorderingMission && (
        <StopReorderModal
          recalculationNotice
          isOpen={!!reorderingMission}
          onClose={() => setReorderingMission(null)}
          mission={reorderingMission}
          onSave={handleSaveReorderedStops}
        />
      )}
    </div>
  );
};

export default MissionManager;
