import { useEffect, useState } from 'react';
import type { User } from '../types';
import { connectionStatus } from '../utils/presence';
import { formatDateTimeFr, timeAgo } from '../utils/timeAgo';

const labels = { online: 'En ligne', offline: 'Hors ligne', unknown: 'État de connexion inconnu', disabled: 'Compte désactivé' };
export default function UserConnectionStatus({ user }: { user: User }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const status = connectionStatus(user, now);
  return <div className="space-y-1 text-sm">
    <div className={status === 'online' ? 'font-semibold text-green-800' : 'text-slate-600'}>
      <span aria-hidden="true">{status === 'online' ? '●' : '○'} </span>{labels[status]}
    </div>
    <div className="text-slate-600">Dernière connexion : <span title={formatDateTimeFr(user.lastLoginAt)}>{timeAgo(user.lastLoginAt)}</span></div>
    {user.lastLoginAt && <div className="text-slate-500">{formatDateTimeFr(user.lastLoginAt)}</div>}
    {status === 'offline' && user.lastSeenAt && <div className="text-slate-500" title={formatDateTimeFr(user.lastSeenAt)}>Dernière activité : {timeAgo(user.lastSeenAt)}</div>}
    {user.appVersion && <div className="text-slate-500">Dernière version signalée : {user.appVersion}{user.appVersion !== __APP_VERSION__ ? ' — mise à jour à vérifier' : ''}</div>}
  </div>;
}
