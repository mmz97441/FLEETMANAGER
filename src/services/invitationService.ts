/**
 * Service de gestion des invitations avec tokens
 * 
 * Workflow:
 * 1. Admin crée un utilisateur → génère un token unique
 * 2. Email envoyé avec lien contenant le token
 * 3. Utilisateur clique → vérifie token → crée mot de passe
 * 4. Token invalidé après usage
 */

import { db } from "../firebaseConfig";
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  updateDoc,
  doc,
  deleteDoc,
  Timestamp
} from "firebase/firestore";

// ============================================================================
// TYPES
// ============================================================================

export interface Invitation {
  id?: string;
  token: string;
  email: string;
  userId: string; // ID du profil utilisateur pré-créé
  invitedBy: string; // ID de l'admin qui a invité
  invitedByName: string; // Nom de l'admin
  createdAt: string;
  expiresAt: string;
  used: boolean;
  usedAt?: string;
  // Infos du profil pour le fallback (si le profil original est perdu)
  firstName?: string;
  lastName?: string;
  role?: string;
}

export interface InvitationValidation {
  valid: boolean;
  invitation?: Invitation;
  error?: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_USED';
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Génère un token unique sécurisé
 */
const generateToken = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = 32;
  let token = '';
  
  // Utiliser crypto si disponible pour plus de sécurité
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      token += chars[array[i] % chars.length];
    }
  } else {
    // Fallback
    for (let i = 0; i < length; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  
  return token;
};

/**
 * Calcule la date d'expiration (7 jours par défaut)
 */
const getExpirationDate = (days: number = 7): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Crée une invitation pour un nouvel utilisateur
 */
export const createInvitation = async (
  email: string,
  userId: string,
  invitedBy: { id: string; name: string },
  userInfo?: { firstName?: string; lastName?: string; role?: string }
): Promise<{ token: string; expiresAt: string }> => {
  // Normaliser l'email
  const normalizedEmail = email.toLowerCase().trim();
  
  // Vérifier s'il existe déjà une invitation non utilisée pour cet email
  const existingQ = query(
    collection(db, "invitations"),
    where("email", "==", normalizedEmail),
    where("used", "==", false)
  );
  const existingDocs = await getDocs(existingQ);
  
  // Supprimer les anciennes invitations non utilisées
  for (const doc of existingDocs.docs) {
    await deleteDoc(doc.ref);
  }
  
  // Générer nouveau token
  const token = generateToken();
  const expiresAt = getExpirationDate(7);
  
  const invitation: Omit<Invitation, 'id'> = {
    token,
    email: normalizedEmail,
    userId,
    invitedBy: invitedBy.id,
    invitedByName: invitedBy.name,
    createdAt: new Date().toISOString(),
    expiresAt,
    used: false,
    // Stocker les infos du profil pour le fallback
    ...(userInfo && {
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      role: userInfo.role
    })
  };
  
  await addDoc(collection(db, "invitations"), invitation);
  
  console.log(`✅ Invitation créée pour ${normalizedEmail}, expire le ${expiresAt}`);
  
  return { token, expiresAt };
};

/**
 * Valide un token d'invitation
 */
export const validateInvitationToken = async (token: string): Promise<InvitationValidation> => {
  try {
    const q = query(collection(db, "invitations"), where("token", "==", token));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      console.warn(`❌ Token non trouvé: ${token.substring(0, 8)}...`);
      return { valid: false, error: 'NOT_FOUND' };
    }
    
    const doc = querySnapshot.docs[0];
    const invitation = { id: doc.id, ...doc.data() } as Invitation;
    
    // Vérifier si déjà utilisé
    if (invitation.used) {
      console.warn(`❌ Token déjà utilisé: ${token.substring(0, 8)}...`);
      return { valid: false, error: 'ALREADY_USED', invitation };
    }
    
    // Vérifier expiration
    const now = new Date();
    const expiresAt = new Date(invitation.expiresAt);
    if (now > expiresAt) {
      console.warn(`❌ Token expiré: ${token.substring(0, 8)}...`);
      return { valid: false, error: 'EXPIRED', invitation };
    }
    
    console.log(`✅ Token valide pour: ${invitation.email}`);
    return { valid: true, invitation };
    
  } catch (error) {
    console.error("Erreur validation token:", error);
    return { valid: false, error: 'NOT_FOUND' };
  }
};

/**
 * Marque une invitation comme utilisée
 */
export const markInvitationAsUsed = async (token: string): Promise<boolean> => {
  try {
    const q = query(collection(db, "invitations"), where("token", "==", token));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) return false;
    
    const docRef = querySnapshot.docs[0].ref;
    await updateDoc(docRef, {
      used: true,
      usedAt: new Date().toISOString()
    });
    
    console.log(`✅ Invitation marquée comme utilisée`);
    return true;
    
  } catch (error) {
    console.error("Erreur marquage invitation:", error);
    return false;
  }
};

/**
 * Renvoie une invitation (génère un nouveau token)
 */
export const resendInvitation = async (
  email: string,
  invitedBy: { id: string; name: string }
): Promise<{ token: string; expiresAt: string } | null> => {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Trouver le profil utilisateur existant
    const userQ = query(collection(db, "users"), where("email", "==", normalizedEmail));
    const userDocs = await getDocs(userQ);
    
    if (userDocs.empty) {
      console.error(`❌ Utilisateur non trouvé pour: ${normalizedEmail}`);
      return null;
    }
    
    const userId = userDocs.docs[0].id;
    
    // Créer nouvelle invitation
    return await createInvitation(normalizedEmail, userId, invitedBy);
    
  } catch (error) {
    console.error("Erreur renvoi invitation:", error);
    return null;
  }
};

/**
 * Récupère les infos d'invitation pour un email (pour debug/admin)
 */
export const getInvitationByEmail = async (email: string): Promise<Invitation | null> => {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const q = query(
      collection(db, "invitations"),
      where("email", "==", normalizedEmail),
      where("used", "==", false)
    );
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) return null;
    
    const doc = querySnapshot.docs[0];
    return { id: doc.id, ...doc.data() } as Invitation;
    
  } catch (error) {
    console.error("Erreur récupération invitation:", error);
    return null;
  }
};

/**
 * Construit l'URL d'activation
 */
export const getActivationUrl = (token: string): string => {
  // En production, utiliser l'URL de l'app
  const baseUrl = typeof window !== 'undefined' 
    ? window.location.origin 
    : 'https://delivrex.vercel.app';
  
  return `${baseUrl}/activate?token=${token}`;
};
