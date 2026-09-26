import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app from '../firebaseConfig';
import { findPackageByCode } from '../services/missionService';
import { withDeadline } from '../utils/asyncDeadline';
import type { Package } from '../types';
import Modal from './shared/Modal';
import Scanner from './Scanner';

export default function CarrierBarcodeModal({ onClose }: { onClose: () => void }) {
  const [br, setBr] = useState(''), [code, setCode] = useState('');
  const [parcel, setParcel] = useState<Package | null>(null);
  const [verified, setVerified] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [saved, setSaved] = useState(false);
  const [scanner, setScanner] = useState<'br' | 'boiron' | null>(null);
  const search = async () => {
    setBusy(true); setMessage(''); setParcel(null); setVerified(false);
    try {
      if (!/^BR[-A-Z0-9]+$/i.test(br.trim())) throw new Error('Scannez ou saisissez le numéro BR du carton.');
      const result = await withDeadline(findPackageByCode(br.trim().toUpperCase()), 15000, new Error('Recherche trop longue. Réessayez.'));
      if (!result) throw new Error('Colis BR introuvable. Vérifiez le numéro et son import.');
      setParcel(result);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Recherche impossible. Réessayez.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!parcel || !verified || busy) return;
    setBusy(true); setMessage('');
    try {
      await withDeadline(httpsCallable(getFunctions(app, 'europe-west1'), 'associateCarrierBarcode')({ packageId: parcel.id, code, verified }), 20000,
        new Error('Confirmation trop longue. Réessayez la même association : elle ne sera pas créée deux fois.'));
      setSaved(true); setMessage(`Code Boiron associé au colis ${parcel.externalId || br}. Le chauffeur peut maintenant le scanner.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Association impossible. Réessayez.'); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} title="Associer une étiquette Boiron" busy={busy} dirty={!!code && !saved} size="lg">
    <div className="space-y-4">
      <p>Sur le même carton, relevez le numéro BR et le code Boiron. Cette correspondance permettra au chauffeur de scanner directement l’étiquette Boiron.</p>
      <label className="block font-semibold">Numéro BR du carton<input className="block w-full min-h-11 border rounded-lg p-2 mt-1" value={br} disabled={busy || saved} onChange={e => { setBr(e.target.value); setParcel(null); setVerified(false); }} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || saved} onClick={() => setScanner('br')} className="min-h-11 border rounded-lg px-3">Scanner le BR</button><button type="button" disabled={busy || saved || !br.trim()} onClick={search} className="min-h-11 border rounded-lg px-3 font-semibold">Retrouver le colis</button></div>
      {parcel && <div className="rounded-lg bg-slate-50 p-3"><strong>{parcel.externalId}</strong><p>{parcel.contactName} — {parcel.city}</p><p>Commande : {parcel.clientReference || 'Non renseignée'}</p>{parcel.carrierBarcode && <p className="break-all">Code associé : {parcel.carrierBarcode}</p>}</div>}
      <label className="block font-semibold">Code Boiron — 22 chiffres<input inputMode="numeric" className="block w-full min-h-11 border rounded-lg p-2 mt-1" value={code} disabled={busy || saved} onChange={e => { setCode(e.target.value); setVerified(false); }} /></label>
      <button type="button" disabled={busy || saved} onClick={() => setScanner('boiron')} className="min-h-11 border rounded-lg px-3">Scanner le code Boiron</button>
      <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={verified} disabled={busy || saved || !parcel} onChange={e => setVerified(e.target.checked)} />J’ai vérifié que ces deux codes désignent le même carton.</label>
      {message && <p role={saved ? 'status' : 'alert'} className={saved ? 'text-green-800' : 'text-red-800'}>{message}</p>}
      {saved ? <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-lg bg-brand-600 text-white">Terminer</button> : <button type="button" disabled={busy || !verified || !parcel || !/^00\d{20}$/.test(code)} onClick={save} className="min-h-11 px-4 rounded-lg bg-brand-600 text-white disabled:opacity-50">{busy ? 'Vérification…' : 'Confirmer la correspondance'}</button>}
      {scanner && <Scanner onScan={value => { if (scanner === 'br') { setBr(value); setParcel(null); } else setCode(value.replace(/^\][A-Za-z]\d/, '')); setVerified(false); setScanner(null); }} onClose={() => setScanner(null)} />}
    </div>
  </Modal>;
}
