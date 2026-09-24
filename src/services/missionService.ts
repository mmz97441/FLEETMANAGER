import { scanPackage } from './scanService';
import { listenClientPackages } from './clientPackageSubscription';
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "../firebaseConfig";
import { editMissionStop, deleteMissionStop, reorderStops } from './missionStopEditor';
/**
 * SERVICE DE GESTION DES MISSIONS
 * 
 * Gère les hubs, colis, missions, imports et optimisation GMPRO
 */

import { db } from '../firebaseConfig';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  Timestamp
} from 'firebase/firestore';
import {
  Hub, Zone, Package, PackageStatus, PackageMovement,
  Mission, MissionType, MissionStatus, MissionStop, StopStatus,
  ImportBatch, ImportBatchStatus, ImportBatchZoneBreakdown,
  PackageTransfer, TransferStatus, TransferReason, ProofOfDelivery,
  PostalCodeMapping, User, UserRole
} from '../types';
import { extractScanTokens, orderReferenceHint, orderReferenceMessage } from '../utils/barcode';
import { placeKey } from '../utils/address';
import { localDatePart } from '../utils/date';
import { cleanUndefined } from '../utils/firestore';
import { haversineKm } from '../utils/geo';
import { geocodeAddress, getGoogleMapsApiKey } from './gmproService';
import { reportError } from './logService';
import { recalculateStopEtas } from '../utils/routeTiming';
import { trackingCodeForRequest } from '../utils/shipmentRequest';

// Collections Firestore
const HUBS_COLLECTION = 'hubs';
const PACKAGES_COLLECTION = 'packages';
const MISSIONS_COLLECTION = 'missions';
const IMPORTS_COLLECTION = 'import_batches';
const TRANSFERS_COLLECTION = 'package_transfers';
const POSTAL_CODES_COLLECTION = 'postal_code_mappings';

// ============================================================================
// HELPERS
// ============================================================================

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ── Fabrique d'ARRÊT de livraison — forme UNIQUE ─────────────────────────────
// Avant, un MissionStop était fabriqué à la main à plusieurs endroits, avec des
// IDs (4 formats, dont Math.random) et des valeurs par défaut divergents. Ici :
// packageCount toujours = packageIds.length, status PENDING, serviceTime défaut 5,
// undefined retirés (cleanUndefined). Le serviceTime réel reste au choix de
// l'appelant (formules légitimement différentes : dispatch vs manuel).

/** Identifiant d'arrêt uniforme : `<prefix>-<horodatage>-<seq>`. */
export const makeStopId = (prefix: string, seq: number, isoNow: string): string =>
  `${prefix}-${isoNow.replace(/[:.]/g, '')}-${seq}`;

export interface DeliveryStopInput {
  id: string;
  sequence: number;
  address: string;
  city: string;
  postalCode: string;
  contactName?: string;
  contactPhone?: string;
  coordinates?: { lat: number; lng: number };
  floor?: number;
  hasElevator?: boolean;
  packageIds?: string[];
  serviceTime?: number;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  notes?: string;
  estimatedArrival?: string;
}

/** Construit un MissionStop de livraison normalisé (packageCount dérivé, PENDING). */
export const buildDeliveryStop = (input: DeliveryStopInput): MissionStop =>
  cleanUndefined({
    id: input.id,
    sequence: input.sequence,
    type: 'DELIVERY',
    address: input.address,
    city: input.city,
    postalCode: input.postalCode,
    coordinates: input.coordinates,
    floor: input.floor,
    hasElevator: input.hasElevator,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    packageIds: input.packageIds || [],
    packageCount: (input.packageIds || []).length,
    serviceTime: input.serviceTime ?? 5,
    timeWindowStart: input.timeWindowStart,
    timeWindowEnd: input.timeWindowEnd,
    notes: input.notes,
    estimatedArrival: input.estimatedArrival,
    status: StopStatus.PENDING,
  }) as MissionStop;

// ============================================================================
// HUBS
// ============================================================================

export const subscribeToHubs = (callback: (hubs: Hub[]) => void, onError?: (error: Error) => void) => {
  const q = query(collection(db, HUBS_COLLECTION), orderBy('zone'));
  return onSnapshot(q, (snapshot) => {
    const hubs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hub));
    callback(hubs);
  }, onError);
};

export const getHubs = async (): Promise<Hub[]> => {
  const q = query(collection(db, HUBS_COLLECTION), orderBy('zone'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hub));
};

export const getHubByZone = async (zone: Zone): Promise<Hub | null> => {
  const q = query(collection(db, HUBS_COLLECTION), where('zone', '==', zone), where('isActive', '==', true));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Hub;
};

export const addHub = async (hub: Omit<Hub, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, HUBS_COLLECTION), cleanUndefined({
    ...hub,
    createdAt: now,
    updatedAt: now
  }));
  return docRef.id;
};

export const updateHub = async (hub: Hub): Promise<void> => {
  const { id, ...data } = hub;
  await updateDoc(doc(db, HUBS_COLLECTION, id), cleanUndefined({
    ...data,
    updatedAt: new Date().toISOString()
  }));
};

export const deleteHub = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, HUBS_COLLECTION, id));
};

// ============================================================================
// POSTAL CODE MAPPINGS
// ============================================================================

// Mapping par défaut pour La Réunion
export const DEFAULT_POSTAL_CODE_MAPPINGS: PostalCodeMapping[] = [
  // ZONE NORD
  { postalCode: '97400', zone: Zone.NORD, city: 'Saint-Denis' },
  { postalCode: '97490', zone: Zone.NORD, city: 'Sainte-Clotilde' },
  { postalCode: '97419', zone: Zone.NORD, city: 'La Possession' },
  { postalCode: '97417', zone: Zone.NORD, city: 'La Montagne' },
  { postalCode: '97488', zone: Zone.NORD, city: 'Saint-Denis' },
  
  // ZONE SUD
  { postalCode: '97410', zone: Zone.SUD, city: 'Saint-Pierre' },
  { postalCode: '97430', zone: Zone.SUD, city: 'Le Tampon' },
  { postalCode: '97480', zone: Zone.SUD, city: 'Saint-Joseph' },
  { postalCode: '97450', zone: Zone.SUD, city: 'Saint-Louis' },
  { postalCode: '97424', zone: Zone.SUD, city: 'Piton Saint-Leu' },
  { postalCode: '97432', zone: Zone.SUD, city: 'Ravine des Cabris' },
  { postalCode: '97421', zone: Zone.SUD, city: 'Saint-Louis' },
  { postalCode: '97426', zone: Zone.SUD, city: 'Les Trois-Bassins' },
  { postalCode: '97416', zone: Zone.SUD, city: 'La Chaloupe Saint-Leu' },
  { postalCode: '97422', zone: Zone.SUD, city: 'La Plaine des Cafres' },
  { postalCode: '97418', zone: Zone.SUD, city: 'La Plaine des Cafres' },
  { postalCode: '97442', zone: Zone.SUD, city: 'Saint-Philippe' },
  { postalCode: '97429', zone: Zone.SUD, city: 'Petite-Île' },

  // ZONE EST
  { postalCode: '97440', zone: Zone.EST, city: 'Saint-André' },
  { postalCode: '97470', zone: Zone.EST, city: 'Saint-Benoît' },
  { postalCode: '97431', zone: Zone.EST, city: 'La Plaine des Palmistes' },
  { postalCode: '97437', zone: Zone.EST, city: 'Sainte-Anne' },
  { postalCode: '97438', zone: Zone.EST, city: 'Sainte-Marie' },
  { postalCode: '97441', zone: Zone.EST, city: 'Sainte-Suzanne' },
  { postalCode: '97412', zone: Zone.EST, city: 'Bras-Panon' },
  { postalCode: '97433', zone: Zone.EST, city: 'Salazie' },
  { postalCode: '97439', zone: Zone.EST, city: 'Sainte-Rose' },

  // ZONE OUEST
  { postalCode: '97420', zone: Zone.OUEST, city: 'Le Port' },
  { postalCode: '97460', zone: Zone.OUEST, city: 'Saint-Paul' },
  { postalCode: '97434', zone: Zone.OUEST, city: 'Saint-Gilles-les-Bains' },
  { postalCode: '97435', zone: Zone.OUEST, city: 'Saint-Gilles-les-Hauts' },
  { postalCode: '97436', zone: Zone.OUEST, city: 'Saint-Leu' },
  { postalCode: '97423', zone: Zone.OUEST, city: 'Le Guillaume' },
  { postalCode: '97411', zone: Zone.OUEST, city: 'Bois de Nèfles Saint-Paul' },
  { postalCode: '97413', zone: Zone.OUEST, city: 'Cilaos' },
  { postalCode: '97414', zone: Zone.OUEST, city: 'Entre-Deux' },
  { postalCode: '97415', zone: Zone.OUEST, city: 'La Rivière' },
  { postalCode: '97425', zone: Zone.OUEST, city: 'Les Avirons' },
  { postalCode: '97427', zone: Zone.OUEST, city: 'L\'Étang-Salé' },
];

let postalCodeCache: PostalCodeMapping[] | null = null;

export const getPostalCodeMappings = async (): Promise<PostalCodeMapping[]> => {
  if (postalCodeCache) return postalCodeCache;
  
  const snapshot = await getDocs(collection(db, POSTAL_CODES_COLLECTION));
  if (snapshot.empty) {
    // Initialiser avec les valeurs par défaut
    postalCodeCache = DEFAULT_POSTAL_CODE_MAPPINGS;
    return postalCodeCache;
  }
  
  postalCodeCache = snapshot.docs.map(doc => doc.data() as PostalCodeMapping);
  return postalCodeCache;
};

export const getZoneFromPostalCode = async (postalCode: string): Promise<Zone | null> => {
  const mappings = await getPostalCodeMappings();
  const mapping = mappings.find(m => m.postalCode === postalCode);
  return mapping?.zone || null;
};

// ---- Gestion des correspondances code postal → zone (page d'administration) ----

