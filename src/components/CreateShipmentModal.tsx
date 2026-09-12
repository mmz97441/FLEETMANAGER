/** Create once, then save the address and print as independent recoverable actions. */
import React, { useState, useMemo, useRef, useEffect, useId } from 'react';
import { User, SavedAddress, Package, Zone } from '../types';
import { createClientShipment } from '../services/missionService';
import { estimateZoneFromAddress } from '../services/deliveryService';
import { generateBatchLabelsHTML, LabelFormat } from '../services/pickupService';
import { Package as PackageIcon, Printer, MapPin, AlertTriangle, Check, BookUser } from 'lucide-react';
import Modal from './shared/Modal';
import { FormInput, FormTextarea } from './shared/FormInput';
import { validateClientShipment, ClientShipmentErrors } from '../utils/clientShipmentForm';
import { readPendingClientShipment, reservePendingClientShipment, clearPendingClientShipment, PendingShipmentRequest } from '../utils/pendingClientShipment';
import ShipmentReference from './client/ShipmentReference';
import { useClientAccess } from './client/ClientAccessContext';
import { startUxTask } from '../utils/uxMetrics';
import { confirmAction } from '../services/confirmationService';

interface CreateShipmentModalProps {
  currentUser: User;
  savedAddresses: SavedAddress[];
  onClose: () => void;
  onCreated: (packages: Package[]) => void;
  onViewPackages?: () => void;
  onSaveRecipient?: (fields: { contactName: string; address: string; city: string; contactPhone: string; contactEmail?: string }) => Promise<void>;
}

const splitCity = (city: string) => {
  const postalCode = (city || '').match(/\d{5}/)?.[0] || '';
  return { postalCode, cityName: (city || '').replace(postalCode, '').trim().replace(/^,\s*/, '') };
};

