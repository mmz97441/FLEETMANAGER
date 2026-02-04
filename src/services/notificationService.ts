/**
 * NOTIFICATION SERVICE
 * 
 * Notifications in-app temps réel via Firestore :
 * 
 * CLIENT :
 *   - Colis en cours de livraison
 *   - Colis livré (avec lien POD)
 *   - Échec de livraison (avec motif)
 * 
 * CHAUFFEUR :
 *   - Nouvelle mission assignée
 *   - Modification de tournée
 *   - Rappel créneau serré
 * 
 * ADMIN / EXPLOITANT :
 *   - Échecs de livraison
 *   - Écart enlèvement (prévu vs collecté)
 *   - Import traité
 * 
 * DIRECTEUR :
 *   - Résumé fin de journée
 *   - Alerte taux < seuil
 *   - Nouveau client
 */

import { db } from '../firebaseConfig';
import {
  collection, addDoc, updateDoc, doc, onSnapshot,
  query, where, orderBy, limit, getDocs, writeBatch,
  Timestamp, serverTimestamp
} from 'firebase/firestore';

// ============================================================================
// TYPES
// ============================================================================

export enum NotificationType {
  // Client
  PACKAGE_IN_DELIVERY = 'package_in_delivery',
  PACKAGE_DELIVERED = 'package_delivered',
  PACKAGE_FAILED = 'package_failed',
  
  // Chauffeur
  MISSION_ASSIGNED = 'mission_assigned',
  MISSION_UPDATED = 'mission_updated',
  TIME_WINDOW_ALERT = 'time_window_alert',
  
  // Admin
  DELIVERY_FAILURE = 'delivery_failure',
  PICKUP_MISMATCH = 'pickup_mismatch',
  IMPORT_COMPLETED = 'import_completed',
  HUB_RECEPTION_COMPLETE = 'hub_reception_complete',
  
  // Direction
  DAILY_SUMMARY = 'daily_summary',
  RATE_ALERT = 'rate_alert',
  NEW_CLIENT = 'new_client',
  
  // Congés / Absences
  LEAVE_REQUEST = 'leave_request',
  LEAVE_APPROVED = 'leave_approved',
  LEAVE_REJECTED = 'leave_rejected',
  
  // Système
  SYSTEM = 'system'
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent'
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  
  // Destinataire
  recipientId: string;        // userId ou 'role:admin' pour broadcast
  recipientRole?: string;     // Pour notifications par rôle
  
  // Contenu
  title: string;
  message: string;
  icon?: string;              // Emoji ou icon name
  
  // Contexte (pour navigation)
  actionType?: 'navigate' | 'link';
  actionTarget?: string;      // ViewState ou URL
  actionLabel?: string;
  
  // Métadonnées
  metadata?: Record<string, any>;  // packageId, missionId, etc.
  
  // État
  read: boolean;
  createdAt: string;
  readAt?: string;
}

// ============================================================================
// CONFIG ICONS/COULEURS
// ============================================================================

