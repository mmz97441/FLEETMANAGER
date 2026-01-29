/**
 * ModalPortal - Wrapper pour rendre n'importe quelle modal avec Portal
 * Usage: <ModalPortal isOpen={boolean}>{children}</ModalPortal>
 * 
 * Ce wrapper :
 * - Rend le contenu directement dans document.body via Portal
 * - Bloque le scroll du body
 * - Gère la touche Escape
 * - Centre le contenu sur le viewport
 */

import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  closeOnEscape?: boolean;
  zIndex?: number;
}

const ModalPortal: React.FC<ModalPortalProps> = ({
  isOpen,
  onClose,
  children,
  closeOnEscape = true,
  zIndex = 99999
}) => {
  // Gérer Escape
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && closeOnEscape && onClose) {
      onClose();
    }
  }, [onClose, closeOnEscape]);

  // Bloquer le scroll et écouter Escape
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
      if (closeOnEscape && onClose) {
        document.addEventListener('keydown', handleEscape);
      }
      
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
  }, [isOpen, handleEscape, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      {children}
    </div>
  );

  return createPortal(content, document.body);
};

export default ModalPortal;
