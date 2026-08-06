
import React, { useState, useMemo } from 'react';
import { User, UserRole } from '../types';
import { Users, Plus, Shield, User as UserIcon, Settings, Briefcase, Truck, Edit, Save, X, Trash2, Mail, Search, Filter, LayoutGrid, List, Building2, UserPlus, AlertTriangle, CheckCircle, Calendar, HeartPulse, Send, Ban, RefreshCw, Key, MoreVertical, GraduationCap, Lock, AlertCircle, Clock } from 'lucide-react';
import { timeAgo, formatDateTimeFr } from '../utils/timeAgo';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import { sendUserInvitationEmail } from '../services/emailService';
import { createInvitation, getActivationUrl, resendInvitation } from '../services/invitationService';
import { toggleUserStatus, forcePasswordReset } from '../services/cloudFunctions';
import { cleanupDuplicateUserProfiles } from '../services/firestore';
import { notifySuccess, notifyError, notifyInfo } from '../services/logService';
import { usePermissions, Permission } from '../usePermissions';
import { validateName, validateEmail, validatePhone, ValidationResult } from '../utils/validation';

interface UserManagerProps {
  users: User[];
  currentUser?: User;
  onAddUser?: (user: User) => Promise<void>;
  onUpdateUser?: (updatedUser: User) => Promise<void>;
  onDeleteUser?: (userId: string, email?: string) => Promise<void>;
}

