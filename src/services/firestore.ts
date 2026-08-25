
import { db, storage } from "../firebaseConfig";
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  query, 
  setDoc,
  getDoc,
  where,
  getDocs,
  or,
  Query,
  QuerySnapshot,
  DocumentData
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Vehicle, FuelLog, MaintenanceLog, Issue, VehicleStatus, User, UserRole, LeaveRequest, QuoteRequest, CompanyDocument, DocumentAcknowledgment, SavedAddress } from "../types";
import { reportError } from "./logService";
import { cleanUndefined } from "../utils/firestore";

// --- HELPER UTILS ---
const mapDbStatusToApp = (dbStatus: any): VehicleStatus => {
  if (!dbStatus) return VehicleStatus.ACTIVE;
  const normalized = String(dbStatus).toLowerCase();
  
  if (normalized.includes('actif') || normalized.includes('service')) return VehicleStatus.ACTIVE;
  if (normalized.includes('maintenance') || normalized.includes('garage')) return VehicleStatus.MAINTENANCE;
  if (normalized.includes('panne') || normalized.includes('problème') || normalized.includes('issue')) return VehicleStatus.ISSUE;
  if (normalized.includes('disponible') || normalized.includes('idle')) return VehicleStatus.IDLE;
  
  return VehicleStatus.ACTIVE; // Fallback sûr
};

// Retire les champs undefined (non supportés par Firestore). Délègue à la source
// de vérité unique `cleanUndefined` (utils/firestore) : nettoyage RÉCURSIF, donc
// plus robuste que l'ancienne variante shallow (les undefined imbriqués — dans
// customDeadlines/logs/photos/location… — sont désormais retirés eux aussi).
const cleanFirestoreData = <T>(data: T): T => cleanUndefined(data);

// NB : un ancien helper `isStaffOrAdmin` classait le MÉCANICIEN comme admin —
// en contradiction avec firestore.rules `isAdminRole()` (qui l'exclut). Il
// n'était utilisé nulle part (code mort) : supprimé pour éviter le piège. Pour
// « est-ce un interne/direction/client ? », s'appuyer sur permissions.ts et les
// helpers de utils/role.ts, en miroir strict de firestore.rules.

// --- STORAGE (Fichiers) ---

/**
 * Upload un fichier image vers Firebase Storage et retourne l'URL de téléchargement.
 * @param file Le fichier natif (File) provenant de l'input
 * @param path Le dossier de destination (ex: 'issues')
 */
export const uploadImageToStorage = async (file: File, path: string = 'uploads'): Promise<string> => {
    try {
        // Création d'un nom unique : timestamp_nom_fichier
        // On nettoie le nom du fichier pour éviter les caractères spéciaux
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9.]/g, "_");
        const uniqueFileName = `${Date.now()}_${sanitizedName}`;
        const storageRef = ref(storage, `${path}/${uniqueFileName}`);

        // Upload du fichier
        const snapshot = await uploadBytes(storageRef, file);

        // Récupération de l'URL publique
        const downloadURL = await getDownloadURL(snapshot.ref);
        return downloadURL;
    } catch (error) {
        console.error("Erreur lors de l'upload de l'image:", error);
        throw new Error("Échec de l'envoi de l'image vers le serveur.");
    }
};

// --- SECURITE & AUTH ---

// Vérifie si un email est autorisé (présent dans la base users)
export const checkUserEmailAuthorized = async (email: string): Promise<boolean> => {
    try {
        // Normaliser l'email (lowercase, trim) pour matcher avec Firebase Auth
        const normalizedEmail = email.toLowerCase().trim();
        console.log(`🔍 Vérification autorisation pour: ${normalizedEmail}`);
        
        const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            console.warn(`❌ Email non trouvé dans la base: ${normalizedEmail}`);
            return false;
        }
        
        console.log(`✅ Email autorisé: ${normalizedEmail}`);
        return true;
    } catch (e) {
        console.error("Erreur vérification email:", e);
        return false;
    }
};

