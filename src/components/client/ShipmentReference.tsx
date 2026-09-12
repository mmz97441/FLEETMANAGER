import React, { useId, useState } from 'react';
import { Copy, Share2, ChevronDown, ChevronUp } from 'lucide-react';
import { copyShipmentReference, displayShipmentReference } from '../../utils/shipmentReference';

/** The shortened text is presentation only; all copy/share operations use the original identity. */
export default function ShipmentReference({ reference }: { reference: string }) {
  const fullId = useId();
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const shortened = reference.length > 24;
  const copy = async () => {
    try { await copyShipmentReference(reference); setFailed(false); setMessage('Référence complète copiée.'); }
    catch { setFailed(true); setExpanded(true); setMessage('Copie indisponible. Sélectionnez la référence complète ci-dessous.'); }
  };
  const share = async () => {
    try { await navigator.share({ title: 'Référence du colis', text: reference }); setFailed(false); setMessage('Partage ouvert.'); }
    catch (error) { if ((error as Error).name !== 'AbortError') { setFailed(true); setMessage('Partage indisponible. Utilisez Copier.'); } }
  };
  return <div className="min-w-0 space-y-2" data-shipment-reference>
    <p className="text-sm text-slate-600">{shortened && !expanded ? 'Référence abrégée' : 'Référence complète'}</p>
    <p className="break-all font-mono text-sm font-semibold text-slate-800">{shortened && !expanded ? `${reference.slice(0, 9)}…${reference.slice(-6)}` : displayShipmentReference(reference)}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void copy()} className="ui-button ui-button-secondary" aria-label={`Copier la référence ${reference}`}><Copy size={16} aria-hidden="true" /> Copier</button>
      {shortened && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={fullId} className="ui-button ui-button-ghost">{expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{expanded ? 'Réduire le code' : 'Voir en entier'}</button>}
      {typeof navigator.share === 'function' && <button type="button" onClick={() => void share()} className="ui-button ui-button-ghost"><Share2 size={16} aria-hidden="true" /> Partager</button>}
    </div>
    <div id={fullId} hidden={!expanded && !failed}>
      {(expanded || failed) && <label className="block text-sm text-slate-700">Code complet à sélectionner<input readOnly value={reference} onFocus={event => event.currentTarget.select()} className="mt-1 w-full min-h-11 border border-slate-300 rounded-lg px-2 text-base font-mono" /></label>}
    </div>
    {message && <p role={failed ? 'alert' : 'status'} className={`text-sm ${failed ? 'text-amber-900' : 'text-emerald-800'}`}>{message}</p>}
  </div>;
}
