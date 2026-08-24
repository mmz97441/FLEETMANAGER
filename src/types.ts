
export enum VehicleStatus {
  ACTIVE = 'En Service',
  MAINTENANCE = 'Maintenance',
  IDLE = 'Disponible',
  ISSUE = 'Problème Signalé',
  IMMOBILIZED = 'Immobilisé'  // Nouveau: panne sur route, en attente de réparation
}

// Type de véhicule (propriété vs remplacement)
export enum VehicleOwnership {
  OWNED = 'Propriété',
  LEASED = 'Location longue durée',
  REPLACEMENT = 'Remplacement temporaire'  // Location courte durée, prêt, etc.
}

// Source du véhicule de remplacement
export enum ReplacementSource {
  INTERNAL = 'Véhicule interne',       // Autre véhicule du parc
  RENTAL = 'Location',                  // Hertz, Europcar, etc.
  LOAN = 'Prêt partenaire',            // Prêté par un confrère
  OTHER = 'Autre'
}

export enum FuelType {
  DIESEL = 'Diesel',
  ELECTRIC = 'Électrique',
  HYBRID = 'Hybride'
}

export enum Zone {
  NORD = 'Nord',
  EST = 'Est',
  SUD = 'Sud',
  OUEST = 'Ouest'
}

export const ZONE_COLORS: Record<Zone, { bg: string; text: string; border: string; dot: string }> = {
  [Zone.NORD]: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  [Zone.EST]: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' },
  [Zone.SUD]: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  [Zone.OUEST]: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' }
};

export enum UserRole {
  PRESIDENT = 'Président',
  DIRECTOR = 'Directeur Exploitation',
  SECRETARY = 'Secrétariat',
  DRIVER = 'Chauffeur',
  MECHANIC = 'Mécanicien',
  ADMIN = 'Admin',
  CLIENT = 'Client',
  INTERN = 'Stagiaire'  // Nouveau rôle
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  zone?: Zone; // Zone géographique (Nord, Est, Sud, Ouest)
  avatarUrl?: string;
  hasSeenTutorial?: boolean;
  companyName?: string;
  // Identité expéditeur (client) — reprise automatiquement sur les bons de livraison
  companyAddress?: string;   // Adresse complète (rue, CP, ville)
  companySiret?: string;     // N° SIRET
  companyPhone?: string;     // Téléphone société
  codePrefix?: string;       // Préfixe des codes colis DELIVREX de ce client (ex. BR, AUT) — défini par le créateur du compte
  leaveBalance: number;
  driverLicenseScanDate?: string;
  isHeavyGoodsDriver?: boolean;
  fcoDate?: string;
  fimoDate?: string;
  medicalVisitDate?: string;
  // Statut du compte
  isDisabled?: boolean;
  disabledAt?: string;
  disabledBy?: string;

  // Dernière connexion (mise à jour à chaque ouverture de l'app)
  lastLoginAt?: string;
  // Date d'activation du compte (posée par la Cloud Function activateAccount)
  activatedAt?: string;
  // Permissions personnalisées (exceptions au template de rôle)
  customPermissions?: {
    granted: string[];  // Permissions ajoutées
    revoked: string[];  // Permissions retirées
  };
}

export interface Driver {
  id: string;
  name: string;
  licenseNumber: string;
  safetyScore: number;
  status: string;
  assignedVehicleId?: string;
  avatarUrl?: string;
}

export interface CustomDeadline {
  id: string;
  label: string;
  date: string;
}

export interface Vehicle {
  id: string;
  // Champs UI mappés
  plate: string;        // Mappé depuis 'licensePlate'
  model: string;        // Mappé depuis 'make' + 'model'
  type: string;         // Mappé depuis 'fuelType' ou 'type'
  status: VehicleStatus; // Mappé depuis 'status' (string)
  
  // Champs Base de données bruts (ajoutés pour compatibilité)
  make?: string;
  year?: number;
  fuelType?: string;
  acquisitionType?: string;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  financingProvider?: string | null;
  photoUrl?: string | null;
  monthlyCost?: number;

  // Champs existants App
  currentMileage: number;
  fuelLevel?: number;
  maintenanceInterval?: number;
  lastMaintenanceDate?: string;
  lastMaintenanceMileage?: number;
  nextMaintenancePrediction?: string;
  costPerKm?: number;
  driverId?: string | null;
  assignedDriverId?: string;
  location?: {
    lat: number;
    lng: number;
    address: string;
  };
  technicalControlDate?: string;
  fireExtinguisherDate?: string;
  tailgateDate?: string;
  chronotachygraphDate?: string;
  speedLimiterDate?: string;
  customDeadlines?: CustomDeadline[];
  
