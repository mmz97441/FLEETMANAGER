/**
 * Service pour appeler les Cloud Functions Firebase
 */

import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../firebaseConfig";

// Initialiser Functions avec la région Europe
const functions = getFunctions(app, "europe-west1");

// Décommenter pour tester avec l'émulateur local
// import { connectFunctionsEmulator } from "firebase/functions";
// connectFunctionsEmulator(functions, "localhost", 5001);

// ============================================================================
// TYPES
// ============================================================================

interface DeleteUserResult {
  success: boolean;
  message: string;
  details: {
    authDeleted: boolean;
    firestoreDeleted: boolean;
    invitationsDeleted: number;
    errors: string[];
  };
}

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Supprime complètement un utilisateur via Cloud Function
 * - Compte Firebase Auth
 * - Document Firestore
 * - Invitations associées
 */
export const deleteUserCompletely = async (
  userId: string, 
  email: string
): Promise<DeleteUserResult> => {
  try {
    const deleteFunction = httpsCallable<
      { userId: string; email: string },
      DeleteUserResult
    >(functions, "deleteUserCompletely");

    const result = await deleteFunction({ userId, email });
    
    console.log("✅ Suppression utilisateur:", result.data);
    return result.data;
    
  } catch (error: any) {
    console.error("❌ Erreur suppression utilisateur:", error);
    
    // Extraire le message d'erreur Firebase
    const errorMessage = error.message || "Erreur lors de la suppression";
    
    return {
      success: false,
      message: errorMessage,
      details: {
        authDeleted: false,
        firestoreDeleted: false,
        invitationsDeleted: 0,
        errors: [errorMessage],
      },
    };
  }
};

// ============================================================================
// TOGGLE USER STATUS (Désactiver / Réactiver)
// ============================================================================

interface ToggleStatusResult {
  success: boolean;
  message: string;
  details: {
    authUpdated: boolean;
    firestoreUpdated: boolean;
    error: string | null;
  };
}

/**
 * Désactive ou réactive un compte utilisateur
 */
export const toggleUserStatus = async (
  userId: string,
  email: string,
  disable: boolean
): Promise<ToggleStatusResult> => {
  try {
    const toggleFunction = httpsCallable<
      { userId: string; email: string; disable: boolean },
      ToggleStatusResult
    >(functions, "toggleUserStatus");

    const result = await toggleFunction({ userId, email, disable });
    
    console.log(`✅ Compte ${disable ? "désactivé" : "réactivé"}:`, result.data);
    return result.data;
    
  } catch (error: any) {
    console.error("❌ Erreur toggle status:", error);
    
    const errorMessage = error.message || "Erreur lors de la modification du statut";
    
    return {
      success: false,
      message: errorMessage,
      details: {
        authUpdated: false,
        firestoreUpdated: false,
        error: errorMessage,
      },
    };
  }
};

// ============================================================================
// FORCE PASSWORD RESET
// ============================================================================

interface PasswordResetResult {
  success: boolean;
  message: string;
}

/**
 * Force la réinitialisation du mot de passe d'un utilisateur
 * Envoie un email de reset
 */
export const forcePasswordReset = async (
  userId: string,
  email: string
): Promise<PasswordResetResult> => {
  try {
    const resetFunction = httpsCallable<
      { userId: string; email: string },
      PasswordResetResult
    >(functions, "forcePasswordReset");

    const result = await resetFunction({ userId, email });
    
    console.log("✅ Reset password:", result.data);
    return result.data;
    
  } catch (error: any) {
    console.error("❌ Erreur reset password:", error);
    
    // Extraire le message d'erreur Firebase Functions
    let errorMessage = "Erreur lors de la réinitialisation";
    
    if (error.code === "functions/not-found") {
      errorMessage = "Cet utilisateur n'a pas encore activé son compte. Renvoyez-lui une invitation.";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      success: false,
      message: errorMessage,
    };
  }
};

// ============================================================================
// OPTIMISATION DE TOURNÉES MULTI-VÉHICULES (GMPRO via Cloud Function)
// ============================================================================

export interface GMPROModel {
  shipments: Array<{
    deliveries: Array<{
      arrivalLocation: { latLng: { latitude: number; longitude: number } };
      duration: string;
      timeWindows?: Array<{ startTime: string; endTime: string }>;
    }>;
    label: string;
  }>;
  vehicles: Array<{
    startLocation: { latLng: { latitude: number; longitude: number } };
    endLocation: { latLng: { latitude: number; longitude: number } };
    label: string;
  }>;
  globalStartTime: string;
  globalEndTime: string;
}

