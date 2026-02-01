/**
 * MISSION MANAGER
 * 
 * Composant principal pour la gestion des missions et tournées
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Mission, MissionStatus, MissionType, Package, PackageStatus,
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
  DEFAULT_POSTAL_CODE_MAPPINGS,
  MissionStats
} from '../services/missionService';
import { importExcelFile, validateExcelFormat } from '../services/importService';
import { geocodeAddress, getGoogleMapsApiKey } from '../services/gmproService';
import { logActivity } from '../services/activityLogService';
import { ActivityAction } from '../types';
import { usePermissions, Permission } from '../usePermissions';
import Modal from './shared/Modal';
import DispatchManager from './DispatchManager';
import {
  Truck, Package as PackageIcon, MapPin, Upload, Calendar, Clock,
  Users, CheckCircle, XCircle, AlertTriangle, Filter, Search,
  ChevronRight, ChevronDown, Download, RefreshCw, Play, Pause,
  Eye, Edit, Trash2, Plus, FileSpreadsheet, Route, Loader2,
  Building2, Navigation, BarChart3, TrendingUp, ArrowRight, Phone, Zap
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
  
  // Modals
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  
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

  // Packages du jour
  const todayPackages = useMemo(() => 
    packages.filter(p => p.createdAt.startsWith(selectedDate)),
    [packages, selectedDate]
  );

  // Permissions via le hook
  const { hasPermission } = usePermissions();
  const canImport = hasPermission(Permission.MISSIONS_IMPORT);
  const canDispatch = hasPermission(Permission.MISSIONS_DISPATCH);
  const canManageHubs = hasPermission(Permission.HUBS_MANAGE);

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
      
      // Importer
      const result = await importExcelFile(importFile, client, currentUser);
      setImportResult(result);
      
      if (result.success) {
        logActivity(currentUser, ActivityAction.DATA_IMPORTED, {
          targetType: 'package',
          targetId: result.batchId,
          targetName: importFile.name,
          details: {
            metadata: {
              totalRows: result.totalRows,
              successCount: result.successCount,
              errorCount: result.errorCount,
              zones: result.zoneBreakdown.map((z: any) => `${z.zone}: ${z.count}`)
            }
          }
        });
      }
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({
        success: false,
        errors: [{ row: 0, message: 'Erreur lors de l\'import' }]
      });
    }
    
    setIsImporting(false);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setSelectedClient('');
    setImportResult(null);
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
    <div className="space-y-6">
      {/* Stats globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Route size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
              <p className="text-xs text-slate-500">Missions</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <PackageIcon size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{stats.totalPackages}</p>
              <p className="text-xs text-slate-500">Colis</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{stats.deliveredPackages}</p>
              <p className="text-xs text-slate-500">Livrés</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-purple-600">{stats.completionRate}%</p>
              <p className="text-xs text-slate-500">Taux livraison</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats par zone */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Performance par zone</h3>
        <div className="space-y-3">
          {[Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST].map(zone => {
            const zoneMissions = missions.filter(m => m.zone === zone);
            const zoneDelivered = zoneMissions.reduce((acc, m) => acc + (m.deliveredPackages || 0), 0);
            const zoneTotal = zoneMissions.reduce((acc, m) => acc + (m.totalPackages || 0), 0);
            const zoneRate = zoneTotal > 0 ? Math.round((zoneDelivered / zoneTotal) * 100) : 0;
            const colors = ZONE_COLORS[zone];
            
            return (
              <div key={zone} className="flex items-center gap-4">
                <div className={`w-20 px-2 py-1 rounded-lg text-center text-sm font-bold ${colors.bg} ${colors.text}`}>
                  {zone}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-600">{zoneMissions.length} missions</span>
                    <span className="text-sm font-medium">{zoneDelivered}/{zoneTotal} colis</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${colors.dot} transition-all`}
                      style={{ width: `${zoneRate}%` }}
                    />
                  </div>
                </div>
                <div className="w-12 text-right font-bold text-slate-800">
                  {zoneRate}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Missions en cours */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">Missions en cours</h3>
          <button
            onClick={() => setActiveTab('missions')}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            Voir tout →
          </button>
        </div>
        
        {missions.filter(m => m.status === MissionStatus.IN_PROGRESS).length === 0 ? (
          <p className="text-slate-500 text-center py-8">Aucune mission en cours</p>
        ) : (
          <div className="space-y-2">
            {missions
              .filter(m => m.status === MissionStatus.IN_PROGRESS)
              .slice(0, 5)
              .map(mission => {
                const colors = ZONE_COLORS[mission.zone];
                const progress = mission.totalPackages > 0 
                  ? Math.round(((mission.deliveredPackages || 0) / mission.totalPackages) * 100)
                  : 0;
                  
                return (
                  <div key={mission.id} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
                    <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800 truncate">
                        {mission.driverName || 'Non assigné'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {mission.vehiclePlate} • {mission.stops.length} stops
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-800">{progress}%</p>
                      <p className="text-xs text-slate-500">
                        {mission.deliveredPackages || 0}/{mission.totalPackages}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
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
                
              return (
                <div key={mission.id} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-3 h-3 rounded-full mt-1.5 ${zoneColors.dot}`} />
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
                          {mission.totalDistance && (
                            <span className="flex items-center gap-1 text-slate-600">
                              <Navigation size={14} />
                              {Math.round(mission.totalDistance)} km
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <p className="text-2xl font-bold text-slate-800">{progress}%</p>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // Render Packages
  const renderPackages = () => (
    <div className="space-y-6">
      {/* Stats colis */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { status: PackageStatus.PENDING, label: 'En attente' },
          { status: PackageStatus.LOADED, label: 'Chargés' },
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
          placeholder="Rechercher par n° commande, destinataire, adresse..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
        />
      </div>

      {/* Liste des colis */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">N° Commande</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Destinataire</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Adresse</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Zone</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {todayPackages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
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
                      p.contactName.toLowerCase().includes(term) ||
                      p.address.toLowerCase().includes(term) ||
                      p.city.toLowerCase().includes(term)
                    );
                  })
                  .slice(0, 50)
                  .map(pkg => {
                    const zoneColors = ZONE_COLORS[pkg.zone];
                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status];
                    
                    return (
                      <tr key={pkg.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono font-medium text-slate-800">
                            {pkg.orderNumber}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{pkg.contactName}</p>
                          {pkg.contactPhone && (
                            <p className="text-xs text-slate-500">{pkg.contactPhone}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-slate-700">{pkg.address}</p>
                          <p className="text-xs text-slate-500">{pkg.postalCode} {pkg.city}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-lg text-xs font-bold ${zoneColors.bg} ${zoneColors.text}`}>
                            {pkg.zone}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-lg text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
                            {pkg.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // Render Hubs
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
      {activeTab === 'imports' && renderImports()}
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
    </div>
  );
};

export default MissionManager;
