import * as functions from 'firebase-functions/v1';

// Bootstrap floor: releases from here implement the mandatory latest-build gate.
// Keep proof publication and durable outbox replay independent of this floor.
export const MINIMUM_DRIVER_SCAN_VERSION = '4.37.0';

export function requireDriverScanVersion(role: string, version: unknown): void {
  if (!['chauffeur', 'chauffeuse'].includes(role)) return;
  const parts = typeof version === 'string' && version.length <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    ? version.split('.').map(Number) : [];
  const minimum = MINIMUM_DRIVER_SCAN_VERSION.split('.').map(Number);
  const difference = parts.findIndex((part, index) => part !== minimum[index]);
  if (parts.length === 3 && parts.every(Number.isSafeInteger) &&
      (difference === -1 || parts[difference] > minimum[difference])) return;
  throw new functions.https.HttpsError('failed-precondition',
    `Mise à jour obligatoire (version ${MINIMUM_DRIVER_SCAN_VERSION} minimum). Fermez le scanner puis appuyez sur « Installer la mise à jour » dans l’application, ou fermez et rouvrez l’application. Vos preuves déjà enregistrées restent conservées sur ce téléphone.`,
    { reason: 'app-update-required', minimumVersion: MINIMUM_DRIVER_SCAN_VERSION });
}
