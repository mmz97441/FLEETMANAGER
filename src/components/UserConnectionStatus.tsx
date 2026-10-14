import { useEffect, useState } from 'react';
import type { User } from '../types';
import { connectionStatus } from '../utils/presence';
import { formatDateTimeFr, timeAgo } from '../utils/timeAgo';
import { useAutoUpdate } from '../hooks/useAutoUpdate';
import { userAppVersionStatus, type AppSignalAge, type AppVersionState } from '../utils/appVersionStatus';

const labels = { online: 'En ligne', offline: 'Hors ligne', unknown: 'État de connexion inconnu', disabled: 'Compte désactivé' };
const versionLabels = { required: 'Mise à jour requise', current: 'Appareils récemment signalés à jour', stale: 'Signal ancien à vérifier', unknown: 'Version à vérifier' };
const deviceLabel = (state: AppVersionState, age: AppSignalAge) => age === 'old'
  ? state === 'required' ? 'Ancienne version signalée' : 'Ancien signal à vérifier'
  : age === 'unknown' ? 'Date du signal inconnue'
  : state === 'current' ? 'Déploiement actuel signalé' : state === 'required' ? 'Mise à jour requise' : 'Version ou édition inconnue';

export default function UserConnectionStatus({ user }: { user: User }) {
  const [now, setNow] = useState(Date.now);
  const update = useAutoUpdate();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const status = connectionStatus(user, now);
  const versions = userAppVersionStatus(user, update, now);
  const badgeColor = versions.state === 'current' ? 'bg-green-50 text-green-800'
    : versions.state === 'required' || versions.state === 'stale' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700';
  return <div className="space-y-1 text-sm">
    <div className={status === 'online' ? 'font-semibold text-green-800' : 'text-slate-600'}>
      <span aria-hidden="true">{status === 'online' ? '●' : '○'} </span>{labels[status]}
    </div>
    <div className="text-slate-600">Dernière connexion : <span title={formatDateTimeFr(user.lastLoginAt)}>{timeAgo(user.lastLoginAt)}</span></div>
    {user.lastLoginAt && <div className="text-slate-500">{formatDateTimeFr(user.lastLoginAt)}</div>}
    {status === 'offline' && user.lastSeenAt && <div className="text-slate-500" title={formatDateTimeFr(user.lastSeenAt)}>Dernière activité : {timeAgo(user.lastSeenAt)}</div>}
    <div><span className={`inline-block rounded px-2 py-1 text-sm font-semibold ${badgeColor}`}>{versionLabels[versions.state]}</span></div>
    <div className="text-sm text-slate-500">{update.latestVersion ? `Version publiée : ${update.latestVersion}`
      : update.checking ? 'Vérification de la version publiée…' : 'Version publiée indisponible'}</div>
    {update.error && <p className="text-sm text-amber-800">{update.lastCheckedAt
      ? `Comparaison avec le déploiement vérifié le ${formatDateTimeFr(new Date(update.lastCheckedAt).toISOString())}. Nouvelle vérification en attente de connexion.`
      : 'Connectez cet appareil pour vérifier le déploiement publié.'}</p>}
    {versions.devices.length > 0 && <details className="text-slate-600">
      <summary className="cursor-pointer min-h-8">Appareils identifiés ({versions.devices.length})</summary>
      <p className="text-sm text-slate-500">Un signal est récent pendant 24 h. Un ancien signal ne confirme pas la version actuellement ouverte.</p>
      {versions.devices.map(device => <div key={device.id} className="mt-2 border-l-2 border-slate-200 pl-2">
        <div>{device.label || 'Appareil'} · {device.appVersion || 'Version inconnue'}</div>
        <div className={device.state === 'required' || device.age !== 'recent' ? 'text-sm text-amber-800' : 'text-sm text-slate-600'}>{deviceLabel(device.state, device.age)}</div>
        <div className="text-sm text-slate-500" title={formatDateTimeFr(device.lastSeenAt)}>Dernier signal : {timeAgo(device.lastSeenAt)}{device.age === 'recent' ? ' · moins de 24 h' : ''}</div>
      </div>)}
    </details>}
    {versions.legacy && <div className="text-sm text-slate-500">
      <div>Dernier signal du compte : {versions.legacy.appVersion || 'Version inconnue'} — appareil non identifié.</div>
      <div>Cette version ne décrit pas tous ses appareils.</div>
    </div>}
  </div>;
}
