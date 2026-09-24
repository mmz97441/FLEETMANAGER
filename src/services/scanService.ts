import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { reportError } from './logService';
import { operationalDay } from '../utils/operationalDay';
import { beginDiagnosticOperation } from '../utils/runtimeDiagnostics';

export type ScanSource = 'driver-claim' | 'driver-delivery' | 'driver-pickup' | 'hub-loading' | 'quick-scan' | 'transfer' | 'manual-create';
export interface ScanReceipt {
  requestId: string; accepted: boolean; replayed?: boolean;
  outcome: 'confirmed' | 'already_scanned' | 'reassigned' | 'not_found' | 'ambiguous' | 'terminal' | 'blocked';
  message: string; scannedAt: string; driverId: string; driverName: string;
  packageId: string | null; packageCode: string; contactName: string;
  missionId: string | null; missionDate: string | null; stopId: string | null; status?: string;
  previousMissionId?: string | null; previousMissionDate?: string | null;
  matchedOrderReference?: string;
}
interface ScanInput { driverId: string; code?: string; packageId?: string; targetMissionId?: string; stopId?: string; source: ScanSource }
type Request = ScanInput & { requestId: string };
const pending = new Map<string, Request>();
const running = new Map<string, Promise<ScanReceipt>>();
const contexts = new Map<string, { day: string; id: string }>();
export function rememberScanMission(driverId: string, id: string, day: string) {
  contexts.set(driverId, { day, id });
  try { localStorage.setItem(`fleet.scan.tour.${driverId}`, JSON.stringify({ day, id })); } catch { /* memory fallback */ }
}
function currentMission(driverId: string) {
  let value = contexts.get(driverId);
  try { value = JSON.parse(localStorage.getItem(`fleet.scan.tour.${driverId}`) || 'null') || value; } catch { /* memory fallback */ }
  return value?.day === operationalDay() ? value.id : undefined;
}

/** Retain the same request after an uncertain response. No green confirmation before the server commits. */
export function scanPackage(input: ScanInput): Promise<ScanReceipt> {
  const key = `fleet.scan.pending.${input.driverId}.${operationalDay()}.${input.source}.${encodeURIComponent(input.packageId || input.code?.trim() || '')}`;
  const active = running.get(key);
  if (active) return active;
  const task = (async () => {
    let retained = pending.get(key);
    try { retained = JSON.parse(localStorage.getItem(key) || 'null') || retained; } catch { /* memory fallback */ }
    const request: Request = retained || {
      ...input, ...(input.code ? { code: input.code.trim() } : {}),
      ...(input.targetMissionId || currentMission(input.driverId) ? { targetMissionId: input.targetMissionId || currentMission(input.driverId) } : {}),
      requestId: crypto.randomUUID(),
    };
    pending.set(key, request);
    try { localStorage.setItem(key, JSON.stringify(request)); } catch { /* memory fallback */ }
    const operation = beginDiagnosticOperation('scan.confirm');
    try {
      const call = httpsCallable<Request, ScanReceipt>(getFunctions(app, 'europe-west1'), 'scanPackage', { timeout: 20000 });
      // Firebase rejects undefined values in callable payloads.
      const { data } = await call(JSON.parse(JSON.stringify(request)));
      operation.finish(data.accepted ? 'success' : 'refused');
      pending.delete(key);
      try { localStorage.removeItem(key); } catch { /* memory fallback */ }
      if (data.accepted && data.missionId && data.missionDate) rememberScanMission(input.driverId, data.missionId, data.missionDate);
      return data;
    } catch (error) {
      operation.finish('failure');
      const code = String((error as { code?: string })?.code || '');
      if (['functions/permission-denied', 'functions/unauthenticated', 'functions/invalid-argument', 'functions/failed-precondition'].includes(code)) {
        pending.delete(key);
        try { localStorage.removeItem(key); } catch { /* memory fallback */ }
      }
      reportError('driver.scan.confirm', error, { silent: true, extra: { requestId: request.requestId, source: input.source, driverId: input.driverId } });
      throw error;
    }
  })();
  running.set(key, task);
  void task.finally(() => running.delete(key)).catch(() => {});
  return task;
}

export function scanReceiptLabel(receipt: ScanReceipt): string {
  const time = new Date(receipt.scannedAt).toLocaleTimeString('fr-FR', { timeZone: 'Indian/Reunion', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${receipt.packageCode} — ${receipt.message} à ${time}`;
}
