import { useEffect, useRef, useState } from 'react';
import type { Hub, Package, User } from '../types';
import { subscribeToHubs } from '../services/missionService';
import { readFieldDraft, saveFieldDraft, submitFieldOperation, fieldOperations } from '../services/fieldOperationsOutbox';
import { compressImage } from '../services/podService';
import { packageDisplayCode } from '../utils/barcode';
import Modal from './shared/Modal';
import SignaturePad from './DeliverySignaturePad';

type ReturnDraft = { photos: string[]; hubId: string; requestId: string; signature?: string };
export default function ReturnHubModal({ pkg, currentUser, onClose }: { pkg: Package; currentUser: User; onClose: () => void }) {
  const [hubs, setHubs] = useState<Hub[]>([]), [draft, setDraft] = useState<ReturnDraft>({ photos: [], hubId: '', requestId: crypto.randomUUID() });
  const [loadedScope, setLoadedScope] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [queued, setQueued] = useState(false);
  const lock = useRef<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const key = `return/${pkg.id}/${pkg.missionId || 'unassigned'}`;
  const scope = `${currentUser.id}/${key}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const ready = loadedScope === scope;
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const latestDraft = useRef(draft);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  useEffect(() => subscribeToHubs(rows => setHubs(rows.filter(hub => hub.isActive)), e => setError(e.message)), []);
  useEffect(() => {
    let active = true; pendingSave.current = Promise.resolve(); setBusy(false); setLoadedScope(''); setSaving(false); setCapturing(false); setSignatureOpen(false); setError('');
    Promise.all([readFieldDraft<ReturnDraft>(key, currentUser.id), fieldOperations(currentUser.id)]).then(([saved, pending]) => {
      if (!active) return;
      const restored = saved || { photos: [], hubId: '', requestId: crypto.randomUUID() };
      latestDraft.current = restored; setDraft(restored);
      setQueued(pending.some(row => row.kind === 'return' && row.payload.packageId === pkg.id && row.payload.expectedMissionId === (pkg.missionId || null)));
      setLoadedScope(scope);
    }).catch(() => { if (active) setError('Impossible de restaurer les preuves locales. Gardez cette application ouverte.'); });
    return () => { active = false; };
  }, [scope, key, currentUser.id, pkg.id, pkg.missionId]);
  const persist = async (change: (previous: ReturnDraft) => ReturnDraft, capturedScope = scope) => {
    if (!ready || currentScope.current !== capturedScope || queued) return;
    const next = change(latestDraft.current);
    latestDraft.current = next; setDraft(next); setSaving(true); setError('');
    // key and owner are captured by this handler. Later prop changes cannot
    // redirect an old photo/signature into a new driver's or attempt's draft.
    const save = pendingSave.current.catch(() => {}).then(() => saveFieldDraft(key, currentUser.id, next));
    pendingSave.current = save;
    try { await save; }
    catch (cause) { if (currentScope.current === capturedScope) setError('La preuve n’a pas pu être conservée sur ce téléphone. Gardez cet écran ouvert.'); throw cause; }
    finally { if (currentScope.current === capturedScope && pendingSave.current === save) setSaving(false); }
  };
  const close = async () => {
    if (capturing || busy) return;
    try { await pendingSave.current; if (currentScope.current === scope) onClose(); }
    catch { if (currentScope.current === scope) setError('Sauvegarde locale incomplète. Réessayez de confirmer avant de fermer.'); }
  };
  const submit = async () => {
    if (lock.current === scope || !ready || !draft.photos.length || !draft.hubId) return;
    lock.current = scope; setBusy(true); setError('');
    try {
      await pendingSave.current;
      if (currentScope.current !== scope) return;
      const timestamp = new Date().toISOString();
      await submitFieldOperation({ id: `${currentUser.id}/return/${pkg.id}/${pkg.missionId || 'unassigned'}`, userId: currentUser.id, missionId: pkg.missionId,
        kind: 'return', createdAt: timestamp, payload: { packageId: pkg.id, expectedMissionId: pkg.missionId || null, requestId: draft.requestId,
          photosBase64: draft.photos, signatureBase64: draft.signature, proof: { packageId: pkg.id, missionId: pkg.missionId,
            driverId: currentUser.id, driverName: `${currentUser.firstName} ${currentUser.lastName}`,
            hubId: draft.hubId, hubName: hubs.find(h => h.id === draft.hubId)?.name || '',
            reason: 'OTHER', reasonLabel: pkg.returnReason || pkg.failureReason || 'Retour après tentative',
            photoUrls: [], coordinates: null, locationStatus: 'unavailable', timestamp } } });
      if (currentScope.current === scope) onClose();
    } catch (cause) {
      if (currentScope.current !== scope) return;
      setError(cause instanceof Error ? cause.message : 'Retour à synchroniser.');
      try { const rows = await fieldOperations(currentUser.id); if (currentScope.current === scope) setQueued(rows.some(row => row.kind === 'return' && row.payload.packageId === pkg.id && row.payload.expectedMissionId === (pkg.missionId || null))); } catch {}
    } finally { if (lock.current === scope) lock.current = null; if (currentScope.current === scope) setBusy(false); }
  };
  if (!ready) return <Modal isOpen onClose={onClose} title="Retour au dépôt"><p role="status">Restauration des preuves de cet arrêt…</p>{error && <p role="alert">{error}</p>}</Modal>;
  return <Modal isOpen onClose={() => { void close(); }} title="Remettre le colis au dépôt" mobileFullscreen preventClose={busy || capturing || saving} size="lg">
    <p className="font-semibold mb-2">{packageDisplayCode(pkg)} · {pkg.contactName}</p>
    <p className="text-sm mb-4">Confirmez au moment de la remise physique au dépôt. Le bureau décidera ensuite de la relivraison ou du retour à l’expéditeur.</p>
    {error && <p role="alert" className="ui-notice ui-notice-warning mb-3">{error}</p>}
    {queued ? <p role="status" className="ui-notice ui-notice-warning">Retour conservé sur ce téléphone. Utilisez « Réessayer les envois » dans le bandeau de synchronisation.</p> : <fieldset disabled={!ready || busy || capturing || saving} className="space-y-4">
      <label className="block font-semibold">Dépôt de remise
        <select className="ui-input w-full mt-1" value={draft.hubId} onChange={e => { const hubId = e.target.value; void persist(old => ({ ...old, hubId })).catch(() => {}); }}>
          <option value="">Choisir le dépôt réel</option>{hubs.map(hub => <option value={hub.id} key={hub.id}>{hub.name}</option>)}
        </select>
      </label>
      <label className="block font-semibold">Photo du carton remis au dépôt
        <input type="file" accept="image/*" capture="environment" disabled={draft.photos.length >= 5} className="block mt-2 max-w-full" onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          const capturedScope = scope; setCapturing(true);
          try {
            const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
            const photo = await compressImage(raw);
            if (currentScope.current === capturedScope) await persist(old => ({ ...old, photos: [...old.photos, photo].slice(0, 5) }), capturedScope);
          } catch { if (currentScope.current === capturedScope) setError('La photo n’a pas pu être conservée. Réessayez.'); }
          finally { if (currentScope.current === capturedScope) setCapturing(false); }
        }} />
      </label>
      <div className="flex flex-wrap gap-2">{draft.photos.map((photo, index) => <div key={index}><img src={photo} alt={`Carton au dépôt ${index + 1}`} className="w-24 h-24 object-cover rounded" /><button className="ui-button ui-button-ghost" onClick={() => { void persist(old => ({ ...old, photos: old.photos.filter((_, i) => i !== index) })).catch(() => {}); }}>Retirer</button></div>)}</div>
      {draft.signature && <img src={draft.signature} className="w-full h-24 object-contain border rounded" alt="Signature de réception au dépôt" />}
      <button type="button" className="ui-button ui-button-secondary" onClick={() => setSignatureOpen(true)}>{draft.signature ? 'Refaire la signature' : 'Signature du réceptionnaire (facultative)'}</button>
      <p className="text-sm text-slate-600">{capturing || saving ? 'Sauvegarde sur cet appareil…' : 'Photos conservées sur cet appareil avant confirmation.'}</p>
      <button type="button" className="ui-button ui-button-primary w-full" onClick={() => void submit()} disabled={busy || !draft.hubId || !draft.photos.length}>{busy ? 'Enregistrement…' : 'Confirmer la remise au dépôt'}</button>
    </fieldset>}
    <Modal isOpen={signatureOpen} onClose={() => setSignatureOpen(false)} title="Signature au dépôt" size="lg"><SignaturePad onSave={signature => { void persist(old => ({ ...old, signature })).then(() => { if (currentScope.current === scope) setSignatureOpen(false); }).catch(() => {}); }} onCancel={() => setSignatureOpen(false)} /></Modal>
  </Modal>;
}
