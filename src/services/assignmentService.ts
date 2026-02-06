/**
 * Service d'assignation Véhicule ↔ Chauffeur
 * 
 * Gère la relation bidirectionnelle entre véhicules et chauffeurs
 * avec vérifications et confirmations.
 */

import { db } from "../firebaseConfig";
import { doc, writeBatch } from "firebase/firestore";
import { Vehicle, User } from "../types";

// ============================================================================
// TYPES
// ============================================================================

export interface AssignmentConflict {
  type: 'VEHICLE_ALREADY_ASSIGNED' | 'DRIVER_HAS_VEHICLE' | 'BOTH';
  vehicleCurrentDriver?: {
    id: string;
    name: string;
  };
  driverCurrentVehicle?: {
    id: string;
    plate: string;
  };
}

export interface AssignmentCheck {
  canAssign: boolean;
  conflict?: AssignmentConflict;
  message?: string;
}

export interface AssignmentResult {
  success: boolean;
  message: string;
  changes?: {
    vehicleUpdated: boolean;
    oldDriverCleared: boolean;
    oldVehicleCleared: boolean;
  };
}

// ============================================================================
// HELPERS - Exportés pour utilisation externe
// ============================================================================

/**
 * Trouve le chauffeur actuellement assigné à un véhicule
 */
export const getVehicleCurrentDriver = (
  vehicle: Vehicle,
  users: User[]
): User | null => {
  const driverId = vehicle.assignedDriverId || vehicle.driverId;
  if (!driverId) return null;
  return users.find(u => u.id === driverId) || null;
};

/**
 * Trouve le véhicule actuellement assigné à un chauffeur
 */
export const getDriverCurrentVehicle = (
  driverId: string,
  vehicles: Vehicle[]
): Vehicle | null => {
  const vehicle = vehicles.find(v => 
    v.assignedDriverId === driverId || v.driverId === driverId
  );
  return vehicle || null;
};

/**
 * Alias pour compatibilité
 */
export const getVehicleForDriver = getDriverCurrentVehicle;

/**
 * Obtient le nom complet d'un chauffeur
 */
export const getDriverFullName = (user: User | null): string => {
  if (!user) return 'Inconnu';
  return `${user.firstName} ${user.lastName}`;
};

// ============================================================================
// VÉRIFICATION DES CONFLITS
// ============================================================================

/**
 * Vérifie les conflits avant assignation
 * 
 * @param vehicleId - ID du véhicule
 * @param driverId - ID du chauffeur à assigner
 * @param allVehicles - Tous les véhicules
 * @param allUsers - Tous les utilisateurs
 */