const CreateShipmentModal: React.FC<CreateShipmentModalProps> = ({ currentUser, savedAddresses, onClose, onCreated, onViewPackages, onSaveRecipient }) => {
  const access = useClientAccess();
  const formId = useId();
  const [initialJournal] = useState(() => {
    try { return { record: readPendingClientShipment(window.localStorage, currentUser.id), error: '' }; }
    catch (cause) { return { record: null, error: cause instanceof Error ? cause.message : 'Le stockage local est indisponible. Autorisez le stockage de ce site avant de créer une expédition.' }; }
  });
  const initialRequest = initialJournal.record?.request;
  const [optionsOpen, setOptionsOpen] = useState(Boolean(initialRequest?.recipient.contactEmail || initialRequest?.weight || initialRequest?.clientReference || initialRequest?.comment));
  const [journalDate, setJournalDate] = useState(initialJournal.record?.createdAt || '');
  const [contactName, setContactName] = useState(initialRequest?.recipient.contactName || '');
  const [address, setAddress] = useState(initialRequest?.recipient.address || '');
  const [postalCode, setPostalCode] = useState(initialRequest?.recipient.postalCode || '');
  const [city, setCity] = useState(initialRequest?.recipient.city || '');
  const [contactPhone, setContactPhone] = useState(initialRequest?.recipient.contactPhone || '');
  const [contactEmail, setContactEmail] = useState(initialRequest?.recipient.contactEmail || '');
  const [packageCount, setPackageCount] = useState(initialRequest?.packageCount || 1);
  const [weight, setWeight] = useState(initialRequest?.weight == null ? '' : String(initialRequest.weight));
  const [comment, setComment] = useState(initialRequest?.comment || '');
  const [clientReference, setClientReference] = useState(initialRequest?.clientReference || '');
  const [format, setFormat] = useState<LabelFormat>('A6');
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [showBook, setShowBook] = useState(false);
  const [saveToBook, setSaveToBook] = useState(!initialRequest);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState(initialJournal.error);
  const [fieldErrors, setFieldErrors] = useState<ClientShipmentErrors>({});
  const [zoneWarn, setZoneWarn] = useState(false);
  const [created, setCreated] = useState<Package[] | null>(null);
  const [bookError, setBookError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (created) resultRef.current?.focus({ preventScroll: true }); }, [created]);
  const [bookSaved, setBookSaved] = useState(false);
  const [printError, setPrintError] = useState('');
  const [printed, setPrinted] = useState(false);
  const requestId = useRef(initialRequest?.requestId || crypto.randomUUID());
  const pendingRequest = useRef<PendingShipmentRequest | null>(initialRequest || null);
  const [requestLocked, setRequestLocked] = useState(Boolean(initialRequest));
  const [journalSaved, setJournalSaved] = useState(Boolean(initialRequest));
  const [journalWarning, setJournalWarning] = useState('');
  const [verifiedBeforeAbandon, setVerifiedBeforeAbandon] = useState(false);

  const deliveryBook = useMemo(() => savedAddresses.filter(a => a.type === 'delivery' || a.type === 'both'), [savedAddresses]);
  const nameMatches = useMemo(() => {
    const q = contactName.trim().toLocaleLowerCase('fr');
    return deliveryBook.filter(a => !q || [a.contactName, a.label, a.address, a.city].some(value => value?.toLocaleLowerCase('fr').includes(q))).slice(0, showBook ? 100 : 5);
  }, [contactName, deliveryBook, showBook]);
  const dirty = !created && Boolean(contactName || address || postalCode || city || contactPhone || contactEmail || weight || comment || clientReference || packageCount !== 1);

  const pickAddress = (a: SavedAddress) => {
    const split = splitCity(a.city);
    setContactName(a.contactName || a.label || ''); setAddress(a.address || '');
    setPostalCode(split.postalCode); setCity(split.cityName); setContactPhone(a.contactPhone || ''); setContactEmail(a.contactEmail || '');
    setLinkedId(a.id); setShowBook(false); setFieldErrors({}); if (a.contactEmail) setOptionsOpen(true);
  };

  const print = () => {
    if (!created) return;
    setPrintError('');
    try {
      const win = window.open('', '_blank');
      if (!win) { setPrintError('La fenêtre d’impression a été bloquée. Autorisez les fenêtres de ce site, puis cliquez sur Imprimer les étiquettes. Vos colis sont déjà enregistrés.'); return; }
      win.opener = null;
      win.document.write(generateBatchLabelsHTML(created, currentUser.companyName || 'Expéditeur', format));
      win.document.close(); setPrinted(true);
    } catch { setPrintError('L’impression n’a pas pu s’ouvrir. Vos colis sont enregistrés ; vous pouvez réimprimer depuis Mes colis.'); }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || created || access.readOnly) return;
    const errors = validateClientShipment({ contactName, address, postalCode, city, contactPhone, contactEmail, packageCount, weight });
    setFieldErrors(errors); setError('');
    const first = Object.keys(errors)[0];
    if (first) {
      if (errors.contactEmail || errors.weight) setOptionsOpen(true);
      requestAnimationFrame(() => document.getElementById(`shipment-${first}`)?.focus());
      return;
    }
    const task = startUxTask('create_shipment', 'client');
    submitting.current = true; setBusy(true);
    let packages: Package[];
    let cp = postalCode.trim();
    try {
      let zone: Zone = Zone.NORD;
      if (!pendingRequest.current) {
      try {
        const est = await estimateZoneFromAddress(`${address}, ${postalCode} ${city}`.trim());
        if (est) { zone = est.zone; cp = est.postalCode || cp; setZoneWarn(false); }
        else setZoneWarn(true);
      } catch { setZoneWarn(true); }
      pendingRequest.current = {
        requestId: requestId.current,
        client: { id: currentUser.id, companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}` },
        recipient: { contactName: contactName.trim(), address: address.trim(), city: city.trim(), postalCode: cp, contactPhone: contactPhone.trim(), contactEmail: contactEmail.trim() || undefined },
        zone, packageCount, weight: weight ? Number(weight) : undefined, comment: comment.trim() || undefined, clientReference: clientReference.trim() || undefined,
      };
      setRequestLocked(true);
      }
      cp = pendingRequest.current.recipient.postalCode;
      try {
        const journal = await reservePendingClientShipment(window.localStorage, currentUser.id, pendingRequest.current);
        setJournalDate(journal.createdAt);
        setJournalSaved(true);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : '';
        throw new Error(`La demande n’a pas pu être conservée sur cet appareil. Aucun nouvel envoi n’a été lancé. ${detail} Autorisez le stockage du site puis réessayez, ou reprenez la demande déjà en attente.`);
      }
      packages = await access.runMutation('Créer ou vérifier une expédition', () => createClientShipment(pendingRequest.current!));
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Vos saisies sont conservées.` : 'La création n’a pas pu être confirmée. Vérifiez votre connexion ; vos saisies sont conservées.');
      task.finish('error', { errors: 1 });
      submitting.current = false; setBusy(false); return;
    }
    // From this point creation is confirmed. A carnet or print failure must never enable another creation.
    task.finish('success', { items: packages.length });
    setCreated(packages);
    try {
      const cleared = await clearPendingClientShipment(window.localStorage, currentUser.id, requestId.current);
      if (!cleared) setJournalWarning('Une autre demande est en attente sur cet appareil. Elle a été conservée ; rouvrez le formulaire pour la reprendre.');
      else setJournalSaved(false);
    } catch {
      setJournalWarning('Vos colis sont confirmés. Le rappel local n’a pas pu être effacé ; une reprise éventuelle vérifiera les mêmes codes sans recréer les colis.');
    }
    if (!linkedId && saveToBook && onSaveRecipient) {
      try {
        await onSaveRecipient({ contactName: contactName.trim(), address: address.trim(), city: `${cp} ${city.trim()}`.trim(), contactPhone: contactPhone.trim(), contactEmail: contactEmail.trim() || undefined });
        setBookSaved(true);
      } catch { setBookError('Vos colis sont créés, mais l’ajout au carnet n’a pas été confirmé. Vérifiez Mes destinataires avant de l’ajouter à nouveau.'); }
    }
    setBusy(false); submitting.current = false;
    onCreated(packages);
  };

  const abandonPending = async () => {
    if (busy || !verifiedBeforeAbandon || !pendingRequest.current) return;
    const confirmed = await confirmAction({
      title: 'Abandonner la reprise de cette demande ?',
      message: 'Vous confirmez avoir vérifié Mes colis. Cette action efface uniquement le rappel sur cet appareil : elle ne supprime aucun colis déjà enregistré. Créer ensuite un nouvel envoi peut produire un doublon si cette demande avait déjà abouti. En cas de doute, conservez la demande et contactez votre responsable.',
      cancelLabel: 'Conserver et reprendre', confirmLabel: 'J’ai vérifié, abandonner la reprise', danger: true,
    });
    if (!confirmed) return;
    try {
      const cleared = await clearPendingClientShipment(window.localStorage, currentUser.id, requestId.current);
      if (!cleared) { setError('Une autre demande a été enregistrée dans un autre onglet. Elle a été conservée ; fermez puis rouvrez le formulaire pour la consulter.'); return; }
      onClose();
    } catch { setError('Le rappel local n’a pas pu être supprimé. Il reste conservé ; autorisez le stockage du site puis réessayez.'); }
  };

  return (
    <Modal mobileFullscreen subtitle={access.contextLabel} isOpen onClose={onClose} title={created ? 'Expédition enregistrée' : requestLocked ? 'Vérifier cette demande' : 'Créer une expédition'} headerIcon={<PackageIcon size={22} />} size="lg" dirty={dirty && !journalSaved} preventClose={busy}
      footer={!created ? <button type="submit" form={formId} disabled={busy || access.readOnly} className="ui-button ui-button-primary w-full">{busy ? (requestLocked ? 'Vérification en cours…' : 'Création en cours…') : requestLocked ? 'Vérifier cette demande' : 'Créer l’expédition'}</button> : <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={print} className="ui-button ui-button-primary"><Printer size={18} aria-hidden="true" />{printed ? 'Imprimer à nouveau' : 'Imprimer les étiquettes'}</button>
        <button type="button" disabled={busy} onClick={() => { onClose(); onViewPackages?.(); }} className="ui-button ui-button-secondary">{onViewPackages ? 'Voir mes colis' : 'Terminer'}</button>
      </div>}>

      {created ? (
        <div className="space-y-4">
          <div ref={resultRef} tabIndex={-1} role="status" className="space-y-2">
            <p className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Check size={22} aria-hidden="true" className="text-emerald-700 shrink-0" />{created.length} colis enregistré{created.length > 1 ? 's' : ''}</p>
            <p className="text-base font-medium text-slate-800 break-words">{contactName}</p>
            <p className="text-sm text-slate-600 break-words">{address}, {postalCode} {city}</p>
            <p className="text-sm text-slate-700">En attente de collecte. Préparez vos étiquettes maintenant ou retrouvez-les dans Mes colis.</p>
          </div>
          {busy && <p role="status" className="text-sm text-slate-700">Enregistrement du destinataire dans le carnet…</p>}
          {journalWarning && <p role="status" className="ui-notice ui-notice-warning">{journalWarning}</p>}
          {bookError && <p role="alert" className="ui-notice ui-notice-warning">{bookError}</p>}
          {zoneWarn && <p className="ui-notice ui-notice-warning flex items-start gap-2"><MapPin size={18} className="shrink-0" aria-hidden="true" />Zone à vérifier par le transporteur : l’adresse n’a pas pu être reconnue automatiquement.</p>}
          {printError && <p role="alert" className="ui-notice ui-notice-danger">{printError}</p>}
          <fieldset className="border-t border-slate-200 pt-4"><legend className="font-semibold text-sm pr-2">Préparer les étiquettes</legend>
            <label className="flex flex-wrap items-center gap-3 text-sm text-slate-700">Format<select value={format} onChange={event => setFormat(event.target.value as LabelFormat)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base"><option value="A6">A6 · une par page</option><option value="A5">A5 · deux par page</option><option value="A4">A4 · quatre par page</option></select></label>
          </fieldset>
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Références des colis</h3>
            <ul aria-label="Codes des colis enregistrés" className="divide-y divide-slate-200">{created.map(p => <li key={p.id} className="py-3 first:pt-0"><ShipmentReference reference={p.externalId || p.barcode || p.orderNumber} /></li>)}</ul>
          </div>
          {bookSaved && <p className="text-sm text-slate-600 flex items-start gap-2"><BookUser size={18} aria-hidden="true" className="shrink-0" />Destinataire ajouté à votre carnet.</p>}
        </div>
      ) : (
        <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4" aria-busy={busy}>
          {journalSaved && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold text-base">Demande en attente de confirmation</p>
            {journalDate && <p className="mt-1">Conservée le {new Date(journalDate).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
            <p className="mt-2 font-semibold">{contactName} · {packageCount} colis</p>
            <p>{address}, {postalCode} {city}</p>
            <p className="mt-2">Choisissez « Vérifier cette demande ». Nous reprenons les mêmes références pour éviter les doublons. Les informations ci-dessous sont verrouillées jusqu’à confirmation.</p>
            {onViewPackages && <button type="button" disabled={busy} onClick={() => { onClose(); onViewPackages(); }} className="ui-button ui-button-ghost mt-2 min-h-11 underline">Consulter Mes colis en conservant cette demande</button>}
          </div>}
          <p className="text-sm text-slate-600">La collecte sera organisée par le transporteur après création. Les champs marqués * sont obligatoires.</p>
          {Object.keys(fieldErrors).length > 0 && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800"><p className="font-bold">Complétez les informations suivantes :</p><ul className="mt-1 space-y-1">{Object.entries(fieldErrors).map(([key, message]) => <li key={key}><button type="button" className="ui-button ui-button-ghost text-left underline min-h-11" onClick={() => { if (key === 'contactEmail' || key === 'weight') setOptionsOpen(true); requestAnimationFrame(() => document.getElementById(`shipment-${key}`)?.focus()); }}>{message}</button></li>)}</ul></div>}
          <fieldset disabled={busy || requestLocked || access.readOnly} className="border-t border-slate-200 pt-3 space-y-3">
            <legend className="pr-2 font-semibold text-base text-slate-900">1. Destinataire</legend>
            {deliveryBook.length > 0 && <div className="space-y-2">
              <button type="button" onClick={() => setShowBook(!showBook)} aria-expanded={showBook} className="ui-button ui-button-ghost text-sm min-h-11 flex items-center gap-2"><BookUser size={18} /> {showBook ? 'Masquer le carnet' : 'Choisir dans mon carnet'}</button>
              {(showBook || (contactName && !linkedId)) && nameMatches.length > 0 && <ul className="max-h-40 overflow-auto">{nameMatches.map(a => <li key={a.id}><button type="button" onClick={() => pickAddress(a)} className="ui-button ui-button-ghost w-full text-left text-sm"><span className="block font-semibold">{a.contactName || a.label}</span><span className="text-slate-600">{a.address} · {a.city}</span></button></li>)}</ul>}
              {linkedId && <p role="status" className="text-sm text-emerald-800">Destinataire du carnet sélectionné.</p>}
            </div>}
            <FormInput id="shipment-contactName" label="Nom du destinataire" required autoComplete="shipping name" value={contactName} onChange={e => { setContactName(e.target.value); setLinkedId(null); }} error={fieldErrors.contactName} />
            <FormInput id="shipment-address" label="Adresse : rue et numéro" required autoComplete="shipping address-line1" value={address} onChange={e => setAddress(e.target.value)} error={fieldErrors.address} />
            <div className="grid sm:grid-cols-2 gap-3">
              <FormInput id="shipment-postalCode" label="Code postal" autoComplete="shipping postal-code" inputMode="numeric" maxLength={5} value={postalCode} onChange={e => setPostalCode(e.target.value)} error={fieldErrors.postalCode} />
              <FormInput id="shipment-city" label="Ville" autoComplete="shipping address-level2" value={city} onChange={e => setCity(e.target.value)} error={fieldErrors.city} />
            </div>
            <FormInput id="shipment-contactPhone" label="Téléphone du destinataire" required type="tel" autoComplete="shipping tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} error={fieldErrors.contactPhone} />
            {!linkedId && onSaveRecipient && <label className="flex items-start gap-3 text-sm text-slate-700 py-2"><input type="checkbox" checked={saveToBook} onChange={e => setSaveToBook(e.target.checked)} className="w-5 h-5" /> Ajouter ce destinataire à mon carnet</label>}
          </fieldset>
          <fieldset disabled={busy || requestLocked || access.readOnly} className="border-t border-slate-200 pt-3">
            <legend className="pr-2 font-semibold text-base text-slate-900">2. Colis</legend>
            <FormInput id="shipment-packageCount" label="Nombre de colis" required type="number" min={1} max={50} step={1} inputMode="numeric" value={packageCount || ''} onChange={e => setPackageCount(Number(e.target.value))} error={fieldErrors.packageCount} />
          </fieldset>
          <details open={optionsOpen} onToggle={event => setOptionsOpen(event.currentTarget.open)} className="border-t border-slate-200 pt-3">
            <summary className="min-h-11 cursor-pointer font-bold text-base text-slate-900">3. Options (facultatif)</summary>
            <fieldset disabled={busy || requestLocked || access.readOnly} className="space-y-3 pt-2">
              <FormInput id="shipment-contactEmail" label="Email du destinataire" type="email" autoComplete="shipping email" hint="Pour la copie du bon de livraison." value={contactEmail} onChange={e => setContactEmail(e.target.value)} error={fieldErrors.contactEmail} />
              <FormInput id="shipment-weight" label="Poids en kg" type="number" min={0} step="0.1" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value)} error={fieldErrors.weight} />
              <FormInput label="Votre référence" value={clientReference} onChange={e => setClientReference(e.target.value)} />
              <FormTextarea label="Consignes de livraison" value={comment} onChange={e => setComment(e.target.value)} rows={3} />
            </fieldset>
          </details>
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2"><AlertTriangle size={18} className="shrink-0" />{error}</p>}
          {journalSaved && !busy && <details className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><summary className="min-h-11 cursor-pointer font-semibold">Options avancées de reprise</summary><p>Vérifiez d’abord les colis de votre compte. Si le refus persiste, vous pouvez abandonner le rappel après cette vérification. Aucun colis existant ne sera annulé.</p><label className="my-3 flex items-start gap-3"><input type="checkbox" checked={verifiedBeforeAbandon} onChange={event => setVerifiedBeforeAbandon(event.target.checked)} className="mt-1 w-5 h-5 shrink-0" /> J’ai vérifié Mes colis et je souhaite abandonner cette reprise.</label><button type="button" disabled={!verifiedBeforeAbandon} onClick={() => void abandonPending()} className="ui-button ui-button-secondary min-h-11 border disabled:opacity-50">Abandonner la reprise après vérification</button></details>}

        </form>
      )}
    </Modal>
  );
};
export default CreateShipmentModal;