  // === NOUVEAUX CHAMPS: Remplacement ===
  ownership?: VehicleOwnership;           // Type de propriété
  isReplacement?: boolean;                // Est-ce un véhicule de remplacement ?
  replacesVehicleId?: string;             // ID du véhicule qu'il remplace
  replacementSource?: ReplacementSource;  // Source (location, prêt, etc.)
  replacementProvider?: string;           // Nom du loueur/prêteur (ex: "HERTZ")
  replacementStartDate?: string;          // Date début remplacement
  replacementEndDate?: string;            // Date fin prévue/effective
  replacementDailyCost?: number;          // Coût journalier de la location
  
  // Pour les véhicules immobilisés
  immobilizedDate?: string;               // Date d'immobilisation
  immobilizedReason?: string;             // Raison (panne, accident, etc.)
  immobilizedLocation?: string;           // Localisation si en panne sur route
  currentReplacementId?: string;          // ID du véhicule de remplacement actuel
}

export interface FuelLog {
  id: string;
  vehicleId: string;
  date: string;
  volume: number;
  cost: number;
  mileage: number;
  fullTank: boolean;
  adBlueVolume?: number;
  adBlueCost?: number;
  station?: string;
  receiptUrl?: string;
  isRentalEntry?: boolean;
  // === NOUVEAU: Imputation des coûts ===
  imputedToVehicleId?: string;  // Si remplacement, ID du véhicule remplacé pour imputation comptable
  // Audit de modification
  lastModifiedAt?: string;
  lastModifiedBy?: string;
  lastModifiedByName?: string;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface MaintenanceLog {
  id: string;
  vehicleId: string;
  date: string;
  type: string;
  description: string;
  cost: number;
  mileageAtService: number;
  garageName?: string;
  provider?: string;
  invoiceNumber?: string;
  status?: 'Pending' | 'Completed';
  lines?: InvoiceLine[];
  linkedIssueId?: string;      // Lien vers l'incident source
  invoiceUrl?: string;         // Photo de la facture
  completedDate?: string;      // Date de fin de réparation
  // === NOUVEAU: Imputation des coûts ===
  imputedToVehicleId?: string;  // Si remplacement, ID du véhicule remplacé pour imputation comptable
}

export enum IssueStatus {
  NEW = 'Nouveau',
  ACKNOWLEDGED = 'Pris en compte',
  IN_PROGRESS = 'En réparation',
  RESOLVED = 'Réparé / Clos'
}

export interface IssueLog {
  id: string;
  date: string;
  message: string;
  authorName: string;
  isInternal?: boolean; // Si true, visible uniquement par l'admin/garage
  type: 'RESPONSE' | 'APPOINTMENT' | 'NOTE';
}

export interface Issue {
  id: string;
  vehicleId: string;
  reportedByUserId: string;
  reportedBy?: string; // Alias pour compatibilité
  description: string;
  date: string;
  priority: 'Low' | 'Medium' | 'High';
  status: IssueStatus;
  garageResponse?: string; // Gardé pour compatibilité, mais on utilisera logs
  interventionDate?: string; // Gardé pour compatibilité
  logs?: IssueLog[]; // Nouvel historique
  photos?: string[]; // Photos du signalement (recommandé)
  resolvedDate?: string; // Date de clôture
  resolvedBy?: string; // ID de l'utilisateur qui a clôturé
  // Champs clôture/réparation
  repairCost?: number;         // Coût total de la réparation
  repairLines?: InvoiceLine[]; // Détail des lignes de facture
  invoiceUrl?: string;         // Photo de la facture (obligatoire à la clôture)
  linkedMaintenanceId?: string; // Lien vers la MaintenanceLog créée
  
  // === NOUVEAUX CHAMPS: Immobilisation ===
  vehicleImmobilized?: boolean;           // Le véhicule est-il immobilisé ?
  immobilizedLocation?: string;           // Où est le véhicule ? (adresse, GPS)
  needsTowing?: boolean;                  // Besoin de dépannage/remorquage ?
  towingRequested?: boolean;              // Dépannage demandé ?
  towingCompany?: string;                 // Société de dépannage
}

// === GESTION DES ABSENCES (REFONTE COMPLÈTE) ===

export enum AbsenceStatus {
  PENDING = 'En attente',
  APPROVED = 'Validé',
  REJECTED = 'Refusé',
  MODIFICATION_PROPOSED = 'Modification proposée'
}

export enum AbsenceType {
  CP = 'Congés Payés',
  RTT = 'RTT',
  CSS = 'Congé Sans Solde',
  MALADIE = 'Arrêt Maladie',
  AT = 'Accident de Travail',
  MATERNITE = 'Congé Maternité',
  PATERNITE = 'Congé Paternité',
  FORMATION = 'Formation',
  INJUSTIFIEE = 'Absence Injustifiée',
  RECUP = 'Récupération',
  AUTRE = 'Autre'
}

// Types qui nécessitent un justificatif
export const ABSENCE_REQUIRES_DOCUMENT: AbsenceType[] = [
  AbsenceType.MALADIE,
  AbsenceType.AT,
  AbsenceType.MATERNITE,
  AbsenceType.PATERNITE
];

// Types qui peuvent être demandés par l'employé
export const ABSENCE_EMPLOYEE_CAN_REQUEST: AbsenceType[] = [
  AbsenceType.CP,
  AbsenceType.RTT,
  AbsenceType.CSS,
  AbsenceType.RECUP,
  AbsenceType.AUTRE
];

// Types réservés à l'ÉQUIPE DE DIRECTION (jamais le salarié ni le secrétariat) :
// arrêts maladie et accidents du travail se déclarent uniquement par la direction.
export const ABSENCE_DIRECTION_ONLY: AbsenceType[] = [
  AbsenceType.MALADIE,
  AbsenceType.AT
];

// Types qui impactent le solde CP
export const ABSENCE_IMPACTS_CP_BALANCE: AbsenceType[] = [
  AbsenceType.CP
];

export interface AbsenceDocument {
  id: string;
  name: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
  type: 'certificat_medical' | 'declaration_at' | 'attestation' | 'autre';
}

export interface AbsenceModificationProposal {
  proposedStartDate: string;
  proposedEndDate: string;
  reason: string;
  proposedBy: string;
  proposedAt: string;
}

export interface Absence {
  id: string;
  userId: string;
  type: AbsenceType;
  startDate: string;
  endDate: string;
  halfDayStart?: 'morning' | 'afternoon';  // Demi-journée début
  halfDayEnd?: 'morning' | 'afternoon';    // Demi-journée fin
  status: AbsenceStatus;
  reason?: string;
  
