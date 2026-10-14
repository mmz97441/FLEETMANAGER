import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { confirmAction } from '../services/confirmationService';
import { registerNavigationDraft } from '../utils/navigationGuard';
import { refreshUpdateSafety } from '../services/updateSafety';

export function useUnsavedChanges(dirty: boolean, busy = false, active = false) {
  const state = useRef({ dirty, busy, active });
  state.current = { dirty, busy, active };
  useLayoutEffect(() => registerNavigationDraft(() => state.current), []);
  useLayoutEffect(() => { refreshUpdateSafety(); }, [dirty, busy, active]);
  const asking = useRef(false);
  const requestClose = useCallback(async (close: () => void) => {
    if (state.current.busy || asking.current) return;
    if (!state.current.dirty) { close(); return; }
    asking.current = true;
    try {
      if (await confirmAction({ title: 'Abandonner cette saisie ?', message: 'Les modifications non enregistrées seront perdues.', confirmLabel: 'Abandonner la saisie', cancelLabel: 'Continuer la saisie', danger: true }) && !state.current.busy) close();
    } finally { asking.current = false; }
  }, []);
  useEffect(() => {
    if (!dirty && !busy && !active) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, busy, active]);
  return requestClose;
}
