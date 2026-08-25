/**
 * FleetGenius - Contexte et Hook de Permissions
 * 
 * Fournit un accès centralisé aux permissions dans toute l'application
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { doc, getDoc, setDoc, onSnapshot, collection, getDocs } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { User, UserRole } from './types';
import {
  Permission,
  PermissionKey,
  DEFAULT_ROLE_TEMPLATES,
  RolePermissionTemplate,
  UserPermissionOverrides,
  computeEffectivePermissions,
  hasPermission as checkPermission,
  hasAnyPermission as checkAnyPermission,
  hasAllPermissions as checkAllPermissions,
} from './permissions';
import { normalizeRole } from './utils/role';


// ============================================================================
// TYPES
// ============================================================================

interface PermissionsContextType {
  // État
  isLoading: boolean;
  effectivePermissions: PermissionKey[];
  roleTemplates: Record<UserRole, PermissionKey[]>;
  
  // Vérifications
  hasPermission: (permission: PermissionKey) => boolean;
  hasAnyPermission: (permissions: PermissionKey[]) => boolean;
  hasAllPermissions: (permissions: PermissionKey[]) => boolean;
  
  // Actions (pour ceux qui ont users.permissions)
  updateRoleTemplate: (role: UserRole, permissions: PermissionKey[]) => Promise<void>;
  updateUserOverrides: (userId: string, overrides: UserPermissionOverrides) => Promise<void>;
  getUserOverrides: (userId: string) => Promise<UserPermissionOverrides | null>;
  
  // Utilitaires
  getRoleTemplate: (role: UserRole) => PermissionKey[];
  computeUserPermissions: (user: User, overrides?: UserPermissionOverrides) => PermissionKey[];
}

// ============================================================================
// CONTEXTE
// ============================================================================

const PermissionsContext = createContext<PermissionsContextType | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface PermissionsProviderProps {
  children: ReactNode;
  currentUser: User | null;
}

export const PermissionsProvider: React.FC<PermissionsProviderProps> = ({ children, currentUser }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [roleTemplates, setRoleTemplates] = useState<Record<UserRole, PermissionKey[]>>(DEFAULT_ROLE_TEMPLATES);
  const [userOverrides, setUserOverrides] = useState<UserPermissionOverrides | null>(null);

  // --- Charger les templates de rôles depuis Firestore ---
  useEffect(() => {
    const loadRoleTemplates = async () => {
      try {
        const templatesRef = collection(db, 'rolePermissions');
        const snapshot = await getDocs(templatesRef);
        
        const loaded: Record<string, PermissionKey[]> = {};
        snapshot.forEach(doc => {
          const data = doc.data() as RolePermissionTemplate;
          loaded[data.role] = data.permissions;
        });

        // Merger avec les défauts (les permissions Firestore complètent les défauts)
        // On utilise un Set pour combiner les permissions par défaut ET celles en base
        const merged: Record<string, PermissionKey[]> = {};
        for (const role of Object.keys(DEFAULT_ROLE_TEMPLATES)) {
          const defaults = DEFAULT_ROLE_TEMPLATES[role as UserRole] || [];
          const fromDb = loaded[role] || [];
          // Union des deux listes (pas de doublons)
          const combined = [...new Set([...defaults, ...fromDb])];
          merged[role] = combined;
        }
        
        setRoleTemplates(prev => ({
          ...prev,
          ...merged,
        }));
      } catch (error) {
        console.error('Erreur chargement templates permissions:', error);
        // Garder les défauts en cas d'erreur
      }
    };

    loadRoleTemplates();
  }, []);

  // --- Charger les overrides de l'utilisateur courant ---
  useEffect(() => {
    if (!currentUser?.id) {
      setUserOverrides(null);
      setIsLoading(false);
      return;
    }

    const userRef = doc(db, 'users', currentUser.id);
    
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setUserOverrides(data.customPermissions || null);
      } else {
        setUserOverrides(null);
      }
      setIsLoading(false);
    }, (error) => {
      console.error('Erreur chargement permissions utilisateur:', error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser?.id]);

  // --- Calculer les permissions effectives ---
  const effectivePermissions = useMemo(() => {
    if (!currentUser) return [];
    
    // Normaliser le rôle pour gérer les variations (Président, PRÉSIDENCE, etc.)
    const normalizedRole = normalizeRole(currentUser.role);
    
    // Chercher le template avec le rôle normalisé
    const roleTemplate = roleTemplates[normalizedRole] || DEFAULT_ROLE_TEMPLATES[normalizedRole] || [];
    
    return computeEffectivePermissions(normalizedRole, roleTemplate, userOverrides || undefined);
  }, [currentUser, roleTemplates, userOverrides]);

  // --- Fonctions de vérification ---
  const hasPermission = useCallback((permission: PermissionKey): boolean => {
    return checkPermission(effectivePermissions, permission);
  }, [effectivePermissions]);

  const hasAnyPermission = useCallback((permissions: PermissionKey[]): boolean => {
    return checkAnyPermission(effectivePermissions, permissions);
  }, [effectivePermissions]);

  const hasAllPermissions = useCallback((permissions: PermissionKey[]): boolean => {
    return checkAllPermissions(effectivePermissions, permissions);
  }, [effectivePermissions]);

  // --- Actions admin ---
  const updateRoleTemplate = useCallback(async (role: UserRole, permissions: PermissionKey[]) => {
    if (!currentUser || !hasPermission(Permission.USERS_PERMISSIONS)) {
      throw new Error('Permission refusée');
    }

    const templateRef = doc(db, 'rolePermissions', role);
    await setDoc(templateRef, {
      role,
      permissions,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id,
    });

    // Mettre à jour l'état local
    setRoleTemplates(prev => ({
      ...prev,
      [role]: permissions,
    }));
  }, [currentUser, hasPermission]);

  const updateUserOverrides = useCallback(async (userId: string, overrides: UserPermissionOverrides) => {
    if (!currentUser || !hasPermission(Permission.USERS_PERMISSIONS)) {
      throw new Error('Permission refusée');
    }

    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, {
      customPermissions: overrides,
    }, { merge: true });
  }, [currentUser, hasPermission]);

  const getUserOverrides = useCallback(async (userId: string): Promise<UserPermissionOverrides | null> => {
    try {
      const userRef = doc(db, 'users', userId);
      const snapshot = await getDoc(userRef);
      
      if (snapshot.exists()) {
        const data = snapshot.data();
        return data.customPermissions || null;
      }
      return null;
    } catch (error) {
      console.error('Erreur lecture overrides utilisateur:', error);
      return null;
    }
  }, []);

  // --- Utilitaires ---
  const getRoleTemplate = useCallback((role: UserRole): PermissionKey[] => {
    const normalizedRole = normalizeRole(role);
    return roleTemplates[normalizedRole] || DEFAULT_ROLE_TEMPLATES[normalizedRole] || [];
  }, [roleTemplates]);

  const computeUserPermissions = useCallback((user: User, overrides?: UserPermissionOverrides): PermissionKey[] => {
    const normalizedRole = normalizeRole(user.role);
    const roleTemplate = roleTemplates[normalizedRole] || DEFAULT_ROLE_TEMPLATES[normalizedRole] || [];
    return computeEffectivePermissions(normalizedRole, roleTemplate, overrides);
  }, [roleTemplates]);

  // --- Valeur du contexte ---
  const value = useMemo<PermissionsContextType>(() => ({
    isLoading,
    effectivePermissions,
    roleTemplates,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    updateRoleTemplate,
    updateUserOverrides,
    getUserOverrides,
    getRoleTemplate,
    computeUserPermissions,
  }), [
    isLoading,
    effectivePermissions,
    roleTemplates,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    updateRoleTemplate,
    updateUserOverrides,
    getUserOverrides,
    getRoleTemplate,
    computeUserPermissions,
  ]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook pour accéder aux permissions
 * @returns PermissionsContextType
 * @throws Error si utilisé en dehors du PermissionsProvider
 */
