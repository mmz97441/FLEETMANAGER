import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';

const record = httpsCallable(getFunctions(app, 'europe-west1'), 'recordUserPresence', { timeout: 15000 });
export async function recordUserPresence(uid: string, login: boolean): Promise<void> {
  await record({ uid, login });
}
