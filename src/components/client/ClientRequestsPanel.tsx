import React, { useEffect, useRef, useState } from 'react';
import type { Package, User } from '../../types';
import { auth } from '../../firebaseConfig';
import Modal from '../shared/Modal';
import { useClientAccess } from './ClientAccessContext';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { allowedClientRequestKinds, CLIENT_REQUEST_LABELS, CLIENT_REQUEST_STATUS_LABELS, ClientRequest, ClientRequestDraft,
  ClientRequestKind, readClientRequestDraft, reserveClientRequestDraft, RequestedAddress, submitClientRequest, subscribeClientRequests, subscribeClientRequest } from '../../services/clientRequestService';

interface Props { currentUser: User; parcel?: Package; onClose?: () => void; readOnly?: boolean; focusRequestId?: string }
const date = (value: string) => new Date(value).toLocaleString('fr-FR', { timeZone: 'Indian/Reunion' });
export function ClientRequestHistory({ request }: { request: ClientRequest }) {
  return <article id={`client-request-${request.id}`} tabIndex={-1} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
    <p className="font-semibold break-words">{request.reference} · {CLIENT_REQUEST_LABELS[request.kind]}</p>
    <p className="text-sm text-slate-700 break-words">Colis {request.packageReference} · {request.recipientName}</p>
    <p className="font-medium text-brand-800">{CLIENT_REQUEST_STATUS_LABELS[request.status]}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{request.message}</p>
    {request.requestedAddress && <p className="text-sm break-words">Adresse proposée : {request.requestedAddress.contactName}, {request.requestedAddress.address}, {request.requestedAddress.postalCode} {request.requestedAddress.city} · {request.requestedAddress.contactPhone}</p>}
    {request.requestedDate && <p className="text-sm">Date souhaitée : {request.requestedDate} (à confirmer par l’exploitation)</p>}
    <ol className="space-y-2 text-sm border-l-2 border-slate-200 pl-3">{request.history.map((event, index) => <li key={`${event.timestamp}-${index}`}>
      <p className="font-medium">{CLIENT_REQUEST_STATUS_LABELS[event.status]} · {date(event.timestamp)}</p>
      {event.response && <p className="whitespace-pre-wrap break-words mt-1">{event.response}</p>}
    </li>)}</ol>
  </article>;
}

