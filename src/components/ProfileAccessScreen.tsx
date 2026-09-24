import { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { ProfileIssue } from '../utils/profileSession';

const messages = {
  unavailable: ['Votre profil n’a pas pu être chargé', 'La connexion ou le service rencontre un problème. Cela ne signifie pas que votre compte est supprimé. Réessayez quand la connexion est disponible.'],
  missing: ['Aucun profil rattaché à ce compte', 'Vérifiez l’adresse du compte connecté ci-dessous. Si c’est la bonne adresse, demandez à votre responsable de vérifier votre profil salarié.'],
  disabled: ['Ce compte est désactivé', 'Contactez votre responsable pour faire vérifier votre accès.'],
  revoked: ['Reconnectez-vous pour continuer', 'Cette session a été révoquée ou a expiré. Reconnectez-vous avec votre compte pour vérifier à nouveau votre accès.'],
};

export default function ProfileAccessScreen({ issue, onRetry, onSignOut }: {
  issue: ProfileIssue;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const leave = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onSignOut(); }
    catch { setError('La déconnexion n’a pas abouti. Réessayez.'); }
    finally { setBusy(false); }
  };
  return <main className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
    <section className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 space-y-5" aria-labelledby="profile-access-title">
      <AlertCircle className="text-amber-700" size={32} aria-hidden="true" />
      <h1 id="profile-access-title" className="text-2xl font-bold text-slate-900">{messages[issue.kind][0]}</h1>
      <p role="alert" className="text-slate-700">{messages[issue.kind][1]}</p>
      {issue.email && <p className="rounded-xl bg-slate-100 p-3 text-sm break-words">Compte connecté : <strong>{issue.email}</strong></p>}
      <p className="text-sm text-slate-600">Les données et livraisons déjà enregistrées sur cet appareil sont conservées.</p>
      {error && <p role="alert" className="text-red-800">{error}</p>}
      <div className="flex flex-col gap-3">
        <button type="button" className="ui-button ui-button-primary w-full" disabled={busy} onClick={onRetry}><RefreshCw size={18} /> Réessayer</button>
        <button type="button" className="ui-button ui-button-secondary w-full" disabled={busy} onClick={() => void leave()}>{busy ? 'Déconnexion…' : issue.kind === 'revoked' ? 'Me reconnecter' : 'Utiliser un autre compte'}</button>
      </div>
    </section>
  </main>;
}
