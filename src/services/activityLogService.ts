/**
 * SERVICE DE LOGS D'ACTIVITÉ (AUDIT TRAIL)
 * 
 * Ce service enregistre toutes les actions importantes dans Firestore
 * pour assurer la traçabilité et permettre les audits.
 */

import { db } from '../firebaseConfig';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  Timestamp,
  QueryConstraint
} from 'firebase/firestore';
import { ActivityLog, ActivityAction, ActivityCategory, User } from '../types';

// Collection Firestore
const LOGS_COLLECTION = 'activity_logs';

// Helper pour nettoyer les données avant Firestore
const cleanData = (obj: any): any => {
  if (obj === undefined || obj === null) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanData);
  
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = cleanData(value);
    }
  }
  return cleaned;
};

// Mapper action -> catégorie
const getCategory = (action: ActivityAction): ActivityCategory => {
  if (action.startsWith('USER_')) return ActivityCategory.USERS;
  if (action.startsWith('VEHICLE_')) return ActivityCategory.VEHICLES;
  if (action.startsWith('FUEL_')) return ActivityCategory.FUEL;
  if (action.startsWith('MAINTENANCE_')) return ActivityCategory.MAINTENANCE;
  if (action.startsWith('ISSUE_')) return ActivityCategory.ISSUES;
  if (action.startsWith('DOCUMENT_')) return ActivityCategory.DOCUMENTS;
  if (action.startsWith('ABSENCE_')) return ActivityCategory.ABSENCES;
  if (action.startsWith('QUOTE_')) return ActivityCategory.QUOTES;
  return ActivityCategory.SYSTEM;
};

// Mapper action -> description lisible
const getActionLabel = (action: ActivityAction): string => {
  const labels: Record<ActivityAction, string> = {
    // Utilisateurs
    [ActivityAction.USER_CREATED]: 'a créé un utilisateur',
    [ActivityAction.USER_UPDATED]: 'a modifié un utilisateur',
    [ActivityAction.USER_DELETED]: 'a supprimé un utilisateur',
    [ActivityAction.USER_ACTIVATED]: 'a activé un compte',
    [ActivityAction.USER_DEACTIVATED]: 'a désactivé un compte',
    [ActivityAction.USER_LOGIN]: 's\'est connecté',
    [ActivityAction.USER_LOGOUT]: 's\'est déconnecté',
    
    // Véhicules
    [ActivityAction.VEHICLE_CREATED]: 'a ajouté un véhicule',
    [ActivityAction.VEHICLE_UPDATED]: 'a modifié un véhicule',
    [ActivityAction.VEHICLE_DELETED]: 'a supprimé un véhicule',
    [ActivityAction.VEHICLE_ASSIGNED]: 'a assigné un véhicule',
    [ActivityAction.VEHICLE_UNASSIGNED]: 'a désassigné un véhicule',
    [ActivityAction.VEHICLE_IMMOBILIZED]: 'a immobilisé un véhicule',
    [ActivityAction.VEHICLE_REACTIVATED]: 'a réactivé un véhicule',
    
    // Carburant
    [ActivityAction.FUEL_CREATED]: 'a enregistré un plein',
    [ActivityAction.FUEL_UPDATED]: 'a modifié un plein',
    [ActivityAction.FUEL_DELETED]: 'a supprimé un plein',
    
    // Maintenance
    [ActivityAction.MAINTENANCE_CREATED]: 'a créé une maintenance',
    [ActivityAction.MAINTENANCE_UPDATED]: 'a modifié une maintenance',
    [ActivityAction.MAINTENANCE_COMPLETED]: 'a terminé une maintenance',
    
    // Incidents
    [ActivityAction.ISSUE_CREATED]: 'a signalé un incident',
    [ActivityAction.ISSUE_RESOLVED]: 'a résolu un incident',
    [ActivityAction.ISSUE_UPDATED]: 'a modifié un incident',
    
    // Documents
    [ActivityAction.DOCUMENT_CREATED]: 'a créé un document',
    [ActivityAction.DOCUMENT_UPDATED]: 'a modifié un document',
    [ActivityAction.DOCUMENT_DELETED]: 'a supprimé un document',
    [ActivityAction.DOCUMENT_SIGNED]: 'a signé un document',
    [ActivityAction.DOCUMENT_READ]: 'a lu un document',
    
    // Absences
    [ActivityAction.ABSENCE_CREATED]: 'a créé une demande d\'absence',
    [ActivityAction.ABSENCE_APPROVED]: 'a approuvé une absence',
    [ActivityAction.ABSENCE_REJECTED]: 'a refusé une absence',
    [ActivityAction.ABSENCE_CANCELLED]: 'a annulé une absence',
    
    // Devis
    [ActivityAction.QUOTE_CREATED]: 'a créé un devis',
    [ActivityAction.QUOTE_UPDATED]: 'a modifié un devis',
    [ActivityAction.QUOTE_APPROVED]: 'a approuvé un devis',
    [ActivityAction.QUOTE_REJECTED]: 'a refusé un devis',
    
    // Système
    [ActivityAction.SYSTEM_SETTINGS_UPDATED]: 'a modifié les paramètres',
    [ActivityAction.PERMISSIONS_UPDATED]: 'a modifié les permissions',
    [ActivityAction.DATA_EXPORTED]: 'a exporté des données',
    [ActivityAction.DATA_IMPORTED]: 'a importé des données'
  };
  
  return labels[action] || action;
};

