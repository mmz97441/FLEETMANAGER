/**
 * PICKUP SERVICE — Gestion des enlèvements
 * 
 * Gère le workflow :
 * 1. Chauffeur scanne les colis chez le client
 * 2. Colis passent de PENDING → COLLECTED
 * 3. Manifeste d'enlèvement créé (prévu vs réel)
 * 4. Signature client uploadée
 * 5. Traçabilité complète (PackageMovement)
 */

import { db, storage } from '../firebaseConfig';
import { doc, updateDoc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { Package, PackageStatus } from '../types';
import { compressImage } from './podService';
import { reportError } from './logService';
import { cleanUndefined } from '../utils/firestore';
import { formatWeight } from '../utils/format';
import JsBarcode from 'jsbarcode';

/**
 * Rend un code-barres Code128 en image data-URI (PNG), généré AU MOMENT de la
 * création via le paquet jsbarcode local + un canvas. Avant, les étiquettes
 * chargeaient jsbarcode depuis un CDN jsdelivr et généraient les codes au
 * runtime → cassé hors-ligne et sous CSP stricte. Ici : aucune dépendance
 * réseau, l'image est déjà dans le HTML.
 */
const barcodeDataUri = (code: string): string => {
  if (typeof document === 'undefined' || !code) return '';
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, code, {
      format: 'CODE128', width: 2, height: 45,
      displayValue: true, fontSize: 12, font: 'monospace',
      fontOptions: 'bold', margin: 2,
    });
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
};

const PICKUPS_COLLECTION = 'pickups';
const PACKAGES_COLLECTION = 'packages';

// ============================================================================
// TYPES
// ============================================================================

export interface PickupManifest {
  id: string;
  missionId: string;
  stopId: string;
  
  // Qui
  clientId: string;
  clientName: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  
  // Où / quand
  address: string;
  coordinates?: { lat: number; lng: number };
  timestamp: string;
  
  // Résultat
  expectedPackageIds: string[];
  scannedPackageIds: string[];
  missingPackageIds: string[];
  unknownBarcodes: string[];          // Codes scannés non prévus
  
  // Preuve
  clientSignatureUrl?: string;
  
  // Stats
  expectedCount: number;
  scannedCount: number;
  missingCount: number;
  
  createdAt: string;
}

// ============================================================================
// FINALISER L'ENLÈVEMENT
// ============================================================================

/**
 * Finalise un enlèvement :
 * - Upload signature client
 * - MAJ statut colis scannés → COLLECTED
 * - Crée le manifeste d'enlèvement
 * - Ajoute un mouvement à chaque colis
 */
