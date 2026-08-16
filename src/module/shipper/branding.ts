/**
 * MARQUE BLANCHE — configuration par défaut (DELIVREX)
 * ====================================================
 * Point unique où vit l'identité visuelle/textuelle du portail expéditeur.
 * Pour revendre le module à un autre transporteur, on fournit une autre
 * BrandingConfig (son nom, son logo, ses couleurs, son contact) sans toucher
 * au code du portail. Objectif : plus aucune mention « DELIVREX » en dur.
 */
import { BrandingConfig } from './contract';

export const DEFAULT_BRANDING: BrandingConfig = {
  productName: 'DELIVREX',
  primaryColor: '#4f46e5',      // indigo-600 (couleur actuelle du portail)
  accentColor: '#0ea5e9',
  supportEmail: 'david@delivrex.io',
  supportPhone: '0692 303 333',
  recipientTerm: 'destinataire',
  loginUrl: 'delivrex.vercel.app',
};

/**
 * Fusionne une config partielle par-dessus la marque par défaut.
 * Un locataire ne renseigne que ce qui change (nom, logo, couleur…).
 */
export const resolveBranding = (override?: Partial<BrandingConfig>): BrandingConfig => ({
  ...DEFAULT_BRANDING,
  ...(override || {}),
});
