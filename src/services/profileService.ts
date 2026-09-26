import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { db } from '../firebaseConfig';
import type { User } from '../types';
import { reportError } from './logService';
import { withDeadline } from '../utils/asyncDeadline';

const serverProfile = httpsCallable<{ uid: string }, { profile: User | null }>(
  getFunctions(app, 'europe-west1'), 'getOwnProfile', { timeout: 15000 },
);

export async function getUserProfile(uid: string): Promise<User | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      getDoc(doc(db, 'users', uid)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Lecture du profil trop lente.'), { code: 'profile/read-timeout' })), 5000); }),
    ]);
    const profile = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as User : null;
    if (snapshot.metadata.fromCache && (!profile || profile.isDisabled || profile.sessionsRevokedAt))
      throw Object.assign(new Error('Le serveur doit confirmer l’état du profil.'), { code: 'profile/cache-unconfirmed' });
    return profile;
  } catch (error) {
    // A network/cache failure is never proof of an absent account. This callable
    // reads only the authenticated caller's profile without the browser Firestore cache.
    reportError('auth.profile.fallback', error, { silent: true, level: 'warning', extra: { profileUid: uid } });
    const result = await withDeadline(serverProfile({ uid }), 20000,
      Object.assign(new Error('Le profil ne répond pas. Réessayez sans vous déconnecter.'), { code: 'functions/deadline-exceeded' }));
    return result.data.profile ? { ...result.data.profile, id: uid } : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function linkAuthToProfile(uid: string): Promise<void> {
  // UID is a consistency guard; identity/email ownership is still checked on the server.
  await httpsCallable(getFunctions(app, 'europe-west1'), 'linkAuthToProfile', { timeout: 60000 })({ uid });
}

export function subscribeToUserProfile(uid: string, next: (profile: User | null) => void, error: (error: unknown) => void) {
  return onSnapshot(doc(db, 'users', uid), { includeMetadataChanges: true }, snapshot => {
    // A cached miss or stale disabled flag must not revoke a working session.
    // The initial read handles offline access; subsequent access changes come from the server.
    if (snapshot.metadata.fromCache) return;
    next(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as User : null);
  }, error);
}
