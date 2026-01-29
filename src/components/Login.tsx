/**
 * Page de connexion simplifiée
 * 
 * Les nouveaux utilisateurs passent par le lien d'activation avec token (ActivateAccount.tsx)
 * Cette page ne sert qu'à la connexion et réinitialisation de mot de passe
 */

import React, { useState } from 'react';
// @ts-ignore
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { Truck, Lock, Mail, ArrowRight, ShieldCheck, CheckCircle, Eye, EyeOff, ShieldAlert, HelpCircle } from 'lucide-react';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      const errorCode = err.code;

      if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
         setError("Identifiants incorrects.");
      } else if (errorCode === 'auth/too-many-requests') {
        setError("Trop de tentatives échouées. Veuillez réessayer plus tard.");
      } else if (errorCode === 'auth/invalid-email') {
        setError("Format d'email invalide.");
      } else {
        setError("Erreur de connexion. Vérifiez vos identifiants.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
        setError("Veuillez saisir votre email ci-dessus pour réinitialiser le mot de passe.");
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        setSuccessMsg("Email de réinitialisation envoyé ! Vérifiez vos spams.");
        setError(null);
    } catch (err: any) {
        console.error("Forgot password error:", err);
        setError("Impossible d'envoyer l'email.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        
        {/* Left Side - Brand */}
        <div className="w-full md:w-1/2 bg-brand-600 p-10 flex flex-col justify-between text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-black opacity-10 rounded-full translate-y-1/3 -translate-x-1/3 blur-3xl"></div>
          
          <div className="relative z-10">
            <div className="bg-white/10 w-fit p-3 rounded-2xl mb-6 backdrop-blur-sm border border-white/10">
                <ShieldCheck size={32} />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">FleetGenius</h1>
            <p className="text-brand-100 font-medium">L'intelligence artificielle au service de votre flotte.</p>
          </div>
          
          <div className="space-y-4 relative z-10 mt-12 md:mt-0">
            <div className="flex items-center gap-3 bg-white/10 p-4 rounded-xl backdrop-blur-sm border border-white/5">
                <Truck className="text-brand-200" size={24} />
                <div>
                    <p className="font-bold text-sm">Gestion de Parc</p>
                    <p className="text-xs text-brand-200">Suivi temps réel & Maintenance</p>
                </div>
            </div>
            <div className="flex items-center gap-3 bg-white/10 p-4 rounded-xl backdrop-blur-sm border border-white/5">
                <Lock className="text-brand-200" size={24} />
                <div>
                    <p className="font-bold text-sm">Sécurité Maximale</p>
                    <p className="text-xs text-brand-200">Accès sur invitation uniquement</p>
                </div>
            </div>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className="w-full md:w-1/2 p-10 bg-white flex flex-col justify-center relative">
          <div className="mb-8">
              <h2 className="text-3xl font-bold text-slate-800 mb-2">Bon retour</h2>
              <p className="text-slate-500 text-sm">
                  Connectez-vous à votre espace professionnel.
              </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium flex items-start gap-2 animate-fade-in border border-red-100">
                    <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
                    <span className="flex-1">{error}</span>
                </div>
            )}
            {successMsg && (
                <div className="bg-green-50 text-green-600 p-4 rounded-xl text-sm font-medium flex items-center gap-2 animate-fade-in border border-green-100">
                    <CheckCircle size={18} className="flex-shrink-0" />
                    {successMsg}
                </div>
            )}

            <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Email Professionnel</label>
                <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input 
                        type="email" 
                        required
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all font-medium text-slate-900"
                        placeholder="nom@transport.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Mot de passe</label>
                <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input 
                        type={showPassword ? "text" : "password"}
                        required
                        className="w-full pl-12 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all font-medium text-slate-900"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    <button 
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                    >
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>
                <div className="text-right">
                    <button type="button" onClick={handleForgotPassword} className="text-xs font-bold text-brand-600 hover:underline">
                        Mot de passe oublié ?
                    </button>
                </div>
            </div>

            <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-slate-900 hover:bg-black text-white py-4 rounded-xl font-bold text-lg transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed group mt-2"
            >
                {loading ? 'Connexion...' : 'Se connecter'}
                {!loading && <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          {/* Info pour les nouveaux utilisateurs */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <HelpCircle className="text-blue-500 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-bold text-blue-800">Première connexion ?</p>
                <p className="text-xs text-blue-600 mt-1">
                  Si vous avez reçu un email d'invitation, cliquez sur le lien 
                  <strong> "Activer mon compte"</strong> dans cet email pour créer votre mot de passe.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