/** Recharge les correspondances depuis Firestore en ignorant le cache. */
export const getPostalCodeMappingsFresh = async (): Promise<PostalCodeMapping[]> => {
  postalCodeCache = null;
  return getPostalCodeMappings();
};

/**
 * Crée / met à jour une correspondance. Le code postal sert d'identifiant de
 * document (pas de doublon possible) et le cache est invalidé.
 */
export const savePostalCodeMapping = async (m: PostalCodeMapping): Promise<void> => {
  const code = m.postalCode.trim();
  await setDoc(doc(db, POSTAL_CODES_COLLECTION, code), cleanUndefined({
    postalCode: code,
    zone: m.zone,
    city: m.city?.trim() || '',
    hubId: m.hubId
  }));
  postalCodeCache = null;
};

/** Supprime une correspondance et invalide le cache. */
export const deletePostalCodeMapping = async (postalCode: string): Promise<void> => {
  await deleteDoc(doc(db, POSTAL_CODES_COLLECTION, postalCode.trim()));
  postalCodeCache = null;
};

/**
 * Écrit les correspondances par défaut dans Firestore (utile au premier
 * remplissage de la page de gestion quand la collection est vide).
 */
export const seedDefaultPostalCodeMappings = async (): Promise<number> => {
  for (const m of DEFAULT_POSTAL_CODE_MAPPINGS) {
    await setDoc(doc(db, POSTAL_CODES_COLLECTION, m.postalCode), cleanUndefined({ ...m }));
  }
  postalCodeCache = null;
  return DEFAULT_POSTAL_CODE_MAPPINGS.length;
};

export const extractPostalCodeFromAddress = (address: string): string | null => {
  // Format attendu: "6 RUE DE L ETANG ZI BEL AIR,97450,SAINT LOUIS"
  const parts = address.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^974\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  // Certains clients envoient l'adresse sans virgules ("144 RUE GEORGES POMPIDOU  97433 SALAZIE")
  const match = address.match(/\b(974\d{2})\b/);
  return match ? match[1] : null;
};

// ============================================================================
// PACKAGES (Colis)
// ============================================================================

export const subscribeToPackages = (
  callback: (packages: Package[]) => void,
  filters?: { date?: string; zone?: Zone; status?: PackageStatus; clientId?: string; missionId?: string; driverId?: string },
  onError?: (error: Error) => void
) => {
  const source = collection(db, PACKAGES_COLLECTION);
  const filter = filters?.driverId ? ['currentDriverId',filters.driverId] : filters?.missionId ? ['missionId',filters.missionId] : filters?.clientId ? ['clientId',filters.clientId] : filters?.status ? ['status',filters.status] : null;
  const q = filter ? query(source,where(filter[0],'==',filter[1])) : query(source,orderBy('createdAt','desc'));
  // Apply the most selective scope on the server before any local filtering.
  
  return onSnapshot(q, (snapshot) => {
    let packages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Package));
    
    if (filters?.date) {
      packages = packages.filter(p => localDatePart(p.createdAt) === filters.date!);
    }
    if (filters?.zone) {
      packages = packages.filter(p => p.zone === filters.zone);
    }
    if (filters?.status) {
      packages = packages.filter(p => p.status === filters.status);
    }
    if (filters?.clientId) {
      packages = packages.filter(p => p.clientId === filters.clientId);
    }
    if (filters?.driverId) packages = packages.filter(p=>p.currentDriverId === filters.driverId);
    if (filters?.missionId) {
      packages = packages.filter(p => p.missionId === filters.missionId);
    }
    
    callback(packages);
  }, onError);
};

/**
 * Abonnement DÉDIÉ aux colis DISPATCHABLES (tableau de dispatch).
 *
 * Historiquement, `subscribeToPackages` ne chargeait que les 500 colis les plus récents de tout le
 * système avant de filtrer côté client : sur une grosse journée (>500 colis créés
 * après les colis en attente), d'anciens colis AT_HUB/SORTED non affectés tombaient
 * hors des 500 → INVISIBLES au dispatch, jamais partis en tournée. Ici on interroge
 * le serveur par statut (`in`, sans orderBy → aucun index composite requis) : TOUS
 * les colis dispatchables remontent, quel que soit le volume. Le filtre « non
 * affecté » reste côté client (missionId/currentDriverId).
 */
export const subscribeToDispatchablePackages = (
  callback: (packages: Package[]) => void,
  onError?: (error: Error) => void
) => {
  const q = query(
    collection(db, PACKAGES_COLLECTION),
    where('status', 'in', [PackageStatus.AT_HUB, PackageStatus.SORTED])
  );
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Package)));
  }, onError);
};

/**
 * Abonnement DÉDIÉ aux colis d'un client (portail expéditeur).
 *
 * Corrige un ancien défaut de `subscribeToPackages` qui ne chargeait que les 500 colis les
 * plus récents de TOUT le système avant de filtrer côté client : un client à fort
 * volume ne voyait plus ses colis anciens. Ici on interroge Firestore CÔTÉ SERVEUR
 * par `clientId` ET par `clientName` (requêtes d'égalité → index simples, pas de
 * limite globale), puis on fusionne. Le client voit ainsi TOUS ses colis.
 */
export const subscribeToClientPackages = listenClientPackages;

export const getPackagesByMission = async (missionId: string): Promise<Package[]> => {
  const q = query(collection(db, PACKAGES_COLLECTION), where('missionId', '==', missionId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Package));
};

export const getPackageByBarcode = async (barcode: string): Promise<Package | null> => {
  // Chercher par orderNumber ou barcode
  let q = query(collection(db, PACKAGES_COLLECTION), where('orderNumber', '==', barcode));
  let snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    q = query(collection(db, PACKAGES_COLLECTION), where('barcode', '==', barcode));
    snapshot = await getDocs(q);
  }
  
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Package;
};

export const addPackage = async (pkg: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, PACKAGES_COLLECTION), cleanUndefined({
    ...pkg,
    createdAt: now,
    updatedAt: now
  }));
  return docRef.id;
};

export const updatePackage = async (pkg: Package): Promise<void> => {
  const { id, ...data } = pkg;
  await updateDoc(doc(db, PACKAGES_COLLECTION, id), cleanUndefined({
    ...data,
    updatedAt: new Date().toISOString()
  }));
};

