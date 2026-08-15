import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { User, Package as PackageType } from '../types';
import {
  X,
  UserCircle,
  Building2,
  Users,
  History,
  Lock,
  Mail,
  MapPin,
  Package as PackageIcon,
  ShieldCheck,
  Info,
} from 'lucide-react';

// ============================================================================
// AccountHub — Modale "Mon compte" pour le CLIENT (expéditeur)
// 100% présentationnel : tout passe par les props, aucun service importé.
// ============================================================================

interface AccountHubProps {
  currentUser: User;
  companyUsers?: User[];
  packages?: PackageType[];
  onClose: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onSaveCompany: (fields: {
    companyName: string;
    companyAddress: string;
    companyPhone: string;
    companySiret: string;
  }) => Promise<void>;
}

type TabId = 'profile' | 'company' | 'team' | 'history';

const TABS: { id: TabId; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'profile', label: 'Profil & sécurité', icon: UserCircle },
  { id: 'company', label: 'Mon entreprise', icon: Building2 },
  { id: 'team', label: 'Équipe & accès', icon: Users },
  { id: 'history', label: 'Historique', icon: History },
];

// Initiales à partir d'un prénom/nom (ou email en dernier recours)
const getInitials = (firstName?: string, lastName?: string, email?: string): string => {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();
  if (f || l) {
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || '?';
  }
  return (email || '?').charAt(0).toUpperCase();
};

const inputClass =
  'w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all';