// Lie le compte Auth (nouvellement créé) au profil existant (créé par l'admin)
export const linkAuthToProfile = async (email: string, authUid: string) => {
    // Normaliser l'email
    const normalizedEmail = email.toLowerCase().trim();
    const q = query(collection(db, "users"), where("email", "==", normalizedEmail));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return;

    const oldDoc = querySnapshot.docs[0];
    const userData = oldDoc.data();

    // Si le profil a déjà le bon ID (cas rare ou déjà migré), on arrête
    if (oldDoc.id === authUid) return;

    // 1. Créer le nouveau document avec le bon UID (Auth ID).
    //    Autorisé par les règles (users create: request.auth.uid == userId).
    //    Si CETTE étape échoue, on propage : sans profil à son UID, les règles
    //    Firestore ne pourront jamais reconnaître le rôle → connexion inutile.
    await setDoc(doc(db, "users", authUid), {
        ...userData as any, // Spread here. userData is DocumentData.
        id: authUid, // On s'assure que l'ID interne matche
        email: normalizedEmail // S'assurer que l'email est normalisé
    });

    // 2. Supprimer l'ancien document (ID temporaire). ATTENTION : la suppression
    //    d'un profil est réservée aux admins (règles). Pour un chauffeur/client
    //    qui migre le sien, ce delete est REFUSÉ. Ce n'est PAS bloquant : le
    //    nouveau doc est déjà en place, la connexion DOIT aboutir. On loggue le
    //    doublon pour nettoyage admin ultérieur — mais on ne fait plus planter
    //    la connexion (ancien bug : le chauffeur était éjecté à sa 1re connexion).
    try {
        await deleteDoc(doc(db, "users", oldDoc.id));
        console.log(`Profil migré de ${oldDoc.id} vers ${authUid}`);
    } catch (delErr) {
        reportError('auth.linkProfile.deleteOld', delErr, {
            silent: true,
            extra: { oldId: oldDoc.id, authUid, email: normalizedEmail }
        });
    }
};

// --- USERS ---
export const subscribeToUsers = (currentUser: User, callback: (data: User[]) => void) => {
  let q: Query<DocumentData, DocumentData>;
  
  // SECURITY: Si Client, ne voir que les membres de SA société
  if (currentUser.role === UserRole.CLIENT) {
      if (currentUser.companyName) {
          q = query(collection(db, "users"), where("companyName", "==", currentUser.companyName));
      } else {
          // Fallback safe: ne voir que soi-même
          q = query(collection(db, "users"), where("id", "==", currentUser.id));
      }
  } 
  // SECURITY: Si Chauffeur, ne voir que soi-même (ou tous si besoin annuaire ?)
  // Pour l'instant, on laisse l'accès lecture staff aux chauffeurs pour l'annuaire interne
  else {
      q = collection(db, "users");
  }

  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    callback(users);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'users':", error);
  });
};

// Lecture unique (Legacy, utilisé au chargement initial si besoin)
export const getUserProfile = async (uid: string): Promise<User | null> => {
    try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);
        const data = snap.data();
        if (snap.exists() && data) return { id: snap.id, ...data } as User;
        return null;
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return null;
    }
};

// Écoute temps réel du profil courant (CRUCIAL pour les changements de rôle)
export const subscribeToUserProfile = (uid: string, callback: (user: User | null) => void) => {
    const ref = doc(db, "users", uid);
    return onSnapshot(ref, (snap) => {
        const data = snap.data();
        if (snap.exists() && data) {
            callback({ id: snap.id, ...data } as User);
        } else {
            callback(null);
        }
    }, (error) => {
        console.error("Error subscribing to profile:", error);
    });
};

export const createUserProfile = async (user: User): Promise<boolean> => {
    try {
        const { id, ...data } = user;
        await setDoc(doc(db, "users", id), cleanFirestoreData(data));
        console.log(`✅ Profil créé: users/${id}`);
        return true;
    } catch (e) {
        console.error("❌ Erreur création profil:", e);
        throw e; // Propager l'erreur pour que l'appelant puisse la gérer
    }
};

export const updateUserProfile = async (user: User) => {
    try {
        const ref = doc(db, "users", user.id);
        const { id, ...data } = user; // Ne pas update l'ID dans les champs
        await updateDoc(ref, cleanFirestoreData(data));
    } catch (e) {
        console.error("Error updating user:", e);
    }
};

/**
 * Résultat d'un nettoyage des profils utilisateurs en double.
 */
export interface DuplicateCleanupResult {
  groupsChecked: number;
  removed: { id: string; email: string; name: string }[];
  skipped: { email: string; reason: string; ids: string[] }[];
}