const UserManager: React.FC<UserManagerProps> = ({ users, currentUser, onAddUser, onUpdateUser, onDeleteUser }) => {
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewUsers = hasPermission(Permission.USERS_VIEW);
  const canCreateUser = hasPermission(Permission.USERS_CREATE);
  const canEditUser = hasPermission(Permission.USERS_EDIT);
  const canDeleteUser = hasPermission(Permission.USERS_DELETE);
  const canResendInvite = hasPermission(Permission.USERS_INVITE_RESEND);
  const canManagePermissions = hasPermission(Permission.USERS_PERMISSIONS);
  
  // Rétrocompatibilité
  const canEdit = canEditUser;

  // === HOOKS (doivent être appelés avant tout return conditionnel) ===
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  
  // ACTION STATE
  const [pendingAction, setPendingAction] = useState<{
      type: 'ADD' | 'UPDATE' | 'DELETE';
      data?: any;
  } | null>(null);

  // Nettoyage des profils en double (issus de la migration d'ID)
  const [isCleaning, setIsCleaning] = useState(false);
  const handleCleanupDuplicates = async () => {
    if (!currentUser || isCleaning) return;
    setIsCleaning(true);
    notifyInfo('Analyse des profils en double…');
    try {
      const res = await cleanupDuplicateUserProfiles(currentUser);
      if (res.removed.length === 0 && res.skipped.length === 0) {
        notifySuccess('Aucun profil en double trouvé. Tout est propre 👍');
      } else {
        if (res.removed.length > 0) {
          notifySuccess(`${res.removed.length} profil(s) en double supprimé(s) : ${res.removed.map(r => r.name || r.email).join(', ')}`);
        }
        if (res.skipped.length > 0) {
          notifyError(`${res.skipped.length} cas ambigu(s) non touché(s) — à vérifier : ${res.skipped.map(s => s.email).join(', ')}`, 12000);
        }
      }
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Échec du nettoyage des doublons');
    }
    setIsCleaning(false);
  };

  // MENU & LOADING STATES
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // VIEW & FILTER STATES
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // FORM STATE
  const [formData, setFormData] = useState<Partial<User>>({
      firstName: '',
      lastName: '',
      email: '',
      role: UserRole.DRIVER,
      leaveBalance: 25,
      isHeavyGoodsDriver: false,
      fcoDate: '',
      medicalVisitDate: '',
      companyName: ''
  });

  // VALIDATION ERRORS STATE
  const [formErrors, setFormErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
  }>({});

  // Validation en temps réel
  const handleFieldChange = (field: keyof typeof formData, value: string) => {
    setFormData({ ...formData, [field]: value });
    
    // Valider en temps réel
    let validation: ValidationResult = { valid: true };
    
    switch (field) {
      case 'firstName':
        validation = validateName(value, 'prénom');
        break;
      case 'lastName':
        validation = validateName(value, 'nom');
        break;
      case 'email':
        if (value.length > 0) validation = validateEmail(value);
        break;
    }
    
    setFormErrors(prev => ({
      ...prev,
      [field]: validation.valid ? undefined : validation.error
    }));
    
    // Si valide et formaté, appliquer le format
    if (validation.valid && validation.formatted && field !== 'email') {
      // Ne pas auto-formater pendant la saisie pour l'email
    }
  };

  // Validation complète avant soumission
  const validateForm = (): boolean => {
    const errors: typeof formErrors = {};
    
    const firstNameResult = validateName(formData.firstName || '', 'prénom');
    if (!firstNameResult.valid) errors.firstName = firstNameResult.error;
    
    const lastNameResult = validateName(formData.lastName || '', 'nom');
    if (!lastNameResult.valid) errors.lastName = lastNameResult.error;
    
    const emailResult = validateEmail(formData.email || '');
    if (!emailResult.valid) errors.email = emailResult.error;
    
    // Vérifier si l'email existe déjà
    if (emailResult.valid && !editingUser) {
      const existingUser = users.find(u => u.email?.toLowerCase() === formData.email?.toLowerCase());
      if (existingUser) {
        errors.email = "Cet email est déjà utilisé par un autre compte";
      }
    }
    
    if (formData.role === UserRole.CLIENT && !formData.companyName?.trim()) {
      errors.companyName = "Le nom de la société est obligatoire pour un client";
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // --- HELPER: NORMALISATION DES RÔLES ---
  const normalizeRole = (role: string | undefined) => {
      if (!role) return '';
      return String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  };

  const isDriver = (role: string) => normalizeRole(role).includes('chauff') || normalizeRole(role).includes('driver');
  const isClient = (role: string) => normalizeRole(role).includes('client');

  // --- STATS ---
  const stats = useMemo(() => {
      const total = users.length;
      const drivers = users.filter(u => isDriver(u.role)).length;
      const clients = users.filter(u => isClient(u.role)).length;
      const staff = total - drivers - clients; 
      
      return { total, drivers, clients, staff };
  }, [users]);

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewUsers) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès à la gestion des utilisateurs.
        </p>
      </div>
    );
  }

  // --- FILTRAGE INTELLIGENT ---
  const filteredUsers = useMemo(() => {
      return users.filter(user => {
          const matchesSearch = 
            user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) || 
            user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) || 
            user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (user.companyName || '').toLowerCase().includes(searchTerm.toLowerCase());
          
          if (roleFilter === 'all') return matchesSearch;

          // Mapping du filtre selectionné vers la logique de normalisation
          const userRoleNorm = normalizeRole(user.role);
          let matchesRole = false;

          switch(roleFilter) {
              case UserRole.DRIVER: matchesRole = isDriver(user.role); break;
              case UserRole.CLIENT: matchesRole = isClient(user.role); break;
              case UserRole.SECRETARY: matchesRole = userRoleNorm.includes('secret') || userRoleNorm.includes('adminis'); break;
              case UserRole.DIRECTOR: matchesRole = userRoleNorm.includes('direct') || userRoleNorm.includes('dirigeant'); break;
              case UserRole.MECHANIC: matchesRole = userRoleNorm.includes('mecan'); break;
              case UserRole.INTERN: matchesRole = userRoleNorm.includes('stag'); break;
              default: matchesRole = user.role === roleFilter;
          }
          
          return matchesSearch && matchesRole;
      });
  }, [users, searchTerm, roleFilter]);

  // --- HELPERS UI (ICONES & BADGES) ---
  const getRoleIcon = (role: string) => {
      const n = normalizeRole(role);
      if (n.includes('presid')) return <Shield size={16} className="text-purple-600" />;
      if (n.includes('direct') || n.includes('dirigeant')) return <Briefcase size={16} className="text-blue-600" />;
      if (n.includes('secret') || n.includes('adminis')) return <Settings size={16} className="text-pink-600" />;
      if (n.includes('chauff') || n.includes('driver')) return <Truck size={16} className="text-green-600" />;
      if (n.includes('client')) return <Building2 size={16} className="text-indigo-600" />;
      if (n.includes('stag')) return <GraduationCap size={16} className="text-teal-600" />;
      if (n.includes('admin')) return <Shield size={16} className="text-red-600" />;
      return <UserIcon size={16} className="text-slate-600" />;
  };

  const getRoleBadge = (role: string) => {
      const n = normalizeRole(role);
      if (n.includes('presid')) return 'bg-purple-100 text-purple-700 border-purple-200';
      if (n.includes('direct') || n.includes('dirigeant')) return 'bg-blue-100 text-blue-700 border-blue-200';
      if (n.includes('secret') || n.includes('adminis')) return 'bg-pink-100 text-pink-700 border-pink-200';
      if (n.includes('chauff') || n.includes('driver')) return 'bg-green-100 text-green-700 border-green-200';
      if (n.includes('client')) return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      if (n.includes('stag')) return 'bg-teal-100 text-teal-700 border-teal-200';
      if (n.includes('admin')) return 'bg-red-100 text-red-700 border-red-200';
      return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  // --- HANDLERS ---
  const handleOpenAdd = () => {
      setEditingUser(null);
      setFormData({ 
          firstName: '', 
          lastName: '', 
          email: '', 
          role: UserRole.DRIVER, 
          leaveBalance: 25, 
          companyName: '',
          isHeavyGoodsDriver: false,
          fcoDate: '',
          medicalVisitDate: ''
      });
      setFormErrors({}); // Reset erreurs
      setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
      setEditingUser(user);
      setFormData({ ...user });
      setFormErrors({}); // Reset erreurs
      setIsModalOpen(true);
  };

  const handleDeleteClick = (user: User) => {
      setPendingAction({ type: 'DELETE', data: user });
      setIsConfirmOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      
      // Validation complète
      if (!validateForm()) {
        return;
      }
      
      if (!formData.email || !formData.firstName || !formData.lastName) return;

      // Normaliser l'email (lowercase, trim)
      const normalizedEmail = formData.email.toLowerCase().trim();
      
      // Formater les noms
      const firstNameResult = validateName(formData.firstName, 'prénom');
      const lastNameResult = validateName(formData.lastName, 'nom');
      
      const formattedFirstName = firstNameResult.formatted || formData.firstName;
      const formattedLastName = lastNameResult.formatted || formData.lastName;

      // VÉRIFICATION : Email déjà existant ?
      const emailExists = users.some(u => 
        u.email.toLowerCase().trim() === normalizedEmail && 
        u.id !== editingUser?.id // Ignorer l'utilisateur en cours d'édition
      );

      if (emailExists) {
        setFormErrors(prev => ({ ...prev, email: "Cet email est déjà utilisé par un autre compte" }));
        return;
      }

      if (editingUser) {
          // UPDATE
          setPendingAction({ type: 'UPDATE', data: { ...editingUser, ...formData, firstName: formattedFirstName, lastName: formattedLastName, email: normalizedEmail } });
      } else {
          // ADD
          const newUser: User = {
              ...formData as User,
              firstName: formattedFirstName,
              lastName: formattedLastName,
              email: normalizedEmail,
              id: `u-${Date.now()}`,
              // Avatar par défaut si non fourni
              avatarUrl: formData.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedFirstName)}+${encodeURIComponent(formattedLastName)}&background=random`
          };
          setPendingAction({ type: 'ADD', data: newUser });
      }
      setIsModalOpen(false); // Close form modal
      setIsConfirmOpen(true); // Open confirmation modal
  };

  const executeAction = async () => {
      if (!pendingAction || !currentUser) return;

      if (pendingAction.type === 'ADD' && onAddUser) {
          const userData = pendingAction.data;
          
          try {
            // ============================================================
            // FLUX ROBUSTE DE CRÉATION UTILISATEUR
            // ============================================================
            
            // ÉTAPE 1: Créer le profil utilisateur dans Firestore
            await onAddUser(userData);
            
            // ÉTAPE 2: Vérifier que le profil a bien été créé
            const { doc, getDoc } = await import('firebase/firestore');
            const { db } = await import('../firebaseConfig');
            
            // Attendre un peu pour la propagation Firestore
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const userDocRef = doc(db, 'users', userData.id);
            const userDocSnap = await getDoc(userDocRef);
            
            if (!userDocSnap.exists()) {
              throw new Error(`Le profil utilisateur n'a pas été créé correctement (ID: ${userData.id})`);
            }

            // ÉTAPE 3: Créer l'invitation avec TOUTES les infos du profil
            const { token, expiresAt } = await createInvitation(
              userData.email,
              userData.id,
              {
                id: currentUser.id,
                name: `${currentUser.firstName} ${currentUser.lastName}`
              },
              // Copie complète des infos pour reconstruction si nécessaire
              {
                firstName: userData.firstName,
                lastName: userData.lastName,
                role: userData.role
              }
            );
            
            // ÉTAPE 4: Envoyer l'email d'invitation
            const activationUrl = getActivationUrl(token);
            
            await sendUserInvitationEmail(
              {
                email: userData.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                role: userData.role
              },
              {
                firstName: currentUser.firstName,
                lastName: currentUser.lastName
              },
              activationUrl,
              expiresAt
            );
            
          } catch (error: any) {
            console.error('❌ Erreur création utilisateur:', error);
            alert(`Erreur lors de la création de l'utilisateur: ${error.message}\n\nVeuillez réessayer.`);
            // Ne pas fermer la modale en cas d'erreur
            setIsConfirmOpen(false);
            setPendingAction(null);
            return;
          }
      } 
      else if (pendingAction.type === 'UPDATE' && onUpdateUser) {
          await onUpdateUser(pendingAction.data);
      }
      else if (pendingAction.type === 'DELETE' && onDeleteUser) {
          await onDeleteUser(pendingAction.data.id, pendingAction.data.email);
      }

      setIsConfirmOpen(false);
      setPendingAction(null);
      setEditingUser(null);
  };
  
  // Fonction pour renvoyer une invitation
  const handleResendInvitation = async (user: User) => {
    if (!currentUser) return;
    
    setActionLoading(user.id);
    setOpenMenuId(null);
    
    try {
      const result = await resendInvitation(
        user.email,
        {
          id: currentUser.id,
          name: `${currentUser.firstName} ${currentUser.lastName}`
        }
      );
      
      if (result) {
        const activationUrl = getActivationUrl(result.token);
        
        await sendUserInvitationEmail(
          {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role
          },
          {
            firstName: currentUser.firstName,
            lastName: currentUser.lastName
          },
          activationUrl,
          result.expiresAt
        );
        
        alert(`✅ Invitation renvoyée à ${user.email}`);
      } else {
        alert('❌ Erreur lors du renvoi de l\'invitation');
      }
    } catch (error) {
      console.error('Erreur renvoi invitation:', error);
      alert('❌ Erreur lors du renvoi de l\'invitation');
    } finally {
      setActionLoading(null);
    }
  };

  // Fonction pour désactiver/réactiver un compte
  const handleToggleUserStatus = async (user: User) => {
    const isCurrentlyDisabled = user.isDisabled;
    const action = isCurrentlyDisabled ? 'réactiver' : 'désactiver';
    
    if (!confirm(`Voulez-vous ${action} le compte de ${user.firstName} ${user.lastName} ?`)) {
      return;
    }
    
    setActionLoading(user.id);
    setOpenMenuId(null);
    
    try {
      const result = await toggleUserStatus(user.id, user.email, !isCurrentlyDisabled);
      
      if (result.success) {
        alert(`✅ ${result.message}`);
        // Rafraîchir la liste (le listener Firestore devrait le faire automatiquement)
      } else {
        alert(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error('Erreur toggle status:', error);
      alert('❌ Erreur lors de la modification du statut');
    } finally {
      setActionLoading(null);
    }
  };

  // Fonction pour forcer la réinitialisation du mot de passe
  const handleForcePasswordReset = async (user: User) => {
    if (!confirm(`Envoyer un email de réinitialisation de mot de passe à ${user.email} ?`)) {
      return;
    }
    
    setActionLoading(user.id);
    setOpenMenuId(null);
    
    try {
      const result = await forcePasswordReset(user.id, user.email);
      
      if (result.success) {
        alert(`✅ ${result.message}`);
      } else {
        alert(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error('Erreur reset password:', error);
      alert('❌ Erreur lors de l\'envoi du reset');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in relative pb-10">
        
        {/* --- HEADER STATS --- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase">Total Utilisateurs</p>
                <div className="flex justify-between items-center mt-1">
                    <h3 className="text-2xl font-extrabold text-slate-900">{stats.total}</h3>
                    <Users className="text-slate-300" />
                </div>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase">Chauffeurs</p>
                <div className="flex justify-between items-center mt-1">
                    <h3 className="text-2xl font-extrabold text-green-600">{stats.drivers}</h3>
                    <Truck className="text-green-200" />
                </div>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase">Clients</p>
                <div className="flex justify-between items-center mt-1">
                    <h3 className="text-2xl font-extrabold text-indigo-600">{stats.clients}</h3>
                    <Building2 className="text-indigo-200" />
                </div>
            </div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <p className="text-xs font-bold text-slate-400 uppercase">Staff & Admin</p>
                <div className="flex justify-between items-center mt-1">
                    <h3 className="text-2xl font-extrabold text-slate-600">{stats.staff}</h3>
                    <Shield className="text-slate-200" />
                </div>
            </div>
        </div>

        {/* --- TOOLBAR AVEC ACTIONS CLAIRES --- */}
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex flex-col xl:flex-row justify-between items-center gap-4 sticky top-4 z-20">
            {/* Barre de Recherche & Filtres */}
            <div className="flex flex-col md:flex-row items-center gap-3 w-full xl:w-auto">
                <div className="relative w-full md:w-64">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        placeholder="Rechercher..." 
                        className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm font-medium focus:ring-2 focus:ring-brand-100 outline-none transition-all text-slate-800"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                
                <div className="relative w-full md:w-auto">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        <Filter size={16} />
                    </div>
                    <select 
                        value={roleFilter}
                        onChange={(e) => setRoleFilter(e.target.value)}
                        className="w-full md:w-auto appearance-none bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-sm rounded-xl pl-10 pr-8 py-2.5 outline-none cursor-pointer transition-all border-none focus:ring-2 focus:ring-brand-100"
                    >
                        <option value="all">Tous les rôles</option>
                        <option value={UserRole.DRIVER}>Chauffeurs</option>
                        <option value={UserRole.CLIENT}>Clients</option>
                        <option value={UserRole.SECRETARY}>Administratif</option>
                        <option value={UserRole.DIRECTOR}>Direction</option>
                        <option value={UserRole.MECHANIC}>Mécanicien</option>
                        <option value={UserRole.INTERN}>Stagiaires</option>
                    </select>
                </div>
                
                {/* Switch Grid/List */}
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-400'}`}><LayoutGrid size={20} /></button>
                    <button onClick={() => setViewMode('list')} className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-brand-600' : 'text-slate-400'}`}><List size={20} /></button>
                </div>
            </div>

            {/* Boutons d'Action */}
            <div className="w-full xl:w-auto flex justify-end gap-2">
                {canDeleteUser && (
                    <button
                        onClick={handleCleanupDuplicates}
                        disabled={isCleaning}
                        title="Détecte et supprime les profils en double laissés par la migration de compte"
                        className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all text-sm whitespace-nowrap disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={isCleaning ? 'animate-spin' : ''} />
                        {isCleaning ? 'Nettoyage…' : 'Nettoyer les doublons'}
                    </button>
                )}
                {canCreateUser && (
                    <button
                        onClick={handleOpenAdd}
                        className="bg-slate-900 hover:bg-black text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg hover:shadow-xl transition-all text-sm whitespace-nowrap"
                    >
                        <UserPlus size={18} /> Ajouter un Utilisateur
                    </button>
                )}
            </div>
        </div>

        {/* --- GRID VIEW (CARDS INTERACTIVES) --- */}
        {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                {filteredUsers.map((user) => (
                    <div 
                        key={user.id} 
                        className={`bg-white rounded-2xl p-6 shadow-sm border transition-all relative group ${
                          user.isDisabled 
                            ? 'border-red-200 bg-red-50/30' 
                            : 'border-slate-200 hover:shadow-md'
                        }`}
                    >
                        {/* Badge compte désactivé */}
                        {user.isDisabled && (
                          <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-xs font-bold py-1 text-center">
                            <Ban size={12} className="inline mr-1" />
                            COMPTE DÉSACTIVÉ
                          </div>
                        )}
                        
                        {/* Loading overlay */}
                        {actionLoading === user.id && (
                          <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
                          </div>
                        )}
                        
                        {/* Action Menu Top Right */}
                        {canEdit && (
                            <div className="absolute top-4 right-4 z-10">
                                <div className="relative">
                                    <button 
                                        onClick={() => setOpenMenuId(openMenuId === user.id ? null : user.id)}
                                        className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg shadow-sm border border-slate-200 transition-colors"
                                        title="Actions"
                                    >
                                        <MoreVertical size={16} />
                                    </button>
                                    
                                    {/* Dropdown Menu */}
                                    {openMenuId === user.id && (
                                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                                            <button
                                                onClick={() => { handleOpenEdit(user); setOpenMenuId(null); }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                                            >
                                                <Edit size={16} className="text-slate-400" />
                                                Modifier
                                            </button>
                                            
                                            <button
                                                onClick={() => handleResendInvitation(user)}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                                            >
                                                <Send size={16} className="text-slate-400" />
                                                Renvoyer l'invitation
                                            </button>
                                            
                                            <button
                                                onClick={() => handleForcePasswordReset(user)}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                                            >
                                                <Key size={16} className="text-slate-400" />
                                                Réinitialiser le mot de passe
                                            </button>
                                            
                                            <div className="border-t border-slate-100 my-2"></div>
                                            
                                            <button
                                                onClick={() => handleToggleUserStatus(user)}
                                                className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 ${
                                                  user.isDisabled ? 'text-green-600' : 'text-orange-600'
                                                }`}
                                            >
                                                {user.isDisabled ? (
                                                  <>
                                                    <RefreshCw size={16} />
                                                    Réactiver le compte
                                                  </>
                                                ) : (
                                                  <>
                                                    <Ban size={16} />
                                                    Désactiver le compte
                                                  </>
                                                )}
                                            </button>
                                            
                                            <button
                                                onClick={() => { handleDeleteClick(user); setOpenMenuId(null); }}
                                                className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 flex items-center gap-3 text-red-600"
                                            >
                                                <Trash2 size={16} />
                                                Supprimer définitivement
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex items-start gap-4 mb-4">
                            <img 
                                src={user.avatarUrl} 
                                alt={user.firstName} 
                                className="w-14 h-14 rounded-xl border border-slate-100 object-cover bg-slate-50 flex-shrink-0"
                            />
                            <div className="min-w-0 pr-8"> 
                                <h3 className="text-lg font-bold text-slate-800 truncate" title={`${user.firstName} ${user.lastName}`}>
                                    {user.firstName} {user.lastName}
                                </h3>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getRoleBadge(user.role)}`}>
                                        {getRoleIcon(user.role)}
                                        {user.role}
                                    </div>
                                    
                                    {/* INDICATEUR PL DISCRET ET DISTINCT */}
                                    {user.isHeavyGoodsDriver && (
                                        <div className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-slate-800 text-white border border-slate-900 shadow-sm" title="Chauffeur Poids Lourd">
                                            PL
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        
                        <div className="space-y-3 pt-2">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <Mail size={14} className="text-slate-400" />
                                <span className="truncate">{user.email}</span>
                            </div>

                            <div className="flex items-center gap-2 text-xs text-slate-500" title={user.lastLoginAt ? `Dernière connexion : ${formatDateTimeFr(user.lastLoginAt)}` : ''}>
                                <Clock size={13} className={user.lastLoginAt ? 'text-slate-400' : 'text-slate-300'} />
                                <span>Dernière connexion : <span className={`font-semibold ${user.lastLoginAt ? 'text-slate-700' : 'text-slate-400'}`}>{timeAgo(user.lastLoginAt)}</span></span>
                            </div>

                            {isClient(user.role) && user.companyName && (
                                <div className="flex items-center gap-2 text-sm text-slate-600 bg-indigo-50 p-2 rounded-lg border border-indigo-100">
                                    <Building2 size={14} className="text-indigo-500" />
                                    <span className="font-bold text-indigo-900 truncate">{user.companyName}</span>
                                </div>
                            )}

                            {isDriver(user.role) && (
                                <div className="flex flex-col gap-2 mt-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-bold">Solde Congés</span>
                                        <span className="font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">{user.leaveBalance}j</span>
                                    </div>
                                    
                                    {user.isHeavyGoodsDriver && (
                                        <>
                                            <div className="w-full h-px bg-slate-200 my-1"></div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-slate-400 uppercase font-bold flex items-center gap-1"><Calendar size={9}/> FCO/FIMO</span>
                                                    <span className={`text-xs font-bold ${!user.fcoDate ? 'text-slate-400' : 'text-slate-800'}`}>
                                                        {user.fcoDate ? new Date(user.fcoDate).toLocaleDateString() : '-'}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col text-right">
                                                    <span className="text-[9px] text-slate-400 uppercase font-bold flex items-center gap-1 justify-end"><HeartPulse size={9}/> Médical</span>
                                                    <span className={`text-xs font-bold ${!user.medicalVisitDate ? 'text-slate-400' : 'text-slate-800'}`}>
                                                        {user.medicalVisitDate ? new Date(user.medicalVisitDate).toLocaleDateString() : '-'}
                                                    </span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        )}

        {/* --- LIST VIEW --- */}
        {viewMode === 'list' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Utilisateur</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Rôle</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Statut</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Dernière connexion</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Détails</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} className={`transition-colors ${user.isDisabled ? 'bg-red-50/50' : 'hover:bg-slate-50'}`}>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs overflow-hidden">
                                                    {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : user.firstName[0]}
                                                </div>
                                                {user.isDisabled && (
                                                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                                                        <Ban size={10} className="text-white" />
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className={`font-bold text-sm ${user.isDisabled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                                                    {user.firstName} {user.lastName}
                                                </div>
                                                <div className="text-xs text-slate-500">{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${getRoleBadge(user.role)}`}>
                                                {getRoleIcon(user.role)} {user.role}
                                            </span>
                                            {user.isHeavyGoodsDriver && (
                                                <span className="bg-slate-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-900" title="Chauffeur PL">PL</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        {user.isDisabled ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                                                <Ban size={12} /> Désactivé
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                                                <CheckCircle size={12} /> Actif
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap" title={user.lastLoginAt ? formatDateTimeFr(user.lastLoginAt) : ''}>
                                        <span className={`text-sm ${user.lastLoginAt ? 'text-slate-700' : 'text-slate-400'}`}>{timeAgo(user.lastLoginAt)}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {isClient(user.role) ? (
                                            <div className="flex items-center gap-2 text-sm font-bold text-indigo-900">
                                                <Building2 size={14} className="text-indigo-400" />
                                                {user.companyName || '-'}
                                            </div>
                                        ) : isDriver(user.role) ? (
                                            <div className="flex flex-wrap gap-3">
                                                <span className="text-[10px] font-bold bg-slate-50 text-slate-600 px-2 py-0.5 rounded border border-slate-200">Congés: {user.leaveBalance}j</span>
                                                {user.isHeavyGoodsDriver && (
                                                    <>
                                                        <span className="text-[10px] font-medium text-slate-500 flex items-center gap-1">
                                                            <Calendar size={10}/> FCO: {user.fcoDate ? new Date(user.fcoDate).toLocaleDateString() : 'N/A'}
                                                        </span>
                                                        <span className="text-[10px] font-medium text-slate-500 flex items-center gap-1">
                                                            <HeartPulse size={10}/> Méd: {user.medicalVisitDate ? new Date(user.medicalVisitDate).toLocaleDateString() : 'N/A'}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-400 italic">Interne</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        {canEdit && (
                                            <div className="relative inline-block">
                                                {actionLoading === user.id ? (
                                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600"></div>
                                                ) : (
                                                    <>
                                                        <button 
                                                            onClick={() => setOpenMenuId(openMenuId === user.id ? null : user.id)}
                                                            className="text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition-colors"
                                                            title="Actions"
                                                        >
                                                            <MoreVertical size={16} />
                                                        </button>
                                                        
                                                        {openMenuId === user.id && (
                                                            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                                                                <button
                                                                    onClick={() => { handleOpenEdit(user); setOpenMenuId(null); }}
                                                                    className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                                                                >
                                                                    <Edit size={16} className="text-slate-400" />
                                                                    Modifier
                                                                </button>
                                                                
                                                                <button
                                                                    onClick={() => handleResendInvitation(user)}
                                                                    className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                                                                >
                                                                    <Send size={16} className="text-slate-400" />
                                                                    Renvoyer l'invitation
                                                                </button>
                                                                
                                                                <button
                                                                    onClick={() => handleForcePasswordReset(user)}
                                                                    className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                                                                >
                                                                    <Key size={16} className="text-slate-400" />
                                                                    Réinitialiser le mot de passe
                                                                </button>
                                                                
                                                                <div className="border-t border-slate-100 my-2"></div>
                                                                
                                                                <button
                                                                    onClick={() => handleToggleUserStatus(user)}
                                                                    className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-3 ${
                                                                      user.isDisabled ? 'text-green-600' : 'text-orange-600'
                                                                    }`}
                                                                >
                                                                    {user.isDisabled ? (
                                                                      <>
                                                                        <RefreshCw size={16} />
                                                                        Réactiver le compte
                                                                      </>
                                                                    ) : (
                                                                      <>
                                                                        <Ban size={16} />
                                                                        Désactiver le compte
                                                                      </>
                                                                    )}
                                                                </button>
                                                                
                                                                <button
                                                                    onClick={() => { handleDeleteClick(user); setOpenMenuId(null); }}
                                                                    className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 flex items-center gap-3 text-red-600"
                                                                >
                                                                    <Trash2 size={16} />
                                                                    Supprimer définitivement
                                                                </button>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* --- ADD / EDIT USER MODAL --- */}
        <Modal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title={editingUser ? 'Modifier le profil' : 'Nouvel Utilisateur'}
            size="lg"
            headerIcon={<UserPlus size={20} />}
        >
            <form onSubmit={handleFormSubmit} className="space-y-6">
                
                {/* --- ROLE SELECTION --- */}
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Type de Compte</label>
                    <div className="grid grid-cols-2 gap-3">
                        {[
                            { val: UserRole.DRIVER, label: 'Chauffeur', icon: Truck },
                            { val: UserRole.CLIENT, label: 'Client', icon: Building2 },
                            { val: UserRole.SECRETARY, label: 'Administratif', icon: Settings },
                            { val: UserRole.DIRECTOR, label: 'Direction', icon: Briefcase },
                            { val: UserRole.MECHANIC, label: 'Mécanicien', icon: Settings },
                            { val: UserRole.INTERN, label: 'Stagiaire', icon: GraduationCap },
                            { val: UserRole.ADMIN, label: 'Admin Système', icon: Shield }
                        ].map((opt) => (
                            <button
                                key={opt.val}
                                type="button"
                                onClick={() => setFormData({...formData, role: opt.val})}
                                className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-bold transition-all ${
                                    formData.role === opt.val 
                                    ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-[1.02]' 
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                                            }`}
                                        >
                                            <opt.icon size={16} /> {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-4 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prénom <span className="text-red-500">*</span></label>
                                        <input 
                                            required 
                                            type="text" 
                                            className={`w-full px-4 py-2.5 border rounded-xl outline-none focus:ring-2 text-slate-900 font-bold ${
                                              formErrors.firstName 
                                                ? 'border-red-400 focus:ring-red-500 bg-red-50' 
                                                : 'border-slate-300 focus:ring-brand-500'
                                            }`} 
                                            value={formData.firstName} 
                                            onChange={e => handleFieldChange('firstName', e.target.value)}
                                            onBlur={e => {
                                              // Formater au blur
                                              const result = validateName(e.target.value, 'prénom');
                                              if (result.valid && result.formatted) {
                                                setFormData(prev => ({ ...prev, firstName: result.formatted }));
                                              }
                                            }}
                                        />
                                        {formErrors.firstName && (
                                          <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                            <AlertCircle size={12} /> {formErrors.firstName}
                                          </p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nom <span className="text-red-500">*</span></label>
                                        <input 
                                            required 
                                            type="text" 
                                            className={`w-full px-4 py-2.5 border rounded-xl outline-none focus:ring-2 text-slate-900 font-bold ${
                                              formErrors.lastName 
                                                ? 'border-red-400 focus:ring-red-500 bg-red-50' 
                                                : 'border-slate-300 focus:ring-brand-500'
                                            }`} 
                                            value={formData.lastName} 
                                            onChange={e => handleFieldChange('lastName', e.target.value)}
                                            onBlur={e => {
                                              const result = validateName(e.target.value, 'nom');
                                              if (result.valid && result.formatted) {
                                                setFormData(prev => ({ ...prev, lastName: result.formatted }));
                                              }
                                            }}
                                        />
                                        {formErrors.lastName && (
                                          <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                            <AlertCircle size={12} /> {formErrors.lastName}
                                          </p>
                                        )}
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email Professionnel <span className="text-red-500">*</span></label>
                                    <input 
                                        required 
                                        type="email" 
                                        disabled={!!editingUser}
                                        className={`w-full px-4 py-2.5 border rounded-xl outline-none focus:ring-2 text-slate-900 font-medium ${
                                          editingUser 
                                            ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-300' 
                                            : formErrors.email 
                                              ? 'border-red-400 focus:ring-red-500 bg-red-50' 
                                              : 'border-slate-300 focus:ring-brand-500'
                                        }`} 
                                        value={formData.email} 
                                        onChange={e => handleFieldChange('email', e.target.value)}
                                        onBlur={e => {
                                          const result = validateEmail(e.target.value);
                                          if (result.valid && result.formatted) {
                                            setFormData(prev => ({ ...prev, email: result.formatted }));
                                          }
                                        }}
                                    />
                                    {formErrors.email && (
                                      <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                        <AlertCircle size={12} /> {formErrors.email}
                                      </p>
                                    )}
                                    {!editingUser && !formErrors.email && <p className="text-xs text-slate-500 mt-1">L'utilisateur recevra une invitation par email.</p>}
                                </div>
                            </div>

                            {/* --- SPECIFIC FIELDS BASED ON ROLE --- */}
                            {formData.role === UserRole.CLIENT && (
                                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 animate-fade-in">
                                    <label className="block text-xs font-bold text-indigo-700 uppercase mb-1">Nom de la Société</label>
                                    <div className="relative">
                                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400" size={18} />
                                        <input required type="text" className="w-full pl-10 pr-4 py-2.5 border border-indigo-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-indigo-900 font-bold bg-white" placeholder="Entreprise SAS" value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} />
                                    </div>
                                </div>
                            )}

                            {formData.role === UserRole.DRIVER && (
                                <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 animate-fade-in">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Congés (Jours)</label>
                                        <input type="number" step="0.5" className="w-full px-4 py-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 text-slate-900 font-bold bg-white" value={formData.leaveBalance} onChange={e => setFormData({...formData, leaveBalance: Number(e.target.value)})} />
                                    </div>
                                    <div className="flex items-center gap-3 pt-2">
                                        <input type="checkbox" id="pl" className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-gray-300" checked={formData.isHeavyGoodsDriver} onChange={e => setFormData({...formData, isHeavyGoodsDriver: e.target.checked})} />
                                        <label htmlFor="pl" className="text-sm font-bold text-slate-700">Permis Poids Lourd (Active le suivi FCO/FIMO)</label>
                                    </div>

                                    {/* PL SPECIFIC FIELDS */}
                                    {formData.isHeavyGoodsDriver && (
                                        <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-white rounded-lg border border-slate-200 shadow-sm animate-fade-in">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Validité FCO/FIMO</label>
                                                <input 
                                                    type="date" 
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none text-slate-900"
                                                    value={formData.fcoDate || ''} 
                                                    onChange={e => setFormData({...formData, fcoDate: e.target.value})} 
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Prochaine Visite Médicale</label>
                                                <input 
                                                    type="date" 
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none text-slate-900"
                                                    value={formData.medicalVisitDate || ''} 
                                                    onChange={e => setFormData({...formData, medicalVisitDate: e.target.value})} 
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button type="submit" className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold shadow-lg mt-2 flex items-center justify-center gap-2">
                                <Save size={18} /> {editingUser ? 'Enregistrer les modifications' : 'Créer le profil'}
                            </button>
                        </form>
        </Modal>

        {/* --- CONFIRMATION MODAL --- */}
        {pendingAction && (
            <ConfirmModal 
                isOpen={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                onConfirm={executeAction}
                title={pendingAction.type === 'DELETE' ? "Supprimer l'utilisateur ?" : pendingAction.type === 'UPDATE' ? "Mettre à jour ?" : "Créer le compte ?"}
                message={
                    pendingAction.type === 'DELETE' 
                    ? `Êtes-vous sûr de vouloir supprimer définitivement ${pendingAction.data?.firstName} ${pendingAction.data?.lastName} ? Cette action est irréversible.`
                    : pendingAction.type === 'UPDATE'
                    ? `Confirmez-vous les modifications pour ${pendingAction.data?.firstName} ?`
                    : `Confirmez-vous la création du compte pour ${pendingAction.data?.firstName} ${pendingAction.data?.lastName} ?`
                }
                type={pendingAction.type === 'DELETE' ? "danger" : "success"}
                confirmLabel={pendingAction.type === 'DELETE' ? "Supprimer" : "Confirmer"}
            />
        )}
    </div>
  );
};

export default UserManager;