export const updatePackageStatus = async (
  packageId: string,
  status: PackageStatus,
  movement: Omit<PackageMovement, 'timestamp'>,
  extraFields?: Partial<Pick<Package, 'missionId' | 'stopId' | 'currentDriverId' | 'currentVehicleId' | 'currentHubId' | 'estimatedDeliveryAt'>>
): Promise<void> => {
  const pkg = await runTransaction(db, async tx => {
    const ref = doc(db, PACKAGES_COLLECTION, packageId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Colis introuvable');
    const current = snap.data() as Package;
    const fields = cleanUndefined(extraFields || {});
    const unchanged = Object.entries(fields).every(([key, value]) =>
      current[key as keyof Package] === value
    );
    // Same status can still carry a new hub, assignment or ETA. Only an exact
    // replay is a no-op; dropping its fields left sorted parcels unassigned.
    if (current.status === status && unchanged) return null;
    if ([PackageStatus.DELIVERED, PackageStatus.RETURNED].includes(current.status) && current.status !== status) {
      throw new Error('Ce colis est déjà livré ou retourné. Son statut ne peut pas être réouvert.');
    }
    const now = new Date().toISOString();
    tx.update(ref, cleanUndefined({
      status, movements: [...(current.movements || []), { ...movement, timestamp: now }],
      ...fields, updatedAt: now
    }));
    return current;
  });
  if (!pkg) return;


};

/**
 * Répare un statut actif uniquement à partir d'une preuve SUCCESS publiée,
 * couvrant explicitement le colis et son affectation actuelle. Un arrêt terminé
 * seul ne prouve jamais la remise (livraison partielle, transfert, ancien arrêt).
 * La transaction relit preuves, mission et colis avant toute réparation ; les
 * compteurs reflètent ces mêmes lectures, sans écraser une livraison concurrente.
 */
export interface StatusResyncResult {
  completedStopPackages: number;
  fixedDelivered: number;
  skippedUnproven: number;
  skippedReassigned: number;
  failed: number; // tournées dont la vérification transactionnelle a échoué
  details: { packageId: string; orderNumber: string; from: string }[];
}

export const resyncPackageStatusesFromStops = async (): Promise<StatusResyncResult> => {
  const result: StatusResyncResult = {
    completedStopPackages: 0, fixedDelivered: 0, skippedUnproven: 0,
    skippedReassigned: 0, failed: 0, details: [],
  };
  const activeStatuses = new Set<PackageStatus>([
    PackageStatus.PENDING, PackageStatus.COLLECTED, PackageStatus.AT_HUB,
    PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED,
    PackageStatus.IN_DELIVERY,
  ]);
  const completedIds = new Set<string>();
  const unprovenIds = new Set<string>();
  const reassignedIds = new Set<string>();
  const fixedIds = new Set<string>();
  const missions = await getDocs(collection(db, MISSIONS_COLLECTION));
  for (const candidate of missions.docs) {
    if (!(candidate.data().stops || []).some((s: MissionStop) => s.type === 'DELIVERY' && s.status === StopStatus.COMPLETED)) continue;
    try {
      const checked = await runTransaction(db, async tx => {
        const missionRef = doc(db, MISSIONS_COLLECTION, candidate.id);
        const snapshot = await tx.get(missionRef);
        const outcome = { seen: [] as string[], unproven: [] as string[], reassigned: [] as string[], details: [] as StatusResyncResult['details'] };
        if (!snapshot.exists()) return outcome;
        const mission = snapshot.data() as Mission;
        const stops = (mission.stops || []).filter(s => s.type === 'DELIVERY' && s.status === StopStatus.COMPLETED);
        if (!stops.length) return outcome;
        const ids = [...new Set(mission.stops.flatMap(s => s.packageIds || []))];
        // Leave oversized/inconsistent historical tours for an explicit audit.
        if (ids.length > 450 || ids.some(id => !id || id.includes('/')) || stops.some(s => !s.id || s.id.includes('/'))) {
          throw new Error('Cette ancienne tournée doit être vérifiée individuellement par le bureau.');
        }
        const packages = await Promise.all(ids.map(id => tx.get(doc(db, PACKAGES_COLLECTION, id))));
        const proofs = await Promise.all(stops.map(stop => tx.get(doc(db, 'proofs_of_delivery', `${candidate.id}_${stop.id}`))));
        const byId = new Map(packages.filter(p => p.exists()).map(p => [p.id, p]));
        const repairs = new Map<string, { parcel: typeof packages[number]; pkg: Package; proof: Record<string, any> }>();
        const https = (value: unknown) => typeof value === 'string' && value.startsWith('https://');
        for (let index = 0; index < stops.length; index++) {
          const stop = stops[index];
          const proof = proofs[index].data();
          const validProof = proof?.type === 'SUCCESS' && proof.missionId === candidate.id && proof.stopId === stop.id &&
            !!mission.driverId && proof.driverId === mission.driverId && Array.isArray(proof.packageIds) &&
            Array.isArray(proof.photoUrls) && proof.photoUrls.length > 0 && proof.photoUrls.every(https) && https(proof.signatureUrl) &&
            typeof proof.recipientName === 'string' && !!proof.recipientName.trim() &&
            Number.isFinite(proof.coordinates?.lat) && Math.abs(proof.coordinates.lat) <= 90 &&
            Number.isFinite(proof.coordinates?.lng) && Math.abs(proof.coordinates.lng) <= 180 &&
            typeof proof.timestamp === 'string' && Number.isFinite(Date.parse(proof.timestamp));
          for (const id of stop.packageIds || []) {
            const parcel = byId.get(id);
            if (!parcel) continue;
            outcome.seen.push(id);
            const pkg = parcel.data() as Package;
            // Delivered, failed and return decisions are never rewritten.
            if (!activeStatuses.has(pkg.status)) continue;
            if (pkg.missionId !== candidate.id || pkg.stopId !== stop.id || pkg.currentDriverId !== mission.driverId ||
              (pkg.pod && (pkg.pod.missionId !== candidate.id || pkg.pod.stopId !== stop.id || pkg.pod.packageId !== id))) {
              outcome.reassigned.push(id);
              continue;
            }
            if (!validProof || !proof!.packageIds.includes(id)) {
              outcome.unproven.push(id);
              continue;
            }
            repairs.set(id, { parcel, pkg, proof: proof! });
          }
        }
        if (!repairs.size) return outcome;
        const now = new Date().toISOString();
        for (const [id, { parcel, pkg, proof }] of repairs) {
          tx.update(parcel.ref, cleanUndefined({
            status: PackageStatus.DELIVERED,
            ...(!pkg.pod ? { pod: { ...proof, packageId: id } } : {}),
            movements: [...(pkg.movements || []), {
              timestamp: now, action: 'DELIVERED', driverId: proof.driverId,
              driverName: proof.driverName || mission.driverName || '',
              notes: `Statut rétabli à partir de la preuve de remise du ${proof.timestamp}`,
            }], updatedAt: now,
          }));
          outcome.details.push({ packageId: id, orderNumber: pkg.orderNumber || pkg.externalId || id, from: String(pkg.status) });
        }
        // Count the latest parcels for this mission; a concurrent transaction
        // changes the read mission/parcels and triggers a complete retry.
        const deliveredStopIds = new Set(stops.flatMap(stop => stop.packageIds || []));
        const deliveredPackages = packages.filter(parcel => {
          if (!parcel.exists()) return false;
          const pkg = parcel.data() as Package;
          const belongs = deliveredStopIds.has(parcel.id) && (!pkg.missionId || pkg.missionId === candidate.id) &&
            (!pkg.currentDriverId || pkg.currentDriverId === mission.driverId);
          return belongs && (pkg.status === PackageStatus.DELIVERED || repairs.has(parcel.id));
        }).length;
        tx.update(missionRef, { deliveredPackages, updatedAt: now });
        return outcome;
      });
      checked.seen.forEach(id => completedIds.add(id));
      checked.unproven.forEach(id => unprovenIds.add(id));
      checked.reassigned.forEach(id => reassignedIds.add(id));
      for (const detail of checked.details) {
        if (!fixedIds.has(detail.packageId)) result.details.push(detail);
        fixedIds.add(detail.packageId);
      }
    } catch (error) {
      result.failed++;
      reportError('resync.mission', error, { silent: true, extra: { missionId: candidate.id } });
    }
  }
  result.completedStopPackages = completedIds.size;
  result.fixedDelivered = fixedIds.size;
  result.skippedUnproven = [...unprovenIds].filter(id => !fixedIds.has(id)).length;
  result.skippedReassigned = [...reassignedIds].filter(id => !fixedIds.has(id)).length;
  return result;
};

/**
 * Imports par lots de 150, identifiés côté serveur pour permettre une reprise sans doublon.
 */
export const addPackagesBatch = async (packages: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<string[]> => {
  const call=httpsCallable<any,{ids:string[]}>(getFunctions(app,'europe-west1'),'importPackages');
  const ids:string[]=[];
  for(let offset=0;offset<packages.length;offset+=150){
    try{ids.push(...(await call({packages:cleanUndefined(packages.slice(offset,offset+150))})).data.ids);}
    catch(error){throw new Error(`${ids.length} ligne(s) déjà enregistrée(s). Relancez l’import : les colis existants ne seront pas recréés. ${error instanceof Error?error.message:''}`);}
  }
  return ids;
};

// Code de suivi généré système pour un colis créé par le client (préfixe CL).
export const generateTrackingCode = (): string => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CL-${ymd}-${rand}`;
};

/**
 * Création d'une expédition self-service par le client (portail expéditeur).
 * Crée N colis (multi-colis 1/N…N/N) sur un même point de livraison, statut
 * PENDING (« à collecter »), zone fournie, codes de suivi système uniques.
 * Retourne les colis créés (avec id) pour impression immédiate des étiquettes.
 */
export const createClientShipment = async (params: {
  client: { id: string; companyName: string };
  recipient: { contactName: string; address: string; city: string; postalCode: string; contactPhone?: string; contactEmail?: string };
  zone: Zone;
  packageCount: number;
  weight?: number;
  volume?: number;
  comment?: string;
  clientReference?: string;
  /** Keep the same UUID when retrying an uncertain creation. */
  requestId?: string;
}): Promise<Package[]> => {
  const { client, recipient, zone } = params;
  const total = Math.max(1, Math.min(Number(params.packageCount) || 1, 50));
  const now = new Date().toISOString();
  const requestId = params.requestId || crypto.randomUUID();

  const toCreate: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  for (let i = 1; i <= total; i++) {
    const code = trackingCodeForRequest(requestId, i);
    toCreate.push({
      clientId: client.id,
      clientName: client.companyName,
      importBatchId: 'client-self-service',
      externalId: code,
      orderNumber: code,
      barcode: code,
      address: recipient.address,
      city: recipient.city,
      postalCode: recipient.postalCode,
      zone,
      contactName: recipient.contactName,
      contactPhone: recipient.contactPhone,
      contactEmail: recipient.contactEmail,
      serviceTime: 5,
      comment: params.comment,
      weight: params.weight,
      volume: params.volume,
      clientReference: params.clientReference,
      createdByClient: true,
      packageIndex: i,
      packageTotal: total,
      status: PackageStatus.PENDING,
      movements: [{
        timestamp: now,
        action: 'IMPORTED' as const,
        notes: `Créé par l'expéditeur ${client.companyName}${params.clientReference ? ` — réf ${params.clientReference}` : ''}`
      }]
    } as Omit<Package, 'id' | 'createdAt' | 'updatedAt'>);
  }

  const ids = await addPackagesBatch(toCreate);
  return toCreate.map((p, idx) => ({ ...(p as Package), id: ids[idx], createdAt: now, updatedAt: now }));
};

/**
 * Import en masse d'expéditions par l'expéditeur (fichier Excel/CSV).
 * Une ligne = un colis, identifié par SON numéro (ex. BR-…), qui devient
 * l'identité du colis (externalId/barcode/orderNumber). Écriture groupée.
 * La zone est estimée depuis l'adresse (défaut Nord, ajustable par le transporteur).
 */
export const createClientShipmentsBatch = async (params: {
  client: { id: string; companyName: string };
  deliveryDate?: string;   // Jour de livraison souhaité (YYYY-MM-DD) — daté sur chaque colis
  rows: Array<{
    colisNumber: string;   // ex. BR-000123
    contactName: string;
    address: string;
    postalCode: string;
    city: string;
    contactPhone?: string;
    contactEmail?: string;
    weight?: number;
    clientReference?: string;
    comment?: string;
    zone?: Zone;           // estimée en amont (défaut Nord, ajustée par le transporteur)
  }>;
}): Promise<Package[]> => {
  const { client, rows, deliveryDate } = params;
  const now = new Date().toISOString();
  const batchId = `client-import-${now}`;

  const toCreate: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  for (const r of rows) {
    const zone: Zone = r.zone || Zone.NORD;
    const cp = r.postalCode;
    const code = r.colisNumber.trim();
    toCreate.push({
      clientId: client.id,
      clientName: client.companyName,
      importBatchId: batchId,
      externalId: code,
      orderNumber: code,
      barcode: code,
      address: r.address,
      city: r.city,
      postalCode: cp,
      zone,
      contactName: r.contactName,
      contactPhone: r.contactPhone,
      contactEmail: r.contactEmail,
      serviceTime: 5,
      comment: r.comment,
      weight: r.weight,
      clientReference: r.clientReference,
      createdByClient: true,
      requestedDeliveryDate: deliveryDate || undefined,
      packageIndex: 1,
      packageTotal: 1,
      status: PackageStatus.PENDING,
      movements: [{
        timestamp: now,
        action: 'IMPORTED' as const,
        notes: `Importé par l'expéditeur ${client.companyName} — colis ${code}${deliveryDate ? ` — à livrer le ${deliveryDate}` : ''}`
      }]
    } as Omit<Package, 'id' | 'createdAt' | 'updatedAt'>);
  }

  const ids = await addPackagesBatch(toCreate);
  return toCreate.map((p, idx) => ({ ...(p as Package), id: ids[idx], createdAt: now, updatedAt: now }));
};

