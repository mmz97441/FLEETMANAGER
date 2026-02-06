/**
 * Service d'envoi d'emails via Firebase Extension "Trigger Email from Firestore"
 * 
 * Ce service ajoute des documents à la collection "mail" qui sont automatiquement
 * traités par l'extension Firebase pour envoyer les emails.
 * 
 * Configuration Extension:
 * - Collection: mail
 * - From: direction@delivrex.io
 */

import { db } from "../firebaseConfig";
import { collection, addDoc } from "firebase/firestore";
import { User, Issue, Absence, AbsenceType, Vehicle } from "../types";

// ============================================================================
// TYPES
// ============================================================================

interface EmailRecipient {
  email: string;
  name?: string;
}

interface EmailMessage {
  subject: string;
  html: string;
  text?: string;
}

interface EmailDocument {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  message: EmailMessage;
  createdAt?: string;
  type?: string; // Pour tracking
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const APP_URL = import.meta.env.VITE_APP_URL || '${APP_URL}';

// ============================================================================
// HELPERS
// ============================================================================

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('fr-FR', { 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric' 
  });
};

const formatDateTime = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('fr-FR', { 
    day: '2-digit', 
    month: 'long', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getPriorityLabel = (priority: string): string => {
  switch(priority) {
    case 'High': return '🔴 CRITIQUE';
    case 'Medium': return '🟠 Moyenne';
    default: return '🔵 Faible';
  }
};

const getAbsenceTypeLabel = (type: AbsenceType): string => {
  return type; // Le type est déjà en français
};

// Template HTML de base
const baseTemplate = (content: string, footerText?: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; margin: 0; padding: 0; background-color: #f1f5f9; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 24px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 8px 0 0 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 24px; background: white; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .badge-red { background: #fef2f2; color: #dc2626; }
    .badge-orange { background: #fff7ed; color: #ea580c; }
    .badge-blue { background: #eff6ff; color: #2563eb; }
    .badge-green { background: #f0fdf4; color: #16a34a; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #64748b; font-size: 12px; text-transform: uppercase; }
    .info-value { font-weight: 600; color: #1e293b; }
    .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white !important; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 16px; }
    .button:hover { background: #1d4ed8; }
    .footer { text-align: center; padding: 16px; color: #94a3b8; font-size: 12px; }
    .alert { padding: 12px 16px; border-radius: 8px; margin: 16px 0; }
    .alert-warning { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
    .alert-success { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
    .alert-danger { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      ${footerText || 'FleetGenius Pro - Gestion de flotte intelligente'}
      <br>
      <small>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</small>
    </div>
  </div>
</body>
</html>
`;

// ============================================================================
// CORE EMAIL FUNCTION
// ============================================================================

/**
 * Envoie un email via la collection Firestore "mail"
 */
export const sendEmail = async (
  to: string | string[],
  subject: string,
  htmlContent: string,
  options?: {
    cc?: string | string[];
    bcc?: string | string[];
    type?: string;
  }
): Promise<boolean> => {
  try {
    const emailDoc: EmailDocument = {
      to,
      message: {
        subject,
        html: baseTemplate(htmlContent)
      },
      createdAt: new Date().toISOString(),
      type: options?.type || 'general'
    };

    if (options?.cc) emailDoc.cc = options.cc;
    if (options?.bcc) emailDoc.bcc = options.bcc;

    await addDoc(collection(db, "mail"), emailDoc);
    return true;
  } catch (error) {
    console.error("❌ Erreur envoi email:", error);
    return false;
  }
};

// ============================================================================
// INCIDENT EMAILS
// ============================================================================

/**
 * Email envoyé aux admins/mécaniciens quand un chauffeur signale un incident
 */
export const sendIncidentCreatedEmail = async (
  issue: Issue,
  reporter: User,
  vehicle: Vehicle,
  recipients: string[]
): Promise<boolean> => {
  const priorityLabel = getPriorityLabel(issue.priority);
  const priorityClass = issue.priority === 'High' ? 'badge-red' : issue.priority === 'Medium' ? 'badge-orange' : 'badge-blue';

  const content = `
    <div class="header">
      <h1>🚨 Nouvel Incident Signalé</h1>
      <p>Un problème a été signalé sur un véhicule de la flotte</p>
    </div>
    <div class="content">
      <div style="text-align: center; margin-bottom: 20px;">
        <span class="badge ${priorityClass}">${priorityLabel}</span>
      </div>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Véhicule</span>
          <span class="info-value">${vehicle.plate} - ${vehicle.model}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Signalé par</span>
          <span class="info-value">${reporter.firstName} ${reporter.lastName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Date</span>
          <span class="info-value">${formatDateTime(issue.date)}</span>
        </div>
      </div>
      
      <h3 style="margin-top: 24px;">Description du problème</h3>
      <div class="info-box">
        <p style="margin: 0;">${issue.description}</p>
      </div>
      
      ${issue.photos && issue.photos.length > 0 ? `
        <p style="color: #64748b; font-size: 14px;">
          📷 ${issue.photos.length} photo(s) jointe(s) - Consultez l'application pour les voir
        </p>
      ` : ''}
      
      <div style="text-align: center;">
        <a href="${APP_URL}" class="button">Voir dans FleetGenius</a>
      </div>
    </div>
  `;

  return sendEmail(
    recipients,
    `🚨 [${priorityLabel}] Incident - ${vehicle.plate}`,
    content,
    { type: 'incident_created' }
  );
};

/**
 * Email envoyé au chauffeur quand son incident a une réponse/RDV
 */
export const sendIncidentResponseEmail = async (
  issue: Issue,
  vehicle: Vehicle,
  driverEmail: string,
  driverName: string,
  responseMessage: string,
  appointmentDate?: string
): Promise<boolean> => {
  const content = `
    <div class="header">
      <h1>${appointmentDate ? '📅 RDV Atelier Fixé' : '💬 Réponse à votre signalement'}</h1>
      <p>Votre incident a été pris en charge</p>
    </div>
    <div class="content">
      <p>Bonjour ${driverName},</p>
      
      <p>Concernant votre signalement sur le véhicule <strong>${vehicle.plate}</strong> :</p>
      
      ${appointmentDate ? `
        <div class="alert alert-warning">
          <strong>📅 Date d'immobilisation prévue :</strong><br>
          ${formatDate(appointmentDate)}
        </div>
      ` : ''}
      
      <div class="info-box">
        <p style="margin: 0; font-style: italic;">"${responseMessage}"</p>
      </div>
      
      <p style="color: #64748b; font-size: 14px;">
        Vous serez notifié dès que le problème sera résolu.
      </p>
    </div>
  `;

  return sendEmail(
    driverEmail,
    appointmentDate 
      ? `📅 RDV Atelier - ${vehicle.plate} - ${formatDate(appointmentDate)}`
      : `💬 Réponse incident - ${vehicle.plate}`,
    content,
    { type: 'incident_response' }
  );
};

/**
 * Email envoyé au chauffeur quand son incident est clôturé
 */
export const sendIncidentClosedEmail = async (
  issue: Issue,
  vehicle: Vehicle,
  driverEmail: string,
  driverName: string,
  closingComment: string
): Promise<boolean> => {
  const content = `
    <div class="header" style="background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);">
      <h1>✅ Incident Résolu</h1>
      <p>Votre véhicule est prêt</p>
    </div>
    <div class="content">
      <p>Bonjour ${driverName},</p>
      
      <div class="alert alert-success">
        <strong>Bonne nouvelle !</strong><br>
        L'incident sur votre véhicule <strong>${vehicle.plate}</strong> a été résolu.
      </div>
      
      <h3>Détails de l'intervention</h3>
      <div class="info-box">
        <p style="margin: 0;">${closingComment}</p>
      </div>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Problème initial</span>
          <span class="info-value">${issue.description.slice(0, 50)}...</span>
        </div>
        <div class="info-row">
          <span class="info-label">Signalé le</span>
          <span class="info-value">${formatDate(issue.date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Résolu le</span>
          <span class="info-value">${formatDate(new Date().toISOString())}</span>
        </div>
      </div>
    </div>
  `;

  return sendEmail(
    driverEmail,
    `✅ Incident résolu - ${vehicle.plate}`,
    content,
    { type: 'incident_closed' }
  );
};

// ============================================================================
// ABSENCE / CONGÉS EMAILS
// ============================================================================

/**
 * Email envoyé à la direction quand un employé demande un congé
 */
export const sendLeaveRequestEmail = async (
  absence: Absence,
  employee: User,
  approverEmails: string[]
): Promise<boolean> => {
  const content = `
    <div class="header">
      <h1>📅 Nouvelle Demande de Congés</h1>
      <p>Une demande nécessite votre validation</p>
    </div>
    <div class="content">
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Employé</span>
          <span class="info-value">${employee.firstName} ${employee.lastName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Type</span>
          <span class="info-value">${getAbsenceTypeLabel(absence.type)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Du</span>
          <span class="info-value">${formatDate(absence.startDate)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Au</span>
          <span class="info-value">${formatDate(absence.endDate)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Durée</span>
          <span class="info-value">${absence.workingDays} jour(s) ouvré(s)</span>
        </div>
      </div>
      
      ${absence.reason ? `
        <h3>Motif</h3>
        <div class="info-box">
          <p style="margin: 0;">${absence.reason}</p>
        </div>
      ` : ''}
      
      <div style="text-align: center;">
        <a href="${APP_URL}" class="button">Valider / Refuser</a>
      </div>
    </div>
  `;

  return sendEmail(
    approverEmails,
    `📅 Demande de congés - ${employee.firstName} ${employee.lastName} (${absence.workingDays}j)`,
    content,
    { type: 'leave_request' }
  );
};

/**
 * Email envoyé à l'employé quand sa demande est validée
 */
export const sendLeaveApprovedEmail = async (
  absence: Absence,
  employee: User,
  approverName: string
): Promise<boolean> => {
  const content = `
    <div class="header" style="background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);">
      <h1>✅ Congés Validés</h1>
      <p>Votre demande a été acceptée</p>
    </div>
    <div class="content">
      <p>Bonjour ${employee.firstName},</p>
      
      <div class="alert alert-success">
        <strong>Bonne nouvelle !</strong><br>
        Votre demande de ${getAbsenceTypeLabel(absence.type)} a été validée.
      </div>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Du</span>
          <span class="info-value">${formatDate(absence.startDate)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Au</span>
          <span class="info-value">${formatDate(absence.endDate)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Durée</span>
          <span class="info-value">${absence.workingDays} jour(s)</span>
        </div>
        <div class="info-row">
          <span class="info-label">Validé par</span>
          <span class="info-value">${approverName}</span>
        </div>
      </div>
      
      <p style="color: #64748b; font-size: 14px;">
        Bonnes vacances ! 🌴
      </p>
    </div>
  `;

  return sendEmail(
    employee.email,
    `✅ Congés validés du ${formatDate(absence.startDate)} au ${formatDate(absence.endDate)}`,
    content,
    { type: 'leave_approved' }
  );
};

/**
 * Email envoyé à l'employé quand sa demande est refusée
 */
export const sendLeaveRejectedEmail = async (
  absence: Absence,
  employee: User,
  approverName: string,
  reason?: string
): Promise<boolean> => {
  const content = `
    <div class="header" style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);">
      <h1>❌ Congés Refusés</h1>
      <p>Votre demande n'a pas pu être acceptée</p>
    </div>
    <div class="content">
      <p>Bonjour ${employee.firstName},</p>
      
      <div class="alert alert-danger">
        Votre demande de ${getAbsenceTypeLabel(absence.type)} du <strong>${formatDate(absence.startDate)}</strong> au <strong>${formatDate(absence.endDate)}</strong> a été refusée.
      </div>
      
      ${reason ? `
        <h3>Motif du refus</h3>
        <div class="info-box">
          <p style="margin: 0;">${reason}</p>
        </div>
      ` : ''}
      
      <p style="color: #64748b; font-size: 14px;">
        N'hésitez pas à contacter ${approverName} pour plus d'informations ou pour proposer d'autres dates.
      </p>
    </div>
  `;

  return sendEmail(
    employee.email,
    `❌ Demande de congés refusée`,
    content,
    { type: 'leave_rejected' }
  );
};

// ============================================================================
// ALERT EMAILS
// ============================================================================

/**
 * Email d'alerte pour CT expiré ou proche expiration
 */
export const sendCTAlertEmail = async (
  vehicle: Vehicle,
  daysRemaining: number,
  recipients: string[]
): Promise<boolean> => {
  const isExpired = daysRemaining <= 0;
  
  const content = `
    <div class="header" style="background: linear-gradient(135deg, ${isExpired ? '#dc2626' : '#ea580c'} 0%, ${isExpired ? '#b91c1c' : '#c2410c'} 100%);">
      <h1>${isExpired ? '🚫 CT Expiré' : '⚠️ CT Bientôt Expiré'}</h1>
      <p>Action requise sur un véhicule</p>
    </div>
    <div class="content">
      <div class="alert ${isExpired ? 'alert-danger' : 'alert-warning'}">
        ${isExpired 
          ? `<strong>URGENT :</strong> Le contrôle technique du véhicule est expiré !`
          : `<strong>Attention :</strong> Le contrôle technique expire dans ${daysRemaining} jour(s).`
        }
      </div>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Véhicule</span>
          <span class="info-value">${vehicle.plate} - ${vehicle.model}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Date CT</span>
          <span class="info-value">${vehicle.technicalControlDate ? formatDate(vehicle.technicalControlDate) : 'Non renseignée'}</span>
        </div>
      </div>
      
      <p style="color: #64748b; font-size: 14px;">
        ${isExpired 
          ? 'Ce véhicule ne doit plus circuler jusqu\'à régularisation.'
          : 'Merci de planifier le contrôle technique rapidement.'
        }
      </p>
    </div>
  `;

  return sendEmail(
    recipients,
    `${isExpired ? '🚫' : '⚠️'} CT ${isExpired ? 'expiré' : `dans ${daysRemaining}j`} - ${vehicle.plate}`,
    content,
    { type: 'ct_alert' }
  );
};

/**
 * Email d'alerte pour permis expiré ou proche expiration
 */
export const sendLicenseAlertEmail = async (
  driver: User,
  daysRemaining: number,
  recipients: string[]
): Promise<boolean> => {
  const isExpired = daysRemaining <= 0;
  
  const content = `
    <div class="header" style="background: linear-gradient(135deg, ${isExpired ? '#dc2626' : '#ea580c'} 0%, ${isExpired ? '#b91c1c' : '#c2410c'} 100%);">
      <h1>${isExpired ? '🚫 Permis Expiré' : '⚠️ Permis Bientôt Expiré'}</h1>
      <p>Action requise pour un chauffeur</p>
    </div>
    <div class="content">
      <div class="alert ${isExpired ? 'alert-danger' : 'alert-warning'}">
        ${isExpired 
          ? `<strong>URGENT :</strong> Le permis de conduire est expiré !`
          : `<strong>Attention :</strong> Le permis expire dans ${daysRemaining} jour(s).`
        }
      </div>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Chauffeur</span>
          <span class="info-value">${driver.firstName} ${driver.lastName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Date d'expiration</span>
          <span class="info-value">${driver.licenseExpiry ? formatDate(driver.licenseExpiry) : 'Non renseignée'}</span>
        </div>
      </div>
      
      <p style="color: #64748b; font-size: 14px;">
        ${isExpired 
          ? 'Ce chauffeur ne doit plus conduire jusqu\'à régularisation.'
          : 'Merci de rappeler au chauffeur de renouveler son permis.'
        }
      </p>
    </div>
  `;

  return sendEmail(
    recipients,
    `${isExpired ? '🚫' : '⚠️'} Permis ${isExpired ? 'expiré' : `dans ${daysRemaining}j`} - ${driver.firstName} ${driver.lastName}`,
    content,
    { type: 'license_alert' }
  );
};

// ============================================================================
// HELPER: Get admin emails
// ============================================================================

/**
 * Récupère les emails des utilisateurs avec un rôle admin/direction/secrétaire
 */
export const getAdminEmails = (users: User[]): string[] => {
  const adminRoles = ['admin', 'president', 'presid', 'direction', 'directeur', 'director', 'secret'];
  
  return users
    .filter(u => {
      const role = String(u.role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return adminRoles.some(r => role.includes(r)) && u.email;
    })
    .map(u => u.email)
    .filter(Boolean) as string[];
};

/**
 * Récupère les emails des mécaniciens
 */
export const getMechanicEmails = (users: User[]): string[] => {
  return users
    .filter(u => {
      const role = String(u.role).toLowerCase();
      return (role.includes('mecan') || role.includes('mech')) && u.email;
    })
    .map(u => u.email)
    .filter(Boolean) as string[];
};

// ============================================================================
// USER INVITATION EMAIL
// ============================================================================

/**
 * Email d'invitation envoyé à un nouvel utilisateur (avec lien token)
 */
export const sendUserInvitationEmail = async (
  newUser: { email: string; firstName: string; lastName: string; role: string },
  invitedBy: { firstName: string; lastName: string },
  activationUrl: string,
  expiresAt: string
): Promise<boolean> => {
  const expirationDate = new Date(expiresAt).toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const content = `
    <div class="header" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);">
      <h1>🎉 Bienvenue sur FleetGenius !</h1>
      <p>Vous avez été invité(e) à rejoindre la plateforme</p>
    </div>
    <div class="content">
      <p>Bonjour ${newUser.firstName},</p>
      
      <p><strong>${invitedBy.firstName} ${invitedBy.lastName}</strong> vous a invité(e) à rejoindre FleetGenius Pro, la plateforme de gestion de flotte.</p>
      
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Votre compte</span>
          <span class="info-value">${newUser.email}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Votre rôle</span>
          <span class="info-value">${newUser.role}</span>
        </div>
      </div>
      
      <div style="text-align: center; margin: 32px 0;">
        <a href="${activationUrl}" class="button" style="font-size: 18px; padding: 18px 40px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
          🚀 Activer mon compte
        </a>
      </div>
      
      <div class="alert alert-warning">
        <strong>⏰ Important :</strong> Ce lien est valide jusqu'au <strong>${expirationDate}</strong>.<br>
        Passé ce délai, vous devrez demander une nouvelle invitation.
      </div>
      
      <h3>Comment ça marche ?</h3>
      <ol style="color: #64748b; font-size: 14px; line-height: 1.8;">
        <li>Cliquez sur le bouton vert <strong>"Activer mon compte"</strong></li>
        <li>Créez votre mot de passe personnel (6 caractères minimum)</li>
        <li>C'est terminé ! Vous serez connecté automatiquement</li>
      </ol>
      
      <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
        Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
        <a href="${activationUrl}" style="color: #3b82f6; word-break: break-all;">${activationUrl}</a>
      </p>
    </div>
  `;

  return sendEmail(
    newUser.email,
    `🎉 Bienvenue sur FleetGenius - Activez votre compte`,
    content,
    { type: 'user_invitation' }
  );
};

/**
 * Email de réinitialisation de mot de passe
 */
export const sendPasswordResetRequestEmail = async (
  user: { email: string; firstName: string }
): Promise<boolean> => {
  const content = `
    <div class="header">
      <h1>🔐 Réinitialisation de mot de passe</h1>
      <p>Une demande a été effectuée pour votre compte</p>
    </div>
    <div class="content">
      <p>Bonjour ${user.firstName},</p>
      
      <p>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte FleetGenius.</p>
      
      <div class="alert alert-warning">
        Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.
      </div>
      
      <p>Pour réinitialiser votre mot de passe, rendez-vous sur la page de connexion et cliquez sur "Mot de passe oublié".</p>
      
      <div style="text-align: center;">
        <a href="${APP_URL}" class="button">Accéder à FleetGenius</a>
      </div>
    </div>
  `;

  return sendEmail(
    user.email,
    `🔐 Réinitialisation de mot de passe FleetGenius`,
    content,
    { type: 'password_reset' }
  );
};
