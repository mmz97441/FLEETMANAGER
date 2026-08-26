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
import { extractScanTokens } from '../utils/barcode';
import { placeKey } from '../utils/address';
import { localDatePart } from '../utils/date';
import { cleanUndefined } from '../utils/firestore';
import { haversineKm } from '../utils/geo';
import { geocodeAddress, getGoogleMapsApiKey } from './gmproService';
import { reportError } from './logService';

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

export const subscribeToHubs = (callback: (hubs: Hub[]) => void) => {
  const q = query(collection(db, HUBS_COLLECTION), orderBy('zone'));
  return onSnapshot(q, (snapshot) => {
    const hubs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hub));
    callback(hubs);
  });
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
  filters?: { date?: string; zone?: Zone; status?: PackageStatus; clientId?: string; missionId?: string }
) => {
  let q = query(collection(db, PACKAGES_COLLECTION), orderBy('createdAt', 'desc'), limit(500));
  
  // Note: Firestore ne permet pas plusieurs where avec orderBy sur des champs différents
  // On filtre côté client pour plus de flexibilité
  
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
    if (filters?.missionId) {
      packages = packages.filter(p => p.missionId === filters.missionId);
    }
    
    callback(packages);
  });
};

/**
 * Abonnement DÉDIÉ aux colis DISPATCHABLES (tableau de dispatch).
 *
 * `subscribeToPackages` ne charge que les 500 colis les plus récents de TOUT le
 * système avant de filtrer côté client : sur une grosse journée (>500 colis créés
 * après les colis en attente), d'anciens colis AT_HUB/SORTED non affectés tombaient
 * hors des 500 → INVISIBLES au dispatch, jamais partis en tournée. Ici on interroge
 * le serveur par statut (`in`, sans orderBy → aucun index composite requis) : TOUS
 * les colis dispatchables remontent, quel que soit le volume. Le filtre « non
 * affecté » reste côté client (missionId/currentDriverId).
 */
export const subscribeToDispatchablePackages = (
  callback: (packages: Package[]) => void
) => {
  const q = query(
    collection(db, PACKAGES_COLLECTION),
    where('status', 'in', [PackageStatus.AT_HUB, PackageStatus.SORTED])
  );
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Package)));
  });
};

/**
 * Abonnement DÉDIÉ aux colis d'un client (portail expéditeur).
 *
 * Corrige un défaut de `subscribeToPackages` qui ne charge que les 500 colis les
 * plus récents de TOUT le système avant de filtrer côté client : un client à fort
 * volume ne voyait plus ses colis anciens. Ici on interroge Firestore CÔTÉ SERVEUR
 * par `clientId` ET par `clientName` (requêtes d'égalité → index simples, pas de
 * limite globale), puis on fusionne. Le client voit ainsi TOUS ses colis.
 */
export const subscribeToClientPackages = (
  client: { id: string; companyName?: string },
  callback: (packages: Package[]) => void
) => {
  let byId: Package[] = [];
  let byName: Package[] = [];
  const emit = () => {
    const map = new Map<string, Package>();
    [...byId, ...byName].forEach(p => map.set(p.id, p));
    const merged = Array.from(map.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    callback(merged);
  };

  const qId = query(collection(db, PACKAGES_COLLECTION), where('clientId', '==', client.id), limit(3000));
  const unsub1 = onSnapshot(qId, snap => {
    byId = snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
    emit();
  });

  let unsub2: () => void = () => {};
  const company = (client.companyName || '').trim();
  if (company) {
    const qName = query(collection(db, PACKAGES_COLLECTION), where('clientName', '==', company), limit(3000));
    unsub2 = onSnapshot(qName, snap => {
      byName = snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
      emit();
    });
  }

  return () => { unsub1(); unsub2(); };
};

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
  const pkgDoc = await getDoc(doc(db, PACKAGES_COLLECTION, packageId));
  if (!pkgDoc.exists()) throw new Error('Package not found');
  
  const pkg = pkgDoc.data() as Package;
  const now = new Date().toISOString();

  // CRUCIAL : nettoyer les undefined avant écriture. Firestore rejette toute
  // valeur `undefined` ("Unsupported field value: undefined") — c'est ce qui
  // faisait échouer la mise à jour du statut à la livraison (vehicleId/plate/
  // location absents sur une tournée créée par scan ou sans GPS) et laissait
  // les colis bloqués "En livraison".
  const cleanedMovement = cleanUndefined({ ...movement, timestamp: now });
  const cleanedExtra = cleanUndefined(extraFields || {});

  await updateDoc(doc(db, PACKAGES_COLLECTION, packageId), {
    status,
    movements: [...(pkg.movements || []), cleanedMovement],
    ...cleanedExtra,
    updatedAt: now
  });

  // === AUTO-NOTIFICATIONS (fire-and-forget) ===
  triggerPackageNotifications(pkg, status, movement).catch(() => {});
};

