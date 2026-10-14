import * as XLSX from 'xlsx';
import { Package, PackageStatus } from '../types';
import { summarizeLogistics, formatLogisticsTimestamp, logisticsDay, eventDimensions, currentDimensions, matchesLogisticsDimensions,
  type LogisticsRange, type LogisticsDimensions } from '../services/logisticsMetrics';
import { escapeHtml } from './html';

export interface ReportSummary {
  total: number; delivered: number; failed: number; inProgress: number; pending: number;
  deliveryRate: number | null; avgDelayHours: number | null;
}
export function buildReportSummary(packages: Package[], range?: LogisticsRange, dimensions?: LogisticsDimensions): ReportSummary {
  const m = summarizeLogistics(packages, range, dimensions);
  return { total: m.total, delivered: m.delivered, failed: m.failed,
    inProgress: Math.max(0, m.workInProgress - m.pending), pending: m.pending,
    deliveryRate: m.resolved ? Math.round(m.deliveryRate) : null,
    avgDelayHours: m.avgDelayHours === null ? null : Math.round(m.avgDelayHours * 10) / 10 };
}
const reference = (pkg: Package) => pkg.externalId || pkg.barcode || pkg.orderNumber || pkg.id;
/** One row per parcel/attempt. Current package state is intentionally a separate
 * table so a later redelivery cannot rewrite a previous period's failure. */
