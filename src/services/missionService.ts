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
  updateDoc,
  deleteDoc,
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
  PackageTransfer, TransferStatus, ProofOfDelivery,
  PostalCodeMapping, User, UserRole
} from '../types';

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
  
  // ZONE EST
  { postalCode: '97440', zone: Zone.EST, city: 'Saint-André' },
  { postalCode: '97470', zone: Zone.EST, city: 'Saint-Benoît' },
  { postalCode: '97431', zone: Zone.EST, city: 'La Plaine des Palmistes' },
  { postalCode: '97437', zone: Zone.EST, city: 'Sainte-Anne' },
  { postalCode: '97438', zone: Zone.EST, city: 'Sainte-Marie' },
  { postalCode: '97441', zone: Zone.EST, city: 'Sainte-Suzanne' },
  { postalCode: '97412', zone: Zone.EST, city: 'Bras-Panon' },
  { postalCode: '97433', zone: Zone.EST, city: 'Salazie' },
  
  // ZONE OUEST
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

export const extractPostalCodeFromAddress = (address: string): string | null => {
  // Format attendu: "6 RUE DE L ETANG ZI BEL AIR,97450,SAINT LOUIS"
  const parts = address.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (/^974\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
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
  movement: Omit<PackageMovement, 'timestamp'>
): Promise<void> => {
  const pkgDoc = await getDoc(doc(db, PACKAGES_COLLECTION, packageId));
  if (!pkgDoc.exists()) throw new Error('Package not found');
  
  const pkg = pkgDoc.data() as Package;
  const now = new Date().toISOString();
  
  await updateDoc(doc(db, PACKAGES_COLLECTION, packageId), {
    status,
    movements: [...(pkg.movements || []), { ...movement, timestamp: now }],
    updatedAt: now
  });
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
    stats.byStatus[mission.status]++;
    stats.byZone[mission.zone]++;
    stats.totalPackages += mission.totalPackages || 0;
    stats.deliveredPackages += mission.deliveredPackages || 0;
    stats.failedPackages += mission.failedPackages || 0;
  }
  
  if (stats.totalPackages > 0) {
    stats.completionRate = Math.round((stats.deliveredPackages / stats.totalPackages) * 100);
  }
  
  return stats;
};