export const NOTIFICATION_CONFIG: Record<NotificationType, {
  icon: string;
  color: string;
  bgColor: string;
}> = {
  [NotificationType.PACKAGE_IN_DELIVERY]: { icon: '🚚', color: 'text-blue-700', bgColor: 'bg-blue-50' },
  [NotificationType.PACKAGE_DELIVERED]: { icon: '✅', color: 'text-green-700', bgColor: 'bg-green-50' },
  [NotificationType.PACKAGE_FAILED]: { icon: '❌', color: 'text-red-700', bgColor: 'bg-red-50' },
  
  [NotificationType.MISSION_ASSIGNED]: { icon: '📋', color: 'text-indigo-700', bgColor: 'bg-indigo-50' },
  [NotificationType.MISSION_UPDATED]: { icon: '🔄', color: 'text-amber-700', bgColor: 'bg-amber-50' },
  [NotificationType.TIME_WINDOW_ALERT]: { icon: '⏰', color: 'text-orange-700', bgColor: 'bg-orange-50' },
  
  [NotificationType.DELIVERY_FAILURE]: { icon: '🚨', color: 'text-red-700', bgColor: 'bg-red-50' },
  [NotificationType.PICKUP_MISMATCH]: { icon: '⚠️', color: 'text-amber-700', bgColor: 'bg-amber-50' },
  [NotificationType.IMPORT_COMPLETED]: { icon: '📥', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  [NotificationType.HUB_RECEPTION_COMPLETE]: { icon: '📦', color: 'text-blue-700', bgColor: 'bg-blue-50' },
  
  [NotificationType.DAILY_SUMMARY]: { icon: '📊', color: 'text-purple-700', bgColor: 'bg-purple-50' },
  [NotificationType.RATE_ALERT]: { icon: '📉', color: 'text-red-700', bgColor: 'bg-red-50' },
  [NotificationType.NEW_CLIENT]: { icon: '🤝', color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  
  [NotificationType.SYSTEM]: { icon: 'ℹ️', color: 'text-slate-700', bgColor: 'bg-slate-50' },
};

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

const NOTIFICATIONS_COLLECTION = 'notifications';

/**
 * Créer une notification
 */
export const createNotification = async (
  notification: Omit<AppNotification, 'id' | 'read' | 'createdAt'>
): Promise<string> => {
  const docRef = await addDoc(collection(db, NOTIFICATIONS_COLLECTION), {
    ...notification,
    read: false,
    createdAt: new Date().toISOString(),
    _createdAt: serverTimestamp()
  });
  return docRef.id;
};

/**
 * Créer des notifications en batch (ex: notifier tous les admins)
 */
export const createBatchNotifications = async (
  recipientIds: string[],
  baseNotification: Omit<AppNotification, 'id' | 'read' | 'createdAt' | 'recipientId'>
): Promise<void> => {
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  
  for (const recipientId of recipientIds) {
    const ref = doc(collection(db, NOTIFICATIONS_COLLECTION));
    batch.set(ref, {
      ...baseNotification,
      recipientId,
      read: false,
      createdAt: now,
      _createdAt: serverTimestamp()
    });
  }
  
  await batch.commit();
};

/**
 * S'abonner aux notifications d'un utilisateur
 */
export const subscribeToNotifications = (
  userId: string,
  callback: (notifications: AppNotification[]) => void,
  maxResults: number = 50
) => {
  const q = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where('recipientId', '==', userId),
    orderBy('_createdAt', 'desc'),
    limit(maxResults)
  );

  return onSnapshot(q, (snapshot) => {
    const notifs = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as AppNotification[];
    callback(notifs);
  });
};

/**
 * Marquer une notification comme lue
 */
export const markAsRead = async (notificationId: string): Promise<void> => {
  await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId), {
    read: true,
    readAt: new Date().toISOString()
  });
};

/**
 * Marquer toutes les notifications comme lues
 */
export const markAllAsRead = async (userId: string): Promise<void> => {
  const q = query(
    collection(db, NOTIFICATIONS_COLLECTION),
    where('recipientId', '==', userId),
    where('read', '==', false)
  );
  
  const snapshot = await getDocs(q);
  if (snapshot.empty) return;
  
  const batch = writeBatch(db);
  const now = new Date().toISOString();
  
  snapshot.docs.forEach(d => {
    batch.update(d.ref, { read: true, readAt: now });
  });
  
  await batch.commit();
};

// ============================================================================
// NOTIFICATION BUILDERS — Raccourcis pour créer les notifications courantes
// ============================================================================

/**
 * Client : colis en livraison
 */
