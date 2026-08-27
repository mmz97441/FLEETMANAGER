
import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Truck, Users, BrainCircuit, Droplet, Wrench, 
  AlertCircle, HelpCircle, LogOut, ShieldCheck, Building2,
  FileCheck, CalendarDays, ChevronDown, ChevronRight,
  ShoppingBag, Euro, List, Settings as SettingsIcon, FileSignature,
  UserCog, Bell, Download, ClipboardList, Palmtree, Shield,
  Route, Package, MapPin, Activity, Clock, Navigation, AlertTriangle, Eye, BarChart3
} from 'lucide-react';
import { ViewState, User, UserRole } from '../types';
import { usePermissions, Permission, PermissionKey } from '../usePermissions';
import { roleKey } from '../utils/role';

interface PendingCounts {
  leaves: number;
  absences: number;
  issues: number;
  maintenance: number;
  quotes: number;
}

interface SidebarProps {
  currentView: ViewState;
  onChangeView: (view: ViewState) => void;
  isCollapsed: boolean;
  currentUser: User;
  onLogout: () => void;
  pendingDocsCount?: number;
  pendingCounts?: PendingCounts;
}

// Structure de menu basée sur les permissions
type NavItem = {
  id: ViewState;
  label: string;
  icon: React.ElementType;
  permission?: PermissionKey;        // Permission requise (nouvelle méthode)
  permissions?: PermissionKey[];     // OU plusieurs permissions (any)
  badgeKey?: string;                 // Clé pour afficher un badge
};

