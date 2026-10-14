import React, { useEffect, useRef, useState } from 'react';
import type { User } from '../../types';
import { auth } from '../../firebaseConfig';
import { ClientRequest, ClientRequestStatus, subscribeClientRequest, subscribeClientRequests, updateClientRequest } from '../../services/clientRequestService';
import { ClientRequestHistory } from './ClientRequestsPanel';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { requestNavigation } from '../../utils/navigationGuard';

function RequestActions({ request, onInspect }: { request: ClientRequest; onInspect?: (packageId: string) => void }) {
  const [response, setResponse] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef<{ id: string; status: ClientRequestStatus; response: string; version: number } | null>(null);
  const [formVersion, setFormVersion] = useState(request.version);
  const busyRef = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const requestDiscard = useUnsavedChanges(Boolean(response), busy);
  const terminal = ['RESOLVED', 'REJECTED'].includes(request.status);
  const update = async (status: ClientRequestStatus) => {
    if (busyRef.current) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setError('Reconnectez-vous avant de répondre.'); return; }
    if (!operation.current && (terminal || request.version !== formVersion)) { setError('Cette demande a changé. Relisez le suivi avant de confirmer votre réponse.'); return; }
    if (operation.current && (operation.current.status !== status || operation.current.response !== response)) {
      setError('Une réponse reste à vérifier. Reprenez la même action avant de modifier la demande.'); return;
    }
    const intent = operation.current || { id: crypto.randomUUID(), status, response, version: request.version };
    operation.current = intent; busyRef.current = true; setBusy(true); setError('');
    try {
      await updateClientRequest({ ...request, version: intent.version }, status, response, intent.id);
      if (!live.current || auth.currentUser?.uid !== uid) return;
      operation.current = null; setResponse(''); setFormVersion(intent.version + 1);
    } catch (failure: any) {
      if (!live.current || auth.currentUser?.uid !== uid) return;
      if (['functions/failed-precondition', 'functions/invalid-argument', 'functions/permission-denied', 'functions/not-found'].includes(failure?.code)) operation.current = null;
      setError(failure instanceof Error ? failure.message : 'Résultat non confirmé. Reprenez la même action.');
    } finally { if (live.current && auth.currentUser?.uid === uid) { busyRef.current = false; setBusy(false); } }
  };
  if (terminal && !response && !operation.current) return null;
  return <div className="space-y-3 rounded-xl border border-brand-200 p-4">
    {onInspect && <button type="button" onClick={() => onInspect(request.packageId)} className="ui-button ui-button-secondary">Ouvrir le colis et ses opérations</button>}
    <label className="block text-sm font-medium">Réponse visible par le client<textarea disabled={busy || !!operation.current} value={response} onChange={event => setResponse(event.target.value)} maxLength={3000} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Précisez la suite donnée, la date confirmée ou le motif du refus." /></label>
    <p className="text-sm text-slate-600">Traitez le colis dans son parcours logistique, puis expliquez ici le résultat au client. La réponse ne modifie pas le colis.</p>
    {request.version !== formVersion && !operation.current && <p role="status" className="rounded-xl bg-amber-50 p-3">Le suivi a changé depuis l’ouverture de ce brouillon. Votre réponse n’a pas été envoyée. {!terminal && <button type="button" onClick={() => setFormVersion(request.version)} className="ui-button ui-button-secondary mt-2">J’ai relu le suivi, utiliser cette version</button>}</p>}
    {terminal && <button type="button" disabled={busy || !!operation.current} onClick={() => void requestDiscard(() => setResponse(''))} className="ui-button ui-button-secondary">Abandonner ma réponse non envoyée</button>}
    <div className="flex flex-wrap gap-2">
      {(request.status === 'OPEN' || operation.current?.status === 'IN_PROGRESS') && <button type="button" disabled={busy || (!!operation.current && operation.current.status !== 'IN_PROGRESS')} onClick={() => void update('IN_PROGRESS')} className="ui-button ui-button-secondary">Prendre en charge</button>}
      <button type="button" disabled={busy || response.trim().length < 10 || (terminal && !operation.current) || (!!operation.current && operation.current.status !== 'RESOLVED')} onClick={() => void update('RESOLVED')} className="ui-button ui-button-primary">{operation.current?.status === 'RESOLVED' ? 'Vérifier et reprendre la réponse' : 'Envoyer la réponse et clôturer'}</button>
      <button type="button" disabled={busy || response.trim().length < 10 || (terminal && !operation.current) || (!!operation.current && operation.current.status !== 'REJECTED')} onClick={() => void update('REJECTED')} className="ui-button ui-button-secondary">Refuser avec cette explication</button>
    </div>
    {busy && <p role="status">Enregistrement du traitement…</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{error}</p>}
  </div>;
}

