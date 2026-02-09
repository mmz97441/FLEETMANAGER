
import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, Truck, Users, BrainCircuit, Droplet, Wrench, 
  AlertCircle, HelpCircle, LogOut, ShieldCheck, Building2,
  FileCheck, CalendarDays, ChevronDown, ChevronRight,
  ShoppingBag, Euro, List, Settings as SettingsIcon, FileSignature,
  UserCog, Bell, Download, ClipboardList, Palmtree, Shield,
  Route, Package, MapPin, Activity, Clock, Navigation
} from 'lucide-react';
import { ViewState, User, UserRole } from '../types';
import { usePermissions, Permission, PermissionKey } from '../usePermissions';
import { normalizeRole } from '../utils/roleUtils';

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
    // TABLEAU DE BORD
    // ─────────────────────────────────────────────────────
    { 
      id: 'dashboard', 
      label: 'Tableau de Bord', 
      icon: LayoutDashboard, 
      permission: Permission.DASHBOARD_VIEW
    },

    // ─────────────────────────────────────────────────────
    // 🚛 FLOTTE - Tout ce qui touche aux véhicules
    // ─────────────────────────────────────────────────────
    {
      id: 'flotte',
      label: 'Flotte',
      icon: Truck,
      permission: Permission.VEHICLES_VIEW,
      items: [
        { id: 'vehicles', label: 'Véhicules', icon: Truck, permission: Permission.VEHICLES_VIEW },
        { id: 'fuel', label: 'Carburant', icon: Droplet, permission: Permission.FUEL_VIEW },
        { id: 'maintenance', label: 'Maintenance', icon: Wrench, permission: Permission.MAINTENANCE_VIEW, badgeKey: 'maintenance' },
        { id: 'issues', label: 'Incidents', icon: AlertCircle, permission: Permission.ISSUES_VIEW, badgeKey: 'issues' },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 💼 ACTIVITÉ - Commercial et transport
    // ─────────────────────────────────────────────────────
    {
      id: 'activite',
      label: 'Activité',
      icon: Euro,
      permission: Permission.QUOTES_VIEW,
      items: [
        { id: 'quotes', label: 'Demandes & Devis', icon: FileCheck, permission: Permission.QUOTES_VIEW, badgeKey: 'quotes' },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 🚚 MISSIONS - Tournées et livraisons
    // ─────────────────────────────────────────────────────
    { 
      id: 'missions', 
      label: 'Missions', 
      icon: Route, 
      permission: Permission.MISSIONS_VIEW
    },
    {
      id: 'driver_tour',
      label: 'Ma Tournée',
      icon: Navigation,
      permission: Permission.MISSIONS_VIEW_OWN
    },
    {
      id: 'hub_operations',
      label: 'Opérations Hub',
      icon: Package,
      permission: Permission.MISSIONS_VIEW
    },

    // ─────────────────────────────────────────────────────
    // 👥 ÉQUIPE - Gestion des personnes
    // ─────────────────────────────────────────────────────
    {
      id: 'equipe',
      label: 'Équipe',
      icon: Users,
      permissions: [Permission.DRIVERS_VIEW, Permission.ABSENCES_VIEW_OWN, Permission.DOCS_VIEW_OWN],
      badgeKey: 'docs', // Badge sur le groupe si docs en attente
      items: [
        { id: 'drivers', label: 'Chauffeurs', icon: Users, permission: Permission.DRIVERS_VIEW },
        { id: 'leaves', label: 'Congés', icon: Palmtree, permission: Permission.ABSENCES_VIEW_OWN, badgeKey: 'leaves' },
        { id: 'absences', label: 'Absences', icon: CalendarDays, permission: Permission.ABSENCES_VIEW_OWN, badgeKey: 'absences' },
        { id: 'company_docs', label: 'Documents', icon: FileSignature, permission: Permission.DOCS_VIEW_ALL, badgeKey: 'docs' },
        // Vue spéciale chauffeur pour ses propres documents
        { id: 'documents', label: 'Mes Documents', icon: FileCheck, permission: Permission.DOCS_VIEW_OWN, badgeKey: 'docs' },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 🤖 FLEETGENIUS IA - Accès direct
    // ─────────────────────────────────────────────────────
    { 
      id: 'ai_advisor', 
      label: 'FleetGenius IA', 
      icon: BrainCircuit, 
      permission: Permission.AI_ACCESS
    },

    // ─────────────────────────────────────────────────────
    // ⚙️ ADMINISTRATION - Gestion du système
    // ─────────────────────────────────────────────────────
    {
      id: 'administration',
      label: 'Administration',
      icon: UserCog,
      permission: Permission.USERS_VIEW,
      items: [
        { id: 'users', label: 'Utilisateurs', icon: Users, permission: Permission.USERS_VIEW },
        { id: 'permissions', label: 'Permissions', icon: Shield, permission: Permission.USERS_PERMISSIONS },
        { id: 'company_settings', label: 'Entreprise', icon: Building2, permission: Permission.SETTINGS_COMPANY },
        { id: 'activity_logs', label: 'Logs d\'activité', icon: ClipboardList, permission: Permission.LOGS_VIEW },
      ]
    },

    // ─────────────────────────────────────────────────────
    // 🔧 PARAMÈTRES - Configuration
    // ─────────────────────────────────────────────────────
    {
      id: 'parametres',
      label: 'Paramètres',
      icon: SettingsIcon,
      permission: Permission.SETTINGS_ACCESS,
      items: [
        { id: 'settings', label: 'Préférences', icon: SettingsIcon, permission: Permission.SETTINGS_ACCESS },
        { id: 'delivery_schedule', label: 'Horaires livraison', icon: Clock, permission: Permission.SETTINGS_COMPANY },
        { id: 'notifications_settings', label: 'Notifications', icon: Bell, permission: Permission.SETTINGS_ACCESS },
        { id: 'import_export', label: 'Imports / Exports', icon: Download, permission: Permission.IMPORT_EXPORT_ACCESS },
        { id: 'api_diagnostic', label: 'Diagnostic API', icon: Activity, permission: Permission.SETTINGS_COMPANY },
      ]
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
        { id: 'client_dashboard', label: 'Tableau de Bord', icon: LayoutDashboard, permission: Permission.CLIENT_DASHBOARD },
        { id: 'client_list', label: 'Mes Demandes', icon: List, permission: Permission.CLIENT_REQUESTS_VIEW_OWN },
        { id: 'client_shipments', label: 'Mes Expéditions', icon: Package, permission: Permission.CLIENT_REQUESTS_VIEW_OWN },
        { id: 'client_team', label: 'Mon Équipe', icon: Users, permission: Permission.CLIENT_TEAM_VIEW },
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
    const r = normalizeRole(currentUser.role);
    if (r === UserRole.DIRECTOR) return "Direction";
    if (r === UserRole.PRESIDENT) return "Présidence";
    if (r === UserRole.SECRETARY) return "Secrétariat";
    if (r === UserRole.DRIVER) return "Chauffeur";
    if (r === UserRole.MECHANIC) return "Mécanicien";
    if (r === UserRole.ADMIN) return "Admin";
    if (r === UserRole.CLIENT) return "Client";
    if (r === UserRole.INTERN) return "Stagiaire";
    return currentUser.role;
  }, [currentUser.role]);

  // Badge couleur selon le rôle
  const getRoleBadgeStyle = () => {
    const r = normalizeRole(currentUser.role);
    if (r === UserRole.PRESIDENT) return 'text-amber-300 border-amber-500/50 bg-amber-900/30';
    if (r === UserRole.DIRECTOR) return 'text-indigo-300 border-indigo-500/50 bg-indigo-900/30';
    if (r === UserRole.SECRETARY) return 'text-purple-300 border-purple-500/50 bg-purple-900/30';
    if (r === UserRole.ADMIN) return 'text-red-300 border-red-500/50 bg-red-900/30';
    if (r === UserRole.INTERN) return 'text-teal-300 border-teal-500/50 bg-teal-900/30';
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
      </div>
    </div>
  );
};

export default Sidebar;
