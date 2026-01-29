/**
 * ConfirmModal - Modal de confirmation standardisée
 * Utilise Modal comme base
 * 
 * USAGE:
 * <ConfirmModal 
 *   isOpen={bool}
 *   onClose={fn}
 *   onConfirm={fn}
 *   title="Supprimer ?"
 *   message="Cette action est irréversible."
 *   type="danger"
 * />
 */

import React from 'react';
import { AlertTriangle, CheckCircle, Info, HelpCircle } from 'lucide-react';
import Modal from './Modal';

export type ConfirmType = 'danger' | 'success' | 'info' | 'warning';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: ConfirmType;
  // Pour actions asynchrones
  isLoading?: boolean;
}

const typeConfig: Record<ConfirmType, { 
  icon: React.ReactNode; 
  iconBg: string; 
  buttonClass: string;
}> = {
  danger: {
    icon: <AlertTriangle size={28} />,
    iconBg: 'bg-red-50 text-red-600',
    buttonClass: 'bg-red-600 hover:bg-red-700'
  },
  success: {
    icon: <CheckCircle size={28} />,
    iconBg: 'bg-green-50 text-green-600',
    buttonClass: 'bg-green-600 hover:bg-green-700'
  },
  info: {
    icon: <Info size={28} />,
    iconBg: 'bg-brand-50 text-brand-600',
    buttonClass: 'bg-brand-600 hover:bg-brand-700'
  },
  warning: {
    icon: <HelpCircle size={28} />,
    iconBg: 'bg-orange-50 text-orange-600',
    buttonClass: 'bg-orange-600 hover:bg-orange-700'
  }
};

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  type = 'info',
  isLoading = false
}) => {
  const config = typeConfig[type];

  const handleConfirm = () => {
    onConfirm();
    // Ne pas fermer automatiquement si loading (l'appelant gère)
    if (!isLoading) {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      showCloseButton={false}
      closeOnOverlay={!isLoading}
      closeOnEscape={!isLoading}
    >
      <div className="text-center py-2">
        {/* Icône */}
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${config.iconBg}`}>
          {config.icon}
        </div>
        
        {/* Titre */}
        <h3 className="text-xl font-bold text-slate-900 mb-2">{title}</h3>
        
        {/* Message */}
        <div className="text-slate-600 font-medium mb-6 text-sm leading-relaxed">
          {message}
        </div>

        {/* Boutons */}
        <div className="flex gap-3">
          <button 
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button 
            onClick={handleConfirm}
            disabled={isLoading}
            className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-colors disabled:opacity-50 ${config.buttonClass}`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Chargement...
              </span>
            ) : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
