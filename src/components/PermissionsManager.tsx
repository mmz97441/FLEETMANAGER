/**
 * FleetGenius - Gestionnaire de Permissions
 * 
 * Interface pour gérer les permissions par rôle et par utilisateur
 * Accessible uniquement aux utilisateurs avec la permission users.permissions
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Shield, 
  Users, 
  User as UserIcon, 
  Check, 
  X, 
  ChevronDown, 
  ChevronRight,
  Search,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Plus,
  Minus,
  Info
} from 'lucide-react';
import { User, UserRole } from '../types';
import { usePermissions, Permission, PermissionKey } from '../usePermissions';
import { 
  PERMISSION_CATEGORIES, 
  PermissionCategory,
  DEFAULT_ROLE_TEMPLATES,
  UserPermissionOverrides 
} from '../permissions';

// ============================================================================
// TYPES
// ============================================================================

interface PermissionsManagerProps {
  users: User[];
  currentUser: User;
}

type TabType = 'roles' | 'users';

// ============================================================================
// COMPOSANTS INTERNES
// ============================================================================

// --- Catégorie de permissions (accordéon) ---
interface PermissionCategoryAccordionProps {
  category: PermissionCategory;
  selectedPermissions: PermissionKey[];
  onToggle: (permission: PermissionKey) => void;
  isExpanded: boolean;
  onExpandToggle: () => void;
  mode?: 'template' | 'override';
  basePermissions?: PermissionKey[]; // Pour le mode override, les permissions du template
  overrides?: UserPermissionOverrides;
}

const PermissionCategoryAccordion: React.FC<PermissionCategoryAccordionProps> = ({
  category,
  selectedPermissions,
  onToggle,
  isExpanded,
  onExpandToggle,
  mode = 'template',
  basePermissions = [],
  overrides,
}) => {
  const enabledCount = category.permissions.filter(p => selectedPermissions.includes(p.key)).length;
  const totalCount = category.permissions.length;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onExpandToggle}
        className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 flex items-center justify-between transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{category.icon}</span>
          <span className="font-semibold text-slate-800">{category.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            enabledCount === totalCount ? 'bg-green-100 text-green-700' :
            enabledCount > 0 ? 'bg-amber-100 text-amber-700' :
            'bg-slate-200 text-slate-500'
          }`}>
            {enabledCount}/{totalCount}
          </span>
        </div>
        {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
      </button>

      {/* Permissions list */}
      {isExpanded && (
        <div className="p-4 space-y-2 bg-white">
          {category.permissions.map((perm) => {
            const isSelected = selectedPermissions.includes(perm.key);
            const isFromTemplate = mode === 'override' && basePermissions.includes(perm.key);
            const isGranted = mode === 'override' && overrides?.granted?.includes(perm.key);
            const isRevoked = mode === 'override' && overrides?.revoked?.includes(perm.key);

            return (
              <div 
                key={perm.key}
                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                  isSelected 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{perm.label}</span>
                    {mode === 'override' && (
                      <>
                        {isFromTemplate && !isRevoked && (
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600">
                            Hérité
                          </span>
                        )}
                        {isGranted && (
                          <span className="text-xs px-2 py-0.5 rounded bg-green-200 text-green-700">
                            <Plus size={10} className="inline mr-1" />Ajouté
                          </span>
                        )}
                        {isRevoked && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-200 text-red-700">
                            <Minus size={10} className="inline mr-1" />Retiré
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {perm.description && (
                    <p className="text-sm text-slate-500 mt-0.5">{perm.description}</p>
                  )}
                </div>
                <button
                  onClick={() => onToggle(perm.key)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                    isSelected 
                      ? 'bg-green-500 text-white hover:bg-green-600' 
                      : 'bg-slate-200 text-slate-400 hover:bg-slate-300'
                  }`}
                >
                  {isSelected ? <Check size={20} /> : <X size={20} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// --- Sélecteur de rôle ---
interface RoleSelectorProps {
  selectedRole: UserRole;
  onSelect: (role: UserRole) => void;
}

const RoleSelector: React.FC<RoleSelectorProps> = ({ selectedRole, onSelect }) => {
  const roles = Object.values(UserRole).filter(r => r !== UserRole.ADMIN); // Admin a tout

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case UserRole.PRESIDENT: return '👔';
      case UserRole.DIRECTOR: return '📊';
      case UserRole.SECRETARY: return '📝';
      case UserRole.DRIVER: return '🚛';
      case UserRole.MECHANIC: return '🔧';
      case UserRole.CLIENT: return '🏢';
      case UserRole.INTERN: return '🎓';
      default: return '👤';
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {roles.map(role => (
        <button
          key={role}
          onClick={() => onSelect(role)}
          className={`px-4 py-2 rounded-xl font-medium flex items-center gap-2 transition-all ${
            selectedRole === role
              ? 'bg-slate-900 text-white shadow-lg'
              : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
          }`}
        >
          <span>{getRoleIcon(role)}</span>
          {role}
        </button>
      ))}
    </div>
  );
};

// --- Sélecteur d'utilisateur ---
interface UserSelectorProps {
  users: User[];
  selectedUser: User | null;
  onSelect: (user: User | null) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
}

const UserSelector: React.FC<UserSelectorProps> = ({ 
  users, 
  selectedUser, 
  onSelect, 
  searchTerm, 
  onSearchChange 
}) => {
  const filteredUsers = useMemo(() => {
    if (!searchTerm) return users;
    const term = searchTerm.toLowerCase();
    return users.filter(u => 
      u.firstName?.toLowerCase().includes(term) ||
      u.lastName?.toLowerCase().includes(term) ||
      u.email?.toLowerCase().includes(term) ||
      u.role?.toLowerCase().includes(term)
    );
  }, [users, searchTerm]);

  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case UserRole.PRESIDENT: return 'bg-purple-100 text-purple-700';
      case UserRole.DIRECTOR: return 'bg-blue-100 text-blue-700';
      case UserRole.SECRETARY: return 'bg-pink-100 text-pink-700';
      case UserRole.DRIVER: return 'bg-green-100 text-green-700';
      case UserRole.MECHANIC: return 'bg-orange-100 text-orange-700';
      case UserRole.CLIENT: return 'bg-cyan-100 text-cyan-700';
      case UserRole.INTERN: return 'bg-amber-100 text-amber-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input
          type="text"
          placeholder="Rechercher un utilisateur..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent"
        />
      </div>

      {/* Users list */}
      <div className="max-h-64 overflow-y-auto space-y-2 border border-slate-200 rounded-xl p-2">
        {filteredUsers.length === 0 ? (
          <p className="text-center text-slate-500 py-4">Aucun utilisateur trouvé</p>
        ) : (
          filteredUsers.map(user => (
            <button
              key={user.id}
              onClick={() => onSelect(user)}
              className={`w-full p-3 rounded-lg flex items-center gap-3 transition-all ${
                selectedUser?.id === user.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-white hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                selectedUser?.id === user.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {user.firstName?.[0]}{user.lastName?.[0]}
              </div>
              <div className="flex-1 text-left">
                <div className={`font-medium ${selectedUser?.id === user.id ? 'text-white' : 'text-slate-800'}`}>
                  {user.firstName} {user.lastName}
                </div>
                <div className={`text-sm ${selectedUser?.id === user.id ? 'text-white/70' : 'text-slate-500'}`}>
                  {user.email}
                </div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                selectedUser?.id === user.id ? 'bg-white/20 text-white' : getRoleColor(user.role)
              }`}>
                {user.role}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export const PermissionsManager: React.FC<PermissionsManagerProps> = ({ users, currentUser }) => {
  const { 
    hasPermission, 
    getRoleTemplate, 
    updateRoleTemplate, 
    updateUserOverrides,
    getUserOverrides,
    computeUserPermissions 
  } = usePermissions();

  // --- États ---
  const [activeTab, setActiveTab] = useState<TabType>('roles');
  const [selectedRole, setSelectedRole] = useState<UserRole>(UserRole.DRIVER);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['dashboard']);
  
  // Permissions en cours d'édition
  const [rolePermissions, setRolePermissions] = useState<PermissionKey[]>([]);
  const [userOverrides, setUserOverrides] = useState<UserPermissionOverrides>({ granted: [], revoked: [] });
  
  // État de sauvegarde
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [hasChanges, setHasChanges] = useState(false);

  // --- Vérification d'accès ---
  const canManagePermissions = hasPermission(Permission.USERS_PERMISSIONS);

  // --- Charger les permissions du rôle sélectionné ---
  useEffect(() => {
    if (activeTab === 'roles') {
      const template = getRoleTemplate(selectedRole);
      setRolePermissions(template);
      setHasChanges(false);
    }
  }, [selectedRole, activeTab, getRoleTemplate]);

  // --- Charger les overrides de l'utilisateur sélectionné ---
  useEffect(() => {
    if (activeTab === 'users' && selectedUser) {
      (async () => {
        const overrides = await getUserOverrides(selectedUser.id);
        setUserOverrides(overrides || { granted: [], revoked: [] });
        setHasChanges(false);
      })();
    }
  }, [selectedUser, activeTab, getUserOverrides]);

  // --- Toggle catégorie ---
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => 
      prev.includes(categoryId) 
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  // --- Toggle permission (mode rôle) ---
  const toggleRolePermission = (permission: PermissionKey) => {
    setRolePermissions(prev => {
      const newPerms = prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission];
      setHasChanges(true);
      return newPerms;
    });
  };

  // --- Toggle permission (mode utilisateur) ---
  const toggleUserPermission = (permission: PermissionKey) => {
    if (!selectedUser) return;

    const baseTemplate = getRoleTemplate(selectedUser.role);
    const isInTemplate = baseTemplate.includes(permission);

    setUserOverrides(prev => {
      const newOverrides = { ...prev };
      
      if (isInTemplate) {
        // Permission du template: on peut la révoquer
        if (prev.revoked?.includes(permission)) {
          // Déjà révoquée -> retirer la révocation
          newOverrides.revoked = prev.revoked.filter(p => p !== permission);
        } else {
          // Pas révoquée -> ajouter aux révocations
          newOverrides.revoked = [...(prev.revoked || []), permission];
        }
      } else {
        // Permission pas dans le template: on peut l'ajouter
        if (prev.granted?.includes(permission)) {
          // Déjà ajoutée -> retirer l'ajout
          newOverrides.granted = prev.granted.filter(p => p !== permission);
        } else {
          // Pas ajoutée -> ajouter aux ajouts
          newOverrides.granted = [...(prev.granted || []), permission];
        }
      }

      setHasChanges(true);
      return newOverrides;
    });
  };

  // --- Calcul des permissions effectives pour l'utilisateur ---
  const effectiveUserPermissions = useMemo(() => {
    if (!selectedUser) return [];
    return computeUserPermissions(selectedUser, userOverrides);
  }, [selectedUser, userOverrides, computeUserPermissions]);

  // --- Sauvegarder ---
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      if (activeTab === 'roles') {
        await updateRoleTemplate(selectedRole, rolePermissions);
      } else if (selectedUser) {
        await updateUserOverrides(selectedUser.id, userOverrides);
      }
      setSaveStatus('success');
      setHasChanges(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      console.error('Erreur sauvegarde permissions:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Réinitialiser aux défauts ---
  const handleReset = () => {
    if (activeTab === 'roles') {
      setRolePermissions(DEFAULT_ROLE_TEMPLATES[selectedRole] || []);
      setHasChanges(true);
    } else {
      setUserOverrides({ granted: [], revoked: [] });
      setHasChanges(true);
    }
  };

  // --- Pas d'accès ---
  if (!canManagePermissions) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-500">
        <Shield size={64} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-bold text-slate-700">Accès refusé</h2>
        <p>Vous n'avez pas la permission de gérer les permissions.</p>
      </div>
    );
  }

  // --- Filtrer les utilisateurs (exclure admin et soi-même pour les permissions) ---
  const manageableUsers = users.filter(u => 
    u.role !== UserRole.ADMIN && 
    u.id !== currentUser.id
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-900 rounded-xl">
            <Shield size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Gestion des Permissions</h1>
            <p className="text-slate-500">Configurez les accès par rôle ou par utilisateur</p>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3">
          {saveStatus === 'success' && (
            <span className="flex items-center gap-2 text-green-600">
              <CheckCircle size={18} />
              Enregistré
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-2 text-red-600">
              <AlertCircle size={18} />
              Erreur
            </span>
          )}
          <button
            onClick={handleReset}
            className="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 flex items-center gap-2"
            disabled={isSaving}
          >
            <RefreshCw size={18} />
            Réinitialiser
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className={`px-6 py-2 rounded-xl font-semibold flex items-center gap-2 transition-all ${
              hasChanges
                ? 'bg-slate-900 text-white hover:bg-black'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSaving ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Save size={18} />
            )}
            Enregistrer
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-4">
        <button
          onClick={() => setActiveTab('roles')}
          className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
            activeTab === 'roles'
              ? 'bg-slate-900 text-white shadow-lg'
              : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
          }`}
        >
          <Users size={20} />
          Par rôle
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-3 rounded-xl font-semibold flex items-center gap-2 transition-all ${
            activeTab === 'users'
              ? 'bg-slate-900 text-white shadow-lg'
              : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-400'
          }`}
        >
          <UserIcon size={20} />
          Par utilisateur
        </button>
      </div>

      {/* Content */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left panel: Selector */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            {activeTab === 'roles' ? (
              <>
                <h3 className="font-semibold text-slate-800 mb-4">Sélectionner un rôle</h3>
                <RoleSelector selectedRole={selectedRole} onSelect={setSelectedRole} />
                
                {/* Info box */}
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="flex gap-2">
                    <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-700">
                      <p className="font-medium">Template de rôle</p>
                      <p className="mt-1">
                        Les permissions définies ici s'appliquent par défaut à tous les utilisateurs 
                        ayant le rôle <strong>{selectedRole}</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-slate-800 mb-4">Sélectionner un utilisateur</h3>
                <UserSelector 
                  users={manageableUsers}
                  selectedUser={selectedUser}
                  onSelect={setSelectedUser}
                  searchTerm={userSearchTerm}
                  onSearchChange={setUserSearchTerm}
                />

                {selectedUser && (
                  <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex gap-2">
                      <Info size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-amber-700">
                        <p className="font-medium">Exceptions utilisateur</p>
                        <p className="mt-1">
                          <strong>{selectedUser.firstName}</strong> a le rôle <strong>{selectedUser.role}</strong>. 
                          Vous pouvez ajouter ou retirer des permissions spécifiquement pour cet utilisateur.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right panel: Permissions */}
        <div className="col-span-12 lg:col-span-8">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            {activeTab === 'roles' ? (
              <>
                <h3 className="font-semibold text-slate-800 mb-4">
                  Permissions pour le rôle: {selectedRole}
                </h3>
                <div className="space-y-3">
                  {PERMISSION_CATEGORIES.map(category => (
                    <PermissionCategoryAccordion
                      key={category.id}
                      category={category}
                      selectedPermissions={rolePermissions}
                      onToggle={toggleRolePermission}
                      isExpanded={expandedCategories.includes(category.id)}
                      onExpandToggle={() => toggleCategory(category.id)}
                      mode="template"
                    />
                  ))}
                </div>
              </>
            ) : selectedUser ? (
              <>
                <h3 className="font-semibold text-slate-800 mb-4">
                  Permissions pour: {selectedUser.firstName} {selectedUser.lastName}
                </h3>
                <div className="space-y-3">
                  {PERMISSION_CATEGORIES.map(category => (
                    <PermissionCategoryAccordion
                      key={category.id}
                      category={category}
                      selectedPermissions={effectiveUserPermissions}
                      onToggle={toggleUserPermission}
                      isExpanded={expandedCategories.includes(category.id)}
                      onExpandToggle={() => toggleCategory(category.id)}
                      mode="override"
                      basePermissions={getRoleTemplate(selectedUser.role)}
                      overrides={userOverrides}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <UserIcon size={48} className="text-slate-300 mb-4" />
                <p>Sélectionnez un utilisateur pour gérer ses permissions</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PermissionsManager;
