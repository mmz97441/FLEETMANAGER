/**
 * RAPPORTS CLIENT
 *
 * Génère des rapports de livraison exportables pour le client expéditeur :
 * - Excel (.xlsx) : feuille synthèse + feuille détail (données exploitables)
 * - PDF imprimable : ouvre une version mise en page, "Enregistrer en PDF"
 *
 * Sans dépendance ajoutée : xlsx (déjà utilisé pour l'import) + impression navigateur.
 */
import * as XLSX from 'xlsx';
import { Package, PackageStatus, PackageMovement } from '../types';

export interface ReportSummary {
  total: number;
  delivered: number;
  failed: number;
  inProgress: number;
  pending: number;
  deliveryRate: number;       // %
  avgDelayHours: number | null; // délai moyen import → livraison
}

const deliveredMovement = (p: Package): PackageMovement | undefined =>
  (p.movements || []).filter(m => m.action === 'DELIVERED').slice(-1)[0];

const firstTimestamp = (p: Package): string | undefined =>
  (p.movements || [])[0]?.timestamp || p.createdAt;

export const buildReportSummary = (packages: Package[]): ReportSummary => {
  const total = packages.length;
  const delivered = packages.filter(p => p.status === PackageStatus.DELIVERED).length;
  const failed = packages.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length;
  const pending = packages.filter(p => p.status === PackageStatus.PENDING).length;
  const inProgress = total - delivered - failed - pending;

  // Délai moyen (heures) entre 1er mouvement et livraison, sur les colis livrés
  const delays: number[] = [];
  for (const p of packages) {
    const dm = deliveredMovement(p);
    const start = firstTimestamp(p);
    if (dm && start) {
      const h = (new Date(dm.timestamp).getTime() - new Date(start).getTime()) / 3_600_000;
      if (h >= 0 && h < 24 * 30) delays.push(h); // ignore valeurs aberrantes
    }
  }
  const avgDelayHours = delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10 : null;

  return {
    total,
    delivered,
    failed,
    inProgress: Math.max(0, inProgress),
    pending,
    deliveryRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
    avgDelayHours
  };
};

const fmtDate = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

interface ReportRow {
  colis: string;
  commande: string;
  destinataire: string;
  adresse: string;
  cp: string;
  ville: string;
  zone: string;
  statut: string;
  dateLivraison: string;
  receptionnaire: string;
}

const buildRows = (packages: Package[]): ReportRow[] =>
  packages
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .map(p => {
      const dm = deliveredMovement(p);
      return {
        colis: p.externalId || p.barcode || p.orderNumber || '',
        commande: p.orderNumber || '',
        destinataire: p.contactName || '',
        adresse: p.address || '',
        cp: p.postalCode || '',
        ville: p.city || '',
        zone: String(p.zone || ''),
        statut: String(p.status || ''),
        dateLivraison: p.status === PackageStatus.DELIVERED ? fmtDate(dm?.timestamp) : '',
        receptionnaire: p.pod?.recipientName || ''
      };
    });

/** Export Excel : synthèse + détail. */
export const exportReportExcel = (packages: Package[], clientName: string, periodLabel: string): void => {
  const s = buildReportSummary(packages);
  const rows = buildRows(packages);

  const summaryAoa = [
    ['Rapport de livraison'],
    ['Client', clientName],
    ['Période', periodLabel],
    ['Généré le', fmtDate(new Date().toISOString())],
    [],
    ['Total colis', s.total],
    ['Livrés', s.delivered],
    ['Échecs / retours', s.failed],
    ['En cours', s.inProgress],
    ['En attente', s.pending],
    ['Taux de livraison', `${s.deliveryRate}%`],
    ['Délai moyen (livraison)', s.avgDelayHours != null ? `${s.avgDelayHours} h` : 'n/a'],
  ];

  const detailAoa = [
    ['N° Colis', 'N° Commande', 'Destinataire', 'Adresse', 'CP', 'Ville', 'Zone', 'Statut', 'Date livraison', 'Réceptionné par'],
    ...rows.map(r => [r.colis, r.commande, r.destinataire, r.adresse, r.cp, r.ville, r.zone, r.statut, r.dateLivraison, r.receptionnaire])
  ];

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [{ wch: 24 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Synthèse');

  const wsDetail = XLSX.utils.aoa_to_sheet(detailAoa);
  wsDetail['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 26 }, { wch: 30 }, { wch: 8 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Détail colis');

  const safe = (clientName || 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  XLSX.writeFile(wb, `rapport-livraison-${safe}-${new Date().toISOString().slice(0, 10)}.xlsx`);
};

const esc = (v: string): string =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rapport imprimable (→ Enregistrer en PDF via la boîte d'impression). */
export const printReportPDF = (packages: Package[], clientName: string, periodLabel: string): void => {
  const s = buildReportSummary(packages);
  const rows = buildRows(packages);

  const statusColor = (st: string) =>
    st === 'Livré' ? '#16a34a' : (st === 'Échec' || st === 'Retourné') ? '#dc2626' : '#2563eb';

  const rowsHtml = rows.map(r => `
    <tr>
      <td class="mono">${esc(r.colis)}</td>
      <td class="mono">${esc(r.commande)}</td>
      <td>${esc(r.destinataire)}</td>
      <td>${esc(r.cp)} ${esc(r.ville)}</td>
      <td style="color:${statusColor(r.statut)};font-weight:600">${esc(r.statut)}</td>
      <td>${esc(r.dateLivraison)}</td>
      <td>${esc(r.receptionnaire)}</td>
    </tr>`).join('');

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <title>Rapport de livraison — ${esc(clientName)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Helvetica, Arial, sans-serif; color: #1e293b; margin: 32px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
      .cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
      .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; min-width: 120px; }
      .card .n { font-size: 22px; font-weight: 800; }
      .card .l { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
      .rate { color: ${s.deliveryRate >= 95 ? '#16a34a' : s.deliveryRate >= 80 ? '#d97706' : '#dc2626'}; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { text-align: left; background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 6px 8px; color: #475569; }
      td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
      .mono { font-family: 'Courier New', monospace; }
      .foot { margin-top: 20px; font-size: 10px; color: #94a3b8; }
      @media print { body { margin: 12mm; } .noprint { display: none; } }
    </style></head><body>
    <h1>Rapport de livraison</h1>
    <div class="sub"><b>${esc(clientName)}</b> · ${esc(periodLabel)} · généré le ${esc(fmtDate(new Date().toISOString()))}</div>
    <div class="cards">
      <div class="card"><div class="n">${s.total}</div><div class="l">Colis</div></div>
      <div class="card"><div class="n" style="color:#16a34a">${s.delivered}</div><div class="l">Livrés</div></div>
      <div class="card"><div class="n" style="color:#dc2626">${s.failed}</div><div class="l">Échecs / retours</div></div>
      <div class="card"><div class="n" style="color:#2563eb">${s.inProgress}</div><div class="l">En cours</div></div>
      <div class="card"><div class="n rate">${s.deliveryRate}%</div><div class="l">Taux livraison</div></div>
      <div class="card"><div class="n">${s.avgDelayHours != null ? s.avgDelayHours + ' h' : 'n/a'}</div><div class="l">Délai moyen</div></div>
    </div>
    <table>
      <thead><tr><th>N° Colis</th><th>N° Commande</th><th>Destinataire</th><th>Ville</th><th>Statut</th><th>Livré le</th><th>Réceptionné par</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="foot">FleetGenius / DELIVREX — Rapport généré automatiquement. ${rows.length} colis.</div>
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
    </body></html>`;

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
};
