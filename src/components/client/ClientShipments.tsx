import React, { useMemo, useState } from 'react';
import { Calendar, ChevronDown, ChevronUp, Clock, Eye, FileSpreadsheet, FileText, Plus, Printer, Search, UserPlus } from 'lucide-react';
import { Package, PackageStatus, ProofOfDelivery } from '../../types';
import { ParcelCoverage } from '../../services/parcelFeed';
import { getPackageProofs } from '../../services/podService';
import { hasPendingDeliveryProof } from '../../utils/deliveryProofState';
import { clientGroupSummary, clientParcelGroups, clientParcelStatus, clientParcelTone, clientShipmentDayLabel, matchesClientParcel, type ClientParcelFilter } from '../../utils/clientParcelView';
import PageHeader from '../shared/PageHeader';
import PackageTimeline from '../PackageTimeline';
import ShipmentReference from './ShipmentReference';

interface Props {
  parcels: Package[];
  coverage: ParcelCoverage | null;
  loading: boolean;
  error: string;
  readOnly: boolean;
  search: string;
  filter: ClientParcelFilter;
  expandedId: string;
  printError: string;
  onSearch(value: string): void;
  onFilter(value: ClientParcelFilter): void;
  onExpand(id: string | null): void;
  onClear(): void;
  onCreate(): void;
  onImportRecipients(): void;
  onImportShipments(): void;
  onPrint(parcels: Package[]): void;
  onDeliveryNote(parcel: Package): void;
  onProof(parcel: Package, proof: ProofOfDelivery): void;
  onRequest(parcel: Package): void;
  onLoadMore(): void;
  onRefresh(): void;
}

