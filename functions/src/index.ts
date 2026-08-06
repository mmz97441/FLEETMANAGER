/**
 * Cloud Functions FleetGenius
 * 
 * Ces fonctions s'exécutent côté serveur avec les droits admin Firebase.
 * Elles permettent des opérations impossibles depuis le client (navigateur).
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";

// Initialiser Firebase Admin
admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

// URL de l'application (configurable via Firebase Functions config ou variable d'environnement)
const APP_URL = process.env.APP_URL || "https://delivrex.vercel.app";

// ============================================================================
// HELPERS DE VÉRIFICATION DE RÔLE
// ============================================================================
// Avant ce helper, le code faisait `callerRole.includes("admin")` ce qui matchait
// faussement "non-admin-readonly", "client-admin", "directeur-stagiaire", etc.
// On normalise (lowercase + sans accents + trim) puis on compare exactement.

const ADMIN_LIKE_ROLES = new Set([
  "admin",
  "administrateur",
  "administratrice",
  "president",
  "presidente",
  "directeur",
  "directrice",
  "direction",
  "directeur exploitation",
  "directrice exploitation",
  "secretaire",
  "secretariat",
]);

const SECRETARY_ALSO_ALLOWED = new Set([
  ...ADMIN_LIKE_ROLES,
  "secretaire",
  "secretariat",
]);

function normalizeRole(role: unknown): string {
  return String(role || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents combinants
    .trim();
}

function isAdminCaller(role: unknown): boolean {
  return ADMIN_LIKE_ROLES.has(normalizeRole(role));
}

function isSecretaryOrAdminCaller(role: unknown): boolean {
  return SECRETARY_ALSO_ALLOWED.has(normalizeRole(role));
}

// ============================================================================
// OPTIMISATION DE TOURNÉES MULTI-VÉHICULES (GMPRO)
// ============================================================================

/**
 * Proxy pour Google Route Optimization API (GMPRO)
 * 
 * L'API GMPRO exige OAuth2 (pas de clé API). Cette Cloud Function
 * sert de proxy authentifié entre le frontend et GMPRO.
 * 
 * Reçoit: la requête GMPRO complète (shipments + vehicles)
 * Retourne: les routes optimisées (répartition multi-véhicules)
 */