/**
 * RESYNCHRONISATION DES STATUTS COLIS ↔ ARRÊTS.
 *
 * Répare les colis restés "En livraison" alors que leur arrêt a été marqué
 * TERMINÉ par le chauffeur (cause : échec d'upload des preuves qui interrompait
 * la mise à jour du colis). On ne passe un colis en "Livré" QUE si son arrêt de
 * livraison est COMPLETED → c'est la preuve que le chauffeur a bien validé.
 *
 * S'il n'y a rien à corriger, c'est que les livraisons n'ont pas été validées
 * (chauffeur encore en tournée), pas un bug.
 */
export interface StatusResyncResult {
  completedStopPackages: number; // colis rattachés à un arrêt terminé
  fixedDelivered: number;        // colis repassés en "Livré"
  failed: number;                // échecs de mise à jour
  details: { packageId: string; orderNumber: string; from: string }[];
}

export const resyncPackageStatusesFromStops = async (): Promise<StatusResyncResult> => {
  const result: StatusResyncResult = { completedStopPackages: 0, fixedDelivered: 0, failed: 0, details: [] };

  // 1. Parcourir toutes les missions → colis dont l'arrêt DELIVERY est TERMINÉ.
  //    On restreint à `type === 'DELIVERY'` (et NON `!== 'PICKUP'`) : un arrêt HUB
  //    (retour dépôt) terminé ne doit pas faire passer ses colis en « Livré » ni
  //    notifier le client à tort.
  const missionsSnap = await getDocs(collection(db, MISSIONS_COLLECTION));
  const deliveredStopMeta = new Map<string, { missionId: string; driverId?: string; driverName?: string; vehicleId?: string; vehiclePlate?: string }>();
  for (const mDoc of missionsSnap.docs) {
    const m = mDoc.data() as Mission;
    for (const s of (m.stops || [])) {
      if (s.type === 'DELIVERY' && s.status === StopStatus.COMPLETED) {
        for (const id of (s.packageIds || [])) {
          deliveredStopMeta.set(id, {
            missionId: mDoc.id,
            driverId: m.driverId, driverName: m.driverName,
            vehicleId: m.vehicleId, vehiclePlate: m.vehiclePlate
          });
        }
      }
    }
  }

  if (deliveredStopMeta.size === 0) return result;

  // 2. Colis correspondants qui ne sont PAS encore "Livré" → réparer.
  // On lit les colis PAR LEURS IDs (plus de plafond 500 qui laissait des colis
  // anciens non réparables), et on NE ressuscite JAMAIS un colis dans un état
  // terminal non-livré (Retourné / À retourner / Échec) : le resync ne fait que
  // MONTER un colis « en cours » vers Livré, jamais écraser une vérité terrain.
  const NON_RESURRECT = new Set<PackageStatus>([
    PackageStatus.DELIVERED, PackageStatus.RETURNED, PackageStatus.RETURN_REQUESTED, PackageStatus.FAILED
  ]);
  const pkgs = await getPackagesByIds([...deliveredStopMeta.keys()]);
  // Nb de colis livrés par mission (colis d'arrêts terminés dont le statut FINAL est
  // Livré) + missions effectivement réparées → pour réconcilier leurs compteurs.
  const deliveredByMission = new Map<string, number>();
  const repairedMissions = new Set<string>();
  for (const pkg of pkgs) {
    const meta = deliveredStopMeta.get(pkg.id);
    if (!meta) continue;
    result.completedStopPackages++;
    if (NON_RESURRECT.has(pkg.status)) {
      // Déjà Livré → compte déjà comme livré pour sa mission (les autres états
      // terminaux — Échec/Retour — ne comptent pas).
      if (pkg.status === PackageStatus.DELIVERED)
        deliveredByMission.set(meta.missionId, (deliveredByMission.get(meta.missionId) || 0) + 1);
      continue;
    }

    try {
      await updatePackageStatus(pkg.id, PackageStatus.DELIVERED, {
        action: 'DELIVERED',
        driverId: meta.driverId || pkg.currentDriverId || '',
        driverName: meta.driverName || '',
        vehicleId: meta.vehicleId,
        vehiclePlate: meta.vehiclePlate,
        notes: 'Statut resynchronisé (arrêt marqué terminé par le chauffeur)'
      });
      result.fixedDelivered++;
      deliveredByMission.set(meta.missionId, (deliveredByMission.get(meta.missionId) || 0) + 1);
      repairedMissions.add(meta.missionId);
      result.details.push({ packageId: pkg.id, orderNumber: pkg.orderNumber || pkg.externalId || pkg.id, from: String(pkg.status) });
    } catch (e) {
      result.failed++;
      reportError('resync.package', e, { silent: true, extra: { packageId: pkg.id } });
    }
  }

  // #11 : réconcilier deliveredPackages des missions RÉPARÉES (sinon les widgets par
  // mission sous-comptent définitivement après un resync). Valeur autoritaire = nombre
  // de colis livrés dans les arrêts de livraison terminés de la mission.
  for (const mid of repairedMissions) {
    try { await updateMissionFields(mid, { deliveredPackages: deliveredByMission.get(mid) || 0 }); }
    catch (e) { reportError('resync.missionCounter', e, { silent: true, extra: { missionId: mid } }); }
  }

  return result;
};