  // Calcul des jours
  workingDays: number;
  saturdaysDeducted?: number;
  calculationDetails?: string;
  
  // Justificatifs
  documents?: AbsenceDocument[];
  documentReceived?: boolean;
  documentReceivedDate?: string;
  documentReceivedBy?: string;
  
  // Spécifique AT
  accidentDate?: string;
  accidentDescription?: string;
  accidentLocation?: string;
  accidentWitnesses?: string;
  
  // Spécifique Maladie
  sicknessStartDate?: string;  // Date début arrêt sur certificat
  sicknessEndDate?: string;    // Date fin arrêt sur certificat
  extension?: boolean;         // Prolongation ?
  
  // Validation
  validatedBy?: string;
  validatedAt?: string;
  adminComment?: string;
  
  // Proposition de modification
  modificationProposal?: AbsenceModificationProposal;
  
  // Métadonnées
  createdAt: string;
  createdBy: string;  // Qui a saisi (peut être différent de userId si admin saisit pour employé)
  updatedAt?: string;
}

// Configuration entreprise pour les absences
export interface AbsenceConfig {
  enableRTT: boolean;
  enableRecup: boolean;
  defaultCPBalance: number;
  defaultRTTBalance: number;
  saturdaysCounted: boolean;  // Les samedis comptent-ils ?
  maxConsecutiveDays: number; // Max jours consécutifs sans validation direction
}

// Pour le rapport
export interface AbsenceReportFilters {
  startDate: string;
  endDate: string;
  types: AbsenceType[];
  userId?: string;
  status?: AbsenceStatus[];
}

export interface AbsenceStats {
  totalDays: number;
  byType: Record<AbsenceType, number>;
  byUser: Record<string, number>;
  byMonth: Record<string, number>;
}

// === ANCIENS TYPES (COMPATIBILITÉ) ===

export enum LeaveStatus {
  PENDING = 'En attente',
  APPROVED = 'Accepté',
  REJECTED = 'Refusé'
}

export enum LeaveType {
  PAID = 'Congés Payés',
  UNPAID = 'Sans Solde',
  SICK = 'Maladie',
  RTT = 'RTT',
  FAMILY = 'Congé Familial',
  OTHER = 'Autre'
}

export interface LeaveRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: LeaveType;
  status: LeaveStatus;
  reason?: string;
  adminComment?: string;
  validatedBy?: string;
  validationDate?: string;
  workingDays?: number;
  saturdaysDeducted?: number;
  calculationDetails?: string;
}

// === GESTION DOCUMENTAIRE LÉGALE ===

export enum DocumentType {
  ORDRE_SERVICE = 'Ordre de Service',
  REGLEMENT_INTERIEUR = 'Règlement Intérieur',
  NOTE_SERVICE = 'Note de Service',
  PROCEDURE = 'Procédure',
  CHARTE = 'Charte',
  AVENANT = 'Avenant'
}

export enum DocumentPriority {
  NORMAL = 'Normal',
  IMPORTANT = 'Important',
  URGENT = 'Urgent'
}

export interface CompanyDocument {
  id: string;
  title: string;
  type: DocumentType;
  description?: string;
  content?: string;           // Contenu texte (pour les courtes notes)
  fileUrl?: string;           // URL du fichier PDF/document
  fileName?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  targetRoles: UserRole[];    // Rôles concernés (vide = tous)
  requiresSignature: boolean; // Signature obligatoire ?
  effectiveDate: string;      // Date d'entrée en vigueur
  expirationDate?: string;    // Date d'expiration (optionnel)
  version: string;            // Numéro de version (ex: "1.0", "2.1")
  priority: DocumentPriority;
  isActive: boolean;          // Document actif ou archivé
}

