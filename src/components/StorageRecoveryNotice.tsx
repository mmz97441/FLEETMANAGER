import { useSyncExternalStore } from 'react';
import { hasStorageFailure, subscribeStorageFailure } from '../utils/storageRecovery';
import { reloadApplication } from '../utils/reloadApplication';

/** Keep the original Firestore database and delivery outbox. Reopening the page
 * recreates the poisoned SDK queue; deleting persistence could lose pending writes. */
export default function StorageRecoveryNotice() {
  const failed = useSyncExternalStore(subscribeStorageFailure, hasStorageFailure, () => false);
  if (!failed) return null;
  return <div role="alert" className="fixed bottom-3 inset-x-3 z-[10050] mx-auto max-w-xl rounded-xl border border-amber-400 bg-amber-50 p-4 shadow-xl text-amber-950">
    <p className="font-bold">Le stockage du téléphone s’est interrompu</p>
    <p className="text-sm mt-1">Enregistrez vos saisies si possible, puis relancez l’application. Vos preuves et envois conservés sur ce téléphone ne seront pas effacés. Vérifiez la dernière opération avant de la recommencer.</p>
    <button type="button" onClick={() => void reloadApplication()} className="ui-button ui-button-primary mt-3">Relancer sans se déconnecter</button>
  </div>;
}