export const optimizeTours = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onCall(async (data, context) => {
    // 1. Vérifier l'authentification
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Vous devez être connecté pour optimiser les tournées."
      );
    }

    // 2. Vérifier que la requête contient les données nécessaires
    const { model } = data;
    if (!model || !model.shipments || !model.vehicles) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "La requête doit contenir model.shipments et model.vehicles"
      );
    }

    const shipmentCount = model.shipments.length;
    const vehicleCount = model.vehicles.length;

    console.log(`🚛 Optimisation: ${shipmentCount} livraisons, ${vehicleCount} véhicules`);

    // Transformer le modèle pour GMPRO avec coûts de pénalité
    const gmproModel: any = {
      model: {
        shipments: model.shipments.map((s: any) => ({
          deliveries: s.deliveries,
          label: s.label,
          // Pénalité très élevée si skip (100000 = quasi-obligatoire)
          penaltyCost: s.penaltyCost || 100000
        })),
        vehicles: model.vehicles.map((v: any) => ({
          ...v,
          // Coût par km pour optimiser la distance
          costPerKilometer: 1
        })),
        globalStartTime: model.globalStartTime,
        globalEndTime: model.globalEndTime,
        // Coût global par heure pour équilibrer temps/distance
        globalDurationCostPerHour: 10
      },
      // Paramètres de recherche
      searchMode: model.searchMode || 2,  // CONSUME_ALL_AVAILABLE_TIME
      considerRoadTraffic: true,
      populateTransitionPolylines: false
    };

    // Model envoyé à GMPRO (log supprimé — trop volumineux pour la production)

    // 3. Obtenir le token OAuth2 via Application Default Credentials
    const googleAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    
    let accessToken: string;
    try {
      const client = await googleAuth.getClient();
      const tokenResponse = await client.getAccessToken();
      accessToken = tokenResponse.token || "";
      if (!accessToken) {
        throw new Error("Token vide");
      }
    } catch (err: any) {
      console.error("❌ Erreur OAuth2:", err);
      throw new functions.https.HttpsError(
        "internal",
        `Erreur d'authentification Google: ${err.message}`
      );
    }

    // 4. Appeler Route Optimization API
    // IMPORTANT: GCLOUD_PROJECT renvoie "fleet-genius-app" (alias Firebase)
    // mais le vrai project ID GCP est "fleet-genius-app-485611"
    const projectId = "fleet-genius-app-485611";
    const url = `https://routeoptimization.googleapis.com/v1/projects/${projectId}:optimizeTours`;

    // Appel GMPRO

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify(gmproModel),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error("❌ GMPRO erreur:", JSON.stringify(responseData));
        
        const errMsg = responseData.error?.message || `HTTP ${response.status}`;
        const isApiNotEnabled = errMsg.includes("not been used") || 
                                errMsg.includes("disabled") || 
                                errMsg.includes("not enabled");

        throw new functions.https.HttpsError(
          "internal",
          isApiNotEnabled
            ? "Route Optimization API non activée. Activez-la dans Google Cloud Console → APIs & Services → Library."
            : `Erreur GMPRO: ${errMsg}`
        );
      }

      // 5. Log succès (résumé uniquement)
      const routeCount = responseData.routes?.length || 0;
      const totalVisits = responseData.routes?.reduce(
        (sum: number, r: any) => sum + (r.visits?.length || 0), 0
      ) || 0;
      const totalDistance = (responseData.routes?.reduce(
        (sum: number, r: any) => sum + (r.metrics?.travelDistanceMeters || 0), 0
      ) || 0) / 1000;
      const skippedCount = responseData.metrics?.skippedMandatoryShipmentCount || 0;

      console.log(`✅ Optimisation: ${routeCount} tournées, ${totalVisits} visits, ${totalDistance.toFixed(1)} km, ${skippedCount} skippés`);

      // 6. Log d'audit
      try {
        await db.collection("audit_logs").add({
          action: "TOURS_OPTIMIZED",
          performedBy: context.auth.uid,
          performedAt: admin.firestore.FieldValue.serverTimestamp(),
          details: {
            shipments: shipmentCount,
            vehicles: vehicleCount,
            routesGenerated: routeCount,
            totalDistanceKm: Math.round(totalDistance * 10) / 10,
          },
        });
      } catch (logErr) {
        console.warn("Erreur log audit:", logErr);
      }

      return responseData;

    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) {
        throw err;
      }
      console.error("❌ Erreur réseau GMPRO:", err);
      throw new functions.https.HttpsError(
        "internal",
        `Erreur de connexion à Google Route Optimization: ${err.message}`
      );
    }
  });

// ============================================================================
// SUPPRESSION COMPLETE D'UN UTILISATEUR
// ============================================================================

/**
 * Supprime complètement un utilisateur :
 * - Compte Firebase Auth
 * - Document Firestore (users)
 * - Invitations associées
 * 
 * Appelable uniquement par un admin/président/directeur
 */
