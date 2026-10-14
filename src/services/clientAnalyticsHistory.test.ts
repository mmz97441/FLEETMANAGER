import { afterEach, expect, it, vi } from 'vitest';
import { Package, PackageStatus, ProofOfDelivery, Zone } from '../types';
import { computeClientMetrics } from './clientMetrics';
import { getClientInsights } from './clientInsights';
import { buildClientReport, buildClientReportHTML, buildReportSummary, exportReportExcel } from '../utils/clientReport';
import { UNKNOWN_ZONE } from './logisticsMetrics';
import * as XLSX from 'xlsx';
const saved = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock('xlsx', async original => ({ ...await original<typeof import('xlsx')>(), writeFile: saved.write }));
const A = { contactName: 'Pharmacie A', address: '1 rue A', city: 'Saint-Paul', postalCode: '97460', zone: 'OUEST' };
const B = { contactName: 'Pharmacie B', address: '2 rue B', city: 'Saint-Denis', postalCode: '97400', zone: 'NORD' };
const proof = (id: string, type: 'SUCCESS' | 'FAILURE', timestamp: string, destination: typeof A): ProofOfDelivery => ({
  packageId: 'p', missionId: id, stopId: 's', driverId: 'd', driverName: 'Chauffeur', vehicleId: 'v', vehiclePlate: 'TEST', timestamp, destination, type, photoUrls: [], coordinates: null,
  ...(type === 'SUCCESS' ? { recipientName: 'Mme Réception', merchandiseGoodCondition: false, reservesNote: '2 boîtes écrasées' } : { failureReason: 'Destinataire absent', failureNotes: 'Porte fermée' }),
});
const failed = proof('old', 'FAILURE', '2026-10-01T05:00:00Z', A), delivered = proof('new', 'SUCCESS', '2026-10-14T05:00:00Z', B);
const pkg: Package = { id: 'p', externalId: 'BR-000001', orderNumber: 'ORDER-42', clientReference: 'MON-42', clientId: 'client', clientName: 'Entreprise', importBatchId: 'batch', ...B, zone: Zone.NORD,
  createdAt: '2026-09-01T05:00:00Z', updatedAt: '2026-10-14T06:00:00Z', status: PackageStatus.DELIVERED, movements: [], serviceTime: 5,
  deliveryAttempts: [failed, delivered].map(proof => ({ id: `${proof.missionId}_s`, missionId: proof.missionId, stopId: 's', driverId: 'd', recordedAt: proof.timestamp, outcome: proof.type!, destination: proof.destination, failureReason: proof.failureReason, failureNotes: proof.failureNotes || undefined, proof })), pod: delivered, failurePod: failed };
afterEach(() => { vi.useRealTimers(); saved.write.mockClear(); });
it('filters past attempts by the immutable destination and current work by its current destination', () => {
  const pending = { ...pkg, status: PackageStatus.AT_HUB, returnDisposition: 'AWAITING_DECISION' as const };
  const a = computeClientMetrics([pending], { period: 'all', pharmacy: 'Pharmacie A' });
  const b = computeClientMetrics([pending], { period: 'all', pharmacy: 'Pharmacie B' });
  expect(a).toMatchObject({ total: 0, delivered: 0, failed: 1, resolved: 1, workInProgress: 0 });
  expect(b).toMatchObject({ total: 1, delivered: 1, failed: 0, resolved: 1, workInProgress: 1 });
  expect(computeClientMetrics([pkg], { period: 'all', zone: 'OUEST' }).failed).toBe(1);
});
it('does not invent a historical zone from the corrected current zone', () => {
  const old = { ...pkg, deliveryAttempts: pkg.deliveryAttempts!.map(attempt => ({ ...attempt, destination: { ...attempt.destination!, zone: undefined }, proof: undefined })), pod: undefined, failurePod: undefined };
  expect(computeClientMetrics([old], { period: 'all', zone: 'NORD' }).resolved).toBe(0);
  expect(computeClientMetrics([old], { period: 'all', zone: UNKNOWN_ZONE }).resolved).toBe(2);
});
it('shows no-success-sample and unresolved old work explicitly, including pickup exceptions', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
  const pending = { ...pkg, status: PackageStatus.PENDING, deliveryAttempts: [], pod: undefined, failurePod: undefined, createdAt: '2026-08-01T05:00:00Z',
    pickupMissing: { missionId: 'm', stopId: 's', driverId: 'd', recordedAt: '2026-10-14T05:00:00Z' } };
  const insights = getClientInsights([pending]);
  expect(insights.some(item => item.kind === 'positive')).toBe(false);
  expect(insights.map(item => item.title)).toEqual(['1 colis à examiner', '1 colis à traiter']);
  expect(buildReportSummary([pending]).deliveryRate).toBeNull();
});
it('uses the same period and historical recipient filters for insights and metrics', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
  expect(getClientInsights([pkg], { period: '30d', pharmacy: 'Pharmacie A' }).some(item => item.id === 'delivery-rate-low')).toBe(true);
  expect(getClientInsights([pkg], { period: '7d', pharmacy: 'Pharmacie A' }).some(item => item.id === 'delivery-rate-low')).toBe(false);
  expect(getClientInsights([pkg], { period: '7d', pharmacy: 'Pharmacie B' }).find(item => item.id === 'all-good')?.detail).toContain('100%');
});
it('exports the failed period at A without replacing it with the later success at B', () => {
  const report = buildClientReport([pkg], { start: '2026-10-01', end: '2026-10-01' });
  expect(report.summary).toMatchObject({ delivered: 0, failed: 1, deliveryRate: 0 });
  expect(report.attempts).toHaveLength(1);
  expect(report.attempts[0]).toMatchObject({ 'Résultat': 'Échec', 'Destinataire de la tentative': 'Pharmacie A', 'Motif': 'Destinataire absent', 'Date terrain · La Réunion': '01/10/2026 09:00', 'Votre référence': 'MON-42' });
  const html = buildClientReportHTML([pkg], 'Client', '1 octobre', { start: '2026-10-01', end: '2026-10-01' });
  expect(html).toContain('Porte fermée'); expect(html).not.toContain('14/10/2026 09:00'); expect(html).not.toContain('Mme Réception');
});
it('produces an actual Excel workbook with distinct attempt and current-state sheets, preserving reserves and all cartons', () => {
  const packages = [pkg, { ...pkg, id: 'other', externalId: 'EXP-000002', status: PackageStatus.FAILED, deliveryAttempts: [pkg.deliveryAttempts![0]], pod: undefined }];
  exportReportExcel(packages, 'Client', 'Tout');
  const workbook = saved.write.mock.calls[0][0] as XLSX.WorkBook;
  expect(workbook.SheetNames).toEqual(['Synthèse', 'Tentatives de la période', 'Situation actuelle']);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Tentatives de la période']);
  expect(rows).toHaveLength(3); expect(rows.filter(row => row.Résultat === 'Échec')).toHaveLength(2);
  expect(rows.find(row => row.Résultat === 'Livré')).toMatchObject({ Réserves: '2 boîtes écrasées', Preuve: 'Disponible' });
});
it('reports missing proof separately from a decided successful attempt, without inventing a photo', () => {
  const pending = { ...pkg, deliveryAttempts: [{ ...pkg.deliveryAttempts![1], proof: undefined }], pod: undefined, failurePod: undefined };
  const report = buildClientReport([pending]); expect(report.summary.delivered).toBe(1); expect(report.attempts[0].Preuve).toBe('En cours de transmission');
});