export function buildClientReport(packages: Package[], range?: LogisticsRange, dimensions?: LogisticsDimensions) {
  const metrics = summarizeLogistics(packages, range, dimensions);
  const attempts = metrics.events.map(event => {
    const pkg = event.package, destination = event.destination, proof = event.proof;
    return {
      'N° Colis': reference(pkg), 'N° Commande': pkg.orderNumber || '', 'Votre référence': pkg.clientReference || '',
      'Tentative': event.id, 'Résultat': event.outcome === 'SUCCESS' ? 'Livré' : 'Échec',
      'Date terrain · La Réunion': formatLogisticsTimestamp(event.timestamp),
      'Destinataire de la tentative': destination?.contactName || 'Historique non renseigné',
      'Adresse de la tentative': destination ? [destination.address, destination.postalCode, destination.city].filter(Boolean).join(', ') : 'Historique non renseigné',
      'Zone de la tentative': eventDimensions(event).zone,
      'Étage': destination?.floor ?? '', 'Créneau': destination?.timeWindowStart || destination?.timeWindowEnd ? `${destination.timeWindowStart || '—'} – ${destination.timeWindowEnd || '—'}` : '',
      'Motif': event.reason || proof?.failureReason || '', 'Détails': event.notes || proof?.failureNotes || '',
      'Réceptionné par': event.outcome === 'SUCCESS' ? proof?.recipientName || '' : '',
      'État de la marchandise': proof?.merchandiseGoodCondition === true ? 'Bon état' : proof?.merchandiseGoodCondition === false ? 'Réserves émises' : 'Non renseigné',
      'Réserves': proof?.reservesNote || '',
      'Preuve': proof ? 'Disponible' : pkg.deliveryAttempts?.some(attempt => attempt.id === event.id) ? 'En cours de transmission' : 'Historique indisponible',
    };
  });
  const current = packages.filter(pkg => matchesLogisticsDimensions(currentDimensions(pkg), dimensions) &&
    (metrics.created.includes(pkg) || ![PackageStatus.DELIVERED, PackageStatus.RETURNED].includes(pkg.status))).map(pkg => ({
      'N° Colis': reference(pkg), 'N° Commande': pkg.orderNumber || '', 'Votre référence': pkg.clientReference || '',
      'Destinataire actuel': pkg.contactName || '', 'Adresse actuelle': [pkg.address, pkg.postalCode, pkg.city].filter(Boolean).join(', '),
      'Zone actuelle': pkg.zone || '', 'Statut actuel': pkg.status,
      'Créé le · La Réunion': formatLogisticsTimestamp(pkg.createdAt),
      'À examiner': pkg.pickupMissing ? 'Colis absent à l’enlèvement' : pkg.returnDisposition === 'AWAITING_DECISION' ? 'Retour au dépôt — décision attendue' : '',
  }));
  return { summary: buildReportSummary(packages, range, dimensions), attempts, current, undatedOutcomes: metrics.undatedOutcomes };
}
const tableData = (rows: Record<string, unknown>[], emptyColumns: string[]) => {
  const columns = rows.length ? Object.keys(rows[0]) : emptyColumns;
  return [columns, ...rows.map(row => columns.map(column => row[column] ?? ''))];
};
function summaryRows(report: ReturnType<typeof buildClientReport>, clientName: string, periodLabel: string, dimensions?: LogisticsDimensions) {
  const s = report.summary;
  return [
    ['Rapport de livraison'], ['Client', clientName], ['Période', periodLabel],
    ['Destinataire filtré', dimensions?.pharmacy || 'Tous'], ['Zone filtrée', dimensions?.zone || 'Toutes'],
    ['Généré le · La Réunion', formatLogisticsTimestamp(new Date().toISOString())],
    ['Périmètre', 'Créations et tentatives de la période ; colis à traiter toutes dates. Destinations historiques pour les tentatives, actuelles pour les encours.'],
    ['Colis créés', s.total], ['Tentatives livrées', s.delivered], ['Tentatives en échec', s.failed],
    ['En cours · toutes dates', s.inProgress], ['En attente · toutes dates', s.pending],
    ['Succès / tentatives décidées', s.deliveryRate === null ? 'Non mesurable' : `${s.deliveryRate}%`],
    ['Délai moyen', s.avgDelayHours === null ? 'Non mesurable' : `${s.avgDelayHours} h`],
    ['Résultats sans date fiable', report.undatedOutcomes],
  ];
}
export function exportReportExcel(packages: Package[], clientName: string, periodLabel: string, range?: LogisticsRange, dimensions?: LogisticsDimensions): void {
  const report = buildClientReport(packages, range, dimensions);
  const workbook = XLSX.utils.book_new();
  for (const [title, values] of [
    ['Synthèse', summaryRows(report, clientName, periodLabel, dimensions)],
    ['Tentatives de la période', tableData(report.attempts, ['N° Colis', 'Résultat', 'Date terrain · La Réunion'])],
    ['Situation actuelle', tableData(report.current, ['N° Colis', 'Statut actuel'])],
  ] as Array<[string, unknown[][]]>) {
    const sheet = XLSX.utils.aoa_to_sheet(values); sheet['!cols'] = values[0].map(() => ({ wch: 28 }));
    XLSX.utils.book_append_sheet(workbook, sheet, title);
  }
  const safe = (clientName || 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  XLSX.writeFile(workbook, `rapport-livraison-${safe}-${logisticsDay(new Date())}.xlsx`);
}
export function buildClientReportHTML(packages: Package[], clientName: string, periodLabel: string, range?: LogisticsRange, dimensions?: LogisticsDimensions): string {
  const report = buildClientReport(packages, range, dimensions);
  const table = (rows: unknown[][]) => `<table>${rows.map((row, i) => `<tr>${row.map(cell => `<${i ? 'td' : 'th'}>${escapeHtml(String(cell ?? ''))}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table>`;
  const attemptRows = report.attempts.map(row => ({ 'Colis': row['N° Colis'], 'Commande / votre référence': [row['N° Commande'], row['Votre référence']].filter(Boolean).join(' / '),
    'Résultat / date Réunion': `${row['Résultat']} · ${row['Date terrain · La Réunion']}`,
    'Destinataire / adresse lors de la tentative': `${row['Destinataire de la tentative']} · ${row['Adresse de la tentative']}`,
    'Motif / détails': [row['Motif'], row['Détails']].filter(Boolean).join(' · '),
    'Réception / réserves': [row['Réceptionné par'], row['État de la marchandise'], row['Réserves']].filter(Boolean).join(' · '), 'Preuve': row['Preuve'] }));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport de livraison — ${escapeHtml(clientName)}</title>
    <style>body{font:12px Arial,sans-serif;color:#1e293b;margin:24px}h1{font-size:22px}h2{font-size:17px;margin-top:24px}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#f1f5f9}tr{break-inside:avoid}.note{color:#475569}@media print{@page{size:landscape;margin:12mm}.print{display:none}}</style></head>
    <body><button class="print" onclick="window.print()">Imprimer / enregistrer en PDF</button><h1>Rapport de livraison</h1>
    ${table(summaryRows(report, clientName, periodLabel, dimensions))}
    <h2>Tentatives de la période</h2>${attemptRows.length ? table(tableData(attemptRows, [])) : '<p>Aucune tentative décidée sur ce périmètre.</p>'}
    <h2>Situation actuelle</h2><p class="note">Colis créés sur la période et colis restant à traiter, toutes dates. Ces statuts actuels ne remplacent pas les résultats historiques ci-dessus.</p>
    ${report.current.length ? table(tableData(report.current, [])) : '<p>Aucun colis sur ce périmètre.</p>'}
    <p class="note">Heures terrain à La Réunion. Les résultats sans date fiable sont inclus uniquement dans la période « Tout ».</p></body></html>`;
}
export function printReportPDF(packages: Package[], clientName: string, periodLabel: string, range?: LogisticsRange, dimensions?: LogisticsDimensions, target?: Window): void {
  const win = target || window.open('', '_blank');
  if (!win) throw new Error('Le navigateur a bloqué le rapport. Autorisez les fenêtres pour imprimer ou enregistrer le PDF.');
  win.document.write(buildClientReportHTML(packages, clientName, periodLabel, range, dimensions)); win.document.close();
}