export interface GMPROResult {
  routes?: Array<{
    vehicleIndex: number;
    visits?: Array<{
      shipmentIndex: number;
      startTime?: string;
      detour?: string;
    }>;
    metrics?: {
      totalDuration?: string;
      travelDuration?: string;
      travelDistanceMeters?: number;
    };
    routeTotalCost?: number;
  }>;
  totalCost?: number;
  metrics?: {
    skippedMandatoryShipmentCount?: number;
  };
}

/**
 * Appelle Google Route Optimization API via Cloud Function
 * Répartit M livraisons sur N véhicules de façon optimale
 */
export const optimizeToursCF = async (
  model: GMPROModel
): Promise<GMPROResult> => {
  try {
    console.log(`🚛 Appel GMPRO: ${model.shipments.length} livraisons, ${model.vehicles.length} véhicules`);
    
    const optimizeFunction = httpsCallable<
      { model: GMPROModel },
      GMPROResult
    >(functions, "optimizeTours");

    const result = await optimizeFunction({ model });
    
    console.log("✅ GMPRO résultat:", result.data);
    return result.data;
    
  } catch (error: any) {
    console.error("❌ Erreur optimisation tournées:", error);
    
    // Extraire le message d'erreur Firebase Functions
    let errorMessage = "Erreur lors de l'optimisation des tournées";
    
    if (error.code === "functions/internal") {
      errorMessage = error.message || "Erreur serveur GMPRO";
    } else if (error.code === "functions/unauthenticated") {
      errorMessage = "Vous devez être connecté";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
};

// ============================================================================
// VALIDATION TOKEN D'INVITATION (Public - pour activation)
// ============================================================================

export interface InvitationInfo {
  email: string;
  expiresAt?: string;
  invitedByName?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  usedAt?: string;
}

export interface ValidateTokenResult {
  valid: boolean;
  error?: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_USED' | 'ERROR';
  message?: string;
  invitation?: InvitationInfo;
}

/**
 * Valide un token d'invitation via Cloud Function
 * Fonctionne sans authentification (utilisateur pas encore connecté)
 */
export const validateInvitationTokenCF = async (
  token: string
): Promise<ValidateTokenResult> => {
  try {
    const validateFunction = httpsCallable<
      { token: string },
      ValidateTokenResult
    >(functions, "validateInvitationToken");

    const result = await validateFunction({ token });
    
    console.log("✅ Validation token:", result.data.valid);
    return result.data;
    
  } catch (error: any) {
    console.error("❌ Erreur validation token:", error);
    
    return {
      valid: false,
      error: 'ERROR',
      message: error.message || "Erreur lors de la validation",
    };
  }
};

// ============================================================================
// ACTIVATION DE COMPTE (Public - pour activation)
// ============================================================================

export interface ActivateAccountResult {
  success: boolean;
  message: string;
  email?: string;
}

/**
 * Active un compte utilisateur via Cloud Function
 * - Crée le compte Auth
 * - Migre le profil
 * - Marque l'invitation comme utilisée
 * - Retourne un custom token pour auto-login
 */
export const activateAccountCF = async (
  token: string,
  password: string
): Promise<ActivateAccountResult> => {
  try {
    const activateFunction = httpsCallable<
      { token: string; password: string },
      ActivateAccountResult
    >(functions, "activateAccount");

    const result = await activateFunction({ token, password });
    
    console.log("✅ Activation:", result.data.success);
    return result.data;
    
  } catch (error: any) {
    console.error("❌ Erreur activation:", error);
    
    // Extraire le message d'erreur
    let errorMessage = "Erreur lors de l'activation";
    
    if (error.code === "functions/already-exists") {
      errorMessage = "Ce compte existe déjà. Utilisez 'Mot de passe oublié' pour vous connecter.";
    } else if (error.code === "functions/deadline-exceeded") {
      errorMessage = "Ce lien a expiré. Demandez une nouvelle invitation.";
    } else if (error.code === "functions/not-found") {
      errorMessage = "Lien d'invitation invalide.";
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      success: false,
      message: errorMessage,
    };
  }
};