const AccountHub: React.FC<AccountHubProps> = ({
  currentUser,
  companyUsers,
  packages,
  onClose,
  onChangePassword,
  onSaveCompany,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('profile');

  // --- Onglet Profil & sécurité : changement de mot de passe ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwdError('Merci de remplir tous les champs.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('Le nouveau mot de passe et sa confirmation ne correspondent pas.');
      return;
    }

    setPwdLoading(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setPwdSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwdError(err?.message || 'Une erreur est survenue.');
    } finally {
      setPwdLoading(false);
    }
  };

  // --- Onglet Mon entreprise ---
  const [companyName, setCompanyName] = useState(currentUser.companyName || '');
  const [companyAddress, setCompanyAddress] = useState(currentUser.companyAddress || '');
  const [companyPhone, setCompanyPhone] = useState(currentUser.companyPhone || '');
  const [companySiret, setCompanySiret] = useState(currentUser.companySiret || '');
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState('');
  const [companySuccess, setCompanySuccess] = useState(false);

  const showCompanyHint = !companyName.trim() || !companyAddress.trim();

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompanyError('');
    setCompanySuccess(false);
    setCompanyLoading(true);
    try {
      await onSaveCompany({
        companyName: companyName.trim(),
        companyAddress: companyAddress.trim(),
        companyPhone: companyPhone.trim(),
        companySiret: companySiret.trim(),
      });
      setCompanySuccess(true);
    } catch (err: any) {
      setCompanyError(err?.message || 'Une erreur est survenue.');
    } finally {
      setCompanyLoading(false);
    }
  };

  // --- Onglet Historique : 20 colis les plus récents ---
  const recentPackages = useMemo(() => {
    const list = packages ? [...packages] : [];
    list.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });
    return list.slice(0, 20);
  }, [packages]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-3xl w-full max-h-[90vh] rounded-2xl bg-white flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0"
              title={`${currentUser.firstName} ${currentUser.lastName}`}
            >
              {getInitials(currentUser.firstName, currentUser.lastName, currentUser.email)}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 leading-tight">Mon compte</h2>
              <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Fermer"
            aria-label="Fermer"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Corps : rail vertical (desktop) + onglets horizontaux (mobile) */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          {/* Rail vertical desktop */}
          <nav className="hidden md:flex flex-col gap-1 w-56 flex-shrink-0 border-r border-slate-100 p-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    active
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon size={18} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Onglets horizontaux mobile */}
          <div className="md:hidden border-b border-slate-100 overflow-x-auto">
            <div className="flex gap-1 p-2 min-w-max">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Zone de contenu */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {/* ===================== ONGLET 1 : PROFIL & SÉCURITÉ ===================== */}
            {activeTab === 'profile' && (
              <div className="space-y-5">
                {/* Identité */}
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <UserCircle size={18} className="text-indigo-600" />
                    Mes informations
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Nom complet
                      </label>
                      <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900">
                        {`${currentUser.firstName} ${currentUser.lastName}`.trim() || '—'}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Adresse e-mail
                      </label>
                      <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 flex items-center gap-2">
                        <Mail size={15} className="text-slate-400 flex-shrink-0" />
                        <span className="truncate">{currentUser.email}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Changement de mot de passe */}
                <form
                  onSubmit={handleChangePassword}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Lock size={18} className="text-indigo-600" />
                    Changer le mot de passe
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Mot de passe actuel
                      </label>
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className={inputClass}
                        placeholder="••••••••"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Nouveau mot de passe
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={inputClass}
                        placeholder="••••••••"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Confirmer le nouveau mot de passe
                      </label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={inputClass}
                        placeholder="••••••••"
                      />
                    </div>
                  </div>

                  {pwdError && (
                    <p className="mt-3 text-sm text-red-600 font-medium">{pwdError}</p>
                  )}
                  {pwdSuccess && (
                    <p className="mt-3 text-sm text-green-600 font-medium">
                      ✅ Mot de passe mis à jour
                    </p>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={pwdLoading}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {pwdLoading ? 'Enregistrement…' : 'Mettre à jour'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ===================== ONGLET 2 : MON ENTREPRISE ===================== */}
            {activeTab === 'company' && (
              <form onSubmit={handleSaveCompany} className="space-y-5">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
                    <Building2 size={18} className="text-indigo-600" />
                    Identité de l'expéditeur
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Ces informations sont reprises automatiquement sur vos bons de livraison.
                  </p>

                  {showCompanyHint && (
                    <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-700">
                      ⚠️ Raison sociale et adresse figurent sur vos BL — complétez-les.
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Raison sociale
                      </label>
                      <input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className={inputClass}
                        placeholder="Ex : PREM BPA"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Adresse complète
                      </label>
                      <input
                        type="text"
                        value={companyAddress}
                        onChange={(e) => setCompanyAddress(e.target.value)}
                        className={inputClass}
                        placeholder="Rue, code postal, ville"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Téléphone
                        </label>
                        <input
                          type="tel"
                          value={companyPhone}
                          onChange={(e) => setCompanyPhone(e.target.value)}
                          className={inputClass}
                          placeholder="06 12 34 56 78"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          N° SIRET
                        </label>
                        <input
                          type="text"
                          value={companySiret}
                          onChange={(e) => setCompanySiret(e.target.value)}
                          className={inputClass}
                          placeholder="123 456 789 00012"
                        />
                      </div>
                    </div>
                  </div>

                  {companyError && (
                    <p className="mt-3 text-sm text-red-600 font-medium">{companyError}</p>
                  )}
                  {companySuccess && (
                    <p className="mt-3 text-sm text-green-600 font-medium">✅ Enregistré</p>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={companyLoading}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                      {companyLoading ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* ===================== ONGLET 3 : ÉQUIPE & ACCÈS ===================== */}
            {activeTab === 'team' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Users size={18} className="text-indigo-600" />
                    Membres de l'équipe
                  </h3>

                  {companyUsers && companyUsers.length > 0 ? (
                    <ul className="space-y-2">
                      {companyUsers.map((member) => (
                        <li
                          key={member.id}
                          className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          <div
                            className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold flex-shrink-0"
                            title={`${member.firstName} ${member.lastName}`}
                          >
                            {getInitials(member.firstName, member.lastName, member.email)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {`${member.firstName} ${member.lastName}`.trim() || member.email}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{member.email}</p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium flex-shrink-0">
                            {member.role}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <ShieldCheck size={40} className="text-slate-300 mb-3" />
                      <p className="text-sm text-slate-500">Aucun membre pour l'instant.</p>
                    </div>
                  )}

                  <p className="mt-4 text-xs text-slate-400 flex items-center gap-1.5">
                    <Info size={13} className="flex-shrink-0" />
                    Bientôt : gérer les rôles et accès par membre.
                  </p>
                </div>
              </div>
            )}

            {/* ===================== ONGLET 4 : HISTORIQUE ===================== */}
            {activeTab === 'history' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <History size={18} className="text-indigo-600" />
                    Derniers envois
                  </h3>

                  {recentPackages.length > 0 ? (
                    <ul className="divide-y divide-slate-100">
                      {recentPackages.map((pkg) => (
                        <li key={pkg.id} className="flex items-center gap-3 py-3">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                            <PackageIcon size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {pkg.contactName || '—'}
                            </p>
                            <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                              <MapPin size={12} className="flex-shrink-0" />
                              {pkg.city || '—'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-medium text-slate-600">{pkg.status}</p>
                            <p className="text-xs text-slate-400">
                              {pkg.createdAt
                                ? new Date(pkg.createdAt).toLocaleDateString('fr-FR')
                                : '—'}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <PackageIcon size={40} className="text-slate-300 mb-3" />
                      <p className="text-sm text-slate-500">Aucun envoi pour l'instant.</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Vos colis apparaîtront ici dès votre premier envoi.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AccountHub;
