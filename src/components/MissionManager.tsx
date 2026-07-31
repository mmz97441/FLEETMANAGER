/**
 * MISSION MANAGER
 * 
 * Composant principal pour la gestion des missions et tournées
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Mission, MissionStatus, MissionType, MissionStop, StopStatus, Package, PackageStatus,
  ImportBatch, ImportBatchStatus, Hub, Zone, User, UserRole, Vehicle,
  ZONE_COLORS, MISSION_STATUS_COLORS, PACKAGE_STATUS_COLORS
} from '../types';
import {
  subscribeToMissions,
  subscribeToHubs,
  subscribeToPackages,
  subscribeToImportBatches,
  calculateMissionStats,
  getAvailableDriversForZone,
  getDriversWithVehicles,
  addHub,
  updateHub,
  deleteHub,
  updatePackageStatus,
  deletePackage,
  updatePackageFields,
  updateMissionFields,
  DEFAULT_POSTAL_CODE_MAPPINGS,
  MissionStats
} from '../services/missionService';
import { importExcelFile, validateExcelFormat, parseExcelForReview, ReviewResult } from '../services/importService';
import { geocodeAddress, getGoogleMapsApiKey, optimizeMultiVehicle, DriverVehicle } from '../services/gmproService';
import { logActivity } from '../services/activityLogService';
import { notifyImportCompleted, notifyMissionAssigned } from '../services/notificationService';
import { ActivityAction } from '../types';
import { addMission } from '../services/missionService';
import { usePermissions, Permission } from '../usePermissions';
import Modal from './shared/Modal';
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
}

type TabType = 'dashboard' | 'dispatch' | 'imports' | 'missions' | 'packages' | 'hubs';

const MissionManager: React.FC<MissionManagerProps> = ({
  currentUser,
  users,
  vehicles
}) => {
  // États
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [missions, setMissions] = useState<Mission[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Filtres
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedZone, setSelectedZone] = useState<Zone | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMissionId, setExpandedMissionId] = useState<string | null>(null);
  
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
  const [expandedPkgTimelineId, setExpandedPkgTimelineId] = useState<string | null>(null);
  type PkgSortKey = 'orderNumber' | 'externalId' | 'contactName' | 'city' | 'zone' | 'status' | 'createdAt';
  const [pkgSort, setPkgSort] = useState<{ key: PkgSortKey; dir: 'asc' | 'desc' }>({ key: 'createdAt', dir: 'desc' });
  const togglePkgSort = (key: PkgSortKey) =>
    setPkgSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
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
    if (roundedMinutes >= 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    }
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [quickDispatchHubId, setQuickDispatchHubId] = useState<string>('');
  const [isQuickDispatching, setIsQuickDispatching] = useState(false);
  
  // Edit/Delete stops dans tournée (admin)
  const [editingStop, setEditingStop] = useState<{ mission: Mission; stop: MissionStop } | null>(null);
  const [editStopForm, setEditStopForm] = useState<Record<string, any>>({});
  const [deletingStop, setDeletingStop] = useState<{ mission: Mission; stop: MissionStop } | null>(null);
  const [addingStopToMission, setAddingStopToMission] = useState<Mission | null>(null);
  const [newStopForm, setNewStopForm] = useState<Record<string, any>>({});
  
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

  // Charger les données
  useEffect(() => {
    const unsubMissions = subscribeToMissions(setMissions, { date: selectedDate });
    const unsubPackages = subscribeToPackages(setPackages);
    const unsubImports = subscribeToImportBatches(setImportBatches);
    const unsubHubs = subscribeToHubs(setHubs);
    
    setIsLoading(false);
    
    return () => {
      unsubMissions();
      unsubPackages();
      unsubImports();
      unsubHubs();
    };
  }, [selectedDate]);

  // Calcul des stats
  const stats = useMemo(() => calculateMissionStats(missions), [missions]);
  
  // Filtrage des missions
  const filteredMissions = useMemo(() => {
    let result = missions;
    
    if (selectedZone !== 'all') {
      result = result.filter(m => m.zone === selectedZone);
    }
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(m =>
        m.driverName?.toLowerCase().includes(term) ||
        m.vehiclePlate?.toLowerCase().includes(term) ||
        m.hubName.toLowerCase().includes(term)
      );
    }
    
    return result;
  }, [missions, selectedZone, searchTerm]);

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
      p.createdAt.startsWith(selectedDate) ||
      p.updatedAt?.startsWith(selectedDate)
    );
  }, [packages, selectedDate]);

  // Permissions via le hook
  const { hasPermission } = usePermissions();
  const canImport = hasPermission(Permission.MISSIONS_IMPORT);
  const canDispatch = hasPermission(Permission.MISSIONS_DISPATCH);
  const canManageHubs = hasPermission(Permission.HUBS_MANAGE);

  // === IMPRESSION TOURNÉE ===
  // === RÉORDONNANCEMENT DES STOPS ===
  const handleSaveReorderedStops = async (mission: Mission, newStops: MissionStop[]) => {
    try {
      await updateMissionFields(mission.id, { stops: newStops });
      
      // Log de l'activité
      await logActivity({
        userId: currentUser.id,
        userEmail: currentUser.email,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        action: ActivityAction.MISSION_UPDATED,
        targetType: 'mission',
        targetId: mission.id,
        targetName: `Tournée ${mission.driverName || 'Non assigné'}`,
        details: `Ordre des stops modifié manuellement (${newStops.length} stops)`
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
        <td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${stop.sequence}</td>
        <td style="padding:8px;border:1px solid #ddd;">
          <strong>${stop.contactName || '-'}</strong><br/>
          <span style="color:#555;">${stop.address}, ${stop.postalCode} ${stop.city}</span>
          ${stop.floor != null ? `<br/><small>Étage ${stop.floor}${stop.hasElevator ? ' (ascenseur)' : ' (sans asc.)'}</small>` : ''}
        </td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${stop.contactPhone || '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${stop.packageCount}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${stop.timeWindowStart && stop.timeWindowEnd ? `${stop.timeWindowStart} - ${stop.timeWindowEnd}` : '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;font-size:11px;">${stop.notes || ''}</td>
        <td style="padding:8px;border:1px solid #ddd;width:60px;"></td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tournée - ${mission.driverName} - ${mission.date}</title>
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
            <p style="color:#666;">Tournée ${mission.zone} — ${new Date(mission.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
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
            <div class="meta-value">${mission.driverName || 'Non assigné'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Véhicule</div>
            <div class="meta-value">${mission.vehiclePlate || '-'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Hub de départ</div>
            <div class="meta-value">${mission.hubName || '-'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Nombre de stops</div>
            <div class="meta-value">${sortedStops.length}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Total colis</div>
            <div class="meta-value">${mission.totalPackages}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Distance / Durée estimée</div>
            <div class="meta-value">${mission.totalDistance ? Math.round(mission.totalDistance) + ' km' : '-'} / ${mission.estimatedDuration ? Math.round(mission.estimatedDuration) + ' min' : '-'}</div>
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
              <td colspan="6" style="padding:8px;border:1px solid #ddd;">DÉPART — ${mission.hubName}</td>
            </tr>
            ${stopsHtml}
            <tr class="hub-row">
              <td style="padding:8px;border:1px solid #ddd;text-align:center;">🏁</td>
              <td colspan="6" style="padding:8px;border:1px solid #ddd;">RETOUR — ${mission.hubName}</td>
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

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setSelectedClient('');
    setImportResult(null);
    setReviewData(null);
  };

  // === GESTION DES HUBS ===
  
  const openHubModal = (hub?: Hub) => {
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
    setShowHubModal(true);
  };

  const closeHubModal = () => {
    setShowHubModal(false);
    setEditingHub(null);
  };

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
        logActivity(currentUser, ActivityAction.ITEM_UPDATED, {
          targetType: 'mission',
          targetId: editingHub.id,
          targetName: hubData.name,
          details: { metadata: { zone: hubData.zone } }
        });
      } else {
        // Création
        const hubId = await addHub(hubData);
        logActivity(currentUser, ActivityAction.ITEM_CREATED, {
          targetType: 'mission',
          targetId: hubId,
          targetName: hubData.name,
          details: { metadata: { zone: hubData.zone } }
        });
      }
      
      closeHubModal();
    } catch (error) {
      console.error('Erreur sauvegarde hub:', error);
    }
    
    setIsSavingHub(false);
  };

  const handleDeleteHub = async () => {
    if (!hubToDelete) return;
    
    try {
      await deleteHub(hubToDelete.id);
      logActivity(currentUser, ActivityAction.ITEM_DELETED, {
        targetType: 'mission',
        targetId: hubToDelete.id,
        targetName: hubToDelete.name,
        details: { metadata: { zone: hubToDelete.zone } }
      });
      setHubToDelete(null);
    } catch (error) {
      console.error('Erreur suppression hub:', error);
    }
  };

  const toggleHubActive = async (hub: Hub) => {
    try {
      await updateHub({ ...hub, isActive: !hub.isActive });
      logActivity(currentUser, ActivityAction.STATUS_CHANGED, {
        targetType: 'mission',
        targetId: hub.id,
        targetName: hub.name,
        details: { 
          before: { isActive: hub.isActive },
          after: { isActive: !hub.isActive }
        }
      });
    } catch (error) {
      console.error('Erreur toggle hub:', error);
    }
  };

  // Render tabs
  const renderTabs = () => (
    <div className="flex border-b border-slate-200 mb-6 overflow-x-auto">
      {[
        { id: 'dashboard', label: 'Tableau de bord', icon: BarChart3 },
        ...(canDispatch ? [{ id: 'dispatch', label: 'Dispatch', icon: Zap }] : []),
        { id: 'imports', label: 'Imports', icon: Upload },
        { id: 'missions', label: 'Missions', icon: Route },
        { id: 'packages', label: 'Colis', icon: PackageIcon },
        ...(canManageHubs ? [{ id: 'hubs', label: 'Hubs', icon: Building2 }] : [])
      ].map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as TabType)}
          className={`flex items-center gap-2 px-4 py-3 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === tab.id
              ? 'border-brand-500 text-brand-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <tab.icon size={18} />
          {tab.label}
        </button>
      ))}
    </div>
  );

  // Render Dashboard
  const renderDashboard = () => (
    <MissionKPIs
      missions={missions}
      packages={packages}
      users={users}
      selectedDate={selectedDate}
    />
  );

  // Render Imports
  const renderImports = () => (
    <div className="space-y-6">
      {/* Actions */}
      {canImport && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition-colors"
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
              <div key={batch.id} className="p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                      <FileSpreadsheet size={20} className="text-slate-600" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800">{batch.fileName}</p>
                      <p className="text-sm text-slate-500">
                        {batch.clientName} • {new Date(batch.importedAt).toLocaleString('fr-FR')}
                      </p>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-green-600">
                        {batch.successCount} ✓
                      </span>
                      {batch.errorCount > 0 && (
                        <span className="text-sm font-medium text-red-600">
                          {batch.errorCount} ✗
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {batch.totalRows} lignes
                    </p>
                  </div>
                </div>
                
                {/* Répartition par zone */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {batch.zoneBreakdown.map(zb => {
                    const colors = ZONE_COLORS[zb.zone];
                    return (
                      <span
                        key={zb.zone}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${colors.bg} ${colors.text}`}
                      >
                        {zb.zone}: {zb.count}
                        {zb.dispatched && <CheckCircle size={12} />}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Render Missions
  const renderMissions = () => (
    <div className="space-y-6">
      {/* Filtres */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher par chauffeur, véhicule..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
        
        <select
          value={selectedZone}
          onChange={(e) => setSelectedZone(e.target.value as Zone | 'all')}
          className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white font-medium"
        >
          <option value="all">Toutes les zones</option>
          {Object.values(Zone).map(zone => (
            <option key={zone} value={zone}>{zone}</option>
          ))}
        </select>
        
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
        />
      </div>

      {/* Liste des missions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filteredMissions.length === 0 ? (
          <div className="p-8 text-center">
            <Route size={48} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">Aucune mission pour cette date</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredMissions.map(mission => {
              const zoneColors = ZONE_COLORS[mission.zone];
              const statusColors = MISSION_STATUS_COLORS[mission.status];
              const progress = mission.totalPackages > 0
                ? Math.round(((mission.deliveredPackages || 0) / mission.totalPackages) * 100)
                : 0;
              const isExpanded = expandedMissionId === mission.id;
              const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
                
              return (
                <div key={mission.id}>
                  {/* En-tête mission (cliquable) */}
                  <div 
                    className="p-4 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => setExpandedMissionId(isExpanded ? null : mission.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex items-center gap-2 mt-1">
                          {isExpanded 
                            ? <ChevronDown size={18} className="text-brand-500" />
                            : <ChevronRight size={18} className="text-slate-400" />
                          }
                          <div className={`w-3 h-3 rounded-full ${zoneColors.dot}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-bold text-slate-800">
                              {mission.driverName || 'Non assigné'}
                            </p>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
                              {mission.status}
                            </span>
                          </div>
                          <p className="text-sm text-slate-500">
                            {mission.vehiclePlate || 'Pas de véhicule'} • {mission.hubName}
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-sm">
                            <span className="flex items-center gap-1 text-slate-600">
                              <MapPin size={14} />
                              {mission.stops.length} stops
                            </span>
                            <span className="flex items-center gap-1 text-slate-600">
                              <PackageIcon size={14} />
                              {mission.totalPackages} colis
                            </span>
                            {mission.totalDistance != null && (
                              <span className="flex items-center gap-1 text-slate-600">
                                <Navigation size={14} />
                                {Math.round(mission.totalDistance)} km
                              </span>
                            )}
                            {mission.estimatedDuration != null && (
                              <span className="flex items-center gap-1 text-slate-600">
                                <Clock size={14} />
                                {Math.round(mission.estimatedDuration)} min
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePrintMission(mission); }}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                            title="Imprimer la feuille de route"
                          >
                            <Printer size={16} />
                          </button>
                          <p className="text-2xl font-bold text-slate-800">{progress}%</p>
                        </div>
                        <p className="text-xs text-slate-500">
                          {mission.deliveredPackages || 0} livrés
                        </p>
                        {mission.failedPackages > 0 && (
                          <p className="text-xs text-red-500">
                            {mission.failedPackages} échecs
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {/* Barre de progression */}
                    <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Détail de la tournée (expandable) */}
                  {isExpanded && (
                    <div className="bg-slate-50 border-t border-slate-200">
                      {/* Résumé de la tournée */}
                      <div className="px-4 py-3 bg-slate-100 border-b border-slate-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-6 text-sm">
                            <span className="font-semibold text-slate-700">
                              Itinéraire de la tournée
                            </span>
                            {mission.dispatchedAt && (
                              <span className="text-slate-500">
                                Dispatché le {new Date(mission.dispatchedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {mission.dispatchedByName ? ` par ${mission.dispatchedByName}` : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-slate-500">
                            {mission.status === MissionStatus.DISPATCHED && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setNewStopForm({});
                                  setAddingStopToMission(mission);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-green-700 hover:bg-green-100 hover:border-green-300 transition-colors text-xs font-medium"
                                title="Ajouter un nouveau stop"
                              >
                                <Plus size={14} />
                                Ajouter stop
                              </button>
                            )}
                            {(mission.status === MissionStatus.DISPATCHED || mission.status === MissionStatus.IN_PROGRESS) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReorderingMission(mission);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-colors text-xs font-medium"
                                title="Réordonner les stops"
                              >
                                <GripVertical size={14} />
                                Réordonner
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePrintMission(mission); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 hover:border-blue-300 transition-colors text-xs font-medium"
                              title="Imprimer la feuille de route"
                            >
                              <Printer size={14} />
                              Imprimer
                            </button>
                            <span>{sortedStops.filter(s => s.status === 'Terminé').length}/{sortedStops.length} stops terminés</span>
                          </div>
                        </div>
                      </div>

                      {/* Départ Hub */}
                      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-200">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">
                          <Building2 size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-700">🏁 Départ — {mission.hubName}</p>
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
                            <div className="flex items-start gap-3">
                              {/* Numéro du stop */}
                              <div className="flex flex-col items-center">
                                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
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
                                <div className="flex items-center gap-2 mb-0.5">
                                  {stopStatusIcon}
                                  <p className="font-semibold text-slate-800 truncate">
                                    {stop.contactName}
                                  </p>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    stop.status === 'Terminé' ? 'bg-green-100 text-green-700' :
                                    stop.status === 'Échec' ? 'bg-red-100 text-red-700' :
                                    stop.status === 'Passé' ? 'bg-amber-100 text-amber-700' :
                                    stop.status === 'Arrivé' ? 'bg-blue-100 text-blue-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>
                                    {stop.status}
                                  </span>
                                </div>
                                <p className="text-sm text-slate-600">
                                  <MapPin size={12} className="inline mr-1" />
                                  {stop.address}, {stop.postalCode} {stop.city}
                                </p>
                                <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
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
                                  <p className="text-xs text-blue-600 mt-1">
                                    🕐 Créneau: {stop.timeWindowStart} - {stop.timeWindowEnd}
                                  </p>
                                )}
                                {stop.notes && (
                                  <p className="text-xs text-amber-600 mt-1 italic">
                                    📝 {stop.notes}
                                  </p>
                                )}
                                {stop.distanceFromPrevious != null && stop.distanceFromPrevious > 0 && (
                                  <p className="text-xs text-slate-400 mt-1">
                                    ↳ {stop.distanceFromPrevious.toFixed(1)} km depuis le stop précédent 
                                    {stop.durationFromPrevious ? ` (~${Math.round(stop.durationFromPrevious)} min)` : ''}
                                  </p>
                                )}
                                
                                {/* POD Status — pour stops traités */}
                                {stop.status === 'Terminé' && (() => {
                                  // Chercher le colis correspondant pour voir s'il a un POD
                                  const stopPkg = todayPackages.find(p => 
                                    stop.packageIds?.includes(p.id) && p.pod
                                  );
                                  return stopPkg?.pod ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setViewingPOD({ pod: stopPkg.pod!, pkg: stopPkg }); }}
                                      className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-200 transition-colors cursor-pointer"
                                    >
                                      {stopPkg.pod?.signatureUrl ? '✍️' : '📷'}
                                      {stopPkg.pod?.signatureUrl ? 'Signé' : 'Photo'} — Voir la preuve
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-amber-50 text-amber-600 rounded text-[10px] font-medium">
                                      ⚠️ POD manquante
                                    </span>
                                  );
                                })()}
                                {stop.status === 'Échec' && (() => {
                                  const hasFailurePhotos = todayPackages.some(p => 
                                    stop.packageIds?.includes(p.id)
                                  );
                                  return (
                                    <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-medium">
                                      ❌ {stop.completionTime ? new Date(stop.completionTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Échec'}
                                    </span>
                                  );
                                })()}
                              </div>

                              {/* === BOUTONS D'ACTION STOP (admin) === */}
                              {mission.status === MissionStatus.DISPATCHED && (
                                <div className="flex flex-col gap-1 ml-2">
                                  {/* Monter */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStopUp(mission, stop); }}
                                    disabled={isSavingPkg || index === 0}
                                    className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Monter"
                                  >
                                    <ArrowUp size={14} />
                                  </button>
                                  {/* Descendre */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleMoveStopDown(mission, stop); }}
                                    disabled={isSavingPkg || index === sortedStops.length - 1}
                                    className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Descendre"
                                  >
                                    <ArrowDown size={14} />
                                  </button>
                                  {/* Modifier */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditStopForm({
                                        contactName: stop.contactName,
                                        contactPhone: stop.contactPhone || '',
                                        address: stop.address,
                                        city: stop.city,
                                        postalCode: stop.postalCode,
                                        timeWindowStart: stop.timeWindowStart || '',
                                        timeWindowEnd: stop.timeWindowEnd || '',
                                        notes: stop.notes || '',
                                        serviceTime: stop.serviceTime || 5
                                      });
                                      setEditingStop({ mission, stop });
                                    }}
                                    className="p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600"
                                    title="Modifier"
                                  >
                                    <Edit size={14} />
                                  </button>
                                  {/* Supprimer */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setDeletingStop({ mission, stop }); }}
                                    className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600"
                                    title="Supprimer"
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
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">
                          <Building2 size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-700">🏁 Retour — {mission.hubName}</p>
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
      console.error('Erreur changement statut:', err);
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
        { status: PackageStatus.DELIVERED, label: '✅ Livré', color: 'bg-green-100 text-green-700' },
        { status: PackageStatus.FAILED, label: '❌ Échec', color: 'bg-red-100 text-red-700' },
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

  // Déplacer un stop vers le haut (diminuer sa séquence)
  const handleMoveStopUp = async (mission: Mission, stop: MissionStop) => {
    const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
    const currentIndex = sortedStops.findIndex(s => s.id === stop.id);
    if (currentIndex <= 0) return; // Déjà en première position

    setIsSavingPkg(true);
    try {
      // Échanger les séquences
      const prevStop = sortedStops[currentIndex - 1];
      const updatedStops = mission.stops.map(s => {
        if (s.id === stop.id) return { ...s, sequence: prevStop.sequence };
        if (s.id === prevStop.id) return { ...s, sequence: stop.sequence };
        return s;
      });

      await updateMissionFields(mission.id, { stops: updatedStops });
      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} déplacé vers le haut`] }
      });
    } catch (err) {
      console.error('Erreur déplacement stop:', err);
    }
    setIsSavingPkg(false);
  };

  // Déplacer un stop vers le bas (augmenter sa séquence)
  const handleMoveStopDown = async (mission: Mission, stop: MissionStop) => {
    const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
    const currentIndex = sortedStops.findIndex(s => s.id === stop.id);
    if (currentIndex >= sortedStops.length - 1) return; // Déjà en dernière position

    setIsSavingPkg(true);
    try {
      const nextStop = sortedStops[currentIndex + 1];
      const updatedStops = mission.stops.map(s => {
        if (s.id === stop.id) return { ...s, sequence: nextStop.sequence };
        if (s.id === nextStop.id) return { ...s, sequence: stop.sequence };
        return s;
      });

      await updateMissionFields(mission.id, { stops: updatedStops });
      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} déplacé vers le bas`] }
      });
    } catch (err) {
      console.error('Erreur déplacement stop:', err);
    }
    setIsSavingPkg(false);
  };

  // Supprimer un stop de la tournée
  const handleDeleteStop = async () => {
    if (!deletingStop) return;
    const { mission, stop } = deletingStop;

    setIsSavingPkg(true);
    try {
      // Retirer le stop
      const updatedStops = mission.stops
        .filter(s => s.id !== stop.id)
        .map((s, idx) => ({ ...s, sequence: idx + 1 })); // Reséquencer

      // Recalculer les totaux
      const totalPackages = updatedStops.reduce((sum, s) => sum + s.packageCount, 0);

      await updateMissionFields(mission.id, {
        stops: updatedStops,
        totalPackages
      });

      // Marquer les colis comme "À retourner" (le chauffeur doit les ramener au hub)
      for (const pkgId of stop.packageIds) {
        try {
          const pkg = packages.find(p => p.id === pkgId);
          if (pkg && (pkg.status === PackageStatus.SORTED || pkg.status === PackageStatus.LOADED || pkg.status === PackageStatus.IN_DELIVERY)) {
            // Passer en RETURN_REQUESTED + ajouter la raison
            await updatePackageStatus(pkgId, PackageStatus.RETURN_REQUESTED, {
              action: 'STOP_DELETED',
              driverId: currentUser.id,
              driverName: `${currentUser.firstName} ${currentUser.lastName}`,
              notes: `Stop supprimé par ${currentUser.firstName} — À retourner au hub ${mission.hubName}`
            });
            // Ajouter la raison du retour
            await updatePackageFields(pkgId, {
              returnReason: `Stop supprimé de la tournée ${mission.zone} — Retourner au hub ${mission.hubName}`
            });
          }
        } catch (e) { console.warn('Erreur marquage retour colis:', pkgId, e); }
      }

      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} supprimé (${stop.packageCount} colis à retourner)`] }
      });

      setDeletingStop(null);
    } catch (err) {
      console.error('Erreur suppression stop:', err);
    }
    setIsSavingPkg(false);
  };

  // Modifier un stop
  const handleSaveEditStop = async () => {
    if (!editingStop) return;
    const { mission, stop } = editingStop;

    setIsSavingPkg(true);
    try {
      const updatedStops = mission.stops.map(s => {
        if (s.id !== stop.id) return s;
        return {
          ...s,
          contactName: editStopForm.contactName || s.contactName,
          contactPhone: editStopForm.contactPhone || null,
          address: editStopForm.address || s.address,
          city: editStopForm.city || s.city,
          postalCode: editStopForm.postalCode || s.postalCode,
          timeWindowStart: editStopForm.timeWindowStart || null,
          timeWindowEnd: editStopForm.timeWindowEnd || null,
          notes: editStopForm.notes || null,
          serviceTime: parseInt(editStopForm.serviceTime) || s.serviceTime
        };
      });

      await updateMissionFields(mission.id, { stops: updatedStops });

      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} modifié`] }
      });

      setEditingStop(null);
    } catch (err) {
      console.error('Erreur modification stop:', err);
    }
    setIsSavingPkg(false);
  };

  // Ajouter un nouveau stop à une mission existante
  const handleAddNewStop = async () => {
    if (!addingStopToMission) return;
    const mission = addingStopToMission;

    if (!newStopForm.contactName || !newStopForm.address || !newStopForm.city || !newStopForm.postalCode) {
      alert('Veuillez remplir au minimum : destinataire, adresse, ville et code postal');
      return;
    }

    setIsSavingPkg(true);
    try {
      const newStopId = `stop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const maxSequence = Math.max(...mission.stops.map(s => s.sequence), 0);

      const newStop: MissionStop = {
        id: newStopId,
        sequence: maxSequence + 1,
        type: 'DELIVERY',
        address: newStopForm.address,
        city: newStopForm.city,
        postalCode: newStopForm.postalCode,
        contactName: newStopForm.contactName,
        contactPhone: newStopForm.contactPhone || undefined,
        packageIds: [], // Pas de colis associé pour l'instant
        packageCount: 0,
        timeWindowStart: newStopForm.timeWindowStart || undefined,
        timeWindowEnd: newStopForm.timeWindowEnd || undefined,
        serviceTime: parseInt(newStopForm.serviceTime) || 5,
        notes: newStopForm.notes || undefined,
        status: StopStatus.PENDING
      };

      const updatedStops = [...mission.stops, newStop];

      await updateMissionFields(mission.id, { stops: updatedStops });

      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Nouveau stop ajouté: ${newStopForm.contactName}`] }
      });

      setAddingStopToMission(null);
      setNewStopForm({});
    } catch (err) {
      console.error('Erreur ajout stop:', err);
    }
    setIsSavingPkg(false);
  };

  // Render Packages
  const renderPackages = () => (
    <div className="space-y-6">
      {/* Stats colis */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { status: PackageStatus.PENDING, label: 'En attente' },
          { status: PackageStatus.AT_HUB, label: 'Au hub' },
          { status: PackageStatus.SORTED, label: 'Triés' },
          { status: PackageStatus.IN_DELIVERY, label: 'En livraison' },
          { status: PackageStatus.DELIVERED, label: 'Livrés' },
          { status: PackageStatus.FAILED, label: 'Échecs' }
        ].map(({ status, label }) => {
          const count = todayPackages.filter(p => p.status === status).length;
          const colors = PACKAGE_STATUS_COLORS[status];
          
          return (
            <div key={status} className={`${colors.bg} rounded-xl p-4`}>
              <p className={`text-2xl font-bold ${colors.text}`}>{count}</p>
              <p className={`text-sm ${colors.text} opacity-80`}>{label}</p>
            </div>
          );
        })}
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Rechercher par n° colis, n° commande, destinataire, adresse..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
        />
      </div>

      {/* Actions de masse pour sélection */}
      {selectedPackageIds.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-brand-700">
              {selectedPackageIds.size} colis sélectionné{selectedPackageIds.size > 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setSelectedPackageIds(new Set())}
              className="text-xs text-brand-600 hover:underline"
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
                if (roundedMinutes >= 60) {
                  now.setHours(now.getHours() + 1);
                  now.setMinutes(0);
                }
                setQuickDispatchTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
                setShowQuickDispatch(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-brand-500 to-blue-500 text-white hover:from-brand-600 hover:to-blue-600 transition-all shadow-sm"
            >
              <Zap size={14} />
              Dispatcher
            </button>
            
            <div className="w-px h-5 bg-slate-300 mx-1" />
            
            <span className="text-xs text-slate-500">Statut :</span>
            {[
              { status: PackageStatus.PENDING, label: 'En attente', color: 'bg-slate-100 text-slate-700' },
              { status: PackageStatus.AT_HUB, label: 'Au hub', color: 'bg-indigo-100 text-indigo-700' },
              { status: PackageStatus.SORTED, label: 'Trié', color: 'bg-purple-100 text-purple-700' },
            ].map(({ status, label, color }) => (
              <button
                key={status}
                disabled={isChangingStatus}
                onClick={async () => {
                  if (!confirm(`Passer ${selectedPackageIds.size} colis vers "${label}" ?`)) return;
                  setIsChangingStatus(true);
                  for (const pkgId of selectedPackageIds) {
                    try {
                      await updatePackageStatus(pkgId, status, {
                        action: 'MANUAL_STATUS_CHANGE',
                        driverId: currentUser.id,
                        driverName: `${currentUser.firstName} ${currentUser.lastName}`,
                        notes: `Changement groupé → ${label}`
                      });
                    } catch (e) { console.warn('Erreur:', pkgId, e); }
                  }
                  setSelectedPackageIds(new Set());
                  setIsChangingStatus(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${color} hover:opacity-80 transition-opacity disabled:opacity-50`}
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
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-2 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedPackageIds.size > 0 && selectedPackageIds.size === todayPackages.filter(p => {
                      if (!searchTerm) return true;
                      const term = searchTerm.toLowerCase();
                      return p.orderNumber.toLowerCase().includes(term) || p.contactName.toLowerCase().includes(term);
                    }).slice(0, 50).length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const visibleIds = todayPackages
                          .filter(p => {
                            if (!searchTerm) return true;
                            const term = searchTerm.toLowerCase();
                            return p.orderNumber.toLowerCase().includes(term) || (p.externalId || '').toLowerCase().includes(term) || p.contactName.toLowerCase().includes(term);
                          })
                          .slice(0, 50)
                          .map(p => p.id);
                        setSelectedPackageIds(new Set(visibleIds));
                      } else {
                        setSelectedPackageIds(new Set());
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                  />
                </th>
                {(() => {
                  const SortTh = ({ label, k, align = 'left' }: { label: string; k: PkgSortKey; align?: 'left' | 'center' }) => (
                    <th
                      onClick={() => togglePkgSort(k)}
                      className={`px-3 py-3 text-${align} text-xs font-bold text-slate-500 uppercase cursor-pointer select-none hover:text-slate-700`}
                    >
                      {label}{pkgSort.key === k ? (pkgSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  );
                  return (
                    <>
                      <SortTh label="N° Commande" k="orderNumber" />
                      <SortTh label="Destinataire" k="contactName" />
                      <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">Adresse</th>
                      <SortTh label="Zone" k="zone" align="center" />
                      <th className="px-2 py-3 text-center text-xs font-bold text-slate-500 uppercase">Créneau début</th>
                      <th className="px-2 py-3 text-center text-xs font-bold text-slate-500 uppercase">Créneau fin</th>
                      <SortTh label="Statut" k="status" align="center" />
                      <SortTh label="Importé le" k="createdAt" align="center" />
                      <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase">Affecté à</th>
                      <th className="px-2 py-3 text-center text-xs font-bold text-slate-500 uppercase">Actions</th>
                      <th className="px-2 py-3 text-center text-xs font-bold text-slate-500 uppercase">Gérer</th>
                    </>
                  );
                })()}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {todayPackages.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    Aucun colis pour cette date
                  </td>
                </tr>
              ) : (
                todayPackages
                  .filter(p => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      p.orderNumber.toLowerCase().includes(term) ||
                      (p.externalId || '').toLowerCase().includes(term) ||
                      (p.barcode || '').toLowerCase().includes(term) ||
                      p.contactName.toLowerCase().includes(term) ||
                      p.address.toLowerCase().includes(term) ||
                      p.city.toLowerCase().includes(term)
                    );
                  })
                  .sort((a, b) => {
                    const dir = pkgSort.dir === 'asc' ? 1 : -1;
                    const va = pkgSortVal(a, pkgSort.key);
                    const vb = pkgSortVal(b, pkgSort.key);
                    return va < vb ? -dir : va > vb ? dir : 0;
                  })
                  .slice(0, 50)
                  .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    const isSelected = selectedPackageIds.has(pkg.id);
                    const isDispatched = !!(pkg.missionId || pkg.currentDriverId);
                    
                    const isTimelineOpen = expandedPkgTimelineId === pkg.id;
                    return (
                      <React.Fragment key={pkg.id}>
                      <tr
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
                            <p className="font-mono text-[10px] text-slate-400">{pkg.externalId}</p>
                          )}
                        </td>
                        {/* Destinataire */}
                        <td className="px-3 py-2">
                          <p className="font-medium text-slate-800 text-sm">{pkg.contactName}</p>
                          {pkg.contactPhone && (
                            <p className="text-xs text-slate-500">{pkg.contactPhone}</p>
                          )}
                        </td>
                        {/* Adresse */}
                        <td className="px-3 py-2">
                          <p className="text-sm text-slate-700">{pkg.address}</p>
                          <p className="text-xs text-slate-500">{pkg.postalCode} {pkg.city}</p>
                        </td>
                        {/* Zone */}
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${zoneColors.bg} ${zoneColors.text}`}>
                            {pkg.zone}
                          </span>
                        </td>
                        {/* Créneau début - modifiable inline */}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="time"
                            value={pkg.timeWindowStart || ''}
                            onChange={async (e) => {
                              e.stopPropagation();
                              try {
                                await updatePackageFields(pkg.id, { timeWindowStart: e.target.value || undefined });
                              } catch (err) {
                                console.error('Erreur mise à jour créneau:', err);
                              }
                            }}
                            className="w-20 px-1.5 py-1 border border-slate-200 rounded text-xs font-mono text-center focus:ring-2 focus:ring-brand-200 outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        {/* Créneau fin - modifiable inline */}
                        <td className="px-2 py-2 text-center">
                          <input
                            type="time"
                            value={pkg.timeWindowEnd || ''}
                            onChange={async (e) => {
                              e.stopPropagation();
                              try {
                                await updatePackageFields(pkg.id, { timeWindowEnd: e.target.value || undefined });
                              } catch (err) {
                                console.error('Erreur mise à jour créneau:', err);
                              }
                            }}
                            className="w-20 px-1.5 py-1 border border-slate-200 rounded text-xs font-mono text-center focus:ring-2 focus:ring-brand-200 outline-none"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        {/* Statut */}
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-1 rounded-lg text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
                            {pkg.status}
                          </span>
                          {isDispatched && (
                            <span className="ml-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-700">
                              🚚 En mission
                            </span>
                          )}
                        </td>
                        {/* Importé le */}
                        <td className="px-3 py-2 text-center text-xs text-slate-500 whitespace-nowrap">
                          {pkg.createdAt ? (
                            <>
                              {new Date(pkg.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                              <span className="block text-[10px] text-slate-400">
                                {new Date(pkg.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </>
                          ) : '—'}
                        </td>
                        {/* Affecté à */}
                        <td className="px-3 py-2 text-center">
                          {pkg.currentDriverId ? (
                            <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">
                              {(() => {
                                const driver = users.find(u => u.id === pkg.currentDriverId);
                                return driver ? `${driver.firstName} ${driver.lastName}` : 'Chauffeur inconnu';
                              })()}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
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
                                      className={`px-2 py-1 rounded-lg text-xs font-medium ${t.color} hover:opacity-80 transition-opacity disabled:opacity-50`}
                                    >
                                      {isChangingStatus ? '...' : t.label}
                                    </button>
                                  ))}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setStatusChangePkg(null); }}
                                    className="px-2 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100"
                                  >
                                    Annuler
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setStatusChangePkg(pkg); }}
                                  className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                >
                                  Changer ▾
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
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
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
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
                              className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors"
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
                                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
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
                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                              Suivi du colis {pkg.externalId || pkg.barcode || pkg.orderNumber}
                            </p>
                            <PackageTimeline movements={pkg.movements || []} showInternalDetails />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingPkg(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Modifier le colis</h3>
                <p className="text-xs text-slate-500 font-mono">{editingPkg.orderNumber}</p>
              </div>
              <button onClick={() => setEditingPkg(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Destinataire</label>
                  <input type="text" value={editPkgForm.contactName || ''} onChange={e => setEditPkgForm(f => ({...f, contactName: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Téléphone</label>
                  <input type="text" value={editPkgForm.contactPhone || ''} onChange={e => setEditPkgForm(f => ({...f, contactPhone: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Adresse</label>
                <input type="text" value={editPkgForm.address || ''} onChange={e => setEditPkgForm(f => ({...f, address: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Code postal</label>
                  <input type="text" value={editPkgForm.postalCode || ''} onChange={e => setEditPkgForm(f => ({...f, postalCode: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Ville</label>
                  <input type="text" value={editPkgForm.city || ''} onChange={e => setEditPkgForm(f => ({...f, city: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau début</label>
                  <input type="time" value={editPkgForm.timeWindowStart || ''} onChange={e => setEditPkgForm(f => ({...f, timeWindowStart: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau fin</label>
                  <input type="time" value={editPkgForm.timeWindowEnd || ''} onChange={e => setEditPkgForm(f => ({...f, timeWindowEnd: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Poids (kg)</label>
                  <input type="number" step="0.1" value={editPkgForm.weight || ''} onChange={e => setEditPkgForm(f => ({...f, weight: e.target.value ? parseFloat(e.target.value) : ''}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Volume (m³)</label>
                  <input type="number" step="0.01" value={editPkgForm.volume || ''} onChange={e => setEditPkgForm(f => ({...f, volume: e.target.value ? parseFloat(e.target.value) : ''}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Commentaire</label>
                <textarea value={editPkgForm.comment || ''} onChange={e => setEditPkgForm(f => ({...f, comment: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none resize-none h-16" />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setEditingPkg(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
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
                      await logActivity({
                        type: 'PACKAGE_UPDATED',
                        userId: currentUser.id,
                        userName: `${currentUser.firstName} ${currentUser.lastName}`,
                        target: editingPkg.orderNumber,
                        details: { changes: Object.keys(fields), before: {}, after: fields }
                      });
                    }
                    setEditingPkg(null);
                  } catch (err) {
                    console.error('Erreur modification colis:', err);
                  }
                  setIsSavingPkg(false);
                }}
                className="flex-1 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-bold hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL SUPPRESSION COLIS === */}
      {deletingPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeletingPkg(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="p-5 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 size={24} className="text-red-600" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Supprimer ce colis ?</h3>
              <p className="text-sm text-slate-500 mb-1">
                <span className="font-mono font-bold">{deletingPkg.orderNumber}</span> — {deletingPkg.contactName}
              </p>
              <p className="text-xs text-red-500 font-medium">
                Cette action est irréversible.
              </p>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setDeletingPkg(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={async () => {
                  setIsSavingPkg(true);
                  try {
                    await deletePackage(deletingPkg.id);
                    await logActivity({
                      type: 'PACKAGE_DELETED',
                      userId: currentUser.id,
                      userName: `${currentUser.firstName} ${currentUser.lastName}`,
                      target: deletingPkg.orderNumber,
                      details: { metadata: { contactName: deletingPkg.contactName, address: deletingPkg.address } }
                    });
                    setDeletingPkg(null);
                  } catch (err) {
                    console.error('Erreur suppression colis:', err);
                  }
                  setIsSavingPkg(false);
                }}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Suppression...' : '🗑 Supprimer'}
              </button>
            </div>
          </div>
        </div>
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
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition-colors"
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
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition-colors"
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
                        <span className={`text-xs font-medium ${colors.text} opacity-75`}>Zone {hub.zone}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!hub.isActive && (
                        <span className="px-2 py-1 bg-red-500 text-white text-xs font-bold rounded-lg">
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
                      <p className="text-xs text-slate-500">Chauffeurs</p>
                    </div>
                    <div className="flex-1 bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-slate-800">{hub.assignedPostalCodes?.length || 0}</p>
                      <p className="text-xs text-slate-500">Codes postaux</p>
                    </div>
                  </div>
                  
                  {/* Codes postaux (affichage condensé) */}
                  {hub.assignedPostalCodes && hub.assignedPostalCodes.length > 0 && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-xs font-bold text-slate-500 uppercase mb-2">Codes postaux desservis</p>
                      <div className="flex flex-wrap gap-1">
                        {hub.assignedPostalCodes.slice(0, 8).map(cp => (
                          <span key={cp} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                            {cp}
                          </span>
                        ))}
                        {hub.assignedPostalCodes.length > 8 && (
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-600 text-xs rounded font-medium">
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
                    className={`text-sm font-medium ${hub.isActive ? 'text-orange-600 hover:text-orange-700' : 'text-green-600 hover:text-green-700'}`}
                  >
                    {hub.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openHubModal(hub)}
                      className="p-2 text-slate-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                      title="Modifier"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => setHubToDelete(hub)}
                      className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Supprimer"
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
            <strong>💡 Astuce :</strong> Les codes postaux déterminent automatiquement la zone de livraison des colis importés. 
            Assurez-vous que chaque code postal de La Réunion est assigné à un hub.
          </p>
        </div>
      )}

      {/* Modal création/édition hub */}
      <Modal
        isOpen={showHubModal}
        onClose={closeHubModal}
        title={editingHub ? `Modifier ${editingHub.name}` : 'Nouveau hub'}
        size="lg"
        headerIcon={<Building2 size={20} />}
      >
        <div className="space-y-5">
          {/* Nom et Zone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Nom du hub <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={hubForm.name}
                onChange={(e) => handleHubFormChange('name', e.target.value)}
                placeholder="Ex: Dépôt Nord Saint-Denis"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Zone <span className="text-red-500">*</span>
              </label>
              <select
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
            <label className="block text-sm font-bold text-slate-700 mb-1.5">
              Adresse complète <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={hubForm.address}
              onChange={(e) => handleHubFormChange('address', e.target.value)}
              placeholder="Ex: 15 rue du Commerce, ZI Cambaie"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>

          {/* Ville et Code postal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Ville <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={hubForm.city}
                onChange={(e) => handleHubFormChange('city', e.target.value)}
                placeholder="Ex: Saint-Denis"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Code postal <span className="text-red-500">*</span>
              </label>
              <input
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
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Téléphone
              </label>
              <input
                type="tel"
                value={hubForm.contactPhone}
                onChange={(e) => handleHubFormChange('contactPhone', e.target.value)}
                placeholder="0262 XX XX XX"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Ouverture
              </label>
              <input
                type="time"
                value={hubForm.openingTime}
                onChange={(e) => handleHubFormChange('openingTime', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                Fermeture
              </label>
              <input
                type="time"
                value={hubForm.closingTime}
                onChange={(e) => handleHubFormChange('closingTime', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          {/* Codes postaux couverts */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">
              Codes postaux couverts par ce hub
            </label>
            <textarea
              value={hubForm.assignedPostalCodes}
              onChange={(e) => handleHubFormChange('assignedPostalCodes', e.target.value)}
              placeholder="97400, 97490, 97419, 97417 (séparés par des virgules)"
              rows={3}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none font-mono text-sm"
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Lors de l'import des colis, les adresses seront automatiquement rattachées à ce hub selon leur code postal.
            </p>
          </div>

          {/* Boutons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={closeHubModal}
              className="px-5 py-2.5 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSaveHub}
              disabled={isSavingHub || !hubForm.name || !hubForm.zone || !hubForm.address || !hubForm.city || !hubForm.postalCode}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSavingHub ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  {editingHub ? 'Enregistrer les modifications' : 'Créer le hub'}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal confirmation suppression */}
      <Modal
        isOpen={!!hubToDelete}
        onClose={() => setHubToDelete(null)}
        title="Supprimer ce hub ?"
        size="sm"
        headerIcon={<AlertTriangle size={20} className="text-red-500" />}
      >
        <div className="space-y-4">
          <p className="text-slate-600">
            Voulez-vous vraiment supprimer le hub <strong className="text-slate-800">{hubToDelete?.name}</strong> ?
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-sm text-amber-800">
              ⚠️ Cette action est irréversible. Les {hubToDelete?.assignedPostalCodes?.length || 0} codes postaux associés ne seront plus rattachés à aucun hub.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setHubToDelete(null)}
              className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleDeleteHub}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
            >
              <Trash2 size={16} />
              Supprimer définitivement
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={48} className="animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Route className="text-brand-500" />
            Gestion des Missions
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Import, dispatch et suivi des tournées de livraison
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
      </div>

      {/* Tabs */}
      {renderTabs()}

      {/* Content */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'dispatch' && (
        <DispatchManager
          packages={packages}
          hubs={hubs}
          users={users}
          vehicles={vehicles}
          currentUser={currentUser}
          selectedDate={selectedDate}
          onMissionCreated={() => setActiveTab('missions')}
        />
      )}
      {activeTab === 'imports' && !reviewData && renderImports()}

      {/* === TABLE DE REVUE POST-IMPORT === */}
      {activeTab === 'imports' && reviewData && selectedClient && users.find(u => u.id === selectedClient) && (
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
      {activeTab === 'missions' && renderMissions()}
      {activeTab === 'packages' && renderPackages()}
      {activeTab === 'hubs' && renderHubs()}

      {/* Modal Import */}
      <Modal
        isOpen={showImportModal}
        onClose={closeImportModal}
        title="Importer un fichier client"
        size="md"
        headerIcon={<Upload size={20} />}
      >
        <div className="space-y-4">
          {/* Sélection client */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">
              Client expéditeur <span className="text-red-500">*</span>
            </label>
            <select
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
            <label className="block text-sm font-bold text-slate-700 mb-1">
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
                    ✅ Import réussi !
                  </p>
                  <p className="text-sm text-green-700">
                    {importResult.successCount} colis importés sur {importResult.totalRows} lignes
                  </p>
                  {importResult.zoneBreakdown && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {importResult.zoneBreakdown.map((zb: any) => (
                        <span 
                          key={zb.zone}
                          className={`px-2 py-1 rounded-lg text-xs font-medium ${ZONE_COLORS[zb.zone as Zone].bg} ${ZONE_COLORS[zb.zone as Zone].text}`}
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
                    ❌ Erreurs détectées
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
              onClick={closeImportModal}
              className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
            >
              {importResult?.success ? 'Fermer' : 'Annuler'}
            </button>
            {!importResult?.success && (
              <button
                onClick={handleImport}
                disabled={!importFile || !selectedClient || isImporting}
                className="flex items-center gap-2 px-6 py-2 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        isOpen={showHubModal}
        onClose={closeHubModal}
        title={editingHub ? `Modifier ${editingHub.name}` : 'Nouveau hub'}
        size="lg"
        headerIcon={<Building2 size={20} />}
      >
        <div className="space-y-5">
          {/* Nom et Zone */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Nom du hub <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={hubForm.name}
                onChange={(e) => handleHubFormChange('name', e.target.value)}
                placeholder="Ex: Hub Nord Saint-Denis"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Zone <span className="text-red-500">*</span>
              </label>
              <select
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
            <label className="block text-sm font-bold text-slate-700 mb-1">
              Adresse <span className="text-red-500">*</span>
            </label>
            <input
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
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Ville <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={hubForm.city}
                onChange={(e) => handleHubFormChange('city', e.target.value)}
                placeholder="Ex: Saint-Denis"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Code postal <span className="text-red-500">*</span>
              </label>
              <input
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
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Téléphone
              </label>
              <input
                type="tel"
                value={hubForm.contactPhone}
                onChange={(e) => handleHubFormChange('contactPhone', e.target.value)}
                placeholder="0262 XX XX XX"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Ouverture
              </label>
              <input
                type="time"
                value={hubForm.openingTime}
                onChange={(e) => handleHubFormChange('openingTime', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Fermeture
              </label>
              <input
                type="time"
                value={hubForm.closingTime}
                onChange={(e) => handleHubFormChange('closingTime', e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          {/* Codes postaux assignés */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">
              Codes postaux desservis
            </label>
            <textarea
              value={hubForm.assignedPostalCodes}
              onChange={(e) => handleHubFormChange('assignedPostalCodes', e.target.value)}
              placeholder="97400, 97490, 97419..."
              rows={3}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              Séparez les codes postaux par des virgules. Ces codes déterminent quels colis seront routés vers ce hub.
            </p>
          </div>

          {/* Info auto-fill */}
          {!editingHub && hubForm.zone && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-blue-800 text-sm">
                💡 Les codes postaux par défaut de la zone <strong>{hubForm.zone}</strong> ont été pré-remplis. 
                Vous pouvez les modifier selon vos besoins.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={closeHubModal}
              className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSaveHub}
              disabled={!hubForm.name || !hubForm.zone || !hubForm.address || !hubForm.city || !hubForm.postalCode || isSavingHub}
              className="flex items-center gap-2 px-6 py-2 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        isOpen={!!hubToDelete}
        onClose={() => setHubToDelete(null)}
        title="Supprimer ce hub ?"
        size="sm"
        headerIcon={<Trash2 size={20} className="text-red-500" />}
      >
        {hubToDelete && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-red-800">
                Vous êtes sur le point de supprimer le hub <strong>{hubToDelete.name}</strong> (Zone {hubToDelete.zone}).
              </p>
              <p className="text-red-700 text-sm mt-2">
                ⚠️ Cette action est irréversible. Les codes postaux associés ne seront plus rattachés à aucun hub.
              </p>
            </div>
            
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setHubToDelete(null)}
                className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleDeleteHub}
                className="flex items-center gap-2 px-6 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
              >
                <Trash2 size={18} />
                Supprimer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* === MODAL ÉDITION STOP === */}
      {editingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingStop(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Modifier le stop</h3>
                <p className="text-xs text-slate-500">Stop #{editingStop.stop.sequence} — {editingStop.mission.zone}</p>
              </div>
              <button onClick={() => setEditingStop(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Destinataire *</label>
                  <input type="text" value={editStopForm.contactName || ''} onChange={e => setEditStopForm(f => ({...f, contactName: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Téléphone</label>
                  <input type="text" value={editStopForm.contactPhone || ''} onChange={e => setEditStopForm(f => ({...f, contactPhone: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Adresse *</label>
                <input type="text" value={editStopForm.address || ''} onChange={e => setEditStopForm(f => ({...f, address: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Code postal *</label>
                  <input type="text" value={editStopForm.postalCode || ''} onChange={e => setEditStopForm(f => ({...f, postalCode: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Ville *</label>
                  <input type="text" value={editStopForm.city || ''} onChange={e => setEditStopForm(f => ({...f, city: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau début</label>
                  <input type="time" value={editStopForm.timeWindowStart || ''} onChange={e => setEditStopForm(f => ({...f, timeWindowStart: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau fin</label>
                  <input type="time" value={editStopForm.timeWindowEnd || ''} onChange={e => setEditStopForm(f => ({...f, timeWindowEnd: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Temps sur place</label>
                  <input type="number" value={editStopForm.serviceTime || 5} onChange={e => setEditStopForm(f => ({...f, serviceTime: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Notes / Instructions</label>
                <textarea value={editStopForm.notes || ''} onChange={e => setEditStopForm(f => ({...f, notes: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none resize-none h-16" />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setEditingStop(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={handleSaveEditStop}
                className="flex-1 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-bold hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL SUPPRESSION STOP === */}
      {deletingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeletingStop(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="p-5 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 size={24} className="text-red-600" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Supprimer ce stop ?</h3>
              <p className="text-sm text-slate-600 mb-1">
                <span className="font-bold">{deletingStop.stop.contactName}</span>
              </p>
              <p className="text-xs text-slate-500 mb-2">
                {deletingStop.stop.address}, {deletingStop.stop.postalCode} {deletingStop.stop.city}
              </p>
              {deletingStop.stop.packageCount > 0 && (
                <p className="text-xs text-amber-600 font-medium bg-amber-50 rounded-lg p-2">
                  ⚠️ {deletingStop.stop.packageCount} colis seront marqués "À retourner" — Le chauffeur devra les ramener au hub
                </p>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setDeletingStop(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={handleDeleteStop}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Suppression...' : '🗑 Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL AJOUT STOP === */}
      {addingStopToMission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAddingStopToMission(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-green-50">
              <div>
                <h3 className="font-bold text-green-800">Ajouter un stop</h3>
                <p className="text-xs text-green-600">Mission {addingStopToMission.zone} — {addingStopToMission.driverName}</p>
              </div>
              <button onClick={() => setAddingStopToMission(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white">
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Destinataire *</label>
                  <input type="text" value={newStopForm.contactName || ''} onChange={e => setNewStopForm(f => ({...f, contactName: e.target.value}))}
                    placeholder="Nom du destinataire"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Téléphone</label>
                  <input type="text" value={newStopForm.contactPhone || ''} onChange={e => setNewStopForm(f => ({...f, contactPhone: e.target.value}))}
                    placeholder="0692..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Adresse *</label>
                <input type="text" value={newStopForm.address || ''} onChange={e => setNewStopForm(f => ({...f, address: e.target.value}))}
                  placeholder="123 rue Example"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Code postal *</label>
                  <input type="text" value={newStopForm.postalCode || ''} onChange={e => setNewStopForm(f => ({...f, postalCode: e.target.value}))}
                    placeholder="97400"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Ville *</label>
                  <input type="text" value={newStopForm.city || ''} onChange={e => setNewStopForm(f => ({...f, city: e.target.value}))}
                    placeholder="Saint-Denis"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau début</label>
                  <input type="time" value={newStopForm.timeWindowStart || ''} onChange={e => setNewStopForm(f => ({...f, timeWindowStart: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau fin</label>
                  <input type="time" value={newStopForm.timeWindowEnd || ''} onChange={e => setNewStopForm(f => ({...f, timeWindowEnd: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Temps (min)</label>
                  <input type="number" value={newStopForm.serviceTime || 5} onChange={e => setNewStopForm(f => ({...f, serviceTime: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Notes / Instructions</label>
                <textarea value={newStopForm.notes || ''} onChange={e => setNewStopForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Instructions particulières..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none resize-none h-16" />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                <p className="text-xs text-amber-700">
                  💡 Ce stop sera ajouté à la fin de la tournée. Utilisez les flèches ↑↓ pour le repositionner ensuite.
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setAddingStopToMission(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg || !newStopForm.contactName || !newStopForm.address || !newStopForm.city || !newStopForm.postalCode}
                onClick={handleAddNewStop}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Ajout...' : '+ Ajouter le stop'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowQuickDispatch(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-brand-500 to-blue-500">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Zap size={20} />
                Dispatch rapide
              </h3>
              <p className="text-sm text-white/80 mt-1">
                {selectedPackageIds.size} colis sélectionné{selectedPackageIds.size > 1 ? 's' : ''}
              </p>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Hub de départ */}
              <div>
                <label className="text-sm font-bold text-slate-700 block mb-1">Hub de départ</label>
                <select
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
                <label className="text-sm font-bold text-slate-700 block mb-1">Chauffeur</label>
                <select
                  value={quickDispatchDriverId}
                  onChange={(e) => setQuickDispatchDriverId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none"
                >
                  <option value="">Sélectionner un chauffeur...</option>
                  {users.filter(u => u.role === UserRole.DRIVER && u.isActive !== false).map(driver => {
                    const vehicle = vehicles.find(v => v.assignedDriverId === driver.id);
                    return (
                      <option key={driver.id} value={driver.id}>
                        {driver.firstName} {driver.lastName}
                        {vehicle ? ` — ${vehicle.plate}` : ' (sans véhicule)'}
                      </option>
                    );
                  })}
                </select>
              </div>
              
              {/* Heure de départ */}
              <div>
                <label className="text-sm font-bold text-slate-700 block mb-1">Heure de départ</label>
                <input
                  type="time"
                  value={quickDispatchTime}
                  onChange={(e) => setQuickDispatchTime(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-200 outline-none"
                />
              </div>
              
              {/* Récapitulatif colis */}
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-bold text-slate-600 mb-2">Colis à dispatcher :</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {Array.from(selectedPackageIds).map(pkgId => {
                    const pkg = packages.find(p => p.id === pkgId);
                    if (!pkg) return null;
                    return (
                      <div key={pkgId} className="text-xs text-slate-600 flex items-center gap-2">
                        <span className="font-mono text-slate-400">{pkg.orderNumber}</span>
                        <span>{pkg.contactName}</span>
                        <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold ${ZONE_COLORS[pkg.zone]?.bg} ${ZONE_COLORS[pkg.zone]?.text}`}>
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
                onClick={() => setShowQuickDispatch(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                disabled={!quickDispatchDriverId || !quickDispatchHubId || isQuickDispatching}
                onClick={async () => {
                  if (!quickDispatchDriverId || !quickDispatchHubId) return;
                  
                  setIsQuickDispatching(true);
                  
                  try {
                    // Récupérer les colis sélectionnés
                    const selectedPkgs = packages.filter(p => selectedPackageIds.has(p.id));
                    if (selectedPkgs.length === 0) {
                      alert('Aucun colis sélectionné');
                      setIsQuickDispatching(false);
                      return;
                    }
                    
                    // Récupérer le chauffeur et son véhicule
                    const driver = users.find(u => u.id === quickDispatchDriverId);
                    const vehicle = vehicles.find(v => v.assignedDriverId === quickDispatchDriverId);
                    const hub = hubs.find(h => h.id === quickDispatchHubId);
                    
                    if (!driver || !hub) {
                      alert('Chauffeur ou hub non trouvé');
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
                    
                    if (!result.success || result.tours.length === 0) {
                      alert(`Erreur d'optimisation: ${result.error || 'Aucune tournée générée'}`);
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
                    
                    const missionId = await addMission(mission);
                    
                    // Mettre à jour les colis
                    const packageIds = tour.stops.flatMap(s => s.packageIds);
                    for (const pkgId of packageIds) {
                      const stop = tour.stops.find(s => s.packageIds.includes(pkgId));
                      const extraFields: Record<string, string | undefined> = {
                        missionId,
                        stopId: stop?.id,
                        currentDriverId: driver.id
                      };
                      if (vehicle?.id) {
                        extraFields.currentVehicleId = vehicle.id;
                      }
                      
                      await updatePackageStatus(pkgId, PackageStatus.SORTED, {
                        action: 'SORTED',
                        driverId: driver.id,
                        driverName: `${driver.firstName} ${driver.lastName}`,
                        notes: `Dispatch rapide — ${driver.firstName} ${driver.lastName}`
                      }, extraFields);
                    }
                    
                    // Log activité
                    logActivity(currentUser, ActivityAction.MISSION_DISPATCHED, {
                      targetType: 'mission',
                      targetId: missionId,
                      targetName: `Mission ${zone} — ${driver.firstName} ${driver.lastName}`,
                      details: {
                        metadata: {
                          zone,
                          driver: `${driver.firstName} ${driver.lastName}`,
                          stops: tour.stops.length,
                          packages: packageIds.length,
                          distance: tour.totalDistance
                        }
                      }
                    });
                    
                    // Notifier le chauffeur
                    notifyMissionAssigned(
                      driver.id,
                      zone,
                      tour.stops.length,
                      vehicle?.plate || ''
                    ).catch(e => console.warn('[Notif] Erreur:', e));
                    
                    // Reset
                    setShowQuickDispatch(false);
                    setSelectedPackageIds(new Set());
                    setQuickDispatchDriverId('');
                    
                    alert(`✅ Mission créée avec ${tour.stops.length} stops et ${packageIds.length} colis !`);
                    
                  } catch (error) {
                    console.error('Erreur dispatch rapide:', error);
                    alert('Erreur lors du dispatch. Voir la console pour plus de détails.');
                  }
                  
                  setIsQuickDispatching(false);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-gradient-to-r from-brand-500 to-blue-500 text-white rounded-lg hover:from-brand-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isQuickDispatching ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Dispatcher {selectedPackageIds.size} colis
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Réordonnancement des stops */}
      {reorderingMission && (
        <StopReorderModal
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
