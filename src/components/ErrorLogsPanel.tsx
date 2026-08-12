/**
 * PANNEAU JOURNAL D'ERREURS (admin)
 *
 * Affiche le contenu de la collection Firestore `error_logs` en temps réel :
 * toutes les erreurs captées dans l'app (services, composants, window, rendu),
 * avec qui / où / quand / message / stack. Permet à la direction de savoir
 * exactement ce qui a bloqué un chauffeur, un client, etc.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, XCircle, ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { subscribeToErrorLogs, getLocalErrorLogs, ErrorLogRecord } from '../services/logService';

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
};

const ErrorLogsPanel: React.FC = () => {
  const [logs, setLogs] = useState<ErrorLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToErrorLogs(
      next => { setLogs(next); setReadError(null); setIsLoading(false); },
      200,
      err => {
        const msg = err instanceof Error ? err.message : String(err);
        setReadError(
          /permission|insufficient/i.test(msg)
            ? "Accès refusé : ton rôle n'a pas le droit de lire le journal d'erreurs (réservé à la direction)."
            : `Lecture du journal impossible : ${msg}`
        );
        setIsLoading(false);
      }
    );
    return unsub;
  }, []);

  // Erreurs bufferisées localement (non encore envoyées à Firestore)
  const localCount = useMemo(() => getLocalErrorLogs().length, [logs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logs.filter(l => {
      if (levelFilter !== 'all' && l.level !== levelFilter) return false;
      if (!term) return true;
      return (
        l.message.toLowerCase().includes(term) ||
        l.context.toLowerCase().includes(term) ||
        (l.userName || '').toLowerCase().includes(term) ||
        (l.userRole || '').toLowerCase().includes(term)
      );
    });
  }, [logs, search, levelFilter]);

  const stats = useMemo(() => ({
    total: logs.length,
    errors: logs.filter(l => l.level === 'error').length,
    warnings: logs.filter(l => l.level === 'warning').length,
    last24h: logs.filter(l => Date.now() - new Date(l.createdAt).getTime() < 86400000).length,
  }), [logs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <RefreshCw className="animate-spin mr-2" size={18} /> Chargement du journal d'erreurs…
      </div>
    );
  }

  if (readError) {
    return (
      <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-center">
        <XCircle className="mx-auto text-red-500 mb-2" size={28} />
        <p className="text-sm font-bold text-red-700">Journal d'erreurs indisponible</p>
        <p className="text-xs text-red-600 mt-1">{readError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-2xl font-black text-slate-800">{stats.total}</p>
          <p className="text-xs text-slate-500">erreurs enregistrées</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-2xl font-black text-red-600">{stats.errors}</p>
          <p className="text-xs text-slate-500">erreurs</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-2xl font-black text-amber-600">{stats.warnings}</p>
          <p className="text-xs text-slate-500">avertissements</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-2xl font-black text-slate-800">{stats.last24h}</p>
          <p className="text-xs text-slate-500">dernières 24 h</p>
        </div>
      </div>

      {localCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm text-amber-800">
          {localCount} erreur(s) en attente d'envoi (stockées localement, hors-ligne). Elles seront synchronisées à la prochaine connexion.
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher (message, contexte, utilisateur, rôle)…"
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {(['all', 'error', 'warning'] as const).map(lv => (
          <button
            key={lv}
            onClick={() => setLevelFilter(lv)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
              levelFilter === lv ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            {lv === 'all' ? 'Tous' : lv === 'error' ? 'Erreurs' : 'Avertissements'}
          </button>
        ))}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Aucune erreur {search || levelFilter !== 'all' ? 'pour ce filtre' : "— tout va bien 🎉"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(log => {
            const open = expanded === log.id;
            return (
              <div key={log.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : log.id)}
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="mt-0.5 flex-shrink-0">
                    {log.level === 'warning'
                      ? <AlertTriangle size={16} className="text-amber-500" />
                      : <XCircle size={16} className="text-red-500" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">{log.context}</span>
                      <span className="text-xs text-slate-400">{timeAgo(log.createdAt)}</span>
                      {log.userName && (
                        <span className="text-xs text-slate-500">
                          · {log.userName}{log.userRole ? ` (${log.userRole})` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-800 mt-0.5 break-words">{log.message}</p>
                  </div>
                  {open ? <ChevronDown size={16} className="text-slate-400 mt-1" /> : <ChevronRight size={16} className="text-slate-400 mt-1" />}
                </button>

                {open && (
                  <div className="border-t border-slate-100 bg-slate-50 p-3 space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <Info label="Date" value={new Date(log.createdAt).toLocaleString('fr-FR')} />
                      <Info label="Version" value={log.appVersion || '—'} />
                      <Info label="Utilisateur" value={log.userName || 'Non connecté'} />
                      <Info label="Rôle" value={log.userRole || '—'} />
                    </div>
                    {log.url && <Info label="Page" value={log.url} mono />}
                    {log.extra && Object.keys(log.extra).length > 0 && (
                      <div>
                        <p className="font-bold text-slate-500 mb-1">Détails</p>
                        <pre className="bg-white border border-slate-200 rounded-lg p-2 overflow-x-auto text-[11px] text-slate-700 whitespace-pre-wrap break-words">
                          {JSON.stringify(log.extra, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.stack && (
                      <div>
                        <p className="font-bold text-slate-500 mb-1">Stack technique</p>
                        <pre className="bg-white border border-slate-200 rounded-lg p-2 overflow-x-auto text-[11px] text-slate-600 whitespace-pre-wrap break-words max-h-56">
                          {log.stack}
                        </pre>
                      </div>
                    )}
                    {log.userAgent && <Info label="Appareil" value={log.userAgent} mono />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Info: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="min-w-0">
    <span className="font-bold text-slate-500">{label} : </span>
    <span className={`text-slate-700 break-words ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);

export default ErrorLogsPanel;