// ============================================================================
// MISSIONS
// ============================================================================

/**
 * Suivi live côté expéditeur : dénormalise la position du livreur + le nombre de
 * colis restants avant chacun, dans un document de suivi propre à chaque client.
 * Le client ne lit que ses propres colis (règles Firestore) → aucune fuite entre
 * clients. Appelé ~toutes les 30s par le téléphone du chauffeur.
 */
let trackingCache: {key: string; packages: Package[]} | null = null;
export const publishLiveTrackingForMission = async (
  mission: Mission,
  driverPos: { lat: number; lng: number },
  driverName: string
): Promise<void> => {
  if (mission.status !== MissionStatus.IN_PROGRESS) return;
  const activeStops = (mission.stops || []).filter(s => s.type === 'DELIVERY' && ![StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED].includes(s.status)).sort((a,b)=>a.sequence-b.sequence);
  const key = JSON.stringify([mission.id, activeStops.map(s=>[s.id,s.packageIds])]);
  // Package ownership is read again whenever the active stops change.
  if (trackingCache?.key !== key) trackingCache = {key, packages: await getPackagesByIds(activeStops.flatMap(s=>s.packageIds))};
  const packages = new Map(trackingCache.packages.map(p=>[p.id,p]));
  const groups = new Map<string, {clientId:string;clientName:string;ranks:Record<string,number>}>();
  let before = 0;
  for (const stop of activeStops) {
    for (const id of stop.packageIds) {
      const pkg = packages.get(id);
      if (!pkg?.clientId || pkg.currentDriverId !== mission.driverId || pkg.missionId !== mission.id) continue;
      const group = groups.get(pkg.clientId) || {clientId:pkg.clientId,clientName:pkg.clientName || '',ranks:{}};
      group.ranks[id] = before; groups.set(pkg.clientId,group);
    }
    before += stop.packageIds.length;
  }
  const now = new Date().toISOString();
  const entries = Array.from(groups.values());
  for (let offset=0; offset<entries.length; offset+=400) {
    const batch = writeBatch(db);
    for (const group of entries.slice(offset,offset+400)) batch.set(doc(db,'client_tracking',`${mission.id}_${group.clientId}`),{
      ...group,missionId:mission.id,driverId:mission.driverId,
      liveDriver:{...driverPos,driverName,updatedAt:now}
    });
    await batch.commit();
  }
};

export const subscribeToMissions = (
  callback: (missions: Mission[]) => void,
  filters?: { date?: string; zone?: Zone; status?: MissionStatus; driverId?: string },
  onError?: (error: Error) => void
) => {
  // À l'échelle, un `limit(100)` global trié par date pouvait EXCLURE la tournée
  // d'un chauffeur (>100 tournées récentes le même jour) → le chauffeur ouvre
  // l'app et ne voit AUCUNE tournée. Quand on filtre par chauffeur, on interroge
  // donc le serveur par `driverId` (aucun index composite requis, périmètre borné
  // à ses tournées) au lieu de récupérer les 100 dernières puis filtrer côté client.
  const q = filters?.driverId
    ? query(collection(db, MISSIONS_COLLECTION), where('driverId', '==', filters.driverId))
    : filters?.date
      ? query(collection(db, MISSIONS_COLLECTION), where('date', '==', filters.date))
      : query(collection(db, MISSIONS_COLLECTION), orderBy('date', 'desc'));

  return onSnapshot(q, (snapshot) => {
    let missions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mission));

    if (filters?.date) {
      missions = missions.filter(m => m.date === filters.date);
    }
    if (filters?.zone) {
      missions = missions.filter(m => m.zone === filters.zone);
    }
    if (filters?.status) {
      missions = missions.filter(m => m.status === filters.status);
    }
    if (filters?.driverId) {
      missions = missions.filter(m => m.driverId === filters.driverId);
    }
    
    callback(missions);
  }, onError);
};

export const getMissionById = async (id: string): Promise<Mission | null> => {
  const docSnap = await getDoc(doc(db, MISSIONS_COLLECTION, id));
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() } as Mission;
};

export const getMissionsByDriver = async (driverId: string, date: string): Promise<Mission[]> => {
  const q = query(
    collection(db, MISSIONS_COLLECTION),
    where('driverId', '==', driverId),
    where('date', '==', date)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mission));
};

export const addMission = async (mission: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, MISSIONS_COLLECTION), cleanUndefined({
    ...mission,
    createdAt: now,
    updatedAt: now
  }));
  return docRef.id;
};

export const updateMission = async (mission: Mission): Promise<void> => {
  const { id, ...data } = mission;
  await updateDoc(doc(db, MISSIONS_COLLECTION, id), cleanUndefined({
    ...data,
    updatedAt: new Date().toISOString()
  }));
};

/**
 * Mise à jour partielle d'une mission (merge).
 * Utile pour modifier quelques champs sans envoyer toute la mission.
 */
export const updateMissionFields = async (
  missionId: string,
  fields: Partial<Omit<Mission, 'id' | 'createdAt'>>
): Promise<void> => {
  // cleanUndefined OBLIGATOIRE (comme updateMission) : les appelants passent des
  // stops avec des champs `|| undefined` (contactPhone, timeWindow, notes…), et
  // Firestore REJETTE tout undefined imbriqué → écriture perdue (bug 3ca5be7).
  await updateDoc(doc(db, MISSIONS_COLLECTION, missionId), cleanUndefined({
    ...fields,
    updatedAt: new Date().toISOString()
  }));
};

/** Office edits always read fresh stops and preserve concurrent delivery data. */
export const updateMissionStopFields = editMissionStop;
export const removeMissionStop = deleteMissionStop;
export const reorderMissionStops = reorderStops;

/**
 * Valide l'issue d'UN arrêt (livré / échoué / arrivé) de façon ATOMIQUE.
 *
 * Avant, la livraison faisait `updateMission({...activeMission, stops, compteurs})`
 * = réécriture de TOUT le document depuis un instantané en mémoire potentiellement
 * périmé. Deux effets de bord graves :
 *  - un transfert concurrent (qui retire un colis de la tournée par transaction)
 *    était ÉCRASÉ → le colis « ressuscitait » dans la tournée ;
 *  - livrer l'arrêt B juste après A, avant le retour du listener, réécrivait les
 *    compteurs de A (sous-comptage) et pouvait repasser A en attente.
 *
 * Ici on relit la mission FRAÎCHE dans une transaction, on ne modifie QUE l'arrêt
 * ciblé, et on recalcule les compteurs à partir des stops frais. Les compteurs
 * colis (deliveredPackages/failedPackages) sont incrémentés sur la valeur FRAÎCHE.
 */
export const commitStopOutcome = async (params: {
  missionId: string;
  stopId: string;
  stopPatch: Partial<MissionStop>;
  deliveredDelta?: number;
  failedDelta?: number;
  packageOutcomes?: Array<{ packageId: string; status: PackageStatus; movement: Omit<PackageMovement, 'timestamp'> }>;
}): Promise<{ allDone: boolean; stops: MissionStop[] }> => {
  const ref = doc(db, MISSIONS_COLLECTION, params.missionId);
  const now = new Date().toISOString();
  const terminal = (s: StopStatus) => [StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED].includes(s);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const m = snap.data() as Mission;
    const prev = m.stops.find(s => s.id === params.stopId);
    if (!prev) throw new Error('Cet arrêt a été déplacé ou supprimé. Actualisez la tournée.');
    if (terminal(prev.status)) {
      if (params.stopPatch.status && params.stopPatch.status !== prev.status) {
        throw new Error('Cet arrêt est déjà terminé. Sa décision ne peut plus être modifiée.');
      }
      // A replay or a delayed GPS callback cannot reopen or rewrite a completed delivery.
      return { allDone: m.stops.every(s => terminal(s.status)), stops: m.stops };
    }
    if ([MissionStatus.COMPLETED, MissionStatus.CANCELLED].includes(m.status)) {
      throw new Error('Cette tournée est clôturée.');
    }
    const outcomes = params.packageOutcomes || [];
    if (new Set(outcomes.map(o => o.packageId)).size !== outcomes.length || outcomes.length > 450) {
      throw new Error('Liste de colis invalide ou trop volumineuse.');
    }
    if (outcomes.length && params.stopPatch.status && terminal(params.stopPatch.status) &&
      (outcomes.length !== prev.packageIds.length || prev.packageIds.some(id => !outcomes.some(o => o.packageId === id)))) {
      throw new Error('La liste des colis de cet arrêt a changé. Actualisez et vérifiez tous les colis avant de valider.');
    }
    const pkgSnaps = await Promise.all(outcomes.map(o => tx.get(doc(db, PACKAGES_COLLECTION, o.packageId))));
    for (let i=0; i<outcomes.length; i++) {
      const p = pkgSnaps[i];
      if (!p.exists() || !prev.packageIds.includes(p.id)) throw new Error('Un colis ne fait plus partie de cet arrêt.');
      const data = p.data() as Package;
      if ((data.missionId && data.missionId !== params.missionId) ||
          (data.stopId && data.stopId !== params.stopId) ||
          (data.currentDriverId && m.driverId && data.currentDriverId !== m.driverId)) {
        throw new Error('Un colis a été transféré à un autre chauffeur. Actualisez la tournée.');
      }
      if ([PackageStatus.DELIVERED, PackageStatus.RETURNED].includes(data.status) && data.status !== outcomes[i].status) {
        throw new Error('Un colis a déjà été livré ou retourné. Actualisez la tournée.');
      }
    }
    const delivered = outcomes.length ? outcomes.filter(o => o.status === PackageStatus.DELIVERED).length : (params.deliveredDelta || 0);
    const failed = outcomes.length ? outcomes.filter(o => o.status === PackageStatus.FAILED).length : (params.failedDelta || 0);
    if (delivered < 0 || failed < 0 || delivered + failed > prev.packageIds.length) throw new Error('Comptage des colis incohérent.');
    const cleanPatch = cleanUndefined({
      ...params.stopPatch,
      ...(outcomes.length && params.stopPatch.status && terminal(params.stopPatch.status)
        ? { proofSyncPending: true } : {})
    }) as Partial<MissionStop>;
    const stops = m.stops.map(s => s.id === params.stopId ? { ...s, ...cleanPatch } : s);
    for (let i=0; i<outcomes.length; i++) {
      const outcome=outcomes[i], p=pkgSnaps[i].data() as Package;
      tx.update(pkgSnaps[i].ref, cleanUndefined({status:outcome.status,
        missionId:params.missionId,stopId:params.stopId,currentDriverId:m.driverId,currentVehicleId:m.vehicleId,
        movements:[...(p.movements || []),{...outcome.movement,timestamp:now}],updatedAt:now}));
    }
    const counters = recomputeMissionCounters(stops);
    tx.update(ref, {
      stops, ...counters,
      // A non-delivered parcel remains part of the original mission's total.
      totalPackages: Math.max(m.totalPackages || 0, counters.totalPackages),
      deliveredPackages:(m.deliveredPackages || 0)+delivered,
      failedPackages:(m.failedPackages || 0)+failed,
      status:MissionStatus.IN_PROGRESS,updatedAt:now
    });
    return { allDone: stops.every(s => terminal(s.status)), stops };
  });
};

