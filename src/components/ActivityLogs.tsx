/**
 * COMPOSANT LOGS D'ACTIVITÉ
 * 
 * Affiche l'historique des actions avec filtres avancés
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  ActivityLog, ActivityCategory, ActivityAction, User 
} from '../types';
import { 
  getActivityLogs, 
  subscribeToActivityLogs, 
  exportLogsToCSV,
  ActivityLogFilters 
} from '../services/activityLogService';
import {
  Activity, Search, Filter, Download, RefreshCw, Calendar,
  User as UserIcon, Car, Droplet, Wrench, AlertTriangle, FileText,
  Clock, Users, FileCheck, ChevronDown, ChevronRight, X, 
  ArrowUpDown, Eye, Edit, Trash2, Plus, Check, LogIn, LogOut,
  Ban, Shield, Settings, Loader2
} from 'lucide-react';
import Modal from './shared/Modal';
import ErrorLogsPanel from './ErrorLogsPanel';

interface ActivityLogsProps {
  users: User[];
  currentUser: User;
}

const ActivityLogs: React.FC<ActivityLogsProps> = ({ users, currentUser }) => {
  // Onglet : activité (audit) ou erreurs techniques
  const [tab, setTab] = useState<'activity' | 'errors'>('activity');
  // États
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  
  // Filtres
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<ActivityLogFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  // Détail
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Charger les logs au montage
  useEffect(() => {
    const unsubscribe = subscribeToActivityLogs((newLogs) => {
      setLogs(newLogs);
      setIsLoading(false);
    }, 200);
    
    return () => unsubscribe();
  }, []);

  // Logs filtrés
  const filteredLogs = useMemo(() => {
    let result = [...logs];
    
    // Filtre par recherche
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(log =>
        log.description.toLowerCase().includes(term) ||
        log.userName.toLowerCase().includes(term) ||
        log.targetName?.toLowerCase().includes(term) ||
        log.action.toLowerCase().includes(term)
      );
    }
    
    // Filtre par catégorie
    if (selectedCategory !== 'all') {
      result = result.filter(log => log.category === selectedCategory);
    }
    
    // Filtre par utilisateur
    if (selectedUser !== 'all') {
      result = result.filter(log => log.userId === selectedUser);
    }
    
    // Filtre par date
    if (dateFrom) {
      result = result.filter(log => log.createdAt >= dateFrom);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter(log => log.createdAt <= toDate.toISOString());
    }
    
    return result;
  }, [logs, searchTerm, selectedCategory, selectedUser, dateFrom, dateTo]);

  // Icône par catégorie
  const getCategoryIcon = (category: ActivityCategory) => {
    switch (category) {
      case ActivityCategory.USERS: return <Users size={16} className="text-blue-500" />;
      case ActivityCategory.VEHICLES: return <Car size={16} className="text-green-500" />;
      case ActivityCategory.FUEL: return <Droplet size={16} className="text-amber-500" />;
      case ActivityCategory.MAINTENANCE: return <Wrench size={16} className="text-purple-500" />;
      case ActivityCategory.ISSUES: return <AlertTriangle size={16} className="text-red-500" />;
      case ActivityCategory.DOCUMENTS: return <FileText size={16} className="text-indigo-500" />;
      case ActivityCategory.ABSENCES: return <Calendar size={16} className="text-teal-500" />;
      case ActivityCategory.QUOTES: return <FileCheck size={16} className="text-pink-500" />;
      case ActivityCategory.SYSTEM: return <Settings size={16} className="text-slate-500" />;
      default: return <Activity size={16} className="text-slate-400" />;
    }
  };

  // Icône par action
  const getActionIcon = (action: ActivityAction) => {
    if (action.includes('CREATED') || action.includes('CREATE')) return <Plus size={14} className="text-green-500" />;
    if (action.includes('UPDATED') || action.includes('UPDATE')) return <Edit size={14} className="text-blue-500" />;
    if (action.includes('DELETED') || action.includes('DELETE')) return <Trash2 size={14} className="text-red-500" />;
    if (action.includes('SIGNED')) return <Check size={14} className="text-green-600" />;
    if (action.includes('READ')) return <Eye size={14} className="text-slate-500" />;
    if (action.includes('LOGIN')) return <LogIn size={14} className="text-green-500" />;
    if (action.includes('LOGOUT')) return <LogOut size={14} className="text-slate-500" />;
    if (action.includes('ACTIVATED')) return <Check size={14} className="text-green-500" />;
    if (action.includes('DEACTIVATED')) return <Ban size={14} className="text-red-500" />;
    if (action.includes('APPROVED')) return <Check size={14} className="text-green-500" />;
    if (action.includes('REJECTED')) return <X size={14} className="text-red-500" />;
    if (action.includes('RESOLVED')) return <Check size={14} className="text-green-500" />;
    if (action.includes('ASSIGNED')) return <UserIcon size={14} className="text-blue-500" />;
    if (action.includes('IMMOBILIZED')) return <Ban size={14} className="text-orange-500" />;
    return <Activity size={14} className="text-slate-400" />;
  };

  // Couleur de badge par action
  const getActionBadgeColor = (action: ActivityAction) => {
    if (action.includes('CREATED')) return 'bg-green-100 text-green-700';
    if (action.includes('UPDATED')) return 'bg-blue-100 text-blue-700';
    if (action.includes('DELETED')) return 'bg-red-100 text-red-700';
    if (action.includes('SIGNED') || action.includes('APPROVED') || action.includes('RESOLVED') || action.includes('ACTIVATED')) return 'bg-green-100 text-green-700';
    if (action.includes('REJECTED') || action.includes('DEACTIVATED') || action.includes('IMMOBILIZED')) return 'bg-red-100 text-red-700';
    if (action.includes('LOGIN')) return 'bg-emerald-100 text-emerald-700';
    if (action.includes('LOGOUT')) return 'bg-slate-100 text-slate-700';
    return 'bg-slate-100 text-slate-600';
  };

  // Export CSV
  const handleExport = () => {
    const csv = exportLogsToCSV(filteredLogs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-activite-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Reset filtres
  const resetFilters = () => {
    setSearchTerm('');
    setSelectedCategory('all');
    setSelectedUser('all');
    setDateFrom('');
    setDateTo('');
  };

  // Format date relative
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    return date.toLocaleDateString('fr-FR');
  };

  // Stats rapides
  const stats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(l => l.createdAt.startsWith(today));
    
    return {
      total: logs.length,
      today: todayLogs.length,
      users: new Set(logs.map(l => l.userId)).size,
      categories: Object.values(ActivityCategory).map(cat => ({
        name: cat,
        count: logs.filter(l => l.category === cat).length
      })).filter(c => c.count > 0).sort((a, b) => b.count - a.count)
    };
  }, [logs]);

  if (isLoading && tab === 'activity') {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={48} className="animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="text-brand-500" />
            Logs d'activité
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Historique des actions effectuées dans l'application
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {tab === 'activity' && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-xl text-slate-700 font-medium hover:bg-slate-50 transition-colors"
            >
              <Download size={18} />
              <span className="hidden sm:inline">Exporter</span>
            </button>
          )}
        </div>
      </div>

      {/* Onglets : Activité / Erreurs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setTab('activity')}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
            tab === 'activity' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-2"><Activity size={16} /> Activité</span>
        </button>
        <button
          onClick={() => setTab('errors')}
          className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
            tab === 'errors' ? 'border-red-500 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span className="flex items-center gap-2"><AlertTriangle size={16} /> Journal d'erreurs</span>
        </button>
      </div>

      {tab === 'errors' ? <ErrorLogsPanel /> : (
      <>
      {/* Stats rapides */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Total logs</p>
          <p className="text-2xl font-bold text-slate-800">{stats.total.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Aujourd'hui</p>
          <p className="text-2xl font-bold text-green-600">{stats.today}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Utilisateurs actifs</p>
          <p className="text-2xl font-bold text-blue-600">{stats.users}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 uppercase">Affichés</p>
          <p className="text-2xl font-bold text-slate-800">{filteredLogs.length}</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Recherche */}
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher dans les logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>
          
          {/* Catégorie */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white font-medium"
          >
            <option value="all">Toutes catégories</option>
            {Object.values(ActivityCategory).map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          
          {/* Utilisateur */}
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white font-medium"
          >
            <option value="all">Tous les utilisateurs</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>
            ))}
          </select>
          
          {/* Bouton filtres avancés */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              showFilters || dateFrom || dateTo
                ? 'bg-brand-500 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Filter size={18} />
            Dates
            {(dateFrom || dateTo) && <span className="w-2 h-2 bg-white rounded-full" />}
          </button>
          
          {/* Reset */}
          {(searchTerm || selectedCategory !== 'all' || selectedUser !== 'all' || dateFrom || dateTo) && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-2 px-4 py-2.5 text-red-600 hover:bg-red-50 rounded-xl font-medium transition-colors"
            >
              <X size={18} />
              Reset
            </button>
          )}
        </div>
        
        {/* Filtres dates */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Du</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Au</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Liste des logs */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date/Heure</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Utilisateur</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase hidden md:table-cell">Description</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase hidden lg:table-cell">Cible</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase w-16">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    <Activity size={48} className="mx-auto text-slate-300 mb-3" />
                    <p className="font-medium">Aucun log trouvé</p>
                    <p className="text-sm">Modifiez vos filtres ou attendez que des actions soient effectuées.</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-slate-400" />
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            {formatRelativeTime(log.createdAt)}
                          </p>
                          <p className="text-xs text-slate-400">
                            {new Date(log.createdAt).toLocaleString('fr-FR')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
                          {log.userName.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{log.userName}</p>
                          <p className="text-xs text-slate-500">{log.userRole}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(log.category)}
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${getActionBadgeColor(log.action)}`}>
                          {getActionIcon(log.action)}
                          {log.category}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-sm text-slate-700 line-clamp-2">{log.description}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {log.targetName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-lg text-xs font-medium text-slate-700">
                          {log.targetName}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          setSelectedLog(log);
                          setIsDetailOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-brand-500 hover:bg-brand-50 rounded-lg transition-colors"
                      >
                        <Eye size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal détail */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title="Détail du log"
        size="md"
        headerIcon={<Activity size={20} />}
      >
        {selectedLog && (
          <div className="space-y-4">
            {/* Info principale */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {getCategoryIcon(selectedLog.category)}
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${getActionBadgeColor(selectedLog.action)}`}>
                    {selectedLog.action.replace(/_/g, ' ')}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(selectedLog.createdAt).toLocaleString('fr-FR')}
                </span>
              </div>
              
              <p className="text-slate-800 font-medium">{selectedLog.description}</p>
            </div>
            
            {/* Utilisateur */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Utilisateur</p>
                <p className="font-medium text-slate-800">{selectedLog.userName}</p>
                <p className="text-sm text-slate-500">{selectedLog.userRole}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">ID Utilisateur</p>
                <p className="font-mono text-sm text-slate-600">{selectedLog.userId}</p>
              </div>
            </div>
            
            {/* Cible */}
            {selectedLog.targetName && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Cible de l'action</p>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1.5 bg-slate-100 rounded-lg font-medium text-slate-800">
                    {selectedLog.targetName}
                  </span>
                  {selectedLog.targetType && (
                    <span className="text-xs text-slate-500">({selectedLog.targetType})</span>
                  )}
                </div>
              </div>
            )}
            
            {/* Détails techniques */}
            {selectedLog.details && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Détails techniques</p>
                
                {selectedLog.details.changes && selectedLog.details.changes.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-slate-500 mb-1">Champs modifiés :</p>
                    <div className="flex flex-wrap gap-1">
                      {selectedLog.details.changes.map((change, i) => (
                        <span key={i} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {change}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {selectedLog.details.before && (
                  <div className="mb-2">
                    <p className="text-xs text-slate-500 mb-1">Avant :</p>
                    <pre className="bg-red-50 text-red-800 p-2 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.details.before, null, 2)}
                    </pre>
                  </div>
                )}
                
                {selectedLog.details.after && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Après :</p>
                    <pre className="bg-green-50 text-green-800 p-2 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.details.after, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
            
            {/* Métadonnées */}
            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Métadonnées</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">ID Log :</span>
                  <span className="ml-1 font-mono text-slate-700">{selectedLog.id}</span>
                </div>
                <div>
                  <span className="text-slate-500">Catégorie :</span>
                  <span className="ml-1 text-slate-700">{selectedLog.category}</span>
                </div>
                {selectedLog.ipAddress && (
                  <div>
                    <span className="text-slate-500">IP :</span>
                    <span className="ml-1 font-mono text-slate-700">{selectedLog.ipAddress}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
      </>
      )}
    </div>
  );
};

export default ActivityLogs;
