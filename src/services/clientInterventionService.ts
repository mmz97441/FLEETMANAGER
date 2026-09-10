import { addDoc, collection } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { ActivityAction, ActivityCategory, User } from '../types';

/** Separate from best-effort activity logging: failure must block intervention intent. */
export async function recordClientIntervention(actor: User, client: User, sessionId: string, action: string, phase: 'requested' | 'confirmed' | 'unconfirmed'): Promise<void> {
  const authenticated = auth.currentUser;
  if (!authenticated || authenticated.uid !== actor.id) throw new Error('L’identité de l’intervenant a changé. Fermez puis rouvrez la consultation.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Le journal de l’intervention ne répond pas.')), 10_000); });
  try {
  await Promise.race([unavailable, addDoc(collection(db, 'activity_logs'), {
    userId: authenticated.uid,
    userName: `${actor.firstName} ${actor.lastName}`.trim(),
    userRole: String(actor.role),
    action: ActivityAction.STATUS_CHANGED,
    category: ActivityCategory.SYSTEM,
    targetType: 'user', targetId: client.id,
    targetName: client.companyName || `${client.firstName} ${client.lastName}`.trim(),
    description: `Intervention client : ${action} — ${phase === 'requested' ? 'demandée' : phase === 'confirmed' ? 'confirmée' : 'résultat non confirmé'}`,
    outcome: phase === 'confirmed' ? 'success' : 'neutral',
    details: { metadata: { interventionSessionId: sessionId, actorId: authenticated.uid, clientId: client.id, action, phase } },
    createdAt: new Date().toISOString(),
  })]);
  } finally { clearTimeout(timer); }
}
