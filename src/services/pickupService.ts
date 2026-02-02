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
    for (const pkgId of scannedPackageIds) {
      try {
        const pkgRef = doc(db, PACKAGES_COLLECTION, pkgId);
        const pkgSnap = await getDoc(pkgRef);
        if (!pkgSnap.exists()) continue;

        const pkg = pkgSnap.data() as Package;
        const movements = [...(pkg.movements || []), {
          timestamp,
          action: 'COLLECTED' as const,
          driverId,
          driverName: driverName,
          vehicleId,
          vehiclePlate,
          location: coordinates,
          notes: `Enlevé chez ${clientName}`
        }];

        await updateDoc(pkgRef, {
          status: PackageStatus.COLLECTED,
          currentDriverId: driverId,
          currentVehicleId: vehicleId,
          movements,
          updatedAt: timestamp
        });
      } catch (e) {
        console.warn(`Erreur MAJ colis ${pkgId}:`, e);
      }
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

    console.log(`✅ Enlèvement finalisé: ${scannedPackageIds.length}/${expectedPackageIds.length} colis collectés`);
    return manifest;

  } catch (err) {
    console.error('[finalizePickup] Erreur:', err);
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
export const generateBatchLabelsHTML = (packages: Package[], companyName = 'FleetGenius Transport'): string => {
  const labels = packages.map(pkg => `
    <div class="label">
      <div class="label-header">
        <span class="company">${companyName}</span>
        <span class="zone">${pkg.zone || ''}</span>
      </div>
      <div class="barcode-zone">
        <svg id="bc-${pkg.id}"></svg>
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
        <span>Réf: ${pkg.orderNumber}</span>
        ${pkg.weight ? `<span>${pkg.weight} kg</span>` : ''}
      </div>
    </div>
  `).join('\n');

  const barcodeIds = packages.map(pkg => ({
    id: pkg.id,
    code: pkg.barcode || pkg.orderNumber
  }));

  return `<!DOCTYPE html>
<html><head>
<title>Étiquettes - ${packages.length} colis</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
<style>
  @page { size: A4; margin: 5mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; }
  .page { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  .label {
    width: 95mm; height: 140mm;
    border: 2px solid #000; padding: 3mm;
    display: flex; flex-direction: column;
    page-break-inside: avoid;
  }
  .label-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 2mm; border-bottom: 2px solid #000; background: #f5f5f5;
  }
  .company { font-size: 10pt; font-weight: bold; }
  .zone { font-size: 13pt; font-weight: bold; color: #333; background: #e0e0e0; padding: 1mm 3mm; border-radius: 3px; }
  .barcode-zone { text-align: center; padding: 3mm 0; border-bottom: 1px solid #ccc; }
  .barcode-zone svg { width: 80mm; height: 18mm; }
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
  const barcodes = ${JSON.stringify(barcodeIds)};
  barcodes.forEach(bc => {
    const el = document.getElementById('bc-' + bc.id);
    if (el) {
      try {
        JsBarcode(el, bc.code, {
          format: 'CODE128', width: 2, height: 45,
          displayValue: true, fontSize: 12, font: 'monospace',
          fontOptions: 'bold', margin: 2
        });
      } catch(e) { console.warn('Barcode error:', bc.code, e); }
    }
  });
  // Regrouper en pages de 4
  const labels = document.querySelectorAll('.label');
  const pages = document.querySelectorAll('.page');
  if (pages.length === 1 && labels.length > 4) {
    const container = pages[0];
    const allLabels = Array.from(labels);
    container.innerHTML = '';
    for (let i = 0; i < allLabels.length; i += 4) {
      const page = document.createElement('div');
      page.className = 'page';
      allLabels.slice(i, i + 4).forEach(l => page.appendChild(l));
      container.parentNode.insertBefore(page, container);
    }
    container.remove();
  }
  window.onload = () => setTimeout(() => window.print(), 500);
<\/script>
</body></html>`;
};
