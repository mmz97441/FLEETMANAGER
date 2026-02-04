
import React, { useState } from 'react';
import { User } from '../types';
import { updateUserProfile } from '../services/firestore';
// @ts-ignore
import { updatePassword, updateProfile, getAuth } from 'firebase/auth';
import { User as UserIcon, Lock, Bell, Moon, Save, Shield, CheckCircle, AlertCircle, Camera } from 'lucide-react';

interface SettingsProps {
  currentUser: User;
  onUpdateUser: (user: User) => void;
}

const Settings: React.FC<SettingsProps> = ({ currentUser, onUpdateUser }) => {
  const auth = getAuth();
  
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'prefs'>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);

  // Profile Form
  const [firstName, setFirstName] = useState(currentUser.firstName);
  const [lastName, setLastName] = useState(currentUser.lastName);
  
  // Password Form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleUpdateProfile = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsLoading(true);
      setMessage(null);

      try {
          const updatedUser = { ...currentUser, firstName, lastName };
          
          // Update Firestore
          await updateUserProfile(updatedUser);
          
          // Update Auth Profile (Display Name)
          if (auth.currentUser) {
              await updateProfile(auth.currentUser, {
                  displayName: `${firstName} ${lastName}`
              });
          }

          onUpdateUser(updatedUser);
          setMessage({ type: 'success', text: 'Profil mis à jour avec succès.' });
      } catch (error) {
          console.error(error);
          setMessage({ type: 'error', text: 'Erreur lors de la mise à jour.' });
      } finally {
          setIsLoading(false);
      }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
      e.preventDefault();
      if (newPassword !== confirmPassword) {
          setMessage({ type: 'error', text: 'Les mots de passe ne correspondent pas.' });
          return;
      }
      if (newPassword.length < 6) {
          setMessage({ type: 'error', text: 'Le mot de passe est trop court (6 car. min).' });
          return;
      }

      setIsLoading(true);
      setMessage(null);

      try {
          if (auth.currentUser) {
              await updatePassword(auth.currentUser, newPassword);
              setMessage({ type: 'success', text: 'Mot de passe modifié. Vous devrez peut-être vous reconnecter.' });
              setNewPassword('');
              setConfirmPassword('');
          }
      } catch (error: any) {
          console.error(error);
          if (error.code === 'auth/requires-recent-login') {
              setMessage({ type: 'error', text: 'Sécurité : Veuillez vous déconnecter et vous reconnecter avant de changer le mot de passe.' });
          } else {
              setMessage({ type: 'error', text: 'Erreur lors du changement de mot de passe.' });
          }
      } finally {
          setIsLoading(false);
      }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-10">
        
        {/* Header */}
        <div>
            <h2 className="text-2xl font-bold text-slate-900">Paramètres du Compte</h2>
            <p className="text-slate-500">Gérez vos informations personnelles et votre sécurité.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* Sidebar Tabs */}
            <div className="md:col-span-4 lg:col-span-3 space-y-2">
                <button 
                    onClick={() => setActiveTab('profile')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'profile' ? 'bg-white shadow-sm text-brand-600 ring-1 ring-brand-100' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                    <UserIcon size={18} /> Mon Profil
                </button>
                <button 
                    onClick={() => setActiveTab('security')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'security' ? 'bg-white shadow-sm text-brand-600 ring-1 ring-brand-100' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                    <Lock size={18} /> Sécurité
                </button>
                <button 
                    onClick={() => setActiveTab('prefs')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === 'prefs' ? 'bg-white shadow-sm text-brand-600 ring-1 ring-brand-100' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                    <Bell size={18} /> Préférences
                </button>
            </div>

            {/* Main Content */}
            <div className="md:col-span-8 lg:col-span-9">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 min-h-[400px]">
                    
                    {message && (
                        <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                            {message.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                            <span className="font-medium text-sm">{message.text}</span>
                        </div>
                    )}

                    {/* --- TAB PROFILE --- */}
                    {activeTab === 'profile' && (
                        <form onSubmit={handleUpdateProfile} className="space-y-6">
                            <div className="flex items-center gap-6 pb-6 border-b border-slate-100">
                                <div className="relative group cursor-pointer">
                                    <img src={currentUser.avatarUrl} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-4 border-slate-50 shadow-sm" />
                                    <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Camera className="text-white" size={24} />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 text-lg">{currentUser.firstName} {currentUser.lastName}</h3>
                                    <p className="text-slate-500 text-sm">{currentUser.role}</p>
                                    <button type="button" className="text-brand-600 text-xs font-bold mt-1 hover:underline">Changer la photo (Bientôt)</button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prénom</label>
                                    <input 
                                        type="text" required 
                                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium"
                                        value={firstName} onChange={e => setFirstName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nom</label>
                                    <input 
                                        type="text" required 
                                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 font-medium"
                                        value={lastName} onChange={e => setLastName(e.target.value)}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email (Non modifiable)</label>
                                    <input 
                                        type="email" disabled 
                                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 font-medium cursor-not-allowed"
                                        value={currentUser.email}
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button type="submit" disabled={isLoading} className="bg-slate-900 hover:bg-black text-white px-6 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2 transition-all disabled:opacity-50">
                                    <Save size={18} /> {isLoading ? 'Enregistrement...' : 'Enregistrer'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB SECURITY --- */}
                    {activeTab === 'security' && (
                        <form onSubmit={handleUpdatePassword} className="space-y-6">
                            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex gap-3 items-start">
                                <Shield className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h4 className="font-bold text-blue-900 text-sm">Zone Sécurisée</h4>
                                    <p className="text-blue-700 text-xs mt-1">Pour modifier votre mot de passe, vous devez avoir une connexion récente. Si cela échoue, déconnectez-vous et réessayez.</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nouveau mot de passe</label>
                                <input 
                                    type="password" required minLength={6}
                                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900"
                                    placeholder="••••••••"
                                    value={newPassword} onChange={e => setNewPassword(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Confirmer mot de passe</label>
                                <input 
                                    type="password" required minLength={6}
                                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-brand-500 outline-none text-slate-900"
                                    placeholder="••••••••"
                                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                                />
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button type="submit" disabled={isLoading} className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2 transition-all disabled:opacity-50">
                                    <Lock size={18} /> {isLoading ? 'Mise à jour...' : 'Changer le mot de passe'}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* --- TAB PREFS --- */}
                    {activeTab === 'prefs' && (
                        <div className="space-y-6 text-center py-10">
                            <div className="bg-slate-50 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                                <Moon size={32} className="text-slate-400" />
                            </div>
                            <h3 className="font-bold text-slate-900 text-lg">Préférences d'interface</h3>
                            <p className="text-slate-500 max-w-sm mx-auto">
                                Le mode sombre et les paramètres de notification avancés arriveront dans la prochaine mise à jour majeure de FleetGenius.
                            </p>
                            <span className="inline-block bg-slate-100 text-slate-500 text-xs font-bold px-3 py-1 rounded-full border border-slate-200 mt-4">
                                Version 2.1.0 (Production)
                            </span>
                        </div>
                    )}

                </div>
            </div>
        </div>
    </div>
  );
};

export default Settings;