/**
 * Supprime les profils utilisateurs en double laissés par la migration d'ID
 * (un profil créé avant la 1re connexion → nouveau doc à l'UID Auth, ancien doc
 * non supprimable par le chauffeur lui-même).
 *
 * Discriminateur sûr : le VRAI profil est celui qui possède `lastLoginAt`
 * (écrit uniquement sur users/{authUid} à chaque connexion). Le doublon de
 * migration n'en a jamais. En cas d'ambiguïté (aucun ou plusieurs profils avec
 * connexion pour un même email), on NE supprime RIEN et on signale.
 *
 * Réservé aux admins (les règles Firestore l'imposent aussi côté serveur).
 */
export const cleanupDuplicateUserProfiles = async (
  currentUser: User
): Promise<DuplicateCleanupResult> => {
  const result: DuplicateCleanupResult = { groupsChecked: 0, removed: [], skipped: [] };

  const role = String(currentUser.role || '').toLowerCase();
  const isAdmin = /^(admin|pr[eé]sident[e]?|directeur|directrice|direction|secr[eé]taire|secr[eé]tariat)$/.test(role);
  if (!isAdmin) throw new Error("Seul un administrateur peut nettoyer les profils en double.");

  const snap = await getDocs(collection(db, "users"));
  const all = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  // Grouper par email normalisé
  const byEmail = new Map<string, typeof all>();
  for (const u of all) {
    const email = String(u.email || '').toLowerCase().trim();
    if (!email) continue;
    const arr = byEmail.get(email) || [];
    arr.push(u);
    byEmail.set(email, arr);
  }

  for (const [email, group] of byEmail) {
    if (group.length < 2) continue;
    result.groupsChecked++;

    // Profils ayant déjà servi à se connecter (donc = users/{authUid})
    const withLogin = group
      .filter(u => !!u.lastLoginAt)
      .sort((a, b) => String(b.lastLoginAt).localeCompare(String(a.lastLoginAt)));

    if (withLogin.length === 0) {
      result.skipped.push({ email, reason: "aucun profil avec connexion (ambigu)", ids: group.map(u => u.id) });
      continue;
    }
    if (withLogin.length > 1) {
      result.skipped.push({ email, reason: "plusieurs profils actifs (vérif. manuelle)", ids: group.map(u => u.id) });
      continue;
    }

    const keeper = withLogin[0];
    const toRemove = group.filter(u => u.id !== keeper.id); // aucun n'a de lastLoginAt

    for (const dup of toRemove) {
      try {
        await deleteDoc(doc(db, "users", dup.id));
        result.removed.push({
          id: dup.id,
          email,
          name: `${dup.firstName || ''} ${dup.lastName || ''}`.trim() || '(sans nom)'
        });
      } catch (e) {
        reportError('users.cleanupDuplicate', e, { silent: true, extra: { dupId: dup.id, email } });
        result.skipped.push({ email, reason: "suppression refusée", ids: [dup.id] });
      }
    }
  }

  return result;
};

/** Enregistre la date de dernière connexion (appelé à chaque ouverture de l'app). */
export const recordUserLogin = async (uid: string) => {
    try {
        await updateDoc(doc(db, "users", uid), { lastLoginAt: new Date().toISOString() });
    } catch (e) {
        // Non bloquant : ne pas empêcher la connexion si l'écriture échoue
        console.error("Error recording last login:", e);
    }
};

export const deleteUserProfile = async (uid: string) => {
    try {
        await deleteDoc(doc(db, "users", uid));
    } catch (e) {
        console.error("Error deleting user profile:", e);
    }
};