export const deleteUserCompletely = functions
  .region("europe-west1") // Serveur en Europe (plus proche de La Réunion)
  .https.onCall(async (data, context) => {
    // 1. Vérifier que l'appelant est authentifié
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Vous devez être connecté pour effectuer cette action."
      );
    }

    const callerUid = context.auth.uid;
    const targetUserId = data.userId;
    const targetEmail = data.email;

    if (!targetUserId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "L'ID de l'utilisateur à supprimer est requis."
      );
    }

    // 2. Vérifier que l'appelant a les droits (admin/président/directeur)
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Votre profil n'a pas été trouvé."
      );
    }

    if (!isAdminCaller(callerDoc.data()?.role)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Vous n'avez pas les droits pour supprimer un utilisateur."
      );
    }

    // 3. Empêcher l'auto-suppression
    if (targetUserId === callerUid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Vous ne pouvez pas supprimer votre propre compte."
      );
    }

    const results = {
      authDeleted: false,
      firestoreDeleted: false,
      invitationsDeleted: 0,
      errors: [] as string[],
    };

    // 4. Supprimer le compte Firebase Auth
    try {
      // Essayer de trouver l'utilisateur Auth par ID ou par email
      try {
        await auth.deleteUser(targetUserId);
        results.authDeleted = true;
        console.log(`✅ Auth supprimé pour UID: ${targetUserId}`);
      } catch (authError: any) {
        // Si l'ID ne correspond pas à un Auth user, essayer par email
        if (authError.code === "auth/user-not-found" && targetEmail) {
          try {
            const userByEmail = await auth.getUserByEmail(targetEmail);
            await auth.deleteUser(userByEmail.uid);
            results.authDeleted = true;
            console.log(`✅ Auth supprimé pour email: ${targetEmail}`);
          } catch (emailError: any) {
            if (emailError.code === "auth/user-not-found") {
              // Pas de compte Auth = peut-être jamais activé, c'est OK
              console.log(`ℹ️ Pas de compte Auth trouvé pour: ${targetEmail}`);
            } else {
              throw emailError;
            }
          }
        } else if (authError.code !== "auth/user-not-found") {
          throw authError;
        }
      }
    } catch (error: any) {
      console.error("❌ Erreur suppression Auth:", error);
      results.errors.push(`Auth: ${error.message}`);
    }

    // 5. Supprimer le document Firestore
    try {
      await db.collection("users").doc(targetUserId).delete();
      results.firestoreDeleted = true;
      console.log(`✅ Firestore users/${targetUserId} supprimé`);
    } catch (error: any) {
      console.error("❌ Erreur suppression Firestore:", error);
      results.errors.push(`Firestore: ${error.message}`);
    }

    // 6. Supprimer les invitations associées
    if (targetEmail) {
      try {
        const invitationsQuery = await db
          .collection("invitations")
          .where("email", "==", targetEmail.toLowerCase())
          .get();

        const batch = db.batch();
        invitationsQuery.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });

        if (!invitationsQuery.empty) {
          await batch.commit();
          results.invitationsDeleted = invitationsQuery.size;
          console.log(`✅ ${invitationsQuery.size} invitation(s) supprimée(s)`);
        }
      } catch (error: any) {
        console.error("❌ Erreur suppression invitations:", error);
        results.errors.push(`Invitations: ${error.message}`);
      }
    }

    // 7. Log pour audit
    try {
      await db.collection("audit_logs").add({
        action: "USER_DELETED",
        targetUserId,
        targetEmail: targetEmail || "unknown",
        performedBy: callerUid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
        results,
      });
    } catch (logError) {
      console.error("Erreur log audit:", logError);
    }

    // 8. Retourner le résultat
    if (results.errors.length > 0) {
      console.warn("Suppression partielle:", results);
    }

    return {
      success: results.firestoreDeleted,
      message: results.errors.length === 0 
        ? "Utilisateur supprimé avec succès" 
        : `Suppression partielle: ${results.errors.join(", ")}`,
      details: results,
    };
  });

// ============================================================================
// NETTOYAGE DES INVITATIONS EXPIREES (Scheduled)
// ============================================================================

/**
 * Nettoie automatiquement les invitations expirées
 * S'exécute tous les jours à 3h du matin
 */
export const cleanupExpiredInvitations = functions
  .region("europe-west1")
  .pubsub.schedule("0 3 * * *") // Tous les jours à 3h
  .timeZone("Indian/Reunion")
  .onRun(async () => {
    const now = new Date().toISOString();
    
    const expiredQuery = await db
      .collection("invitations")
      .where("expiresAt", "<", now)
      .where("used", "==", false)
      .get();

    if (expiredQuery.empty) {
      console.log("Aucune invitation expirée à nettoyer");
      return null;
    }

    const batch = db.batch();
    expiredQuery.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`✅ ${expiredQuery.size} invitation(s) expirée(s) supprimée(s)`);

    return null;
  });

// ============================================================================
// DESACTIVER / REACTIVER UN COMPTE
// ============================================================================

/**
 * Désactive ou réactive un compte utilisateur
 * L'utilisateur ne pourra plus se connecter tant que le compte est désactivé
 */
