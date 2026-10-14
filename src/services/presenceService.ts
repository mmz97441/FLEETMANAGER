import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { withDeadline } from '../utils/asyncDeadline';

let ephemeralDeviceId: string | undefined;
function deviceIdentity() {
  let deviceId: string;
  try {
    deviceId = localStorage.getItem('delivrex.device.id') || crypto.randomUUID();
    localStorage.setItem('delivrex.device.id', deviceId);
  } catch { deviceId = ephemeralDeviceId ||= crypto.randomUUID(); }
  const ua = navigator.userAgent;
  const deviceLabel = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone / iPad' : 'Ordinateur';
  return { deviceId, deviceLabel };
}
const record = httpsCallable(getFunctions(app, 'europe-west1'), 'recordUserPresence', { timeout: 15000 });
export async function recordUserPresence(uid: string, login: boolean): Promise<void> {
  await withDeadline(record({ uid, login, appVersion: __APP_VERSION__, buildId: __BUILD_ID__, ...deviceIdentity() }), 20000,
    Object.assign(new Error('Confirmation de présence trop longue.'), { code: 'functions/deadline-exceeded' }));
}