/**
 * Déclenche les notifications automatiques selon le changement de statut.
 * Exécuté en background (fire-and-forget) pour ne pas ralentir le workflow.
 */
const triggerPackageNotifications = async (
  pkg: Package,
  newStatus: PackageStatus,
  movement: Omit<PackageMovement, 'timestamp'>
) => {
  // Import dynamique pour ne pas alourdir le bundle si les notifs ne sont pas utilisées
  const { 
    notifyPackageDelivered, 
    notifyPackageFailed, 
    notifyPackageInDelivery,
    notifyAdminDeliveryFailure 
  } = await import('./notificationService');
  
  const barcode = pkg.barcode || pkg.orderNumber || 'N/A';
  const recipientName = pkg.contactName || 'Destinataire';
  const driverName = movement.driverName || 'Chauffeur';

  // === CLIENT : colis livré ===
  if (newStatus === PackageStatus.DELIVERED && pkg.clientId) {
    await notifyPackageDelivered(pkg.clientId, barcode, recipientName);
  }
  
  // === CLIENT + ADMINS : échec livraison ===
  if (newStatus === PackageStatus.FAILED && pkg.clientId) {
    const reason = movement.notes || 'Motif non précisé';
    
    // Notifier le client
    await notifyPackageFailed(pkg.clientId, barcode, recipientName, reason);
    
    // Notifier les admins
    const adminIds = await getAdminUserIds();
    if (adminIds.length > 0) {
      await notifyAdminDeliveryFailure(adminIds, driverName, barcode, recipientName, reason);
    }
  }
  
  // === CLIENT : colis en livraison ===
  if (newStatus === PackageStatus.IN_DELIVERY && pkg.clientId) {
    await notifyPackageInDelivery(pkg.clientId, barcode, recipientName, driverName);
  }
};

/**
 * Récupère les IDs des utilisateurs admin/directeur pour les notifications broadcast
 */
const getAdminUserIds = async (): Promise<string[]> => {
  try {
    const q = query(
      collection(db, 'users'),
      // ⚠️ 'in' Firestore : max 10 valeurs, AUCUNE ne doit être undefined
      // (UserRole.SUPER_ADMIN n'existe pas → cassait la requête → admins sans notif).
      where('role', 'in', [
        UserRole.ADMIN, UserRole.PRESIDENT, UserRole.DIRECTOR,
        'admin', 'Admin', 'Super Admin',
        'Directeur', 'directeur', 'Exploitant', 'exploitant'
      ])
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => d.id);
  } catch (e) {
    return [];
  }
};

