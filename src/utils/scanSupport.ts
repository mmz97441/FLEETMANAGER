import type { ErrorLogRecord } from '../services/logService';
interface ScanEvent { id: string; action?: string; targetId?: string; targetName?: string; userId?: string; userName?: string; userRole?: string; description?: string; outcome?: string; createdAt: string; details?: { metadata?: Record<string, any> } }
/** Derive incidents from the immutable server audit; never count accepted scans as errors. */
export function scanSupportIncidents(events: ScanEvent[]): ErrorLogRecord[] {
  const scans = events.filter(e => e.action === 'PACKAGE_SCANNED').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return scans.filter(e => e.outcome === 'failure').map(event => {
    const meta = event.details?.metadata || {};
    const later = scans.find(next => next.createdAt > event.createdAt && next.userId === event.userId && next.outcome !== 'failure' &&
      ((event.targetId && next.targetId === event.targetId) || (event.targetName && next.targetName === event.targetName) ||
       (meta.scannedCode && meta.scannedCode === next.details?.metadata?.scannedCode)));
    return { id: `scan-${event.id}`, referenceId: meta.requestId, context: `scan.${meta.scan || 'refused'}`,
      level: 'warning', message: event.description || 'Scan refusé', createdAt: event.createdAt,
      userId: event.userId || null, userName: event.userName || null, userRole: event.userRole || null,
      extra: { ...meta, resolution: later ? `Scan accepté ensuite le ${new Date(later.createdAt).toLocaleString('fr-FR', { timeZone: 'Indian/Reunion' })}` : 'Aucune reprise acceptée retrouvée dans les événements chargés.' },
      stack: null, url: null, userAgent: null, appVersion: null };
  });
}
