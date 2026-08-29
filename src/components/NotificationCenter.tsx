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
import { Bell, Check, CheckCheck, X, ChevronRight, Filter } from 'lucide-react';
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
  onNavigate: (view: ViewState) => void;
}

type FilterType = 'all' | 'unread' | 'urgent';

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
  if (hours < 24) return `il y a ${hours}h`;
  
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return `il y a ${days}j`;
  
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
  const panelRef = useRef<HTMLDivElement>(null);

  // Subscription temps réel
  useEffect(() => {
    if (!currentUser?.id) return;
    const unsub = subscribeToNotifications(currentUser.id, setNotifications, 50);
    return unsub;
  }, [currentUser?.id]);

  // Fermer au clic extérieur
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

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
    if (!notif.read) {
      await markAsRead(notif.id);
    }
    if (notif.actionType === 'navigate' && notif.actionTarget) {
      onNavigate(notif.actionTarget as ViewState);
      setIsOpen(false);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllAsRead(currentUser.id);
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* === CLOCHE === */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-xl transition-all ${
          isOpen 
            ? 'bg-indigo-100 text-indigo-700' 
            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <Bell size={20} />
        
        {/* Badge */}
        {unreadCount > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-black text-white px-1 ${
            urgentCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-indigo-600'
          }`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* === PANNEAU === */}
      {isOpen && (
        <div className="absolute right-0 top-12 w-[calc(100vw-1.5rem)] sm:w-96 max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 flex flex-col overflow-hidden">
          
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
              {unreadCount > 0 && (
                <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {unreadCount} nouvelle{unreadCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  <CheckCheck size={14} className="inline mr-1" />
                  Tout lire
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Filtres */}
          <div className="px-4 py-2 border-b border-slate-50 flex gap-1 flex-shrink-0">
            {([
              { id: 'all' as FilterType, label: 'Toutes' },
              { id: 'unread' as FilterType, label: 'Non lues' },
              { id: 'urgent' as FilterType, label: 'Urgentes' },
            ]).map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  filter === f.id
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Liste */}
          <div className="flex-1 overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="text-center py-12">
                <Bell size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-400">
                  {filter === 'all' ? 'Aucune notification' : 'Rien à afficher'}
                </p>
              </div>
            ) : (
              <div>
                {filteredNotifications.map((notif) => {
                  const config = NOTIFICATION_CONFIG[notif.type] || NOTIFICATION_CONFIG[NotificationType.SYSTEM];
                  const isUrgent = notif.priority === NotificationPriority.URGENT || notif.priority === NotificationPriority.HIGH;
                  
                  return (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 ${
                        !notif.read ? 'bg-indigo-50/30' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        {/* Icône */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base ${config.bgColor}`}>
                          {config.icon}
                        </div>
                        
                        {/* Contenu */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-semibold truncate ${!notif.read ? 'text-slate-900' : 'text-slate-600'}`}>
                              {notif.title}
                            </p>
                            {!notif.read && (
                              <span className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0" />
                            )}
                            {isUrgent && !notif.read && (
                              <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded flex-shrink-0">
                                URGENT
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-0.5 line-clamp-2 ${!notif.read ? 'text-slate-600' : 'text-slate-400'}`}>
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-slate-400">{timeAgo(notif.createdAt)}</span>
                            {notif.actionLabel && (
                              <span className="text-[10px] text-indigo-500 font-medium flex items-center gap-0.5">
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
              <p className="text-[10px] text-slate-400">
                {notifications.length} notification{notifications.length > 1 ? 's' : ''} • {unreadCount} non lue{unreadCount > 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