export const finalizePickup = async (params: {
  missionId: string;
  stopId: string;
  clientId: string;
  clientName: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  address: string;
  coordinates?: { lat: number; lng: number };
  expectedPackageIds: string[];
  scannedPackageIds: string[];
  missingPackageIds: string[];
  unknownBarcodes: string[];
  signatureBase64?: string;
}): Promise<PickupManifest | null> => {
  const {
    missionId, stopId, clientId, clientName,
    driverId, driverName, vehicleId, vehiclePlate,
    address, coordinates, expectedPackageIds,
    scannedPackageIds, missingPackageIds, unknownBarcodes,
    signatureBase64
  } = params;

  try {
    const timestamp = new Date().toISOString();
    const manifestId = `${missionId}_${stopId}`;

    // 1. Upload signature client
    let clientSignatureUrl: string | undefined;
    if (signatureBase64) {
      const sigRef = ref(storage, `pickups/${missionId}/${stopId}/client-signature.png`);
      const sigData = signatureBase64.includes(',') ? signatureBase64 : `data:image/png;base64,${signatureBase64}`;
      await uploadString(sigRef, sigData, 'data_url');
      clientSignatureUrl = await getDownloadURL(sigRef);
    }

    // 2. MAJ chaque colis scanné → COLLECTED
    // On n'avale PLUS les erreurs : chaque colis en échec est collecté et remonté.
    const failedPackageIds: string[] = [];
    for (const pkgId of scannedPackageIds) {
      try {
        const pkgRef = doc(db, PACKAGES_COLLECTION, pkgId);
        const pkgSnap = await getDoc(pkgRef);
        if (!pkgSnap.exists()) {
          failedPackageIds.push(pkgId);
          reportError('pickup.finalize.package', new Error(`Colis ${pkgId} introuvable en base`), {
            silent: true, extra: { pkgId, missionId, stopId }
          });
          continue;
        }

        const pkg = pkgSnap.data() as Package;
        const movements = [...(pkg.movements || []), cleanUndefined({
          timestamp,
          action: 'COLLECTED' as const,
          driverId,
          driverName: driverName,
          vehicleId,
          vehiclePlate,
          location: coordinates,
          notes: `Enlevé chez ${clientName}`
        })];

        await updateDoc(pkgRef, cleanUndefined({
          status: PackageStatus.COLLECTED,
          currentDriverId: driverId,
          currentVehicleId: vehicleId,
          movements,
          updatedAt: timestamp
        }));
      } catch (e) {
        // Un colis n'a pas pu être mis à jour (droits, réseau…) → on le trace
        // et on continue les autres, mais l'échec ne sera PAS silencieux.
        failedPackageIds.push(pkgId);
        reportError('pickup.finalize.package', e, {
          silent: true, extra: { pkgId, missionId, stopId, clientName }
        });
      }
    }

    // Si des colis scannés n'ont pas pu être enregistrés, on prévient l'utilisateur
    // (message visible) tout en laissant le manifeste se créer pour ce qui a marché.
    if (failedPackageIds.length > 0) {
      reportError(
        'pickup.finalize',
        new Error(`${failedPackageIds.length} colis scanné(s) n'ont pas pu être enregistrés`),
        {
          level: 'warning',
          userMessage: `⚠️ ${failedPackageIds.length} colis scanné(s) sur ${scannedPackageIds.length} n'ont pas pu être enregistrés. Vérifiez votre connexion et rescannez-les.`,
          extra: { failedPackageIds, missionId, stopId, clientName }
        }
      );
    }

    // 3. Créer le manifeste
    const manifest: PickupManifest = {
      id: manifestId,
      missionId,
      stopId,
      clientId,
      clientName,
      driverId,
      driverName,
      vehicleId,
      vehiclePlate,
      address,
      coordinates,
      timestamp,
      expectedPackageIds,
      scannedPackageIds,
      missingPackageIds,
      unknownBarcodes,
      clientSignatureUrl,
      expectedCount: expectedPackageIds.length,
      scannedCount: scannedPackageIds.length,
      missingCount: missingPackageIds.length,
      createdAt: timestamp
    };

    await setDoc(doc(db, PICKUPS_COLLECTION, manifestId), manifest);

    return manifest;

  } catch (err) {
    reportError('pickup.finalize', err, {
      userMessage: "L'enlèvement n'a pas pu être finalisé. Vos scans ne sont pas perdus, réessayez.",
      extra: { missionId, stopId, clientName, scannedCount: scannedPackageIds.length }
    });
    return null;
  }
};

// ============================================================================
// LECTURE — BACK-OFFICE
// ============================================================================

/**
 * Récupère le manifeste d'enlèvement d'un stop.
 */
export const getPickupManifest = async (missionId: string, stopId: string): Promise<PickupManifest | null> => {
  try {
    const docSnap = await getDoc(doc(db, PICKUPS_COLLECTION, `${missionId}_${stopId}`));
    if (docSnap.exists()) return docSnap.data() as PickupManifest;
    return null;
  } catch (err) {
    console.error('[getPickupManifest]', err);
    return null;
  }
};

/**
 * Récupère tous les manifestes d'une mission.
 */
export const getPickupsByMission = async (missionId: string): Promise<PickupManifest[]> => {
  try {
    const q = query(collection(db, PICKUPS_COLLECTION), where('missionId', '==', missionId));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as PickupManifest);
  } catch (err) {
    console.error('[getPickupsByMission]', err);
    return [];
  }
};

// ============================================================================
// GÉNÉRATION ÉTIQUETTES LOT — Pour export PDF
// ============================================================================

/**
 * Génère le HTML d'un lot d'étiquettes pour impression.
 * Format : 4 étiquettes par page A4 (2 colonnes × 2 lignes).
 * Chaque étiquette = 10×15cm avec code-barres Code128.
 */
export type LabelFormat = 'A4' | 'A5' | 'A6';