export const updateMissionStatus = async (missionId: string, status: MissionStatus): Promise<void> => {
  if (status === MissionStatus.COMPLETED) {
    await httpsCallable(getFunctions(app, 'europe-west1'), 'finishMission')({ missionId });
    return;
  }
  const updates: any = { status, updatedAt: new Date().toISOString() };
  
  if (status === MissionStatus.IN_PROGRESS) {
    updates.startedAt = new Date().toISOString();
  }
  
  await updateDoc(doc(db, MISSIONS_COLLECTION, missionId), updates);
};

/** Start from fresh server state so a transfer or one failed package update
 * cannot leave half of a tour loaded or restore its previous stop list. */
export const startDriverMission = async (
  missionId: string,
  params: { driverId: string; driverName: string; startedAt: string; coordinates: { lat: number; lng: number } }
): Promise<MissionStop[]> => {
  const missionRef = doc(db, MISSIONS_COLLECTION, missionId);
  return runTransaction(db, async tx => {
    const snap = await tx.get(missionRef);
    if (!snap.exists()) throw new Error('Tournée introuvable.');
    const mission = snap.data() as Mission;
    if (mission.driverId !== params.driverId) throw new Error('Cette tournée ne vous est pas affectée.');
    if ([MissionStatus.COMPLETED, MissionStatus.CANCELLED].includes(mission.status)) {
      throw new Error('Cette tournée est clôturée.');
    }
    if (mission.loadedAt && mission.status === MissionStatus.IN_PROGRESS) return mission.stops;
    const parcelIds = mission.stops.flatMap(s => s.packageIds || []);
    if (new Set(parcelIds).size !== parcelIds.length || parcelIds.length > 450) {
      throw new Error('La liste des colis doit être vérifiée par le bureau avant le départ.');
    }
    if (mission.stops.some(s => [StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED].includes(s.status))) {
      throw new Error('Cette tournée a déjà des arrêts traités. Actualisez la tournée.');
    }
    const parcels = await Promise.all(parcelIds.map(id => tx.get(doc(db, PACKAGES_COLLECTION, id))));
    for (const parcel of parcels) {
      if (!parcel.exists()) throw new Error('Un colis de la tournée est introuvable. Contactez le bureau.');
      const p = parcel.data() as Package;
      if (p.missionId !== missionId || (p.currentDriverId && p.currentDriverId !== params.driverId) ||
        [PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.FAILED, PackageStatus.RETURN_REQUESTED].includes(p.status)) {
        throw new Error('Un colis a été transféré ou traité. Actualisez la tournée avant de partir.');
      }
    }
    const plannedDeparture = mission.plannedDepartureTime
      ? `${mission.date}T${mission.plannedDepartureTime}:00+04:00` : undefined;
    const stops = recalculateStopEtas(mission.stops, params.startedAt, plannedDeparture);
    const byId = new Map(parcels.map(p => [p.id, p]));
    for (const stop of stops) {
      for (const id of stop.packageIds) {
        const parcel = byId.get(id)!;
        const p = parcel.data() as Package;
        // A pickup is still awaiting collection until it is actually scanned.
        const status = stop.type === 'PICKUP' ? p.status : PackageStatus.IN_DELIVERY;
        tx.update(parcel.ref, cleanUndefined({
          status, missionId, stopId: stop.id, currentDriverId: params.driverId,
          currentVehicleId: mission.vehicleId || null, estimatedDeliveryAt: stop.estimatedArrival || null,
          movements: [...(p.movements || []), {
            timestamp: params.startedAt, action: 'LOADING_COMPLETE',
            driverId: params.driverId, driverName: params.driverName,
            location: params.coordinates, notes: 'Chargement terminé — départ de tournée'
          }], updatedAt: params.startedAt
        }));
      }
    }
    tx.update(missionRef, cleanUndefined({
      status: MissionStatus.IN_PROGRESS, loadedAt: params.startedAt,
      startedAt: params.startedAt, stops, updatedAt: params.startedAt
    }));
    return stops;
  });
};

export const deleteMission = async (id: string): Promise<void> => {
  const packages = await getDocs(query(collection(db, PACKAGES_COLLECTION), where('missionId', '==', id), limit(1)));
  if (!packages.empty) throw new Error('Cette tournée contient des colis. Annulez-la et réaffectez les colis avant suppression.');
  await deleteDoc(doc(db, MISSIONS_COLLECTION, id));
};

// ============================================================================
// IMPORT BATCHES
// ============================================================================

export const subscribeToImportBatches = (
  callback: (batches: ImportBatch[]) => void,
  limitCount: number = 50,
  onError?: (error: Error) => void
) => {
  const q = query(collection(db, IMPORTS_COLLECTION), orderBy('importedAt', 'desc'), limit(limitCount));
  
  return onSnapshot(q, (snapshot) => {
    const batches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportBatch));
    callback(batches);
  }, onError);
};

export const addImportBatch = async (batch: Omit<ImportBatch, 'id'>): Promise<string> => {
  const docRef = await addDoc(collection(db, IMPORTS_COLLECTION), cleanUndefined(batch));
  return docRef.id;
};

export const updateImportBatch = async (batch: ImportBatch): Promise<void> => {
  const { id, ...data } = batch;
  await updateDoc(doc(db, IMPORTS_COLLECTION, id), cleanUndefined(data));
};

/**
 * Récupère des colis par leurs identifiants (pour reconsulter un lot d'import).
 * Fiable même pour les imports anciens (hors des 500 colis récents chargés en
 * temps réel), car on lit directement les documents demandés.
 */
export const getPackagesByIds = async (ids: string[]): Promise<Package[]> => {
  const uniq = [...new Set(ids.filter(Boolean))];
  // Lectures EN PARALLÈLE par lots (plus de N allers-retours séquentiels qui
  // pouvaient faire traîner/timeouter la resync sur gros volume).
  const out: Package[] = [];
  const BATCH = 50;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const slice = uniq.slice(i, i + BATCH);
    const snaps = await Promise.all(slice.map(id => getDoc(doc(db, PACKAGES_COLLECTION, id))));
    for (const snap of snaps) {
      if (snap.exists()) out.push({ id: snap.id, ...snap.data() } as Package);
    }
  }
  return out.sort((a, b) =>
    (a.externalId || a.orderNumber || '').localeCompare(b.externalId || b.orderNumber || ''));
};

/**
 * Manifeste d'enlèvement : colis encore EN ATTENTE (non pris en charge) à contrôler
 * « X pris / N attendus + lesquels manquent ».
 *
 * Quand on connaît le LOT D'IMPORT du colis scanné, on cible CE lot (requête par
 * `importBatchId` seul → aucun index composite, un lot = un client), puis filtre
 * client + statut côté client. Sinon d'anciens colis PENDING jamais enlevés (autres
 * lots) apparaissaient en « manquants » fantômes → le contrôle de complétude
 * n'aboutissait JAMAIS et le chauffeur apprenait à ignorer l'alerte. Repli : requête
 * par clientId seul (colis créés à l'unité, sans lot).
 */
export const getPendingPackagesForClient = async (clientId: string, importBatchId?: string): Promise<Package[]> => {
  if (!clientId) return [];
  const sortPending = (docs: Package[]) => docs
    .filter(p => p.status === PackageStatus.PENDING)
    .sort((a, b) => (a.externalId || a.orderNumber || '').localeCompare(b.externalId || b.orderNumber || ''));

  if (importBatchId) {
    const snap = await getDocs(query(
      collection(db, PACKAGES_COLLECTION),
      where('importBatchId', '==', importBatchId),
      limit(3000)
    ));
    return sortPending(snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Package))
      .filter(p => p.clientId === clientId));
  }

  const snap = await getDocs(query(
    collection(db, PACKAGES_COLLECTION),
    where('clientId', '==', clientId),
    limit(3000)
  ));
  return sortPending(snap.docs.map(d => ({ id: d.id, ...d.data() } as Package)));
};

