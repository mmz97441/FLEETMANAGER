/**
 * VOIR EN TANT QUE (aperçu de rôle)
 *
 * Permet à un profil privilégié (président / admin / direction) de prévisualiser
 * l'application dans la peau d'un CLIENT, pour voir exactement son portail et sa
 * traçabilité. Rendu dans un overlay isolé, avec sa PROPRE PermissionsProvider
 * (les permissions affichées sont celles du client prévisualisé) et des
 * Les callbacks de devis sont neutralisés ; les actions du portail qui passent
 * directement par les services conservent leur comportement réel et l’annoncent.
 *
 * Volontairement autonome : n'altère pas le currentUser global de l'app.
 */
import React, { useState, useMemo, lazy, Suspense } from 'react';
import Modal from './shared/Modal';
import { User, QuoteRequest, ViewState } from '../types';
import { PermissionsProvider } from '../usePermissions';
import { Eye, X, Search, Building2 } from 'lucide-react';

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
      ? quotes.filter(q => (q as any).clientId === previewClient.id || (q.clientName || '') === (previewClient.companyName || ''))
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
        className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-colors text-sm font-semibold"
      >
        <Eye size={16} />
        <span className="hidden sm:inline">Voir en tant que</span>
      </button>

      {/* Sélecteur de client : focus, fond inerte et retour au déclencheur partagés. */}
      <Modal isOpen={pickerOpen && !previewClient} onClose={() => setPickerOpen(false)} title="Voir en tant que client" headerIcon={<Eye size={20} />} size="lg">
        <label htmlFor="view-as-client-search" className="block text-sm font-semibold text-slate-700 mb-2">Rechercher un client</label>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input id="view-as-client-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Entreprise, nom ou email" className="w-full min-h-11 pl-10 pr-3 py-3 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-indigo-600 outline-none" autoComplete="off" data-autofocus />
        </div>
        <p role="status" className="my-3 text-sm text-slate-600">{filtered.length} client{filtered.length > 1 ? 's' : ''} disponible{filtered.length > 1 ? 's' : ''}</p>
        <ul className="divide-y divide-slate-100">
          {filtered.map(client => <li key={client.id}><button type="button" onClick={() => { setPreviewClient(client); setPreviewView('client_dashboard'); setPickerOpen(false); }} className="w-full min-h-12 text-left p-3 hover:bg-slate-50 rounded-xl flex items-center gap-3" aria-label={`Ouvrir l’aperçu de ${clientLabel(client)}`}>
            <Building2 size={20} aria-hidden="true" className="text-indigo-700 shrink-0" />
            <span className="min-w-0"><span className="block font-semibold text-base text-slate-900 break-words">{clientLabel(client)}</span><span className="block text-sm text-slate-600 break-all">{client.email}</span></span>
          </button></li>)}
        </ul>
        {filtered.length === 0 && <p className="text-sm text-slate-600 py-6 text-center">{clients.length ? 'Aucun client ne correspond. Essayez un autre nom ou email.' : 'Aucun compte client disponible pour cet aperçu.'}</p>}
      </Modal>

      {/* Overlay d'aperçu (lecture seule) — portail → au-dessus de la sidebar */}
      {previewClient && (
        <Modal isOpen onClose={() => setPreviewClient(null)} title={`Aperçu de ${clientLabel(previewClient)}`} size="full" closeOnOverlay={false} bodyClassName="!p-0 bg-slate-50">
        <div className="min-w-0 bg-slate-50 flex flex-col">
          <div className="bg-amber-100 text-amber-950 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <span className="font-bold text-sm flex items-center gap-2 min-w-0">
              <Eye size={16} className="shrink-0" />
              <span>Les actions disponibles dans cet aperçu peuvent modifier les données réelles du client.</span>
            </span>
            <button
              onClick={() => setPreviewClient(null)}
              className="min-h-11 bg-white hover:bg-amber-50 border border-amber-300 px-3 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-1 shrink-0"
            >
              <X size={18} /> Fermer l’aperçu
            </button>
          </div>
          {/* Barre de navigation de l'aperçu (le portail n'a pas la sidebar) */}
          <nav aria-label="Navigation de l’aperçu client" className="bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1 overflow-x-auto shrink-0">
            {([
              { v: 'client_dashboard', label: '🏠 Accueil' },
              { v: 'client_shipments', label: '📦 Mes Colis' },
              { v: 'client_tracking', label: '📍 Suivi live' },
              { v: 'client_analytics', label: '📊 Statistiques' },
              { v: 'client_recipients', label: '📇 Destinataires' },
              { v: 'client_company', label: '🏢 Mon Entreprise' },
              { v: 'client_list', label: '📄 Mes Devis' },
              { v: 'client_help', label: '❓ Aide' },
            ] as { v: ViewState; label: string }[]).map(t => (
              <button
                key={t.v}
                onClick={() => setPreviewView(t.v)}
                aria-current={previewView === t.v ? 'page' : undefined}
                className={`min-h-11 px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${previewView === t.v ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 p-4 lg:p-8">
            <div className="max-w-7xl mx-auto">
              <Suspense fallback={<div role="status" className="p-10 text-center text-slate-600">Chargement de l'aperçu…</div>}>
                <PermissionsProvider currentUser={previewClient}>
                  <ClientPortal
                    activeView={previewView}
                    currentUser={previewClient}
                    quotes={previewQuotes}
                    companyUsers={[]}
                    onNavigate={(v) => setPreviewView(v)}
                    onAddQuote={noop}
                    onUpdateQuoteStatus={noop}
                    previewMode
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