function Content({ currentUser, parcel, onClose, readOnly = false, focusRequestId }: Props) {
  const access = useClientAccess(), disabled = readOnly || access.readOnly;
  const scope = `${auth.currentUser?.uid}|${currentUser.id}|${parcel?.id || ''}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [initial] = useState(() => { try { return { draft: parcel ? readClientRequestDraft(currentUser.id, parcel.id) : null, error: '' }; } catch (error) { return { draft: null, error: error instanceof Error ? error.message : 'Stockage local indisponible.' }; } });
  const choices = parcel ? allowedClientRequestKinds(parcel) : [];
  const [kind, setKind] = useState<ClientRequestKind>(initial.draft?.kind || choices[0] || 'MISSING');
  const [message, setMessage] = useState(initial.draft?.message || '');
  const [requestedAddress, setRequestedAddress] = useState<RequestedAddress>(initial.draft?.requestedAddress || {
    contactName: parcel?.contactName || '', address: parcel?.address || '', postalCode: parcel?.postalCode || '', city: parcel?.city || '', contactPhone: parcel?.contactPhone || '',
  });
  const [requestedDate, setRequestedDate] = useState(initial.draft?.requestedDate || '');
  const [pending, setPending] = useState<ClientRequestDraft | null>(initial.draft);
  const pendingRef = useRef(pending);
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [error, setError] = useState(initial.error), [receipt, setReceipt] = useState('');
  const [rows, setRows] = useState<ClientRequest[]>([]), [listError, setListError] = useState(''), [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState<ClientRequest | null>(null), [focusError, setFocusError] = useState('');
  useEffect(() => {
    setFocused(null); setFocusError('');
    if (!focusRequestId) return;
    return subscribeClientRequest(focusRequestId, setFocused, error => setFocusError(error.message));
  }, [focusRequestId, currentUser.id]);
  useEffect(() => { if (focused) document.getElementById(`client-request-${focused.id}`)?.focus(); }, [focused?.id]);
  const [count, setCount] = useState(50), [retry, setRetry] = useState(0);
  const initialAddress = { contactName: parcel?.contactName || '', address: parcel?.address || '', postalCode: parcel?.postalCode || '', city: parcel?.city || '', contactPhone: parcel?.contactPhone || '' };
  const dirty = !!parcel && !pending && !receipt && (Boolean(message.trim() || requestedDate) || kind !== choices[0] || JSON.stringify(requestedAddress) !== JSON.stringify(initialAddress));
  useUnsavedChanges(!onClose && dirty, !onClose && busy);
  useEffect(() => { scopeRef.current = scope; return () => { scopeRef.current = ''; }; }, [scope]);
  useEffect(() => {
    let active = true; setRows([]); setLoading(true); setListError('');
    const stop = subscribeClientRequests(currentUser, { count }, result => { if (active) { setRows(result); setLoading(false); } }, failure => {
      if (active) { setListError(failure.message || 'Lecture des demandes impossible.'); setLoading(false); }
    });
    return () => { active = false; stop(); };
  }, [currentUser.id, currentUser.companyName, count, retry]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || busyRef.current || !parcel) return;
    const captured = scope;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const draft = pendingRef.current || reserveClientRequestDraft({ requestId: crypto.randomUUID(), clientId: currentUser.id, packageId: parcel.id, kind, message: message.trim(),
        ...(kind === 'ADDRESS' ? { requestedAddress } : {}), ...(kind === 'REDELIVERY' ? { requestedDate } : {}) });
      pendingRef.current = draft; setPending(draft);
      const result = await access.runMutation('Demander un traitement à l’exploitation', () => submitClientRequest(draft));
      if (scopeRef.current !== captured) return;
      setReceipt(result.reference); setMessage(''); setPending(null); pendingRef.current = null;
    } catch (failure) {
      if (scopeRef.current !== captured) return;
      setError(failure instanceof Error ? failure.message : 'Résultat non confirmé. Reprenez la même demande.');
      try { const retained = readClientRequestDraft(currentUser.id, parcel.id); setPending(retained); pendingRef.current = retained; } catch { /* Original intent stays locked. */ }
    } finally { if (scopeRef.current === captured) { busyRef.current = false; setBusy(false); } }
  };
  const scopedRows = parcel ? rows.filter(row => row.packageId === parcel.id) : rows;
  const visible = focused ? [focused, ...scopedRows.filter(row => row.id !== focused.id)] : scopedRows;
  const body = <div className="space-y-4">
    <p className="text-sm text-slate-700">L’exploitation examine votre demande et vous répond ici. Une demande d’annulation ou de nouvelle livraison reste à confirmer ; le suivi du colis continue de faire foi.</p>
    {parcel && <p className="rounded-xl bg-slate-100 p-3 break-words">Colis <strong>{parcel.externalId || parcel.carrierBarcode || parcel.barcode || parcel.orderNumber}</strong> · {parcel.contactName}</p>}
    {receipt && <p role="status" className="rounded-xl bg-green-50 border border-green-200 p-3 text-green-900">Demande reçue : <strong>{receipt}</strong>. Retrouvez son évolution dans « Mes demandes ».</p>}
    {parcel && !receipt && <form onSubmit={event => void submit(event)} className="space-y-3">
      {pending && <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">Votre demande est conservée sur cet appareil. Vérifiez son enregistrement en reprenant la même demande ; ses informations restent verrouillées pour éviter un doublon.</p>}
      <fieldset disabled={disabled || busy || !!pending} className="space-y-3">
        <label className="block text-sm font-medium">Motif<select value={kind} onChange={event => setKind(event.target.value as ClientRequestKind)} className="mt-1 w-full min-h-11 rounded-xl border border-slate-300 p-3">{[...new Set([...choices, ...(pending ? [pending.kind] : [])])].map(value => <option key={value} value={value}>{CLIENT_REQUEST_LABELS[value]}</option>)}</select></label>
        <label className="block text-sm font-medium">Votre demande<textarea required minLength={10} maxLength={3000} rows={4} value={message} onChange={event => setMessage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Décrivez la difficulté et le résultat souhaité." /></label>
        {kind === 'ADDRESS' && <div className="grid gap-3 sm:grid-cols-2">{(['contactName', 'address', 'postalCode', 'city', 'contactPhone'] as const).map(key => <label key={key} className="block text-sm font-medium">{{ contactName: 'Destinataire proposé', address: 'Rue et numéro proposés', postalCode: 'Code postal', city: 'Ville', contactPhone: 'Téléphone' }[key]}<input required value={requestedAddress[key]} onChange={event => setRequestedAddress(old => ({ ...old, [key]: event.target.value }))} className="mt-1 w-full min-h-11 rounded-xl border border-slate-300 p-3" /></label>)}</div>}
        {kind === 'REDELIVERY' && <label className="block text-sm font-medium">Date souhaitée (facultative)<input type="date" min={new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)} value={requestedDate} onChange={event => setRequestedDate(event.target.value)} className="mt-1 w-full min-h-11 rounded-xl border border-slate-300 p-3" /></label>}
      </fieldset>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{error}</p>}
      <button type="submit" disabled={disabled || busy || message.trim().length < 10} className="ui-button ui-button-primary w-full sm:w-auto">{busy ? 'Vérification en cours…' : pending ? 'Vérifier et reprendre ma demande' : 'Envoyer ma demande'}</button>
    </form>}
    <div className="space-y-3" aria-label="Suivi des demandes">
      <h3 className="font-semibold">{parcel ? 'Demandes concernant ce colis' : 'Mes demandes à l’exploitation'}</h3>
      {loading && <p role="status">Chargement des demandes…</p>}
      {focusError && <p role="alert" className="text-red-900">Cette demande n’a pas pu être ouverte. {focusError}</p>}
      {listError && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-900"><p>Le suivi des demandes n’a pas pu être chargé. Cela ne signifie pas que votre demande est absente.</p><button type="button" onClick={() => setRetry(value => value + 1)} className="ui-button ui-button-secondary mt-2">Réessayer</button></div>}
      {!loading && !listError && !visible.length && <p className="text-sm text-slate-600">Aucune demande dans les {count} dernières demandes chargées.</p>}
      {visible.map(request => <ClientRequestHistory key={request.id} request={request} />)}
      {rows.length >= count && <button type="button" onClick={() => setCount(value => value + 50)} className="ui-button ui-button-secondary">Charger les demandes plus anciennes</button>}
    </div>
  </div>;
  return onClose ? <Modal mobileFullscreen isOpen onClose={onClose} title={parcel ? 'Contacter l’exploitation' : 'Mes demandes'} size="3xl" busy={busy} dirty={dirty}>{body}</Modal> : <section className="ui-panel p-4">{body}</section>;
}

export default function ClientRequestsPanel(props: Props) {
  return <Content key={`${auth.currentUser?.uid}|${props.currentUser.id}|${props.parcel?.id || ''}`} {...props} />;
}
