import { useEffect, useState } from 'react';
import { fieldOperations, fieldOperationEvent, submitFieldOperation, FieldOperation } from '../services/fieldOperationsOutbox';

type Summary = Pick<FieldOperation, 'id' | 'kind' | 'createdAt'> & { label: string };
export default function FieldOperationsSyncBanner({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Summary[]>([]), [errors, setErrors] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true, running = false;
    const refresh = async () => {
      try { const pending = await fieldOperations(userId); if (active) { setRows(pending.map(row => ({ id: row.id, kind: row.kind, createdAt: row.createdAt,
        label: row.kind === 'pickup' ? row.payload.clientName : row.payload.proof.reasonLabel }))); setStorageError(''); } }
      catch { if (active) setStorageError('Impossible de vérifier les enlèvements et retours conservés sur ce téléphone. Gardez l’application ouverte.'); }
    };
    const sync = async () => {
      if (running || !navigator.onLine) return;
      running = true; if (active) setBusy(true);
      try {
        for (const row of await fieldOperations(userId)) {
          if (!active) break;
          try { await submitFieldOperation(row); if (active) setErrors(old => { const next = { ...old }; delete next[row.id]; return next; }); }
          catch (error) { if (active) setErrors(old => ({ ...old, [row.id]: error instanceof Error ? error.message : 'Envoi à réessayer.' })); }
        }
      } catch { if (active) setStorageError('Impossible de lire les opérations locales. Gardez cette application ouverte.'); }
      finally { running = false; if (active) { setBusy(false); await refresh(); } }
    };
    setRows([]); setErrors({}); void refresh(); void sync();
    const timer = window.setInterval(sync, 30000);
    window.addEventListener('online', sync); window.addEventListener('fleet-sync-now', sync); window.addEventListener(fieldOperationEvent, refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', sync); window.removeEventListener('fleet-sync-now', sync); window.removeEventListener(fieldOperationEvent, refresh); };
  }, [userId]);
  if (!rows.length && !storageError) return null;
  return <section className="ui-notice ui-notice-warning" aria-label="Enlèvements et retours à synchroniser">
    {storageError && <p role="alert">{storageError}</p>}
    {rows.map(row => <div key={row.id} className="py-2">
      <p className="font-semibold">{row.kind === 'pickup' ? 'Enlèvement' : 'Retour au dépôt'} conservé sur ce téléphone</p>
      <p className="text-sm">{new Date(row.createdAt).toLocaleString('fr-FR')} · {row.label}</p>
      {errors[row.id] && <p role="alert" className="text-sm">{errors[row.id]}</p>}
    </div>)}
    <button disabled={busy} type="button" className="ui-button ui-button-secondary" onClick={() => window.dispatchEvent(new Event('fleet-sync-now'))}>{busy ? 'Synchronisation…' : 'Réessayer les envois'}</button>
  </section>;
}
