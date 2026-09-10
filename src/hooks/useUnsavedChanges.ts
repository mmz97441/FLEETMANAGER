import { useCallback, useEffect, useRef } from 'react';
import { confirmAction } from '../services/confirmationService';

export function useUnsavedChanges(dirty: boolean, busy = false) {
  const asking = useRef(false);
  const requestClose = useCallback(async (close: () => void) => {
    if (busy || asking.current) return;
    if (!dirty) { close(); return; }
    asking.current = true;
    try {
      if (await confirmAction({ title: 'Abandonner cette saisie ?', message: 'Les modifications non enregistrées seront perdues.', confirmLabel: 'Abandonner la saisie', cancelLabel: 'Continuer la saisie', danger: true })) close();
    } finally { asking.current = false; }
  }, [dirty, busy]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, busy]);
  return requestClose;
}
