import type { ProofOfDelivery } from '../types';
import { formatLogisticsTimestamp } from '../services/logisticsMetrics';
import { escapeHtml, safeImageUrl } from './html';

export interface ProofPackageInfo {
  orderNumber: string;
  parcelReference?: string;
  clientReference?: string;
  contactName: string;
  address: string;
  city: string;
}
export interface ProofPresentation {
  title: string;
  failure: boolean;
  timestamp: string;
  facts: Array<{ label: string; value: string; href?: string }>;
  photos: string[];
  signature?: string;
}
/** The screen and its printable evidence share the same immutable facts. */
export function presentProof(pod: ProofOfDelivery, info?: ProofPackageInfo, showDriverInfo = true): ProofPresentation {
  const failure = pod.type === 'FAILURE';
  const destination = pod.destination || info;
  const facts: ProofPresentation['facts'] = [];
  const add = (label: string, value: unknown) => { if (value !== undefined && value !== null && String(value).trim()) facts.push({ label, value: String(value) }); };
  add('Colis', info?.parcelReference || pod.packageId);
  add('Commande', info?.orderNumber);
  add('Votre référence', info?.clientReference);
  add('Destinataire', destination?.contactName);
  add(pod.destination ? 'Adresse lors de la tentative' : 'Adresse actuelle (preuve historique sans adresse figée)',
    destination ? [destination.address, pod.destination?.postalCode, destination.city].filter(Boolean).join(', ') : undefined);
  add('Étage', pod.destination?.floor);
  if (pod.destination?.timeWindowStart || pod.destination?.timeWindowEnd) add('Créneau demandé', `${pod.destination.timeWindowStart || '—'} – ${pod.destination.timeWindowEnd || '—'}`);
  add('Date et heure · La Réunion', formatLogisticsTimestamp(pod.timestamp));
  if (failure) { add('Motif', pod.failureReason || 'Motif non renseigné'); add('Détail de la tentative', pod.failureNotes); }
  else { add('Réceptionné par', pod.recipientName || 'Non renseigné'); add('Lieu de remise', pod.deliveryLocation); }
  if (typeof pod.merchandiseGoodCondition === 'boolean') add('État de la marchandise', pod.merchandiseGoodCondition ? 'Marchandises reçues en bon état' : 'Réserves émises à la réception');
  add('Réserves', pod.reservesNote);
  add('Notes', pod.notes);
  const coordinates = pod.coordinates;
  if (coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)
    && Math.abs(coordinates.lat) <= 90 && Math.abs(coordinates.lng) <= 180 && (coordinates.lat !== 0 || coordinates.lng !== 0)) {
    facts.push({ label: 'Position GPS', value: `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`,
      href: `https://www.google.com/maps?q=${coordinates.lat},${coordinates.lng}` });
  } else add('Position GPS', 'Position non disponible lors de la tentative.');
  if (showDriverInfo) { add('Chauffeur', pod.driverName); add('Véhicule', pod.vehiclePlate); }
  return { title: failure ? 'Preuve de tentative non aboutie' : 'Preuve de livraison', failure,
    timestamp: formatLogisticsTimestamp(pod.timestamp), facts, photos: pod.photoUrls || [], signature: pod.signatureUrl || undefined };
}

export function proofFactsHTML(model: ProofPresentation): string {
  return `<dl>${model.facts.map(fact => `<dt>${escapeHtml(fact.label)}</dt><dd>${fact.href ? `<a href="${escapeHtml(fact.href)}" target="_blank" rel="noreferrer">${escapeHtml(fact.value)} — Voir sur la carte</a>` : escapeHtml(fact.value)}</dd>`).join('')}</dl>
    ${model.signature ? `<h3>Signature du réceptionnaire</h3><img class="signature" src="${safeImageUrl(model.signature)}" alt="Signature du réceptionnaire" />` : '<p>Pas de signature enregistrée</p>'}
    ${model.photos.length ? `<h3>Photos</h3>${model.photos.map((url, index) => `<img class="photo" src="${safeImageUrl(url)}" alt="Photo ${index + 1}" />`).join('')}` : ''}`;
}
/** Wait for evidence images before offering print; a missing photo must be visible. */
export const printWhenImagesReady = `<script>
window.addEventListener('load',function(){
 const status=document.getElementById('print-status');
 Promise.all(Array.from(document.images).map(function(img){return new Promise(function(resolve,reject){
 if(img.complete){img.naturalWidth?resolve():reject();return;}
 img.onload=resolve;img.onerror=reject;
 });})).then(function(){if(status)status.textContent='Document prêt à imprimer.';window.print();})
 .catch(function(){if(status)status.textContent='Une image de preuve ne peut pas être chargée. Vérifiez la connexion et actualisez ce document avant de l’imprimer.';});
});</script>`;
export function buildProofPrintHTML(model: ProofPresentation): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title>
    <style>body{font:14px Arial,sans-serif;max-width:800px;margin:24px auto;padding:16px}h1{font-size:22px}dt{font-weight:bold;margin-top:12px}dd{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.signature{max-width:100%;max-height:180px}.photo{max-width:100%;max-height:350px;margin:8px 0;display:block}#print-status{padding:12px;background:#fff7ed}@media print{#print-status{display:none}img{break-inside:avoid}}</style>
    </head><body><h1>${escapeHtml(model.title)}</h1><p id="print-status">Chargement des images de preuve…</p>${proofFactsHTML(model)}${printWhenImagesReady}</body></html>`;
}
