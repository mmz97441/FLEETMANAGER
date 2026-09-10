import { cleanUndefined } from '../utils/firestore';
/**
 * POD SERVICE v2 — Preuve de Livraison (Production-ready)
 * 
 * Améliorations v2 :
 * - Compression photos avant upload (max 1200px, qualité 0.7 → ~100-200 KB)
 * - Callback de progression pour indicateur UI mobile
 * - Support POD sur échec (photo porte fermée, absent, etc.)
 * - Retry automatique sur erreur réseau (1 retry)
 * 
 * Structure Storage :
 *   pod/{missionId}/{stopId}/signature.png
 *   pod/{missionId}/{stopId}/photo-0.jpg
 *   pod/{missionId}/{stopId}/failure-photo-0.jpg
 * 
 * Structure Firestore :
 *   packages/{pkgId}.pod = ProofOfDelivery (URLs Storage)
 *   proofs_of_delivery/{missionId}_{stopId} = document complet
 */

import { storage, db } from '../firebaseConfig';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { doc, collection, query, where, getDocs, getDoc, runTransaction } from 'firebase/firestore';
import { ProofOfDelivery, Package, PackageStatus, DeliveryLocation, MissionStop } from '../types';

const POD_COLLECTION = 'proofs_of_delivery';
const PACKAGES_COLLECTION = 'packages';

type ProofDocument = Omit<ProofOfDelivery, 'packageId' | 'coordinates'> & {
  packageIds: string[];
  coordinates: { lat: number; lng: number } | null;
  type: 'SUCCESS' | 'FAILURE';
  locationStatus?: 'captured' | 'unavailable';
  failureReason?: string;
  failureNotes?: string | null;
  createdAt: string;
};

function assertSameProof(
  existing: ProofDocument,
  expected: Pick<ProofDocument, 'driverId' | 'packageIds' | 'type' | 'missionId' | 'stopId'>,
) {
  if (
    existing.driverId !== expected.driverId ||
    existing.missionId !== expected.missionId ||
    existing.stopId !== expected.stopId ||
    (existing.type || 'SUCCESS') !== expected.type ||
    !Array.isArray(existing.packageIds) ||
    JSON.stringify([...existing.packageIds].sort()) !== JSON.stringify([...expected.packageIds].sort())
  ) throw new Error('Une autre preuve existe pour cet arrêt.');
}

/** Publish the immutable proof and release the closure guard in one transaction. */
async function saveProofAndFinishSync(payload: ProofDocument): Promise<ProofDocument> {
  return runTransaction(db, async (tx) => {
    const proofRef = doc(db, POD_COLLECTION, `${payload.missionId}_${payload.stopId}`);
    const missionRef = doc(db, 'missions', payload.missionId);
    const [existing, mission] = await Promise.all([tx.get(proofRef), tx.get(missionRef)]);
    if (!mission.exists()) throw new Error('Tournée introuvable : les preuves restent conservées sur cet appareil.');
    const saved = existing.exists() ? existing.data() as ProofDocument : payload;
    if (existing.exists()) assertSameProof(saved, payload);
    const stops = (mission.data().stops || []) as MissionStop[];
    const stop = stops.find((candidate) => candidate.id === payload.stopId);
    if (!stop) throw new Error('Cet arrêt a changé. Les preuves restent conservées sur cet appareil ; contactez le bureau.');

    // Read before any write. A transfer or reassignment racing with an upload
    // must never receive the former mission's proof on its parcel document.
    const packageRefs = !existing.exists() && payload.type === 'SUCCESS'
      ? payload.packageIds.map((id) => doc(db, PACKAGES_COLLECTION, id)) : [];
    const packages = await Promise.all(packageRefs.map((reference) => tx.get(reference)));
    for (const snapshot of packages) {
      const pkg = snapshot.data();
      if (!pkg || pkg.missionId !== payload.missionId || pkg.stopId !== payload.stopId || pkg.status !== PackageStatus.DELIVERED) {
        throw new Error('Un colis de cet arrêt a changé. Les preuves restent conservées ; contactez le bureau.');
      }
    }

    if (!existing.exists()) {
      tx.set(proofRef, cleanUndefined(payload));
      packageRefs.forEach((reference, index) => {
        tx.update(reference, {
          pod: cleanUndefined({ ...payload, packageId: payload.packageIds[index] }),
          updatedAt: payload.createdAt,
        });
      });
    }
    if (stop.proofSyncPending) {
      tx.update(missionRef, {
        stops: stops.map((candidate) => candidate.id === stop.id
          ? { ...candidate, proofSyncPending: false } : candidate),
        updatedAt: new Date().toISOString(),
      });
    }
    return saved;
  });
}