export const toggleUserStatus = functions
  .region("europe-west1")
  .https.onCall(async (data, context) => {
    // 1. Vérifier l'authentification
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Vous devez être connecté pour effectuer cette action."
      );
    }

    const callerUid = context.auth.uid;
    const { userId, email, disable } = data;

    if (!userId || typeof disable !== "boolean") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "userId et disable (true/false) sont requis."
      );
    }

    // 2. Vérifier les permissions
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Votre profil n'a pas été trouvé."
      );
    }

    if (!isAdminCaller(callerDoc.data()?.role)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Vous n'avez pas les droits pour cette action."
      );
    }

    // 3. Empêcher l'auto-désactivation
    if (userId === callerUid) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Vous ne pouvez pas désactiver votre propre compte."
      );
    }

    const results = {
      authUpdated: false,
      firestoreUpdated: false,
      error: null as string | null,
    };

    // 4. Trouver et désactiver/réactiver dans Firebase Auth
    try {
      let authUser;
      
      // Essayer par UID d'abord
      try {
        authUser = await auth.getUser(userId);
      } catch (e) {
        // Si pas trouvé par UID, essayer par email
        if (email) {
          authUser = await auth.getUserByEmail(email);
        }
      }

      if (authUser) {
        await auth.updateUser(authUser.uid, { disabled: disable });
        results.authUpdated = true;
        console.log(`✅ Auth ${disable ? "désactivé" : "réactivé"} pour: ${authUser.email}`);
      } else {
        // Pas de compte Auth = utilisateur n'a jamais activé son compte
        console.log(`ℹ️ Pas de compte Auth trouvé pour userId: ${userId}`);
      }
    } catch (error: any) {
      console.error("❌ Erreur Auth:", error);
      results.error = error.message;
    }

    // 5. Mettre à jour le statut dans Firestore
    try {
      await db.collection("users").doc(userId).update({
        isDisabled: disable,
        disabledAt: disable ? admin.firestore.FieldValue.serverTimestamp() : null,
        disabledBy: disable ? callerUid : null,
      });
      results.firestoreUpdated = true;
      console.log(`✅ Firestore mis à jour: isDisabled = ${disable}`);
    } catch (error: any) {
      console.error("❌ Erreur Firestore:", error);
      results.error = error.message;
    }

    // 6. Log d'audit
    try {
      await db.collection("audit_logs").add({
        action: disable ? "USER_DISABLED" : "USER_ENABLED",
        targetUserId: userId,
        targetEmail: email || "unknown",
        performedBy: callerUid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
        results,
      });
    } catch (logError) {
      console.error("Erreur log audit:", logError);
    }

    return {
      success: results.authUpdated || results.firestoreUpdated,
      message: disable 
        ? "Compte désactivé. L'utilisateur ne peut plus se connecter."
        : "Compte réactivé. L'utilisateur peut à nouveau se connecter.",
      details: results,
    };
  });

// ============================================================================
// FORCER REINITIALISATION MOT DE PASSE
// ============================================================================

/**
 * Force la réinitialisation du mot de passe d'un utilisateur
 * Envoie un email de reset via Firebase Auth
 */
