/**
 * Page d'activation de compte avec token
 * 
 * URL: /activate?token=abc123xyz
 * 
 * Workflow SÉCURISÉ via Cloud Functions:
 * 1. Récupère le token depuis l'URL
 * 2. Appelle Cloud Function validateInvitationToken (pas besoin d'auth)
 * 3. Si valide → affiche formulaire de création de mot de passe
 * 4. Appelle Cloud Function activateAccount (crée Auth + lie profil)
 * 5. Auto-login via custom token
 */

import React, { useState, useEffect } from 'react';
import { 
  validateInvitationTokenCF, 
  activateAccountCF,
  InvitationInfo
} from '../services/cloudFunctions';
import { 
  Truck, Lock, CheckCircle, AlertTriangle, Clock, 
  Eye, EyeOff, ShieldCheck, Loader2, XCircle, RefreshCw
} from 'lucide-react';

interface ActivateAccountProps {
  token: string;
  onSuccess?: () => void;
}

type PageState = 'loading' | 'valid' | 'expired' | 'used' | 'not_found' | 'error' | 'success';

const ActivateAccount: React.FC<ActivateAccountProps> = ({ token, onSuccess }) => {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Valider le token au chargement via Cloud Function
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setPageState('not_found');
        return;
      }

      try {
        // Appel Cloud Function (pas besoin d'être connecté)
        const result = await validateInvitationTokenCF(token);
        
        if (result.valid && result.invitation) {
          setInvitation(result.invitation);
          setPageState('valid');
        } else {
          setInvitation(result.invitation || null);
          switch (result.error) {
            case 'EXPIRED':
              setPageState('expired');
              break;
            case 'ALREADY_USED':
              setPageState('used');
              break;
            default:
              setPageState('not_found');
          }
        }
      } catch (err) {
        console.error('Erreur validation token:', err);
        setPageState('error');
      }
    };

    validateToken();
  }, [token]);

  // Soumettre le formulaire
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validations
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);

    try {
      // Appel Cloud Function pour activer le compte
      const result = await activateAccountCF(token, password);

      if (result.success) {
        setPageState('success');
        
        // Rediriger vers la page de connexion après 3 secondes
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      } else {
        setError(result.message || 'Erreur lors de l\'activation');
      }

    } catch (err: any) {
      console.error('Erreur création compte:', err);
      setError(err.message || 'Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  // Calcul du temps restant avant expiration
  const getTimeRemaining = () => {
    if (!invitation?.expiresAt) return '';
    const now = new Date();
    const expires = new Date(invitation.expiresAt);
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return 'Expiré';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days} jour${days > 1 ? 's' : ''} restant${days > 1 ? 's' : ''}`;
    return `${hours} heure${hours > 1 ? 's' : ''} restante${hours > 1 ? 's' : ''}`;
  };

  // Calcul de la force du mot de passe
  const getPasswordStrength = () => {
    if (!password) return { strength: 0, label: '', color: '' };
    
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    if (strength <= 2) return { strength, label: 'Faible', color: 'bg-red-500' };
    if (strength <= 3) return { strength, label: 'Moyen', color: 'bg-orange-500' };
    return { strength, label: 'Fort', color: 'bg-green-500' };
  };

  const passwordStrength = getPasswordStrength();

  // ============================================================================
  // RENDUS CONDITIONNELS
  // ============================================================================

  // État: Chargement
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
          <Loader2 className="w-16 h-16 text-brand-500 animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-800">Vérification en cours...</h1>
          <p className="text-slate-500 mt-2">Validation de votre lien d'invitation</p>
        </div>
      </div>
    );
  }

  // État: Token non trouvé
  if (pageState === 'not_found') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Lien invalide</h1>
          <p className="text-slate-500 mb-6">
            Ce lien d'invitation n'est pas valide ou n'existe pas.
            <br />Vérifiez que vous avez copié l'URL complète.
          </p>
          <a 
            href="/"
            className="inline-block bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            Retour à l'accueil
          </a>
        </div>
      </div>
    );
  }

  // État: Token expiré
  if (pageState === 'expired') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Clock className="w-10 h-10 text-orange-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Lien expiré</h1>
          <p className="text-slate-500 mb-4">
            Ce lien d'invitation a expiré.
          </p>
          {invitation?.email && (
            <p className="text-sm text-slate-400 mb-6">
              Compte : <strong>{invitation.email}</strong>
            </p>
          )}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-orange-700">
              <strong>Que faire ?</strong><br />
              Contactez votre administrateur pour qu'il vous renvoie une nouvelle invitation.
            </p>
          </div>
          <a 
            href="/"
            className="inline-block bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            Retour à l'accueil
          </a>
        </div>
      </div>
    );
  }

  // État: Token déjà utilisé
  if (pageState === 'used') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Compte déjà activé</h1>
          <p className="text-slate-500 mb-4">
            Ce lien d'invitation a déjà été utilisé.
          </p>
          {invitation?.email && (
            <p className="text-sm text-slate-400 mb-6">
              Compte : <strong>{invitation.email}</strong>
            </p>
          )}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-blue-700">
              Vous pouvez vous connecter avec votre email et mot de passe.
            </p>
          </div>
          <a 
            href="/"
            className="inline-block bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            Se connecter
          </a>
        </div>
      </div>
    );
  }

  // État: Succès
  if (pageState === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Compte activé ! 🎉</h1>
          <p className="text-slate-500 mb-6">
            Votre compte a été créé avec succès.
            <br />Vous allez être redirigé vers la page de connexion...
          </p>
          <div className="flex items-center justify-center gap-2 text-brand-600">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-medium">Redirection en cours...</span>
          </div>
        </div>
      </div>
    );
  }

  // État: Erreur générique
  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Une erreur est survenue</h1>
          <p className="text-slate-500 mb-6">
            Impossible de vérifier votre lien d'invitation.
            <br />Veuillez réessayer plus tard.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-xl font-bold transition-colors"
          >
            <RefreshCw size={18} />
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // ÉTAT PRINCIPAL: FORMULAIRE DE CRÉATION DE MOT DE PASSE
  // ============================================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Truck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Activez votre compte</h1>
          <p className="text-slate-500">Créez votre mot de passe pour commencer</p>
        </div>

        {/* Infos invitation */}
        <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-500 uppercase font-bold">Votre compte</span>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-bold flex items-center gap-1">
              <Clock size={10} />
              {getTimeRemaining()}
            </span>
          </div>
          <p className="font-bold text-slate-800">{invitation?.email}</p>
          <div className="flex items-center gap-2 mt-2">
            {invitation?.firstName && (
              <span className="text-sm text-slate-600">
                {invitation.firstName} {invitation.lastName}
              </span>
            )}
            {invitation?.role && (
              <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-bold">
                {invitation.role}
              </span>
            )}
          </div>
          {invitation?.invitedByName && (
            <p className="text-xs text-slate-400 mt-2">
              Invité par {invitation.invitedByName}
            </p>
          )}
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Mot de passe */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              Créez votre mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 caractères"
                className="w-full pl-10 pr-12 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-slate-900 font-medium"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            
            {/* Indicateur de force */}
            {password && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div 
                      key={i}
                      className={`h-1 flex-1 rounded-full ${
                        i <= passwordStrength.strength ? passwordStrength.color : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-xs font-medium ${
                  passwordStrength.color.replace('bg-', 'text-')
                }`}>
                  Sécurité : {passwordStrength.label}
                </p>
              </div>
            )}
          </div>

          {/* Confirmation mot de passe */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              Confirmez le mot de passe
            </label>
            <div className="relative">
              <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Retapez votre mot de passe"
                className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium ${
                  confirmPassword && confirmPassword !== password 
                    ? 'border-red-300 bg-red-50' 
                    : confirmPassword && confirmPassword === password
                      ? 'border-green-300 bg-green-50'
                      : 'border-slate-300'
                }`}
                required
              />
              {confirmPassword && confirmPassword === password && (
                <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" size={20} />
              )}
            </div>
          </div>

          {/* Erreur */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Bouton submit */}
          <button
            type="submit"
            disabled={loading || password.length < 6 || password !== confirmPassword}
            className="w-full py-4 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-xl disabled:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Activation en cours...
              </>
            ) : (
              <>
                <ShieldCheck size={22} />
                Activer mon compte
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          En activant votre compte, vous acceptez les conditions d'utilisation de FleetGenius Pro.
        </p>
      </div>
    </div>
  );
};

export default ActivateAccount;