function ManagedRequest({ initial, onInspect }: { initial: ClientRequest; onInspect?: (packageId: string) => void }) {
  const [request, setRequest] = useState(initial), [error, setError] = useState('');
  // Keep a consulted row current even when a colleague closes it and it leaves
  // the open-requests query. Its unsent response must remain accessible.
  useEffect(() => subscribeClientRequest(initial.id, value => { setRequest(value); setError(''); }, failure => setError(failure.message)), [initial.id]);
  return <div className="space-y-2"><p className="font-semibold break-words">{request.companyName}</p><ClientRequestHistory request={request} />{error && <p role="alert" className="text-red-900">{error}</p>}<RequestActions request={request} onInspect={onInspect} /></div>;
}

interface Props { currentUser: User; onInspect?: (packageId: string) => void; focusRequestId?: string }
export default function ClientRequestsManager(props: Props) {
  return <ManagerContent key={`${auth.currentUser?.uid}|${props.currentUser.id}`} {...props} />;
}
function ManagerContent({ currentUser, onInspect, focusRequestId }: Props) {
  const [rows, setRows] = useState<ClientRequest[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState<ClientRequest | null>(null), [focusError, setFocusError] = useState('');
  useEffect(() => {
    setFocused(null); setFocusError('');
    if (!focusRequestId) return;
    return subscribeClientRequest(focusRequestId, setFocused, error => setFocusError(error.message));
  }, [focusRequestId]);
  useEffect(() => { if (focused) document.getElementById(`client-request-${focused.id}`)?.focus(); }, [focused?.id]);
  const [count, setCount] = useState(50), [showClosed, setShowClosed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError(''); setLoading(true);
    const unsubscribe = subscribeClientRequests(currentUser, { manager: true, activeOnly: !showClosed, count }, value => {
      if (live) { setRows(previous => [...value, ...previous.filter(old => !value.some(row => row.id === old.id) && ['OPEN', 'IN_PROGRESS'].includes(old.status))]); setLoading(false); }
    }, failure => { if (live) { setError(failure.message); setLoading(false); } });
    return () => { live = false; unsubscribe(); };
  }, [currentUser.id, count, showClosed, retry]);
  return <section className="space-y-4">
    <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={showClosed} onChange={event => { const value = event.target.checked; void requestNavigation(() => { setRows([]); setShowClosed(value); }); }} />Inclure les demandes clôturées</label>
    {loading && <p role="status">Chargement des demandes client…</p>}
    {error && <div role="alert"><p className="text-red-900">La liste des demandes n’est pas disponible. {error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="ui-button ui-button-secondary">Réessayer</button></div>}
    {!loading && !error && !rows.length && <p>Aucune demande {showClosed ? '' : 'en attente de traitement'}.</p>}
    {focusError && <p role="alert" className="text-red-900">Cette demande n’a pas pu être ouverte. {focusError}</p>}
    {(focused ? [focused, ...rows.filter(row => row.id !== focused.id)] : rows).map(request => <ManagedRequest key={request.id} initial={request} onInspect={onInspect} />)}
    {rows.length >= count && <button type="button" onClick={() => setCount(value => value + 50)} className="ui-button ui-button-secondary">Charger les demandes suivantes</button>}
  </section>;
}
