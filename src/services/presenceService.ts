import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { withDeadline } from '../utils/asyncDeadline';

const record = httpsCallable(getFunctions(app, 'europe-west1'), 'recordUserPresence', { timeout: 15000 });
export async function recordUserPresence(uid: string, login: boolean): Promise<void> {
  await withDeadline(record({ uid, login, appVersion: __APP_VERSION__, buildId: __BUILD_ID__ }), 20000,
    Object.assign(new Error('Confirmation de présence trop longue.'), { code: 'functions/deadline-exceeded' }));
}
