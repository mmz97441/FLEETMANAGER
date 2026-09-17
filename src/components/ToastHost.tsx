/**
 * TOAST HOST — affichage global des messages utilisateur.
 *
 * - S'abonne à logService.onUserMessage → tout `reportError` / `notify*`
 *   déclenché n'importe où dans l'app (services compris) apparaît ici.
 * - Installe les gardes globales window 'error' + 'unhandledrejection' →
 *   plus aucune erreur JS non catchée ne passe sous silence.
 *
 * À monter une seule fois, au sommet de l'app (dans App).
 */

import React, { useEffect, useState, useCallback, useSyncExternalStore, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getTopDialogNode, subscribeDialogLayers } from '../hooks/useDialogLayer';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { onUserMessage, reportError, flushLocalErrorLogs, LogLevel } from '../services/logService';
import { installRuntimeDiagnostics } from '../utils/runtimeDiagnostics';
import { appendToast, toastKey, type VisibleToast } from '../utils/toastQueue';

const STYLES: Record<LogLevel, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  success: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: <CheckCircle2 size={18} className="text-green-600" /> },
  error:   { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-800',   icon: <XCircle size={18} className="text-red-600" /> },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: <AlertTriangle size={18} className="text-amber-600" /> },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-800',  icon: <Info size={18} className="text-blue-600" /> },
};

const ToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<VisibleToast[]>([]);
  const muted = useRef(new Map<string, number>());
  const activeDialog = useSyncExternalStore(subscribeDialogLayers, getTopDialogNode, () => null);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => {
      const toast = prev.find(t => t.id === id);
      if (toast?.group === 'runtime') muted.current.set(toastKey(toast), Date.now() + 60000);
      return prev.filter(t => t.id !== id);
    });
  }, []);

  // Abonnement aux messages émis partout dans l'app
  useEffect(() => {
    const unsub = onUserMessage(msg => {
      for (const [key, until] of muted.current) if (until <= Date.now()) muted.current.delete(key);
      if (msg.group === 'runtime' && muted.current.has(toastKey(msg))) return;
      setToasts(prev => appendToast(prev, msg));
      if (msg.durationMs > 0 && msg.level !== 'error' && msg.level !== 'warning') {
        window.setTimeout(() => dismiss(msg.id), msg.durationMs);
      }
    });
    return unsub;
  }, [dismiss]);

  useEffect(() => installRuntimeDiagnostics(reportError, flushLocalErrorLogs), []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div aria-label="Messages de l’application" className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none">
      {toasts.map(t => {
        const s = STYLES[t.level];
        return (
          <div
            key={t.id}
            role={t.level === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${s.bg} ${s.border} p-3 shadow-lg animate-[fadeIn_0.15s_ease-out]`}
          >
            <span className="mt-0.5 flex-shrink-0">{s.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${s.text} break-words`}>{t.message}</p>
              {t.occurrences > 1 && <p className="text-xs mt-1">{t.occurrences} occurrences enregistrées</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className={`flex-shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-lg ${s.text} hover:bg-white transition-colors`}
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>,
    activeDialog || document.body
  );
};

export default ToastHost;