export const addPackagesBatch = async (packages: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<string[]> => {
  // Firestore plafonne un writeBatch à 500 écritures : un fichier client de >500
  // colis faisait échouer TOUT l'import en silence (aucun colis créé). On découpe
  // en lots de 450 et on committe lot par lot.
  const ids: string[] = [];
  const now = new Date().toISOString();
  const CHUNK = 450;
  for (let i = 0; i < packages.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const pkg of packages.slice(i, i + CHUNK)) {
      const docRef = doc(collection(db, PACKAGES_COLLECTION));
      ids.push(docRef.id);
      batch.set(docRef, cleanUndefined({
        ...pkg,
        createdAt: now,
        updatedAt: now
      }));
    }
    await batch.commit();
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
}): Promise<Package[]> => {
  const { client, recipient, zone } = params;
  const total = Math.max(1, Math.min(Number(params.packageCount) || 1, 50));
  const now = new Date().toISOString();

  const toCreate: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  for (let i = 1; i <= total; i++) {
    const code = generateTrackingCode();
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
  const { client, rows } = params;
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
      packageIndex: 1,
      packageTotal: 1,
      status: PackageStatus.PENDING,
      movements: [{
        timestamp: now,
        action: 'IMPORTED' as const,
        notes: `Importé par l'expéditeur ${client.companyName} — colis ${code}`
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
 * colis restants avant chacun, DIRECTEMENT sur les colis de la tournée en cours.
 * Le client ne lit que ses propres colis (règles Firestore) → aucune fuite entre
 * clients. Appelé ~toutes les 30s par le téléphone du chauffeur.
 */
export const publishLiveTrackingForMission = async (
  mission: Mission,
  driverPos: { lat: number; lng: number },
  driverName: string
): Promise<void> => {
  const now = new Date().toISOString();
  const deliveryStops = (mission.stops || [])
    .filter(s => s.type === 'DELIVERY')
    .sort((a, b) => a.sequence - b.sequence);

  const batch = writeBatch(db);
  let running = 0; // colis dans les arrêts NON terminés déjà rencontrés
  let ops = 0;

  for (const stop of deliveryStops) {
    if (stop.status === StopStatus.COMPLETED) continue; // déjà livré → pas de suivi live
    const before = running; // colis restants avant CET arrêt
    for (const pid of (stop.packageIds || [])) {
      batch.set(
        doc(db, PACKAGES_COLLECTION, pid),
        {
          liveDriver: { lat: driverPos.lat, lng: driverPos.lng, updatedAt: now, driverName },
          remainingBeforeMine: before,
        },
        { merge: true }
      );
      ops++;
      if (ops >= 450) break; // garde-fou limite d'un batch Firestore
    }
    running += (stop.packageCount || (stop.packageIds ? stop.packageIds.length : 0));
    if (ops >= 450) break;
  }

  if (ops > 0) await batch.commit();
};

export const subscribeToMissions = (
  callback: (missions: Mission[]) => void,
  filters?: { date?: string; zone?: Zone; status?: MissionStatus; driverId?: string }
) => {
  // À l'échelle, un `limit(100)` global trié par date pouvait EXCLURE la tournée
  // d'un chauffeur (>100 tournées récentes le même jour) → le chauffeur ouvre
  // l'app et ne voit AUCUNE tournée. Quand on filtre par chauffeur, on interroge
  // donc le serveur par `driverId` (aucun index composite requis, périmètre borné
  // à ses tournées) au lieu de récupérer les 100 dernières puis filtrer côté client.
  const q = filters?.driverId
    ? query(collection(db, MISSIONS_COLLECTION), where('driverId', '==', filters.driverId))
    : query(collection(db, MISSIONS_COLLECTION), orderBy('date', 'desc'), limit(100));

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
  });
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
}): Promise<{ allDone: boolean; stops: MissionStop[] }> => {
  const ref = doc(db, MISSIONS_COLLECTION, params.missionId);
  const now = new Date().toISOString();
  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const m = { id: snap.id, ...snap.data() } as Mission;
    // On nettoie le patch AVANT le merge : un champ `undefined` (ex. arrivalCoordinates
    // sans GPS) ne doit PAS écraser/supprimer la valeur existante de l'arrêt.
    const cleanPatch = cleanUndefined(params.stopPatch) as Partial<MissionStop>;
    const stops = m.stops.map(s => s.id === params.stopId ? { ...s, ...cleanPatch } : s);
    const { completedStops, failedStops, totalPackages } = recomputeMissionCounters(stops);
    const deliveredPackages = Math.max(0, (m.deliveredPackages || 0) + (params.deliveredDelta || 0));
    const failedPackages = Math.max(0, (m.failedPackages || 0) + (params.failedDelta || 0));
    const allDone = stops.every(s =>
      s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED
    );
    tx.update(ref, cleanUndefined({
      stops,
      completedStops, failedStops, totalPackages,
      deliveredPackages, failedPackages,
      status: allDone ? MissionStatus.COMPLETED : MissionStatus.IN_PROGRESS,
      ...(allDone ? { completedAt: now } : {}),
      updatedAt: now
    }));
    return { allDone, stops };
  });
};

