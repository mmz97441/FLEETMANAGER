/**
 * FleetGenius - Système de Permissions Hybride
 * 
 * Architecture:
 * - Templates par rôle (permissions par défaut)
 * - Exceptions par utilisateur (ajout/retrait de permissions)
 * - Permissions effectives = Template[rôle] + exceptions[user]
 */

import { UserRole } from './types';

// ============================================================================
// DÉFINITION DES PERMISSIONS
// ============================================================================

/**
 * Liste exhaustive des permissions de l'application
 * Organisées par catégorie pour l'UI
 */
export const Permission = {
  // --- TABLEAU DE BORD ---
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_KPI_FLEET: 'dashboard.kpi.fleet',
  DASHBOARD_KPI_FUEL: 'dashboard.kpi.fuel',
  DASHBOARD_KPI_FUEL_COSTS: 'dashboard.kpi.fuel.costs',
  DASHBOARD_KPI_MAINTENANCE: 'dashboard.kpi.maintenance',
  DASHBOARD_KPI_MAINTENANCE_COSTS: 'dashboard.kpi.maintenance.costs',
  DASHBOARD_KPI_HR: 'dashboard.kpi.hr',
  DASHBOARD_KPI_FINANCIAL: 'dashboard.kpi.financial',
  DASHBOARD_ALERTS_DOCUMENTS: 'dashboard.alerts.documents',
  DASHBOARD_ALERTS_TODO: 'dashboard.alerts.todo',

  // --- FLOTTE - VÉHICULES ---
  VEHICLES_VIEW: 'vehicles.view',
  VEHICLES_VIEW_ALL: 'vehicles.view.all',
  VEHICLES_VIEW_DETAIL: 'vehicles.view.detail',
  VEHICLES_CREATE: 'vehicles.create',
  VEHICLES_EDIT: 'vehicles.edit',
  VEHICLES_DELETE: 'vehicles.delete',
  VEHICLES_ASSIGN: 'vehicles.assign',
  VEHICLES_EXPORT: 'vehicles.export',

  // --- CARBURANT ---
  FUEL_VIEW: 'fuel.view',
  FUEL_VIEW_ALL: 'fuel.view.all',
  FUEL_VIEW_COSTS: 'fuel.view.costs',
  FUEL_CREATE: 'fuel.create',
  FUEL_EDIT: 'fuel.edit',
  FUEL_DELETE: 'fuel.delete',
  FUEL_EXPORT: 'fuel.export',

  // --- MAINTENANCE ---
  MAINTENANCE_VIEW: 'maintenance.view',
  MAINTENANCE_VIEW_ALL: 'maintenance.view.all',
  MAINTENANCE_VIEW_COSTS: 'maintenance.view.costs',
  MAINTENANCE_CREATE: 'maintenance.create',
  MAINTENANCE_EDIT: 'maintenance.edit',
  MAINTENANCE_DELETE: 'maintenance.delete',

  // --- INCIDENTS ---
  ISSUES_VIEW: 'issues.view',
  ISSUES_VIEW_ALL: 'issues.view.all',
  ISSUES_CREATE: 'issues.create',
  ISSUES_MANAGE: 'issues.manage',
  ISSUES_RESOLVE: 'issues.resolve',

  // --- CONGÉS & ABSENCES ---
  ABSENCES_VIEW_OWN: 'absences.view.own',
  ABSENCES_VIEW_TEAM: 'absences.view.team',
  ABSENCES_VIEW_ALL: 'absences.view.all',
  ABSENCES_CREATE: 'absences.create',
  ABSENCES_EDIT_OWN: 'absences.edit.own',
  ABSENCES_DELETE_OWN: 'absences.delete.own',
  ABSENCES_VALIDATE: 'absences.validate',
  ABSENCES_VALIDATE_EXCLUDE_OWN: 'absences.validate.exclude_own',
  ABSENCES_REPORT: 'absences.report',

  // --- ÉQUIPE - CHAUFFEURS ---
  DRIVERS_VIEW: 'drivers.view',
  DRIVERS_VIEW_DETAIL: 'drivers.view.detail',
  DRIVERS_EDIT: 'drivers.edit',

  // --- UTILISATEURS ---
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_EDIT: 'users.edit',
  USERS_DELETE: 'users.delete',
  USERS_INVITE_RESEND: 'users.invite.resend',
  USERS_PERMISSIONS: 'users.permissions',

  // --- DOCUMENTS ---
  DOCS_VIEW_OWN: 'docs.view.own',
  DOCS_VIEW_ALL: 'docs.view.all',
  DOCS_MANAGE: 'docs.manage',
  DOCS_ACKNOWLEDGE: 'docs.acknowledge',

  // --- DEVIS & TRANSPORT ---
  QUOTES_VIEW: 'quotes.view',
  QUOTES_VIEW_ALL: 'quotes.view.all',
  QUOTES_CREATE: 'quotes.create',
  QUOTES_EDIT: 'quotes.edit',
  QUOTES_DELETE: 'quotes.delete',
  QUOTES_VALIDATE: 'quotes.validate',
  QUOTES_STATUS_UPDATE: 'quotes.status.update',

  // --- OUTILS & PARAMÈTRES ---
  AI_ACCESS: 'ai.access',
  SETTINGS_ACCESS: 'settings.access',
  SETTINGS_COMPANY: 'settings.company',
  LOGS_VIEW: 'logs.view',
  IMPORT_EXPORT_ACCESS: 'import_export.access',

  // --- MISSIONS & TOURNÉES ---
  MISSIONS_VIEW: 'missions.view',
  MISSIONS_VIEW_ALL: 'missions.view.all',
  MISSIONS_VIEW_OWN: 'missions.view.own',
  MISSIONS_CREATE: 'missions.create',
  MISSIONS_EDIT: 'missions.edit',
  MISSIONS_DELETE: 'missions.delete',
  MISSIONS_DISPATCH: 'missions.dispatch',
  MISSIONS_IMPORT: 'missions.import',
  MISSIONS_OPTIMIZE: 'missions.optimize',
  PACKAGES_VIEW: 'packages.view',
  PACKAGES_SCAN: 'packages.scan',
  PACKAGES_POD: 'packages.pod',
  PACKAGES_TRANSFER: 'packages.transfer',
  HUBS_VIEW: 'hubs.view',
  HUBS_MANAGE: 'hubs.manage',

  // --- PORTAIL CLIENT ---
  CLIENT_DASHBOARD: 'client.dashboard',
  CLIENT_REQUESTS_VIEW_OWN: 'client.requests.view.own',
  CLIENT_REQUESTS_VIEW_TEAM: 'client.requests.view.team',
  CLIENT_REQUESTS_CREATE: 'client.requests.create',
  CLIENT_REQUESTS_VALIDATE: 'client.requests.validate',
  CLIENT_TEAM_VIEW: 'client.team.view',
  CLIENT_TEAM_MANAGE: 'client.team.manage',
  CLIENT_TEAM_INVITE_RESEND: 'client.team.invite.resend',
  CLIENT_ADDRESSES_VIEW: 'client.addresses.view',
  CLIENT_ADDRESSES_MANAGE: 'client.addresses.manage',
} as const;

