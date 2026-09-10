import { useEffect, useState } from 'react';
import { UploadCloud, CheckCircle, Loader2 } from 'lucide-react';
import { pendingDeliveries, submitDelivery, outboxChangeEvent, PendingDelivery } from '../services/deliveryOutbox';
import { getMissionById } from '../services/missionService';
import { Mission } from '../types';
import Modal from './shared/Modal';

type DeliverySummary = Pick<PendingDelivery, 'id' | 'createdAt' | 'committed' | 'kind'> & {
  action: { missionId: string; stopId: string };
  packageCount: number;
};
const summarize = (row: PendingDelivery): DeliverySummary => ({
  id: row.id, createdAt: row.createdAt, committed: row.committed, kind: row.kind,
  action: { missionId: row.action.missionId, stopId: row.action.stopId },
  packageCount: row.action.packageOutcomes?.length ?? row.proof.packageIds.length,
});

/** Presentation only: retries use the outbox's existing idempotent run/lock.
 * Never retain photo/signature payloads in UI history on field phones. */
export default function PendingSyncBanner({ userId }: { userId: string }) {
  const [rows, setRows] = useState<DeliverySummary[]>([]);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [open, setOpen] = useState(false);
  const [missionFilter, setMissionFilter] = useState<string | undefined>();
  const [missions, setMissions] = useState<Record<string, Mission>>({});
  const [received, setReceived] = useState<DeliverySummary[]>([]);
  const visibleRows = missionFilter ? rows.filter(row => row.action.missionId === missionFilter) : rows;

  useEffect(() => {
    let active = true, working = false;
    const refresh = async () => {
      try {
        const pending = await pendingDeliveries(userId);
        if (active) { setRows(pending.map(summarize)); setError(''); }
      } catch {
        if (active) setError('Stockage local indisponible : conservez cet écran ouvert et contactez le bureau.');
      }
    };
    const sync = async () => {
      if (working || !navigator.onLine) return;
      working = true;
      if (active) setBusy(true);
      try {
        const pending = await pendingDeliveries(userId);
        for (const entry of pending) {
          if (!active) break;
          setSendingId(entry.id);
          try {
            await submitDelivery(entry);
            if (active) {
              setErrors(previous => { const next = { ...previous }; delete next[entry.id]; return next; });
              setReceived(previous => [summarize(entry), ...previous.filter(row => row.id !== entry.id)].slice(0, 10));
            }
          } catch (cause) {
            if (active) setErrors(previous => ({ ...previous, [entry.id]: cause instanceof Error ? cause.message : 'Envoi interrompu. Réessayez.' }));
          }
        }
      } catch {
        if (active) setError('Impossible de lire les envois conservés sur ce téléphone. Gardez cette application ouverte.');
      } finally {
        working = false;
        if (active) { setBusy(false); setSendingId(null); await refresh(); }
      }
    };
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) void sync(); };
    const show = (event: Event) => {
      setMissionFilter((event as CustomEvent<{ missionId?: string }>).detail?.missionId);
      setOpen(true);
      void refresh();
    };
    setRows([]); setReceived([]); setErrors({}); setMissions({}); setMissionFilter(undefined); setOpen(false);
    void refresh(); void sync();
    const timer = window.setInterval(sync, 30000);
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener(outboxChangeEvent, refresh);
    window.addEventListener('fleet-sync-now', sync);
    window.addEventListener('fleet-show-pending-sync', show);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener(outboxChangeEvent, refresh);
      window.removeEventListener('fleet-sync-now', sync);
      window.removeEventListener('fleet-show-pending-sync', show);
    };
  }, [userId]);

  const missionIds = [...new Set([...rows, ...received].map(row => row.action.missionId))].join('|');
  useEffect(() => {
    if (!open) return;
    let active = true;
    for (const id of missionIds.split('|').filter(Boolean)) {
      getMissionById(id).then(mission => {
        if (active && mission && mission.driverId === userId) setMissions(previous => ({ ...previous, [id]: mission }));
      }).catch(() => {}); // Local references remain usable without network.
    }
    return () => { active = false; };
  }, [open, missionIds, userId]);

  const describe = (row: DeliverySummary) => {
    const mission = missions[row.action.missionId];
    const stop = mission?.stops.find(item => item.id === row.action.stopId);
    return { tour: mission ? `Tournée ${mission.zone || ''} · ${mission.date}` : `Tournée ${row.action.missionId}`, stop: stop ? `Arrêt ${stop.sequence} · ${stop.contactName || stop.address}` : `Arrêt ${row.action.stopId}` };
  };
  const retry = () => window.dispatchEvent(new Event('fleet-sync-now'));
  if (!rows.length && !error && !open && !received.length) return null;

  return <>
    <section aria-label="Synchronisation des livraisons" className={`rounded-xl border p-3 text-sm ${rows.length || error ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-green-200 bg-green-50 text-green-900'}`}>
      <div role="status" className="flex items-start gap-2">
        {busy ? <Loader2 size={20} className="shrink-0 animate-spin" /> : rows.length ? <UploadCloud size={20} className="shrink-0" /> : <CheckCircle size={20} className="shrink-0" />}
        <p className="flex-1">{rows.length ? `${rows.length} livraison${rows.length > 1 ? 's' : ''} conservée${rows.length > 1 ? 's' : ''} sur ce téléphone. ${online ? 'Envoi des preuves en attente.' : 'L’envoi reprendra au retour du réseau.'}` : error || 'Les derniers envois ont été reçus par le serveur.'}</p>
      </div>
      {rows.length > 0 && error && <p role="alert" className="mt-2">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 px-3 rounded-lg border border-current font-bold" onClick={() => { setMissionFilter(undefined); setOpen(true); }}>Voir les envois{rows.length ? ` (${rows.length})` : ''}</button>
        {(rows.length > 0 || error) && <button type="button" disabled={busy || !online} className="min-h-11 px-3 rounded-lg font-bold underline disabled:opacity-60" onClick={retry}>{busy ? 'Envoi en cours…' : online ? 'Réessayer les envois' : 'En attente du réseau'}</button>}
        {!rows.length && !error && <button type="button" className="min-h-11 px-3 underline" onClick={() => setReceived([])}>Masquer la confirmation</button>}
      </div>
    </section>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Envois des livraisons" size="lg">
      <p className="text-sm text-slate-600 mb-4">Vos preuves restent sur ce téléphone jusqu’à leur réception. Gardez cette application et ce compte pour terminer l’envoi ; il n’est pas nécessaire de refaire la livraison.</p>
      {missionFilter && <button type="button" onClick={() => setMissionFilter(undefined)} className="min-h-11 mb-3 text-sm font-bold underline text-brand-700">Voir toutes les tournées</button>}
      {error && <p role="alert" className="p-3 mb-3 rounded-lg bg-red-50 text-red-800">{error}</p>}
      <ul className="space-y-3">
        {visibleRows.map(row => { const labels = describe(row); return <li key={row.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1 break-words">
          <p className="font-bold text-base text-slate-900">{labels.stop}</p>
          <p className="text-sm text-slate-700">{labels.tour}</p>
          <p className="text-sm text-slate-700">Sauvegardé le {new Date(row.createdAt).toLocaleString('fr-FR')} · {row.packageCount} colis</p>
          <p role="status" className="text-sm font-semibold text-amber-950">{sendingId === row.id ? 'Envoi en cours…' : row.committed ? 'Résultat enregistré · preuves conservées sur ce téléphone' : 'Livraison et preuves conservées sur ce téléphone'}</p>
          {errors[row.id] && <p className="text-sm text-red-800">Dernière tentative : {errors[row.id]}</p>}
        </li>; })}
      </ul>
      {!visibleRows.length && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-900">Aucun envoi local en attente{missionFilter ? ' pour cette tournée' : ''}. Si un arrêt reste signalé en attente, synchronisez le téléphone qui a enregistré sa preuve.</p>}
      {rows.length > 0 && <button type="button" disabled={busy || !online} onClick={retry} className="mt-4 min-h-12 w-full rounded-xl bg-brand-700 px-4 py-3 text-white font-bold disabled:opacity-60">{busy ? 'Envoi en cours…' : online ? 'Réessayer tous les envois' : 'Reconnectez ce téléphone pour envoyer'}</button>}
      {received.filter(row => !missionFilter || row.action.missionId === missionFilter).length > 0 && <div className="mt-5"><h4 className="font-bold mb-2">Reçus pendant cette session</h4><ul className="space-y-2">{received.filter(row => !missionFilter || row.action.missionId === missionFilter).map(row => <li key={row.id} className="p-3 rounded-lg bg-green-50 text-sm text-green-900"><CheckCircle size={16} className="inline mr-2" />{describe(row).stop} · Reçu par le serveur</li>)}</ul></div>}
    </Modal>
  </>;
}
