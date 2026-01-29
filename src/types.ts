
export enum VehicleStatus {
  ACTIVE = 'En Service',
  MAINTENANCE = 'Maintenance',
  IDLE = 'Disponible',
  ISSUE = 'Problème Signalé'
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
  | 'notifications_settings'
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
  notes?: string;           // Notes optionnelles
  isFavorite?: boolean;     // Adresse favorite (affichée en premier)
  usageCount?: number;      // Nombre d'utilisations (pour tri par pertinence)
  createdAt: string;
  updatedAt: string;
}