// --- VEHICLES ---
export const subscribeToVehicles = (callback: (data: Vehicle[]) => void) => {
  const q = collection(db, "vehicles");
  
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const vehicles = snapshot.docs.map(doc => {
      const data = doc.data();
      
      const plate = data.licensePlate || data.plate || "IMMAT-INCONNUE";
      const make = data.make || "";
      const modelRaw = data.model || "";
      const fullModel = `${make} ${modelRaw}`.trim() || "Modèle Inconnu";

      return {
        id: doc.id,
        plate: plate,
        model: fullModel,
        type: data.fuelType || data.type || 'Diesel',
        status: mapDbStatusToApp(data.status),
        make: make,
        year: data.year ? Number(data.year) : undefined,
        fuelType: data.fuelType,
        acquisitionType: data.acquisitionType || "Achat",
        currentMileage: Number(data.currentMileage) || 0,
        fuelLevel: data.fuelLevel !== undefined ? Number(data.fuelLevel) : 50,
        maintenanceInterval: Number(data.maintenanceInterval) || 15000,
        lastMaintenanceMileage: Number(data.lastMaintenanceMileage) || 0,
        lastMaintenanceDate: data.lastMaintenanceDate || new Date().toISOString(),
        monthlyCost: Number(data.monthlyCost) || 0,
        costPerKm: data.monthlyCost && Number(data.currentMileage) > 0 ? (Number(data.monthlyCost) / 1000) : 0.5,
        assignedDriverId: data.driverId || null,
        driverId: data.driverId || null,
        photoUrl: data.photoUrl || null,
        technicalControlDate: data.technicalControlDate || undefined,
        fireExtinguisherDate: data.fireExtinguisherDate || undefined,
        tailgateDate: data.tailgateDate || undefined,
        chronotachygraphDate: data.chronotachygraphDate || undefined,
        speedLimiterDate: data.speedLimiterDate || undefined,
        location: data.location || { lat: 48.8566, lng: 2.3522, address: 'Non localisé' },
        customDeadlines: data.customDeadlines || []
      } as Vehicle;
    });

    callback(vehicles);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'vehicles':", error);
    callback([]);
  });
};

export const addVehicleToFirestore = async (vehicle: Vehicle) => {
  const parts = vehicle.model.split(' ');
  const make = vehicle.make || parts[0] || 'Inconnu';
  const model = vehicle.model.replace(make, '').trim() || parts.slice(1).join(' ') || 'Inconnu';

  const dataToSave = {
    licensePlate: vehicle.plate,
    make: make,
    model: model,
    status: "Actif", 
    currentMileage: Number(vehicle.currentMileage),
    fuelType: vehicle.type,
    maintenanceInterval: Number(vehicle.maintenanceInterval),
    year: vehicle.year || new Date().getFullYear(),
    acquisitionType: vehicle.acquisitionType || "Achat",
    driverId: vehicle.assignedDriverId || null,
    technicalControlDate: vehicle.technicalControlDate || null,
    customDeadlines: vehicle.customDeadlines || []
  };
  const created = await addDoc(collection(db, "vehicles"), cleanFirestoreData(dataToSave));
  // Lien bidirectionnel : renseigne aussi le côté utilisateur.
  if (vehicle.assignedDriverId) {
    updateDoc(doc(db, "users", vehicle.assignedDriverId), { assignedVehicleId: created.id }).catch(() => {});
  }
};

export const updateVehicleInFirestore = async (vehicle: Vehicle) => {
  const ref = doc(db, "vehicles", vehicle.id);

  // Lien bidirectionnel : on lit l'ancien chauffeur pour le nettoyer si besoin.
  let prevDriverId: string | null = null;
  try {
    const prev = await getDoc(ref);
    prevDriverId = prev.exists() ? ((prev.data() as any).driverId || null) : null;
  } catch { /* best-effort */ }
  const newDriverId = vehicle.assignedDriverId || null;

  const updateData: any = {
    currentMileage: Number(vehicle.currentMileage),
    licensePlate: vehicle.plate,
    driverId: newDriverId,
    status: vehicle.status,
    customDeadlines: vehicle.customDeadlines || []
  };

  // Update conditional fields
  if (vehicle.technicalControlDate) updateData.technicalControlDate = vehicle.technicalControlDate;
  if (vehicle.maintenanceInterval) updateData.maintenanceInterval = vehicle.maintenanceInterval;
  if (vehicle.fireExtinguisherDate) updateData.fireExtinguisherDate = vehicle.fireExtinguisherDate;
  if (vehicle.tailgateDate) updateData.tailgateDate = vehicle.tailgateDate;
  if (vehicle.chronotachygraphDate) updateData.chronotachygraphDate = vehicle.chronotachygraphDate;
  if (vehicle.speedLimiterDate) updateData.speedLimiterDate = vehicle.speedLimiterDate;

  await updateDoc(ref, cleanFirestoreData(updateData));

  // Synchronise le côté utilisateur (assignedVehicleId) — best-effort, non bloquant.
  if (newDriverId && newDriverId !== prevDriverId) {
    updateDoc(doc(db, "users", newDriverId), { assignedVehicleId: vehicle.id }).catch(() => {});
  }
  if (prevDriverId && prevDriverId !== newDriverId) {
    updateDoc(doc(db, "users", prevDriverId), { assignedVehicleId: "" }).catch(() => {});
  }
};

