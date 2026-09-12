/**
 * VOIR EN TANT QUE (aperçu de rôle)
 *
 * Permet à un profil privilégié (président / admin / direction) de prévisualiser
 * le portail d’un client, en consultation sans écriture par défaut, et sa
 * traçabilité. Rendu dans un overlay isolé, avec sa PROPRE PermissionsProvider
 * (les permissions affichées sont celles du client prévisualisé).
 * Une intervention réelle exige une activation explicite et un audit de l’acteur authentifié.
 *
 * Volontairement autonome : n'altère pas le currentUser global de l'app.
 */
import React, { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import Modal from './shared/Modal';
import { User, QuoteRequest, ViewState } from '../types';
import { PermissionsProvider } from '../usePermissions';
import { recordClientIntervention } from '../services/clientInterventionService';
import { confirmAction } from '../services/confirmationService';
import { notifyWarning } from '../services/logService';
import { ClientMutationAudit } from '../utils/clientMutation';
import { Eye, Search, Building2, Home, Package, MapPin, BarChart3, BookUser, FileText, HelpCircle, ShieldCheck } from 'lucide-react';

const ClientPortal = lazy(() => import('./ClientPortal'));

const noop = () => {};

interface ViewAsSwitcherProps {
  currentUser: User;
  users: User[];
  quotes: QuoteRequest[];
}

const ViewAsSwitcher: React.FC<ViewAsSwitcherProps> = ({ currentUser, users, quotes }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [previewClient, setPreviewClient] = useState<User | null>(null);
  const [previewView, setPreviewView] = useState<ViewState>('client_dashboard');
  const [interventionSession, setInterventionSession] = useState<string | null>(null);
  const [startingIntervention, setStartingIntervention] = useState(false);
  const [interventionError, setInterventionError] = useState('');
  const audit = useCallback<ClientMutationAudit>(async (action, phase) => {
    if (!previewClient || !interventionSession) throw new Error('Aucune intervention active.');
    await recordClientIntervention(currentUser, previewClient, interventionSession, action, phase);
  }, [currentUser, previewClient, interventionSession]);
  const stopIntervention = () => {
    if (previewClient && interventionSession) void recordClientIntervention(currentUser, previewClient, interventionSession, 'Fin de l’intervention', 'confirmed').catch(() => notifyWarning('L’intervention est terminée, mais sa clôture n’a pas pu être journalisée. Les intentions déjà enregistrées sont conservées.'));
    setInterventionSession(null);
    setInterventionError('');
  };
  const closePreview = () => { if (startingIntervention) return; stopIntervention(); setPreviewClient(null); };
  const startIntervention = async () => {
    if (!previewClient || startingIntervention) return;
    setStartingIntervention(true); setInterventionError('');
    try {
      const confirmed = await confirmAction({ title: 'Intervenir pour ce client ?', message: `Vous agissez sous votre identité (${currentUser.firstName} ${currentUser.lastName}) pour ${previewClient.companyName || previewClient.email}. Les expéditions, destinataires et informations entreprise modifiés seront réels. Chaque demande de modification sera journalisée ; les permissions habituelles restent appliquées.`, confirmLabel: 'Activer l’intervention', cancelLabel: 'Rester en consultation' });
      if (!confirmed) return;
      const sessionId = crypto.randomUUID();
      await recordClientIntervention(currentUser, previewClient, sessionId, 'Début de l’intervention', 'confirmed');
      setInterventionSession(sessionId);
    } catch {
      setInterventionError('L’intervention n’a pas pu être journalisée. Vous restez en consultation ; vérifiez votre connexion puis réessayez.');
    } finally { setStartingIntervention(false); }
  };

  const clients = useMemo(
    () => users.filter(u => String(u.role || '').toLowerCase().includes('client'))
              .sort((a, b) => (a.companyName || a.firstName || '').localeCompare(b.companyName || b.firstName || '')),
    [users]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      (c.companyName || '').toLowerCase().includes(q) ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }, [clients, search]);

  const previewQuotes = useMemo(
    () => previewClient
      ? quotes.filter(q => (q as any).clientId === previewClient.id || (Boolean(previewClient.companyName) && q.clientName === previewClient.companyName))
      : [],
    [quotes, previewClient]
  );

  const clientLabel = (c: User) => c.companyName || `${c.firstName} ${c.lastName}`.trim() || c.email;

  return (
    <>
      {/* Déclencheur */}
      <button
        onClick={() => setPickerOpen(true)}
        title="Voir en tant que client"
        aria-label="Ouvrir l’aperçu d’un client"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen || !!previewClient}
        className="ui-button ui-button-secondary min-h-11 min-w-11 flex items-center justify-center gap-1.5 border text-sm"
      >
        <Eye size={16} />
        <span className="hidden sm:inline">Voir en tant que</span>
      </button>

      {/* Sélecteur de client : focus, fond inerte et retour au déclencheur partagés. */}
      <Modal mobileFullscreen isOpen={pickerOpen && !previewClient} onClose={() => setPickerOpen(false)} title="Voir en tant que client" headerIcon={<Eye size={20} />} size="lg">
        <label htmlFor="view-as-client-search" className="block text-sm font-semibold text-slate-700 mb-2">Rechercher un client</label>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input id="view-as-client-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Entreprise, nom ou email" className="w-full min-h-11 pl-10 pr-3 py-3 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-600 outline-none" autoComplete="off" data-autofocus />
        </div>
        <p role="status" className="my-3 text-sm text-slate-600">{filtered.length} client{filtered.length > 1 ? 's' : ''} disponible{filtered.length > 1 ? 's' : ''}</p>
        <ul className="divide-y divide-slate-100">
          {filtered.map(client => <li key={client.id}><button type="button" onClick={() => { setInterventionSession(null); setInterventionError(''); setPreviewClient(client); setPreviewView('client_dashboard'); setPickerOpen(false); }} className="ui-button ui-button-ghost w-full min-h-12 text-left flex items-center gap-3" aria-label={`Ouvrir l’aperçu de ${clientLabel(client)}`}>
            <Building2 size={20} aria-hidden="true" className="text-brand-700 shrink-0" />
            <span className="min-w-0"><span className="block font-semibold text-base text-slate-900 break-words">{clientLabel(client)}</span><span className="block text-sm text-slate-600 break-all">{client.email}</span></span>
          </button></li>)}
        </ul>
        {filtered.length === 0 && <p className="text-sm text-slate-600 py-6 text-center">{clients.length ? 'Aucun client ne correspond. Essayez un autre nom ou email.' : 'Aucun compte client disponible pour cet aperçu.'}</p>}
      </Modal>

      {/* Overlay d'aperçu (lecture seule) — portail → au-dessus de la sidebar */}
      {previewClient && (
        <Modal mobileFullscreen isOpen onClose={closePreview} preventClose={startingIntervention} title={interventionSession ? 'Intervention client' : 'Consultation client'} subtitle={`Client : ${clientLabel(previewClient)} · Intervenant : ${currentUser.firstName} ${currentUser.lastName}`} size="full" closeOnOverlay={false} bodyClassName="!p-0 bg-slate-50">
        <div className="min-w-0 bg-slate-50 flex flex-col">
          <div className={`px-3 py-3 flex flex-wrap items-center justify-between gap-2 border-b ${interventionSession ? 'bg-amber-50 border-amber-200 text-amber-950' : 'bg-white border-slate-200 text-slate-700'}`}>
            <p className="font-semibold text-sm flex items-center gap-2">{interventionSession ? <ShieldCheck size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}{interventionSession ? 'Intervention réelle active' : 'Consultation en lecture seule'}</p>
            {interventionSession ? <button type="button" onClick={stopIntervention} className="ui-button ui-button-secondary">Terminer l’intervention</button> : <button type="button" disabled={startingIntervention} onClick={() => void startIntervention()} className="ui-button ui-button-secondary">{startingIntervention ? 'Activation en cours…' : 'Intervenir pour ce client'}</button>}
            <details className="text-sm open:w-full"><summary className="cursor-pointer min-h-11 py-3">Identités</summary><div className="space-y-1 break-words pb-2"><p>Intervenant : {currentUser.firstName} {currentUser.lastName} · {currentUser.email}</p><p>Client : {clientLabel(previewClient)} · {previewClient.email}</p><p>{interventionSession ? 'Les modifications autorisées sont réelles et journalisées sous votre identité.' : 'Les modifications sont désactivées. L’intervention nécessite une activation explicite.'}</p></div></details>
          </div>
          {interventionError && <p role="alert" className="m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{interventionError}</p>}
          {/* Barre de navigation de l'aperçu (le portail n'a pas la sidebar) */}
          <nav aria-label="Navigation de l’aperçu client" className="bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto shrink-0">
            {([
              { v: 'client_dashboard', label: 'Accueil', icon: Home },
              { v: 'client_shipments', label: 'Mes colis', icon: Package },
              { v: 'client_tracking', label: 'Suivi des livraisons', icon: MapPin },
              { v: 'client_analytics', label: 'Statistiques', icon: BarChart3 },
              { v: 'client_recipients', label: 'Destinataires', icon: BookUser },
              { v: 'client_company', label: 'Mon entreprise', icon: Building2 },
              { v: 'client_list', label: 'Mes devis', icon: FileText },
              { v: 'client_help', label: 'Aide', icon: HelpCircle },
            ] as const).map(tab => <button type="button" key={tab.v} onClick={() => setPreviewView(tab.v)} aria-current={previewView === tab.v ? 'page' : undefined} className="ui-filter whitespace-nowrap shrink-0"><tab.icon size={18} aria-hidden="true" />{tab.label}</button>)}
          </nav>
          <div className="min-w-0 flex-1 p-3 sm:p-5">
            <div className="max-w-7xl mx-auto">
              <Suspense fallback={<div role="status" className="p-10 text-center text-slate-600">Chargement de l'aperçu…</div>}>
                <PermissionsProvider currentUser={previewClient}>
                  <ClientPortal
                    activeView={previewView}
                    currentUser={previewClient}
                    quotes={previewQuotes}
                    companyUsers={users.filter(user => (user.id === previewClient.id || (Boolean(previewClient.companyName) && user.companyName === previewClient.companyName)) && String(user.role).toLowerCase().includes('client'))}
                    onNavigate={(v) => setPreviewView(v)}
                    onAddQuote={noop}
                    onUpdateQuoteStatus={noop}
                    previewMode
                    interventionAudit={interventionSession ? audit : undefined}
                    interventionActorLabel={`${currentUser.firstName} ${currentUser.lastName}`}
                  />
                </PermissionsProvider>
              </Suspense>
            </div>
          </div>
        </div>
        </Modal>
      )}
    </>
  );
};

export default ViewAsSwitcher;