export const notifyPackageInDelivery = (
  clientUserId: string,
  packageBarcode: string,
  recipientName: string,
  driverName: string
) => createNotification({
  type: NotificationType.PACKAGE_IN_DELIVERY,
  priority: NotificationPriority.NORMAL,
  recipientId: clientUserId,
  title: 'Colis en cours de livraison',
  message: `Le colis ${packageBarcode} pour ${recipientName} est en livraison avec ${driverName}.`,
  actionType: 'navigate',
  actionTarget: 'client_shipments',
  actionLabel: 'Voir mes expéditions',
  metadata: { packageBarcode, recipientName }
});

/**
 * Client : colis livré
 */
export const notifyPackageDelivered = (
  clientUserId: string,
  packageBarcode: string,
  recipientName: string
) => createNotification({
  type: NotificationType.PACKAGE_DELIVERED,
  priority: NotificationPriority.NORMAL,
  recipientId: clientUserId,
  title: 'Colis livré ✅',
  message: `Le colis ${packageBarcode} a été livré à ${recipientName}.`,
  actionType: 'navigate',
  actionTarget: 'client_shipments',
  actionLabel: 'Voir le détail',
  metadata: { packageBarcode, recipientName }
});

/**
 * Client : échec livraison
 */
export const notifyPackageFailed = (
  clientUserId: string,
  packageBarcode: string,
  recipientName: string,
  reason: string
) => createNotification({
  type: NotificationType.PACKAGE_FAILED,
  priority: NotificationPriority.HIGH,
  recipientId: clientUserId,
  title: 'Échec de livraison',
  message: `Livraison du colis ${packageBarcode} (${recipientName}) échouée : ${reason}.`,
  actionType: 'navigate',
  actionTarget: 'client_shipments',
  actionLabel: 'Voir le détail',
  metadata: { packageBarcode, recipientName, reason }
});

/**
 * Chauffeur : mission assignée
 */
export const notifyMissionAssigned = (
  driverId: string,
  zone: string,
  stopCount: number,
  vehiclePlate: string
) => createNotification({
  type: NotificationType.MISSION_ASSIGNED,
  priority: NotificationPriority.HIGH,
  recipientId: driverId,
  title: 'Nouvelle tournée assignée',
  message: `Mission ${zone} : ${stopCount} arrêts • Véhicule ${vehiclePlate}`,
  actionType: 'navigate',
  actionTarget: 'driver_tour',
  actionLabel: 'Voir ma tournée',
  metadata: { zone, stopCount, vehiclePlate }
});

/**
 * Admin : échec livraison
 */
export const notifyAdminDeliveryFailure = (
  adminIds: string[],
  driverName: string,
  packageBarcode: string,
  recipientName: string,
  reason: string
) => createBatchNotifications(adminIds, {
  type: NotificationType.DELIVERY_FAILURE,
  priority: NotificationPriority.HIGH,
  title: 'Échec de livraison',
  message: `${driverName} : colis ${packageBarcode} (${recipientName}) — ${reason}`,
  actionType: 'navigate',
  actionTarget: 'missions',
  actionLabel: 'Voir les missions',
  metadata: { driverName, packageBarcode, reason }
});

/**
 * Admin : écart enlèvement
 */
export const notifyPickupMismatch = (
  adminIds: string[],
  clientName: string,
  expected: number,
  collected: number
) => createBatchNotifications(adminIds, {
  type: NotificationType.PICKUP_MISMATCH,
  priority: NotificationPriority.HIGH,
  title: 'Écart enlèvement',
  message: `${clientName} : ${collected}/${expected} colis collectés (${expected - collected} manquants)`,
  actionType: 'navigate',
  actionTarget: 'hub_operations',
  actionLabel: 'Voir le hub',
  metadata: { clientName, expected, collected, missing: expected - collected }
});

/**
 * Admin : import terminé
 */
export const notifyImportCompleted = (
  adminIds: string[],
  clientName: string,
  packageCount: number,
  batchId: string
) => createBatchNotifications(adminIds, {
  type: NotificationType.IMPORT_COMPLETED,
  priority: NotificationPriority.NORMAL,
  title: 'Import traité',
  message: `${packageCount} colis importés pour ${clientName}`,
  actionType: 'navigate',
  actionTarget: 'missions',
  actionLabel: 'Voir les colis',
  metadata: { clientName, packageCount, batchId }
});