type NavGroup = {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
  permission?: PermissionKey;
  permissions?: PermissionKey[];
  badgeKey?: string;
};

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, isCollapsed, currentUser, onLogout, pendingDocsCount = 0, pendingCounts }) => {
  const [openGroups, setOpenGroups] = useState<string[]>(['flotte', 'equipe']);
  
  // Hook des permissions
  const { hasPermission, hasAnyPermission } = usePermissions();

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => 
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  // =====================================================
  // STRUCTURE DE MENU BASÉE SUR LES PERMISSIONS
  // =====================================================
  const menuStructure: (NavItem | NavGroup)[] = [
    
    // ─────────────────────────────────────────────────────
    // 📊 PILOTAGE — vues de situation
    // ─────────────────────────────────────────────────────
    {
      id: 'pilotage',
      label: 'Pilotage',
      icon: LayoutDashboard,
      permissions: [Permission.DASHBOARD_VIEW, Permission.PRESIDENT_OVERVIEW_VIEW, Permission.FLEET_MAP_VIEW],
      items: [
        { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, permission: Permission.DASHBOARD_VIEW },
        { id: 'president_overview', label: 'Vue de dieu', icon: Eye, permission: Permission.PRESIDENT_OVERVIEW_VIEW },
        { id: 'fleet_map', label: 'Carte chauffeurs', icon: MapPin, permission: Permission.FLEET_MAP_VIEW },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 🚚 EXPLOITATION — le quotidien du dispatch
    // ─────────────────────────────────────────────────────
    {
      id: 'exploitation',
      label: 'Exploitation',
      icon: Route,
      permissions: [Permission.MISSIONS_VIEW, Permission.MISSIONS_VIEW_OWN, Permission.QUOTES_VIEW],
      badgeKey: 'quotes',
      items: [
        { id: 'missions', label: 'Missions', icon: Route, permission: Permission.MISSIONS_VIEW },
        { id: 'tours_overview', label: 'Suivi des tournées', icon: ClipboardList, permission: Permission.MISSIONS_VIEW },
        { id: 'hub_operations', label: 'Opérations Hub', icon: Package, permission: Permission.MISSIONS_VIEW },
        { id: 'quotes', label: 'Demandes & Devis', icon: FileCheck, permission: Permission.QUOTES_VIEW, badgeKey: 'quotes' },
        { id: 'driver_tour', label: 'Ma Tournée', icon: Navigation, permission: Permission.MISSIONS_VIEW_OWN },
        { id: 'driver_preview', label: 'Vue chauffeur (test)', icon: Package, permission: Permission.MISSIONS_VIEW },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 🚛 FLOTTE & ATELIER
    // ─────────────────────────────────────────────────────
    {
      id: 'flotte',
      label: 'Flotte & Atelier',
      icon: Truck,
      permissions: [Permission.VEHICLES_VIEW, Permission.FUEL_VIEW, Permission.MAINTENANCE_VIEW, Permission.ISSUES_VIEW],
      items: [
        { id: 'vehicles', label: 'Véhicules', icon: Truck, permission: Permission.VEHICLES_VIEW },
        { id: 'fuel', label: 'Carburant', icon: Droplet, permission: Permission.FUEL_VIEW },
        { id: 'maintenance', label: 'Maintenance', icon: Wrench, permission: Permission.MAINTENANCE_VIEW, badgeKey: 'maintenance' },
        { id: 'issues', label: 'Incidents', icon: AlertCircle, permission: Permission.ISSUES_VIEW, badgeKey: 'issues' },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 👥 ÉQUIPE & RH
    // ─────────────────────────────────────────────────────
    {
      id: 'equipe',
      label: 'Équipe & RH',
      icon: Users,
      permissions: [Permission.DRIVERS_VIEW, Permission.ABSENCES_VIEW_OWN, Permission.DOCS_VIEW_OWN],
      badgeKey: 'docs',
      items: [
        { id: 'drivers', label: 'Chauffeurs', icon: Users, permission: Permission.DRIVERS_VIEW },
        { id: 'leaves', label: 'Congés', icon: Palmtree, permission: Permission.ABSENCES_VIEW_OWN, badgeKey: 'leaves' },
        { id: 'absences', label: 'Absences', icon: CalendarDays, permission: Permission.ABSENCES_VIEW_OWN, badgeKey: 'absences' },
        { id: 'company_docs', label: 'Documents', icon: FileSignature, permission: Permission.DOCS_VIEW_ALL, badgeKey: 'docs' },
        { id: 'documents', label: 'Mes Documents', icon: FileCheck, permission: Permission.DOCS_VIEW_OWN, badgeKey: 'docs' },
      ]
    },

    // ─────────────────────────────────────────────────────
    // ⚙️ ADMINISTRATION — gestion + réglages
    // ─────────────────────────────────────────────────────
    {
      id: 'administration',
      label: 'Administration',
      icon: UserCog,
      permissions: [Permission.USERS_VIEW, Permission.LOGS_VIEW, Permission.SETTINGS_ACCESS, Permission.SETTINGS_COMPANY, Permission.IMPORT_EXPORT_ACCESS],
      items: [
        { id: 'users', label: 'Utilisateurs', icon: Users, permission: Permission.USERS_VIEW },
        { id: 'permissions', label: 'Permissions', icon: Shield, permission: Permission.USERS_PERMISSIONS },
        { id: 'company_settings', label: 'Entreprise', icon: Building2, permission: Permission.SETTINGS_COMPANY },
        { id: 'delivery_schedule', label: 'Horaires livraison', icon: Clock, permission: Permission.SETTINGS_COMPANY },
        { id: 'zone_management', label: 'Zones (codes postaux)', icon: MapPin, permission: Permission.SETTINGS_COMPANY },
        { id: 'import_export', label: 'Imports / Exports', icon: Download, permission: Permission.IMPORT_EXPORT_ACCESS },
        { id: 'notifications_settings', label: 'Notifications', icon: Bell, permission: Permission.SETTINGS_ACCESS },
        { id: 'settings', label: 'Préférences', icon: SettingsIcon, permission: Permission.SETTINGS_ACCESS },
        { id: 'activity_logs', label: "Logs d'activité", icon: ClipboardList, permission: Permission.LOGS_VIEW },
        { id: 'error_logs', label: "Journal d'erreurs", icon: AlertTriangle, permission: Permission.LOGS_VIEW },
        { id: 'api_diagnostic', label: 'Diagnostic API', icon: Activity, permission: Permission.SETTINGS_COMPANY },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 🤖 ASSISTANT IA
    // ─────────────────────────────────────────────────────
    {
      id: 'ai_advisor',
      label: 'Assistant IA',
      icon: BrainCircuit,
      permission: Permission.AI_ACCESS
    },

    // ─────────────────────────────────────────────────────
    // 🛒 ESPACE CLIENT (exclusif aux clients)
    // ─────────────────────────────────────────────────────
    {
      id: 'client_space',
      label: 'Espace Client',
      icon: ShoppingBag,
      permission: Permission.CLIENT_DASHBOARD,
      items: [
        { id: 'client_dashboard', label: 'Accueil', icon: LayoutDashboard, permission: Permission.CLIENT_DASHBOARD },
        { id: 'client_shipments', label: 'Mes Colis', icon: Package, permission: Permission.CLIENT_REQUESTS_VIEW_OWN },
        { id: 'client_tracking', label: 'Suivi live', icon: Navigation, permission: Permission.CLIENT_REQUESTS_VIEW_OWN },
        { id: 'client_analytics', label: 'Statistiques', icon: BarChart3, permission: Permission.CLIENT_DASHBOARD },
        { id: 'client_recipients', label: 'Mes Destinataires', icon: MapPin, permission: Permission.CLIENT_ADDRESSES_VIEW },
        { id: 'client_list', label: 'Mes Devis', icon: List, permission: Permission.CLIENT_REQUESTS_VIEW_OWN },
        { id: 'client_company', label: 'Mon Entreprise', icon: Building2, permission: Permission.CLIENT_DASHBOARD },
        { id: 'client_help', label: 'Aide', icon: HelpCircle, permission: Permission.CLIENT_DASHBOARD },
      ]
    },

    // ─────────────────────────────────────────────────────
    // ❓ AIDE - Tout le monde (pas de permission requise)
    // ─────────────────────────────────────────────────────
    { 
      id: 'help', 
      label: 'Aide & Support', 
      icon: HelpCircle
      // Pas de permission = accessible à tous
    },
  ];

  // =====================================================
  // VÉRIFICATION D'ACCÈS BASÉE SUR LES PERMISSIONS
  // =====================================================
  const checkAccess = (item: NavItem | NavGroup): boolean => {
    // L'ESPACE CLIENT est réservé aux VRAIS clients. Président/Admin héritent de
    // toutes les permissions (dont celles du client) mais ne doivent JAMAIS voir
    // le portail expéditeur. Pour prévisualiser un client, ils ont « Voir en tant que ».
    const itemId = String((item as { id?: string }).id || '');
    const isClientRole = String(currentUser.role || '').toLowerCase().includes('client');
    if (itemId === 'client_space' || itemId.startsWith('client_')) {
      return isClientRole;
    }

    // Si pas de permission définie = accessible à tous
    if (!item.permission && !item.permissions) {
      return true;
    }

    // Vérification par permission unique
    if (item.permission) {
      return hasPermission(item.permission);
    }

    // Vérification par plusieurs permissions (OR)
    if (item.permissions && item.permissions.length > 0) {
      return hasAnyPermission(item.permissions);
    }

    return true;
  };

  // Label d'affichage du rôle
  const displayRoleLabel = useMemo(() => {
    const r = roleKey(currentUser.role);
    if (r.includes('direction') || r.includes('directeur')) return "Direction";
    if (r.includes('presiden')) return "Présidence";
    if (r.includes('secret')) return "Secrétariat";
    if (r.includes('chauff') || r.includes('driver')) return "Chauffeur";
    if (r.includes('mecan') || r.includes('mech')) return "Mécanicien";
    if (r.includes('admin')) return "Admin";
    if (r.includes('client')) return "Client";
    if (r.includes('stag') || r.includes('intern')) return "Stagiaire";
    return currentUser.role;
  }, [currentUser.role]);

  // Badge couleur selon le rôle
  const getRoleBadgeStyle = () => {
    const r = roleKey(currentUser.role);
    if (r.includes('presiden')) return 'text-amber-300 border-amber-500/50 bg-amber-900/30';
    if (r.includes('direction') || r.includes('directeur')) return 'text-indigo-300 border-indigo-500/50 bg-indigo-900/30';
    if (r.includes('secret')) return 'text-purple-300 border-purple-500/50 bg-purple-900/30';
    if (r.includes('admin')) return 'text-red-300 border-red-500/50 bg-red-900/30';
    if (r.includes('stag') || r.includes('intern')) return 'text-teal-300 border-teal-500/50 bg-teal-900/30';
    return 'text-brand-400 border-brand-900 bg-brand-900/50';
  };

  // Ouvrir le groupe contenant la vue active
  useEffect(() => {
    menuStructure.forEach(item => {
      if ('items' in item) {
        if (item.items.some(sub => sub.id === currentView)) {
          if (!openGroups.includes(item.id)) {
            setOpenGroups(prev => [...prev, item.id]);
          }
        }
      }
    });
  }, [currentView]);

  return (
    <div className={`h-screen bg-slate-900 text-white flex flex-col shadow-xl transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      
      {/* Header */}
      <div className={`p-4 flex items-center gap-3 border-b border-slate-700 h-20 ${isCollapsed ? 'justify-center' : ''}`}>
        <div className="bg-brand-500 p-2 rounded-lg flex-shrink-0">
          <ShieldCheck size={24} className="text-white" />
        </div>
        {!isCollapsed && (
          <div className="overflow-hidden whitespace-nowrap animate-fade-in">
            <h1 className="text-xl font-bold tracking-tight">FleetGenius</h1>
            <p className="text-xs text-slate-400">Pro Edition</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 overflow-y-auto custom-scrollbar">
        {menuStructure.map((item) => {
          if (!checkAccess(item)) return null;

          // Fonction pour obtenir le badge count
          // Masque le badge quand l'utilisateur est sur la page concernée
          const getBadgeCount = (badgeKey?: string, itemId?: ViewState): number => {
            if (!badgeKey || !pendingCounts) return 0;
            // Si l'utilisateur est sur cette page, pas besoin du badge
            if (itemId && currentView === itemId) return 0;
            if (badgeKey === 'docs') return pendingDocsCount;
            if (badgeKey === 'leaves') return pendingCounts.leaves;
            if (badgeKey === 'absences') return pendingCounts.absences;
            if (badgeKey === 'issues') return pendingCounts.issues;
            if (badgeKey === 'maintenance') return pendingCounts.maintenance;
            if (badgeKey === 'quotes') return pendingCounts.quotes;
            return 0;
          };

          // === RENDER GROUPE (Accordion) ===
          if ('items' in item) {
            const visibleSubItems = item.items.filter(sub => checkAccess(sub));
            if (visibleSubItems.length === 0) return null;

            const isOpen = openGroups.includes(item.id);
            const isActiveGroup = visibleSubItems.some(sub => sub.id === currentView);
            
            // Badge du groupe = somme des badges de tous les sous-items visibles
            const groupBadge = visibleSubItems.reduce((sum, sub) => sum + getBadgeCount(sub.badgeKey, sub.id), 0);

            return (
              <div key={item.id} className="px-3">
                {!isCollapsed ? (
                  <button
                    onClick={() => toggleGroup(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors mb-1 ${
                      isActiveGroup ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <item.icon size={20} />
                        {/* Badge sur l'icône du groupe (quand fermé) */}
                        {!isOpen && groupBadge > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 animate-pulse">
                            {groupBadge}
                          </span>
                        )}
                      </div>
                      <span className="font-semibold text-sm">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Badge à côté de la flèche (quand fermé) */}
                      {!isOpen && groupBadge > 0 && (
                        <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                          {groupBadge}
                        </span>
                      )}
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                  </button>
                ) : (
                  <div className="flex justify-center mb-2 mt-4 pb-2 border-b border-slate-800 relative">
                    <item.icon size={20} className="text-slate-500" />
                    {/* Badge en mode collapsed */}
                    {groupBadge > 0 && (
                      <span className="absolute -top-1 right-2 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 animate-pulse">
                        {groupBadge}
                      </span>
                    )}
                  </div>
                )}

                {/* Sub Items */}
                <div className={`space-y-1 overflow-hidden transition-all duration-300 ${isOpen || isCollapsed ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  {visibleSubItems.map(subItem => {
                    const isActive = currentView === subItem.id;
                    const itemBadge = getBadgeCount(subItem.badgeKey, subItem.id);
                    
                    return (
                      <button
                        key={subItem.id}
                        onClick={() => onChangeView(subItem.id)}
                        title={isCollapsed ? subItem.label : ''}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-all duration-200 group relative
                          ${!isCollapsed ? 'pl-10' : 'justify-center'} 
                          ${isActive 
                            ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' 
                            : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                          }
                        `}
                      >
                        <div className="flex items-center gap-3">
                          {isCollapsed ? (
                            <div className="relative">
                              <subItem.icon size={20} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'} />
                              {/* Badge en mode collapsed */}
                              {itemBadge > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[14px] h-[14px] flex items-center justify-center rounded-full px-0.5 animate-pulse">
                                  {itemBadge}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-slate-600 group-hover:bg-slate-400'}`}></div>
                          )}
                          {!isCollapsed && <span className="font-medium text-sm">{subItem.label}</span>}
                        </div>
                        {/* Badge à droite de l'item */}
                        {!isCollapsed && itemBadge > 0 && (
                          <span className={`text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1 ${
                            isActive ? 'bg-white text-brand-600' : 'bg-red-500 text-white animate-pulse'
                          }`}>
                            {itemBadge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }

          // === RENDER ITEM SIMPLE ===
          const isActive = currentView === item.id;
          return (
            <div key={item.id} className="px-3">
              <button
                onClick={() => onChangeView(item.id)}
                title={isCollapsed ? item.label : ''}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
                  ${isCollapsed ? 'justify-center' : ''} 
                  ${isActive 
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }
                `}
              >
                <item.icon size={20} className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'} />
                {!isCollapsed && <span className="font-semibold text-sm">{item.label}</span>}
              </button>
            </div>
          );
        })}
      </nav>

      {/* User Zone */}
      <div className={`p-4 border-t border-slate-700 ${isCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
        {/* User info */}
        <div className={`flex items-center gap-3 mb-3 ${isCollapsed ? 'flex-col' : ''}`}>
          <div className="relative">
            {currentUser.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt="Avatar" className="w-10 h-10 rounded-full border-2 border-brand-500 object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center font-bold text-white border-2 border-brand-500">
                {currentUser.firstName?.[0]}{currentUser.lastName?.[0]}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-slate-900"></div>
          </div>
          {!isCollapsed && (
            <div className="overflow-hidden">
              <p className="font-semibold text-white text-sm truncate">{currentUser.firstName} {currentUser.lastName}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide inline-block ${getRoleBadgeStyle()}`}>
                {displayRoleLabel}
              </span>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={onLogout}
          title={isCollapsed ? 'Déconnexion' : ''}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-400 hover:bg-red-600/20 hover:text-red-400 transition-all ${isCollapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={18} />
          {!isCollapsed && <span className="text-sm font-medium">Déconnexion</span>}
        </button>

        {/* Version de l'application (diagnostic cache navigateur) */}
        <p className={`text-[10px] text-slate-600 text-center ${isCollapsed ? '' : 'tracking-wide'}`} title={`Version ${__APP_VERSION__} — build du ${__BUILD_DATE__}`}>
          {isCollapsed ? `v${__APP_VERSION__}` : `v${__APP_VERSION__} · ${__BUILD_DATE__}`}
        </p>
      </div>
    </div>
  );
};

export default Sidebar;
