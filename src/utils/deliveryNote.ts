/**
 * BON DE LIVRAISON (BL)
 *
 * Génère un bon de livraison imprimable / téléchargeable (PDF via la boîte
 * d'impression du navigateur) pour un POINT DE LIVRAISON — c'est-à-dire tous
 * les colis d'une même adresse regroupés, afin de sécuriser le NOMBRE de colis
 * remis au destinataire (cf. règle de regroupement par adresse+CP+ville+tél).
 *
 * Le document est auto-rempli depuis les données (colis + preuve de livraison).
 * La ZONE PREUVE (chauffeur, heure, GPS, signature, photos) est figée.
 * Seuls deux champs libres sont éditables à la demande AVANT impression :
 * la référence / n° de chantier et les réserves à la livraison (contenteditable).
 *
 * Aucune dépendance ajoutée : HTML + window.print (comme clientReport.ts).
 */
import { Package, PackageStatus, ProofOfDelivery, DeliveryLocation } from '../types';
// Source de vérité UNIQUE du « même point de livraison ? » (adresse OU tél+CP).
import { sameDeliveryPoint } from './address';
import { localDatePart } from './date';

// ---------------------------------------------------------------------------
// Regroupement par point de livraison : on délègue à sameDeliveryPoint
// (utils/address.ts) pour que le BL groupe EXACTEMENT comme le dispatch et le
// chauffeur (adresse OU tél+CP, sans n° de commande ni nom).
// ---------------------------------------------------------------------------

/**
 * Renvoie les colis du MÊME POINT DE LIVRAISON (pharmacie) que `pkg`, et du
 * MÊME JOUR d'envoi. Le BL est donc « un BL par pharmacie » (pour cet envoi),
 * pas un BL fourre-tout de toutes les livraisons de la journée ni de l'historique
 * complet de la pharmacie.
 */
export const packagesAtSamePoint = (pkg: Package, all: Package[]): Package[] => {
  const day = localDatePart(pkg.createdAt || '');
  return all.filter(p => {
    if (p.id === pkg.id) return true;
    const sameDay = !day || localDatePart(p.createdAt || '') === day;
    return sameDeliveryPoint(pkg, p) && sameDay;
  });
};

// ---------------------------------------------------------------------------
// Helpers de formatage
// ---------------------------------------------------------------------------
const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtDateTime = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

