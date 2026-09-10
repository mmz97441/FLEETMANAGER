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

import React from 'react';
import { useDialogLayer } from '../../hooks/useDialogLayer';
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
  const layerRef = useDialogLayer(isOpen, () => { if (closeOnEscape) onClose?.(); });

  if (!isOpen) return null;

  const content = (
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Fenêtre de détail"
      tabIndex={-1}
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
