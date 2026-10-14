/**
 * BON DE LIVRAISON (BL)
 *
 * Récapitule le groupe affiché dans le portail : identité stricte du
 * destinataire et jour de création à La Réunion. Chaque colis conserve ses
 * propres dates demandées, créneaux, consignes et preuves historiques.
 */
import { Package, PackageStatus } from '../types';
import { recipientKey } from './address';
import { formatWeight } from './format';
import { deliveryEvents, formatLogisticsTimestamp, logisticsDay } from '../services/logisticsMetrics';
import { presentProof, proofFactsHTML } from './proofPresentation';
import { hasPendingDeliveryProof } from './deliveryProofState';

/** Same recipient/day group as the client list; different visits stay explicit. */
export const packagesAtSamePoint = (pkg: Package, all: Package[]): Package[] => {
  const complete = (p: Package) => p.contactName?.trim() && p.address?.trim() && p.city?.trim() && p.postalCode?.trim();
  if (!complete(pkg)) return [pkg];
  const day = logisticsDay(pkg.createdAt || '');
  const key = recipientKey(pkg);
  return [pkg, ...all.filter(p => p.id !== pkg.id && complete(p) && logisticsDay(p.createdAt || '') === day && recipientKey(p) === key)];
};

// ---------------------------------------------------------------------------
// Helpers de formatage
// ---------------------------------------------------------------------------
const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (iso?: string): string => formatLogisticsTimestamp(iso);

/** N° de BL déterministe : BL-AAAAMMJJ-<commande la plus ancienne>. */
const buildBlNumber = (pkgs: Package[]): string => {
  const first = [...pkgs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0];
  const ref = (first?.orderNumber || first?.externalId || first?.id || '').toString().slice(-8);
  const d = new Date(first?.createdAt || Date.now());
  const ymd = logisticsDay(d).replace(/-/g, '');
  return `BL-${ymd}-${ref || '0000'}`;
};

const statusLabel = (st: PackageStatus): { label: string; color: string } => {
  if (st === PackageStatus.DELIVERED) return { label: 'Livré', color: '#16a34a' };
  if (st === PackageStatus.FAILED || st === PackageStatus.RETURNED) return { label: st, color: '#dc2626' };
  return { label: st, color: '#2563eb' };
};

export interface DeliveryNoteSender {
  companyName?: string;
  email?: string;
  address?: string;      // ligne libre optionnelle
  siret?: string;        // ligne libre optionnelle
  phone?: string;        // ligne libre optionnelle
}

