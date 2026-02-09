import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

// ============================================================================
// CONTEXT
// ============================================================================

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// ============================================================================
// HOOK
// ============================================================================

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// ============================================================================
// TOAST ITEM COMPONENT
// ============================================================================

const TOAST_DURATION = 4000;

const toastStyles: Record<ToastType, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  success: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    icon: <CheckCircle size={20} className="text-green-500 flex-shrink-0" />,
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: <XCircle size={20} className="text-red-500 flex-shrink-0" />,
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    icon: <AlertTriangle size={20} className="text-amber-500 flex-shrink-0" />,
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: <Info size={20} className="text-blue-500 flex-shrink-0" />,
  },
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onDismiss(toast.id), 300);
    }, TOAST_DURATION);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, onDismiss]);

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  const style = toastStyles[toast.type];

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm
        ${style.bg} ${style.border}
        transition-all duration-300 ease-in-out
        ${isExiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'}
        max-w-sm w-full pointer-events-auto
      `}
      role="alert"
    >
      {style.icon}
      <p className={`text-sm font-medium flex-1 ${style.text}`}>{toast.message}</p>
      <button
        onClick={handleDismiss}
        className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  );
};

// ============================================================================
// PROVIDER
// ============================================================================

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type, createdAt: Date.now() }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast Container - Fixed top-right */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
