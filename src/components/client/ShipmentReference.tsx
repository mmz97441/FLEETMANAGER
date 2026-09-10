import React, { useState } from 'react';
import { Copy, Share2 } from 'lucide-react';
import { copyShipmentReference, displayShipmentReference } from '../../utils/shipmentReference';

export default function ShipmentReference({ reference }: { reference: string }) {
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try { await copyShipmentReference(reference); setFailed(false); setMessage('Référence complète copiée.'); }
    catch { setFailed(true); setMessage('Copie indisponible. Sélectionnez la référence complète ci-dessous.'); }
  };
  const share = async () => {
    try { await navigator.share({ title: 'Référence du colis', text: reference }); setFailed(false); setMessage('Partage ouvert.'); }
    catch (error) { if ((error as Error).name !== 'AbortError') { setFailed(true); setMessage('Partage indisponible. Utilisez Copier.'); } }
  };
  return <div className="min-w-0 space-y-1">
    <span className="block break-words font-mono text-sm font-semibold text-slate-800" aria-label={`Référence ${reference}`}>{displayShipmentReference(reference)}</span>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void copy()} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700" aria-label={`Copier la référence ${reference}`}><Copy size={15} aria-hidden="true" /> Copier</button>
      {typeof navigator.share === 'function' && <button type="button" onClick={() => void share()} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700"><Share2 size={15} aria-hidden="true" /> Partager</button>}
    </div>
    {message && <p role={failed ? 'alert' : 'status'} className={`text-sm ${failed ? 'text-amber-900' : 'text-emerald-800'}`}>{message}</p>}
    {failed && <label className="block text-sm text-slate-700">Référence complète à sélectionner<input readOnly value={reference} onFocus={event => event.currentTarget.select()} className="mt-1 w-full min-h-11 border border-slate-300 rounded-lg px-2 text-sm font-mono" /></label>}
  </div>;
}