export interface DocumentAcknowledgment {
  id: string;
  documentId: string;
  documentTitle: string;
  documentVersion: string;
  userId: string;
  userName: string;
  // Traçabilité lecture
  readAt: string;             // Date/heure de lecture
  readDuration?: number;      // Temps passé à lire (secondes)
  // Traçabilité signature
  signedAt?: string;          // Date/heure de signature
  signatureHash?: string;     // Hash unique de la signature
  // Métadonnées juridiques
  ipAddress?: string;
  userAgent?: string;
  // Statut
  status: 'READ' | 'SIGNED';
}

export enum QuoteStatus {
  REQUESTED = 'Demande reçue',
  OFFER_SENT = 'Offre envoyée',
  ACCEPTED = 'Accepté (Commande)',
  REJECTED = 'Refusé'
}

export interface QuoteRequest {
  id: string;
  clientId: string;
  clientName: string;
  requesterId?: string; 
  requesterName?: string;
  date: string;
  origin: string;
  originAddress?: string;
  originContact: {
    name: string;
    phone: string;
  };
  destination: string;
  destinationAddress?: string;
  destinationContact: {
    name: string;
    phone: string;
  };
  goodsDescription: string;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  volume: number;
  pickupDate: string;
  deliveryDate: string;
  clientNotes?: string;
  status: QuoteStatus;
  priceOffer?: number;
  adminNotes?: string;

  // Créneau de livraison choisi par le client
  deliverySlotId?: string;             // Référence vers le créneau
  deliveryTimeWindow?: {               // Fenêtre horaire
    start: string;                     // "08:00"
    end: string;                       // "12:00"
    label: string;                     // "Matin (08h-12h)"
  };

  // Conversion vers mission (rempli automatiquement quand ACCEPTED)
  convertedToPackageId?: string;       // ID du colis créé
  convertedToMissionId?: string;       // ID de la mission assignée
  convertedAt?: string;                // Date de conversion
}

// ============================================================================
// CRÉNEAUX DE LIVRAISON
// ============================================================================

export interface DeliveryTimeSlot {
  id: string;
  label: string;                       // "Matin", "Après-midi", "Soir"
  start: string;                       // "08:00"
  end: string;                         // "12:00"
  zones: Zone[];                       // Zones où ce créneau est dispo
  maxCapacity?: number;                // Nb max de livraisons sur ce créneau (optionnel)
  isActive: boolean;                   // Désactivable
  sortOrder: number;                   // Pour ordonner l'affichage
}

export interface DeliveryScheduleConfig {
  id: string;
  slots: DeliveryTimeSlot[];           // Créneaux configurés
  cutoffHours: number;                 // Heures avant le créneau pour accepter les demandes (ex: 2h)
  sameDayEnabled: boolean;             // Autorise les livraisons le jour même
  sameDayCutoff?: string;              // Heure limite pour le jour même ("10:00")
  weekendEnabled: boolean;             // Livraison le week-end
  holidays: string[];                  // Jours fériés (format "YYYY-MM-DD")
  updatedAt: string;
  updatedBy: string;
}

export type ViewState = 
  | 'dashboard' 
  | 'vehicles' 
  | 'drivers' 
  | 'fuel' 
  | 'maintenance' 
  | 'issues' 
  | 'users' 
  | 'permissions'
  | 'help' 
  | 'map' 
  | 'ai_advisor' 
  | 'documents' 
  | 'company_docs'
  | 'leaves'
  | 'absences' 
  | 'quotes'
  | 'settings'
  | 'client_dashboard'
  | 'client_list'
  | 'client_team'
  // Nouvelles vues Administration & Paramètres
  | 'company_settings'
  | 'activity_logs'
  | 'error_logs'
  | 'president_overview'
  | 'client_analytics'
  | 'client_recipients'
  | 'client_company'
  | 'client_help'
  | 'missions'
  | 'notifications_settings'
  | 'api_diagnostic'
  | 'delivery_schedule'
  | 'zone_management'
  | 'client_shipments'
  | 'client_tracking'
  | 'hub_operations'
  | 'driver_tour'
  | 'fleet_map'
  | 'tours_overview'
  | 'import_export';

// ============================================================================
// CARNET D'ADRESSES CLIENT
// ============================================================================

