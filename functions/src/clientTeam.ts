import * as functions from 'firebase-functions/v1';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'crypto';

interface Dependencies {
  db: Firestore;
  requireActiveCaller: (context: functions.https.CallableContext) => Promise<any>;
  isAdminCaller: (role: unknown) => boolean;
  appUrl: string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
function emailValue(value: unknown) {
  const email = String(value || '').toLowerCase().trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new functions.https.HttpsError('invalid-argument', 'Email invalide.');
  return email;
}
function authorizeTarget(caller: any, target: any, manager: boolean) {
  if (!manager && (String(caller.role).toLowerCase() !== 'client' || !caller.companyName || String(target.role).toLowerCase() !== 'client' || target.companyName !== caller.companyName))
    throw new functions.https.HttpsError('permission-denied', 'Vous ne pouvez inviter que votre équipe cliente.');
  if (target.isDisabled) throw new functions.https.HttpsError('failed-precondition', 'Ce compte est suspendu. Contactez votre responsable.');
}
function queueInvitation(tx: Transaction, deps: Dependencies, caller: any, userId: string, user: any, requestKey: string, token: string, now: string) {
  const expiresAt = new Date(Date.parse(now) + 7 * 86400000).toISOString();
  tx.set(deps.db.collection('invitations').doc(userId), { schemaVersion: 2, token, email: user.email, userId,
    role: user.role, firstName: user.firstName || '', lastName: user.lastName || '', companyName: user.companyName || '',
    invitedBy: caller.id, invitedByName: `${caller.firstName || ''} ${caller.lastName || ''}`.trim(), createdAt: now, expiresAt, used: false });
  tx.create(deps.db.collection('mail').doc(`client-invite-${requestKey}`), { to: user.email,
    message: { subject: 'Votre invitation FleetGenius', text: `Vous êtes invité à rejoindre FleetGenius. Activez votre compte : ${deps.appUrl}/activate?token=${token}\nCe lien expire le ${expiresAt}.` },
    type: 'user_invitation', createdAt: now });
  return { token, expiresAt };
}

/** Client profile, unique email, invitation and queued email commit together.
 * An existing profile is returned for inspection, never silently merged. */
export async function inviteClientTeamMemberHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context);
  if (String(caller.role).toLowerCase() !== 'client' || !caller.companyName) throw new functions.https.HttpsError('permission-denied', 'Invitation réservée à votre entreprise cliente.');
  if (!validId(data?.requestId)) throw new functions.https.HttpsError('invalid-argument', 'Référence d’invitation invalide.');
  const email = emailValue(data.email), firstName = String(data.firstName || '').trim(), lastName = String(data.lastName || '').trim();
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) throw new functions.https.HttpsError('invalid-argument', 'Renseignez le prénom et le nom du collaborateur.');
  const key = hash(`${caller.id}|${data.requestId}`), fingerprint = hash(JSON.stringify([email, firstName, lastName, caller.companyName]));
  const receiptRef = deps.db.collection('client_team_operations').doc(key), profileRef = deps.db.collection('users').doc(`client-${hash(email).slice(0, 40)}`);
  const token = randomBytes(32).toString('hex');
  return deps.db.runTransaction(async tx => {
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()!.fingerprint !== fingerprint) throw new functions.https.HttpsError('failed-precondition', 'Cette référence d’invitation contient une autre demande.');
      return receipt.data()!.result;
    }
    const rows = await tx.get(deps.db.collection('users').where('email', '==', email));
    if (rows.size > 1) throw new functions.https.HttpsError('failed-precondition', 'Plusieurs profils utilisent cet email. Faites contrôler ces doublons par votre responsable.');
    const reservedProfile = await tx.get(profileRef);
    let result: { userId: string; outcome: 'INVITED' | 'EXISTING' };
    const now = new Date().toISOString();
    if (rows.size) {
      const old = rows.docs[0]; authorizeTarget(caller, old.data(), false);
      result = { userId: old.id, outcome: 'EXISTING' };
    } else {
      if (reservedProfile.exists) throw new functions.https.HttpsError('failed-precondition', 'Cet email nécessite un contrôle par votre responsable.');
      const user = { email, firstName, lastName, role: 'Client', companyName: caller.companyName, leaveBalance: 0, createdAt: now };
      tx.create(profileRef, user);
      queueInvitation(tx, deps, caller, profileRef.id, user, key, token, now);
      result = { userId: profileRef.id, outcome: 'INVITED' };
    }
    tx.create(receiptRef, { actorId: caller.id, fingerprint, result, createdAt: now });
    return result;
  });
}

/** Existing callers may omit requestId: reuse the current valid invitation.
 * Explicit resend supplies a durable requestId; retry never rotates its token. */
export async function createInvitationHandler(data: any, context: functions.https.CallableContext, deps: Dependencies) {
  const caller = await deps.requireActiveCaller(context), manager = deps.isAdminCaller(caller.role);
  if (!manager && String(caller.role).toLowerCase() !== 'client') throw new functions.https.HttpsError('permission-denied', 'Invitation non autorisée.');
  const email = emailValue(data?.email);
  if (data.userId !== undefined && !validId(data.userId)) throw new functions.https.HttpsError('invalid-argument', 'Collaborateur invalide.');
  if (data.requestId !== undefined && !validId(data.requestId)) throw new functions.https.HttpsError('invalid-argument', 'Référence de renvoi invalide.');
  const token = randomBytes(32).toString('hex');
  return deps.db.runTransaction(async tx => {
    const rows = await tx.get(deps.db.collection('users').where('email', '==', email));
    if (rows.size !== 1) throw new functions.https.HttpsError('failed-precondition', rows.empty ? 'Profil introuvable.' : 'Plusieurs profils utilisent cet email. Faites contrôler ces doublons par votre responsable.');
    const target = rows.docs[0];
    if (data.userId && target.id !== data.userId) throw new functions.https.HttpsError('failed-precondition', 'L’email de ce collaborateur a changé. Actualisez sa fiche.');
    const user = target.data(); authorizeTarget(caller, user, manager);
    if (user.activatedAt) throw new functions.https.HttpsError('already-exists', 'Compte déjà activé. Utilisez Mot de passe oublié.');
    const key = hash(`${caller.id}|${data.requestId || `initial:${target.id}`}`), receiptRef = deps.db.collection('client_team_operations').doc(key);
    const receipt = await tx.get(receiptRef), invitation = await tx.get(deps.db.collection('invitations').doc(target.id));
    if (receipt.exists && data.requestId) {
      if (receipt.data()!.email !== email || receipt.data()!.userId !== target.id) throw new functions.https.HttpsError('failed-precondition', 'Cette référence appartient à une autre invitation.');
      return receipt.data()!.result;
    }
    if (!data.requestId && invitation.exists && !invitation.data()!.used && Date.parse(invitation.data()!.expiresAt) > Date.now())
      return { token: invitation.data()!.token, expiresAt: invitation.data()!.expiresAt };
    // A legacy initial call after expiry receives its own mail ID. Its valid
    // invitation is reused by the next retry, preserving older integrations.
    const mailKey = data.requestId ? key : `${key}-${hash(token).slice(0, 16)}`;
    const now = new Date().toISOString(), result = queueInvitation(tx, deps, caller, target.id, user, mailKey, token, now);
    if (data.requestId) tx.create(receiptRef, { actorId: caller.id, email, userId: target.id, result, createdAt: now });
    return result;
  });
}