/**
 * Codes colis (externalId/orderNumber, normalisés MAJUSCULE) DÉJÀ existants pour un
 * client. Sert à la déduplication INTER-IMPORTS : ré-importer un fichier corrigé
 * créait auparavant chaque colis en DOUBLE (le `barcode` généré étant aléatoire, rien
 * ne collisionnait) → le chauffeur se voyait annoncer 2× les cartons réels.
 */
export const getExistingClientPackageCodes = async (clientId: string): Promise<Set<string>> => {
  const set = new Set<string>();
  if (!clientId) return set;
  const snap = await getDocs(query(
    collection(db, PACKAGES_COLLECTION),
    where('clientId', '==', clientId),
    limit(5000)
  ));
  for (const d of snap.docs) {
    const p = d.data() as Package;
    const code = (p.externalId || p.orderNumber || '').trim().toUpperCase();
    if (code) set.add(code);
  }
  return set;
};

// ============================================================================
// TRANSFERS
// ============================================================================

export const subscribeToTransfers = (
  callback: (transfers: PackageTransfer[]) => void,
  filters?: { date?: string; driverId?: string }
) => {
  const q = query(collection(db, TRANSFERS_COLLECTION), orderBy('timestamp', 'desc'), limit(100));
  
  return onSnapshot(q, (snapshot) => {
    let transfers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PackageTransfer));
    
    if (filters?.date) {
      transfers = transfers.filter(t => localDatePart(t.timestamp) === filters.date!);
    }
    if (filters?.driverId) {
      transfers = transfers.filter(t => 
        t.fromDriverId === filters.driverId || t.toDriverId === filters.driverId
      );
    }
    
    callback(transfers);
  });
};

export const addTransfer = async (transfer: Omit<PackageTransfer, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, TRANSFERS_COLLECTION), cleanUndefined({
    ...transfer,
    createdAt: now,
    updatedAt: now
  }));
  return docRef.id;
};

export const confirmTransfer = async (transferId: string, toSignatureUrl?: string): Promise<void> => {
  const now = new Date().toISOString();
  await updateDoc(doc(db, TRANSFERS_COLLECTION, transferId), {
    status: TransferStatus.CONFIRMED,
    toSignatureUrl: toSignatureUrl || null,
    confirmedAt: now,
    updatedAt: now
  });
};

// ── Recherche colis par code scanné — SOCLE COMMUN (une seule logique) ───────
// Les deux points d'entrée (findPackageByCode / findDispatchedPackageByCode)
// partageaient jadis 90% du code MAIS divergeaient sur un détail critique :
// seul findPackageByCode appliquait extractScanTokens (isole le BR… d'un
// DataMatrix, retire le rang -002). Résultat : la passation entre chauffeurs
// échouait sur des étiquettes qui marchaient partout ailleurs. On centralise :
// mêmes candidats, même requête ; une référence partagée demande un code individuel.

/** Candidats de recherche extraits d'un code scanné : chaîne brute + tokens
 *  (N° colis BR…, N° commande, version sans rang). Couvre les DataMatrix clients. */
const scanSearchCandidates = (code: string): string[] => {
  const list = [code.trim(), code.trim().toUpperCase(), ...extractScanTokens(code)].filter(Boolean);
  return [...new Set(list)];
};

/** Requête Firestore : renvoie le 1er lot de colis correspondant à un candidat.
 *  Champs testés dans l'ordre : identifiants uniques d'abord, clientReference
 *  (N° de commande potentiellement partagé) en DERNIER. */
const queryPackagesByCandidates = async (uniq: string[]): Promise<Package[]> => {
  for (const field of ['barcode', 'externalId', 'orderNumber', 'clientReference'] as const) {
    for (const value of uniq) {
      const snap = await getDocs(query(
        collection(db, PACKAGES_COLLECTION),
        where(field, '==', value),
        limit(2)
      ));
      if (snap.size > 1) throw new Error('Ce code correspond à plusieurs colis. Scannez le code individuel DELIVREX ou saisissez le numéro imprimé sur ce carton.');
      if (!snap.empty) return snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
    }
  }
  const hint = orderReferenceHint(uniq[0] || '');
  if (hint) {
    const orders = await getDocs(query(collection(db, PACKAGES_COLLECTION), where('clientReference', '==', hint), limit(1)));
    if (!orders.empty) throw new Error(orderReferenceMessage(hint));
  }
  return [];
};

/**
 * Retrouve un colis dispatché à partir d'un code scanné (tracking GFL,
 * N° colis client type BR0513, ou N° de commande). Utilisé pour les
 * transferts en route : le colis peut appartenir à n'importe quelle tournée.
 * Un code partagé est refusé : le statut actif ne prouve pas l'identité du carton.
 */
export const findDispatchedPackageByCode = async (code: string): Promise<Package | null> => {
  const uniq = scanSearchCandidates(code);
  if (uniq.length === 0) return null;
  const pkgs = await queryPackagesByCandidates(uniq);
  if (pkgs.length === 0) return null;
  return pkgs[0];
};

/**
 * Recherche un colis par n'importe quel code : tracking interne GFL,
 * N° colis client (externalId, ex BR0513), ou N° de commande (ex 13926865).
 * Repli : si le code scanné se termine par un suffixe d'index (ex "13926865-002"
 * ou "13926865002" pour "colis 02"), on réessaie sur le N° de commande nu —
 * les étiquettes clients encodent souvent commande + rang du colis.
 * Un code partagé demande le numéro individuel, sans choisir le plus récent.
 */
export const findPackageByCode = async (code: string): Promise<Package | null> => {
  const uniq = scanSearchCandidates(code);
  if (uniq.length === 0) return null;
  const pkgs = await queryPackagesByCandidates(uniq);
  if (pkgs.length === 0) return null;
  return pkgs[0];
};

export interface RoadTransferInput {
  packages: Package[];                       // Colis à récupérer (tournées d'autres chauffeurs)
  toMission: Mission;                        // Mission du chauffeur receveur
  toDriver: { id: string; name: string };
  reason: TransferReason;
  location?: { lat: number; lng: number };
  notes?: string;
  newStatus?: PackageStatus;                 // Statut à appliquer aux colis (ex : IN_DELIVERY à la prise en charge)
  claimMode?: boolean;                       // true = prise en charge (scan terrain) plutôt que transfert entre tournées
}

/**
 * TRANSFERT EN ROUTE : le chauffeur receveur a scanné des colis remis par un
 * autre chauffeur (point de rencontre). Pour chaque colis :
 * - retiré de la tournée d'origine (stop vidé → SKIPPED, compteurs à jour)
 * - ajouté à la tournée du receveur (nouveaux stops groupés par adresse)
 * - colis mis à jour (mission, stop, chauffeur, mouvement TRANSFERRED)
 * - un document package_transfers par tournée d'origine (traçabilité)
 */
// Recompteurs cohérents d'une mission à partir de ses stops
export const recomputeMissionCounters = (stops: MissionStop[]) => ({
  totalPackages: stops.reduce((a, s) => a + (s.packageCount || 0), 0),
  completedStops: stops.filter(s => s.status === StopStatus.COMPLETED).length,
  failedStops: stops.filter(s => s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length,
});

export const transferPackagesToDriver = async (input: RoadTransferInput): Promise<number> => {
  const call=httpsCallable<any,{count:number}>(getFunctions(app,'europe-west1'),'transferPackages');
  return (await call({packageIds:input.packages.map(p=>p.id),missionId:input.toMission.id,reason:input.reason,claimMode:!!input.claimMode,notes:input.notes || ''})).data.count;
};

/**
 * Récupère (ou crée) la tournée de LIVRAISON du jour d'un chauffeur.
 * Une seule mission DELIVERY par chauffeur et par jour, alimentée au fil des
 * prises en charge par scan.
 */
export const getOrCreateDriverDeliveryMission = async (
  driver: { id: string; name: string },
  date: string,
  vehicle?: { id?: string; plate?: string }
): Promise<Mission> => {
  // ID DÉTERMINISTE (une seule tournée de prise en charge par chauffeur/jour) :
  // deux scans simultanés convergent sur le même document → plus de doublon.
  const id = `DLV-${driver.id}-${date}`;
  const ref = doc(db, MISSIONS_COLLECTION, id);
  const now = new Date().toISOString();

  // VÉHICULE : priorité au véhicule passé, sinon on reprend AUTOMATIQUEMENT le
  // véhicule du chauffeur (les tournées créées par scan n'en passaient aucun →
  // livraisons sans véhicule). Le lien est stocké CÔTÉ VÉHICULE (vehicle.driverId
  // ou assignedDriverId == chauffeur), et la plaque brute est `licensePlate`
  // (le champ `plate` du type n'existe qu'après mapping applicatif). Hors transaction.
  let vehicleId = vehicle?.id;
  let vehiclePlate = vehicle?.plate;
  if (!vehicleId) {
    try {
      let vdoc = (await getDocs(query(collection(db, 'vehicles'), where('driverId', '==', driver.id)))).docs[0];
      if (!vdoc) {
        vdoc = (await getDocs(query(collection(db, 'vehicles'), where('assignedDriverId', '==', driver.id)))).docs[0];
      }
      if (vdoc) {
        const vd = vdoc.data() as any;
        vehicleId = vdoc.id;
        vehiclePlate = vd.licensePlate || vd.plate;
        // Lien bidirectionnel : renseigne le côté user si manquant (self-heal).
        if (vd.driverId === driver.id || vd.assignedDriverId === driver.id) {
          updateDoc(doc(db, 'users', driver.id), { assignedVehicleId: vdoc.id }).catch(() => {});
        }
      }
    } catch { /* best-effort : à défaut, tournée sans véhicule (nettoyé plus bas) */ }
  }

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const existing = { id, ...snap.data() } as Mission;
      // Tournée du jour déjà créée sans véhicule → on la complète.
      if (!existing.vehicleId && vehicleId) {
        tx.update(ref, cleanUndefined({ vehicleId, vehiclePlate, updatedAt: now }));
        return { ...existing, vehicleId, vehiclePlate } as Mission;
      }
      return existing;
    }
    const mission = cleanUndefined({
      type: MissionType.DELIVERY,
      zone: Zone.NORD,
      hubId: '',
      hubName: 'Prise en charge terrain',
      date,
      vehicleId,
      vehiclePlate,
      driverId: driver.id,
      driverName: driver.name,
      stops: [],
      totalPackages: 0,
      completedStops: 0,
      failedStops: 0,
      deliveredPackages: 0,
      failedPackages: 0,
      totalDistance: 0,
      estimatedDuration: 0,
      status: MissionStatus.IN_PROGRESS,
      createdBy: driver.id,
      createdByName: driver.name,
      createdAt: now,
      updatedAt: now
    });
    tx.set(ref, mission);
    return { id, ...mission } as Mission;
  });
};