export const checkAssignmentConflicts = (
  vehicleId: string,
  driverId: string,
  allVehicles: Vehicle[],
  allUsers: User[]
): AssignmentCheck => {
  const vehicle = allVehicles.find(v => v.id === vehicleId);
  const driver = allUsers.find(u => u.id === driverId);

  if (!vehicle || !driver) {
    return { canAssign: false, message: "Véhicule ou chauffeur introuvable" };
  }

  let hasVehicleConflict = false;
  let hasDriverConflict = false;
  const conflict: AssignmentConflict = { type: 'VEHICLE_ALREADY_ASSIGNED' };

  // 1. Vérifier si le véhicule est déjà assigné à un AUTRE chauffeur
  const currentDriverId = vehicle.assignedDriverId || vehicle.driverId;
  if (currentDriverId && currentDriverId !== driverId) {
    const currentDriver = allUsers.find(u => u.id === currentDriverId);
    if (currentDriver) {
      hasVehicleConflict = true;
      conflict.vehicleCurrentDriver = {
        id: currentDriver.id,
        name: `${currentDriver.firstName} ${currentDriver.lastName}`
      };
    }
  }

  // 2. Vérifier si le chauffeur a déjà un AUTRE véhicule
  const currentVehicle = getDriverCurrentVehicle(driverId, allVehicles);
  if (currentVehicle && currentVehicle.id !== vehicleId) {
    hasDriverConflict = true;
    conflict.driverCurrentVehicle = {
      id: currentVehicle.id,
      plate: currentVehicle.plate
    };
  }

  // 3. Pas de conflit
  if (!hasVehicleConflict && !hasDriverConflict) {
    return { canAssign: true };
  }

  // 4. Déterminer le type de conflit
  if (hasVehicleConflict && hasDriverConflict) {
    conflict.type = 'BOTH';
  } else if (hasDriverConflict) {
    conflict.type = 'DRIVER_HAS_VEHICLE';
  } else {
    conflict.type = 'VEHICLE_ALREADY_ASSIGNED';
  }

  // 5. Construire le message
  let message = '';
  if (hasVehicleConflict && hasDriverConflict) {
    message = `⚠️ Double changement requis :\n• Ce véhicule est assigné à ${conflict.vehicleCurrentDriver?.name}\n• ${driver.firstName} a déjà le véhicule ${conflict.driverCurrentVehicle?.plate}`;
  } else if (hasVehicleConflict) {
    message = `Ce véhicule est actuellement assigné à ${conflict.vehicleCurrentDriver?.name}. Voulez-vous le réassigner ?`;
  } else if (hasDriverConflict) {
    message = `${driver.firstName} ${driver.lastName} a déjà le véhicule ${conflict.driverCurrentVehicle?.plate}. Voulez-vous le remplacer ?`;
  }

  return {
    canAssign: false,
    conflict,
    message
  };
};

// ============================================================================
// ASSIGNATION
// ============================================================================

/**
 * Assigne un chauffeur à un véhicule
 * Gère automatiquement les anciennes relations
 * 
 * @param vehicleId - ID du véhicule
 * @param driverId - ID du chauffeur (null pour libérer le véhicule)
 * @param allVehicles - Liste des véhicules pour nettoyer les anciennes relations
 */
export const assignDriverToVehicle = async (
  vehicleId: string,
  driverId: string | null,
  allVehicles: Vehicle[]
): Promise<AssignmentResult> => {
  try {
    const batch = writeBatch(db);
    const changes = {
      vehicleUpdated: false,
      oldDriverCleared: false,
      oldVehicleCleared: false
    };

    // 1. Si on assigne un chauffeur, libérer son ancien véhicule
    if (driverId) {
      const oldVehicle = allVehicles.find(v => 
        (v.assignedDriverId === driverId || v.driverId === driverId) && 
        v.id !== vehicleId
      );
      
      if (oldVehicle) {
        const oldVehicleRef = doc(db, "vehicles", oldVehicle.id);
        batch.update(oldVehicleRef, { driverId: null });
        changes.oldVehicleCleared = true;
      }
    }

    // 2. Mettre à jour le véhicule principal
    const vehicleRef = doc(db, "vehicles", vehicleId);
    batch.update(vehicleRef, { driverId: driverId });
    changes.vehicleUpdated = true;

    // 3. Exécuter
    await batch.commit();

    const message = driverId 
      ? "✅ Chauffeur assigné avec succès"
      : "✅ Véhicule libéré";

    return { success: true, message, changes };

  } catch (error: any) {
    console.error("❌ Erreur assignation:", error);
    return {
      success: false,
      message: `Erreur: ${error.message}`
    };
  }
};

/**
 * Libère un véhicule (retire le chauffeur)
 */
export const unassignVehicle = async (vehicleId: string): Promise<AssignmentResult> => {
  return assignDriverToVehicle(vehicleId, null, []);
};

/**
 * Libère le véhicule d'un chauffeur
 */
export const unassignDriverVehicle = async (
  driverId: string,
  allVehicles: Vehicle[]
): Promise<AssignmentResult> => {
  const vehicle = getDriverCurrentVehicle(driverId, allVehicles);
  if (!vehicle) {
    return { success: true, message: "Ce chauffeur n'a pas de véhicule assigné" };
  }
  return assignDriverToVehicle(vehicle.id, null, allVehicles);
};