export interface SavedAddress {
  id: string;
  companyName: string;      // Pour filtrer par entreprise client
  createdBy: string;        // ID de l'utilisateur qui a créé
  label: string;            // Ex: "Entrepôt principal", "Client Carrefour"
  type: 'pickup' | 'delivery' | 'both';
  address: string;          // Rue et numéro
  city: string;             // Code postal et ville
  contactName: string;      // Nom du contact
  contactPhone: string;     // Téléphone
  contactEmail?: string;    // Email du destinataire (optionnel — pour copie du BL)
  notes?: string;           // Notes optionnelles
  isFavorite?: boolean;     // Adresse favorite (affichée en premier)
  usageCount?: number;      // Nombre d'utilisations (pour tri par pertinence)
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// LOGS D'ACTIVITÉ (AUDIT TRAIL)
// ============================================================================

export enum ActivityAction {
  // Utilisateurs
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_ACTIVATED = 'USER_ACTIVATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  
  // Véhicules
  VEHICLE_CREATED = 'VEHICLE_CREATED',
  VEHICLE_UPDATED = 'VEHICLE_UPDATED',
  VEHICLE_DELETED = 'VEHICLE_DELETED',
  VEHICLE_ASSIGNED = 'VEHICLE_ASSIGNED',
  VEHICLE_UNASSIGNED = 'VEHICLE_UNASSIGNED',
  VEHICLE_IMMOBILIZED = 'VEHICLE_IMMOBILIZED',
  VEHICLE_REACTIVATED = 'VEHICLE_REACTIVATED',
  
  // Carburant
  FUEL_CREATED = 'FUEL_CREATED',
  FUEL_UPDATED = 'FUEL_UPDATED',
  FUEL_DELETED = 'FUEL_DELETED',
  
  // Maintenance
  MAINTENANCE_CREATED = 'MAINTENANCE_CREATED',
  MAINTENANCE_UPDATED = 'MAINTENANCE_UPDATED',
  MAINTENANCE_COMPLETED = 'MAINTENANCE_COMPLETED',
  
  // Incidents
  ISSUE_CREATED = 'ISSUE_CREATED',
  ISSUE_RESOLVED = 'ISSUE_RESOLVED',
  ISSUE_UPDATED = 'ISSUE_UPDATED',
  
  // Documents
  DOCUMENT_CREATED = 'DOCUMENT_CREATED',
  DOCUMENT_UPDATED = 'DOCUMENT_UPDATED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  DOCUMENT_SIGNED = 'DOCUMENT_SIGNED',
  DOCUMENT_READ = 'DOCUMENT_READ',
  
  // Absences / Congés
  ABSENCE_CREATED = 'ABSENCE_CREATED',
  ABSENCE_APPROVED = 'ABSENCE_APPROVED',
  ABSENCE_REJECTED = 'ABSENCE_REJECTED',
  ABSENCE_CANCELLED = 'ABSENCE_CANCELLED',
  
  // Devis
  QUOTE_CREATED = 'QUOTE_CREATED',
  QUOTE_UPDATED = 'QUOTE_UPDATED',
  QUOTE_APPROVED = 'QUOTE_APPROVED',
  QUOTE_REJECTED = 'QUOTE_REJECTED',
  
  // Missions / Tournées
  MISSION_CREATED = 'MISSION_CREATED',
  MISSION_DISPATCHED = 'MISSION_DISPATCHED',
  MISSION_STARTED = 'MISSION_STARTED',
  MISSION_COMPLETED = 'MISSION_COMPLETED',
  MISSION_CANCELLED = 'MISSION_CANCELLED',
  MISSION_UPDATED = 'MISSION_UPDATED',
  ITEM_CREATED = 'ITEM_CREATED',
  ITEM_UPDATED = 'ITEM_UPDATED',
  ITEM_DELETED = 'ITEM_DELETED',
  STATUS_CHANGED = 'STATUS_CHANGED',

  // Système
  SYSTEM_SETTINGS_UPDATED = 'SYSTEM_SETTINGS_UPDATED',
  PERMISSIONS_UPDATED = 'PERMISSIONS_UPDATED',
  DATA_EXPORTED = 'DATA_EXPORTED',
  DATA_IMPORTED = 'DATA_IMPORTED'
}

export enum ActivityCategory {
  USERS = 'Utilisateurs',
  VEHICLES = 'Véhicules',
  FUEL = 'Carburant',
  MAINTENANCE = 'Maintenance',
  ISSUES = 'Incidents',
  DOCUMENTS = 'Documents',
  ABSENCES = 'Absences',
  QUOTES = 'Devis',
  MISSIONS = 'Missions',
  SYSTEM = 'Système'
}

export interface ActivityLog {
  id: string;
  
  // Qui
  userId: string;
  userName: string;
  userRole: string;
  
  // Quoi
  action: ActivityAction;
  category: ActivityCategory;
  description: string;         // Description lisible: "Jean Dupont a créé un plein de 45L"
  
  // Sur quoi (optionnel selon l'action)
  targetType?: 'user' | 'vehicle' | 'fuel' | 'maintenance' | 'issue' | 'document' | 'absence' | 'quote' | 'mission' | 'package';
  targetId?: string;
  targetName?: string;         // Ex: "AB-123-CD" pour un véhicule
  
  // Détails (données avant/après pour les modifications)
  details?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
    changes?: string[];        // Liste des champs modifiés
    metadata?: Record<string, any>;
  };
  
  // Contexte
  ipAddress?: string;
  userAgent?: string;
  
  // Quand
  createdAt: string;
}

// ============================================================================
// HUBS (Points de concentration)
// ============================================================================

