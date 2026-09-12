import Modal from './shared/Modal';
import CountBadge from './shared/CountBadge';
import { notificationDestination } from '../utils/notificationDestination';
/**
 * NOTIFICATION CENTER
 * 
 * Composant cloche dans le header :
 * - Badge compteur non-lues
 * - Panneau déroulant avec liste des notifications
 * - Marquer lue / tout marquer lu
 * - Navigation vers la vue cible au clic
 * - Filtres : Toutes / Non-lues / Par type
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bell, Check, CheckCheck, X, ChevronRight, Filter, Truck, CheckCircle2, XCircle, Route, RefreshCw, Clock, AlertTriangle, Download, Package, BarChart3, Users, CalendarDays, Info } from 'lucide-react';
import {
  AppNotification,
  NotificationType,
  NotificationPriority,
  NOTIFICATION_CONFIG,
  subscribeToNotifications,
  markAsRead,
  markAllAsRead
} from '../services/notificationService';
import { User, ViewState } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface NotificationCenterProps {
  currentUser: User;
  onNavigate: (view: ViewState, params?: Record<string, string>) => void;
}

type FilterType = 'all' | 'unread' | 'urgent';
const notificationIcons = {
  [NotificationType.PACKAGE_IN_DELIVERY]: Truck,
  [NotificationType.PACKAGE_DELIVERED]: CheckCircle2,
  [NotificationType.PACKAGE_FAILED]: XCircle,
  [NotificationType.MISSION_ASSIGNED]: Route,
  [NotificationType.MISSION_UPDATED]: RefreshCw,
  [NotificationType.TIME_WINDOW_ALERT]: Clock,
  [NotificationType.DELIVERY_FAILURE]: AlertTriangle,
  [NotificationType.PICKUP_MISMATCH]: AlertTriangle,
  [NotificationType.IMPORT_COMPLETED]: Download,
  [NotificationType.HUB_RECEPTION_COMPLETE]: Package,
  [NotificationType.DAILY_SUMMARY]: BarChart3,
  [NotificationType.RATE_ALERT]: AlertTriangle,
  [NotificationType.NEW_CLIENT]: Users,
  [NotificationType.LEAVE_REQUEST]: CalendarDays,
  [NotificationType.LEAVE_APPROVED]: CheckCircle2,
  [NotificationType.LEAVE_REJECTED]: XCircle,
  [NotificationType.SYSTEM]: Info,
};


// ============================================================================
// HELPERS
// ============================================================================

const timeAgo = (isoDate: string): string => {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days} j`;
  
  return new Date(isoDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const priorityOrder: Record<NotificationPriority, number> = {
  [NotificationPriority.URGENT]: 0,
  [NotificationPriority.HIGH]: 1,
  [NotificationPriority.NORMAL]: 2,
  [NotificationPriority.LOW]: 3,
};

// ============================================================================
// COMPOSANT
// ============================================================================

const NotificationCenter: React.FC<NotificationCenterProps> = ({ currentUser, onNavigate }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Subscription temps réel
  useEffect(() => {
    if (!currentUser?.id) return;
    const unsub = subscribeToNotifications(currentUser.id, rows => { setNotifications(rows); setLoading(false); setError(''); }, 50, () => { setLoading(false); setError('Notifications indisponibles. Vérifiez votre connexion.'); });
    return unsub;
  }, [currentUser?.id]);

  // Compteurs
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);
  const urgentCount = useMemo(() => notifications.filter(n => !n.read && (n.priority === NotificationPriority.URGENT || n.priority === NotificationPriority.HIGH)).length, [notifications]);

  // Filtre
  const filteredNotifications = useMemo(() => {
    let list = [...notifications];
    
    if (filter === 'unread') list = list.filter(n => !n.read);
    if (filter === 'urgent') list = list.filter(n => n.priority === NotificationPriority.URGENT || n.priority === NotificationPriority.HIGH);
    
    // Trier : non-lues d'abord, puis par priorité, puis par date
    return list.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [notifications, filter]);

  // Actions
  const handleNotificationClick = async (notif: AppNotification) => {
    setError('');
    const destination = notificationDestination(notif);
    if (destination) { onNavigate(destination.view, destination.params); setIsOpen(false); }
    if (!notif.read) {
      try { await markAsRead(notif.id); }
      catch { setError('La notification reste non lue. Vous pouvez consulter son contenu et réessayer après reconnexion.'); }
    }
  };
  const handleMarkAllRead = async () => {
    if (marking) return;
    setMarking(true); setError('');
    try { await markAllAsRead(currentUser.id); }
    catch { setError('Impossible de marquer les notifications comme lues. Réessayez après reconnexion.'); }
    finally { setMarking(false); }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* === CLOCHE === */}
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? ` : ${unreadCount} non lues` : ''}${urgentCount ? `, dont ${urgentCount} prioritaires` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={`relative min-h-11 min-w-11 flex items-center justify-center p-2 rounded-xl transition-colors ${
          isOpen 
            ? 'bg-brand-100 text-brand-700'
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <Bell size={20} />
        
        {/* Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-2 -right-2"><CountBadge count={unreadCount} compact /></span>
        )}
      </button>

      {/* === PANNEAU === */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Notifications" size="lg" bodyClassName="!p-0">
          
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">Votre activité</span>
              {unreadCount > 0 && (
                <span className="bg-brand-100 text-brand-700 text-sm font-bold px-2 py-0.5 rounded-full">
                  {unreadCount} nouvelle{unreadCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={marking}
                  onClick={handleMarkAllRead}
                  className="ui-button ui-button-ghost"
                >
                  <CheckCheck size={14} className="inline mr-1" />
                  Tout lire
                </button>
              )}

            </div>
          </div>

          {/* Filtres */}
          <div className="px-4 py-2 border-b border-slate-50 flex gap-1 flex-shrink-0">
            {([
              { id: 'all' as FilterType, label: 'Toutes' },
              { id: 'unread' as FilterType, label: 'Non lues' },
              { id: 'urgent' as FilterType, label: 'Prioritaires' },
            ]).map(f => (
              <button
                key={f.id}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className="ui-filter"
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Liste */}
          <div className="flex-1 overflow-y-auto">
            {error && <p role="alert" className="m-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
            {loading ? <p role="status" className="p-6 text-slate-600">Chargement des notifications…</p> : filteredNotifications.length === 0 ? (
              <div className="text-center py-12">
                <Bell size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-600">
                  {filter === 'all' ? 'Aucune notification' : 'Rien à afficher'}
                </p>
              </div>
            ) : (
              <div>
                {filteredNotifications.map((notif) => {
                  const config = NOTIFICATION_CONFIG[notif.type] || NOTIFICATION_CONFIG[NotificationType.SYSTEM];
                  const isUrgent = notif.priority === NotificationPriority.URGENT;
                  const isHigh = notif.priority === NotificationPriority.HIGH;
                  const Icon = notificationIcons[notif.type] || Info;
                  
                  return (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 ${
                        !notif.read ? 'bg-brand-50/30' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        {/* Icône */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base ${config.bgColor}`}>
                          <Icon size={20} aria-hidden="true" className={config.color} />
                        </div>
                        
                        {/* Contenu */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`text-sm font-semibold break-words ${!notif.read ? 'text-slate-900' : 'text-slate-600'}`}>
                              {notif.title}
                            </p>
                            {!notif.read && (
                              <span className="w-2 h-2 bg-brand-500 rounded-full flex-shrink-0" />
                            )}
                            {(isUrgent || isHigh) && !notif.read && (
                              <span className={`text-sm font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${isUrgent ? "text-red-800 bg-red-50" : "text-amber-900 bg-amber-50"}`}>
                                {isUrgent ? "Urgent" : "Prioritaire"}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm mt-0.5 break-words  ${!notif.read ? 'text-slate-600' : 'text-slate-600'}`}>
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-sm text-slate-600">{timeAgo(notif.createdAt)}</span>
                            {notif.actionLabel && (
                              <span className="text-sm text-brand-500 font-medium flex items-center gap-0.5">
                                {notif.actionLabel} <ChevronRight size={10} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 text-center flex-shrink-0">
              <p className="text-sm text-slate-600">
                {notifications.length} notification{notifications.length > 1 ? 's' : ''} • {unreadCount} non lue{unreadCount > 1 ? 's' : ''}
              </p>
            </div>
          )}
        </Modal>
    </div>
  );
};

export default NotificationCenter;
