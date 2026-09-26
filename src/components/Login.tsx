import React, { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { Truck, Lock, Mail, ArrowRight, ShieldCheck, Eye, EyeOff, Loader2 } from 'lucide-react';
import { FormInput } from './shared/FormInput';
import { authErrorMessage } from '../utils/authFeedback';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get('recover') === '1' ? 'Saisissez votre email puis choisissez « Mot de passe oublié ? ».' : '');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState<'login' | 'reset' | null>(null);
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setSuccess(''); setBusy('login');
    try { await signInWithEmailAndPassword(auth, email.trim(), password); }
    catch (e) { setError(authErrorMessage(e)); }
    finally { setBusy(null); }
  };
  const handleReset = async () => {
    if (busy) return;
    setError(''); setSuccess('');
    const input = document.getElementById('login-email') as HTMLInputElement;
    if (!email.trim() || !input.reportValidity()) {
      setError('Saisissez votre adresse email pour recevoir le lien de réinitialisation.');
      input.focus(); return;
    }
    setBusy('reset');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSuccess('Si cette adresse correspond à un compte, vous recevrez un lien de réinitialisation. Consultez aussi les courriers indésirables.');
    } catch (e) { setError(authErrorMessage(e)); }
    finally { setBusy(null); }
  };
  return <main className="min-h-dvh bg-slate-900 flex items-center justify-center p-3 md:p-6">
    <div className="w-full max-w-4xl overflow-hidden rounded-2xl md:rounded-3xl bg-white shadow-xl md:flex">
      <section aria-label="FleetGenius" className="bg-brand-700 text-white px-5 py-3 md:p-10 md:w-1/2 md:flex md:flex-col md:justify-between">
        <div>
          <div className="flex items-center gap-3 md:block">
            <ShieldCheck aria-hidden="true" className="w-7 h-7 md:w-10 md:h-10 md:mb-6" />
            <h1 className="text-xl md:text-4xl font-bold tracking-tight">FleetGenius</h1>
          </div>
          <p className="hidden md:block mt-4 text-brand-100">Votre flotte, vos tournées et vos livraisons dans un même espace.</p>
        </div>
        <div className="hidden md:block space-y-5 mt-16">
          <p className="flex items-center gap-3"><Truck aria-hidden="true" size={24} /> Gestion du parc et des tournées</p>
          <p className="flex items-center gap-3"><Lock aria-hidden="true" size={24} /> Accès professionnel sur invitation</p>
        </div>
      </section>
      <section className="p-4 md:p-10 md:w-1/2" aria-labelledby="login-title">
        <h2 id="login-title" className="text-xl md:text-3xl font-bold text-slate-900">Connexion</h2>
        <p className="mt-1 mb-4 md:mb-7 text-sm text-slate-600">Accédez à votre espace professionnel.</p>
        <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4" aria-busy={!!busy}>
          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          {success && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}
          <FormInput id="login-email" name="username" label="Email professionnel" icon={Mail} type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nom@entreprise.fr" />
          <div className="relative">
            <FormInput id="login-password" name="password" label="Mot de passe" icon={Lock} type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="pr-14" />
            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={showPassword} className="absolute bottom-0.5 right-1 w-11 h-11 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
              {showPassword ? <EyeOff aria-hidden="true" size={21} /> : <Eye aria-hidden="true" size={21} />}
            </button>
          </div>
          <button type="submit" disabled={!!busy} className="ui-button ui-button-primary w-full min-h-12">
            {busy === 'login' ? <Loader2 aria-hidden="true" size={20} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={20} />}
            {busy === 'login' ? 'Connexion en cours…' : 'Se connecter'}
          </button>
          <button type="button" disabled={!!busy} onClick={handleReset} className="ui-button ui-button-ghost w-full">
            {busy === 'reset' ? 'Envoi du lien…' : 'Mot de passe oublié ?'}
          </button>
        </form>
        <details className="mt-2 md:mt-5 border-t border-slate-200 pt-2 text-sm text-slate-700">
          <summary className="min-h-11 flex items-center cursor-pointer font-semibold rounded-lg">Première connexion : activer mon compte</summary>
          <p className="pb-3">Ouvrez l’email d’invitation et choisissez « Activer mon compte ». Si le lien est expiré ou absent, contactez votre responsable pour recevoir une nouvelle invitation.</p>
        </details>
        <p className="hidden md:block mt-4 text-center text-xs text-slate-600">v{__APP_VERSION__} · mise à jour du {__BUILD_DATE__}</p>
      </section>
    </div>
  </main>;
}