export const deleteVehicleFromFirestore = async (id: string) => {
  const ref = doc(db, "vehicles", id);
  await deleteDoc(ref);
};

// --- FUEL LOGS ---
export const subscribeToFuelLogs = (callback: (data: FuelLog[]) => void) => {
  const q = query(collection(db, "fuel_logs"));
  
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const logs = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        vehicleId: data.vehicleId,
        date: data.date,
        // `|| 0` protège des NaN qui propagent dans tous les KPIs Dashboard
        // (reduce + .toFixed sur NaN → "NaN €" dans l'UI)
        cost: Number(data.cost) || 0,
        mileage: Number(data.mileage) || 0,
        volume: Number(data.liters || data.volume) || 0,
        fullTank: true,
        adBlueVolume: Number(data.adBlueLiters || 0),
        adBlueCost: Number(data.adBlueCost || 0),
        station: data.station,
        receiptUrl: data.receiptUrl,
        isRentalEntry: data.isRentalEntry || false
      } as FuelLog;
    });
    logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    callback(logs);
  }, (error) => {
    console.error("Error subscribing to fuel_logs:", error);
  });
};

export const addFuelLogToFirestore = async (log: FuelLog) => {
  const dataToSave = {
    vehicleId: log.vehicleId,
    date: log.date,
    cost: log.cost,
    mileage: log.mileage,
    liters: log.volume, 
    adBlueLiters: log.adBlueVolume || 0,
    adBlueCost: log.adBlueCost || 0,
    station: log.station || '',
    receiptUrl: log.receiptUrl || '',
    isRentalEntry: false
  };
  await addDoc(collection(db, "fuel_logs"), cleanFirestoreData(dataToSave));
};

// Mise à jour d'un plein de carburant
export const updateFuelLogInFirestore = async (log: FuelLog) => {
  // L'ID Firestore est stocké dans log.firestoreId ou on le cherche
  const logId = (log as any).firestoreId || log.id;
  
  if (!logId || logId.startsWith('f-')) {
    // Si c'est un ID temporaire (f-xxx), il faut trouver le document par date/vehicleId
    const q = query(
      collection(db, "fuel_logs"),
      where("vehicleId", "==", log.vehicleId),
      where("date", "==", log.date)
    );
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      throw new Error('Plein de carburant non trouvé dans la base de données');
    }
    
    const docRef = doc(db, "fuel_logs", snapshot.docs[0].id);
    await updateDoc(docRef, cleanFirestoreData({
      cost: log.cost,
      mileage: log.mileage,
      liters: log.volume,
      adBlueLiters: log.adBlueVolume || 0,
      adBlueCost: log.adBlueCost || 0,
      receiptUrl: log.receiptUrl || '',
      lastModifiedAt: (log as any).lastModifiedAt || new Date().toISOString(),
      lastModifiedBy: (log as any).lastModifiedBy || '',
      lastModifiedByName: (log as any).lastModifiedByName || ''
    }));
  } else {
    // On a l'ID Firestore directement
    const docRef = doc(db, "fuel_logs", logId);
    await updateDoc(docRef, cleanFirestoreData({
      cost: log.cost,
      mileage: log.mileage,
      liters: log.volume,
      adBlueLiters: log.adBlueVolume || 0,
      adBlueCost: log.adBlueCost || 0,
      receiptUrl: log.receiptUrl || '',
      lastModifiedAt: (log as any).lastModifiedAt || new Date().toISOString(),
      lastModifiedBy: (log as any).lastModifiedBy || '',
      lastModifiedByName: (log as any).lastModifiedByName || ''
    }));
  }
};

// --- ISSUES (INCIDENTS) ---
export const subscribeToIssues = (callback: (data: Issue[]) => void) => {
  const q = collection(db, "issues");

  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const issues = snapshot.docs.map(doc => {
        const data = doc.data();
        let priority: 'Low' | 'Medium' | 'High' = 'Low';
        const p = String(data.priority || '').toLowerCase();
        
        if (p.includes('haut') || p.includes('high') || p === 'urgent' || p.includes('critique')) priority = 'High';
        else if (p.includes('moyen') || p.includes('medium')) priority = 'Medium';
        
        return {
          id: doc.id,
          vehicleId: data.vehicleId || '',
          reportedByUserId: data.reportedByUserId || 'unknown',
          description: data.description || 'Aucune description',
          date: data.date || new Date().toISOString(),
          priority: priority,
          status: data.status || 'Nouveau',
          garageResponse: data.garageResponse,
          interventionDate: data.interventionDate,
          logs: data.logs || [],
          photos: data.photos || [] 
        } as Issue;
    });
    issues.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    callback(issues);
  }, (error) => {
     console.error("❌ [Firestore Error] Impossible de lire 'issues':", error);
     callback([]);
  });
};