// ============================================================================
// COMPRESSION PHOTO — Critique pour mobile
// ============================================================================

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.7;

/**
 * Compresse une image base64 via canvas.
 * Photo smartphone 5-8 MB → ~100-200 KB.
 */
export const compressImage = (
  base64Data: string,
  maxDim = MAX_DIMENSION,
  quality = JPEG_QUALITY
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64Data); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', quality);
      const origKB = Math.round(base64Data.length * 0.75 / 1024);
      const compKB = Math.round(compressed.length * 0.75 / 1024);
      resolve(compressed);
    };
    img.onerror = () => resolve(base64Data);
    img.src = base64Data.includes(',') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
  });
};

/**
 * Grave un watermark (GPS + timestamp + chauffeur) en bas de la photo.
 * Fait APRÈS compression pour ne pas affecter la qualité.
 */
export const burnWatermark = (
  base64Data: string,
  info: {
    timestamp: string;
    driverName: string;
    coords?: { lat: number; lng: number };
  }
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64Data); return; }

      // Dessiner l'image
      ctx.drawImage(img, 0, 0);

      // Bande semi-transparente en bas
      const barHeight = Math.max(36, img.height * 0.06);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, img.height - barHeight, img.width, barHeight);

      // Texte watermark
      const fontSize = Math.max(11, Math.min(14, img.width * 0.018));
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';

      const date = new Date(info.timestamp);
      const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const leftText = `📅 ${dateStr}  🕐 ${timeStr}  🚚 ${info.driverName}`;
      ctx.fillText(leftText, 8, img.height - barHeight / 2);

      if (info.coords && (info.coords.lat !== 0 || info.coords.lng !== 0)) {
        const gpsText = `📍 ${info.coords.lat.toFixed(5)}, ${info.coords.lng.toFixed(5)}`;
        const gpsWidth = ctx.measureText(gpsText).width;
        ctx.fillText(gpsText, img.width - gpsWidth - 8, img.height - barHeight / 2);
      }

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(base64Data);
    img.src = base64Data.includes(',') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
  });
};

// ============================================================================
// UPLOAD avec retry
// ============================================================================

const uploadBase64 = async (path: string, base64Data: string, contentType = 'image/png'): Promise<string> => {
  const storageRef = ref(storage, path);
  const data = base64Data.includes(',') ? base64Data : `data:${contentType};base64,${base64Data}`;
  try {
    await uploadString(storageRef, data, 'data_url');
    return await getDownloadURL(storageRef);
  } catch {
    // Retry 1x après 1s
    await new Promise(r => setTimeout(r, 1000));
    await uploadString(storageRef, data, 'data_url');
    return await getDownloadURL(storageRef);
  }
};

/**
 * Upload d'une photo/signature isolée (ex. preuve de RETOUR HUB), avec
 * compression, vers Storage. Retourne l'URL téléchargeable.
 * (Réparé : cette fonction était appelée par le flux retour hub mais
 * n'existait pas → photos de retour silencieusement perdues.)
 */
export const uploadProofPhoto = async (
  base64: string,
  packageId: string,
  kind: string = 'photo'
): Promise<string> => {
  const isSignature = kind.includes('signature');
  const data = isSignature ? base64 : await compressImage(base64);
  const ext = isSignature ? 'png' : 'jpg';
  const mime = isSignature ? 'image/png' : 'image/jpeg';
  const ts = new Date().toISOString().replace(/[:.]/g, '');
  return uploadBase64(`pod/returns/${packageId}/${kind}-${ts}.${ext}`, data, mime);
};

// ============================================================================
// TYPES
// ============================================================================

