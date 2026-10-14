import { Package, PackageStatus, ProofOfDelivery } from '../types';
import { proofForAttempt } from '../utils/deliveryProofState';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Logistics calendars use the operating timezone, independently of the device. */
export function logisticsDay(value: string | number | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? dayFormatter.format(date)
    : '';
}
export function formatLogisticsTimestamp(value?: string): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('fr-FR', {
    timeZone: 'Indian/Reunion', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'Non renseigné';
}
export interface LogisticsDimensions { pharmacy?: string; zone?: string }
export const UNKNOWN_RECIPIENT = 'Destinataire historique non renseigné';
export const UNKNOWN_ZONE = 'Zone historique non renseignée';
export const currentDimensions = (pkg: Package) => ({ pharmacy: pkg.contactName?.trim() || '—', zone: String(pkg.zone || '').trim() || '—' });
export const eventDimensions = (event: DeliveryEvent) => ({ pharmacy: event.destination?.contactName?.trim() || UNKNOWN_RECIPIENT,
  zone: event.destination?.zone?.trim() || UNKNOWN_ZONE });
export const matchesLogisticsDimensions = (value: LogisticsDimensions, filter: LogisticsDimensions = {}) =>
  (!filter.pharmacy || value.pharmacy === filter.pharmacy.trim()) && (!filter.zone || value.zone === filter.zone.trim());
export interface LogisticsRange { start: string; end: string }
export function logisticsDateRange(day: string, period: 'today' | 'week' | 'month'): LogisticsRange {
  const date = new Date(`${day}T00:00:00Z`);
  if (period === 'today') return { start: day, end: day };
  const key = (value: Date) => value.toISOString().slice(0, 10);
  if (period === 'month') return { start: key(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))),
    end: key(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))) };
  const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000);
  return { start: key(monday), end: key(new Date(monday.getTime() + 6 * 86400000)) };
}
export function inLogisticsRange(timestamp: string | undefined, range?: LogisticsRange): boolean {
  if (!range) return true;
  const day = timestamp ? logisticsDay(timestamp) : '';
  return !!day && day >= range.start && day <= range.end;
}
export const successRate = (delivered: number, failed: number): number =>
  delivered + failed > 0 ? 100 * delivered / (delivered + failed) : 0;

export interface DeliveryEvent {
  id: string;
  package: Package;
  outcome: 'SUCCESS' | 'FAILURE';
  timestamp?: string;
  driverId?: string;
  reason?: string;
  notes?: string;
  destination?: ProofOfDelivery['destination'];
  proof?: ProofOfDelivery;
  promisedDeliveryAt?: string | null;
  estimatedDeliveryAt?: string | null;
}
const validTime = (value?: string): string | undefined =>
  value && Number.isFinite(Date.parse(value)) ? value : undefined;

/** One event per parcel and attempt. New attempts override the legacy movement,
 * never the reverse. A hub return is not a second failed delivery attempt. */
export function deliveryEvents(pkg: Package): DeliveryEvent[] {
  const events: DeliveryEvent[] = [];
  for (const attempt of pkg.deliveryAttempts || []) {
    if (events.some(event => event.id === attempt.id)) continue;
    const proof = proofForAttempt(pkg, attempt);
    events.push({ id: attempt.id, package: pkg, outcome: attempt.outcome, proof, destination: attempt.destination || proof?.destination, notes: attempt.failureNotes,
      timestamp: validTime(attempt.recordedAt), driverId: attempt.driverId,
      reason: attempt.failureReason, promisedDeliveryAt: attempt.promisedDeliveryAt, estimatedDeliveryAt: attempt.estimatedDeliveryAt });
  }
  const movements = (pkg.movements || []).filter(m => m.action === 'DELIVERED' || m.action === 'FAILED');
  for (const [index, movement] of movements.entries()) {
    const outcome = movement.action === 'DELIVERED' ? 'SUCCESS' : 'FAILURE';
    const matchingProof = outcome === 'SUCCESS' ? pkg.pod : pkg.failurePod;
    const proofMatches = matchingProof && (!movement.missionId || matchingProof.missionId === movement.missionId)
      && (!movement.stopId || matchingProof.stopId === movement.stopId)
      && movements.filter(m => m.action === movement.action).slice(-1)[0] === movement;
    const id = movement.proofId || (movement.missionId && movement.stopId ? `${movement.missionId}_${movement.stopId}` : `legacy:${movement.action}:${movement.timestamp}:${index}`);
    if (proofMatches && events.some(event => event.id === (matchingProof.proofId || `${matchingProof.missionId}_${matchingProof.stopId}`))) continue;
    if (events.some(event => event.id === id || (event.outcome === outcome && event.timestamp === movement.timestamp))) continue;
    events.push({ id, package: pkg, outcome, proof: proofMatches ? matchingProof : undefined, destination: proofMatches ? matchingProof.destination : undefined, notes: movement.notes,
      timestamp: validTime(proofMatches ? matchingProof.timestamp : movement.timestamp),
      driverId: movement.driverId, reason: movement.failureReason || (outcome === 'FAILURE' ? pkg.failureReason : undefined) });
  }
  for (const proof of [pkg.pod, pkg.failurePod]) {
    if (!proof) continue;
    const outcome = proof.type === 'FAILURE' || proof === pkg.failurePod ? 'FAILURE' : 'SUCCESS';
    const id = proof.proofId || `${proof.missionId}_${proof.stopId}`;
    if (events.some(event => event.id === id || (event.outcome === outcome && event.timestamp === proof.timestamp))) continue;
    // Old movements have no mission/stop: the latest proof already corrected its date above.
    if (events.some(event => event.outcome === outcome && event.id.startsWith('legacy:'))) continue;
    events.push({ id, package: pkg, outcome, proof, destination: proof.destination, notes: proof.failureNotes || proof.notes, timestamp: validTime(proof.timestamp), driverId: proof.driverId, reason: proof.failureReason });
  }
  const currentOutcome = pkg.status === PackageStatus.DELIVERED ? 'SUCCESS'
    : [PackageStatus.FAILED, PackageStatus.RETURNED].includes(pkg.status) ? 'FAILURE' : undefined;
  if (currentOutcome && !events.some(event => event.outcome === currentOutcome)) {
    // No invented date for historical status-only parcels. Count them only in all-history totals.
    const returned = currentOutcome === 'FAILURE' ? [...(pkg.movements || [])].reverse().find(m => m.action === 'RETURNED') : undefined;
    events.push({ id: `undocumented:${pkg.id}`, package: pkg, outcome: currentOutcome,
      timestamp: validTime(returned?.timestamp), driverId: returned?.driverId || pkg.currentDriverId, reason: pkg.failureReason });
  }
  return events;
}