// ---------------------------------------------------------------------------
// Génération du HTML du BL
// ---------------------------------------------------------------------------
export const buildDeliveryNoteHTML = (
  pkgs: Package[],
  sender: DeliveryNoteSender,
  transporter = 'DELIVREX'
): string => {
  if (!pkgs.length) return '<html><body>Aucun colis</body></html>';

  const dest = pkgs[0];

  const blNumber = buildBlNumber(pkgs);
  const totalWeight = pkgs.reduce((s, p) => s + (Number(p.weight) || 0), 0);
  const deliveredCount = pkgs.filter(p => p.status === PackageStatus.DELIVERED).length;

  const rowsHtml = pkgs.map((p, i) => {
    const st = statusLabel(p.status);
    return `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td class="mono">${esc(p.externalId || p.barcode || p.orderNumber)}</td>
        <td class="mono">${esc(p.orderNumber)}</td>
        <td>${esc([p.comment, p.timeWindowStart || p.timeWindowEnd ? `Créneau ${p.timeWindowStart || '—'} – ${p.timeWindowEnd || '—'} (La Réunion)` : '', p.requestedDeliveryDate ? `Date demandée : ${p.requestedDeliveryDate}${p.requestedDeliveryTime ? ` à ${p.requestedDeliveryTime}` : ''} (La Réunion)` : ''].filter(Boolean).join(' · ')) || '—'}</td>
        <td style="text-align:right">${formatWeight(p.weight) || '—'}</td>
        <td style="color:${st.color};font-weight:600;text-align:center">${esc(st.label)}</td>
      </tr>`;
  }).join('');

  const proofBlock = pkgs.map(pkg => {
    const proofs = deliveryEvents(pkg).flatMap(event => event.proof ? [event.proof] : []);
    const info = { orderNumber: pkg.orderNumber, parcelReference: pkg.externalId || pkg.barcode || pkg.orderNumber || pkg.id,
      clientReference: pkg.clientReference, contactName: pkg.contactName, address: pkg.address, city: pkg.city };
    const pending = hasPendingDeliveryProof(pkg);
    return `<section class="section"><div class="section-title">Colis ${esc(info.parcelReference)} — preuves propres à ce colis</div>
      ${proofs.map(proof => { const model = presentProof(proof, info); return `<article><h3>${esc(model.title)}</h3>${proofFactsHTML(model)}</article>`; }).join('')}
      ${pending ? '<p>Dernière tentative enregistrée — preuve en cours de transmission.</p>' : !proofs.length ? `<p>${pkg.status === PackageStatus.DELIVERED ? 'Livraison enregistrée — preuve historique indisponible.' : 'Aucune preuve de remise enregistrée pour ce colis.'}</p>` : ''}</section>`;
  }).join('');

  const senderAddressMissing = !sender.address || !sender.address.trim();
  const senderLines = [
    sender.address || '',
    sender.siret ? `SIRET : ${sender.siret}` : '',
    sender.phone || '',
    sender.email || '',
  ].filter(Boolean).map(l => `<div>${esc(l)}</div>`).join('')
    + (senderAddressMissing ? `<div class="sender-warn">⚠️ Adresse expéditeur à compléter (espace client → Mon entreprise)</div>` : '');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(blNumber)} — ${esc(dest.contactName)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Helvetica, Arial, sans-serif; color: #1e293b; margin: 28px; font-size: 12px; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4f46e5; padding-bottom: 12px; margin-bottom: 16px; }
      .brand { font-size: 22px; font-weight: 800; color: #4f46e5; letter-spacing: -.02em; }
      .brand small { display:block; font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: .12em; text-transform: uppercase; }
      .doc { text-align: right; }
      .doc .title { font-size: 18px; font-weight: 800; }
      .doc .num { font-family: 'Courier New', monospace; font-size: 13px; color: #4f46e5; font-weight: 700; }
      .doc .date { color: #64748b; font-size: 11px; }
      .parties { display: flex; gap: 12px; margin-bottom: 16px; }
      .party { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
      .party h3 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; }
      .party .name { font-weight: 700; font-size: 13px; }
      .sender-warn { color:#b45309; font-size:10px; font-weight:700; background:#fffbeb; border:1px dashed #f59e0b; border-radius:6px; padding:3px 6px; margin-top:4px; }
      .party div { line-height: 1.45; }
      .editable { background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 6px; padding: 4px 8px; min-height: 20px; }
      .editable:focus { outline: 2px solid #f59e0b; background: #fff; }
      .editable:empty::before { content: attr(data-placeholder); color: #b45309; opacity: .7; }
      .checkline { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.4; cursor: pointer; }
      .checkline input { width: 16px; height: 16px; margin-top: 1px; accent-color: #16a34a; flex-shrink: 0; }
      .hint { color: #94a3b8; font-weight: 400; font-size: 11px; }
      .reserve-block { margin-top: 10px; }
      .reserve-label { font-size: 11px; font-weight: 700; color: #b45309; margin-bottom: 4px; }
      .reserve-readonly { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #92400e; }
      .ro-check { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; background:#16a34a; color:#fff; font-weight:800; flex-shrink:0; }
      .signature{max-width:100%;max-height:160px}dt{font-weight:bold;margin-top:8px}dd{margin:2px 0;white-space:pre-wrap;overflow-wrap:anywhere}article{border-top:1px solid #cbd5e1;padding-top:8px;margin-top:12px}.section {border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
      .section.pending { background:#fffbeb; border-color:#fde68a; }
      .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing:.06em; color:#334155; margin-bottom: 8px; }
      table.pkgs { width: 100%; border-collapse: collapse; }
      table.pkgs th { text-align: left; background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 6px 8px; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing:.04em; }
      table.pkgs td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
      table.pkgs tfoot td { font-weight: 800; border-top: 2px solid #e2e8f0; background:#f8fafc; }
      .mono { font-family: 'Courier New', monospace; }
      .count-badge { display:inline-block; background:#4f46e5; color:#fff; border-radius:999px; padding:3px 12px; font-weight:800; font-size:13px; }
      table.kv { width:100%; border-collapse: collapse; }
      table.kv td { padding: 4px 6px; vertical-align: top; }
      table.kv .k { color:#64748b; width: 15%; font-size: 10px; text-transform:uppercase; letter-spacing:.04em; }
      table.kv .v { width: 35%; font-weight: 600; }
      .proofs { display:flex; gap:16px; margin-top: 10px; flex-wrap: wrap; }
      .proof-label { font-size: 10px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; margin-bottom: 4px; }
      .sig { border:1px solid #e2e8f0; border-radius:8px; max-height: 90px; background:#fff; padding:4px; }
      .photos { display:flex; gap:6px; }
      .photo { width: 78px; height: 78px; object-fit: cover; border-radius:8px; border:1px solid #e2e8f0; }
      .signbox { display:flex; gap:12px; margin-top: 6px; }
      .signbox .box { flex:1; border:1px solid #cbd5e1; border-radius:10px; padding:10px; min-height: 90px; }
      .signbox .box .lbl { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.06em; }
      .mentions { font-size: 10px; color:#64748b; line-height:1.5; }
      .foot { margin-top: 16px; font-size: 9px; color:#94a3b8; text-align:center; border-top:1px solid #f1f5f9; padding-top:8px; }
      .toolbar { position: sticky; top:0; background:#4f46e5; color:#fff; padding:10px 14px; border-radius:10px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; }
      .toolbar button { background:#fff; color:#4f46e5; border:none; border-radius:8px; padding:8px 16px; font-weight:700; cursor:pointer; font-size:13px; }
      @media print { body { margin: 12mm; } .noprint { display: none !important; } .editable { border-color:#cbd5e1; background:#fff; } }
      /* --- Téléphone (petit écran) : phase de remplissage terrain --- */
      @media (max-width: 640px) {
        body { margin: 12px; font-size: 13px; }
        .head { flex-direction: column; gap: 8px; }
        .doc { text-align: left; }
        .parties { flex-direction: column; gap: 8px; }
        .party { padding: 12px; }
        .toolbar { flex-direction: column; gap: 10px; align-items: stretch; text-align: center; }
        .toolbar button { width: 100%; padding: 14px; font-size: 16px; }
        .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        table.pkgs { min-width: 460px; }
        table.kv td { display: block; width: 100% !important; padding: 2px 0; }
        table.kv .k { margin-top: 8px; }
        .signbox { flex-direction: column; }
        .photo { width: 72px; height: 72px; }
        .editable { min-height: 46px; font-size: 15px; padding: 10px; }
        .checkline { font-size: 15px; gap: 10px; padding: 6px 0; }
        .checkline input { width: 24px; height: 24px; }
      }
    </style></head><body>

    <div class="toolbar noprint">
      <span>📄 Chaque preuve ci-dessous concerne uniquement le colis indiqué. Les réserves enregistrées sont conservées.</span>
      <button onclick="window.print()">🖨️ Imprimer / PDF</button>
    </div>

    <div class="head">
      <div class="brand">${esc(transporter)}<small>Bon de livraison</small></div>
      <div class="doc">
        <div class="title">BON DE LIVRAISON</div>
        <div class="num">${esc(blNumber)}</div>
        <div class="date">Émis le ${esc(fmtDate(new Date().toISOString()))}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <h3>Expéditeur</h3>
        <div class="name">${esc(sender.companyName || dest.clientName)}</div>
        ${senderLines}
      </div>
      <div class="party">
        <h3>Transporteur</h3>
        <div class="name">${esc(transporter)}</div>
        <div>Transport &amp; livraison</div>
      </div>
      <div class="party">
        <h3>Destinataire actuel des colis</h3>
        <div class="name">${esc(dest.contactName)}</div>
        <div>${esc(dest.address)}</div>
        <div>${esc(dest.postalCode)} ${esc(dest.city)}</div>
        ${dest.contactPhone ? `<div>Tél : ${esc(dest.contactPhone)}</div>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Situation actuelle des colis &nbsp; <span class="count-badge">${deliveredCount} livré${deliveredCount > 1 ? 's' : ''} / ${pkgs.length} colis</span></div>
      <div class="table-wrap">
      <table class="pkgs">
        <thead><tr><th>#</th><th>N° Colis</th><th>N° Commande</th><th>Consignes / créneau</th><th style="text-align:right">Poids</th><th style="text-align:center">Statut</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="4">TOTAL</td><td style="text-align:right">${formatWeight(totalWeight) || '—'}</td><td style="text-align:center">${pkgs.length} colis</td></tr></tfoot>
      </table>
      </div>
    </div>

    ${proofBlock}


    <div class="mentions">
      Le présent document récapitule les colis listés ci-dessus. Seules leurs preuves propres attestent une tentative ou une remise ; une preuve ne s’applique pas aux autres colis du groupe. La zone « Preuve de livraison »
      (date, heure, chauffeur, véhicule, position GPS, signature et photos) est générée automatiquement par le
      système et ne peut être modifiée. Toute réserve doit être formulée au moment de la réception.
    </div>

    <div class="foot">${esc(transporter)} · ${esc(blNumber)} · Document généré automatiquement le ${esc(fmtDate(new Date().toISOString()))}</div>
    </body></html>`;
};

/** Ouvre le BL dans un nouvel onglet (impression / enregistrement PDF à la demande). */
export const openDeliveryNote = (
  pkg: Package,
  allPackages: Package[],
  sender: DeliveryNoteSender,
  transporter = 'DELIVREX'
): void => {
  const group = packagesAtSamePoint(pkg, allPackages);
  const html = buildDeliveryNoteHTML(group, sender, transporter);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Le navigateur a bloqué le bon de livraison. Autorisez les fenêtres pour ouvrir ce document.');
  win.document.write(html);
  win.document.close();
};