export const addIssueToFirestore = async (issue: Issue) => {
  const data = {
    vehicleId: issue.vehicleId,
    reportedByUserId: issue.reportedByUserId,
    description: issue.description,
    date: issue.date,
    priority: issue.priority === 'High' ? 'Haute' : issue.priority === 'Medium' ? 'Moyenne' : 'Basse',
    status: issue.status,
    logs: issue.logs || [],
    photos: issue.photos || [] 
  };
  await addDoc(collection(db, "issues"), cleanFirestoreData(data));
};

export const updateIssueInFirestore = async (issue: Issue) => {
    try {
        const ref = doc(db, "issues", issue.id);
        const { id, ...data } = issue;
        await updateDoc(ref, cleanFirestoreData(data));
    } catch (e) {
        console.error("Error updating issue:", e);
    }
};


// --- MAINTENANCE ---
export const subscribeToMaintenance = (callback: (data: MaintenanceLog[]) => void) => {
    const q = query(collection(db, "maintenance_logs"));
    return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceLog));
      logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      callback(logs);
    }, (error) => {
      console.warn("Error subscribing to maintenance_logs:", error);
    });
};

// --- LEAVES (CONGÉS) ---
export const subscribeToLeaves = (callback: (data: LeaveRequest[]) => void) => {
  const q = collection(db, "leaves");
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const leaves = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest));
    callback(leaves);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'leaves':", error);
  });
};

export const addLeaveToFirestore = async (leave: LeaveRequest) => {
  const { id, ...data } = leave;
  await setDoc(doc(db, "leaves", id), cleanFirestoreData(data));
};

export const updateLeaveInFirestore = async (leave: LeaveRequest) => {
  const { id, ...data } = leave;
  await setDoc(doc(db, "leaves", id), cleanFirestoreData(data), { merge: true });
};

export const deleteLeaveFromFirestore = async (id: string) => {
  await deleteDoc(doc(db, "leaves", id));
};

// --- QUOTES (DEVIS) - SECURISE ---
export const subscribeToQuotes = (currentUser: User, callback: (data: QuoteRequest[]) => void) => {
  let q: Query<DocumentData, DocumentData>;

  // SECURITY: Si Client, ne voir que MES devis (soit par clientId, soit par requesterId)
  if (currentUser.role === UserRole.CLIENT) {
      q = query(
          collection(db, "quotes"), 
          or(
              where("clientId", "==", currentUser.id),
              where("requesterId", "==", currentUser.id)
          )
      );
  } else {
      // Staff voit tout
      q = collection(db, "quotes");
  }

  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const quotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as QuoteRequest));
    callback(quotes);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'quotes':", error);
  });
};

export const addQuoteToFirestore = async (quote: QuoteRequest) => {
  const { id, ...data } = quote;
  await setDoc(doc(db, "quotes", id), cleanFirestoreData(data));
};

export const updateQuoteInFirestore = async (quote: QuoteRequest) => {
  const { id, ...data } = quote;
  await setDoc(doc(db, "quotes", id), cleanFirestoreData(data), { merge: true });
};

// --- COMPANY DOCUMENTS (Documents légaux) ---
export const subscribeToCompanyDocuments = (callback: (data: CompanyDocument[]) => void) => {
  return onSnapshot(collection(db, "companyDocuments"), (snapshot: QuerySnapshot<DocumentData>) => {
    const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CompanyDocument));
    callback(documents);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'companyDocuments':", error);
  });
};

export const addCompanyDocumentToFirestore = async (document: CompanyDocument) => {
  const { id, ...data } = document;
  await setDoc(doc(db, "companyDocuments", id), cleanFirestoreData(data));
};

export const updateCompanyDocumentInFirestore = async (document: CompanyDocument) => {
  const { id, ...data } = document;
  await setDoc(doc(db, "companyDocuments", id), cleanFirestoreData(data), { merge: true });
};

export const deleteCompanyDocumentFromFirestore = async (id: string) => {
  await deleteDoc(doc(db, "companyDocuments", id));
};