export interface UploadProgress {
  step: 'compressing' | 'uploading_signature' | 'uploading_photos' | 'saving' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

// ============================================================================
// UPLOAD LIVRAISON RÉUSSIE
// ============================================================================

export const uploadAndCreatePOD = async (
  params: {
    missionId: string;
    stopId: string;
    packageIds: string[];
    driverId: string;
    driverName: string;
    vehicleId: string;
    vehiclePlate: string;
    recipientName?: string;
    deliveryLocation?: DeliveryLocation;
    merchandiseGoodCondition?: boolean;
    reservesNote?: string;
    signatureBase64?: string;
    photosBase64: string[];
    coordinates: { lat: number; lng: number };
    recordedAt?: string;
    notes?: string;
  },
  onProgress?: (p: UploadProgress) => void
): Promise<ProofOfDelivery | null> => {
  const {
    missionId, stopId, packageIds, driverId, driverName,
    vehicleId, vehiclePlate, recipientName, deliveryLocation,
    merchandiseGoodCondition, reservesNote,
    signatureBase64, photosBase64, coordinates, recordedAt, notes
  } = params;
  // Normalisé pour Firestore (pas d'undefined : le projet n'active pas ignoreUndefinedProperties)
  const goodCondition = merchandiseGoodCondition ?? true;
  const reservesExtra = (!goodCondition && reservesNote) ? { reservesNote } : {};

  const totalSteps = 1 + (signatureBase64 ? 1 : 0) + Math.max(photosBase64.length, 1) + 1;
  let step = 0;
  const emit = (s: UploadProgress['step'], msg: string) => {
    step++;
    onProgress?.({ step: s, current: step, total: totalSteps, message: msg });
  };

  try {
    const existing = await getDoc(doc(db, POD_COLLECTION, `${missionId}_${stopId}`));
    if (existing.exists()) {
      const data = existing.data() as ProofDocument;
      assertSameProof(data, { driverId, packageIds, missionId, stopId, type: 'SUCCESS' });
      const saved = await saveProofAndFinishSync(data);
      return { ...saved, packageId: packageIds[0] || '' } as ProofOfDelivery;
    }
    const basePath = `pod/${missionId}/${stopId}/${crypto.randomUUID()}`;
    const timestamp = recordedAt || new Date().toISOString();

    // 1. Compresser photos
    emit('compressing', 'Compression des photos...');
    const compressed = await Promise.all(photosBase64.map(p => compressImage(p)));

    // 1b. Watermark GPS + timestamp + chauffeur sur chaque photo
    const watermarked = await Promise.all(
      compressed.map(p => burnWatermark(p, { timestamp, driverName, coords: coordinates }))
    );

    // 2. Upload signature
    let signatureUrl: string | undefined;
    if (signatureBase64) {
      emit('uploading_signature', 'Envoi signature...');
      signatureUrl = await uploadBase64(`${basePath}/signature.png`, signatureBase64, 'image/png');
    }

    // 3. Upload photos (watermarked)
    let photoUrls: string[] = [];
    if (watermarked.length > 0) {
      emit('uploading_photos', `Envoi photos (0/${watermarked.length})...`);
      photoUrls = await Promise.all(
        watermarked.map((photo, i) =>
          uploadBase64(`${basePath}/photo-${i}.jpg`, photo, 'image/jpeg')
            .then(url => {
              onProgress?.({
                step: 'uploading_photos', current: step, total: totalSteps,
                message: `Envoi photos (${i + 1}/${watermarked.length})...`
              });
              return url;
            })
        )
      );
    }

    // 4. Firestore
    emit('saving', 'Enregistrement...');
    const payload = cleanUndefined({
      packageIds, missionId, stopId, driverId, driverName, vehicleId, vehiclePlate,
      recipientName, deliveryLocation: deliveryLocation || null,
      merchandiseGoodCondition: goodCondition, reservesNote: reservesExtra.reservesNote ?? null,
      signatureUrl, photoUrls, coordinates, timestamp, notes, type: 'SUCCESS' as const, createdAt: new Date().toISOString()
    }) as ProofDocument;
    const saved = await saveProofAndFinishSync(payload);

    emit('done', 'Preuves enregistrées ✓');
    return { ...saved, packageId: packageIds[0] || '' } as ProofOfDelivery;
  } catch (err) {
    onProgress?.({ step: 'error', current: 0, total: 0, message: 'Erreur envoi' });
    console.error('[uploadAndCreatePOD]', err);
    return null;
  }
};

// ============================================================================
// UPLOAD ÉCHEC LIVRAISON (photo preuve de tentative)
// ============================================================================

export const uploadFailurePOD = async (
  params: {
    missionId: string;
    stopId: string;
    packageIds: string[];
    driverId: string;
    driverName: string;
    vehicleId: string;
    vehiclePlate: string;
    failureReason: string;
    failureNotes?: string;
    photosBase64: string[];
    coordinates?: { lat: number; lng: number } | null;
    recordedAt?: string;
  },
  onProgress?: (p: UploadProgress) => void
): Promise<boolean> => {
  const {
    missionId, stopId, packageIds, driverId, driverName,
    vehicleId, vehiclePlate, failureReason, failureNotes,
    photosBase64, coordinates, recordedAt
  } = params;

  try {
    const existing = await getDoc(doc(db, POD_COLLECTION, `${missionId}_${stopId}`));
    if (existing.exists()) {
      const data = existing.data() as ProofDocument;
      assertSameProof(data, { driverId, packageIds, missionId, stopId, type: 'FAILURE' });
      await saveProofAndFinishSync(data);
      return true;
    }
    if (!photosBase64.length) throw new Error('Une photo est obligatoire pour déclarer l’échec.');
    const basePath = `pod/${missionId}/${stopId}/${crypto.randomUUID()}`;
    const timestamp = recordedAt || new Date().toISOString();

    let photoUrls: string[] = [];
    if (photosBase64.length > 0) {
      onProgress?.({ step: 'compressing', current: 1, total: 3, message: 'Compression...' });
      const compressed = await Promise.all(photosBase64.map(p => compressImage(p)));
      onProgress?.({ step: 'uploading_photos', current: 2, total: 3, message: 'Envoi photos...' });
      photoUrls = await Promise.all(
        compressed.map((photo, i) =>
          uploadBase64(`${basePath}/failure-photo-${i}.jpg`, photo, 'image/jpeg')
        )
      );
    }

    onProgress?.({ step: 'saving', current: 3, total: 3, message: 'Enregistrement...' });
    await saveProofAndFinishSync({
      packageIds, missionId, stopId, driverId, driverName,
      vehicleId, vehiclePlate, photoUrls, coordinates: coordinates ?? null,
      locationStatus: coordinates ? 'captured' : 'unavailable', timestamp,
      type: 'FAILURE', failureReason, failureNotes: failureNotes || null,
      createdAt: new Date().toISOString()
    });

    onProgress?.({ step: 'done', current: 3, total: 3, message: 'Enregistré ✓' });
    return true;
  } catch (err) {
    onProgress?.({ step: 'error', current: 0, total: 0, message: 'Erreur envoi' });
    console.error('[uploadFailurePOD]', err);
    return false;
  }
};

// ============================================================================
// LECTURE — BACK-OFFICE
// ============================================================================

export const getPODsByMission = async (missionId: string): Promise<any[]> => {
  try {
    const q = query(collection(db, POD_COLLECTION), where('missionId', '==', missionId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[getPODsByMission]', err);
    return [];
  }
};

export const getPODByPackage = async (packageId: string): Promise<ProofOfDelivery | null> => {
  try {
    const pkgDoc = await getDoc(doc(db, PACKAGES_COLLECTION, packageId));
    if (pkgDoc.exists()) return (pkgDoc.data() as Package).pod || null;
    return null;
  } catch (err) {
    console.error('[getPODByPackage]', err);
    return null;
  }
};

// ============================================================================
// LECTURE — CLIENT (avec infos colis pour affichage)
// ============================================================================

export interface ClientPODResult extends ProofOfDelivery {
  orderNumber: string;
  contactName: string;
  address: string;
  city: string;
}

export const getPODsByClient = async (clientId: string): Promise<ClientPODResult[]> => {
  try {
    const q = query(
      collection(db, PACKAGES_COLLECTION),
      where('clientId', '==', clientId),
      where('status', '==', PackageStatus.DELIVERED)
    );
    const snap = await getDocs(q);
    const results: ClientPODResult[] = [];
    snap.docs.forEach(d => {
      const pkg = d.data() as Package;
      if (pkg.pod) {
        results.push({
          ...pkg.pod,
          orderNumber: pkg.orderNumber,
          contactName: pkg.contactName,
          address: pkg.address,
          city: `${pkg.postalCode} ${pkg.city}`
        });
      }
    });
    return results;
  } catch (err) {
    console.error('[getPODsByClient]', err);
    return [];
  }
};
