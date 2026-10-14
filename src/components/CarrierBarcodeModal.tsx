import { carrierBarcodeError, individualReferenceError, type CarrierBarcodeFormat } from '../utils/carrierBarcodeValidation';
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { findPackageByCode } from '../services/missionService';
import { withDeadline } from '../utils/asyncDeadline';
import type { Package } from '../types';
import Modal from './shared/Modal';
import Scanner from './Scanner';

export default function CarrierBarcodeModal({ onClose, initialBr = '' }: { onClose: () => void; initialBr?: string }) {
  const [br, setBr] = useState(initialBr), [code, setCode] = useState('');
  const [format, setFormat] = useState<CarrierBarcodeFormat>('generic');
  const [parcel, setParcel] = useState<Package | null>(null);
  const [verified, setVerified] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [saved, setSaved] = useState(false);
  const [scanner, setScanner] = useState<'br' | 'boiron' | null>(null);
  const search = async () => {
    setBusy(true); setMessage(''); setParcel(null); setVerified(false);
    try {
      const referenceError = individualReferenceError(br);
      if (referenceError) throw new Error(referenceError);
      const result = await withDeadline(findPackageByCode(br.trim().toUpperCase()), 15000, new Error('Recherche trop longue. Réessayez.'));
      if (!result) throw new Error('Colis introuvable. Vérifiez le numéro et son import.');
      setParcel(result);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Recherche impossible. Réessayez.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!parcel || !verified || busy) return;
    setBusy(true); setMessage('');
    try {
      await withDeadline(httpsCallable(getFunctions(app, 'europe-west1'), 'associateCarrierBarcode')({ packageId: parcel.id, code, verified, carrierBarcodeFormat: format }), 20000,
        new Error('Confirmation trop longue. Réessayez la même association : elle ne sera pas créée deux fois.'));
      setSaved(true); setMessage(`Code transporteur associé au colis ${parcel.externalId || br}. Le chauffeur peut maintenant le scanner.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Association impossible. Réessayez.'); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} title="Associer une étiquette transporteur" busy={busy} dirty={!!code && !saved} size="lg">
    <div className="space-y-4">
      <p>Sur le même carton, relevez sa référence individuelle et le code transporteur. Cette correspondance permettra au chauffeur de scanner cette étiquette.</p>
      <label className="block font-semibold">Référence individuelle du carton<input className="block w-full min-h-11 border rounded-lg p-2 mt-1" value={br} disabled={busy || saved} onChange={e => { setBr(e.target.value); setParcel(null); setVerified(false); }} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || saved} onClick={() => setScanner('br')} className="min-h-11 border rounded-lg px-3">Scanner la référence</button><button type="button" disabled={busy || saved || !br.trim()} onClick={search} className="min-h-11 border rounded-lg px-3 font-semibold">Retrouver le colis</button></div>
      {parcel && <div className="rounded-lg bg-slate-50 p-3"><strong>{parcel.externalId}</strong><p>{parcel.contactName} — {parcel.city}</p><p>Commande : {parcel.clientReference || 'Non renseignée'}</p>{parcel.carrierBarcode && <p className="break-all">Code associé : {parcel.carrierBarcode}</p>}</div>}
      <label className="block font-semibold">Format du transporteur<select className="block w-full min-h-11 border rounded-lg p-2 mt-1" value={format} disabled={busy || saved} onChange={e => { setFormat(e.target.value as CarrierBarcodeFormat); setVerified(false); }}><option value="generic">Autre transporteur — référence libre</option><option value="boiron">Boiron — 22 chiffres liés à la commande</option></select></label>
      <label className="block font-semibold">Code transporteur<input inputMode={format === 'boiron' ? 'numeric' : 'text'} className="block w-full min-h-11 border rounded-lg p-2 mt-1" value={code} disabled={busy || saved} onChange={e => { setCode(e.target.value); setVerified(false); }} /></label>
      <button type="button" disabled={busy || saved} onClick={() => setScanner('boiron')} className="min-h-11 border rounded-lg px-3">Scanner le code transporteur</button>
      <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={verified} disabled={busy || saved || !parcel} onChange={e => setVerified(e.target.checked)} />J’ai vérifié que ces deux codes désignent le même carton.</label>
      {message && <p role={saved ? 'status' : 'alert'} className={saved ? 'text-green-800' : 'text-red-800'}>{message}</p>}
      {saved ? <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-lg bg-brand-600 text-white">Terminer</button> : <button type="button" disabled={busy || !verified || !parcel || !code.trim() || !!carrierBarcodeError(code, parcel?.clientReference, format)} onClick={save} className="min-h-11 px-4 rounded-lg bg-brand-600 text-white disabled:opacity-50">{busy ? 'Vérification…' : 'Confirmer la correspondance'}</button>}
      {scanner && <Scanner onScan={value => { if (scanner === 'br') { setBr(value); setParcel(null); } else setCode(value.replace(/^\][A-Za-z]\d/, '')); setVerified(false); setScanner(null); }} onClose={() => setScanner(null)} />}
    </div>
  </Modal>;
}
