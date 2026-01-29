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

import React, { useEffect, useCallback } from 'react';
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
  preventClose = false
}) => {
  // Handler pour fermeture
  const handleClose = useCallback(() => {
    if (!preventClose) {
      onClose();
    }
  }, [onClose, preventClose]);

  // Fermer avec Escape
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && closeOnEscape && !preventClose) {
      onClose();
    }
  }, [onClose, closeOnEscape, preventClose]);

  // Gérer le scroll du body et les événements
  useEffect(() => {
    if (isOpen) {
      // Sauvegarder la position de scroll
      const scrollY = window.scrollY;
      
      // Bloquer le scroll
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
      
      // Écouter Escape
      document.addEventListener('keydown', handleEscape);
      
      return () => {
        // Restaurer le scroll
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
        
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 flex items-center justify-center p-2 sm:p-4"
      style={{ zIndex: 99999 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
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
          max-h-[90vh] overflow-hidden flex flex-col
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
                  <h3 id="modal-title" className="text-lg sm:text-xl font-bold text-slate-800 truncate">
                    {title}
                  </h3>
                )}
                {subtitle && (
                  <p className="text-xs sm:text-sm text-slate-500 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            {showCloseButton && (
              <button 
                onClick={handleClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors flex-shrink-0 ml-2"
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
            )}
          </div>
        )}
        
        {/* Body */}
        <div className={`flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar ${bodyClassName}`}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className={`px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 ${footerClassName}`}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default Modal;