export const outcomeEventsInRange = (packages: Package[], range?: LogisticsRange, dimensions?: LogisticsDimensions): DeliveryEvent[] =>
  packages.flatMap(deliveryEvents).filter(event => inLogisticsRange(event.timestamp, range) && matchesLogisticsDimensions(eventDimensions(event), dimensions));

export function deliveryTimestamp(pkg: Package): string | undefined {
  return deliveryEvents(pkg).filter(event => event.outcome === 'SUCCESS' && event.timestamp)
    .sort((a, b) => Date.parse(b.timestamp!) - Date.parse(a.timestamp!))[0]?.timestamp;
}

/** Promised deadline and route ETA are different measures. Only an explicit
 * requested date defines the customer promise; mission rescheduling cannot move it. */
export function promisedDeadline(pkg: Package): string | undefined {
  if (!pkg.requestedDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(pkg.requestedDeliveryDate)) return undefined;
  const time = /^\d{2}:\d{2}$/.test(pkg.timeWindowEnd || '') ? `${pkg.timeWindowEnd}:00` : '23:59:59.999';
  return validTime(`${pkg.requestedDeliveryDate}T${time}+04:00`);
}

export function summarizeLogistics(packages: Package[], range?: LogisticsRange, dimensions?: LogisticsDimensions) {
  const events = outcomeEventsInRange(packages, range, dimensions);
  const currentPackages = packages.filter(pkg => matchesLogisticsDimensions(currentDimensions(pkg), dimensions));
  const delivered = events.filter(event => event.outcome === 'SUCCESS').length;
  const failed = events.length - delivered;
  const created = currentPackages.filter(pkg => inLogisticsRange(pkg.createdAt, range));
  const pending = currentPackages.filter(pkg => pkg.status === PackageStatus.PENDING).length;
  const active = currentPackages.filter(pkg => ![PackageStatus.DELIVERED, PackageStatus.RETURNED].includes(pkg.status));
  const byDay = new Map<string, { date: string; total: number; delivered: number; failed: number }>();
  const day = (key: string) => {
    if (!byDay.has(key)) byDay.set(key, { date: key, total: 0, delivered: 0, failed: 0 });
    return byDay.get(key)!;
  };
  created.forEach(pkg => { const key = logisticsDay(pkg.createdAt); if (key) day(key).total++; });
  events.forEach(event => { const key = event.timestamp ? logisticsDay(event.timestamp) : ''; if (key) day(key)[event.outcome === 'SUCCESS' ? 'delivered' : 'failed']++; });
  const successes = events.filter(event => event.outcome === 'SUCCESS' && event.timestamp);
  const promise = (event: DeliveryEvent) => event.promisedDeliveryAt === undefined ? promisedDeadline(event.package) : event.promisedDeliveryAt;
  const estimate = (event: DeliveryEvent) => event.estimatedDeliveryAt === undefined ? validTime(event.package.estimatedDeliveryAt) : event.estimatedDeliveryAt;
  const punctual = successes.filter(event => promise(event));
  const estimated = successes.filter(event => estimate(event));
  const delays = successes.flatMap(event => {
    const pkg = event.package;
    const start = validTime((pkg.movements || []).find(m => m.action === 'COLLECTED')?.timestamp) || validTime(pkg.createdAt);
    if (!start) return [];
    const hours = (Date.parse(event.timestamp!) - Date.parse(start)) / 3_600_000;
    return hours >= 0 ? [hours] : [];
  });
  return {
    total: created.length, delivered, failed, resolved: events.length,
    deliveryRate: successRate(delivered, failed), pending,
    inDelivery: currentPackages.filter(pkg => pkg.status === PackageStatus.IN_DELIVERY).length,
    workInProgress: active.length, undatedOutcomes: packages.flatMap(deliveryEvents).filter(event => !event.timestamp && matchesLogisticsDimensions(eventDimensions(event), dimensions)).length,
    punctualityRate: punctual.length ? 100 * punctual.filter(event => Date.parse(event.timestamp!) <= Date.parse(promise(event)!)).length / punctual.length : null,
    etaAdherenceRate: estimated.length ? 100 * estimated.filter(event => Date.parse(event.timestamp!) <= Date.parse(estimate(event)!)).length / estimated.length : null,
    avgDelayHours: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    events, created,
  };
}