export type PermissionKey = typeof Permission[keyof typeof Permission];

// ============================================================================
// CATÉGORIES DE PERMISSIONS (pour l'UI)
// ============================================================================

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  description: string;
}

export interface PermissionCategory {
  id: string;
  label: string;
  icon: string;
  permissions: PermissionDefinition[];
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    id: 'dashboard',
    label: 'Tableau de Bord',
    icon: '📊',
    permissions: [
      { key: Permission.DASHBOARD_VIEW, label: 'Voir le tableau de bord', description: 'Accès à la page dashboard' },
      { key: Permission.DASHBOARD_KPI_FLEET, label: 'Voir KPIs flotte', description: 'Véhicules actifs, disponibilité' },
      { key: Permission.DASHBOARD_KPI_FUEL, label: 'Voir KPIs carburant', description: 'Consommation, litres' },
      { key: Permission.DASHBOARD_KPI_FUEL_COSTS, label: 'Voir coûts carburant (€)', description: 'Montants en euros' },
      { key: Permission.DASHBOARD_KPI_MAINTENANCE, label: 'Voir KPIs maintenance', description: 'Interventions, alertes' },
      { key: Permission.DASHBOARD_KPI_MAINTENANCE_COSTS, label: 'Voir coûts maintenance (€)', description: 'Montants en euros' },
      { key: Permission.DASHBOARD_KPI_HR, label: 'Voir KPIs RH', description: 'Effectifs, absents' },
      { key: Permission.DASHBOARD_KPI_FINANCIAL, label: 'Voir KPIs financiers complets', description: 'Tous les coûts détaillés' },
      { key: Permission.DASHBOARD_ALERTS_DOCUMENTS, label: 'Voir alertes documents', description: 'CT, permis, FCO expirés' },
      { key: Permission.DASHBOARD_ALERTS_TODO, label: 'Voir "À traiter"', description: 'Congés à valider, incidents' },
    ]
  },
  {
    id: 'vehicles',
    label: 'Flotte - Véhicules',
    icon: '🚛',
    permissions: [
      { key: Permission.VEHICLES_VIEW, label: 'Voir les véhicules', description: 'Liste des véhicules' },
      { key: Permission.VEHICLES_VIEW_ALL, label: 'Voir TOUS les véhicules', description: 'Sinon = seulement le sien' },
      { key: Permission.VEHICLES_VIEW_DETAIL, label: 'Voir le détail', description: 'Fiche complète véhicule' },
      { key: Permission.VEHICLES_CREATE, label: 'Ajouter un véhicule', description: '' },
      { key: Permission.VEHICLES_EDIT, label: 'Modifier un véhicule', description: '' },
      { key: Permission.VEHICLES_DELETE, label: 'Supprimer un véhicule', description: '' },
      { key: Permission.VEHICLES_ASSIGN, label: 'Attribuer véhicule ↔ chauffeur', description: 'Lier/délier' },
      { key: Permission.VEHICLES_EXPORT, label: 'Exporter données véhicule', description: 'Export CSV' },
    ]
  },
  {
    id: 'fuel',
    label: 'Carburant',
    icon: '⛽',
    permissions: [
      { key: Permission.FUEL_VIEW, label: 'Voir les pleins', description: '' },
      { key: Permission.FUEL_VIEW_ALL, label: 'Voir TOUS les pleins', description: 'Sinon = seulement les siens' },
      { key: Permission.FUEL_VIEW_COSTS, label: 'Voir les montants (€)', description: '' },
      { key: Permission.FUEL_CREATE, label: 'Ajouter un plein', description: '' },
      { key: Permission.FUEL_EDIT, label: 'Modifier un plein', description: '' },
      { key: Permission.FUEL_DELETE, label: 'Supprimer un plein', description: '' },
      { key: Permission.FUEL_EXPORT, label: 'Exporter en CSV', description: '' },
    ]
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: '🔧',
    permissions: [
      { key: Permission.MAINTENANCE_VIEW, label: 'Voir la maintenance', description: '' },
      { key: Permission.MAINTENANCE_VIEW_ALL, label: 'Voir TOUTE la maintenance', description: '' },
      { key: Permission.MAINTENANCE_VIEW_COSTS, label: 'Voir les coûts (€)', description: '' },
      { key: Permission.MAINTENANCE_CREATE, label: 'Ajouter une intervention', description: '' },
      { key: Permission.MAINTENANCE_EDIT, label: 'Modifier une intervention', description: '' },
      { key: Permission.MAINTENANCE_DELETE, label: 'Supprimer une intervention', description: '' },
    ]
  },
  {
    id: 'issues',
    label: 'Incidents',
    icon: '🚨',
    permissions: [
      { key: Permission.ISSUES_VIEW, label: 'Voir les incidents', description: '' },
      { key: Permission.ISSUES_VIEW_ALL, label: 'Voir TOUS les incidents', description: 'Sinon = seulement les siens' },
      { key: Permission.ISSUES_CREATE, label: 'Signaler un incident', description: '' },
      { key: Permission.ISSUES_MANAGE, label: 'Traiter/prendre en charge', description: '' },
      { key: Permission.ISSUES_RESOLVE, label: 'Clôturer un incident', description: '' },
    ]
  },
  {
    id: 'absences',
    label: 'Congés & Absences',
    icon: '🌴',
    permissions: [
      { key: Permission.ABSENCES_VIEW_OWN, label: 'Voir ses propres absences', description: '' },
      { key: Permission.ABSENCES_VIEW_TEAM, label: 'Voir absences de sa zone', description: 'Vue équipe zone' },
      { key: Permission.ABSENCES_VIEW_ALL, label: 'Voir TOUTES les absences', description: '' },
      { key: Permission.ABSENCES_CREATE, label: 'Demander un congé/absence', description: '' },
      { key: Permission.ABSENCES_EDIT_OWN, label: 'Modifier sa propre demande', description: 'Si en attente' },
      { key: Permission.ABSENCES_DELETE_OWN, label: 'Annuler sa propre demande', description: 'Si en attente' },
      { key: Permission.ABSENCES_VALIDATE, label: 'Valider/refuser les demandes', description: '' },
      { key: Permission.ABSENCES_VALIDATE_EXCLUDE_OWN, label: 'Exclure ses propres demandes', description: 'Ne pas voir ses demandes à valider' },
      { key: Permission.ABSENCES_REPORT, label: 'Générer un rapport CSV', description: '' },
    ]
  },
  {
    id: 'drivers',
    label: 'Équipe - Chauffeurs',
    icon: '👥',
    permissions: [
      { key: Permission.DRIVERS_VIEW, label: 'Voir la liste des chauffeurs', description: '' },
      { key: Permission.DRIVERS_VIEW_DETAIL, label: 'Voir le détail chauffeur', description: '' },
      { key: Permission.DRIVERS_EDIT, label: 'Modifier les infos chauffeur', description: '' },
    ]
  },
  {
    id: 'users',
    label: 'Utilisateurs',
    icon: '👤',
    permissions: [
      { key: Permission.USERS_VIEW, label: 'Voir tous les utilisateurs', description: '' },
      { key: Permission.USERS_CREATE, label: 'Créer un utilisateur', description: '' },
      { key: Permission.USERS_EDIT, label: 'Modifier un utilisateur', description: '' },
      { key: Permission.USERS_DELETE, label: 'Supprimer/désactiver', description: '' },
      { key: Permission.USERS_INVITE_RESEND, label: 'Renvoyer une invitation', description: '' },
      { key: Permission.USERS_PERMISSIONS, label: 'Gérer les permissions', description: 'Accès à cette page' },
    ]
  },
  {
    id: 'docs',
    label: 'Documents',
    icon: '📄',
    permissions: [
      { key: Permission.DOCS_VIEW_OWN, label: 'Voir ses propres documents', description: '' },
      { key: Permission.DOCS_VIEW_ALL, label: 'Voir tous les documents', description: '' },
      { key: Permission.DOCS_MANAGE, label: 'Gérer les documents entreprise', description: 'Ajouter, modifier, supprimer' },
      { key: Permission.DOCS_ACKNOWLEDGE, label: 'Accuser réception', description: '' },
    ]
  },
  {
    id: 'quotes',
    label: 'Devis & Transport',
    icon: '📋',
    permissions: [
      { key: Permission.QUOTES_VIEW, label: 'Voir les devis', description: '' },
      { key: Permission.QUOTES_VIEW_ALL, label: 'Voir TOUS les devis', description: '' },
      { key: Permission.QUOTES_CREATE, label: 'Créer un devis', description: '' },
      { key: Permission.QUOTES_EDIT, label: 'Modifier un devis', description: '' },
      { key: Permission.QUOTES_DELETE, label: 'Supprimer un devis', description: '' },
      { key: Permission.QUOTES_VALIDATE, label: 'Valider/chiffrer un devis', description: '' },
      { key: Permission.QUOTES_STATUS_UPDATE, label: 'Changer le statut', description: '' },
    ]
  },
  {
    id: 'missions',
    label: 'Missions & Tournées',
    icon: '🚚',
    permissions: [
      { key: Permission.MISSIONS_VIEW, label: 'Voir les missions', description: '' },
      { key: Permission.MISSIONS_VIEW_ALL, label: 'Voir TOUTES les missions', description: '' },
      { key: Permission.MISSIONS_VIEW_OWN, label: 'Voir SA mission uniquement', description: '' },
      { key: Permission.MISSIONS_CREATE, label: 'Créer une mission', description: '' },
      { key: Permission.MISSIONS_EDIT, label: 'Modifier une mission', description: '' },
      { key: Permission.MISSIONS_DELETE, label: 'Supprimer/annuler une mission', description: '' },
      { key: Permission.MISSIONS_DISPATCH, label: 'Dispatcher aux chauffeurs', description: '' },
      { key: Permission.MISSIONS_IMPORT, label: 'Importer fichiers clients', description: '' },
      { key: Permission.MISSIONS_OPTIMIZE, label: 'Lancer optimisation GMPRO', description: '' },
      { key: Permission.PACKAGES_VIEW, label: 'Voir les colis', description: '' },
      { key: Permission.PACKAGES_SCAN, label: 'Scanner les colis', description: '' },
      { key: Permission.PACKAGES_POD, label: 'Enregistrer preuve de livraison', description: '' },
      { key: Permission.PACKAGES_TRANSFER, label: 'Transférer des colis', description: '' },
      { key: Permission.HUBS_VIEW, label: 'Voir les hubs', description: '' },
      { key: Permission.HUBS_MANAGE, label: 'Gérer les hubs', description: '' },
    ]
  },
  {
    id: 'tools',
    label: 'Outils & Paramètres',
    icon: '🤖',
    permissions: [
      { key: Permission.AI_ACCESS, label: 'Accès FleetGenius IA', description: '' },
      { key: Permission.SETTINGS_ACCESS, label: 'Accès aux paramètres', description: '' },
      { key: Permission.SETTINGS_COMPANY, label: 'Paramètres entreprise', description: '' },
      { key: Permission.LOGS_VIEW, label: 'Voir les logs d\'activité', description: '' },
      { key: Permission.IMPORT_EXPORT_ACCESS, label: 'Accès imports/exports', description: '' },
    ]
  },
  {
    id: 'client',
    label: 'Portail Client',
    icon: '🏢',
    permissions: [
      { key: Permission.CLIENT_DASHBOARD, label: 'Voir son tableau de bord', description: '' },
      { key: Permission.CLIENT_REQUESTS_VIEW_OWN, label: 'Voir ses propres demandes', description: '' },
      { key: Permission.CLIENT_REQUESTS_VIEW_TEAM, label: 'Voir demandes de son équipe', description: '' },
      { key: Permission.CLIENT_REQUESTS_CREATE, label: 'Créer une demande de transport', description: '' },
      { key: Permission.CLIENT_REQUESTS_VALIDATE, label: 'Valider demandes de l\'équipe', description: '' },
      { key: Permission.CLIENT_TEAM_VIEW, label: 'Voir son équipe', description: '' },
      { key: Permission.CLIENT_TEAM_MANAGE, label: 'Gérer équipe (inviter/supprimer)', description: '' },
      { key: Permission.CLIENT_TEAM_INVITE_RESEND, label: 'Renvoyer invitation équipe', description: '' },
      { key: Permission.CLIENT_ADDRESSES_VIEW, label: 'Voir carnet d\'adresses', description: '' },
      { key: Permission.CLIENT_ADDRESSES_MANAGE, label: 'Gérer carnet d\'adresses', description: '' },
    ]
  },
];

