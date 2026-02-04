
import React, { useState, useMemo, useEffect } from 'react';
import Modal from './shared/Modal';
import { MaintenanceLog, Vehicle, UserRole, InvoiceLine } from '../types';
import { Wrench, Plus, Search, Calendar, CheckCircle2, Clock, Filter, X, Save, Car, Euro, BarChart3, List, AlertTriangle, ArrowRight, Trash2, FileText, Lock } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { usePermissions, Permission } from '../usePermissions';

interface MaintenanceManagerProps {
  logs: MaintenanceLog[];
  vehicles: Vehicle[];
  currentUserRole?: UserRole;
  onAddMaintenance: (log: MaintenanceLog) => Promise<void>;
}

const MaintenanceManager: React.FC<MaintenanceManagerProps> = ({ logs, vehicles, currentUserRole, onAddMaintenance }) => {
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewMaintenance = hasPermission(Permission.MAINTENANCE_VIEW);
  const canViewAllMaintenance = hasPermission(Permission.MAINTENANCE_VIEW_ALL);
  const canViewCosts = hasPermission(Permission.MAINTENANCE_VIEW_COSTS);
  const canCreateMaintenance = hasPermission(Permission.MAINTENANCE_CREATE);
  const canEditMaintenance = hasPermission(Permission.MAINTENANCE_EDIT);
  const canDeleteMaintenance = hasPermission(Permission.MAINTENANCE_DELETE);

  // === TOUS LES HOOKS DOIVENT ÊTRE ICI (avant tout return conditionnel) ===
  
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'preventive' | 'history'>('preventive');

  // Filters for History
  const getCurrentMonth = () => new Date().toISOString().slice(0, 7);
  const [monthFilter, setMonthFilter] = useState(getCurrentMonth());
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newMaintenance, setNewMaintenance] = useState({
      vehicleId: '',
      date: new Date().toISOString().slice(0, 10),
      type: 'Révision',
      description: '',
      provider: '',
      cost: '',
      mileage: '',
      invoiceNumber: ''
  });

  // CONFIRMATION STATE
  const [confirmState, setConfirmState] = useState({
      isOpen: false,
      log: null as MaintenanceLog | null
  });

  // Invoice Lines State
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);

  // Update total cost when lines change
  useEffect(() => {
      if (invoiceLines.length > 0) {
          const total = invoiceLines.reduce((acc, line) => acc + line.total, 0);
          setNewMaintenance(prev => ({ ...prev, cost: total.toString() }));
      }
  }, [invoiceLines]);

  const getVehicleName = (id: string) => {
    const v = vehicles.find(veh => veh.id === id);
    return v ? `${v.plate} (${v.model})` : id;
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
        const logMonth = log.date.slice(0, 7);
        const matchesMonth = monthFilter ? logMonth === monthFilter : true;
        const matchesVehicle = vehicleFilter === 'all' || log.vehicleId === vehicleFilter;
        const matchesSearch = getVehicleName(log.vehicleId).toLowerCase().includes(searchTerm.toLowerCase()) || 
                              log.description.toLowerCase().includes(searchTerm.toLowerCase());
        
        return matchesMonth && matchesVehicle && matchesSearch;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [logs, monthFilter, vehicleFilter, searchTerm]);

  // --- LOGIC PREVENTIVE ---
  const preventiveData = useMemo(() => {
      return vehicles.map(v => {
          const interval = v.maintenanceInterval || 30000; 
          const lastKm = v.lastMaintenanceMileage || 0;
          const currentKm = v.currentMileage || 0;
          
          const kmSinceLast = currentKm - lastKm;
          const kmRemaining = interval - kmSinceLast;
          const percentUsed = Math.min((kmSinceLast / interval) * 100, 100);

          let status: 'ok' | 'warning' | 'critical' = 'ok';
          if (kmRemaining <= 0) status = 'critical';
          else if (kmRemaining < 5000) status = 'warning'; 

          return {
              ...v,
              interval,
              lastKm,
              kmSinceLast,
              kmRemaining,
              percentUsed,
              status
          };
      }).sort((a, b) => b.percentUsed - a.percentUsed); 
  }, [vehicles]);

  const handlePlanFromPreventive = (vehicleId: string) => {
      setNewMaintenance(prev => ({
          ...prev,
          vehicleId: vehicleId,
          type: 'Révision',
          description: 'Révision périodique (Préventif)',
      }));
      setInvoiceLines([]);
      setIsModalOpen(true);
  };

  const handleAddLine = () => {
      setInvoiceLines([...invoiceLines, {
          id: `line-${Date.now()}`,
          description: '',
          quantity: 1,
          unitPrice: 0,
          total: 0
      }]);
  };

  const handleUpdateLine = (id: string, field: keyof InvoiceLine, value: any) => {
      setInvoiceLines(prev => prev.map(line => {
          if (line.id === id) {
              const updated = { ...line, [field]: value };
              if (field === 'quantity' || field === 'unitPrice') {
                  updated.total = Number(updated.quantity) * Number(updated.unitPrice);
              }
              return updated;
          }
          return line;
      }));
  };

  const handleRemoveLine = (id: string) => {
      setInvoiceLines(prev => prev.filter(l => l.id !== id));
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!newMaintenance.vehicleId || !newMaintenance.description) return;

      const log: MaintenanceLog = {
          id: 'm-' + Date.now(),
          vehicleId: newMaintenance.vehicleId,
          date: new Date(newMaintenance.date).toISOString(),
          type: newMaintenance.type,
          description: newMaintenance.description,
          cost: Number(newMaintenance.cost) || 0,
          mileageAtService: Number(newMaintenance.mileage) || 0,
          garageName: newMaintenance.provider || 'Interne',
          provider: newMaintenance.provider,
          invoiceNumber: newMaintenance.invoiceNumber,
          status: 'Pending',
          lines: invoiceLines
      };

      setConfirmState({ isOpen: true, log });
  };

  const executeAddMaintenance = async () => {
      if (confirmState.log) {
          await onAddMaintenance(confirmState.log);
          setIsModalOpen(false);
          setNewMaintenance({
              vehicleId: '',
              date: new Date().toISOString().slice(0, 10),
              type: 'Révision',
              description: '',
              provider: '',
              cost: '',
              mileage: '',
              invoiceNumber: ''
          });
          setInvoiceLines([]);
      }
      setConfirmState({ isOpen: false, log: null });
  };

  const showCosts = canViewCosts;
  const canEdit = canEditMaintenance;

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewMaintenance) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès à la gestion de la maintenance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in relative h-full flex flex-col">
      
      {/* HEADER & TABS */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4 justify-between items-center">
          <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                 <Wrench className="text-brand-600"/>
                 Atelier & Planification
              </h2>
              <p className="text-sm text-slate-600 font-medium">Gérez les révisions périodiques et suivez les coûts.</p>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button 
                  onClick={() => setActiveTab('preventive')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${
                      activeTab === 'preventive' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                  <BarChart3 size={16} /> Pilotage Préventif
              </button>
              <button 
                  onClick={() => setActiveTab('history')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all ${
                      activeTab === 'history' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                  <List size={16} /> Journal & Factures
              </button>
          </div>
      </div>

      {/* --- TAB 1: PREVENTIVE DASHBOARD --- */}
      {activeTab === 'preventive' && (
          <div className="grid grid-cols-1 gap-4">
              {preventiveData.map(item => (
                  <div key={item.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-center gap-6 hover:shadow-md transition-shadow">
                      
                      {/* Vehicle Info */}
                      <div className="flex items-center gap-4 w-full md:w-1/4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shadow-md ${
                              item.status === 'critical' ? 'bg-red-500' :
                              item.status === 'warning' ? 'bg-orange-500' : 'bg-green-500'
                          }`}>
                              {Math.round(item.percentUsed)}%
                          </div>
                          <div>
                              <h3 className="font-bold text-slate-900">{item.plate}</h3>
                              <p className="text-xs text-slate-600 font-medium">{item.model}</p>
                          </div>
                      </div>

                      {/* Progress Bar & Stats */}
                      <div className="flex-1 w-full">
                          <div className="flex justify-between items-end mb-2">
                              <div>
                                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Intervalle Révision</p>
                                  <p className="text-sm font-bold text-slate-800">
                                      {item.kmSinceLast.toLocaleString()} / {item.interval.toLocaleString()} km
                                  </p>
                              </div>
                              <div className="text-right">
                                  {item.status === 'critical' ? (
                                      <span className="text-red-700 font-bold text-sm flex items-center gap-1">
                                          <AlertTriangle size={14} /> Dépassement : {Math.abs(item.kmRemaining).toLocaleString()} km
                                      </span>
                                  ) : (
                                      <span className={`${item.status === 'warning' ? 'text-orange-700' : 'text-slate-600'} text-sm font-medium`}>
                                          Reste {item.kmRemaining.toLocaleString()} km
                                      </span>
                                  )}
                              </div>
                          </div>
                          
                          <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                  className={`h-full rounded-full transition-all duration-500 ${
                                      item.status === 'critical' ? 'bg-red-500' :
                                      item.status === 'warning' ? 'bg-orange-500' : 'bg-green-500'
                                  }`}
                                  style={{ width: `${item.percentUsed}%` }}
                              ></div>
                          </div>
                          
                          <div className="flex justify-between text-[10px] text-slate-500 font-medium mt-1">
                              <span>Dernière: {item.lastKm.toLocaleString()} km ({new Date(item.lastMaintenanceDate || '').toLocaleDateString()})</span>
                              <span>Prochaine: {(item.lastKm + item.interval).toLocaleString()} km</span>
                          </div>
                      </div>

                      {/* Action Button */}
                      <div className="w-full md:w-auto">
                          <button 
                              onClick={() => handlePlanFromPreventive(item.id)}
                              className="w-full md:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg"
                          >
                              <Calendar size={16} /> Planifier
                          </button>
                      </div>
                  </div>
              ))}
          </div>
      )}

      {/* --- TAB 2: HISTORY & LOGS --- */}
      {activeTab === 'history' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col">
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-50">
                <div className="flex gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-300">
                        <Filter size={16} className="text-slate-500" />
                        <select 
                            value={vehicleFilter} 
                            onChange={(e) => setVehicleFilter(e.target.value)}
                            className="bg-transparent border-none focus:outline-none text-slate-900 font-medium text-sm"
                        >
                            <option value="all">Tous les véhicules</option>
                            {vehicles.map(v => (
                                <option key={v.id} value={v.id}>{v.plate}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-300">
                        <Calendar size={16} className="text-slate-500" />
                        <input 
                            type="month" 
                            value={monthFilter}
                            onChange={(e) => setMonthFilter(e.target.value)}
                            className="bg-transparent border-none focus:outline-none text-slate-900 font-medium text-sm"
                        />
                    </div>
                </div>

                {canEdit && (
                    <button 
                        onClick={() => {
                             setNewMaintenance({
                                 vehicleId: '',
                                 date: new Date().toISOString().slice(0, 10),
                                 type: 'Révision',
                                 description: '',
                                 provider: '',
                                 cost: '',
                                 mileage: '',
                                 invoiceNumber: ''
                             });
                             setInvoiceLines([]);
                             setIsModalOpen(true);
                        }}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                        <Plus size={16} /> Saisie Manuelle
                    </button>
                )}
            </div>

            <div className="overflow-x-auto flex-1">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold text-sm uppercase tracking-wider sticky top-0">
                        <tr>
                            <th className="px-6 py-4">Date</th>
                            <th className="px-6 py-4">Véhicule</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4">Description</th>
                            <th className="px-6 py-4">Fournisseur</th>
                            {showCosts && <th className="px-6 py-4">Coût</th>}
                            <th className="px-6 py-4">Statut</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 flex items-center gap-2 text-slate-700 font-medium">
                                    {new Date(log.date).toLocaleDateString('fr-FR')}
                                </td>
                                <td className="px-6 py-4 font-bold text-slate-900">
                                    {getVehicleName(log.vehicleId)}
                                </td>
                                <td className="px-6 py-4 text-slate-700 font-medium">{log.type}</td>
                                <td className="px-6 py-4">
                                    <div className="text-slate-900 text-sm font-medium">{log.description}</div>
                                    {log.lines && log.lines.length > 0 && (
                                        <div className="text-xs text-slate-500 mt-1 pl-2 border-l-2 border-slate-300">
                                            {log.lines.length} ligne(s) de détail
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-4 text-slate-700 font-medium">{log.provider || log.garageName || '-'}</td>
                                {showCosts && (
                                    <td className="px-6 py-4 font-bold text-slate-900">{log.cost.toLocaleString()} €</td>
                                )}
                                <td className="px-6 py-4">
                                    {log.status === 'Completed' ? (
                                        <span className="flex items-center gap-1 text-green-700 text-xs font-bold uppercase">
                                            <CheckCircle2 size={14} /> Terminé
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-orange-700 text-xs font-bold uppercase">
                                            <Clock size={14} /> En Attente
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                         {filteredLogs.length === 0 && (
                            <tr>
                                <td colSpan={showCosts ? 7 : 6} className="px-6 py-12 text-center text-slate-500 font-medium">
                                    <p>Aucune maintenance trouvée pour ces critères.</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
          </div>
      )}

      {/* --- MODAL ADD MAINTENANCE --- */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Saisir Facture / Maintenance"
        size="2xl"
        headerIcon={<Wrench size={20} />}
      >
        <form onSubmit={handleRequestSubmit} className="space-y-6">
          {/* Section 1: Contexte */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="col-span-1 md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Véhicule</label>
              <select 
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium"
                value={newMaintenance.vehicleId}
                onChange={(e) => setNewMaintenance({...newMaintenance, vehicleId: e.target.value})}
              >
                <option value="">Sélectionner un véhicule...</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.plate} ({v.model})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Date</label>
              <input 
                type="date" required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-medium"
                value={newMaintenance.date}
                onChange={(e) => setNewMaintenance({...newMaintenance, date: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Type d'opération</label>
              <select 
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 font-medium"
                value={newMaintenance.type}
                onChange={(e) => setNewMaintenance({...newMaintenance, type: e.target.value})}
              >
                <option value="Révision">Révision Générale</option>
                <option value="Pneumatiques">Pneumatiques</option>
                <option value="Mécanique">Mécanique Générale</option>
                <option value="Carrosserie">Carrosserie</option>
                <option value="Contrôle Technique">Contrôle Technique</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Kilométrage (Compteur)</label>
              <input 
                type="number"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-medium"
                placeholder="Ex: 150000"
                value={newMaintenance.mileage}
                onChange={(e) => setNewMaintenance({...newMaintenance, mileage: e.target.value})}
              />
            </div>
          </div>

          {/* Section 2: Facturation */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FileText size={16} /> Détails Facturation
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Fournisseur</label>
                <input 
                  type="text"
                  placeholder="Nom du garage / Fournisseur"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-medium"
                  value={newMaintenance.provider}
                  onChange={(e) => setNewMaintenance({...newMaintenance, provider: e.target.value})}
                />
              </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">N° Facture</label>
                                        <input 
                                            type="text"
                                            placeholder="Réf. Facture"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-medium"
                                            value={newMaintenance.invoiceNumber}
                                            onChange={(e) => setNewMaintenance({...newMaintenance, invoiceNumber: e.target.value})}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Description Globale</label>
                                        <input 
                                            type="text" required
                                            placeholder="Ex: Révision des 100 000km"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-medium"
                                            value={newMaintenance.description}
                                            onChange={(e) => setNewMaintenance({...newMaintenance, description: e.target.value})}
                                        />
                                    </div>
                                </div>
                          </div>

                          {/* Section 3: Lignes de Facture */}
                          <div className="space-y-3">
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                                    <h4 className="text-sm font-bold text-slate-800">Lignes de détail (Pièces & MO)</h4>
                                    <button 
                                        type="button"
                                        onClick={handleAddLine}
                                        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1"
                                    >
                                        <Plus size={14} /> Ajouter une ligne
                                    </button>
                                </div>
                                
                                {invoiceLines.length === 0 ? (
                                    <div className="text-center py-4 bg-slate-50 rounded-lg border border-dashed border-slate-300 text-slate-500 text-sm italic font-medium">
                                        Aucune ligne saisie. Le coût total sera à saisir manuellement si vide.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {invoiceLines.map((line, index) => (
                                            <div key={line.id} className="grid grid-cols-12 gap-2 items-end bg-slate-50 p-2 rounded-lg border border-slate-200 animate-fade-in">
                                                <div className="col-span-5">
                                                    <label className="text-[10px] uppercase text-slate-500 font-bold">Description</label>
                                                    <input 
                                                        type="text" placeholder="Désignation"
                                                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900"
                                                        value={line.description}
                                                        onChange={(e) => handleUpdateLine(line.id, 'description', e.target.value)}
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="text-[10px] uppercase text-slate-500 font-bold">Qté</label>
                                                    <input 
                                                        type="number" step="0.1"
                                                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900"
                                                        value={line.quantity}
                                                        onChange={(e) => handleUpdateLine(line.id, 'quantity', e.target.value)}
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="text-[10px] uppercase text-slate-500 font-bold">P.U (€)</label>
                                                    <input 
                                                        type="number" step="0.01"
                                                        className="w-full px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900"
                                                        value={line.unitPrice}
                                                        onChange={(e) => handleUpdateLine(line.id, 'unitPrice', e.target.value)}
                                                    />
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    <label className="text-[10px] uppercase text-slate-500 font-bold">Total</label>
                                                    <div className="font-bold text-slate-900 text-sm py-1">{line.total.toFixed(2)} €</div>
                                                </div>
                                                <div className="col-span-1 flex justify-center pb-1">
                                                    <button type="button" onClick={() => handleRemoveLine(line.id)} className="text-red-400 hover:text-red-600"><Trash2 size={16}/></button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                          </div>

          {/* Total Global */}
          <div className="bg-slate-100 p-4 rounded-xl flex justify-between items-center border border-slate-200">
            <span className="font-bold text-slate-800">TOTAL TTC (Estimé)</span>
            <div className="relative w-32">
              <Euro className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input 
                type="number" step="0.01"
                className="w-full pl-8 pr-3 py-2 bg-white border border-slate-300 rounded-lg font-bold text-right text-slate-900"
                value={newMaintenance.cost}
                onChange={(e) => setNewMaintenance({...newMaintenance, cost: e.target.value})}
              />
            </div>
          </div>

          <div className="pt-2">
            <button 
              type="submit"
              className="w-full py-4 text-white bg-brand-600 hover:bg-brand-700 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-brand-200"
            >
              <Save size={20} /> Enregistrer la facture
            </button>
          </div>
        </form>
      </Modal>

      {/* CONFIRMATION MODAL */}
      <ConfirmModal 
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState({ isOpen: false, log: null })}
        onConfirm={executeAddMaintenance}
        title="Enregistrer la maintenance ?"
        message="Confirmez-vous l'ajout de cette intervention dans l'historique ?"
        type="success"
        confirmLabel="Enregistrer"
      />

    </div>
  );
};

export default MaintenanceManager;