/**
 * Direction : résumé journalier
 */
export const notifyDailySummary = (
  directorIds: string[],
  stats: { delivered: number; failed: number; total: number; rate: number; drivers: number }
) => createBatchNotifications(directorIds, {
  type: NotificationType.DAILY_SUMMARY,
  priority: NotificationPriority.NORMAL,
  title: `Bilan du jour — ${stats.rate}%`,
  message: `${stats.delivered} livrés, ${stats.failed} échecs sur ${stats.total} colis • ${stats.drivers} chauffeurs`,
  actionType: 'navigate',
  actionTarget: 'missions',
  actionLabel: 'Voir le tableau de bord',
  metadata: stats
});

/**
 * Direction : alerte taux
 */
export const notifyRateAlert = (
  directorIds: string[],
  currentRate: number,
  threshold: number,
  zone?: string
) => createBatchNotifications(directorIds, {
  type: NotificationType.RATE_ALERT,
  priority: NotificationPriority.URGENT,
  title: `⚠️ Taux de livraison ${currentRate}%`,
  message: zone 
    ? `La zone ${zone} est passée sous ${threshold}% (${currentRate}% actuellement)`
    : `Le taux global est passé sous ${threshold}% (${currentRate}% actuellement)`,
  actionType: 'navigate',
  actionTarget: 'missions',
  actionLabel: 'Voir les KPIs',
  metadata: { currentRate, threshold, zone }
});

// ============================================================================
// NOTIFICATIONS CONGÉS / ABSENCES
// ============================================================================

/**
 * Nouvelle demande de congés → Admin/Direction
 */
export const notifyLeaveRequest = (
  adminIds: string[],
  employeeName: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  duration: number
) => createBatchNotifications(adminIds, {
  type: NotificationType.LEAVE_REQUEST,
  priority: NotificationPriority.NORMAL,
  title: `📅 Nouvelle demande de congés`,
  message: `${employeeName} demande ${duration} jour${duration > 1 ? 's' : ''} de ${leaveType} du ${startDate} au ${endDate}`,
  actionType: 'navigate',
  actionTarget: 'absences',
  actionLabel: 'Voir les demandes',
  metadata: { employeeName, leaveType, startDate, endDate, duration }
});

/**
 * Congés approuvés → Chauffeur
 */
export const notifyLeaveApproved = (
  userId: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  approverName: string
) => createNotification({
  recipientId: userId,
  type: NotificationType.LEAVE_APPROVED,
  priority: NotificationPriority.NORMAL,
  title: `✅ Congés approuvés`,
  message: `Votre demande de ${leaveType} du ${startDate} au ${endDate} a été validée par ${approverName}`,
  actionType: 'navigate',
  actionTarget: 'absences',
  actionLabel: 'Voir mes congés',
  metadata: { leaveType, startDate, endDate, approverName }
});

/**
 * Congés refusés → Chauffeur
 */
export const notifyLeaveRejected = (
  userId: string,
  leaveType: string,
  startDate: string,
  endDate: string,
  rejecterName: string,
  reason?: string
) => createNotification({
  recipientId: userId,
  type: NotificationType.LEAVE_REJECTED,
  priority: NotificationPriority.HIGH,
  title: `❌ Congés refusés`,
  message: reason 
    ? `Votre demande de ${leaveType} du ${startDate} au ${endDate} a été refusée par ${rejecterName}. Motif : ${reason}`
    : `Votre demande de ${leaveType} du ${startDate} au ${endDate} a été refusée par ${rejecterName}`,
  actionType: 'navigate',
  actionTarget: 'absences',
  actionLabel: 'Voir mes congés',
  metadata: { leaveType, startDate, endDate, rejecterName, reason }
});