export interface Hub {
  id: string;
  name: string;                    // "Hub Nord"
  zone: Zone;                      // NORD, SUD, EST, OUEST
  address: string;
  city: string;
  postalCode: string;
  coordinates?: { lat: number; lng: number };
  assignedPostalCodes: string[];   // Codes postaux rattachés à ce hub
  isActive: boolean;
  contactPhone?: string;
  openingTime?: string;            // "07:00"
  closingTime?: string;            // "18:00"
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// COLIS (Package)
// ============================================================================

export enum PackageStatus {
  PENDING = 'En attente',          // Importé, pas encore collecté
  COLLECTED = 'Collecté',          // Enlevé chez le client expéditeur
  AT_HUB = 'Au hub',               // Arrivé au hub, en attente de tri
  SORTED = 'Trié',                 // Assigné à une zone
  IN_TRANSIT = 'En transit',       // Dans une navette inter-hubs
  LOADED = 'Chargé',               // Dans le véhicule de livraison
  IN_DELIVERY = 'En livraison',    // Chauffeur en route
  DELIVERED = 'Livré',             // POD enregistré
  FAILED = 'Échec',                // Tentative échouée
  RETURN_REQUESTED = 'À retourner', // Stop supprimé — colis doit revenir au hub
  RETURNED = 'Retourné'            // Retour hub confirmé (photo + signature)
}

export const PACKAGE_STATUS_COLORS: Record<PackageStatus, { bg: string; text: string }> = {
  [PackageStatus.PENDING]: { bg: 'bg-slate-100', text: 'text-slate-700' },
  [PackageStatus.COLLECTED]: { bg: 'bg-blue-100', text: 'text-blue-700' },
  [PackageStatus.AT_HUB]: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  [PackageStatus.SORTED]: { bg: 'bg-purple-100', text: 'text-purple-700' },
  [PackageStatus.IN_TRANSIT]: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  [PackageStatus.LOADED]: { bg: 'bg-amber-100', text: 'text-amber-700' },
  [PackageStatus.IN_DELIVERY]: { bg: 'bg-orange-100', text: 'text-orange-700' },
  [PackageStatus.DELIVERED]: { bg: 'bg-green-100', text: 'text-green-700' },
  [PackageStatus.FAILED]: { bg: 'bg-red-100', text: 'text-red-700' },
  [PackageStatus.RETURN_REQUESTED]: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  [PackageStatus.RETURNED]: { bg: 'bg-rose-100', text: 'text-rose-700' }
};

export interface PackageMovement {
  timestamp: string;
  action: 'IMPORTED' | 'COLLECTED' | 'HUB_ARRIVAL' | 'SORTED' | 'LOADED' | 'TRANSFERRED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURN_REQUESTED' | 'RETURNED' | 'STOP_DELETED' | 'MANUAL_STATUS_CHANGE' | 'LOADING_COMPLETE';
  vehicleId?: string;
  vehiclePlate?: string;
  driverId?: string;
  driverName?: string;
  hubId?: string;
  hubName?: string;
  location?: { lat: number; lng: number };
  notes?: string;
}

export interface Package {
  id: string;                      // ID FleetGenius
  
  // Infos client expéditeur
  clientId: string;                // Lien vers User (role=CLIENT)
  clientName: string;              // "PREM BPA"
  importBatchId: string;           // ID de l'import Excel
  
  // Infos commande (du fichier client)
  externalId: string;              // "C0004911-15087911"
  orderNumber: string;             // "15087911" → code barre
  barcode?: string;                // Code barre si différent de orderNumber
  
  // Destination
  address: string;
  city: string;
  postalCode: string;
  zone: Zone;                      // Détectée automatiquement
  coordinates?: { lat: number; lng: number };
  floor?: number;
  hasElevator?: boolean;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;           // Email destinataire (pour copie du BL)

  // Multi-colis (X/N) sur un même point de livraison
  packageIndex?: number;
  packageTotal?: number;

  // Origine self-service client
  createdByClient?: boolean;       // Colis créé par l'expéditeur depuis son espace
  clientReference?: string;        // Référence propre du client (affichée en second)

  // Contraintes
  timeWindowStart?: string;        // "08:00"
  timeWindowEnd?: string;          // "10:00"
  serviceTime: number;             // Minutes sur place (défaut 5)
  comment?: string;                // "Facture", "BL"
  
  // Dimensions (optionnel)
  volume?: number;
  weight?: number;
  
  // État actuel
  status: PackageStatus;
  currentHubId?: string;
  currentVehicleId?: string;
  currentDriverId?: string;
  missionId?: string;
  stopId?: string;
  
  // Tracking
  movements: PackageMovement[];    // Historique complet
  estimatedDeliveryAt?: string;    // Heure de passage prévue (dénormalisée depuis l'arrêt) — affichée au client

  // Suivi live (dénormalisé sur le colis pour l'expéditeur — jamais de données d'un autre client)
  liveDriver?: {                   // position live du livreur qui transporte CE colis
    lat: number;
    lng: number;
    updatedAt: string;             // ISO
    driverName?: string;
  };
  remainingBeforeMine?: number;    // nb de colis encore à livrer AVANT celui-ci dans la tournée

