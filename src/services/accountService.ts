import { auth } from '../firebaseConfig';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  signOut,
} from 'firebase/auth';

/**
 * Type guard: narrows an unknown caught value to something carrying a Firebase
 * error `code` (and optionally a `message`).
 */
function getErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Une erreur est survenue.';
}

/**
 * Lets a signed-in client change their own password. Reauthenticates with the
 * current password first (required by Firebase for sensitive operations), then
 * updates to the new password.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 6) {
    throw new Error('Le nouveau mot de passe doit faire au moins 6 caractères.');
  }

  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('Session expirée, reconnecte-toi.');
  }

  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  } catch (error: unknown) {
    const code = getErrorCode(error);
    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        throw new Error('Mot de passe actuel incorrect.');
      case 'auth/weak-password':
        throw new Error('Mot de passe trop faible (min. 6 caractères).');
      case 'auth/too-many-requests':
        throw new Error('Trop de tentatives, réessaie dans quelques minutes.');
      case 'auth/requires-recent-login':
        throw new Error('Reconnecte-toi puis réessaie.');
      default:
        throw new Error(getErrorMessage(error));
    }
  }
}

/**
 * Signs the client out.
 *
 * Note: the Firebase Web SDK cannot revoke sessions on other devices from the
 * client side (that requires the Admin SDK / server-side token revocation).
 * This only signs out the current session/device.
 */
export async function signOutAllDevices(): Promise<void> {
  await signOut(auth);
}