export const generateBatchLabelsHTML = (
  packages: Package[],
  companyName = 'FleetGenius Transport',
  format: LabelFormat = 'A4'
): string => {
  // Config par format : taille de page, colonnes, nb d'étiquettes/page, dimensions
  const FMT: Record<LabelFormat, { page: string; cols: string; perPage: number; lw: string; lh: string }> = {
    A4: { page: 'A4', cols: '1fr 1fr', perPage: 4, lw: '95mm', lh: '140mm' },
    A5: { page: 'A5', cols: '1fr', perPage: 1, lw: '138mm', lh: '198mm' },
    A6: { page: 'A6', cols: '1fr', perPage: 1, lw: '98mm', lh: '138mm' },
  };
  const cfg = FMT[format] || FMT.A4;
  const labels = packages.map(pkg => `
    <div class="label">
      <div class="label-header">
        <span class="company">${companyName}</span>
        ${pkg.packageTotal && pkg.packageTotal > 1 ? `<span class="xn">Colis ${pkg.packageIndex}/${pkg.packageTotal}</span>` : ''}
        <span class="zone">${pkg.zone || ''}</span>
      </div>
      <div class="barcode-zone">
        <img class="barcode-img" src="${barcodeDataUri(pkg.barcode || pkg.orderNumber)}" alt="${pkg.barcode || pkg.orderNumber}" />
      </div>
      <div class="dest-zone">
        <div class="dest-label">DESTINATAIRE</div>
        <div class="dest-name">${pkg.contactName}</div>
        <div class="dest-addr">${pkg.address}</div>
        <div class="dest-city">${pkg.postalCode} ${pkg.city}</div>
        ${pkg.contactPhone ? `<div class="dest-phone">☎ ${pkg.contactPhone}</div>` : ''}
        ${pkg.floor != null ? `<div class="dest-floor">Étage ${pkg.floor}${pkg.hasElevator ? ' (asc.)' : ''}</div>` : ''}
      </div>
      <div class="sender-zone">
        <span class="sender-label">EXP:</span> ${pkg.clientName}
      </div>
      ${pkg.comment ? `<div class="comment">📝 ${pkg.comment}</div>` : ''}
      <div class="ref-zone">
        <span>Suivi: ${pkg.orderNumber}${pkg.clientReference ? ` · Réf: ${pkg.clientReference}` : ''}</span>
        ${pkg.weight ? `<span>${formatWeight(pkg.weight)}</span>` : ''}
      </div>
    </div>
  `).join('\n');

  return `<!DOCTYPE html>
<html><head>
<title>Étiquettes - ${packages.length} colis</title>
<style>
  @page { size: ${cfg.page}; margin: 5mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; }
  .page { display: grid; grid-template-columns: ${cfg.cols}; gap: 4mm; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  .label {
    width: ${cfg.lw}; height: ${cfg.lh};
    border: 2px solid #000; padding: 3mm;
    display: flex; flex-direction: column;
    page-break-inside: avoid;
  }
  .xn { font-size: 11pt; font-weight: bold; color: #fff; background: #4f46e5; padding: 1mm 3mm; border-radius: 3px; }
  .label-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 2mm; border-bottom: 2px solid #000; background: #f5f5f5;
  }
  .company { font-size: 10pt; font-weight: bold; }
  .zone { font-size: 13pt; font-weight: bold; color: #333; background: #e0e0e0; padding: 1mm 3mm; border-radius: 3px; }
  .barcode-zone { text-align: center; padding: 3mm 0; border-bottom: 1px solid #ccc; }
  .barcode-zone img { width: 80mm; height: 18mm; object-fit: contain; }
  .dest-zone { flex: 1; padding: 3mm 2mm; border-bottom: 1px solid #ccc; }
  .dest-label { font-size: 7pt; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1mm; }
  .dest-name { font-size: 13pt; font-weight: bold; margin-bottom: 1mm; }
  .dest-addr { font-size: 10pt; }
  .dest-city { font-size: 11pt; font-weight: bold; margin-top: 1mm; }
  .dest-phone { font-size: 9pt; color: #555; margin-top: 1mm; }
  .dest-floor { font-size: 9pt; color: #555; }
  .sender-zone { font-size: 8pt; color: #666; padding: 2mm; border-bottom: 1px solid #eee; }
  .sender-label { font-weight: bold; }
  .comment { font-size: 8pt; color: #c60; padding: 1mm 2mm; background: #fff8e1; }
  .ref-zone { display: flex; justify-content: space-between; padding: 2mm; font-size: 8pt; color: #888; }
</style>
</head><body>
<div class="page">
${labels}
</div>
<script>
  // Les codes-barres sont déjà des images data-URI (générées à la création,
  // sans CDN). Ici on ne fait plus que la pagination + l'impression.
  // Regrouper en pages selon le format
  const PER_PAGE = ${cfg.perPage};
  const labels = document.querySelectorAll('.label');
  const pages = document.querySelectorAll('.page');
  if (pages.length === 1 && labels.length > PER_PAGE) {
    const container = pages[0];
    const allLabels = Array.from(labels);
    container.innerHTML = '';
    for (let i = 0; i < allLabels.length; i += PER_PAGE) {
      const page = document.createElement('div');
      page.className = 'page';
      allLabels.slice(i, i + PER_PAGE).forEach(l => page.appendChild(l));
      container.parentNode.insertBefore(page, container);
    }
    container.remove();
  }
  window.onload = () => setTimeout(() => window.print(), 500);
<\/script>
</body></html>`;
};
