/**
 * VOIR EN TANT QUE (aperçu de rôle)
 *
 * Permet à un profil privilégié (président / admin / direction) de prévisualiser
 * l'application dans la peau d'un CLIENT, pour voir exactement son portail et sa
 * traçabilité. Rendu dans un overlay isolé, avec sa PROPRE PermissionsProvider
 * (les permissions affichées sont celles du client prévisualisé) et des
 * handlers de mutation neutralisés → aperçu en LECTURE SEULE.
 *
 * Volontairement autonome : n'altère pas le currentUser global de l'app.
 */
import React, { useState, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
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
        className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-lg shadow-sm border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-colors text-sm font-semibold"
      >
        <Eye size={16} />
        <span className="hidden sm:inline">Voir en tant que</span>
      </button>

      {/* Sélecteur de client (portail → au-dessus de la sidebar) */}
      {pickerOpen && !previewClient && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Eye size={18} className="text-indigo-600" /> Voir en tant que client</h3>
              <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un client…"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto mt-2 divide-y divide-slate-100">
              {filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setPreviewClient(c); setPreviewView('client_dashboard'); setPickerOpen(false); }}
                  className="w-full text-left py-2.5 px-1 hover:bg-slate-50 rounded-lg flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Building2 size={16} /></div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{clientLabel(c)}</div>
                    <div className="text-xs text-slate-500 truncate">{c.email}</div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-slate-400 py-8 text-center">Aucun client trouvé</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Overlay d'aperçu (lecture seule) — portail → au-dessus de la sidebar */}
      {previewClient && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-50 flex flex-col">
          <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between shrink-0">
            <span className="font-bold text-sm flex items-center gap-2 min-w-0">
              <Eye size={16} className="shrink-0" />
              <span className="truncate">Tu agis en tant que : {clientLabel(previewClient)} — mode test (actions réelles)</span>
            </span>
            <button
              onClick={() => setPreviewClient(null)}
              className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1 shrink-0"
            >
              <X size={14} /> Revenir président
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 lg:p-8">
            <div className="max-w-7xl mx-auto">
              <Suspense fallback={<div className="p-10 text-center text-slate-400">Chargement de l'aperçu…</div>}>
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
        </div>,
        document.body
      )}
    </>
  );
};

export default ViewAsSwitcher;