/**
 * PRISE EN CHARGE PAR SCAN : le chauffeur scanne des colis (importés non
 * affectés, ou déjà à un autre chauffeur) → ils rejoignent SA tournée de
 * livraison du jour (statut En livraison), avec un arrêt de livraison à
 * l'adresse du destinataire. Si un colis appartenait à un autre chauffeur,
 * il en est retiré (traçabilité transfert).
 */
export const claimPackagesForDelivery = async (params: {
  packages: Package[];
  driver: { id: string; name: string };
  vehicle?: { id?: string; plate?: string };
  date: string;
  location?: { lat: number; lng: number };
  // Mission cible : quand le chauffeur RÉCUPÈRE des colis alors qu'une tournée est
  // déjà EN COURS (dispatchée ou de scan), on ajoute à CETTE tournée — sinon les
  // colis partaient dans une 2ᵉ mission « DLV-… » séparée et n'apparaissaient jamais
  // dans la tournée qu'il livre (« j'ai pris le colis mais il n'est pas là »).
  targetMissionId?: string;
}): Promise<number> => {
  if (!params.packages.length) throw new Error('Aucun colis à prendre en charge');
  let count = 0;
  for (const pkg of params.packages) {
    const receipt = await scanPackage({ packageId: pkg.id, driverId: params.driver.id, targetMissionId: params.targetMissionId, source: 'quick-scan' });
    if (!receipt.accepted) throw new Error(receipt.message);
    count++;
  }
  return count;
};

/**
 * CRÉATION À LA VOLÉE : le chauffeur a un carton en main qui n'a pas été importé.
 * Il le crée depuis l'étiquette et le prend directement en charge dans sa tournée
 * de livraison. Marqué comme "hors import" pour réconciliation par le bureau.
 */
export const createAndClaimPackage = async (params: {
  code: string;
  clientId: string;
  clientName: string;
  contactName: string;
  address: string;
  postalCode: string;
  city: string;
  contactPhone?: string;
  driver: { id: string; name: string };
  date: string;
  location?: { lat: number; lng: number };
  // Comme pour la récupération : rejoint la tournée EN COURS si fournie, sinon
  // la tournée de récupération du jour.
  targetMissionId?: string;
}): Promise<Package> => {
  const now = new Date().toISOString();
  const code = params.code.trim();
  const zone = (await getZoneFromPostalCode(params.postalCode.trim())) || Zone.NORD;

  const pkgData = cleanUndefined({
    clientId: params.clientId,
    clientName: params.clientName,
    importBatchId: `MANUEL-${params.date}`,
    externalId: code,
    orderNumber: code,
    address: params.address.trim(),
    city: params.city.trim(),
    postalCode: params.postalCode.trim(),
    zone,
    contactName: params.contactName.trim() || 'Destinataire',
    contactPhone: params.contactPhone?.trim() || undefined,
    serviceTime: 5,
    status: PackageStatus.PENDING,
    currentDriverId: params.driver.id, // requis par les règles pour la création chauffeur
    comment: '⚠️ Créé à la volée (hors import) — à réconcilier',
    movements: [{
      timestamp: now,
      action: 'IMPORTED' as const,
      driverId: params.driver.id,
      driverName: params.driver.name,
      notes: `Colis créé à la volée par ${params.driver.name} (carton hors import)`
    }],
    createdAt: now,
    updatedAt: now
  });

  // A failed confirmation must not create a second physical parcel on retry.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`adhoc/${params.clientId}/${code.toUpperCase()}`));
  const id = `adhoc-${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
  const ref = doc(db, PACKAGES_COLLECTION, id);
  const created = await runTransaction(db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) return { id, ...existing.data() } as Package;
    tx.set(ref, pkgData);
    return { id, ...pkgData } as Package;
  });
  const receipt = await scanPackage({ packageId: created.id, driverId: params.driver.id, targetMissionId: params.targetMissionId, source: 'manual-create' });
  if (!receipt.accepted) throw new Error(receipt.message);
  return { ...created, missionId: receipt.missionId!, missionDate: receipt.missionDate!, stopId: receipt.stopId!, status: receipt.status as PackageStatus,
    lastScannedAt: receipt.scannedAt, lastScannedBy: receipt.driverId, lastScannedMissionId: receipt.missionId! };
};

// ---- Optimisation & édition de tournée côté chauffeur ----

/**
 * Optimise l'ordre des arrêts d'une tournée par plus-proche-voisin depuis le
 * point de départ (position GPS du chauffeur). Géocode les arrêts sans
 * coordonnées via Google Geocoding. Les arrêts déjà terminés/échoués gardent
 * leur place en tête ; seuls les arrêts restants (PENDING/ARRIVED) sont
 * réordonnés. Met à jour les `sequence` et sauvegarde.
 * Retourne le nb d'arrêts réordonnés, ou -1 si impossible (pas de coords).
 */
export const optimizeDriverMission = async (
  missionId: string,
  startCoords: { lat: number; lng: number }
): Promise<number> => {
  const missionRef = doc(db, MISSIONS_COLLECTION, missionId);
  const snap = await getDoc(missionRef);
  if (!snap.exists()) throw new Error('Tournée introuvable');
  const mission = snap.data() as Mission;
  const isDone = (stop: MissionStop) => [StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED].includes(stop.status);
  const assertCanReorder = (current: Mission) => {
    if ([MissionStatus.COMPLETED, MissionStatus.CANCELLED].includes(current.status)) {
      throw new Error('Cette tournée est clôturée.');
    }
    if (current.stops.some(stop => !isDone(stop) && (stop.timeWindowStart || stop.timeWindowEnd))) {
      throw new Error('Cette tournée contient des créneaux clients. Demandez au bureau de recalculer la tournée pour respecter ces horaires.');
    }
  };
  assertCanReorder(mission);
  const pending = mission.stops.filter(stop => !isDone(stop)).map(stop => ({ ...stop }));
  if (pending.length <= 1) return 0;
  const apiKey = getGoogleMapsApiKey();
  for (const stop of pending) {
    if (!stop.coordinates && apiKey) {
      const coords = await geocodeAddress(stop.address, stop.city, stop.postalCode, apiKey);
      if (coords) stop.coordinates = coords;
    }
  }
  if (pending.filter(stop => stop.coordinates).length < 2) return -1;

  const remaining = [...pending];
  const ordered: MissionStop[] = [];
  let cursor = startCoords;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((stop, index) => {
      const distance = stop.coordinates ? haversineKm(cursor, stop.coordinates) : Infinity;
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    if (next.coordinates) cursor = next.coordinates;
  }
  const order = new Map(ordered.map((stop, index) => [stop.id, index]));
  const coords = new Map(pending.filter(stop => stop.coordinates).map(stop => [stop.id, stop.coordinates!]));

  return runTransaction(db, async tx => {
    const latest = await tx.get(missionRef);
    if (!latest.exists()) throw new Error('Tournée introuvable');
    const current = latest.data() as Mission;
    assertCanReorder(current);
    // A stop completed during geocoding remains terminal, with its proof and
    // historical timing untouched. Stops added meanwhile remain in the tour.
    const done = current.stops.filter(isDone).sort((a, b) => a.sequence - b.sequence);
    const todo = current.stops.filter(stop => !isDone(stop))
      .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    if (todo.length <= 1) return 0;
    const parcelIds = [...new Set(todo.flatMap(stop => stop.packageIds || []))];
    if (parcelIds.length > 450) throw new Error('Trop de colis pour un recalcul local. Demandez une planification au bureau.');
    const parcels = await Promise.all(parcelIds.map(id => tx.get(doc(db, PACKAGES_COLLECTION, id))));
    for (const parcel of parcels) {
      if (!parcel.exists() || parcel.data().missionId !== missionId) {
        throw new Error('L’affectation d’un colis a changé. Actualisez la tournée avant de la réordonner.');
      }
    }
    const finalStops = [...done, ...todo.map(stop => {
      const {
        estimatedArrival: _arrival, estimatedDeparture: _departure,
        durationFromPrevious: _duration, distanceFromPrevious: _distance, ...rest
      } = stop;
      return { ...rest, coordinates: stop.coordinates || coords.get(stop.id) };
    })].map((stop, index) => ({ ...stop, sequence: index + 1 }));
    const now = new Date().toISOString();
    for (const parcel of parcels) {
      tx.update(parcel.ref, { estimatedDeliveryAt: null, updatedAt: now });
    }
    tx.update(missionRef, cleanUndefined({
      stops: finalStops, totalDistance: null, estimatedDuration: null, updatedAt: now,
    }));
    return todo.length;
  });
};

/**
 * Ajoute un arrêt de livraison saisi manuellement par le chauffeur (adresse
 * hors import). Aucun colis rattaché — c'est un passage supplémentaire.
 */
export const addManualStopToMission = async (
  missionId: string,
  stopData: {
    contactName: string; address: string; postalCode: string; city: string;
    contactPhone?: string; notes?: string;
    timeWindowStart?: string; timeWindowEnd?: string; serviceTime?: number;
  },
  requestId: string = crypto.randomUUID()
): Promise<void> => {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) throw new Error('Référence de demande invalide. Rouvrez le formulaire.');
  const ref = doc(db, MISSIONS_COLLECTION, missionId);
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const mission = { id: snap.id, ...snap.data() } as Mission;
    const seq = mission.stops.reduce((m, s) => Math.max(m, s.sequence), 0) + 1;
    const stop = buildDeliveryStop({
      id: `manual-${requestId}`,
      sequence: seq,
      address: stopData.address, city: stopData.city, postalCode: stopData.postalCode,
      contactName: stopData.contactName, contactPhone: stopData.contactPhone,
      timeWindowStart: stopData.timeWindowStart, timeWindowEnd: stopData.timeWindowEnd,
      serviceTime: stopData.serviceTime,
      notes: `⚠️ Arrêt ajouté manuellement${stopData.notes ? ' — ' + stopData.notes : ''}`,
    });
    const existing = mission.stops.find(s => s.id === stop.id);
    if (existing) {
      const fields = ['address', 'city', 'postalCode', 'contactName', 'contactPhone', 'timeWindowStart', 'timeWindowEnd', 'serviceTime', 'notes'] as const;
      if (fields.some(key => String(existing[key] ?? '') !== String(stop[key] ?? ''))) throw new Error('Cette demande a déjà créé un arrêt avec d’autres informations. Vérifiez la tournée avant de créer une nouvelle demande.');
      return;
    }
    if ([MissionStatus.COMPLETED, MissionStatus.CANCELLED].includes(mission.status)) throw new Error('Cette tournée est clôturée. Aucun arrêt ne peut être ajouté.');
    tx.update(ref, { stops: [...mission.stops, stop], updatedAt: now });
  });
};

/**
 * Rattache des colis à UN ARRÊT PRÉCIS d'une mission, DANS UNE SEULE TRANSACTION
 * (mission + colis écrits atomiquement). Utilisé par « Ajouter N colis à cet
 * arrêt » côté chauffeur : les colis détectés à la même adresse mais absents de
 * l'arrêt y sont ajoutés directement (pas de dépendance au regroupement placeKey).
 *
 * Compare-and-set : on NE touche PAS un colis déjà DELIVERED/RETURNED (jamais de
 * résurrection), et on dédoublonne s'il est déjà dans l'arrêt. Renvoie le nombre
 * réellement rattaché.
 */
export const addPackagesToStop = async (
  missionId: string,
  stopId: string,
  packages: Package[],
  driver: { id: string; name: string },
  location?: { lat: number; lng: number }
): Promise<number> => {
  const now = new Date().toISOString();
  const ref = doc(db, MISSIONS_COLLECTION, missionId);
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const mission = { id: snap.id, ...snap.data() } as Mission;
    const stopIdx = mission.stops.findIndex(s => s.id === stopId);
    if (stopIdx < 0) throw new Error('Arrêt introuvable');
    // On ne rattache JAMAIS à un arrêt déjà terminé : sinon la resync verrait un
    // arrêt COMPLETED contenant un colis « en cours » et le passerait à tort en Livré.
    if (mission.stops[stopIdx].status === StopStatus.COMPLETED)
      throw new Error('Arrêt déjà terminé — impossible d’y rattacher des colis');

    // Lectures AVANT écritures (contrainte transaction Firestore).
    const pkgRefs = packages.map(p => doc(db, PACKAGES_COLLECTION, p.id));
    const pkgSnaps = await Promise.all(pkgRefs.map(r => tx.get(r)));

    const already = new Set(mission.stops[stopIdx].packageIds || []);
    const toAttach: { ref: ReturnType<typeof doc>; pkg: Package }[] = [];
    for (let i = 0; i < packages.length; i++) {
      const s = pkgSnaps[i];
      if (!s.exists()) continue;
      const cur = { id: s.id, ...s.data() } as Package;
      if (cur.status === PackageStatus.DELIVERED || cur.status === PackageStatus.RETURNED) continue; // pas de résurrection
      // Colis déjà rattaché à une AUTRE tournée → on ne le vole pas (doublon inter-missions).
      // Le bon chemin est le transfert (qui le retire de la mission d'origine).
      if (cur.missionId && cur.missionId !== missionId) continue;
      if (already.has(cur.id)) continue;
      toAttach.push({ ref: pkgRefs[i], pkg: cur });
      already.add(cur.id);
    }
    if (toAttach.length === 0) return 0;

    const stops = mission.stops.map((s, i) => {
      if (i !== stopIdx) return s;
      const packageIds = [...(s.packageIds || []), ...toAttach.map(t => t.pkg.id)];
      return { ...s, packageIds, packageCount: packageIds.length };
    });
    tx.update(ref, cleanUndefined({
      stops,
      ...recomputeMissionCounters(stops),
      status: mission.status === MissionStatus.COMPLETED ? MissionStatus.IN_PROGRESS : (mission.status || MissionStatus.IN_PROGRESS),
      updatedAt: now,
    }));

    for (const { ref: pRef, pkg } of toAttach) {
      const movement = cleanUndefined({
        timestamp: now,
        action: 'OUT_FOR_DELIVERY' as const,
        driverId: driver.id, driverName: driver.name,
        fromDriverName: pkg.currentDriverId && pkg.currentDriverId !== driver.id
          ? [...(pkg.movements || [])].reverse().find(m => m.driverName)?.driverName : undefined,
        vehicleId: mission.vehicleId, vehiclePlate: mission.vehiclePlate, location,
        notes: `Rattaché à l'arrêt (livraison groupée même adresse) par ${driver.name}`,
      }) as PackageMovement;
      tx.update(pRef, cleanUndefined({
        missionId, stopId,
        currentDriverId: driver.id, currentVehicleId: mission.vehicleId,
        status: PackageStatus.IN_DELIVERY,
        movements: [...(pkg.movements || []), movement],
        updatedAt: now,
      }));
    }
    return toAttach.length;
  });
};

