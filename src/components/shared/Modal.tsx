/**
 * Modal - Composant modal universel avec React Portal
 * 
 * USAGE:
 * <Modal isOpen={bool} onClose={fn} title="Titre" size="lg">
 *   {children}
 * </Modal>
 * 
 * Avec footer:
 * <Modal isOpen={bool} onClose={fn} title="Titre" footer={<Button>Save</Button>}>
 *   {children}
 * </Modal>
 */

import React, { useCallback, useId } from 'react';
import { useDialogLayer } from '../../hooks/useDialogLayer';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: ModalSize;
  showCloseButton?: boolean;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  footer?: React.ReactNode;
  headerIcon?: React.ReactNode;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  // Pour les formulaires - empêche la fermeture accidentelle
  preventClose?: boolean;
  dirty?: boolean;
  ariaLabel?: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  full: 'max-w-[95vw] md:max-w-[90vw]'
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  showCloseButton = true,
  closeOnOverlay = true,
  closeOnEscape = true,
  footer,
  headerIcon,
  headerClassName = '',
  bodyClassName = '',
  footerClassName = '',
  preventClose = false,
  dirty = false,
  ariaLabel,
  role = 'dialog',
  className = ''
}) => {
  const titleId = useId();
  const subtitleId = useId();
  const requestClose = useUnsavedChanges(isOpen && dirty, isOpen && preventClose);
  const handleClose = useCallback(() => { void requestClose(onClose); }, [requestClose, onClose]);
  const layerRef = useDialogLayer(isOpen, () => { if (closeOnEscape && !preventClose) handleClose(); });

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className={`fixed inset-0 flex items-end sm:items-center justify-center p-2 sm:p-4 ${className}`}
      ref={layerRef}
      tabIndex={-1}
      style={{ zIndex: 10010 }}
      role={role}
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={!title ? ariaLabel || 'Fenêtre' : undefined}
      aria-describedby={subtitle ? subtitleId : undefined}
      aria-busy={preventClose || undefined}
    >
      {/* Overlay */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={closeOnOverlay ? handleClose : undefined}
        aria-hidden="true"
      />
      
      {/* Modal Box */}
      <div 
        className={`
          relative bg-white rounded-2xl shadow-2xl 
          w-full ${sizeClasses[size]} 
          max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] overflow-hidden flex flex-col
          animate-fade-in
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className={`px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 flex-shrink-0 ${headerClassName}`}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {headerIcon && (
                <div className="flex-shrink-0 p-2 bg-brand-50 text-brand-600 rounded-xl">
                  {headerIcon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h3 id={titleId} className="text-lg sm:text-xl font-bold text-slate-800 break-words">
                    {title}
                  </h3>
                )}
                {subtitle && (
                  <p id={subtitleId} className="text-sm text-slate-600">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            {showCloseButton && (
              <button 
                type="button"
                disabled={preventClose}
                onClick={handleClose}
                className="min-h-11 min-w-11 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-full transition-colors flex-shrink-0 ml-2 disabled:opacity-50"
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}
        
        {/* Body */}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 custom-scrollbar ${bodyClassName}`}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className={`px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] ${footerClassName}`}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default Modal;