// --- DOCUMENT ACKNOWLEDGMENTS (Signatures/Lectures) ---
export const subscribeToDocumentAcknowledgments = (callback: (data: DocumentAcknowledgment[]) => void) => {
  return onSnapshot(collection(db, "documentAcknowledgments"), (snapshot: QuerySnapshot<DocumentData>) => {
    const acks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocumentAcknowledgment));
    callback(acks);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'documentAcknowledgments':", error);
  });
};

export const addDocumentAcknowledgmentToFirestore = async (ack: DocumentAcknowledgment) => {
  const { id, ...data } = ack;
  await setDoc(doc(db, "documentAcknowledgments", id), cleanFirestoreData(data));
};

// --- ABSENCES (NOUVEAU SYSTÈME) ---
import { Absence, AbsenceDocument } from "../types";

export const subscribeToAbsences = (callback: (data: Absence[]) => void) => {
  const q = collection(db, "absences");
  return onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
    const absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Absence));
    callback(absences);
  }, (error) => {
    console.error("❌ [Firestore Error] Impossible de lire 'absences':", error);
  });
};

export const addAbsenceToFirestore = async (absence: Absence) => {
  const { id, ...data } = absence;
  await setDoc(doc(db, "absences", id), cleanFirestoreData(data));
};

export const updateAbsenceInFirestore = async (absence: Absence) => {
  const { id, ...data } = absence;
  await setDoc(doc(db, "absences", id), cleanFirestoreData(data), { merge: true });
};

export const deleteAbsenceFromFirestore = async (id: string) => {
  await deleteDoc(doc(db, "absences", id));
};

// Upload document justificatif
export const uploadAbsenceDocument = async (
  absenceId: string, 
  file: File, 
  docType: AbsenceDocument['type']
): Promise<string> => {
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `absences/${absenceId}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, path);
  
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  
  return url;
};

// ============================================================================
// CARNET D'ADRESSES CLIENT
// ============================================================================

// Écouter les adresses d'une entreprise
export const subscribeToSavedAddresses = (
  companyName: string,
  callback: (addresses: SavedAddress[]) => void
) => {
  const q = query(
    collection(db, "savedAddresses"),
    where("companyName", "==", companyName)
  );

  return onSnapshot(q, (snapshot) => {
    const addresses = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as SavedAddress[];
    
    // Trier : favoris d'abord, puis par nombre d'utilisations, puis par date
    addresses.sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      if ((b.usageCount || 0) !== (a.usageCount || 0)) {
        return (b.usageCount || 0) - (a.usageCount || 0);
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    
    callback(addresses);
  });
};

// Ajouter une adresse
export const addSavedAddress = async (address: Omit<SavedAddress, 'id'>): Promise<string> => {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, "savedAddresses"), {
    ...address,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  });
  return docRef.id;
};

// Import en lot du carnet de destinataires (retourne le nombre créé)
export const addSavedAddressesBatch = async (addresses: Omit<SavedAddress, 'id'>[]): Promise<number> => {
  const now = new Date().toISOString();
  let created = 0;
  await Promise.all(addresses.map(async (address) => {
    try {
      await addDoc(collection(db, "savedAddresses"), cleanFirestoreData({
        ...address,
        usageCount: 0,
        createdAt: now,
        updatedAt: now
      }));
      created++;
    } catch { /* ignore une ligne en échec, on continue */ }
  }));
  return created;
};

// Mettre à jour une adresse
export const updateSavedAddress = async (address: SavedAddress): Promise<void> => {
  const { id, ...data } = address;
  await updateDoc(doc(db, "savedAddresses", id), {
    ...cleanFirestoreData(data),
    updatedAt: new Date().toISOString()
  });
};

// Supprimer une adresse
export const deleteSavedAddress = async (addressId: string): Promise<void> => {
  await deleteDoc(doc(db, "savedAddresses", addressId));
};

// Incrémenter le compteur d'utilisation
export const incrementAddressUsage = async (addressId: string): Promise<void> => {
  const docRef = doc(db, "savedAddresses", addressId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    const currentCount = docSnap.data().usageCount || 0;
    await updateDoc(docRef, {
      usageCount: currentCount + 1,
      updatedAt: new Date().toISOString()
    });
  }
};

// Toggle favori
export const toggleAddressFavorite = async (addressId: string, isFavorite: boolean): Promise<void> => {
  await updateDoc(doc(db, "savedAddresses", addressId), {
    isFavorite,
    updatedAt: new Date().toISOString()
  });
};