// ============================================================================
// DRIVERS HELPERS
// ============================================================================

export const getAvailableDriversForZone = (
  users: User[],
  zone: Zone,
  excludeDriverIds: string[] = []
): User[] => {
  return users.filter(u => 
    u.role === UserRole.DRIVER &&
    u.zone === zone &&
    !u.isDisabled &&
    !excludeDriverIds.includes(u.id)
  );
};

export const getDriversWithVehicles = (
  users: User[],
  vehicles: { id: string; assignedDriverId?: string; plate: string }[],
  zone?: Zone
): Array<User & { vehicleId: string; vehiclePlate: string }> => {
  const driversWithVehicles: Array<User & { vehicleId: string; vehiclePlate: string }> = [];
  
  for (const user of users) {
    if (user.role !== UserRole.DRIVER || user.isDisabled) continue;
    if (zone && user.zone !== zone) continue;
    
    const vehicle = vehicles.find(v => v.assignedDriverId === user.id);
    if (vehicle) {
      driversWithVehicles.push({
        ...user,
        vehicleId: vehicle.id,
        vehiclePlate: vehicle.plate
      });
    }
  }
  
  return driversWithVehicles;
};

// ============================================================================
// STATS
// ============================================================================

export interface MissionStats {
  total: number;
  byStatus: Record<MissionStatus, number>;
  byZone: Record<Zone, number>;
  totalPackages: number;
  deliveredPackages: number;
  failedPackages: number;
  completionRate: number;
}

export const calculateMissionStats = (missions: Mission[]): MissionStats => {
  const stats: MissionStats = {
    total: missions.length,
    byStatus: {
      [MissionStatus.DRAFT]: 0,
      [MissionStatus.OPTIMIZED]: 0,
      [MissionStatus.DISPATCHED]: 0,
      [MissionStatus.IN_PROGRESS]: 0,
      [MissionStatus.COMPLETED]: 0,
      [MissionStatus.CANCELLED]: 0
    },
    byZone: {
      [Zone.NORD]: 0,
      [Zone.EST]: 0,
      [Zone.SUD]: 0,
      [Zone.OUEST]: 0
    },
    totalPackages: 0,
    deliveredPackages: 0,
    failedPackages: 0,
    completionRate: 0
  };
  
  for (const mission of missions) {
    if (stats.byStatus[mission.status] !== undefined) {
      stats.byStatus[mission.status]++;
    }
    if (stats.byZone[mission.zone] !== undefined) {
      stats.byZone[mission.zone]++;
    }
    stats.totalPackages += mission.totalPackages || 0;
    stats.deliveredPackages += mission.deliveredPackages || 0;
    stats.failedPackages += mission.failedPackages || 0;
  }
  
  if (stats.totalPackages > 0) {
    stats.completionRate = Math.round((stats.deliveredPackages / stats.totalPackages) * 100);
  }
  
  return stats;
};

// ============================================================================
// CRUD COLIS — ADMIN
// ============================================================================

/**
 * Supprimer un colis (admin uniquement).
 * Supprime le document Firestore. Irréversible.
 */
export const deletePackage = async (packageId: string): Promise<void> => {
  await deleteDoc(doc(db, PACKAGES_COLLECTION, packageId));
};

/**
 * Modifier les champs d'un colis existant (admin).
 * Ne modifie que les champs fournis (merge partiel).
 */
export const updatePackageFields = async (
  packageId: string,
  fields: Partial<Package>
): Promise<void> => {
  await updateDoc(doc(db, PACKAGES_COLLECTION, packageId), cleanUndefined({
    ...fields,
    updatedAt: new Date().toISOString()
  }));
};

/**
 * DÉTACHE un colis de sa tournée : écrit NULL (et non undefined) sur missionId /
 * stopId / currentDriverId / currentVehicleId. Indispensable car `cleanUndefined`
 * RETIRE les clés undefined → l'ancien détachement via updatePackageFields ne
 * remettait jamais ces champs à vide (colis « retourné » resté rattaché → cible
 * du resync). `null` est conservé par cleanUndefined et falsy pour les lecteurs.
 */
export const detachPackageFromTour = async (
  packageId: string,
  extra: Record<string, any> = {}
): Promise<void> => {
  await httpsCallable(getFunctions(app, 'europe-west1'), 'returnPackage')({packageId, extra: cleanUndefined(extra)});
};