// ============================================================================
// TEMPLATES PAR DÉFAUT
// ============================================================================

/**
 * Templates de permissions par rôle
 * Ces valeurs sont les permissions par défaut pour chaque rôle
 */
export const DEFAULT_ROLE_TEMPLATES: Record<UserRole, PermissionKey[]> = {
  [UserRole.PRESIDENT]: [
    // Le Président a TOUTES les permissions
    ...Object.values(Permission),
  ],

  [UserRole.DIRECTOR]: [
    // Dashboard (sans coûts financiers détaillés)
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_KPI_FLEET,
    Permission.DASHBOARD_KPI_FUEL,
    Permission.DASHBOARD_KPI_MAINTENANCE,
    Permission.DASHBOARD_KPI_HR,
    Permission.DASHBOARD_ALERTS_TODO,
    // Véhicules
    Permission.VEHICLES_VIEW,
    Permission.VEHICLES_VIEW_ALL,
    Permission.VEHICLES_VIEW_DETAIL,
    Permission.VEHICLES_CREATE,
    Permission.VEHICLES_EDIT,
    Permission.VEHICLES_ASSIGN,
    Permission.VEHICLES_EXPORT,
    // Carburant (sans coûts)
    Permission.FUEL_VIEW,
    Permission.FUEL_VIEW_ALL,
    Permission.FUEL_CREATE,
    Permission.FUEL_EDIT,
    Permission.FUEL_EXPORT,
    // Maintenance (sans coûts)
    Permission.MAINTENANCE_VIEW,
    Permission.MAINTENANCE_VIEW_ALL,
    Permission.MAINTENANCE_CREATE,
    Permission.MAINTENANCE_EDIT,
    // Incidents
    Permission.ISSUES_VIEW,
    Permission.ISSUES_VIEW_ALL,
    Permission.ISSUES_CREATE,
    Permission.ISSUES_MANAGE,
    Permission.ISSUES_RESOLVE,
    // Absences
    Permission.ABSENCES_VIEW_OWN,
    Permission.ABSENCES_VIEW_TEAM,
    Permission.ABSENCES_VIEW_ALL,
    Permission.ABSENCES_CREATE,
    Permission.ABSENCES_EDIT_OWN,
    Permission.ABSENCES_DELETE_OWN,
    Permission.ABSENCES_VALIDATE,
    Permission.ABSENCES_VALIDATE_EXCLUDE_OWN,
    Permission.ABSENCES_REPORT,
    // Chauffeurs
    Permission.DRIVERS_VIEW,
    Permission.DRIVERS_VIEW_DETAIL,
    Permission.DRIVERS_EDIT,
    // Utilisateurs
    Permission.USERS_VIEW,
    Permission.USERS_CREATE,
    Permission.USERS_EDIT,
    Permission.USERS_INVITE_RESEND,
    // Documents
    Permission.DOCS_VIEW_OWN,
    Permission.DOCS_VIEW_ALL,
    Permission.DOCS_MANAGE,
    Permission.DOCS_ACKNOWLEDGE,
    // Devis
    Permission.QUOTES_VIEW,
    Permission.QUOTES_VIEW_ALL,
    Permission.QUOTES_CREATE,
    Permission.QUOTES_EDIT,
    Permission.QUOTES_VALIDATE,
    Permission.QUOTES_STATUS_UPDATE,
    // Outils
    Permission.AI_ACCESS,
    Permission.SETTINGS_ACCESS,
    Permission.IMPORT_EXPORT_ACCESS,
    // Missions & Tournées (complet)
    Permission.MISSIONS_VIEW,
    Permission.MISSIONS_VIEW_ALL,
    Permission.MISSIONS_CREATE,
    Permission.MISSIONS_EDIT,
    Permission.MISSIONS_DELETE,
    Permission.MISSIONS_DISPATCH,
    Permission.MISSIONS_IMPORT,
    Permission.MISSIONS_OPTIMIZE,
    Permission.PACKAGES_VIEW,
    Permission.PACKAGES_TRANSFER,
    Permission.HUBS_VIEW,
    Permission.HUBS_MANAGE,
    Permission.LOGS_VIEW,
  ],

  [UserRole.SECRETARY]: [
    // Dashboard (sans coûts)
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_KPI_FLEET,
    Permission.DASHBOARD_KPI_FUEL,
    Permission.DASHBOARD_KPI_MAINTENANCE,
    Permission.DASHBOARD_KPI_HR,
    Permission.DASHBOARD_ALERTS_TODO,
    // Véhicules
    Permission.VEHICLES_VIEW,
    Permission.VEHICLES_VIEW_ALL,
    Permission.VEHICLES_VIEW_DETAIL,
    Permission.VEHICLES_CREATE,
    Permission.VEHICLES_EDIT,
    Permission.VEHICLES_ASSIGN,
    Permission.VEHICLES_EXPORT,
    // Carburant
    Permission.FUEL_VIEW,
    Permission.FUEL_VIEW_ALL,
    Permission.FUEL_CREATE,
    Permission.FUEL_EDIT,
    Permission.FUEL_EXPORT,
    // Maintenance
    Permission.MAINTENANCE_VIEW,
    Permission.MAINTENANCE_VIEW_ALL,
    Permission.MAINTENANCE_CREATE,
    Permission.MAINTENANCE_EDIT,
    // Incidents
    Permission.ISSUES_VIEW,
    Permission.ISSUES_VIEW_ALL,
    Permission.ISSUES_CREATE,
    Permission.ISSUES_MANAGE,
    Permission.ISSUES_RESOLVE,
    // Absences
    Permission.ABSENCES_VIEW_OWN,
    Permission.ABSENCES_VIEW_TEAM,
    Permission.ABSENCES_VIEW_ALL,
    Permission.ABSENCES_CREATE,
    Permission.ABSENCES_EDIT_OWN,
    Permission.ABSENCES_DELETE_OWN,
    Permission.ABSENCES_VALIDATE,
    Permission.ABSENCES_VALIDATE_EXCLUDE_OWN,
    Permission.ABSENCES_REPORT,
    // Chauffeurs
    Permission.DRIVERS_VIEW,
    Permission.DRIVERS_VIEW_DETAIL,
    Permission.DRIVERS_EDIT,
    // Utilisateurs
    Permission.USERS_VIEW,
    Permission.USERS_CREATE,
    Permission.USERS_EDIT,
    Permission.USERS_INVITE_RESEND,
    Permission.USERS_PERMISSIONS, // Secrétaire peut gérer les permissions
    // Documents
    Permission.DOCS_VIEW_OWN,
    Permission.DOCS_VIEW_ALL,
    Permission.DOCS_MANAGE,
    Permission.DOCS_ACKNOWLEDGE,
    // Devis
    Permission.QUOTES_VIEW,
    Permission.QUOTES_VIEW_ALL,
    Permission.QUOTES_CREATE,
    Permission.QUOTES_EDIT,
    Permission.QUOTES_VALIDATE,
    Permission.QUOTES_STATUS_UPDATE,
    // Outils
    Permission.AI_ACCESS,
    Permission.SETTINGS_ACCESS,
    Permission.IMPORT_EXPORT_ACCESS,
    // Missions & Tournées (import et dispatch)
    Permission.MISSIONS_VIEW,
    Permission.MISSIONS_VIEW_ALL,
    Permission.MISSIONS_CREATE,
    Permission.MISSIONS_EDIT,
    Permission.MISSIONS_DISPATCH,
    Permission.MISSIONS_IMPORT,
    Permission.MISSIONS_OPTIMIZE,
    Permission.PACKAGES_VIEW,
    Permission.HUBS_VIEW,
  ],

  [UserRole.DRIVER]: [
    // Dashboard limité
    Permission.DASHBOARD_VIEW,
    // Véhicules (seulement le sien)
    Permission.VEHICLES_VIEW,
    Permission.VEHICLES_VIEW_DETAIL,
    // Carburant (seulement les siens)
    Permission.FUEL_VIEW,
    Permission.FUEL_CREATE,
    // Incidents (signaler)
    Permission.ISSUES_VIEW,
    Permission.ISSUES_CREATE,
    // Absences
    Permission.ABSENCES_VIEW_OWN,
    Permission.ABSENCES_VIEW_TEAM,
    Permission.ABSENCES_CREATE,
    Permission.ABSENCES_EDIT_OWN,
    Permission.ABSENCES_DELETE_OWN,
    // Documents
    Permission.DOCS_VIEW_OWN,
    Permission.DOCS_ACKNOWLEDGE,
    // Missions (sa mission uniquement)
    Permission.MISSIONS_VIEW,
    Permission.MISSIONS_VIEW_OWN,
    Permission.PACKAGES_VIEW,
    Permission.PACKAGES_SCAN,
    Permission.PACKAGES_POD,
    Permission.PACKAGES_TRANSFER,
  ],

  [UserRole.MECHANIC]: [
    // Dashboard limité
    Permission.DASHBOARD_VIEW,
    // Véhicules
    Permission.VEHICLES_VIEW,
    Permission.VEHICLES_VIEW_ALL,
    Permission.VEHICLES_VIEW_DETAIL,
    // Maintenance
    Permission.MAINTENANCE_VIEW,
    Permission.MAINTENANCE_VIEW_ALL,
    Permission.MAINTENANCE_CREATE,
    Permission.MAINTENANCE_EDIT,
    // Incidents
    Permission.ISSUES_VIEW,
    Permission.ISSUES_VIEW_ALL,
    Permission.ISSUES_CREATE,
    Permission.ISSUES_MANAGE,
    Permission.ISSUES_RESOLVE,
    // Absences
    Permission.ABSENCES_VIEW_OWN,
    Permission.ABSENCES_CREATE,
    Permission.ABSENCES_EDIT_OWN,
    Permission.ABSENCES_DELETE_OWN,
    // Documents
    Permission.DOCS_VIEW_OWN,
    Permission.DOCS_VIEW_ALL,
    Permission.DOCS_ACKNOWLEDGE,
  ],

  [UserRole.ADMIN]: [
    // Tout comme Président
    ...Object.values(Permission),
  ],

  [UserRole.CLIENT]: [
    // Portail client uniquement
    Permission.CLIENT_DASHBOARD,
    Permission.CLIENT_REQUESTS_VIEW_OWN,
    Permission.CLIENT_REQUESTS_CREATE,
    Permission.CLIENT_TEAM_VIEW,
    Permission.CLIENT_ADDRESSES_VIEW,
    Permission.CLIENT_ADDRESSES_MANAGE,
  ],

  [UserRole.INTERN]: [
    // Permissions de base pour un stagiaire
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_KPI_FLEET,
    Permission.VEHICLES_VIEW,
    Permission.VEHICLES_VIEW_ALL,
    Permission.FUEL_VIEW,
    Permission.MAINTENANCE_VIEW,
    Permission.ISSUES_VIEW,
    Permission.ABSENCES_VIEW_OWN,
    Permission.ABSENCES_CREATE,
    Permission.DOCS_VIEW_OWN,
    Permission.DOCS_ACKNOWLEDGE,
  ],
};

