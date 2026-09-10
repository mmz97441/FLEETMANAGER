import { useEffect, useState } from 'react';
import {
  pendingDeliveries,
  syncDeliveries,
  outboxChangeEvent,
} from '../services/deliveryOutbox';
export default function PendingSyncBanner({ userId }: { userId: string }) {
  const [count, setCount] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true,
      working = false;
    const refresh = async () => {
      try {
        const rows = await pendingDeliveries(userId);
        if (active) setCount(rows.length);
      } catch (e) {
        if (active)
          setError('Stockage local indisponible : conservez cet écran ouvert.');
      }
    };
    const sync = async () => {
      if (working || !navigator.onLine) return;
      working = true;
      if (active) setBusy(true);
      try {
        const errors = await syncDeliveries(userId);
        if (active) setError(errors[0] || '');
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Synchronisation indisponible',
          );
      } finally {
        working = false;
        if (active) setBusy(false);
        await refresh();
      }
    };
    refresh();
    sync();
    const timer = window.setInterval(sync, 30000);
    window.addEventListener('online', sync);
    window.addEventListener(outboxChangeEvent, refresh);
    window.addEventListener('fleet-sync-now', sync);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', sync);
      window.removeEventListener(outboxChangeEvent, refresh);
      window.removeEventListener('fleet-sync-now', sync);
    };
  }, [userId]);
  if (!count && !error) return null;
  return (
    <div
      role="status"
      className="fixed bottom-16 left-3 right-3 z-[1100] rounded-lg bg-amber-100 text-amber-950 p-3 shadow-lg text-sm"
    >
      {count > 0
        ? `${count} livraison(s) ou preuve(s) conservée(s) sur cet appareil, en attente d’envoi.`
        : error}
      {count > 0 && error && <div>{error}</div>}
      <button
        disabled={busy}
        className="ml-3 underline font-bold"
        onClick={() => window.dispatchEvent(new Event('fleet-sync-now'))}
      >
        {busy ? 'Envoi…' : 'Réessayer'}
      </button>
    </div>
  );
}