/** N° de BL déterministe : BL-AAAAMMJJ-<commande la plus ancienne>. */
const buildBlNumber = (pkgs: Package[]): string => {
  const first = [...pkgs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )[0];
  const ref = (first?.orderNumber || first?.externalId || first?.id || '').toString().slice(-8);
  const d = new Date(first?.createdAt || Date.now());
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
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

  // POD de référence : celle du 1er colis livré (chauffeur/heure/signature communs au point).
  const delivered = pkgs.filter(p => p.status === PackageStatus.DELIVERED && p.pod);
  const pod: ProofOfDelivery | undefined = delivered[0]?.pod;
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
        <td>${p.comment ? esc(p.comment) : '<span style="color:#94a3b8">—</span>'}</td>
        <td style="text-align:right">${p.weight ? esc(p.weight) + ' kg' : '—'}</td>
        <td style="color:${st.color};font-weight:600;text-align:center">${esc(st.label)}</td>
      </tr>`;
  }).join('');

  // Bloc preuve (figé) — visible seulement si une POD existe.
  const locLabel = pod?.deliveryLocation
    ? (Object.values(DeliveryLocation).includes(pod.deliveryLocation) ? pod.deliveryLocation : String(pod.deliveryLocation))
    : '—';
  const gps = pod?.coordinates
    ? `${pod.coordinates.lat.toFixed(5)}, ${pod.coordinates.lng.toFixed(5)}`
    : '—';
  const mapsUrl = pod?.coordinates
    ? `https://www.google.com/maps?q=${pod.coordinates.lat},${pod.coordinates.lng}`
    : '';

  const photosHtml = (pod?.photoUrls || [])
    .slice(0, 4)
    .map(u => `<img class="photo" src="${esc(u)}" alt="photo livraison" />`)
    .join('');

  const proofBlock = pod ? `
    <div class="section">
      <div class="section-title">Preuve de livraison (générée automatiquement — non modifiable)</div>
      <table class="kv">
        <tr><td class="k">Livré le</td><td class="v"><b>${esc(fmtDateTime(pod.timestamp))}</b></td>
            <td class="k">Réceptionné par</td><td class="v">${esc(pod.recipientName || '—')}</td></tr>
        <tr><td class="k">Chauffeur</td><td class="v">${esc(pod.driverName || '—')}</td>
            <td class="k">Lieu de remise</td><td class="v">${esc(locLabel)}</td></tr>
        <tr><td class="k">Véhicule</td><td class="v">${esc(pod.vehiclePlate || '—')}</td>
            <td class="k">Position GPS</td><td class="v">${mapsUrl ? `<a href="${esc(mapsUrl)}">${esc(gps)}</a>` : esc(gps)}</td></tr>
        ${pod.notes ? `<tr><td class="k">Note</td><td class="v" colspan="3">${esc(pod.notes)}</td></tr>` : ''}
      </table>
      <div class="proofs">
        ${pod.signatureUrl ? `<div class="sig-wrap"><div class="proof-label">Signature du destinataire</div><img class="sig" src="${esc(pod.signatureUrl)}" alt="signature" /></div>` : ''}
        ${photosHtml ? `<div class="photos-wrap"><div class="proof-label">Photos</div><div class="photos">${photosHtml}</div></div>` : ''}
      </div>
    </div>` : `
    <div class="section pending">
      <div class="section-title">Preuve de livraison</div>
      <p style="color:#b45309;margin:6px 0 0;font-size:12px">⏳ Livraison non finalisée — la preuve (signature, heure, GPS) apparaîtra ici une fois les colis livrés.</p>
    </div>`;

  // Section « état de la marchandise » : figée depuis la POD si livré, sinon éditable (bon de préparation)
  const podHasCondition = !!pod && typeof pod.merchandiseGoodCondition === 'boolean';
  const merchandiseSection = podHasCondition
    ? `
    <div class="section">
      <div class="section-title">État de la marchandise à la réception</div>
      ${pod!.merchandiseGoodCondition
        ? `<div class="checkline"><span class="ro-check">✓</span><span>Marchandises reçues en <b>bon état</b>, sans réserve <span class="hint">(confirmé à la livraison)</span></span></div>`
        : `<div class="reserve-label">⚠️ Réserves émises par le destinataire à la réception :</div>
           <div class="reserve-readonly">${esc(pod!.reservesNote || 'Réserves signalées.')}</div>`}
      <div class="signbox">
        <div class="box"><div class="lbl">Signature expéditeur / cachet</div></div>
        <div class="box"><div class="lbl">Signature destinataire</div></div>
      </div>
    </div>`
    : `
    <div class="section">
      <div class="section-title">État de la marchandise à la réception</div>
      <label class="checkline">
        <input type="checkbox" id="goodState" checked onchange="toggleReserve()">
        <span>Marchandises reçues en <b>bon état</b>, sans réserve. <span class="hint noprint">(décochez pour émettre des réserves)</span></span>
      </label>
      <div id="reserveBlock" class="reserve-block" style="display:none">
        <div class="reserve-label">⚠️ Réserves / commentaire du destinataire :</div>
        <div class="editable" contenteditable="true" style="min-height:40px" data-placeholder="Précisez : colis manquant, emballage endommagé, contenu non conforme…"></div>
      </div>
      <div class="signbox">
        <div class="box"><div class="lbl">Signature expéditeur / cachet</div></div>
        <div class="box"><div class="lbl">Signature destinataire</div></div>
      </div>
    </div>
    <script>
      function toggleReserve(){
        var cb = document.getElementById('goodState');
        var block = document.getElementById('reserveBlock');
        block.style.display = cb.checked ? 'none' : 'block';
      }
    </script>`;

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
      .section {border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 14px; }
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
      <span>${podHasCondition ? '📄 Bon de livraison prêt — imprimez ou enregistrez en PDF.' : '💡 Décochez « bon état » pour saisir des réserves, puis imprimez ou enregistrez en PDF.'}</span>
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
        <h3>Destinataire (livré à)</h3>
        <div class="name">${esc(dest.contactName)}</div>
        <div>${esc(dest.address)}</div>
        <div>${esc(dest.postalCode)} ${esc(dest.city)}</div>
        ${dest.contactPhone ? `<div>Tél : ${esc(dest.contactPhone)}</div>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Colis livrés à ce point &nbsp; <span class="count-badge">${deliveredCount} / ${pkgs.length} colis</span></div>
      <div class="table-wrap">
      <table class="pkgs">
        <thead><tr><th>#</th><th>N° Colis</th><th>N° Commande</th><th>Remarque client</th><th style="text-align:right">Poids</th><th style="text-align:center">Statut</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="4">TOTAL</td><td style="text-align:right">${totalWeight ? totalWeight.toFixed(1) + ' kg' : '—'}</td><td style="text-align:center">${pkgs.length} colis</td></tr></tfoot>
      </table>
      </div>
    </div>

    ${proofBlock}

    ${merchandiseSection}

    <div class="mentions">
      Le présent bon de livraison atteste la remise des colis listés ci-dessus. La zone « Preuve de livraison »
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
  if (win) {
    win.document.write(html);
    win.document.close();
  }
};
