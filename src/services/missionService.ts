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

const cleanUndefined = (obj: any): any => {
  if (obj === undefined || obj === null) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanUndefined);
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = cleanUndefined(value);
    }
  }
  return cleaned;
};

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
      packages = packages.filter(p => p.createdAt.startsWith(filters.date!));
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

  // 1. Parcourir toutes les missions → colis dont l'arrêt DELIVERY est TERMINÉ
  const missionsSnap = await getDocs(collection(db, MISSIONS_COLLECTION));
  const deliveredStopMeta = new Map<string, { driverId?: string; driverName?: string; vehicleId?: string; vehiclePlate?: string }>();
  for (const mDoc of missionsSnap.docs) {
    const m = mDoc.data() as Mission;
    for (const s of (m.stops || [])) {
      if (s.type !== 'PICKUP' && s.status === StopStatus.COMPLETED) {
        for (const id of (s.packageIds || [])) {
          deliveredStopMeta.set(id, {
            driverId: m.driverId, driverName: m.driverName,
            vehicleId: m.vehicleId, vehiclePlate: m.vehiclePlate
          });
        }
      }
    }
  }

  if (deliveredStopMeta.size === 0) return result;

  // 2. Colis correspondants qui ne sont PAS encore "Livré" → réparer
  const pkgsSnap = await getDocs(query(collection(db, PACKAGES_COLLECTION), orderBy('createdAt', 'desc'), limit(500)));
  for (const pDoc of pkgsSnap.docs) {
    const pkg = { id: pDoc.id, ...(pDoc.data() as any) } as Package;
    const meta = deliveredStopMeta.get(pkg.id);
    if (!meta) continue;
    result.completedStopPackages++;
    if (pkg.status === PackageStatus.DELIVERED) continue;

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
      result.details.push({ packageId: pkg.id, orderNumber: pkg.orderNumber || pkg.externalId || pkg.id, from: String(pkg.status) });
    } catch (e) {
      result.failed++;
      reportError('resync.package', e, { silent: true, extra: { packageId: pkg.id } });
    }
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
  const batch = writeBatch(db);
  const ids: string[] = [];
  const now = new Date().toISOString();
  
  for (const pkg of packages) {
    const docRef = doc(collection(db, PACKAGES_COLLECTION));
    ids.push(docRef.id);
    batch.set(docRef, cleanUndefined({
      ...pkg,
      createdAt: now,
      updatedAt: now
    }));
  }
  
  await batch.commit();
  return ids;
};

// ============================================================================
// MISSIONS
// ============================================================================

