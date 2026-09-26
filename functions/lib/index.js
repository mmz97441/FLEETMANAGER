"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.interpretAnalytics = exports.acceptQuote = exports.getTeamDirectory = exports.notifyPackageStatus = exports.returnPackage = exports.deleteAbsence = exports.deleteVehicle = exports.importPackages = exports.assignVehicle = exports.askFleetGenius = exports.sendBusinessNotification = exports.transferPackages = exports.scanPackage = exports.dispatchMissions = exports.finishMission = exports.receivePackagesAtHub = exports.saveAbsence = exports.revokeOwnSessions = exports.linkAuthToProfile = exports.recordUserPresence = exports.getOwnProfile = exports.createInvitation = exports.activateAccount = exports.validateInvitationToken = exports.forcePasswordReset = exports.toggleUserStatus = exports.cleanupExpiredInvitations = exports.deleteUserCompletely = exports.optimizeTours = exports.employeeVoting = exports.recordClientErrors = exports.associateCarrierBarcode = void 0;
const hubReception_1 = require("./hubReception");
const carrierBarcode_1 = require("./carrierBarcode");
const clientErrors_1 = require("./clientErrors");
const voting_1 = require("./voting");
const storage_1 = require("firebase-admin/storage");
const scanPackage_1 = require("./scanPackage");
const missionLifecycle_1 = require("./missionLifecycle");
const deliveryAddress_1 = require("./deliveryAddress");
const dispatchMissions_1 = require("./dispatchMissions");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const crypto_1 = require("crypto");
/**
 * Cloud Functions FleetGenius
 *
 * Ces fonctions s'exécutent côté serveur avec les droits admin Firebase.
 * Elles permettent des opérations impossibles depuis le client (navigateur).
 */
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const google_auth_library_1 = require("google-auth-library");
// Initialiser Firebase Admin
admin.initializeApp();
const db = (0, firestore_1.getFirestore)();
const auth = (0, auth_1.getAuth)();
exports.associateCarrierBarcode = functions.region('europe-west1').https.onCall((data, context) => (0, carrierBarcode_1.associateCarrierBarcodeHandler)(data, context, { db, requireActiveCaller, isAdminCaller }));
exports.recordClientErrors = functions.region('europe-west1').https.onCall((data, context) => (0, clientErrors_1.recordClientErrorsHandler)(data, context, { db, requireActiveCaller }));
exports.employeeVoting = functions.region('europe-west1').runWith({ timeoutSeconds: 120, memory: '256MB' }).https.onCall((data, context) => (0, voting_1.votingHandler)(data, context, {
    db, requireActiveCaller,
    fileMetadata: async (path) => {
        const [metadata] = await (0, storage_1.getStorage)().bucket().file(path).getMetadata();
        return { size: Number(metadata.size), contentType: metadata.contentType || '', generation: String(metadata.generation) };
    },
    downloadFile: async (path, generation) => {
        const [buffer] = await (0, storage_1.getStorage)().bucket().file(path, { generation }).download();
        return buffer;
    },
}));
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
function normalizeRole(role) {
    return String(role || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // retire les accents combinants
        .trim();
}
function isAdminCaller(role) {
    return ADMIN_LIKE_ROLES.has(normalizeRole(role));
}
function isSecretaryOrAdminCaller(role) {
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
exports.optimizeTours = functions
    .region("europe-west1")
    .runWith({ timeoutSeconds: 120, memory: "256MB" })
    .https.onCall(async (data, context) => {
    // 1. Vérifier l'authentification
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté pour optimiser les tournées.");
    }
    // 2. Vérifier que la requête contient les données nécessaires
    const { model } = data;
    if (!model || !model.shipments || !model.vehicles) {
        throw new functions.https.HttpsError("invalid-argument", "La requête doit contenir model.shipments et model.vehicles");
    }
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError("permission-denied", "Optimisation réservée à l'exploitation.");
    if (!Array.isArray(model.shipments) || !Array.isArray(model.vehicles) || model.shipments.length > 450 || model.vehicles.length > 100)
        throw new functions.https.HttpsError("invalid-argument", "Volume d'optimisation invalide.");
    const quotaRef = db.collection("operation_quotas").doc(`optimize-${context.auth.uid}`);
    await db.runTransaction(async (tx) => { const previous = await tx.get(quotaRef); if (previous.exists && Date.now() - (previous.data()?.lastAt || 0) < 10000)
        throw new functions.https.HttpsError("resource-exhausted", "Attendez quelques secondes avant une nouvelle optimisation."); tx.set(quotaRef, { lastAt: Date.now() }); });
    const shipmentCount = model.shipments.length;
    const vehicleCount = model.vehicles.length;
    console.log(`🚛 Optimisation: ${shipmentCount} livraisons, ${vehicleCount} véhicules`);
    // Transformer le modèle pour GMPRO avec coûts de pénalité
    const gmproModel = {
        model: {
            shipments: model.shipments.map((s) => ({
                deliveries: s.deliveries,
                label: s.label,
                // Pénalité très élevée si skip (100000 = quasi-obligatoire)
                penaltyCost: s.penaltyCost || 100000
            })),
            vehicles: model.vehicles.map((v) => ({
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
        searchMode: model.searchMode || 2, // CONSUME_ALL_AVAILABLE_TIME
        considerRoadTraffic: true,
        populateTransitionPolylines: false
    };
    // Model envoyé à GMPRO (log supprimé — trop volumineux pour la production)
    // 3. Obtenir le token OAuth2 via Application Default Credentials
    const googleAuth = new google_auth_library_1.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    let accessToken;
    try {
        const client = await googleAuth.getClient();
        const tokenResponse = await client.getAccessToken();
        accessToken = tokenResponse.token || "";
        if (!accessToken) {
            throw new Error("Token vide");
        }
    }
    catch (err) {
        console.error("❌ Erreur OAuth2:", err);
        throw new functions.https.HttpsError("internal", `Erreur d'authentification Google: ${err.message}`);
    }
    // 4. Appeler Route Optimization API
    // IMPORTANT: GCLOUD_PROJECT renvoie "fleet-genius-app" (alias Firebase)
    // mais le vrai project ID GCP est "fleet-genius-app-485611"
    const projectId = process.env.GMPRO_PROJECT_ID || "fleet-genius-app-485611";
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
            throw new functions.https.HttpsError("internal", isApiNotEnabled
                ? "Route Optimization API non activée. Activez-la dans Google Cloud Console → APIs & Services → Library."
                : `Erreur GMPRO: ${errMsg}`);
        }
        // 5. Log succès (résumé uniquement)
        const routeCount = responseData.routes?.length || 0;
        const totalVisits = responseData.routes?.reduce((sum, r) => sum + (r.visits?.length || 0), 0) || 0;
        const totalDistance = (responseData.routes?.reduce((sum, r) => sum + (r.metrics?.travelDistanceMeters || 0), 0) || 0) / 1000;
        const skippedCount = responseData.metrics?.skippedMandatoryShipmentCount || 0;
        console.log(`✅ Optimisation: ${routeCount} tournées, ${totalVisits} visits, ${totalDistance.toFixed(1)} km, ${skippedCount} skippés`);
        // 6. Log d'audit
        try {
            await db.collection("audit_logs").add({
                action: "TOURS_OPTIMIZED",
                performedBy: context.auth.uid,
                performedAt: firestore_1.FieldValue.serverTimestamp(),
                details: {
                    shipments: shipmentCount,
                    vehicles: vehicleCount,
                    routesGenerated: routeCount,
                    totalDistanceKm: Math.round(totalDistance * 10) / 10,
                },
            });
        }
        catch (logErr) {
            console.warn("Erreur log audit:", logErr);
        }
        return responseData;
    }
    catch (err) {
        if (err instanceof functions.https.HttpsError) {
            throw err;
        }
        console.error("❌ Erreur réseau GMPRO:", err);
        throw new functions.https.HttpsError("internal", `Erreur de connexion à Google Route Optimization: ${err.message}`);
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
exports.deleteUserCompletely = functions
    .region("europe-west1") // Serveur en Europe (plus proche de La Réunion)
    .https.onCall(async (data, context) => {
    // 1. Vérifier que l'appelant est authentifié
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté pour effectuer cette action.");
    }
    const callerUid = context.auth.uid;
    const targetUserId = data.userId;
    const targetProfile = await db.collection("users").doc(String(targetUserId)).get();
    const targetEmail = targetProfile.data()?.email;
    if (!targetUserId) {
        throw new functions.https.HttpsError("invalid-argument", "L'ID de l'utilisateur à supprimer est requis.");
    }
    // 2. Vérifier que l'appelant a les droits (admin/président/directeur)
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data()?.isDisabled || (callerDoc.data()?.sessionsRevokedAt && Number(context.auth.token.auth_time || 0) <= callerDoc.data().sessionsRevokedAt)) {
        throw new functions.https.HttpsError("permission-denied", "Votre profil n'a pas été trouvé.");
    }
    const isClientTeammate = normalizeRole(callerDoc.data()?.role) === 'client' && normalizeRole(targetProfile.data()?.role) === 'client' && !!callerDoc.data()?.companyName && callerDoc.data()?.companyName === targetProfile.data()?.companyName;
    if (!isAdminCaller(callerDoc.data()?.role) && !isClientTeammate) {
        throw new functions.https.HttpsError("permission-denied", "Vous n'avez pas les droits pour supprimer un utilisateur.");
    }
    // 3. Empêcher l'auto-suppression
    if (targetUserId === callerUid) {
        throw new functions.https.HttpsError("failed-precondition", "Vous ne pouvez pas supprimer votre propre compte.");
    }
    const results = {
        authDeleted: false,
        firestoreDeleted: false,
        invitationsDeleted: 0,
        errors: [],
    };
    // 4. Supprimer le compte Firebase Auth
    try {
        // Essayer de trouver l'utilisateur Auth par ID ou par email
        try {
            await auth.deleteUser(targetUserId);
            results.authDeleted = true;
            console.log(`✅ Auth supprimé pour UID: ${targetUserId}`);
        }
        catch (authError) {
            // Si l'ID ne correspond pas à un Auth user, essayer par email
            if (authError.code === "auth/user-not-found" && targetEmail) {
                try {
                    const userByEmail = await auth.getUserByEmail(targetEmail);
                    await auth.deleteUser(userByEmail.uid);
                    results.authDeleted = true;
                    console.log(`✅ Auth supprimé pour email: ${targetEmail}`);
                }
                catch (emailError) {
                    if (emailError.code === "auth/user-not-found") {
                        // Pas de compte Auth = peut-être jamais activé, c'est OK
                        console.log(`ℹ️ Pas de compte Auth trouvé pour: ${targetEmail}`);
                    }
                    else {
                        throw emailError;
                    }
                }
            }
            else if (authError.code !== "auth/user-not-found") {
                throw authError;
            }
        }
    }
    catch (error) {
        console.error("❌ Erreur suppression Auth:", error);
        results.errors.push(`Auth: ${error.message}`);
    }
    if (results.errors.length)
        throw new functions.https.HttpsError("internal", "Le compte n’a pas pu être supprimé. Son profil est conservé pour réessayer.");
    // 5. Supprimer le document Firestore
    try {
        await db.collection("users").doc(targetUserId).delete();
        results.firestoreDeleted = true;
        console.log(`✅ Firestore users/${targetUserId} supprimé`);
    }
    catch (error) {
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
        }
        catch (error) {
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
            performedAt: firestore_1.FieldValue.serverTimestamp(),
            results,
        });
    }
    catch (logError) {
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
exports.cleanupExpiredInvitations = functions
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
exports.toggleUserStatus = functions
    .region("europe-west1")
    .https.onCall(async (data, context) => {
    // 1. Vérifier l'authentification
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté pour effectuer cette action.");
    }
    const callerUid = context.auth.uid;
    const { userId, email, disable } = data;
    if (!userId || typeof disable !== "boolean") {
        throw new functions.https.HttpsError("invalid-argument", "userId et disable (true/false) sont requis.");
    }
    // 2. Vérifier les permissions
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data()?.isDisabled || (callerDoc.data()?.sessionsRevokedAt && Number(context.auth.token.auth_time || 0) <= callerDoc.data().sessionsRevokedAt)) {
        throw new functions.https.HttpsError("permission-denied", "Votre profil n'a pas été trouvé.");
    }
    if (!isAdminCaller(callerDoc.data()?.role)) {
        throw new functions.https.HttpsError("permission-denied", "Vous n'avez pas les droits pour cette action.");
    }
    // 3. Empêcher l'auto-désactivation
    if (userId === callerUid) {
        throw new functions.https.HttpsError("failed-precondition", "Vous ne pouvez pas désactiver votre propre compte.");
    }
    const results = {
        authUpdated: false,
        firestoreUpdated: false,
        error: null,
    };
    // 4. Trouver et désactiver/réactiver dans Firebase Auth
    try {
        let authUser;
        // Essayer par UID d'abord
        try {
            authUser = await auth.getUser(userId);
        }
        catch (e) {
            // Si pas trouvé par UID, essayer par email
            if (email) {
                authUser = await auth.getUserByEmail(email);
            }
        }
        if (authUser) {
            await auth.updateUser(authUser.uid, { disabled: disable });
            if (disable)
                await auth.revokeRefreshTokens(authUser.uid);
            results.authUpdated = true;
            console.log(`✅ Auth ${disable ? "désactivé" : "réactivé"} pour: ${authUser.email}`);
        }
        else {
            // Pas de compte Auth = utilisateur n'a jamais activé son compte
            console.log(`ℹ️ Pas de compte Auth trouvé pour userId: ${userId}`);
        }
    }
    catch (error) {
        console.error("❌ Erreur Auth:", error);
        results.error = error.message;
    }
    // 5. Mettre à jour le statut dans Firestore
    try {
        await db.collection("users").doc(userId).update({
            isDisabled: disable,
            disabledAt: disable ? firestore_1.FieldValue.serverTimestamp() : null,
            disabledBy: disable ? callerUid : null,
        });
        results.firestoreUpdated = true;
        console.log(`✅ Firestore mis à jour: isDisabled = ${disable}`);
    }
    catch (error) {
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
            performedAt: firestore_1.FieldValue.serverTimestamp(),
            results,
        });
    }
    catch (logError) {
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
exports.forcePasswordReset = functions
    .region("europe-west1")
    .https.onCall(async (data, context) => {
    // 1. Vérifier l'authentification
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté pour effectuer cette action.");
    }
    const callerUid = context.auth.uid;
    const { userId, email } = data;
    if (!email) {
        throw new functions.https.HttpsError("invalid-argument", "L'email de l'utilisateur est requis.");
    }
    // 2. Vérifier les permissions
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data()?.isDisabled || (callerDoc.data()?.sessionsRevokedAt && Number(context.auth.token.auth_time || 0) <= callerDoc.data().sessionsRevokedAt)) {
        throw new functions.https.HttpsError("permission-denied", "Votre profil n'a pas été trouvé.");
    }
    if (!isSecretaryOrAdminCaller(callerDoc.data()?.role)) {
        throw new functions.https.HttpsError("permission-denied", "Vous n'avez pas les droits pour cette action.");
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
            performedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return {
            success: true,
            message: `Email de réinitialisation envoyé à ${email}`,
        };
    }
    catch (error) {
        console.error("❌ Erreur reset password:", error);
        if (error.code === "auth/user-not-found") {
            throw new functions.https.HttpsError("not-found", "Cet utilisateur n'a pas encore activé son compte. Renvoyez-lui une invitation.");
        }
        throw new functions.https.HttpsError("internal", `Erreur: ${error.message}`);
    }
});
// ============================================================================
// VALIDATION DE TOKEN D'INVITATION (PUBLIC - sans authentification)
// ============================================================================
/**
 * Valide un token d'invitation et retourne les informations
 * Cette fonction est publique car l'utilisateur n'est pas encore connecté
 */
exports.validateInvitationToken = functions
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
        if (invitation.schemaVersion !== 2)
            return { valid: false, error: 'EXPIRED', message: 'Demandez une nouvelle invitation à votre responsable.' };
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
    }
    catch (error) {
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
exports.activateAccount = functions
    .region('europe-west1')
    .https.onCall(async (data) => {
    const { token, password } = data || {};
    if (typeof token !== 'string' ||
        typeof password !== 'string' ||
        password.length < 8)
        throw new functions.https.HttpsError('invalid-argument', 'Lien invalide ou mot de passe trop court (8 caractères minimum).');
    const rows = await db
        .collection('invitations')
        .where('token', '==', token)
        .limit(1)
        .get();
    if (rows.empty)
        throw new functions.https.HttpsError('not-found', 'Invitation introuvable.');
    const ref = rows.docs[0].ref, invitation = rows.docs[0].data();
    if (invitation.schemaVersion !== 2)
        throw new functions.https.HttpsError('failed-precondition', 'Demandez une nouvelle invitation à votre responsable.');
    if (invitation.used ||
        !Number.isFinite(Date.parse(invitation.expiresAt)) ||
        Date.parse(invitation.expiresAt) < Date.now())
        throw new functions.https.HttpsError('failed-precondition', 'Invitation utilisée ou expirée.');
    const profileRef = db.collection('users').doc(invitation.userId);
    const profile = await profileRef.get();
    if (!profile.exists ||
        profile.data()?.isDisabled ||
        profile.data()?.email?.toLowerCase().trim() !== invitation.email ||
        profile.data()?.role !== invitation.role)
        throw new functions.https.HttpsError('failed-precondition', 'Le profil a changé. Demandez une nouvelle invitation.');
    let createdHere = false;
    try {
        await auth.createUser({
            uid: invitation.userId,
            email: invitation.email,
            password,
            emailVerified: true,
        });
        createdHere = true;
        await db.runTransaction(async (tx) => {
            const current = await tx.get(ref), user = await tx.get(profileRef);
            const fresh = current.data();
            if (!fresh ||
                fresh.used ||
                fresh.token !== token ||
                !Number.isFinite(Date.parse(fresh.expiresAt)) ||
                Date.parse(fresh.expiresAt) < Date.now() ||
                !user.exists ||
                user.data()?.isDisabled ||
                user.data()?.role !== fresh.role ||
                user.data()?.email?.toLowerCase().trim() !== fresh.email)
                throw new functions.https.HttpsError('failed-precondition', 'L’invitation a changé pendant l’activation.');
            tx.update(profileRef, {
                id: invitation.userId,
                activatedAt: firestore_1.FieldValue.serverTimestamp(),
                status: 'active',
                isDisabled: false,
            });
            tx.update(ref, {
                used: true,
                usedAt: new Date().toISOString(),
                authUid: invitation.userId,
                activationSuccess: true,
            });
        });
        return {
            success: true,
            message: 'Compte activé',
            email: invitation.email,
        };
    }
    catch (error) {
        if (createdHere)
            await auth.deleteUser(invitation.userId).catch(() => { });
        if (error.code === 'auth/email-already-exists' ||
            error.code === 'auth/uid-already-exists')
            throw new functions.https.HttpsError('already-exists', 'Ce compte existe déjà. Utilisez la réinitialisation du mot de passe.');
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', 'Activation impossible. Réessayez ou contactez votre responsable.');
    }
});
async function requireActiveCaller(context) {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Connexion requise.');
    const snap = await db.collection('users').doc(context.auth.uid).get();
    if (!snap.exists ||
        snap.data()?.isDisabled ||
        (snap.data()?.sessionsRevokedAt &&
            Number(context.auth.token.auth_time || 0) <=
                snap.data().sessionsRevokedAt))
        throw new functions.https.HttpsError('permission-denied', 'Compte indisponible.');
    return { ...snap.data(), id: snap.id };
}
exports.createInvitation = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role) && normalizeRole(caller.role) !== 'client')
        throw new functions.https.HttpsError('permission-denied', 'Invitation non autorisée.');
    const email = String(data?.email || '')
        .toLowerCase()
        .trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new functions.https.HttpsError('invalid-argument', 'Email invalide.');
    const matches = await db
        .collection('users')
        .where('email', '==', email)
        .get();
    const target = data.userId
        ? matches.docs.find((d) => d.id === data.userId)
        : matches.docs.length === 1
            ? matches.docs[0]
            : undefined;
    if (!target)
        throw new functions.https.HttpsError('not-found', 'Profil unique introuvable.');
    const user = target.data();
    if (!isAdminCaller(caller.role) &&
        (normalizeRole(user.role) !== 'client' ||
            !caller.companyName ||
            user.companyName !== caller.companyName))
        throw new functions.https.HttpsError('permission-denied', 'Vous ne pouvez inviter que votre équipe cliente.');
    if (user.activatedAt)
        throw new functions.https.HttpsError('already-exists', 'Compte déjà activé. Utilisez Mot de passe oublié.');
    const token = (0, crypto_1.randomBytes)(32).toString('hex'), expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await db
        .collection('invitations')
        .doc(target.id)
        .set({
        schemaVersion: 2,
        token,
        email,
        userId: target.id,
        role: user.role,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        companyName: user.companyName || '',
        invitedBy: caller.id,
        invitedByName: `${caller.firstName || ''} ${caller.lastName || ''}`,
        createdAt: new Date().toISOString(),
        expiresAt,
        used: false,
    });
    await db
        .collection('mail')
        .add({
        to: email,
        message: {
            subject: 'Votre invitation FleetGenius',
            text: `Vous êtes invité à rejoindre FleetGenius. Activez votre compte : ${APP_URL}/activate?token=${token}\nCe lien expire le ${expiresAt}.`,
        },
        type: 'user_invitation',
        createdAt: new Date().toISOString(),
    });
    return { token, expiresAt };
});
// Read-only bootstrap fallback when the browser Firestore cache/channel fails.
// It never creates a profile, changes a role, or exposes another account.
exports.getOwnProfile = functions.region('europe-west1').https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Connexion requise.');
    if (data?.uid !== context.auth.uid)
        throw new functions.https.HttpsError('permission-denied', 'Profil réservé à son titulaire.');
    const snapshot = await db.collection('users').doc(context.auth.uid).get();
    return { profile: snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null };
});
// Server clock, one update per visible application/minute. No position or vote data.
exports.recordUserPresence = functions.region('europe-west1').https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Connexion requise.');
    if (data?.uid !== context.auth.uid || typeof data?.login !== 'boolean')
        throw new functions.https.HttpsError('invalid-argument', 'Session invalide.');
    const uid = context.auth.uid, authTime = Number(context.auth.token.auth_time || 0);
    return db.runTransaction(async (tx) => {
        const ref = db.collection('users').doc(uid), snapshot = await tx.get(ref), user = snapshot.data();
        if (!user || user.isDisabled || (user.sessionsRevokedAt && authTime <= user.sessionsRevokedAt))
            throw new functions.https.HttpsError('permission-denied', 'Session inactive.');
        const now = Date.now(), iso = new Date(now).toISOString();
        if (data.login || !user.lastSeenAt || now - Date.parse(user.lastSeenAt) >= 45000) {
            const appVersion = typeof data.appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(data.appVersion) ? data.appVersion : null;
            const buildId = typeof data.buildId === 'string' && /^\d{1,20}$/.test(data.buildId) ? data.buildId : null;
            tx.update(ref, { lastSeenAt: iso, ...(data.login ? { lastLoginAt: iso } : {}), ...(appVersion && buildId ? { appVersion, appBuildId: buildId } : {}) });
        }
        return { success: true };
    });
});
// Recovery is server-only and proves ownership of the verified Auth email.
exports.linkAuthToProfile = functions
    .region('europe-west1')
    .https.onCall(async (_data, context) => {
    if (_data?.uid && _data.uid !== context.auth?.uid)
        throw new functions.https.HttpsError('permission-denied', 'La session a changé. Réessayez.');
    if (!context.auth || !context.auth.token.email_verified)
        throw new functions.https.HttpsError('permission-denied', 'Vérifiez votre adresse email avant récupération du profil.');
    const uid = context.auth.uid, email = String(context.auth.token.email || '')
        .toLowerCase()
        .trim();
    const current = await db.collection('users').doc(uid).get();
    if (current.exists)
        return { success: true };
    const rows = await db.collection('users').where('email', '==', email).get();
    if (rows.size !== 1 || rows.docs[0].data().isDisabled)
        throw new functions.https.HttpsError('failed-precondition', 'Profil introuvable ou ambigu. Contactez votre responsable.');
    const old = rows.docs[0];
    // Idempotent updates: preserve business references before publishing the new profile.
    const references = {
        vehicles: ['driverId', 'assignedDriverId'],
        missions: ['driverId', 'clientId'],
        packages: ['clientId', 'currentDriverId'],
        absences: ['userId'],
        leaves: ['userId'],
        documentAcknowledgments: ['userId'],
        quotes: ['clientId', 'requesterId', 'createdBy'],
        notifications: ['recipientId'],
    };
    for (const [collection, fields] of Object.entries(references))
        for (const field of fields) {
            const docs = await db
                .collection(collection)
                .where(field, '==', old.id)
                .get();
            for (let i = 0; i < docs.size; i += 400) {
                const batch = db.batch();
                for (const d of docs.docs.slice(i, i + 400))
                    batch.update(d.ref, { [field]: uid });
                await batch.commit();
            }
        }
    await db.runTransaction(async (tx) => {
        const fresh = await tx.get(old.ref), existing = await tx.get(db.collection('users').doc(uid));
        if (existing.exists)
            return;
        if (!fresh.exists ||
            fresh.data()?.email !== email ||
            fresh.data()?.isDisabled)
            throw new functions.https.HttpsError('failed-precondition', 'Profil modifié pendant récupération.');
        tx.set(db.collection('users').doc(uid), {
            ...fresh.data(),
            id: uid,
            originalUserId: old.id,
        });
        tx.delete(old.ref);
    });
    return { success: true };
});
exports.revokeOwnSessions = functions
    .region('europe-west1')
    .https.onCall(async (_data, context) => {
    const caller = await requireActiveCaller(context);
    await auth.revokeRefreshTokens(caller.id);
    await db
        .collection('users')
        .doc(caller.id)
        .update({ sessionsRevokedAt: Math.floor(Date.now() / 1000) });
    return { success: true };
});
const absenceStates = new Set([
    'En attente',
    'Validé',
    'Refusé',
    'Modification proposée',
]);
const absenceTypes = new Set([
    'Congés Payés',
    'RTT',
    'Congé Sans Solde',
    'Arrêt Maladie',
    'Accident de Travail',
    'Congé Maternité',
    'Congé Paternité',
    'Formation',
    'Absence Injustifiée',
    'Récupération',
    'Autre',
]);
function workingDays(start, end, halfStart, halfEnd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
        start > end)
        throw new functions.https.HttpsError('invalid-argument', 'Dates invalides.');
    const first = Date.parse(start + 'T00:00:00Z'), last = Date.parse(end + 'T00:00:00Z');
    if (!Number.isFinite(first) ||
        !Number.isFinite(last) ||
        new Date(first).toISOString().slice(0, 10) !== start ||
        new Date(last).toISOString().slice(0, 10) !== end ||
        last - first > 366 * 86400000)
        throw new functions.https.HttpsError('invalid-argument', 'Période invalide ou supérieure à un an.');
    let count = 0;
    for (let t = first; t <= last; t += 86400000) {
        const day = new Date(t).getUTCDay();
        if (day !== 0 && day !== 6)
            count++;
    }
    if ((halfStart && !['morning', 'afternoon'].includes(halfStart)) ||
        (halfEnd && !['morning', 'afternoon'].includes(halfEnd)) ||
        (start === end && halfStart === 'afternoon' && halfEnd === 'morning'))
        throw new functions.https.HttpsError('invalid-argument', 'Demi-journées invalides.');
    if (count > 0 &&
        halfStart === 'afternoon' &&
        ![0, 6].includes(new Date(first).getUTCDay()))
        count -= 0.5;
    if (count > 0 &&
        halfEnd === 'morning' &&
        ![0, 6].includes(new Date(last).getUTCDay()))
        count -= 0.5;
    return Math.max(0, count);
}
exports.saveAbsence = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role);
    const input = data?.absence;
    if (!input ||
        typeof input.id !== 'string' ||
        !/^[\w-]{1,128}$/.test(input.id))
        throw new functions.https.HttpsError('invalid-argument', 'Demande invalide.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('absences').doc(input.id), snap = await tx.get(ref), old = snap.data();
        const userId = old?.userId || input.userId;
        if (typeof userId !== 'string' || (!manager && userId !== caller.id))
            throw new functions.https.HttpsError('permission-denied', 'Demande non autorisée.');
        const userRef = db.collection('users').doc(userId), user = await tx.get(userRef);
        if (!user.exists)
            throw new functions.https.HttpsError('not-found', 'Salarié introuvable.');
        let next = { ...input, userId };
        delete next.id;
        if (!manager) {
            if (old?.status === 'Modification proposée' &&
                input.status === 'Validé') {
                const proposal = old.modificationProposal;
                if (!proposal)
                    throw new functions.https.HttpsError('failed-precondition', 'Proposition absente.');
                next = {
                    ...old,
                    startDate: proposal.proposedStartDate,
                    endDate: proposal.proposedEndDate,
                    status: 'Validé',
                    modificationProposal: null,
                    validatedBy: proposal.proposedBy,
                };
            }
            else if (old?.status === 'Modification proposée' &&
                input.status === 'En attente') {
                next = {
                    ...old,
                    status: 'En attente',
                    modificationProposal: null,
                    validatedBy: null,
                    validatedAt: null,
                };
            }
            else {
                if ((old && old.status !== 'En attente') ||
                    next.status !== 'En attente')
                    throw new functions.https.HttpsError('permission-denied', 'Seule une demande en attente est modifiable.');
                if (![
                    'Congés Payés',
                    'RTT',
                    'Congé Sans Solde',
                    'Récupération',
                    'Autre',
                ].includes(next.type))
                    throw new functions.https.HttpsError('permission-denied', 'Type réservé à la direction.');
                next = {
                    ...next,
                    validatedBy: null,
                    validatedAt: null,
                    adminComment: null,
                    modificationProposal: null,
                };
            }
        }
        if (manager &&
            userId === caller.id &&
            next.status === 'Validé' &&
            !['admin', 'president', 'presidente'].includes(normalizeRole(caller.role)))
            throw new functions.https.HttpsError('permission-denied', 'Un autre responsable doit valider votre absence.');
        if (!absenceStates.has(next.status) || !absenceTypes.has(next.type))
            throw new functions.https.HttpsError('invalid-argument', 'Statut ou type invalide.');
        if (['Arrêt Maladie', 'Accident de Travail'].includes(next.type) &&
            ![
                'admin',
                'president',
                'presidente',
                'directeur',
                'directrice',
                'directeur exploitation',
                'directrice exploitation',
                'direction',
            ].includes(normalizeRole(caller.role)))
            throw new functions.https.HttpsError('permission-denied', 'Déclaration réservée à la direction.');
        if (next.modificationProposal) {
            workingDays(next.modificationProposal.proposedStartDate, next.modificationProposal.proposedEndDate);
            next.modificationProposal = {
                ...next.modificationProposal,
                proposedBy: caller.id,
                proposedAt: new Date().toISOString(),
            };
        }
        const days = workingDays(next.startDate, next.endDate, next.halfDayStart, next.halfDayEnd);
        if (days <= 0)
            throw new functions.https.HttpsError('invalid-argument', 'Cette demande ne contient aucun jour ouvré.');
        // Older clients clamped balances to zero, so workingDays is not proof
        // of the amount actually deducted. Preserve that unknown debit until
        // accounting has reconciled it; never infer a refund from the duration.
        const unverifiedLegacyDebit = old?.status === 'Validé' &&
            old?.type === 'Congés Payés' &&
            old?.balanceDebit == null;
        if (unverifiedLegacyDebit &&
            (next.status !== 'Validé' ||
                next.type !== 'Congés Payés' ||
                days !== Number(old?.workingDays)))
            throw new functions.https.HttpsError('failed-precondition', 'La direction doit vérifier le montant déjà débité pour cet ancien congé avant de modifier son solde.');
        const previousDebit = old?.balanceDebit ?? 0;
        if (typeof previousDebit !== 'number' || !Number.isFinite(previousDebit) || previousDebit < 0)
            throw new functions.https.HttpsError('failed-precondition', 'Le débit de congés enregistré doit être vérifié par la direction.');
        const debit = !unverifiedLegacyDebit && next.status === 'Validé' && next.type === 'Congés Payés' ? days : 0;
        delete next.balanceDebit;
        const balance = Number(user.data()?.leaveBalance || 0) + previousDebit - debit;
        if (balance < 0)
            throw new functions.https.HttpsError('failed-precondition', 'Solde de congés insuffisant.');
        const now = new Date().toISOString();
        tx.set(ref, {
            ...next,
            workingDays: days,
            ...(unverifiedLegacyDebit ? {} : { balanceDebit: debit }),
            createdBy: old?.createdBy || caller.id,
            createdAt: old?.createdAt || now,
            updatedAt: now,
            ...(next.status === 'Validé'
                ? {
                    validatedBy: manager ? caller.id : next.validatedBy,
                    validatedAt: old?.status === 'Validé' ? old.validatedAt || now : now,
                }
                : {}),
        });
        if (debit !== previousDebit)
            tx.update(userRef, { leaveBalance: balance });
        return { success: true };
    });
});
exports.receivePackagesAtHub = functions.region('europe-west1').https.onCall((data, context) => (0, hubReception_1.receivePackagesAtHubHandler)(data, context, { db, requireActiveCaller, isAdminCaller }));
exports.finishMission = functions.region('europe-west1').https.onCall((data, context) => (0, missionLifecycle_1.finishMissionHandler)(data, context, { db, requireActiveCaller, isAdminCaller }));
exports.dispatchMissions = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Dispatch réservé à l’exploitation.');
    return (0, dispatchMissions_1.dispatchMissionsTransaction)(db, data, caller);
});
exports.scanPackage = functions.region('europe-west1').https.onCall((data, context) => (0, scanPackage_1.scanPackageHandler)(data, context, { db, requireActiveCaller, isAdminCaller }));
exports.transferPackages = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), isAdmin = isAdminCaller(caller.role);
    if (!isAdmin && !['chauffeur', 'chauffeuse'].includes(normalizeRole(caller.role)))
        throw new functions.https.HttpsError('permission-denied', 'Transfert non autorisé.');
    if (!Array.isArray(data?.packageIds) || typeof data?.missionId !== 'string' || !data.missionId || data.missionId.includes('/'))
        throw new functions.https.HttpsError('invalid-argument', 'Tournée ou liste de colis invalide.');
    const ids = [...new Set(data.packageIds)];
    if (!ids.length ||
        ids.length > 150 ||
        ids.some((id) => typeof id !== 'string' || id.includes('/')))
        throw new functions.https.HttpsError('invalid-argument', 'Liste de colis invalide (150 maximum).');
    const toRef = db.collection('missions').doc(String(data.missionId));
    return db.runTransaction(async (tx) => {
        const toSnap = await tx.get(toRef);
        if (!toSnap.exists)
            throw new functions.https.HttpsError('not-found', 'Tournée introuvable.');
        const to = toSnap.data();
        if ((!isAdmin && to.driverId !== caller.id) ||
            ['Terminé', 'Annulé'].includes(to.status))
            throw new functions.https.HttpsError('permission-denied', 'Tournée indisponible.');
        const snaps = await Promise.all(ids.map((id) => tx.get(db.collection('packages').doc(id))));
        const packages = snaps
            .filter((p) => p.exists && !['Livré', 'Retourné'].includes(p.data()?.status))
            .map((p) => ({ id: p.id, ...p.data() }));
        const origins = [
            ...new Set(packages
                .map((p) => p.missionId)
                .filter((mid) => mid && mid !== toRef.id)),
        ];
        const sourceSnaps = await Promise.all(origins.map((id) => tx.get(db.collection('missions').doc(id))));
        const sources = new Map([[toRef.id, to], ...sourceSnaps.filter(s => s.exists).map(s => [s.id, s.data()])]);
        for (const pkg of packages) {
            const source = sources.get(pkg.missionId);
            if (source?.stops?.some((stop) => stop.proofSyncPending === true && (stop.id === pkg.stopId || stop.packageIds?.includes(pkg.id))))
                throw new functions.https.HttpsError('failed-precondition', 'Synchronisez la preuve de cet arrêt avant de déplacer ce colis.');
        }
        const toStops = (to.stops || []).map((s) => ({
            ...s,
            packageIds: [...s.packageIds],
        }));
        const inTour = new Set(toStops.flatMap((s) => s.packageIds));
        const add = packages.filter((p) => !inTour.has(p.id));
        const added = new Set(add.map((p) => p.id));
        const counts = (stops, previous) => ({
            totalPackages: Math.max(stops.reduce((n, s) => n + s.packageIds.length, 0), (previous.deliveredPackages || 0) + (previous.failedPackages || 0) +
                new Set(stops.filter(s => !['Terminé', 'Échec', 'Passé'].includes(s.status)).flatMap(s => s.packageIds)).size),
            completedStops: stops.filter((s) => s.status === 'Terminé').length,
            failedStops: stops.filter((s) => ['Échec', 'Passé'].includes(s.status))
                .length,
        });
        const now = new Date().toISOString();
        let seq = Math.max(0, ...toStops.map((s) => s.sequence || 0));
        for (const p of add) {
            const key = (0, deliveryAddress_1.placeKey)(p);
            let stop = toStops.find((s) => s.type === 'DELIVERY' &&
                !['Terminé', 'Échec', 'Passé'].includes(s.status) &&
                (0, deliveryAddress_1.placeKey)(s) === key);
            if (!stop) {
                stop = {
                    id: 'transfer-' + (0, crypto_1.randomBytes)(10).toString('hex'),
                    type: 'DELIVERY',
                    status: 'En attente',
                    sequence: ++seq,
                    address: p.address || '',
                    postalCode: p.postalCode || '',
                    city: p.city || '',
                    contactName: p.contactName || '',
                    contactPhone: p.contactPhone || '',
                    packageIds: [],
                    packageCount: 0,
                    serviceTime: p.serviceTime || 5,
                    ...(p.coordinates ? { coordinates: p.coordinates } : {}),
                };
                toStops.push(stop);
            }
            stop.packageIds.push(p.id);
            stop.packageCount = stop.packageIds.length;
            tx.update(db.collection('packages').doc(p.id), {
                missionId: toRef.id,
                stopId: stop.id,
                currentDriverId: to.driverId,
                currentVehicleId: to.vehicleId || null,
                status: data.claimMode ? 'En livraison' : p.status,
                movements: [
                    ...(p.movements || []),
                    {
                        action: data.claimMode ? 'OUT_FOR_DELIVERY' : 'TRANSFERRED',
                        timestamp: now,
                        driverId: to.driverId,
                        driverName: to.driverName || '',
                        notes: String(data.notes || '').slice(0, 1000),
                    },
                ],
                updatedAt: now,
            });
        }
        for (const source of sourceSnaps) {
            if (!source.exists)
                continue;
            const stops = (source.data()?.stops || [])
                .map((s) => {
                const packageIds = s.packageIds.filter((id) => !added.has(id));
                return { ...s, packageIds, packageCount: packageIds.length };
            })
                .filter((s) => s.packageIds.length > 0 || ['Terminé', 'Échec', 'Passé'].includes(s.status));
            tx.update(source.ref, { stops, ...counts(stops, source.data()), updatedAt: now });
            const moved = add
                .filter((p) => p.missionId === source.id)
                .map((p) => p.id);
            if (moved.length)
                tx.create(db.collection('package_transfers').doc(), {
                    packageIds: moved,
                    packageCount: moved.length,
                    fromDriverId: source.data()?.driverId || '',
                    toDriverId: to.driverId,
                    fromMissionId: source.id,
                    toMissionId: toRef.id,
                    status: 'Confirmé',
                    reason: data.reason || 'Passation',
                    createdAt: now,
                    updatedAt: now,
                    createdBy: caller.id,
                });
        }
        tx.update(toRef, { stops: toStops, ...counts(toStops, to), updatedAt: now });
        return { count: add.length };
    });
});
exports.sendBusinessNotification = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role);
    const titles = {
        incident_created: 'Incident signalé',
        incident_response: 'Réponse à un incident',
        incident_closed: 'Incident clôturé',
        leave_request: 'Demande d’absence',
        leave_approved: 'Absence validée',
        leave_rejected: 'Absence refusée',
        leave_modification_proposal: 'Modification d’absence proposée',
        ct_alert: 'Contrôle technique à vérifier',
        license_alert: 'Document chauffeur à vérifier',
        password_reset: 'Demande de réinitialisation',
    };
    const type = String(data?.type || '');
    if (!titles[type] ||
        (!manager &&
            ![
                'incident_created',
                'leave_request',
                'password_reset',
                ...(['mecanicien', 'mecanicienne'].includes(normalizeRole(caller.role))
                    ? ['incident_response', 'incident_closed']
                    : []),
            ].includes(type)) ||
        normalizeRole(caller.role) === 'client')
        throw new functions.https.HttpsError('permission-denied', 'Notification non autorisée.');
    const recipients = [
        ...new Set([
            ...(Array.isArray(data.to) ? data.to : [data.to]),
            ...(Array.isArray(data.cc) ? data.cc : []),
            ...(Array.isArray(data.bcc) ? data.bcc : []),
        ].filter(Boolean)),
    ];
    if (recipients.length > 20 || !recipients.length)
        throw new functions.https.HttpsError('invalid-argument', 'Destinataires invalides.');
    for (const email of recipients) {
        const users = await db
            .collection('users')
            .where('email', '==', String(email).toLowerCase().trim())
            .get();
        if (users.empty ||
            (!manager &&
                !users.docs.some((u) => !u.data().isDisabled &&
                    (isAdminCaller(u.data().role) ||
                        u.id === caller.id ||
                        (type.startsWith('incident_') &&
                            ['mecanicien', 'mecanicienne'].includes(normalizeRole(u.data().role)))))))
            throw new functions.https.HttpsError('permission-denied', 'Destinataire non autorisé.');
    }
    const quotaRef = db
        .collection('operation_quotas')
        .doc('email-' + caller.id), now = Date.now();
    await db.runTransaction(async (tx) => {
        const previous = await tx.get(quotaRef), q = previous.data();
        const count = q && now - q.start < 60000 ? q.count : 0;
        if (count >= 20)
            throw new functions.https.HttpsError('resource-exhausted', 'Trop de notifications. Réessayez dans une minute.');
        tx.set(quotaRef, { start: count ? q.start : now, count: count + 1 });
    });
    // Never accept a browser-provided HTML body, subject or action URL.
    await db
        .collection('mail')
        .add({
        to: recipients,
        message: {
            subject: 'FleetGenius — ' + titles[type],
            text: `${titles[type]}\nAction signalée par ${caller.firstName || ''} ${caller.lastName || ''}.\nConsultez les détails dans votre espace : ${APP_URL}`,
        },
        createdAt: new Date().toISOString(),
        type,
        createdBy: caller.id,
    });
    return { success: true };
});
exports.askFleetGenius = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60 })
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Conseiller réservé à la direction.');
    const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
    if (!key || !model || !/^[\w.-]+$/.test(model))
        throw new functions.https.HttpsError('failed-precondition', 'Le conseiller IA n’est pas configuré côté serveur.');
    const prompt = String(data?.prompt || '');
    if (!prompt || prompt.length > 8000)
        throw new functions.https.HttpsError('invalid-argument', 'Question invalide.');
    const quota = db.collection('operation_quotas').doc('ai-' + caller.id), now = Date.now();
    await db.runTransaction(async (tx) => {
        const prev = await tx.get(quota), q = prev.data();
        if (q && now - q.at < 10000)
            throw new functions.https.HttpsError('resource-exhausted', 'Patientez dix secondes entre deux questions.');
        tx.set(quota, { at: now });
    });
    const vehicles = await db.collection('vehicles').limit(100).get();
    const contextData = vehicles.docs.map((d) => ({
        plate: d.data().plate || d.data().licensePlate,
        status: d.data().status,
        km: d.data().currentMileage,
    }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        {
                            text: `Réponds en français, comme conseiller de flotte. Données véhicules: ${JSON.stringify(contextData)}\nQuestion: ${prompt}`,
                        },
                    ],
                },
            ],
        }),
        signal: AbortSignal.timeout(45000),
    });
    if (!response.ok)
        throw new functions.https.HttpsError('unavailable', 'Le conseiller IA est temporairement indisponible.');
    const payload = await response.json();
    return {
        text: payload.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || '')
            .join('') || 'Aucune réponse disponible.',
    };
});
exports.assignVehicle = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Affectation réservée à l’exploitation.');
    const vehicleId = String(data?.vehicleId || ''), driverId = data?.driverId || null;
    if (!vehicleId ||
        vehicleId.includes('/') ||
        (driverId && (typeof driverId !== 'string' || driverId.includes('/'))))
        throw new functions.https.HttpsError('invalid-argument', 'Affectation invalide.');
    return db.runTransaction(async (tx) => {
        const vehicleRef = db.collection('vehicles').doc(vehicleId), vehicle = await tx.get(vehicleRef);
        if (!vehicle.exists)
            throw new functions.https.HttpsError('not-found', 'Véhicule introuvable.');
        const previousDriver = vehicle.data()?.driverId || vehicle.data()?.assignedDriverId;
        const driverRef = driverId ? db.collection('users').doc(driverId) : null, driver = driverRef ? await tx.get(driverRef) : null;
        if (driverRef &&
            (!driver?.exists ||
                normalizeRole(driver.data()?.role) !== 'chauffeur' ||
                driver.data()?.isDisabled))
            throw new functions.https.HttpsError('failed-precondition', 'Chauffeur indisponible.');
        // Query reads participate in the transaction: concurrent assignments conflict and retry.
        const oldVehicles = driverId
            ? await tx.get(db.collection('vehicles').where('driverId', '==', driverId))
            : null;
        const legacyVehicles = driverId
            ? await tx.get(db.collection('vehicles').where('assignedDriverId', '==', driverId))
            : null;
        const oldDriverRef = previousDriver && previousDriver !== driverId
            ? db.collection('users').doc(previousDriver)
            : null;
        const oldDriver = oldDriverRef ? await tx.get(oldDriverRef) : null;
        const oldIds = new Set();
        for (const row of [
            ...(oldVehicles?.docs || []),
            ...(legacyVehicles?.docs || []),
        ])
            if (row.id !== vehicleId) {
                oldIds.add(row.id);
                tx.update(row.ref, { driverId: null, assignedDriverId: null });
            }
        tx.update(vehicleRef, { driverId, assignedDriverId: driverId });
        if (driverRef)
            tx.update(driverRef, { assignedVehicleId: vehicleId });
        if (oldDriverRef &&
            oldDriver?.exists &&
            oldDriver.data()?.assignedVehicleId === vehicleId)
            tx.update(oldDriverRef, { assignedVehicleId: null });
        return {
            success: true,
            message: driverId ? 'Chauffeur affecté.' : 'Véhicule libéré.',
            changes: {
                vehicleUpdated: true,
                oldVehicleCleared: oldIds.size > 0,
                oldDriverCleared: !!oldDriver?.exists,
            },
        };
    });
});
exports.importPackages = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role), client = normalizeRole(caller.role) === 'client';
    if (!manager && !client)
        throw new functions.https.HttpsError('permission-denied', 'Import non autorisé.');
    if (!Array.isArray(data?.packages) ||
        !data.packages.length ||
        data.packages.length > 150)
        throw new functions.https.HttpsError('invalid-argument', 'Lot invalide (150 lignes maximum).');
    const rows = data.packages.map((raw) => {
        const allowed = [
            'clientId',
            'clientName',
            'importBatchId',
            'externalId',
            'orderNumber',
            'barcode',
            'carrierBarcode',
            'address',
            'city',
            'postalCode',
            'zone',
            'coordinates',
            'floor',
            'hasElevator',
            'contactName',
            'contactPhone',
            'contactEmail',
            'packageIndex',
            'packageTotal',
            'createdByClient',
            'clientReference',
            'requestedDeliveryDate',
            'timeWindowStart',
            'timeWindowEnd',
            'serviceTime',
            'comment',
            'volume',
            'weight',
            'status',
            'currentHubId',
        ];
        const p = {};
        for (const key of allowed)
            if (raw[key] !== undefined)
                p[key] = raw[key];
        if (p.carrierBarcode)
            p.carrierBarcode = (0, carrierBarcode_1.validatedCarrierBarcode)(p.carrierBarcode, p.clientReference);
        p.movements = [
            {
                action: 'IMPORTED',
                timestamp: new Date().toISOString(),
                notes: 'Import enregistré',
                driverId: caller.id,
            },
        ];
        if (client) {
            p.clientId = caller.id;
            p.clientName = caller.companyName || '';
            p.createdByClient = true;
            p.status = 'En attente';
            delete p.currentHubId;
        }
        if (!['En attente', 'Au hub', 'Trié'].includes(p.status))
            throw new functions.https.HttpsError('invalid-argument', 'Statut initial invalide.');
        const code = String(p.externalId || p.orderNumber || p.barcode || '')
            .trim()
            .toUpperCase();
        if (!code ||
            typeof p.clientId !== 'string' ||
            !String(p.address || '').trim() ||
            !String(p.contactName || '').trim())
            throw new functions.https.HttpsError('invalid-argument', 'Code, client, destinataire et adresse obligatoires.');
        const id = 'pkg-' +
            (0, crypto_1.createHash)('sha256')
                .update(p.clientId + '\0' + code + '\0' + String(p.packageIndex || ''))
                .digest('hex');
        return { id, code, p };
    });
    return db.runTransaction(async (tx) => {
        const snapshots = await Promise.all(rows.map((r) => tx.get(db.collection('packages').doc(r.id))));
        // Recognize historical documents whose IDs predate deterministic imports.
        const legacy = await Promise.all(rows.map((r, i) => snapshots[i].exists
            ? Promise.resolve(null)
            : tx.get(db
                .collection('packages')
                .where('clientId', '==', r.p.clientId)
                .where(r.p.externalId ? 'externalId' : 'orderNumber', '==', r.p.externalId || r.p.orderNumber || r.code)
                .limit(2))));
        if (legacy.some((result) => result && result.size > 1))
            throw new functions.https.HttpsError('failed-precondition', 'Des doublons existent déjà pour cette référence. Faites-les contrôler avant de reprendre l’import.');
        const ids = [];
        const carrierReservations = [];
        const codes = new Map();
        const codesByPackage = new Map();
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i], code = row.p.carrierBarcode;
            if (!code)
                continue;
            const target = legacy[i]?.docs[0] || snapshots[i], id = target.exists ? target.id : row.id;
            if (codes.has(code) && codes.get(code) !== id)
                throw new functions.https.HttpsError('already-exists', 'Deux colis du fichier portent le même code Boiron.');
            if (codesByPackage.has(id) && codesByPackage.get(id) !== code)
                throw new functions.https.HttpsError('already-exists', 'Un colis ne peut pas recevoir deux codes Boiron dans le même import.');
            for (let j = 0; j < rows.length; j++) {
                const other = legacy[j]?.docs[0] || snapshots[j], otherId = other.exists ? other.id : rows[j].id;
                if (otherId !== id && ['barcode', 'externalId', 'orderNumber'].some(field => rows[j].p[field] === code))
                    throw new functions.https.HttpsError('already-exists', 'Un code Boiron correspond aussi à un autre colis du fichier.');
            }
            if (codes.has(code))
                continue;
            codesByPackage.set(id, code);
            codes.set(code, id);
            if (target.exists && target.data()?.carrierBarcode !== code)
                throw new functions.https.HttpsError('failed-precondition', 'Ce colis existe déjà. Vérifiez et associez son code depuis les opérations du hub.');
            carrierReservations.push(await (0, carrierBarcode_1.checkCarrierBarcode)(tx, db, code, id));
        }
        for (const [code, id] of codes) {
            const reservation = carrierReservations.shift();
            if (!reservation.exists)
                tx.create(reservation.ref, { code, packageId: id, createdAt: new Date().toISOString(), createdBy: caller.id });
        }
        const written = new Set();
        const now = new Date().toISOString();
        rows.forEach((row, i) => {
            const existing = legacy[i]?.docs[0];
            if (existing) {
                ids.push(existing.id);
                return;
            }
            ids.push(row.id);
            if (!snapshots[i].exists && !written.has(row.id)) {
                written.add(row.id);
                tx.create(db.collection('packages').doc(row.id), {
                    ...row.p,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        });
        return { ids };
    });
});
exports.deleteVehicle = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context);
    if (!isAdminCaller(caller.role))
        throw new functions.https.HttpsError('permission-denied', 'Suppression réservée à l’exploitation.');
    const id = String(data?.vehicleId || '');
    if (!id || id.includes('/'))
        throw new functions.https.HttpsError('invalid-argument', 'Véhicule invalide.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('vehicles').doc(id), vehicle = await tx.get(ref);
        if (!vehicle.exists)
            return { success: true };
        const missions = await tx.get(db.collection('missions').where('vehicleId', '==', id));
        if (missions.docs.some((d) => !['Terminé', 'Annulé'].includes(d.data().status)))
            throw new functions.https.HttpsError('failed-precondition', 'Réaffectez ou clôturez les tournées de ce véhicule avant suppression.');
        const drivers = await tx.get(db.collection('users').where('assignedVehicleId', '==', id));
        for (const driver of drivers.docs)
            tx.update(driver.ref, { assignedVehicleId: null });
        tx.delete(ref);
        return { success: true };
    });
});
exports.deleteAbsence = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role);
    const id = String(data?.id || '');
    if (!id || id.includes('/'))
        throw new functions.https.HttpsError('invalid-argument', 'Demande invalide.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('absences').doc(id), snap = await tx.get(ref);
        if (!snap.exists)
            return { success: true };
        const old = snap.data();
        if (!manager && (old.userId !== caller.id || old.status !== 'En attente'))
            throw new functions.https.HttpsError('permission-denied', 'Seule votre demande en attente peut être supprimée.');
        const userRef = db.collection('users').doc(old.userId), user = await tx.get(userRef);
        if (old.status === 'Validé' && old.type === 'Congés Payés' && old.balanceDebit == null)
            throw new functions.https.HttpsError('failed-precondition', 'La direction doit vérifier le montant déjà débité pour cet ancien congé avant sa suppression.');
        const debit = old.balanceDebit ?? 0;
        if (typeof debit !== 'number' || !Number.isFinite(debit) || debit < 0)
            throw new functions.https.HttpsError('failed-precondition', 'Le débit de congés enregistré doit être vérifié par la direction.');
        if (debit && !user.exists)
            throw new functions.https.HttpsError('failed-precondition', 'Profil salarié introuvable.');
        if (debit)
            tx.update(userRef, {
                leaveBalance: Number(user.data()?.leaveBalance || 0) + debit,
            });
        tx.create(db.collection('audit_logs').doc(), {
            action: 'ABSENCE_DELETED',
            performedBy: caller.id,
            performedAt: firestore_1.FieldValue.serverTimestamp(),
            absenceId: id,
            previous: old,
        });
        tx.delete(ref);
        return { success: true };
    });
});
exports.returnPackage = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role);
    const id = String(data?.packageId || ''), proof = data?.extra?.returnProof;
    if (!id ||
        id.includes('/') ||
        !proof ||
        !Array.isArray(proof.photoUrls) ||
        !proof.photoUrls.length ||
        proof.photoUrls.some((url) => typeof url !== 'string' || !url.startsWith('https://')))
        throw new functions.https.HttpsError('invalid-argument', 'Une preuve photographique du retour est obligatoire.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('packages').doc(id), snap = await tx.get(ref);
        if (!snap.exists)
            throw new functions.https.HttpsError('not-found', 'Colis introuvable.');
        const pkg = snap.data();
        if (pkg.status === 'Retourné' &&
            !pkg.missionId &&
            pkg.returnProof?.driverId === caller.id)
            return { success: true };
        if (!manager &&
            (!['chauffeur', 'chauffeuse'].includes(normalizeRole(caller.role)) ||
                pkg.currentDriverId !== caller.id))
            throw new functions.https.HttpsError('permission-denied', 'Ce colis ne vous est pas affecté.');
        if (!['À retourner', 'Échec', 'Retourné'].includes(pkg.status))
            throw new functions.https.HttpsError('failed-precondition', 'Ce colis n’est pas en attente de retour.');
        const missionRef = pkg.missionId
            ? db.collection('missions').doc(pkg.missionId)
            : null;
        const mission = missionRef ? await tx.get(missionRef) : null;
        const now = new Date().toISOString();
        if (mission?.exists) {
            if (mission.data()?.stops?.some((stop) => stop.proofSyncPending === true && (stop.id === pkg.stopId || stop.packageIds?.includes(id))))
                throw new functions.https.HttpsError('failed-precondition', 'Synchronisez la preuve de cet arrêt avant de déplacer ce colis.');
            const stops = (mission.data()?.stops || [])
                .map((s) => {
                const packageIds = s.packageIds.filter((pid) => pid !== id);
                return { ...s, packageIds, packageCount: packageIds.length };
            })
                .filter((s) => s.packageIds.length ||
                ['Terminé', 'Échec', 'Passé'].includes(s.status));
            const totalPackages = Math.max(stops.reduce((sum, stop) => sum + stop.packageIds.length, 0), (mission.data()?.deliveredPackages || 0) + (mission.data()?.failedPackages || 0) +
                new Set(stops.filter((stop) => !['Terminé', 'Échec', 'Passé'].includes(stop.status)).flatMap((stop) => stop.packageIds)).size);
            tx.update(mission.ref, { stops, totalPackages, updatedAt: now });
        }
        tx.update(ref, {
            status: 'Retourné',
            missionId: null,
            stopId: null,
            currentDriverId: null,
            currentVehicleId: null,
            currentHubId: mission?.data()?.hubId || pkg.currentHubId || null,
            returnProof: {
                ...proof,
                packageId: id,
                driverId: caller.id,
                timestamp: now,
            },
            movements: [
                ...(pkg.movements || []),
                {
                    timestamp: now,
                    action: 'RETURNED',
                    driverId: caller.id,
                    driverName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(),
                    notes: 'Retour au hub confirmé',
                },
            ],
            updatedAt: now,
        });
        return { success: true };
    });
});
// A deterministic event ID makes retries of the Firestore trigger harmless.
exports.notifyPackageStatus = functions
    .region('europe-west1')
    .firestore.document('packages/{packageId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data(), after = change.after.data();
    const types = {
        Livré: ['package_delivered', 'Colis livré'],
        Échec: ['package_failed', 'Échec de livraison'],
        'En livraison': ['package_in_delivery', 'Colis en livraison'],
    };
    const notification = types[after.status];
    if (before.status === after.status || !notification || !after.clientId)
        return;
    const id = 'package-' + (0, crypto_1.createHash)('sha256').update(context.eventId).digest('hex');
    try {
        await db
            .collection('notifications')
            .doc(id)
            .create({
            type: notification[0],
            title: notification[1],
            message: `Colis ${after.orderNumber || after.externalId || context.params.packageId}`,
            priority: after.status === 'Échec' ? 'high' : 'normal',
            recipientId: after.clientId,
            read: false,
            createdAt: new Date().toISOString(),
            _createdAt: firestore_1.FieldValue.serverTimestamp(),
            actionType: 'navigate',
            actionTarget: 'client_shipments',
            metadata: { packageId: context.params.packageId },
        });
    }
    catch (error) {
        if (error.code !== 6)
            throw error;
    }
    if (after.status === 'Échec') {
        const users = await db.collection('users').get();
        await Promise.all(users.docs
            .filter((u) => !u.data().isDisabled && isAdminCaller(u.data().role))
            .map(async (u) => {
            try {
                await db
                    .collection('notifications')
                    .doc(id + '_' + u.id)
                    .create({
                    type: 'delivery_failure',
                    priority: 'high',
                    recipientId: u.id,
                    title: 'Échec de livraison',
                    message: `Colis ${after.orderNumber || context.params.packageId}`,
                    read: false,
                    createdAt: new Date().toISOString(),
                    _createdAt: firestore_1.FieldValue.serverTimestamp(),
                    actionType: 'navigate',
                    actionTarget: 'missions',
                    metadata: { packageId: context.params.packageId },
                });
            }
            catch (error) {
                if (error.code !== 6)
                    throw error;
            }
        }));
    }
});
// Operational lists need names and professional contacts, never HR documents.
exports.getTeamDirectory = functions
    .region('europe-west1')
    .https.onCall(async (_data, context) => {
    const caller = await requireActiveCaller(context);
    if (normalizeRole(caller.role) === 'client')
        throw new functions.https.HttpsError('permission-denied', 'Annuaire interne.');
    const users = await db.collection('users').get();
    return {
        users: users.docs
            .filter((d) => !d.data().isDisabled)
            .map((d) => {
            const u = d.data();
            return {
                id: d.id,
                firstName: u.firstName || '',
                lastName: u.lastName || '',
                role: u.role || '',
                email: u.email || '',
                phone: u.phone || '',
                companyName: u.companyName || '',
                assignedVehicleId: u.assignedVehicleId || null,
                lastLoginAt: u.lastLoginAt || null,
                lastSeenAt: u.lastSeenAt || null,
                appVersion: u.appVersion || null,
                appBuildId: u.appBuildId || null,
            };
        }),
    };
});
exports.acceptQuote = functions
    .region('europe-west1')
    .https.onCall(async (data, context) => {
    const caller = await requireActiveCaller(context), manager = isAdminCaller(caller.role);
    const id = String(data?.quoteId || '');
    if (!id || id.includes('/'))
        throw new functions.https.HttpsError('invalid-argument', 'Devis invalide.');
    return db.runTransaction(async (tx) => {
        const ref = db.collection('quotes').doc(id), snap = await tx.get(ref);
        if (!snap.exists)
            throw new functions.https.HttpsError('not-found', 'Devis introuvable.');
        const quote = snap.data();
        if (!manager &&
            (normalizeRole(caller.role) !== 'client' ||
                ![quote.clientId, quote.requesterId, quote.createdBy].includes(caller.id)))
            throw new functions.https.HttpsError('permission-denied', 'Ce devis ne vous appartient pas.');
        if (quote.status === 'Accepté (Commande)' && quote.convertedToPackageId) {
            const existing = await tx.get(db.collection('packages').doc(quote.convertedToPackageId));
            if (!existing.exists)
                throw new functions.https.HttpsError('failed-precondition', 'Le colis de ce devis est introuvable. Contactez l’exploitation.');
            return { packageId: existing.id, zone: existing.data()?.zone };
        }
        if (!manager && quote.status !== 'Offre envoyée')
            throw new functions.https.HttpsError('failed-precondition', 'Attendez une offre avant d’accepter ce devis.');
        const destination = [quote.destinationAddress, quote.destination]
            .filter(Boolean)
            .join(', '), postalCode = destination.match(/\b974\d{2}\b/)?.[0];
        if (!postalCode)
            throw new functions.https.HttpsError('failed-precondition', 'Complétez le code postal de destination avant acceptation.');
        const mapping = await tx.get(db.collection('postal_code_mappings').doc(postalCode));
        const defaults = {};
        for (const [zone, codes] of Object.entries({
            Nord: ['97400', '97490', '97419', '97417', '97488'],
            Sud: [
                '97410',
                '97430',
                '97480',
                '97450',
                '97424',
                '97432',
                '97421',
                '97426',
                '97416',
                '97422',
                '97418',
                '97442',
                '97429',
            ],
            Est: [
                '97440',
                '97470',
                '97431',
                '97437',
                '97438',
                '97441',
                '97412',
                '97433',
                '97439',
            ],
            Ouest: [
                '97420',
                '97460',
                '97434',
                '97435',
                '97436',
                '97423',
                '97411',
                '97413',
                '97414',
                '97415',
                '97425',
                '97427',
            ],
        }))
            for (const code of codes)
                defaults[code] = zone;
        const zone = mapping.data()?.zone || defaults[postalCode];
        if (!zone)
            throw new functions.https.HttpsError('failed-precondition', 'Aucune zone de livraison pour cette destination.');
        const packageRef = db
            .collection('packages')
            .doc('quote-' + (0, crypto_1.createHash)('sha256').update(id).digest('hex'));
        const existing = await tx.get(packageRef), now = new Date().toISOString(), parts = destination.split(',').map((s) => s.trim());
        if (!existing.exists)
            tx.create(packageRef, {
                clientId: quote.clientId,
                clientName: quote.clientName || '',
                externalId: id,
                orderNumber: 'Q' + id.slice(-10),
                barcode: 'Q' + id.slice(-10),
                importBatchId: 'QUOTE-' + id,
                address: parts[0] || destination,
                city: parts[parts.length - 1] || '',
                postalCode,
                zone,
                contactName: quote.destinationContact?.name || quote.clientName || '',
                contactPhone: quote.destinationContact?.phone || '',
                requestedDeliveryDate: quote.deliveryDate || quote.requestedDeliveryDate || null,
                timeWindowStart: quote.deliveryTimeWindow?.start || null,
                timeWindowEnd: quote.deliveryTimeWindow?.end || null,
                serviceTime: 10,
                comment: [quote.goodsDescription, quote.clientNotes]
                    .filter(Boolean)
                    .join(' | '),
                volume: quote.volume || null,
                weight: quote.weight || null,
                status: 'En attente',
                movements: [
                    {
                        timestamp: now,
                        action: 'IMPORTED',
                        driverId: caller.id,
                        notes: 'Créé depuis le devis accepté',
                    },
                ],
                createdAt: now,
                updatedAt: now,
            });
        tx.update(ref, {
            status: 'Accepté (Commande)',
            convertedToPackageId: packageRef.id,
            convertedAt: now,
            updatedAt: now,
        });
        return { packageId: packageRef.id, zone };
    });
});
exports.interpretAnalytics = functions
    .region('europe-west1')
    .runWith({ timeoutSeconds: 60 })
    .https.onCall(async (data, callableContext) => {
    const caller = await requireActiveCaller(callableContext);
    if (!isAdminCaller(caller.role) && normalizeRole(caller.role) !== 'client')
        throw new functions.https.HttpsError('permission-denied', 'Analyse non autorisée.');
    const question = String(data?.question || '');
    if (!question.trim() || question.length > 2000)
        throw new functions.https.HttpsError('invalid-argument', 'Question invalide.');
    const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
    if (!key || !model || !/^[\w.-]+$/.test(model))
        throw new functions.https.HttpsError('failed-precondition', 'Analyse IA non configurée.');
    const context = {
        pharmacies: (Array.isArray(data?.context?.pharmacies)
            ? data.context.pharmacies
            : [])
            .filter((s) => typeof s === 'string' && s.length <= 150)
            .slice(0, 100),
        zones: (Array.isArray(data?.context?.zones) ? data.context.zones : [])
            .filter((s) => typeof s === 'string' && s.length <= 50)
            .slice(0, 20),
    };
    const quota = db
        .collection('operation_quotas')
        .doc('analytics-' + caller.id), now = Date.now();
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(quota), q = snap.data(), count = q && now - q.start < 60000 ? q.count : 0;
        if (count >= 20)
            throw new functions.https.HttpsError('resource-exhausted', 'Trop de demandes. Réessayez dans une minute.');
        tx.set(quota, { start: count ? q.start : now, count: count + 1 });
    });
    const systemInstruction = `Tu es un interpréteur de requêtes analytiques pour une société de livraison.
Ta SEULE tâche : convertir la question de l'utilisateur en un objet JSON conforme à la grammaire ci-dessous.
Tu ne calcules RIEN, tu ne donnes AUCUN chiffre, AUCUNE phrase.

Grammaire (valeurs autorisées UNIQUEMENT) :
- metric   : "volume" | "deliveryRate" | "punctualityRate" | "avgDelayHours" | "failRate" | "weight"
- dimension: "none" | "pharmacy" | "zone" | "day" | "status"
- period   : "7d" | "30d" | "month" | "all"
- chart    : "kpi" | "line" | "bar" | "donut" | "table"
- pharmacy : (optionnel) un nom EXACT parmi la liste connue, sinon omets
- zone     : (optionnel) un nom EXACT parmi la liste connue, sinon omets

Correspondances utiles :
- "combien de colis", "volume", "nombre" -> metric "volume"
- "taux de livraison", "livrés" (en %) -> metric "deliveryRate"
- "ponctualité", "à l'heure", "retard %" -> metric "punctualityRate"
- "délai moyen", "temps de livraison" -> metric "avgDelayHours"
- "échecs", "échec", "ratés" -> metric "failRate"
- "poids", "kg", "tonnage" -> metric "weight"
- "par pharmacie / client / destinataire" -> dimension "pharmacy"
- "par zone / secteur / région" -> dimension "zone"
- "par jour / évolution / tendance" -> dimension "day"
- "par statut / répartition statut" -> dimension "status"
- pas de regroupement explicite -> dimension "none"
- "cette semaine" -> "7d" ; "30 jours" -> "30d" ; "ce mois" -> "month" ; sinon "all"
- dimension "none" -> chart "kpi" ; "day" -> "line" ; "status" -> "donut" ; "pharmacy"/"zone" -> "bar"

Pharmacies connues : ${JSON.stringify(context.pharmacies.slice(0, 100))}
Zones connues : ${JSON.stringify(context.zones)}

Réponds UNIQUEMENT en JSON, aucun texte, aucun chiffre.
Exemple : {"metric":"deliveryRate","dimension":"zone","period":"month","chart":"bar"}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: question }] }],
            generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
            },
        }),
        signal: AbortSignal.timeout(45000),
    });
    if (!response.ok)
        throw new functions.https.HttpsError('unavailable', 'Analyse temporairement indisponible.');
    const payload = await response.json();
    return {
        text: payload.candidates?.[0]?.content?.parts
            ?.map((p) => p.text || '')
            .join('') || '',
    };
});
//# sourceMappingURL=index.js.map