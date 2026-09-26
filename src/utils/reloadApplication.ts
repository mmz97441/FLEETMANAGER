import { navigationDraftState } from './navigationGuard';
import { confirmAction } from '../services/confirmationService';

/** Always explicit: never reload a camera, form or pending mutation in the background. */
export async function reloadApplication() {
  const state = navigationDraftState();
  if (state.busy) {
    await confirmAction({ title: 'Opération en cours', message: 'Attendez la confirmation avant de recharger.', confirmLabel: 'Rester ici', cancelLabel: 'Continuer ici' });
    return;
  }
  if (await confirmAction({ title: 'Recharger l’application ?', message: state.dirty
    ? 'Une saisie n’est pas enregistrée. Enregistrez-la avant de recharger, sinon elle sera perdue.'
    : 'Vos enregistrements et preuves en attente restent conservés sur ce téléphone. Vérifiez que vos saisies sont enregistrées.', confirmLabel: 'Recharger', cancelLabel: 'Rester ici' })) {
    if (!navigationDraftState().busy) window.location.reload();
  }
}