// ============================================================================
// TYPES POUR FIRESTORE
// ============================================================================

/**
 * Structure stockée dans Firestore pour les templates de rôle
 * Collection: rolePermissions
 */
export interface RolePermissionTemplate {
  role: UserRole;
  permissions: PermissionKey[];
  updatedAt: string;
  updatedBy: string;
}

/**
 * Structure stockée sur l'utilisateur pour les exceptions
 * Champ: customPermissions sur User
 */
export interface UserPermissionOverrides {
  granted: PermissionKey[];  // Permissions ajoutées en plus du template
  revoked: PermissionKey[];  // Permissions retirées du template
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calcule les permissions effectives d'un utilisateur
 * @param role - Le rôle de l'utilisateur
 * @param roleTemplate - Le template de permissions pour ce rôle (depuis Firestore ou défaut)
 * @param overrides - Les exceptions de l'utilisateur
 * @returns Liste des permissions effectives
 */
export function computeEffectivePermissions(
  role: UserRole,
  roleTemplate?: PermissionKey[],
  overrides?: UserPermissionOverrides
): PermissionKey[] {
  // Utiliser le template stocké ou le template par défaut
  const basePermissions = roleTemplate || DEFAULT_ROLE_TEMPLATES[role] || [];
  
  if (!overrides) {
    return basePermissions;
  }

  // Ajouter les permissions granted
  const withGranted = [...new Set([...basePermissions, ...(overrides.granted || [])])];
  
  // Retirer les permissions revoked
  const final = withGranted.filter(p => !(overrides.revoked || []).includes(p));
  
  return final;
}

/**
 * Vérifie si un utilisateur a une permission
 * @param effectivePermissions - Les permissions calculées de l'utilisateur
 * @param permission - La permission à vérifier
 * @returns boolean
 */
export function hasPermission(
  effectivePermissions: PermissionKey[],
  permission: PermissionKey
): boolean {
  return effectivePermissions.includes(permission);
}

/**
 * Vérifie si un utilisateur a AU MOINS UNE des permissions
 */
export function hasAnyPermission(
  effectivePermissions: PermissionKey[],
  permissions: PermissionKey[]
): boolean {
  return permissions.some(p => effectivePermissions.includes(p));
}

/**
 * Vérifie si un utilisateur a TOUTES les permissions
 */
export function hasAllPermissions(
  effectivePermissions: PermissionKey[],
  permissions: PermissionKey[]
): boolean {
  return permissions.every(p => effectivePermissions.includes(p));
}

/**
 * Obtient le label d'une permission
 */
export function getPermissionLabel(permission: PermissionKey): string {
  for (const category of PERMISSION_CATEGORIES) {
    const found = category.permissions.find(p => p.key === permission);
    if (found) return found.label;
  }
  return permission;
}

/**
 * Obtient la catégorie d'une permission
 */
export function getPermissionCategory(permission: PermissionKey): PermissionCategory | undefined {
  return PERMISSION_CATEGORIES.find(cat => 
    cat.permissions.some(p => p.key === permission)
  );
}
