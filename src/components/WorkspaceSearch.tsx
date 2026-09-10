import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import { Permission, usePermissions } from '../usePermissions';
import { ViewState } from '../types';
export default function WorkspaceSearch({ onNavigate }: { onNavigate: (view: ViewState, params?: Record<string, string>) => void }) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const { hasPermission } = usePermissions();
  if (!hasPermission(Permission.MISSIONS_VIEW)) return null;
  return <form role="search" onSubmit={e => { e.preventDefault(); if (query.trim()) onNavigate('missions', { tab: 'packages', scope: 'all', q: query.trim() }); }} className="flex min-w-0 flex-1 max-w-lg gap-2">
    <label className="sr-only" htmlFor={inputId}>Rechercher un colis, un destinataire ou une adresse</label>
    <input id={inputId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un colis ou un destinataire" className="min-w-0 flex-1 min-h-11 rounded-xl border border-slate-300 px-3 text-sm bg-white"/>
    <button type="submit" className="w-11 min-h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center" aria-label="Rechercher les colis"><Search aria-hidden="true" size={20}/></button>
  </form>;
}