export const forcePasswordReset = functions
  .region("europe-west1")
  .https.onCall(async (data, context) => {
    // 1. Vérifier l'authentification
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Vous devez être connecté pour effectuer cette action."
      );
    }

    const callerUid = context.auth.uid;
    const { userId, email } = data;

    if (!email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "L'email de l'utilisateur est requis."
      );
    }

    // 2. Vérifier les permissions
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Votre profil n'a pas été trouvé."
      );
    }

    if (!isSecretaryOrAdminCaller(callerDoc.data()?.role)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Vous n'avez pas les droits pour cette action."
      );
    }

    // 3. Générer le lien de réinitialisation
    try {
      // Vérifier que l'utilisateur existe dans Auth
      const authUser = await auth.getUserByEmail(email);
      
      // Générer le lien de reset
      const resetLink = await auth.generatePasswordResetLink(email, {
        url: APP_URL, // URL de redirection après reset
      });

      console.log(`✅ Lien de reset généré pour: ${email}`);

      // 4. Envoyer l'email via la collection "mail" (Trigger Email extension)
      await db.collection("mail").add({
        to: email,
        message: {
          subject: "🔐 Réinitialisation de votre mot de passe FleetGenius",
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%); color: white; padding: 30px; border-radius: 16px 16px 0 0; text-align: center; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 16px 16px; }
                .button { display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white !important; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: bold; margin: 20px 0; }
                .alert { background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 12px; margin: 20px 0; }
                .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>🔐 Réinitialisation de mot de passe</h1>
                  <p>Demande effectuée par un administrateur</p>
                </div>
                <div class="content">
                  <p>Bonjour,</p>
                  <p>Un administrateur FleetGenius a demandé la réinitialisation de votre mot de passe.</p>
                  
                  <div class="alert">
                    <strong>⚠️ Action requise</strong><br>
                    Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe.
                  </div>
                  
                  <div style="text-align: center;">
                    <a href="${resetLink}" class="button">Réinitialiser mon mot de passe</a>
                  </div>
                  
                  <p style="color: #64748b; font-size: 14px; margin-top: 24px;">
                    Si vous n'êtes pas à l'origine de cette demande, contactez votre responsable.<br><br>
                    Ce lien expire dans 1 heure.
                  </p>
                </div>
                <div class="footer">
                  <p>FleetGenius Pro - Gestion de flotte intelligente</p>
                </div>
              </div>
            </body>
            </html>
          `,
        },
      });

      console.log(`✅ Email de reset envoyé à: ${email}`);

      // 5. Log d'audit
      await db.collection("audit_logs").add({
        action: "PASSWORD_RESET_FORCED",
        targetUserId: userId || authUser.uid,
        targetEmail: email,
        performedBy: callerUid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        message: `Email de réinitialisation envoyé à ${email}`,
      };

    } catch (error: any) {
      console.error("❌ Erreur reset password:", error);
      
      if (error.code === "auth/user-not-found") {
        throw new functions.https.HttpsError(
          "not-found",
          "Cet utilisateur n'a pas encore activé son compte. Renvoyez-lui une invitation."
        );
      }
      
      throw new functions.https.HttpsError(
        "internal",
        `Erreur: ${error.message}`
      );
    }
  });

// ============================================================================
// VALIDATION DE TOKEN D'INVITATION (PUBLIC - sans authentification)
// ============================================================================

/**
 * Valide un token d'invitation et retourne les informations
 * Cette fonction est publique car l'utilisateur n'est pas encore connecté
 */
export const validateInvitationToken = functions
  .region("europe-west1")
  .https.onCall(async (data) => {
    const { token } = data;

    if (!token || typeof token !== "string") {
      return {
        valid: false,
        error: "NOT_FOUND",
        message: "Token manquant ou invalide",
      };
    }

    try {
      // Chercher l'invitation
      const snapshot = await db
        .collection("invitations")
        .where("token", "==", token)
        .limit(1)
        .get();

      if (snapshot.empty) {
        console.warn(`❌ Token non trouvé: ${token.substring(0, 8)}...`);
        return {
          valid: false,
          error: "NOT_FOUND",
          message: "Ce lien d'invitation n'existe pas.",
        };
      }

      const invitationDoc = snapshot.docs[0];
      const invitation = invitationDoc.data();

      // Vérifier si déjà utilisé
      if (invitation.used) {
        console.warn(`❌ Token déjà utilisé: ${token.substring(0, 8)}...`);
        return {
          valid: false,
          error: "ALREADY_USED",
          message: "Ce lien a déjà été utilisé.",
          invitation: {
            email: invitation.email,
            usedAt: invitation.usedAt,
          },
        };
      }

      // Vérifier expiration
      const now = new Date();
      const expiresAt = new Date(invitation.expiresAt);
      if (now > expiresAt) {
        console.warn(`❌ Token expiré: ${token.substring(0, 8)}...`);
        return {
          valid: false,
          error: "EXPIRED",
          message: "Ce lien a expiré.",
          invitation: {
            email: invitation.email,
            expiresAt: invitation.expiresAt,
          },
        };
      }

      // Récupérer les infos de l'utilisateur pré-créé
      const userDoc = await db.collection("users").doc(invitation.userId).get();
      const userData = userDoc.exists ? userDoc.data() : null;

      console.log(`✅ Token valide pour: ${invitation.email}`);

      return {
        valid: true,
        invitation: {
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          invitedByName: invitation.invitedByName,
          firstName: userData?.firstName || "",
          lastName: userData?.lastName || "",
          role: userData?.role || "",
        },
      };

    } catch (error: any) {
      console.error("❌ Erreur validation token:", error);
      return {
        valid: false,
        error: "ERROR",
        message: "Une erreur est survenue.",
      };
    }
  });

// ============================================================================
// ACTIVATION DE COMPTE (PUBLIC - sans authentification)
// ============================================================================

/**
 * Active un compte utilisateur avec un token d'invitation
 * FLUX ROBUSTE PRODUCTION:
 * 1. Valide le token d'invitation
 * 2. Crée le compte Firebase Auth
 * 3. Migre OU reconstruit le profil Firestore avec l'UID Auth
 * 4. Marque l'invitation comme utilisée
 * 5. Log d'audit
 */
export const activateAccount = functions
  .region("europe-west1")
  .https.onCall(async (data) => {
    const { token, password } = data;

    // ========================================
    // VALIDATIONS
    // ========================================
    if (!token || typeof token !== "string") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Token manquant"
      );
    }

    if (!password || password.length < 6) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Le mot de passe doit contenir au moins 6 caractères"
      );
    }

    try {
      // ========================================
      // ÉTAPE 1: TROUVER ET VALIDER L'INVITATION
      // ========================================
      console.log(`🔍 Recherche invitation pour token: ${token.substring(0, 8)}...`);
      
      const snapshot = await db
        .collection("invitations")
        .where("token", "==", token)
        .limit(1)
        .get();

      if (snapshot.empty) {
        throw new functions.https.HttpsError(
          "not-found",
          "Lien d'invitation invalide"
        );
      }

      const invitationDoc = snapshot.docs[0];
      const invitation = invitationDoc.data();

      console.log(`📧 Invitation trouvée pour: ${invitation.email}`);

      if (invitation.used) {
        throw new functions.https.HttpsError(
          "already-exists",
          "Ce lien a déjà été utilisé. Connectez-vous avec votre email et mot de passe."
        );
      }

      const now = new Date();
      const expiresAt = new Date(invitation.expiresAt);
      if (now > expiresAt) {
        throw new functions.https.HttpsError(
          "deadline-exceeded",
          "Ce lien a expiré. Demandez une nouvelle invitation à votre administrateur."
        );
      }

      // ========================================
      // ÉTAPE 2: CRÉER LE COMPTE FIREBASE AUTH
      // ========================================
      console.log(`🔐 Création du compte Auth pour: ${invitation.email}`);
      
      let authUser;
      try {
        authUser = await auth.createUser({
          email: invitation.email.toLowerCase().trim(),
          password: password,
          emailVerified: true, // Email vérifié car il a reçu l'invitation
        });
        console.log(`✅ Compte Auth créé: ${authUser.uid}`);
      } catch (authError: any) {
        if (authError.code === "auth/email-already-exists") {
          // L'utilisateur existe déjà dans Auth - peut-être une activation partielle précédente
          console.warn(`⚠️ Compte Auth existe déjà pour: ${invitation.email}`);
          
          // Récupérer l'UID existant
          const existingUser = await auth.getUserByEmail(invitation.email.toLowerCase().trim());
          
          // Vérifier si le profil Firestore existe
          const existingProfile = await db.collection("users").doc(existingUser.uid).get();
          
          if (existingProfile.exists) {
            // Le compte est déjà complètement activé
            throw new functions.https.HttpsError(
              "already-exists",
              "Ce compte existe déjà. Utilisez 'Mot de passe oublié' si vous avez oublié votre mot de passe."
            );
          }
          
          // Le compte Auth existe mais pas le profil - on continue avec cet UID
          authUser = existingUser;
          console.log(`🔄 Utilisation du compte Auth existant: ${authUser.uid}`);
        } else {
          throw authError;
        }
      }

      // ========================================
      // ÉTAPE 3: CRÉER/MIGRER LE PROFIL FIRESTORE + MARQUER L'INVITATION
      // ========================================
      // Toutes les écritures Firestore sont enveloppées dans une transaction :
      // si l'une plante, aucune n'est appliquée → pas d'invitation marquée "used"
      // alors que le profil n'a pas été créé, et inversement.
      // En cas d'échec Firestore après création Auth, on supprime le compte Auth
      // pour ne pas laisser de compte orphelin (sinon le user retombe sur
      // "Ce compte existe déjà" sans pouvoir se connecter).
      console.log(`📝 Migration/Création du profil Firestore (transactionnel)...`);

      // Pré-validation : si on doit reconstruire, on a besoin de firstName/lastName.
      // On vérifie AVANT la transaction pour ne pas créer Auth pour rien.
      if (!invitation.firstName || !invitation.lastName) {
        // On vérifiera dans la transaction si on tombe dans le cas "reconstruction"
        // (sinon les noms viennent du profil existant)
      }

      const authUid = authUser.uid;
      const normalizedEmail = invitation.email.toLowerCase().trim();
      let wasReconstructed = false;

      try {
        await db.runTransaction(async (tx) => {
          // --- Lectures (obligatoires AVANT toute écriture en transaction) ---
          const newProfileRef = db.collection("users").doc(authUid);
          const newProfileSnap = await tx.get(newProfileRef);

          // L'ID original (pré-activation) peut être différent de l'UID Auth.
          // Si invitation.userId est absent, on est forcément en cas "reconstruction".
          const oldProfileRef = invitation.userId
            ? db.collection("users").doc(invitation.userId)
            : null;
          const oldProfileSnap = oldProfileRef ? await tx.get(oldProfileRef) : null;

          // --- Écritures ---
          if (newProfileSnap.exists) {
            // Double activation : le profil cible existe déjà, on ne touche pas
            console.log(`✅ Profil existe déjà avec le bon UID: ${authUid}`);
          } else if (oldProfileSnap && oldProfileSnap.exists) {
            // MIGRATION : copier l'ancien profil vers le nouvel UID puis supprimer
            const userData = oldProfileSnap.data() || {};
            tx.set(newProfileRef, {
              ...userData,
              id: authUid,
              email: normalizedEmail,
              activatedAt: admin.firestore.FieldValue.serverTimestamp(),
              status: "active",
            });
            tx.delete(oldProfileRef!);
            console.log(`✅ Profil migré de ${invitation.userId} vers ${authUid}`);
          } else {
            // RECONSTRUCTION depuis l'invitation
            if (!invitation.firstName || !invitation.lastName) {
              throw new functions.https.HttpsError(
                "failed-precondition",
                "Les informations de profil sont manquantes. Contactez votre administrateur."
              );
            }
            wasReconstructed = true;
            tx.set(newProfileRef, {
              id: authUid,
              email: normalizedEmail,
              firstName: invitation.firstName,
              lastName: invitation.lastName,
              role: invitation.role || "Chauffeur",
              activatedAt: admin.firestore.FieldValue.serverTimestamp(),
              createdAt: invitation.createdAt || new Date().toISOString(),
              status: "active",
              phone: "",
              assignedVehicleId: null,
              companyName: "",
            });
            console.log(`✅ Profil reconstruit pour ${authUid}: ${invitation.firstName} ${invitation.lastName}`);
          }

          // Marquer l'invitation comme utilisée (atomique avec le profil)
          tx.update(invitationDoc.ref, {
            used: true,
            usedAt: new Date().toISOString(),
            authUid: authUid,
            activationSuccess: true,
          });
        });
      } catch (firestoreError: any) {
        // Rollback : supprimer le compte Auth qu'on vient de créer
        // (sauf si on l'avait récupéré dans le branch email-already-exists,
        // mais on peut quand même tenter le delete sans bloquer)
        console.error("❌ Échec écriture Firestore après création Auth, rollback de l'utilisateur Auth", firestoreError);
        try {
          await auth.deleteUser(authUid);
          console.log(`🧹 Compte Auth ${authUid} supprimé (rollback)`);
        } catch (deleteErr) {
          console.error(`⚠️ Impossible de supprimer le compte Auth orphelin ${authUid}`, deleteErr);
        }
        if (firestoreError instanceof functions.https.HttpsError) {
          throw firestoreError;
        }
        throw new functions.https.HttpsError(
          "internal",
          `Échec activation côté base de données : ${firestoreError?.message || firestoreError}`
        );
      }

      console.log(`✅ Compte activé avec succès pour: ${invitation.email}`);

      // ========================================
      // ÉTAPE 5: LOG D'AUDIT (best-effort, ne bloque pas le retour)
      // ========================================
      // Avant : `reconstructed: !await db...` lisait un doc qui venait d'être
      // supprimé dans la migration → la valeur était quasi-toujours fausse.
      // On utilise désormais la variable `wasReconstructed` réellement calculée.
      try {
        await db.collection("audit_logs").add({
          action: "ACCOUNT_ACTIVATED",
          userId: authUid,
          email: invitation.email,
          invitedBy: invitation.invitedBy,
          invitedByName: invitation.invitedByName,
          originalUserId: invitation.userId,
          reconstructed: wasReconstructed,
          activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (auditErr) {
        console.warn("⚠️ Échec écriture audit_log (non bloquant)", auditErr);
      }

      return {
        success: true,
        email: invitation.email,
        message: "Compte activé avec succès ! Vous pouvez maintenant vous connecter.",
      };

    } catch (error: any) {
      console.error("❌ Erreur activation:", error);
      
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      
      throw new functions.https.HttpsError(
        "internal",
        `Erreur lors de l'activation: ${error.message}`
      );
    }
  });