  // POD
  pod?: ProofOfDelivery;
  failureReason?: FailureReason;
  failureNotes?: string;
  
  // Retour hub (si stop supprimé ou annulation)
  returnProof?: ReturnProof;
  returnReason?: string;           // Raison du retour (visible chauffeur)
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export enum FailureReason {
  ABSENT = 'Destinataire absent',
  WRONG_ADDRESS = 'Adresse erronée',
  REFUSED = 'Refusé par destinataire',
  DAMAGED = 'Colis endommagé',
  ACCESS_DENIED = 'Accès impossible',
  CLOSED = 'Établissement fermé',
  OTHER = 'Autre'
}

// ============================================================================
// MISSION (Tournée d'un véhicule)
// ============================================================================

export enum MissionType {
  COLLECTION = 'Collecte',         // Enlèvement chez clients
  DELIVERY = 'Livraison',          // Distribution
  MIXED = 'Mixte',                 // Collecte + Livraison
  TRANSFER = 'Navette'             // Inter-hubs
}

export enum MissionStatus {
  DRAFT = 'Brouillon',             // En préparation
  OPTIMIZED = 'Optimisé',          // GMPRO a calculé
  DISPATCHED = 'Dispatché',        // Envoyé au chauffeur
  IN_PROGRESS = 'En cours',        // Chauffeur a démarré
  COMPLETED = 'Terminé',           // Tous les stops faits
  CANCELLED = 'Annulé'
}

export const MISSION_STATUS_COLORS: Record<MissionStatus, { bg: string; text: string; dot: string }> = {
  [MissionStatus.DRAFT]: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
  [MissionStatus.OPTIMIZED]: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  [MissionStatus.DISPATCHED]: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  [MissionStatus.IN_PROGRESS]: { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  [MissionStatus.COMPLETED]: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  [MissionStatus.CANCELLED]: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' }
};

export enum StopStatus {
  PENDING = 'En attente',
  ARRIVED = 'Arrivé',
  COMPLETED = 'Terminé',
  SKIPPED = 'Passé',
  FAILED = 'Échec'
}

export interface MissionStop {
  id: string;
  sequence: number;                // Ordre dans la tournée (défini par GMPRO)
  
  // Type
  type: 'PICKUP' | 'DELIVERY' | 'HUB';
  
  // Lieu
  address: string;
  city: string;
  postalCode: string;
  coordinates?: { lat: number; lng: number };
  floor?: number;
  hasElevator?: boolean;
  
  // Contact
  contactName: string;
  contactPhone?: string;
  
  // Colis liés
  packageIds: string[];
  packageCount: number;
  
  // Contraintes
  timeWindowStart?: string;
  timeWindowEnd?: string;
  serviceTime: number;             // Minutes sur place
  notes?: string;
  
  // Exécution
  status: StopStatus;
  arrivalTime?: string;
  completionTime?: string;
  arrivalCoordinates?: { lat: number; lng: number };
  
  // ETA calculé par GMPRO
  estimatedArrival?: string;
  estimatedDeparture?: string;
  distanceFromPrevious?: number;   // km
  durationFromPrevious?: number;   // minutes
}

export interface Mission {
  id: string;

  // Client expéditeur (enlèvements) — optionnel selon le type de tournée
  clientId?: string;

  // Type et zone
  type: MissionType;
  zone: Zone;
  hubId: string;
  hubName: string;
  
  // Date
  date: string;                    // "2026-01-31"
  
  // Affectation
  vehicleId?: string;
  vehiclePlate?: string;
  driverId?: string;
  driverName?: string;
  
  // Stops
  stops: MissionStop[];
  
  // Métriques GMPRO
  totalDistance?: number;          // km
  estimatedDuration?: number;      // minutes
  totalPackages: number;
  
  // Exécution
  status: MissionStatus;
  plannedDepartureTime?: string;  // "08:30" — heure de départ prévue (modifiable au dispatch)
  loadedAt?: string;              // ISO — quand le chauffeur a confirmé le chargement
  startedAt?: string;
  completedAt?: string;
  
  // Compteurs temps réel
  completedStops: number;
  failedStops: number;
  deliveredPackages: number;
  failedPackages: number;
  
  // Qui a créé/dispatché
  createdBy: string;
  createdByName: string;
  dispatchedBy?: string;
  dispatchedByName?: string;
  dispatchedAt?: string;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// POD (Preuve de livraison)
// ============================================================================

export interface ProofOfDelivery {
  packageId: string;
  missionId: string;
  stopId: string;
  
  // Qui a livré
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  
  // Réceptionnaire
  recipientName?: string;
  deliveryLocation?: DeliveryLocation;
  
  // Preuves
  signatureUrl?: string;           // URL Storage
  photoUrls: string[];             // URLs des photos
  
  // Localisation
  coordinates: { lat: number; lng: number };
  
  // Horodatage
  timestamp: string;

  // Commentaire
  notes?: string;

  // État de la marchandise constaté à la réception
  merchandiseGoodCondition?: boolean;  // true = reçu en bon état (défaut) ; false = réserves
  reservesNote?: string;               // détail des réserves si décoché
}

// Preuve de retour au hub (quand un colis est annulé/retourné)
export interface ReturnProof {
  packageId: string;
  missionId?: string;
  
  // Qui a retourné
  driverId: string;
  driverName: string;
  vehicleId?: string;
  vehiclePlate?: string;
  
  // Destination du retour
  hubId: string;
  hubName: string;
  
  // Raison du retour
  reason: 'STOP_DELETED' | 'DELIVERY_CANCELLED' | 'ADDRESS_ERROR' | 'REFUSED' | 'OTHER';
  reasonLabel: string;
  
  // Preuves (obligatoires)
  photoUrls: string[];             // Au moins 1 photo obligatoire
  signatureUrl?: string;           // Signature de réception au hub
  
  // Localisation
  coordinates: { lat: number; lng: number };
  
  // Horodatage
  timestamp: string;
  
  // Commentaire
  notes?: string;
}

// Lieu de remise du colis
export enum DeliveryLocation {
  HAND_DELIVERY = 'Remis en main propre',
  NEIGHBOR = 'Remis au voisin',
  CONCIERGE = 'Gardien / Loge',
  MAILBOX = 'Boîte aux lettres',
  RECEPTION = 'Accueil / Secrétariat',
  SAFE_PLACE = 'Lieu sûr (convenu)',
  OTHER = 'Autre'
}

// ============================================================================
// TRANSFERT (Échange entre chauffeurs)
// ============================================================================

export enum TransferReason {
  PROXIMITY = 'Proximité',
  BREAKDOWN = 'Panne véhicule',
  OVERLOAD = 'Surcharge',
  ABSENCE = 'Absence chauffeur',
  REBALANCING = 'Rééquilibrage',
  OTHER = 'Autre'
}

export enum TransferStatus {
  PENDING = 'En attente',
  CONFIRMED = 'Confirmé',
  REJECTED = 'Refusé',
  CANCELLED = 'Annulé'
}

export interface PackageTransfer {
  id: string;
  
  // Colis transférés
  packageIds: string[];
  packageCount: number;
  
  // De qui à qui
  fromDriverId: string;
  fromDriverName: string;
  fromVehicleId: string;
  fromVehiclePlate: string;
  fromMissionId?: string;
  
  toDriverId: string;
  toDriverName: string;
  toVehicleId: string;
  toVehiclePlate: string;
  toMissionId?: string;
  
  // Où et quand
  location?: { lat: number; lng: number };
  address?: string;
  timestamp: string;
  
  // Raison
  reason: TransferReason;
  notes?: string;
  
  // Signatures
  fromSignatureUrl?: string;
  toSignatureUrl?: string;
  
  // Validation
  status: TransferStatus;
  confirmedAt?: string;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// IMPORT BATCH (Lot d'import fichier client)
// ============================================================================

export enum ImportBatchStatus {
  PROCESSING = 'En traitement',
  COMPLETED = 'Terminé',
  PARTIALLY_DISPATCHED = 'Partiellement dispatché',
  FULLY_DISPATCHED = 'Entièrement dispatché',
  ERROR = 'Erreur'
}

export interface ImportBatchError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportBatchZoneBreakdown {
  zone: Zone;
  count: number;
  packageIds: string[];
  hubId?: string;
  hubName?: string;
  dispatched: boolean;
  missionIds?: string[];
}

export interface ImportBatch {
  id: string;
  
  // Client expéditeur
  clientId: string;
  clientName: string;
  
  // Fichier
  fileName: string;
  fileUrl?: string;
  tourName?: string;               // Ex: "PREM" du fichier
  
  // Résultat
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: ImportBatchError[];
  
  // Répartition par zone
  zoneBreakdown: ImportBatchZoneBreakdown[];
  
  // Qui et quand
  importedBy: string;
  importedByName: string;
  importedAt: string;
  
  // Statut
  status: ImportBatchStatus;
}

// ============================================================================
// MAPPING CODES POSTAUX → ZONES (Configuration)
// ============================================================================

export interface PostalCodeMapping {
  postalCode: string;              // "97400"
  zone: Zone;                      // NORD
  city: string;                    // "Saint-Denis"
  hubId?: string;                  // Hub par défaut pour ce code postal
}

// Position live d'un chauffeur (publiée ~toutes les 30s tant qu'il est connecté).
// Doc id = driverId dans la collection 'driverLocations'.
export interface DriverLocation {
  driverId: string;
  driverName: string;
  lat: number;
  lng: number;
  accuracy?: number;               // précision GPS en mètres
  heading?: number;                // cap en degrés (si dispo)
  speed?: number;                  // vitesse m/s (si dispo)
  vehiclePlate?: string;
  updatedAt: string;               // ISO — dernière mise à jour
}