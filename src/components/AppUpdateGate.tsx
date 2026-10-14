import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, WifiOff } from 'lucide-react';
import { useDialogLayer } from '../hooks/useDialogLayer';
import { getLatestAppUpdateState, useAutoUpdate } from '../hooks/useAutoUpdate';
import { getUpdateSafetySnapshot, subscribeUpdateSafety } from '../services/updateSafety';
import { reloadApplication } from '../utils/reloadApplication';

type Props = { mandatory: boolean; update: ReturnType<typeof useAutoUpdate> };

/** No automatic reload, dismissal or destructive cache/storage reset. */
export default function AppUpdateGate({ mandatory, update }: Props) {
  const safety = useSyncExternalStore(subscribeUpdateSafety, getUpdateSafetySnapshot, getUpdateSafetySnapshot);
  const [entered, setEntered] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener('online', refresh); window.addEventListener('offline', refresh);
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);
  useLayoutEffect(() => {
    if (!update.available || !mandatory) { setEntered(false); return; }
    // Read live registrations: a sibling may have opened/restored a form in this commit.
    const latest = getUpdateSafetySnapshot();
    if (!latest.dirty && !latest.active && !latest.busy) setEntered(true);
  }, [mandatory, update.available, safety]);
  // A background upload can disable the button without reopening the app behind it.
  // A restored form, however, must remain accessible so the user can finish it.
  const open = mandatory && update.available && entered && !safety.dirty && !safety.active;
  const dialog = useDialogLayer(open, () => {}, 1000);
  const install = async () => {
    if (lock.current) return;
    lock.current = true; setInstalling(true); setMessage('');
    try {
      if (!navigator.onLine || !await update.checkNow()) {
        setMessage(getLatestAppUpdateState().error || 'Reconnectez-vous à Internet puis réessayez.');
        return;
      }
      // A valid rollback may have made the running build current again.
      if (!getLatestAppUpdateState().available) return;
      if (!await reloadApplication({ requireClean: mandatory })) {
        setMessage('Terminez l’opération en cours, puis installez la mise à jour.');
      }
    } finally { lock.current = false; setInstalling(false); }
  };
  if (!update.available) return null;
  if (!open) return <div role="status" className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 flex flex-wrap items-center gap-3" data-testid="update-deferred">
    <span className="flex-1">{mandatory
      ? 'Mise à jour obligatoire : terminez votre saisie ou votre scan en cours. L’installation sera proposée dès que cette opération sera terminée.'
      : 'Une mise à jour est disponible. Vos preuves déjà enregistrées resteront conservées sur cet appareil.'}</span>
    {!mandatory && <button type="button" disabled={installing || update.checking || !online} onClick={() => void install()} className="min-h-11 px-3 rounded-lg border border-blue-400 font-semibold disabled:opacity-50">Installer la mise à jour</button>}
    {!mandatory && message && <p role="alert" className="w-full">{message}</p>}
  </div>;
  return createPortal(<div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="app-update-title" aria-describedby="app-update-description" tabIndex={-1}
    className="fixed inset-0 flex items-center justify-center bg-slate-950/75 p-4 overflow-y-auto" data-testid="mandatory-app-update">
    <div className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-7 shadow-2xl my-auto">
      <Download className="text-brand-600 mb-4" size={32} aria-hidden="true" />
      <h2 id="app-update-title" className="text-xl font-bold text-slate-900">Mise à jour obligatoire</h2>
      <p id="app-update-description" className="mt-3 text-slate-700">Installez la version {update.latestVersion} pour continuer votre tournée avec les dernières corrections.</p>
      <p className="mt-3 text-sm text-slate-600">Vos preuves déjà enregistrées et les envois en attente restent conservés sur ce téléphone.</p>
      {!online && <p role="status" className="mt-4 flex gap-2 text-sm text-amber-900"><WifiOff size={20} className="shrink-0" />Reconnectez-vous à Internet pour installer la mise à jour.</p>}
      {safety.busy && <p role="status" className="mt-4 text-sm text-slate-700">Envoi en cours… L’installation sera possible dès la fin de cet envoi.</p>}
      {(message || update.error) && <p role="alert" className="mt-4 text-sm text-red-700">{message || update.error}</p>}
      <button type="button" data-autofocus disabled={!online || safety.busy || installing || update.checking} onClick={() => void install()}
        className="mt-6 w-full min-h-12 rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50 flex justify-center items-center gap-2">
        {(installing || update.checking) && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
        {installing ? 'Vérification de la mise à jour…' : 'Installer la mise à jour'}
      </button>
    </div>
  </div>, document.body);
}
