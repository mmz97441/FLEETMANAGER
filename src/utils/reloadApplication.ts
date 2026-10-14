import { getUpdateSafetySnapshot } from '../services/updateSafety';
import { confirmAction } from '../services/confirmationService';

/** Always explicit: never reload a camera, form or pending mutation in the background. */
export async function reloadApplication({ requireClean = false }: { requireClean?: boolean } = {}): Promise<boolean> {
  const state = getUpdateSafetySnapshot();
  // Mandatory-update UI observes the same snapshot and lets the user finish first.
  if (requireClean && (state.dirty || state.busy || state.active)) return false;
  if (state.busy) {
    await confirmAction({ title: 'Opération en cours', message: 'Attendez la confirmation avant de recharger.', confirmLabel: 'Rester ici', cancelLabel: 'Continuer ici' });
    return false;
  }
  if (!state.dirty && !state.active) { window.location.reload(); return true; }
  if (await confirmAction({ title: 'Recharger l’application ?', message: state.dirty
    ? 'Une saisie n’est pas enregistrée. Enregistrez-la avant de recharger, sinon elle sera perdue.'
    : 'Une caméra ou une saisie est ouverte. Recharger fermera cet écran. Vos preuves déjà enregistrées restent conservées sur ce téléphone.', confirmLabel: 'Recharger', cancelLabel: 'Rester ici' })) {
    const latest = getUpdateSafetySnapshot();
    if (!latest.busy && !(requireClean && (latest.dirty || latest.active))) {
      window.location.reload(); return true;
    }
  }
  return false;
}
