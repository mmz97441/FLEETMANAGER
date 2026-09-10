export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  if (code === 'auth/network-request-failed' || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 'Connexion au réseau indisponible. Vos identifiants sont conservés : rétablissez la connexion puis réessayez.';
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(code)) return 'Email ou mot de passe incorrect. Vérifiez votre saisie ou utilisez « Mot de passe oublié ». ';
  if (code === 'auth/invalid-email') return 'Vérifiez le format de votre adresse email.';
  if (code === 'auth/too-many-requests') return 'Trop de tentatives rapprochées. Patientez quelques minutes avant de réessayer.';
  if (code === 'auth/user-disabled') return 'Ce compte est désactivé. Contactez votre responsable.';
  return 'Le service de connexion est momentanément indisponible. Vos saisies sont conservées ; réessayez dans un instant.';
}
