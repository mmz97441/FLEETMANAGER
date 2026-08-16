/**
 * CONTRAT DU MODULE « ESPACE EXPÉDITEUR » (Shipper Portal)
 * =========================================================
 * Ce fichier définit l'interface que l'espace client attend de SON backend,
 * indépendamment de Firebase. C'est la clé du découplage : notre app fournit
 * un adaptateur Firebase (ShipperDataPort par défaut) ; une autre société de
 * transport peut fournir SON propre adaptateur (REST, GraphQL, sa base…) sans
 * toucher au portail. Permet la revente en marque blanche ou en module branché.
 *
 * Aucune dépendance à Firebase ici : uniquement des types et une interface.
 */
import { Package, SavedAddress, ProofOfDelivery, Zone } from '../../types';

// --- Identité du client (l'expéditeur connecté) ---
export interface ShipperClientContext {
  id: string;
  companyName: string;
}

// --- Paramètres de création d'expédition (à l'unité) ---
export interface CreateShipmentInput {
  recipient: {
    contactName: string;
    address: string;
    city: string;
    postalCode: string;
    contactPhone?: string;
    contactEmail?: string;
  };
  zone?: Zone;
  packageCount: number;
  weight?: number;
  comment?: string;
  clientReference?: string;
}

// --- Paramètres d'import en masse (une ligne = un colis, identité = son numéro) ---
export interface CreateShipmentBatchRow {
  colisNumber: string;
  contactName: string;
  address: string;
  postalCode: string;
  city: string;
  contactPhone?: string;
  contactEmail?: string;
  weight?: number;
  clientReference?: string;
  comment?: string;
  zone?: Zone;
}

// --- Champs de profil entreprise (figurent sur étiquettes + BL) ---
export interface CompanyProfileFields {
  companyName?: string;
  companyAddress?: string;
  companySiret?: string;
  companyPhone?: string;
}

// --- Nouveau destinataire du carnet ---
export interface RecipientInput {
  contactName: string;
  address: string;
  city: string;
  contactPhone: string;
  contactEmail?: string;
  notes?: string;
}

/**
 * Tout ce dont l'espace expéditeur a besoin de son backend.
 * Chaque backend (le nôtre ou celui d'un client) implémente ce contrat.
 */
export interface ShipperDataPort {
  // Colis / expéditions --------------------------------------------------
  subscribeToPackages(client: ShipperClientContext, cb: (packages: Package[]) => void): () => void;
  createShipment(client: ShipperClientContext, input: CreateShipmentInput): Promise<Package[]>;
  createShipmentsBatch(client: ShipperClientContext, rows: CreateShipmentBatchRow[]): Promise<Package[]>;
  getProofOfDelivery(packageId: string): Promise<ProofOfDelivery | null>;

  // Carnet de destinataires ---------------------------------------------
  subscribeToRecipients(companyName: string, cb: (addresses: SavedAddress[]) => void): () => void;
  addRecipient(client: ShipperClientContext, recipient: RecipientInput): Promise<string>;
  updateRecipient(recipient: SavedAddress): Promise<void>;
  deleteRecipient(recipientId: string): Promise<void>;

  // Profil entreprise ----------------------------------------------------
  updateCompanyProfile(userId: string, fields: CompanyProfileFields): Promise<void>;

  // Géographie / planification (optionnel selon le backend) --------------
  estimateZoneFromAddress?(address: string): Promise<{ zone: Zone; postalCode: string } | null>;

  // Compte (optionnel : dépend de l'auth du backend) ---------------------
  changePassword?(currentPassword: string, newPassword: string): Promise<void>;
}

/**
 * Marque blanche : personnalisation visuelle et textuelle du portail.
 * Permet à chaque transporteur d'avoir SON identité.
 */
export interface BrandingConfig {
  productName: string;        // ex. « DELIVREX »
  logoUrl?: string;           // logo affiché dans l'en-tête / la connexion
  primaryColor: string;       // couleur principale (hex, ex. « #4f46e5 »)
  accentColor?: string;       // couleur secondaire
  supportEmail?: string;      // ex. « david@delivrex.io »
  supportPhone?: string;      // ex. « 0692 303 333 »
  /**
   * Terme métier pour un destinataire. Ex. « pharmacie » pour un grossiste
   * pharmaceutique, « point de vente » ou « client » pour un autre transporteur.
   * Défaut : « destinataire ».
   */
  recipientTerm?: string;
  loginUrl?: string;          // ex. « delivrex.vercel.app »
}

/**
 * Configuration complète d'un locataire (transporteur) : identité + backend.
 */
export interface ShipperTenantConfig {
  tenantId: string;
  branding: BrandingConfig;
  data: ShipperDataPort;
}