export const updateMissionStatus = async (missionId: string, status: MissionStatus): Promise<void> => {
  const updates: any = { status, updatedAt: new Date().toISOString() };
  
  if (status === MissionStatus.IN_PROGRESS) {
    updates.startedAt = new Date().toISOString();
  } else if (status === MissionStatus.COMPLETED) {
    updates.completedAt = new Date().toISOString();
  }
  
  await updateDoc(doc(db, MISSIONS_COLLECTION, missionId), updates);
};

export const deleteMission = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, MISSIONS_COLLECTION, id));
};

// ============================================================================
// IMPORT BATCHES
// ============================================================================

export const subscribeToImportBatches = (
  callback: (batches: ImportBatch[]) => void,
  limitCount: number = 50
) => {
  const q = query(collection(db, IMPORTS_COLLECTION), orderBy('importedAt', 'desc'), limit(limitCount));
  
  return onSnapshot(q, (snapshot) => {
    const batches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportBatch));
    callback(batches);
  });
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
    toSignatureUrl,
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
// mêmes candidats, même requête ; seul le départage (tie-break) diffère.

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
        limit(5)
      ));
      if (!snap.empty) return snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
    }
  }
  return [];
};

/**
 * Retrouve un colis dispatché à partir d'un code scanné (tracking GFL,
 * N° colis client type BR0513, ou N° de commande). Utilisé pour les
 * transferts en route : le colis peut appartenir à n'importe quelle tournée.
 * Départage : préférer un colis ACTIF (rattaché à une mission, non livré).
 */
export const findDispatchedPackageByCode = async (code: string): Promise<Package | null> => {
  const uniq = scanSearchCandidates(code);
  if (uniq.length === 0) return null;
  const pkgs = await queryPackagesByCandidates(uniq);
  if (pkgs.length === 0) return null;
  const active = pkgs.find(p =>
    p.missionId &&
    p.status !== PackageStatus.DELIVERED &&
    p.status !== PackageStatus.RETURNED
  );
  return active || pkgs[0];
};

/**
 * Recherche un colis par n'importe quel code : tracking interne GFL,
 * N° colis client (externalId, ex BR0513), ou N° de commande (ex 13926865).
 * Repli : si le code scanné se termine par un suffixe d'index (ex "13926865-002"
 * ou "13926865002" pour "colis 02"), on réessaie sur le N° de commande nu —
 * les étiquettes clients encodent souvent commande + rang du colis.
 * Départage : le colis le plus RÉCENT en cas d'homonymes.
 */