/**
 * Enregistre une action dans les logs
 */
export const logActivity = async (
  user: User | { id: string; firstName: string; lastName: string; role: string },
  action: ActivityAction,
  options?: {
    targetType?: ActivityLog['targetType'];
    targetId?: string;
    targetName?: string;
    details?: ActivityLog['details'];
    description?: string; // Override la description auto
  }
): Promise<void> => {
  try {
    const userName = `${user.firstName} ${user.lastName}`;
    const category = getCategory(action);
    
    // Construire la description
    let description = options?.description;
    if (!description) {
      description = `${userName} ${getActionLabel(action)}`;
      if (options?.targetName) {
        description += ` : ${options.targetName}`;
      }
    }
    
    const logEntry: Omit<ActivityLog, 'id'> = {
      userId: user.id,
      userName,
      userRole: String(user.role),
      action,
      category,
      description,
      targetType: options?.targetType,
      targetId: options?.targetId,
      targetName: options?.targetName,
      details: options?.details,
      createdAt: new Date().toISOString()
    };
    
    await addDoc(collection(db, LOGS_COLLECTION), cleanData(logEntry));
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement du log:', error);
    // Ne pas faire échouer l'action principale si le log échoue
  }
};

/**
 * Interface pour les filtres de recherche
 */
export interface ActivityLogFilters {
  userId?: string;
  category?: ActivityCategory;
  action?: ActivityAction;
  targetType?: string;
  targetId?: string;
  dateFrom?: string;
  dateTo?: string;
  searchTerm?: string;
}

/**
 * Récupère les logs avec filtres et pagination
 */
export const getActivityLogs = async (
  filters: ActivityLogFilters = {},
  pageSize: number = 50,
  lastDoc?: any
): Promise<{ logs: ActivityLog[]; lastDoc: any; hasMore: boolean }> => {
  try {
    const constraints: QueryConstraint[] = [];
    
    // Filtres
    if (filters.userId) {
      constraints.push(where('userId', '==', filters.userId));
    }
    if (filters.category) {
      constraints.push(where('category', '==', filters.category));
    }
    if (filters.action) {
      constraints.push(where('action', '==', filters.action));
    }
    if (filters.targetType) {
      constraints.push(where('targetType', '==', filters.targetType));
    }
    if (filters.targetId) {
      constraints.push(where('targetId', '==', filters.targetId));
    }
    
    // Tri par date décroissante
    constraints.push(orderBy('createdAt', 'desc'));
    
    // Pagination
    if (lastDoc) {
      constraints.push(startAfter(lastDoc));
    }
    constraints.push(limit(pageSize + 1)); // +1 pour savoir s'il y a plus
    
    const q = query(collection(db, LOGS_COLLECTION), ...constraints);
    const snapshot = await getDocs(q);
    
    const logs: ActivityLog[] = [];
    let newLastDoc = null;
    
    snapshot.docs.slice(0, pageSize).forEach((doc, index) => {
      logs.push({
        id: doc.id,
        ...doc.data()
      } as ActivityLog);
      
      if (index === snapshot.docs.length - 2 || index === pageSize - 1) {
        newLastDoc = doc;
      }
    });
    
    // Filtrer par date côté client si nécessaire
    let filteredLogs = logs;
    if (filters.dateFrom) {
      filteredLogs = filteredLogs.filter(log => log.createdAt >= filters.dateFrom!);
    }
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999);
      filteredLogs = filteredLogs.filter(log => log.createdAt <= toDate.toISOString());
    }
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filteredLogs = filteredLogs.filter(log => 
        log.description.toLowerCase().includes(term) ||
        log.userName.toLowerCase().includes(term) ||
        log.targetName?.toLowerCase().includes(term)
      );
    }
    
    return {
      logs: filteredLogs,
      lastDoc: newLastDoc,
      hasMore: snapshot.docs.length > pageSize
    };
  } catch (error) {
    console.error('Erreur lors de la récupération des logs:', error);
    return { logs: [], lastDoc: null, hasMore: false };
  }
};

/**
 * Souscrit aux logs en temps réel (derniers N logs)
 */
export const subscribeToActivityLogs = (
  callback: (logs: ActivityLog[]) => void,
  limitCount: number = 100
) => {
  const q = query(
    collection(db, LOGS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  
  return onSnapshot(q, (snapshot) => {
    const logs: ActivityLog[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as ActivityLog));
    
    callback(logs);
  });
};

/**
 * Exporte les logs en CSV
 */
export const exportLogsToCSV = (logs: ActivityLog[]): string => {
  const headers = [
    'Date/Heure',
    'Utilisateur',
    'Rôle',
    'Action',
    'Catégorie',
    'Description',
    'Cible',
    'Détails'
  ];
  
  const rows = logs.map(log => [
    new Date(log.createdAt).toLocaleString('fr-FR'),
    log.userName,
    log.userRole,
    log.action,
    log.category,
    log.description,
    log.targetName || '-',
    log.details?.changes?.join(', ') || '-'
  ]);
  
  const csvContent = [
    headers.join(';'),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
  ].join('\n');
  
  return '\ufeff' + csvContent; // BOM pour Excel
};
