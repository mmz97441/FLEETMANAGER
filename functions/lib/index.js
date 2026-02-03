"use strict";
/**
 * Cloud Functions FleetGenius
 *
 * Ces fonctions s'exécutent côté serveur avec les droits admin Firebase.
 * Elles permettent des opérations impossibles depuis le client (navigateur).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateAccount = exports.validateInvitationToken = exports.forcePasswordReset = exports.toggleUserStatus = exports.cleanupExpiredInvitations = exports.deleteUserCompletely = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
// Initialiser Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
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
    var _a;
    // 1. Vérifier que l'appelant est authentifié
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Vous devez être connecté pour effectuer cette action.");
    }
    const callerUid = context.auth.uid;
    const targetUserId = data.userId;
    const targetEmail = data.email;
    if (!targetUserId) {
        throw new functions.https.HttpsError("invalid-argument", "L'ID de l'utilisateur à supprimer est requis.");
    }
    // 2. Vérifier que l'appelant a les droits (admin/président/directeur)
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError("permission-denied", "Votre profil n'a pas été trouvé.");
    }
    const callerRole = String(((_a = callerDoc.data()) === null || _a === void 0 ? void 0 : _a.role) || "").toLowerCase();
    const allowedRoles = ["admin", "président", "president", "directeur", "director", "directeur exploitation"];
    const hasPermission = allowedRoles.some(role => callerRole.includes(role));
    if (!hasPermission) {
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
            performedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    var _a;
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
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError("permission-denied", "Votre profil n'a pas été trouvé.");
    }
    const callerRole = String(((_a = callerDoc.data()) === null || _a === void 0 ? void 0 : _a.role) || "").toLowerCase();
    const allowedRoles = ["admin", "président", "president", "directeur", "director", "directeur exploitation"];
    const hasPermission = allowedRoles.some(role => callerRole.includes(role));
    if (!hasPermission) {
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
            disabledAt: disable ? admin.firestore.FieldValue.serverTimestamp() : null,
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
            performedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    var _a;
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
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError("permission-denied", "Votre profil n'a pas été trouvé.");
    }
    const callerRole = String(((_a = callerDoc.data()) === null || _a === void 0 ? void 0 : _a.role) || "").toLowerCase();
    const allowedRoles = ["admin", "président", "president", "directeur", "director", "directeur exploitation", "secret"];
    const hasPermission = allowedRoles.some(role => callerRole.includes(role));
    if (!hasPermission) {
        throw new functions.https.HttpsError("permission-denied", "Vous n'avez pas les droits pour cette action.");
    }
    // 3. Générer le lien de réinitialisation
    try {
        // Vérifier que l'utilisateur existe dans Auth
        const authUser = await auth.getUserByEmail(email);
        // Générer le lien de reset
        const resetLink = await auth.generatePasswordResetLink(email, {
            url: "https://delivrex.vercel.app", // URL de redirection après reset
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
                firstName: (userData === null || userData === void 0 ? void 0 : userData.firstName) || "",
                lastName: (userData === null || userData === void 0 ? void 0 : userData.lastName) || "",
                role: (userData === null || userData === void 0 ? void 0 : userData.role) || "",
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
 * - Crée le compte Firebase Auth
 * - Migre le profil Firestore
 * - Marque l'invitation comme utilisée
 * - Retourne un custom token pour auto-login
 */
exports.activateAccount = functions
    .region("europe-west1")
    .https.onCall(async (data) => {
    const { token, password } = data;
    // Validations
    if (!token || typeof token !== "string") {
        throw new functions.https.HttpsError("invalid-argument", "Token manquant");
    }
    if (!password || password.length < 6) {
        throw new functions.https.HttpsError("invalid-argument", "Le mot de passe doit contenir au moins 6 caractères");
    }
    try {
        // 1. Trouver et valider l'invitation
        const snapshot = await db
            .collection("invitations")
            .where("token", "==", token)
            .limit(1)
            .get();
        if (snapshot.empty) {
            throw new functions.https.HttpsError("not-found", "Lien d'invitation invalide");
        }
        const invitationDoc = snapshot.docs[0];
        const invitation = invitationDoc.data();
        if (invitation.used) {
            throw new functions.https.HttpsError("already-exists", "Ce lien a déjà été utilisé");
        }
        const now = new Date();
        const expiresAt = new Date(invitation.expiresAt);
        if (now > expiresAt) {
            throw new functions.https.HttpsError("deadline-exceeded", "Ce lien a expiré");
        }
        // 2. Créer le compte Firebase Auth
        let authUser;
        try {
            authUser = await auth.createUser({
                email: invitation.email,
                password: password,
                emailVerified: true, // On considère l'email vérifié car il a reçu l'invitation
            });
            console.log(`✅ Compte Auth créé: ${authUser.uid}`);
        }
        catch (authError) {
            if (authError.code === "auth/email-already-exists") {
                throw new functions.https.HttpsError("already-exists", "Ce compte existe déjà. Utilisez 'Mot de passe oublié' pour vous connecter.");
            }
            throw authError;
        }
        // 3. Migrer le profil Firestore vers le bon UID
        const oldUserDoc = await db.collection("users").doc(invitation.userId).get();
        if (oldUserDoc.exists) {
            const userData = oldUserDoc.data();
            // Créer le nouveau document avec l'Auth UID
            await db.collection("users").doc(authUser.uid).set(Object.assign(Object.assign({}, userData), { id: authUser.uid, email: invitation.email.toLowerCase().trim(), activatedAt: admin.firestore.FieldValue.serverTimestamp() }));
            // Supprimer l'ancien document
            await db.collection("users").doc(invitation.userId).delete();
            console.log(`✅ Profil migré de ${invitation.userId} vers ${authUser.uid}`);
        }
        // 4. Marquer l'invitation comme utilisée
        await invitationDoc.ref.update({
            used: true,
            usedAt: new Date().toISOString(),
            authUid: authUser.uid,
        });
        // 5. Créer un custom token pour l'auto-login
        const customToken = await auth.createCustomToken(authUser.uid);
        console.log(`✅ Compte activé pour: ${invitation.email}`);
        // 6. Log d'audit
        await db.collection("audit_logs").add({
            action: "ACCOUNT_ACTIVATED",
            userId: authUser.uid,
            email: invitation.email,
            invitedBy: invitation.invitedBy,
            activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
            success: true,
            customToken: customToken,
            message: "Compte activé avec succès !",
        };
    }
    catch (error) {
        console.error("❌ Erreur activation:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", `Erreur lors de l'activation: ${error.message}`);
    }
});
//# sourceMappingURL=index.js.map