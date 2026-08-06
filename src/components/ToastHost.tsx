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

import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { onUserMessage, reportError, UserMessage, LogLevel } from '../services/logService';

const STYLES: Record<LogLevel, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  success: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: <CheckCircle2 size={18} className="text-green-600" /> },
  error:   { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-800',   icon: <XCircle size={18} className="text-red-600" /> },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: <AlertTriangle size={18} className="text-amber-600" /> },
  info:    { bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-800',  icon: <Info size={18} className="text-blue-600" /> },
};

const ToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<UserMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Abonnement aux messages émis partout dans l'app
  useEffect(() => {
    const unsub = onUserMessage(msg => {
      setToasts(prev => {
        // évite d'empiler 2 fois le même message d'affilée
        if (prev.some(t => t.message === msg.message && t.level === msg.level)) return prev;
        // garde au plus 4 toasts visibles
        return [...prev.slice(-3), msg];
      });
      if (msg.durationMs > 0) {
        window.setTimeout(() => dismiss(msg.id), msg.durationMs);
      }
    });
    return unsub;
  }, [dismiss]);

  // Gardes globales : erreurs JS et promesses rejetées non catchées
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportError('window.error', event.error || event.message, {
        extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportError('window.unhandledrejection', event.reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none">
      {toasts.map(t => {
        const s = STYLES[t.level];
        return (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border ${s.bg} ${s.border} p-3 shadow-lg animate-[fadeIn_0.15s_ease-out]`}
          >
            <span className="mt-0.5 flex-shrink-0">{s.icon}</span>
            <p className={`flex-1 text-sm font-medium ${s.text} break-words`}>{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className={`flex-shrink-0 ${s.text} opacity-60 hover:opacity-100 transition-opacity`}
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ToastHost;