const filters: Array<{ value: ClientParcelFilter; label: string }> = [
  { value: 'all', label: 'Tous' }, { value: 'attention', label: 'À traiter' }, { value: 'pending', label: 'En attente' },
  { value: 'transit', label: 'En cours' }, { value: 'delivered', label: 'Livrés' }, { value: 'failed', label: 'Échecs / retours' },
];
const dateLabel = (value: string) => {
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00+04:00`))
    ? new Date(`${day}T12:00:00+04:00`).toLocaleDateString('fr-FR', { timeZone: 'Indian/Reunion' }) : 'Date à vérifier';
};

/** All cartons remain visible within a matching recipient, including partial
 * deliveries. Opening a timeline changes only the expanded parcel. */
export default function ClientShipments(props: Props) {
  const { parcels, coverage, loading, error, readOnly, search, filter, expandedId } = props;
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const groups = useMemo(() => clientParcelGroups(parcels, filter, search, expandedId), [parcels, filter, search, expandedId]);
  const pending = parcels.filter(parcel => parcel.status === PackageStatus.PENDING);
  const allHistory = Boolean(coverage?.historyComplete);
  const historyPending = Boolean(coverage?.historyLoading);
  const linked = parcels.find(parcel => parcel.id === expandedId);
  const extraLinkedGroup = Boolean(linked && !matchesClientParcel(linked, filter, search));
  const days = [...new Set(groups.map(group => group.day))];
  const shown = groups.reduce((count, group) => count + group.packages.length, 0);
  const count = (value: ClientParcelFilter) => loading || error ? '—' : parcels.filter(parcel => matchesClientParcel(parcel, value)).length;
  const toggleGroup = (id: string, open: boolean, containsExpanded: boolean) => {
    if (open && containsExpanded) props.onExpand(null);
    setExpandedGroups(previous => { const next = new Set(previous); open ? next.delete(id) : next.add(id); return next; });
  };

  return <div className="space-y-4 animate-fade-in">
    <PageHeader title="Mes expéditions" description={loading ? 'Chargement de vos colis…' : error ? 'Les informations affichées peuvent être incomplètes' : `${parcels.length} colis chargés${allHistory ? ' — historique confirmé' : ' — historique en cours de vérification'}`} actions={
      <button type="button" disabled={readOnly} onClick={props.onCreate} className="ui-button ui-button-primary"><Plus size={18} aria-hidden="true" />Créer une expédition</button>
    } />
    <div className="space-y-3" aria-label="Rechercher et filtrer mes colis">
      <div className="relative">
        <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
        <input type="search" aria-label="Rechercher dans mes colis" value={search} onChange={event => props.onSearch(event.target.value)} placeholder="Référence, destinataire ou adresse" className="w-full min-h-11 pl-10 pr-3 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-700 outline-none" />
      </div>
      <label className="flex items-center gap-3 text-sm font-semibold text-slate-700 sm:hidden">Statut<select aria-label="Filtrer mes colis par statut" value={filter} disabled={loading} onChange={event => props.onFilter(event.target.value as ClientParcelFilter)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 bg-white text-base">{filters.map(item => <option key={item.value} value={item.value}>{item.label} ({count(item.value)})</option>)}</select></label>
      <div className="hidden sm:flex flex-wrap items-center gap-2" role="group" aria-label="Filtrer par statut"><span className="text-sm font-semibold text-slate-700 mr-1">Statut</span>{filters.map(item => <button type="button" key={item.value} disabled={loading} aria-pressed={filter === item.value} onClick={() => props.onFilter(item.value)} className="ui-filter">{item.label} <span>({count(item.value)})</span></button>)}</div>
      <p className="text-sm text-slate-600">Chaque résultat conserve les colis chargés du destinataire pour ce jour d’envoi.</p>
      <details className="text-sm text-slate-700">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">Imports et étiquettes</summary>
        <div className="flex flex-wrap gap-2 py-2">
          <button type="button" disabled={readOnly} onClick={props.onImportRecipients} className="ui-button ui-button-secondary"><UserPlus size={18} aria-hidden="true" />Importer des destinataires</button>
          <button type="button" disabled={readOnly} onClick={props.onImportShipments} className="ui-button ui-button-secondary"><FileSpreadsheet size={18} aria-hidden="true" />Importer des expéditions</button>
          <button type="button" disabled={loading || Boolean(error) || !pending.length} onClick={() => props.onPrint(pending)} className="ui-button ui-button-secondary"><Printer size={18} aria-hidden="true" />Étiquettes en attente ({pending.length})</button>
        </div>
      </details>
    </div>

    {!loading && !allHistory && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 space-y-2">
      <p>{coverage?.fromCache ? 'Ces données proviennent de cet appareil. Reconnectez-vous pour confirmer leur actualisation.' : historyPending ? 'Chargement de l’historique… Les colis déjà disponibles restent visibles.' : 'L’historique se charge par pages. Les compteurs portent sur les colis chargés.'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={historyPending} onClick={props.onLoadMore} className="ui-button ui-button-secondary">Charger la suite de l’historique</button>
        <button type="button" disabled={historyPending} onClick={props.onRefresh} className="ui-button ui-button-secondary">Actualiser tout l’historique</button>
      </div>
    </div>}
    {allHistory && <button type="button" disabled={historyPending} onClick={props.onRefresh} className="ui-button ui-button-ghost">Actualiser mes colis</button>}
    {props.printError && <p role="alert" className="ui-notice ui-notice-danger">{props.printError}</p>}
    {expandedId && (!linked || extraLinkedGroup) && <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-brand-900 space-y-2">
      <p>{linked ? 'Le destinataire du colis demandé reste affiché en complément de vos filtres.' : loading || historyPending || !allHistory ? 'Recherche du colis demandé dans l’historique…' : 'Ce colis est indisponible dans votre compte ou n’existe plus.'}</p>
      <button type="button" onClick={props.onClear} className="ui-button ui-button-ghost">Afficher tous mes colis</button>
    </div>}

    <div className="ui-panel overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 text-sm text-slate-600">Colis regroupés par destinataire</div>
      <div className="divide-y divide-slate-200">
        {days.map(day => {
          const dayGroups = groups.filter(group => group.day === day);
          return <React.Fragment key={day}>
            <div className="px-4 py-3 bg-slate-50 flex flex-wrap items-center justify-between gap-1">
              <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Calendar size={16} aria-hidden="true" />{clientShipmentDayLabel(day)}</p>
              <span className="text-sm text-slate-600">{dayGroups.reduce((total, group) => total + group.packages.length, 0)} colis · {dayGroups.length} destinataire{dayGroups.length > 1 ? 's' : ''}</span>
            </div>
            {dayGroups.map(group => {
              const pkgs = group.packages, rep = pkgs[0], containsExpanded = pkgs.some(parcel => parcel.id === expandedId);
              const open = expandedGroups.has(group.id) || containsExpanded;
              const summary = clientGroupSummary(pkgs);
              if (!allHistory && summary.tone === 'success') { summary.tone = 'info'; summary.label = `${pkgs.length} livré${pkgs.length > 1 ? 's' : ''} · historique partiel`; summary.detail = 'Les autres colis éventuels seront confirmés après chargement complet de l’historique.'; }
              const eta = pkgs.find(parcel => parcel.status === PackageStatus.IN_DELIVERY && parcel.estimatedDeliveryAt)?.estimatedDeliveryAt;
              return <React.Fragment key={group.id}>
                <div data-client-shipment-group className="p-4 space-y-3 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-base font-semibold text-slate-900 break-words">{rep.contactName || 'Destinataire à préciser'}</p>
                    <p className="text-sm text-slate-600 break-words">{rep.address} · {rep.postalCode} {rep.city}{rep.floor != null ? ` · Étage ${rep.floor}` : ''}</p>
                    <p className="flex flex-wrap items-center gap-2 pt-1 text-sm"><span className={`inline-flex rounded-md px-2 py-1 font-semibold ${clientParcelTone[summary.tone]}`} title={summary.detail}>{summary.label}</span><span className="text-slate-600">{pkgs.length} colis{!allHistory ? ' chargés' : ''}</span></p>
                    {eta && Number.isFinite(Date.parse(eta)) && <p className="text-sm text-slate-700 flex items-start gap-2 pt-1"><Clock size={16} aria-hidden="true" className="shrink-0 mt-0.5" />Estimation d’arrivée {new Date(eta).toLocaleString('fr-FR', { timeZone: 'Indian/Reunion', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (heure Réunion)</p>}
                  </div>
                  <button type="button" aria-label={open ? 'Masquer les colis du destinataire' : 'Afficher les colis du destinataire'} aria-expanded={open} onClick={() => toggleGroup(group.id, open, containsExpanded)} className="ui-button ui-button-secondary shrink-0">{open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}{open ? 'Masquer les colis' : 'Voir les colis'}</button>
                </div>
                {open && <div className="border-t border-slate-200 divide-y divide-slate-200">
                  <div className="px-4 py-3 flex flex-wrap gap-2 bg-slate-50">
                    <button type="button" aria-label="Imprimer les étiquettes du destinataire" onClick={() => props.onPrint(pkgs)} className="ui-button ui-button-secondary"><Printer size={18} aria-hidden="true" />Étiquettes du destinataire</button>
                    <button type="button" disabled={!allHistory} title={!allHistory ? 'Actualisez tout l’historique pour préparer un bon complet.' : undefined} aria-label="Ouvrir le bon de livraison du destinataire" onClick={() => props.onDeliveryNote(rep)} className="ui-button ui-button-secondary"><FileText size={18} aria-hidden="true" />Bon de livraison</button>
                  </div>
                  {pkgs.map(pkg => {
                    const state = clientParcelStatus(pkg), timelineOpen = expandedId === pkg.id;
                    return <div key={pkg.id} className="p-4 space-y-3" data-client-parcel={pkg.id}>
                      <div className="space-y-3 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
                        <div className="min-w-0 flex-1 space-y-2">
                          <p><span className={`inline-flex px-2 py-1 rounded-md text-sm font-semibold ${clientParcelTone[state.tone]}`} title={state.detail}>{state.label}</span></p>
                          {state.tone === 'warning' && <p className="text-sm text-amber-950">{state.detail}</p>}
                          <ShipmentReference reference={pkg.externalId || pkg.barcode || pkg.orderNumber || pkg.id} />
                          <p className="text-sm text-slate-600 break-words">Commande : {pkg.orderNumber || 'Non renseignée'}{pkg.clientReference ? ` · Votre référence : ${pkg.clientReference}` : ''}</p>
                          {pkg.requestedDeliveryDate && pkg.status !== PackageStatus.DELIVERED && <p className="text-sm text-slate-700">Livraison souhaitée : {dateLabel(pkg.requestedDeliveryDate)}{pkg.requestedDeliveryTime ? ` à ${pkg.requestedDeliveryTime}` : ''}{pkg.timeWindowStart || pkg.timeWindowEnd ? ` · Créneau ${pkg.timeWindowStart || 'début de journée'} – ${pkg.timeWindowEnd || 'fin de journée'}` : ''} (Réunion)</p>}
                        </div>
                        <div className="flex flex-wrap gap-2 sm:max-w-64 sm:justify-end">
                          <button type="button" aria-label={timelineOpen ? 'Masquer le suivi du colis' : 'Afficher le suivi du colis'} aria-expanded={timelineOpen} onClick={() => { setExpandedGroups(previous => new Set(previous).add(group.id)); props.onExpand(timelineOpen ? null : pkg.id); }} className="ui-button ui-button-secondary">{timelineOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}{timelineOpen ? 'Masquer le suivi' : 'Voir le suivi'}</button>
                          <button type="button" aria-label={`Imprimer l’étiquette du colis ${pkg.externalId || pkg.orderNumber}`} onClick={() => props.onPrint([pkg])} className="ui-button ui-button-ghost"><Printer size={18} aria-hidden="true" />Étiquette</button>
                          {getPackageProofs(pkg).map(proof => <button key={`${proof.missionId}_${proof.stopId}`} type="button" onClick={() => props.onProof(pkg, proof)} className="ui-button ui-button-ghost"><Eye size={18} aria-hidden="true" />{proof.type === 'FAILURE' ? 'Preuve d’échec' : 'Preuve de livraison'}</button>)}
                          <button type="button" disabled={readOnly} onClick={() => props.onRequest(pkg)} className="ui-button ui-button-secondary">Contacter l’exploitation</button>
                        </div>
                      </div>
                      {timelineOpen && <div className="mt-2"><PackageTimeline movements={pkg.movements || []} showActors pod={pkg.pod} proofs={getPackageProofs(pkg)} returnDisposition={pkg.returnDisposition} returnDecision={pkg.returnDecision} proofPending={hasPendingDeliveryProof(pkg)} /></div>}
                    </div>;
                  })}
                </div>}
              </React.Fragment>;
            })}
          </React.Fragment>;
        })}
        {loading && !groups.length && <p role="status" className="text-center p-8 text-slate-700">Chargement de vos expéditions…</p>}
        {!loading && !error && !groups.length && <div className="text-center p-8 space-y-3">
          <p role="status" className="font-semibold text-slate-700">{historyPending ? 'Recherche dans l’historique…' : search || filter !== 'all' ? 'Aucun colis ne correspond à ces filtres dans les données chargées' : allHistory ? 'Vous n’avez pas encore de colis' : 'Aucun colis dans les données chargées'}</p>
          {(search || filter !== 'all') && <button type="button" onClick={props.onClear} className="ui-button ui-button-secondary">Effacer les filtres</button>}
          {!search && filter === 'all' && allHistory && <button type="button" disabled={readOnly} onClick={props.onCreate} className="ui-button ui-button-primary"><Plus size={16} aria-hidden="true" />Créer une expédition</button>}
        </div>}
      </div>
      {shown > 0 && <p className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-sm text-slate-600">{shown} colis affiché{shown > 1 ? 's' : ''} dans {groups.length} groupe{groups.length > 1 ? 's' : ''}</p>}
    </div>
  </div>;
}