export function usePermissions(): PermissionsContextType {
  const context = useContext(PermissionsContext);
  
  if (!context) {
    throw new Error('usePermissions doit être utilisé dans un PermissionsProvider');
  }
  
  return context;
}

// ============================================================================
// COMPOSANT CONDITIONNEL
// ============================================================================

interface CanProps {
  permission?: PermissionKey;
  permissions?: PermissionKey[];
  requireAll?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Composant pour afficher conditionnellement du contenu basé sur les permissions
 * 
 * @example
 * <Can permission={Permission.VEHICLES_CREATE}>
 *   <button>Ajouter un véhicule</button>
 * </Can>
 * 
 * @example
 * <Can permissions={[Permission.FUEL_VIEW, Permission.FUEL_CREATE]} requireAll>
 *   <FuelManager />
 * </Can>
 */
export const Can: React.FC<CanProps> = ({ 
  permission, 
  permissions, 
  requireAll = false, 
  children, 
  fallback = null 
}) => {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

  let hasAccess = false;

  if (permission) {
    hasAccess = hasPermission(permission);
  } else if (permissions) {
    hasAccess = requireAll 
      ? hasAllPermissions(permissions) 
      : hasAnyPermission(permissions);
  }

  return <>{hasAccess ? children : fallback}</>;
};

// ============================================================================
// EXPORT PERMISSION POUR FACILITER L'IMPORT
// ============================================================================

export { Permission } from './permissions';
export type { PermissionKey } from './permissions';