export const subscribeToMissions = (
  callback: (missions: Mission[]) => void,
  filters?: { date?: string; zone?: Zone; status?: MissionStatus; driverId?: string }
) => {
  const q = query(collection(db, MISSIONS_COLLECTION), orderBy('date', 'desc'), limit(100));
  
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
  await updateDoc(doc(db, MISSIONS_COLLECTION, missionId), {
    ...fields,
    updatedAt: new Date().toISOString()
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
  const out: Package[] = [];
  for (const id of uniq) {
    const snap = await getDoc(doc(db, PACKAGES_COLLECTION, id));
    if (snap.exists()) out.push({ id: snap.id, ...snap.data() } as Package);
  }
  return out.sort((a, b) =>
    (a.externalId || a.orderNumber || '').localeCompare(b.externalId || b.orderNumber || ''));
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
      transfers = transfers.filter(t => t.timestamp.startsWith(filters.date!));
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

/**
 * Retrouve un colis dispatché à partir d'un code scanné (tracking GFL,
 * N° colis client type BR0513, ou N° de commande). Utilisé pour les
 * transferts en route : le colis peut appartenir à n'importe quelle tournée.
 */
export const findDispatchedPackageByCode = async (code: string): Promise<Package | null> => {
  const cleaned = code.trim();
  if (!cleaned) return null;
  const values = [...new Set([cleaned, cleaned.toUpperCase()])];

  for (const field of ['barcode', 'externalId', 'orderNumber'] as const) {
    for (const value of values) {
      const snap = await getDocs(query(
        collection(db, PACKAGES_COLLECTION),
        where(field, '==', value),
        limit(5)
      ));
      if (snap.empty) continue;
      const pkgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Package));
      // Préférer un colis encore en cours (rattaché à une mission, non livré)
      const active = pkgs.find(p =>
        p.missionId &&
        p.status !== PackageStatus.DELIVERED &&
        p.status !== PackageStatus.RETURNED
      );
      if (active) return active;
      return pkgs[0];
    }
  }
  return null;
};

/**
 * Recherche un colis par n'importe quel code : tracking interne GFL,
 * N° colis client (externalId, ex BR0513), ou N° de commande (ex 13926865).
 * Repli : si le code scanné se termine par un suffixe d'index (ex "13926865-002"
 * ou "13926865002" pour "colis 02"), on réessaie sur le N° de commande nu —
 * les étiquettes clients encodent souvent commande + rang du colis.
 * Retourne le colis le plus récent en cas d'homonymes.
 */
export const findPackageByCode = async (code: string): Promise<Package | null> => {
  // Candidats extraits du code scanné : chaîne brute, N° colis (BR…),
  // N° commande, version sans suffixe de rang. Couvre les DataMatrix clients.
  const candidates = [
    code.trim(),
    code.trim().toUpperCase(),
    ...extractScanTokens(code),
  ].filter(Boolean);
  const uniq = [...new Set(candidates)];
  if (uniq.length === 0) return null;

  for (const field of ['barcode', 'externalId', 'orderNumber'] as const) {
    for (const value of uniq) {
      const snap = await getDocs(query(
        collection(db, PACKAGES_COLLECTION),
        where(field, '==', value),
        limit(5)
      ));
      if (!snap.empty) {
        return snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Package))
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
      }
    }
  }
  return null;
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
const recomputeMissionCounters = (stops: MissionStop[]) => ({
  totalPackages: stops.reduce((a, s) => a + (s.packageCount || 0), 0),
  completedStops: stops.filter(s => s.status === StopStatus.COMPLETED).length,
  failedStops: stops.filter(s => s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length,
});

export const transferPackagesToDriver = async (input: RoadTransferInput): Promise<number> => {
  const { packages: raw, toMission, toDriver, reason, location, notes, newStatus, claimMode } = input;
  // GARDE : ne jamais transférer / prendre en charge un colis DÉJÀ LIVRÉ ou RETOURNÉ
  const pkgs = raw.filter(p => p.status !== PackageStatus.DELIVERED && p.status !== PackageStatus.RETURNED);
  if (pkgs.length === 0) throw new Error('Aucun colis à traiter (colis déjà livrés/retournés exclus)');
  const now = new Date().toISOString();

  // --- 1. Retirer les colis de leur tournée d'origine (TRANSACTION par mission) ---
  const byOriginMission = new Map<string, Package[]>();
  for (const p of pkgs) {
    if (!p.missionId || p.missionId === toMission.id) continue;
    if (!byOriginMission.has(p.missionId)) byOriginMission.set(p.missionId, []);
    byOriginMission.get(p.missionId)!.push(p);
  }

  const originMissions = new Map<string, Mission>();
  for (const [missionId, missionPkgs] of byOriginMission) {
    const ref = doc(db, MISSIONS_COLLECTION, missionId);
    const fromMission = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const m = { id: snap.id, ...snap.data() } as Mission;
      const removed = new Set(missionPkgs.map(p => p.id));
      const newStops = m.stops
        .map(s => {
          const remaining = s.packageIds.filter(id => !removed.has(id));
          return remaining.length === s.packageIds.length ? s : { ...s, packageIds: remaining, packageCount: remaining.length };
        })
        // Retirer les stops vidés (colis partis) SAUF s'ils étaient déjà terminés
        .filter(s => s.packageIds.length > 0 || s.status === StopStatus.COMPLETED);
      tx.update(ref, { stops: newStops, ...recomputeMissionCounters(newStops), updatedAt: now });
      return m;
    });
    if (fromMission) originMissions.set(missionId, fromMission);
  }

  // --- 2. Ajouter à la tournée du receveur (TRANSACTION, avec anti-doublon) ---
  const toRef = doc(db, MISSIONS_COLLECTION, toMission.id);
  const { addedStops, addedIds } = await runTransaction(db, async (tx) => {
    const snap = await tx.get(toRef);
    if (!snap.exists()) throw new Error('Votre tournée est introuvable');
    const m = { id: snap.id, ...snap.data() } as Mission;
    const already = new Set(m.stops.flatMap(s => s.packageIds));
    const toAdd = pkgs.filter(p => !already.has(p.id)); // dédup : colis déjà dans la mission
    let maxSeq = m.stops.reduce((mx, s) => Math.max(mx, s.sequence), 0);
    const byAddress = new Map<string, Package[]>();
    for (const p of toAdd) {
      const key = `${p.address.toLowerCase().trim()}|${p.postalCode}|${p.city.toLowerCase().trim()}`;
      if (!byAddress.has(key)) byAddress.set(key, []);
      byAddress.get(key)!.push(p);
    }
    const stops: MissionStop[] = [];
    for (const group of byAddress.values()) {
      const first = group[0];
      maxSeq += 1;
      stops.push(cleanUndefined({
        id: `transfer-${now.replace(/[:.]/g, '')}-${maxSeq}-${Math.floor(maxSeq)}`,
        sequence: maxSeq, type: 'DELIVERY',
        address: first.address, city: first.city, postalCode: first.postalCode,
        coordinates: first.coordinates, floor: first.floor, hasElevator: first.hasElevator,
        contactName: first.contactName, contactPhone: first.contactPhone,
        packageIds: group.map(p => p.id), packageCount: group.length,
        timeWindowStart: first.timeWindowStart, timeWindowEnd: first.timeWindowEnd,
        serviceTime: first.serviceTime || 5,
        notes: claimMode ? 'Pris en charge par scan' : 'Reçu par transfert en route',
        status: StopStatus.PENDING
      }) as MissionStop);
    }
    const newStops = [...m.stops, ...stops];
    tx.update(toRef, {
      stops: newStops,
      totalPackages: recomputeMissionCounters(newStops).totalPackages,
      status: m.status === MissionStatus.COMPLETED ? MissionStatus.IN_PROGRESS : (m.status || MissionStatus.IN_PROGRESS),
      updatedAt: now
    });
    return { addedStops: stops, addedIds: new Set(toAdd.map(p => p.id)) };
  });

  // --- 3. Mettre à jour les colis réellement ajoutés (les doublons sont ignorés) ---
  for (const p of pkgs) {
    if (!addedIds.has(p.id)) continue;
    const stop = addedStops.find(s => s.packageIds.includes(p.id))!;
    const fromMission = p.missionId ? originMissions.get(p.missionId) : undefined;
    const movement: PackageMovement = cleanUndefined({
      timestamp: now,
      action: claimMode ? 'OUT_FOR_DELIVERY' as const : 'TRANSFERRED' as const,
      driverId: toDriver.id, driverName: toDriver.name,
      vehicleId: toMission.vehicleId, vehiclePlate: toMission.vehiclePlate, location,
      notes: claimMode
        ? `Pris en charge pour livraison par ${toDriver.name}${fromMission?.driverName ? ` (récupéré de ${fromMission.driverName})` : ''}`
        : `Transfert en route${fromMission?.driverName ? ` — de ${fromMission.driverName}` : ''} à ${toDriver.name}${notes ? ` (${notes})` : ''}`
    }) as PackageMovement;

    await updateDoc(doc(db, PACKAGES_COLLECTION, p.id), cleanUndefined({
      missionId: toMission.id, stopId: stop.id,
      currentDriverId: toDriver.id, currentVehicleId: toMission.vehicleId,
      ...(newStatus ? { status: newStatus } : {}),
      movements: [...(p.movements || []), movement],
      updatedAt: now
    }));
  }

  // --- 4. Traçabilité : un document de transfert par tournée d'origine ---
  for (const [missionId, missionPkgs] of byOriginMission) {
    const fromMission = originMissions.get(missionId);
    if (!fromMission) continue;
    const moved = missionPkgs.filter(p => addedIds.has(p.id));
    if (moved.length === 0) continue;
    await addTransfer({
      packageIds: moved.map(p => p.id), packageCount: moved.length,
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

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

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
  stopData: { contactName: string; address: string; postalCode: string; city: string; contactPhone?: string; notes?: string }
): Promise<void> => {
  const ref = doc(db, MISSIONS_COLLECTION, missionId);
  const now = new Date().toISOString();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Tournée introuvable');
    const mission = { id: snap.id, ...snap.data() } as Mission;
    const maxSeq = mission.stops.reduce((m, s) => Math.max(m, s.sequence), 0);
    const stop = cleanUndefined({
      id: `manual-${now.replace(/[:.]/g, '')}-${maxSeq + 1}`,
      sequence: maxSeq + 1,
      type: 'DELIVERY',
      address: stopData.address, city: stopData.city, postalCode: stopData.postalCode,
      contactName: stopData.contactName, contactPhone: stopData.contactPhone,
      packageIds: [], packageCount: 0, serviceTime: 5,
      notes: `⚠️ Arrêt ajouté manuellement${stopData.notes ? ' — ' + stopData.notes : ''}`,
      status: StopStatus.PENDING
    }) as MissionStop;
    tx.update(ref, { stops: [...mission.stops, stop], updatedAt: now });
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