export const findPackageByCode = async (code: string): Promise<Package | null> => {
  const uniq = scanSearchCandidates(code);
  if (uniq.length === 0) return null;
  const pkgs = await queryPackagesByCandidates(uniq);
  if (pkgs.length === 0) return null;
  return pkgs.sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  )[0];
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
  const { packages: raw, toMission, toDriver, reason, location, notes, newStatus, claimMode } = input;
  const now = new Date().toISOString();
  const ids = [...new Set(raw.map(p => p.id).filter(Boolean))];
  if (ids.length === 0) throw new Error('Aucun colis à traiter');
  const toRef = doc(db, MISSIONS_COLLECTION, toMission.id);

  // TOUT EN UNE SEULE TRANSACTION : retrait des tournées d'origine, ajout à la
  // tournée receveuse ET réécriture des pointeurs colis sont désormais atomiques.
  // Avant, ces 3 phases étaient committées séparément → colis « orphelins »
  // (retirés de l'origine mais jamais rajoutés si l'étape 2 échouait) et pointeurs
  // incohérents (colis dans les stops du receveur mais doc pointant encore l'origine)
  // dès que le réseau tombait en cours de route. Un échec annule maintenant TOUT.
  const { addedIds, movedByOrigin, originMeta, notify } = await runTransaction(db, async (tx) => {
    // ===== 1. LECTURES (toutes AVANT les écritures — contrainte Firestore) =====
    // 1a. Colis FRAIS → anti-résurrection (on ignore livrés/retournés). Les lectures
    //     dans la transaction servent aussi de détection de conflit : deux chauffeurs
    //     qui scannent le même colis n'aboutiront jamais à un doublon (le perdant
    //     rejoue et voit le colis déjà réaffecté).
    const pkgSnaps = await Promise.all(ids.map(id => tx.get(doc(db, PACKAGES_COLLECTION, id))));
    const pkgs = pkgSnaps
      .filter(s => s.exists())
      .map(s => ({ id: s.id, ...s.data() } as Package))
      .filter(p => p.status !== PackageStatus.DELIVERED && p.status !== PackageStatus.RETURNED);
    if (pkgs.length === 0) throw new Error('Aucun colis à traiter (déjà livrés/retournés ou introuvables)');
    if (pkgs.length > 400) throw new Error('Trop de colis en une fois (>400) — divisez le transfert');

    // 1b. Tournées d'origine distinctes (hors receveuse).
    const originIds = [...new Set(pkgs.map(p => p.missionId).filter((m): m is string => !!m && m !== toMission.id))];
    const originSnaps = await Promise.all(originIds.map(id => tx.get(doc(db, MISSIONS_COLLECTION, id))));
    const originMissions = new Map<string, Mission>();
    originSnaps.forEach((snap, i) => {
      if (snap.exists()) originMissions.set(originIds[i], { id: snap.id, ...snap.data() } as Mission);
    });

    // 1c. Tournée receveuse (lue DANS la transaction → jamais périmée).
    const toSnap = await tx.get(toRef);
    if (!toSnap.exists()) throw new Error('Votre tournée est introuvable');
    const toM = { id: toSnap.id, ...toSnap.data() } as Mission;

    // ===== 2. CALCULS =====
    // 2a. Dédup : colis déjà présents dans la tournée receveuse.
    const already = new Set(toM.stops.flatMap(s => s.packageIds));
    const toAdd = pkgs.filter(p => !already.has(p.id));

    // 2b. Fusion par adresse (placeKey) dans un arrêt existant ENCORE À FAIRE, sinon
    //     création d'un arrêt — évite « 1 colis au lieu de 4 » quand on scanne un par un.
    const updatedToStops: MissionStop[] = toM.stops.map(s => ({ ...s, packageIds: [...s.packageIds] }));
    const mergeableByKey = new Map<string, MissionStop>();
    for (const s of updatedToStops) {
      if (s.type === 'DELIVERY' &&
          s.status !== StopStatus.COMPLETED &&
          s.status !== StopStatus.FAILED &&
          s.status !== StopStatus.SKIPPED) {
        const k = placeKey(s);
        if (!mergeableByKey.has(k)) mergeableByKey.set(k, s);
      }
    }
    let maxSeq = updatedToStops.reduce((mx, s) => Math.max(mx, s.sequence), 0);
    const byAddress = new Map<string, Package[]>();
    for (const p of toAdd) {
      const k = placeKey(p);
      if (!byAddress.has(k)) byAddress.set(k, []);
      byAddress.get(k)!.push(p);
    }
    const stopByPkg = new Map<string, string>(); // pkgId → stopId (receveur)
    for (const [key, group] of byAddress) {
      let target = mergeableByKey.get(key);
      if (!target) {
        maxSeq += 1;
        const first = group[0];
        target = buildDeliveryStop({
          id: makeStopId('transfer', maxSeq, now),
          sequence: maxSeq,
          address: first.address, city: first.city, postalCode: first.postalCode,
          coordinates: first.coordinates, floor: first.floor, hasElevator: first.hasElevator,
          contactName: first.contactName, contactPhone: first.contactPhone,
          packageIds: [],
          timeWindowStart: first.timeWindowStart, timeWindowEnd: first.timeWindowEnd,
          serviceTime: first.serviceTime || 5,
          notes: claimMode ? 'Pris en charge par scan' : 'Reçu par transfert en route',
        });
        updatedToStops.push(target);
        mergeableByKey.set(key, target);
      }
      for (const p of group) {
        target.packageIds.push(p.id);
        stopByPkg.set(p.id, target.id);
      }
      target.packageCount = target.packageIds.length;
    }

    // 2c. Retrait des colis de leurs tournées d'origine (calcul des nouveaux stops).
    const addedIdSet = new Set(toAdd.map(p => p.id));
    const removedByOrigin = new Map<string, MissionStop[]>();
    for (const [mid, m] of originMissions) {
      const removed = new Set(pkgs.filter(p => p.missionId === mid && addedIdSet.has(p.id)).map(p => p.id));
      if (removed.size === 0) continue;
      const newStops = m.stops
        .map(s => {
          const remaining = s.packageIds.filter(id => !removed.has(id));
          return remaining.length === s.packageIds.length ? s : { ...s, packageIds: remaining, packageCount: remaining.length };
        })
        // Retirer les stops vidés SAUF s'ils étaient déjà terminés.
        .filter(s => s.packageIds.length > 0 || s.status === StopStatus.COMPLETED);
      removedByOrigin.set(mid, newStops);
    }

    // ===== 3. ÉCRITURES (toutes après les lectures) =====
    for (const [mid, newStops] of removedByOrigin) {
      tx.update(doc(db, MISSIONS_COLLECTION, mid), { stops: newStops, ...recomputeMissionCounters(newStops), updatedAt: now });
    }
    tx.update(toRef, {
      stops: updatedToStops,
      totalPackages: recomputeMissionCounters(updatedToStops).totalPackages,
      status: toM.status === MissionStatus.COMPLETED ? MissionStatus.IN_PROGRESS : (toM.status || MissionStatus.IN_PROGRESS),
      updatedAt: now
    });
    for (const p of toAdd) {
      const stopId = stopByPkg.get(p.id)!;
      const fromMission = p.missionId ? originMissions.get(p.missionId) : undefined;
      const movement: PackageMovement = cleanUndefined({
        timestamp: now,
        action: claimMode ? 'OUT_FOR_DELIVERY' as const : 'TRANSFERRED' as const,
        driverId: toDriver.id, driverName: toDriver.name,
        // « de X » = chauffeur source (transfert OU prise en charge d'un colis d'un collègue).
        fromDriverName: fromMission?.driverName,
        vehicleId: toMission.vehicleId, vehiclePlate: toMission.vehiclePlate, location,
        notes: claimMode
          ? `Pris en charge pour livraison par ${toDriver.name}${fromMission?.driverName ? ` (récupéré de ${fromMission.driverName})` : ''}`
          : `Transfert en route${fromMission?.driverName ? ` — de ${fromMission.driverName}` : ''} à ${toDriver.name}${notes ? ` (${notes})` : ''}`
      }) as PackageMovement;
      tx.update(doc(db, PACKAGES_COLLECTION, p.id), cleanUndefined({
        missionId: toMission.id, stopId,
        currentDriverId: toDriver.id, currentVehicleId: toMission.vehicleId,
        ...(newStatus ? { status: newStatus } : {}),
        movements: [...(p.movements || []), movement],
        updatedAt: now
      }));
    }

    // Métadonnées pour la trace de transfert (créée hors transaction, non critique).
    const movedByOrigin = new Map<string, string[]>();
    for (const p of toAdd) {
      if (!p.missionId || !originMissions.has(p.missionId)) continue;
      if (!movedByOrigin.has(p.missionId)) movedByOrigin.set(p.missionId, []);
      movedByOrigin.get(p.missionId)!.push(p.id);
    }
    // Données de notification client « colis en livraison » (déclenchée hors tx :
    // le tx.update ci-dessus court-circuite updatePackageStatus/triggerNotifications).
    const notify = toAdd
      .filter(p => p.clientId)
      .map(p => ({ clientId: p.clientId as string, barcode: p.barcode || p.orderNumber || 'N/A', recipientName: p.contactName || 'Destinataire' }));
    return { addedIds: addedIdSet, movedByOrigin, originMeta: originMissions, notify };
  });

  // ===== 4bis. Notifier le client « en livraison » (modèle par SCAN = défaut) =====
  // Avant, seules les tournées dispatchées par l'admin notifiaient ; les tournées
  // construites au scan (prise en charge) ne notifiaient jamais le client.
  if (newStatus === PackageStatus.IN_DELIVERY && notify.length > 0) {
    import('./notificationService').then(({ notifyPackageInDelivery }) => {
      // Une notification par colis, mais on dédoublonne (clientId+barcode) pour éviter
      // les doublons quand le même code revient.
      const seen = new Set<string>();
      for (const n of notify) {
        const k = `${n.clientId}|${n.barcode}`;
        if (seen.has(k)) continue;
        seen.add(k);
        notifyPackageInDelivery(n.clientId, n.barcode, n.recipientName, toDriver.name).catch(() => {});
      }
    }).catch(() => {});
  }

  // ===== 4. Traçabilité : un document de transfert par tournée d'origine =====
  // Hors transaction (non critique) : si ça échoue, les colis sont déjà cohérents.
  for (const [missionId, movedIds] of movedByOrigin) {
    const fromMission = originMeta.get(missionId);
    if (!fromMission || movedIds.length === 0) continue;
    await addTransfer({
      packageIds: movedIds, packageCount: movedIds.length,
      fromDriverId: fromMission.driverId || '', fromDriverName: fromMission.driverName || 'Inconnu',
      fromVehicleId: fromMission.vehicleId || '', fromVehiclePlate: fromMission.vehiclePlate || '',
      fromMissionId: missionId,
      toDriverId: toDriver.id, toDriverName: toDriver.name,
      toVehicleId: toMission.vehicleId || '', toVehiclePlate: toMission.vehiclePlate || '',
      toMissionId: toMission.id, location, timestamp: now, reason, notes,
      status: TransferStatus.CONFIRMED, confirmedAt: now
    });
  }

  return addedIds.size;
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
}): Promise<number> => {
  const { packages: pkgs, driver, vehicle, date, location } = params;
  if (pkgs.length === 0) throw new Error('Aucun colis à prendre en charge');
  const mission = await getOrCreateDriverDeliveryMission(driver, date, vehicle);
  return transferPackagesToDriver({
    packages: pkgs,
    toMission: mission,
    toDriver: driver,
    reason: TransferReason.OTHER,
    location,
    claimMode: true,
    newStatus: PackageStatus.IN_DELIVERY
  });
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

  const ref = await addDoc(collection(db, PACKAGES_COLLECTION), pkgData);
  const created = { id: ref.id, ...pkgData } as Package;

  // Prise en charge immédiate dans la tournée de livraison du jour
  await claimPackagesForDelivery({
    packages: [created],
    driver: params.driver,
    date: params.date,
    location: params.location
  });
  return created;
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
  const snap = await getDoc(doc(db, MISSIONS_COLLECTION, missionId));
  if (!snap.exists()) throw new Error('Tournée introuvable');
  const mission = { id: snap.id, ...snap.data() } as Mission;
  const apiKey = getGoogleMapsApiKey();

  const done = mission.stops.filter(s => s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED);
  const pending = mission.stops.filter(s => !done.includes(s));
  if (pending.length <= 1) return 0;

  // Géocoder les arrêts sans coordonnées
  for (const s of pending) {
    if (!s.coordinates && apiKey) {
      const c = await geocodeAddress(s.address, s.city, s.postalCode, apiKey);
      if (c) s.coordinates = c;
    }
  }
  const withCoords = pending.filter(s => s.coordinates);
  if (withCoords.length < 2) return -1; // géocodage indisponible → optimisation impossible

  // Plus-proche-voisin depuis le point de départ
  const remaining = [...pending];
  const ordered: MissionStop[] = [];
  let cursor = startCoords;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i].coordinates;
      const d = c ? haversineKm(cursor, c) : Infinity; // sans coords → repoussé en fin
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    if (next.coordinates) cursor = next.coordinates;
  }

  // Ordre calculé (map id → rang). Réappliqué dans une transaction sur les
  // stops ACTUELS pour ne pas écraser un arrêt ajouté entre-temps.
  const orderMap = new Map<string, number>();
  [...done, ...ordered].forEach((s, i) => orderMap.set(s.id, i + 1));
  const coordsMap = new Map(pending.filter(s => s.coordinates).map(s => [s.id, s.coordinates!]));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(doc(db, MISSIONS_COLLECTION, missionId));
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const m = { id: snap.id, ...snap.data() } as Mission;
    let extra = orderMap.size;
    const finalStops = m.stops
      .map(s => ({
        ...s,
        coordinates: s.coordinates || coordsMap.get(s.id),
        sequence: orderMap.has(s.id) ? orderMap.get(s.id)! : ++extra // stops ajoutés entre-temps → à la fin
      }))
      .sort((a, b) => a.sequence - b.sequence);
    tx.update(doc(db, MISSIONS_COLLECTION, missionId), { stops: finalStops, updatedAt: new Date().toISOString() });
  });
  return ordered.length;
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
  }
): Promise<void> => {
  const ref = doc(db, MISSIONS_COLLECTION, missionId);
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const mission = { id: snap.id, ...snap.data() } as Mission;
    const seq = mission.stops.reduce((m, s) => Math.max(m, s.sequence), 0) + 1;
    const stop = buildDeliveryStop({
      id: makeStopId('manual', seq, now),
      sequence: seq,
      address: stopData.address, city: stopData.city, postalCode: stopData.postalCode,
      contactName: stopData.contactName, contactPhone: stopData.contactPhone,
      timeWindowStart: stopData.timeWindowStart, timeWindowEnd: stopData.timeWindowEnd,
      serviceTime: stopData.serviceTime,
      notes: `⚠️ Arrêt ajouté manuellement${stopData.notes ? ' — ' + stopData.notes : ''}`,
    });
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
  await updateDoc(doc(db, PACKAGES_COLLECTION, packageId), cleanUndefined({
    ...extra,
    missionId: null,
    stopId: null,
    currentDriverId: null,
    currentVehicleId: null,
    updatedAt: new Date().toISOString()
  }));
};
