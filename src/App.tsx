
import React, { useState, useMemo, useEffect, Suspense, lazy } from 'react';
// @ts-ignore
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebaseConfig";
// Composants légers chargés immédiatement (shell UI)
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { setLogUser } from './services/logService';
import MobileNavBar from './components/MobileNavBar';
import QuickScanButton from './components/QuickScanButton';
import NotificationCenter from './components/NotificationCenter';
import ViewAsSwitcher from './components/ViewAsSwitcher';
import Login from './components/Login';
import { useDriverLocationPublisher } from './hooks/useDriverLocationPublisher';
import { Menu, Loader2, WifiOff } from 'lucide-react';

// === CODE SPLITTING : Lazy loading de tous les composants lourds ===
const Dashboard = lazy(() => import('./components/Dashboard'));
const VehicleList = lazy(() => import('./components/VehicleList').then(m => ({ default: m.VehicleList })));
const DriverList = lazy(() => import('./components/DriverList'));
const FuelManager = lazy(() => import('./components/FuelManager').then(m => ({ default: m.FuelManager })));
const MaintenanceManager = lazy(() => import('./components/MaintenanceManager'));
const IssueManager = lazy(() => import('./components/IssueManager'));
const UserManager = lazy(() => import('./components/UserManager'));
const AIAdvisor = lazy(() => import('./components/AIAdvisor'));
const FleetMap = lazy(() => import('./components/FleetMap'));
const FleetMapView = lazy(() => import('./components/FleetMapView'));
const ClientPortal = lazy(() => import('./components/ClientPortal'));
const QuoteManager = lazy(() => import('./components/QuoteManager'));
const AbsenceManager = lazy(() => import('./components/AbsenceManager'));
const DocumentManager = lazy(() => import('./components/DocumentManager'));
const DocumentAlertModal = lazy(() => import('./components/DocumentAlertModal'));
const ActivityLogs = lazy(() => import('./components/ActivityLogs'));
const MissionManager = lazy(() => import('./components/MissionManager'));
const Settings = lazy(() => import('./components/Settings'));
const ApiDiagnostic = lazy(() => import('./components/ApiDiagnostic'));
const VehicleDetail = lazy(() => import('./components/VehicleDetail'));
const ActivateAccount = lazy(() => import('./components/ActivateAccount'));
const HelpCenter = lazy(() => import('./components/HelpCenter'));
const DriverMissionView = lazy(() => import('./components/DriverMissionView'));
const PermissionsManager = lazy(() => import('./components/PermissionsManager'));
const DeliveryScheduleSettings = lazy(() => import('./components/DeliveryScheduleSettings'));
const ZoneManager = lazy(() => import('./components/ZoneManager'));
const HubOperations = lazy(() => import('./components/HubOperations'));
const DriverTourView = lazy(() => import('./components/DriverTourView'));
const PresidentOverview = lazy(() => import('./components/PresidentOverview'));

// FIREBASE SERVICES
import { 
  subscribeToVehicles, 
  addVehicleToFirestore, 
  updateVehicleInFirestore, 
  deleteVehicleFromFirestore,
  subscribeToFuelLogs,
  addFuelLogToFirestore,
  updateFuelLogInFirestore,
  subscribeToMaintenance,
  subscribeToIssues,
  addIssueToFirestore,
  updateIssueInFirestore,
  subscribeToUsers,
  getUserProfile,
  recordUserLogin,
  subscribeToUserProfile, 
  createUserProfile,
  updateUserProfile,
  deleteUserProfile,
  subscribeToLeaves,
  addLeaveToFirestore,
  updateLeaveInFirestore,
  deleteLeaveFromFirestore,
  subscribeToAbsences,
  addAbsenceToFirestore,
  updateAbsenceInFirestore,
  deleteAbsenceFromFirestore,
  uploadAbsenceDocument,
  subscribeToQuotes,
  addQuoteToFirestore,
  updateQuoteInFirestore,
  linkAuthToProfile,
  subscribeToCompanyDocuments,
  addCompanyDocumentToFirestore,
  updateCompanyDocumentInFirestore,
  deleteCompanyDocumentFromFirestore,
  subscribeToDocumentAcknowledgments,
  addDocumentAcknowledgmentToFirestore
} from './services/firestore';

import { logActivity } from './services/activityLogService';
import { convertQuoteToPackage } from './services/deliveryService';
import { ActivityAction, ActivityCategory } from './types';

import {
  ViewState, User, UserRole, Vehicle, FuelLog, MaintenanceLog,
  Issue, LeaveRequest, QuoteRequest, QuoteStatus, IssueStatus,
  LeaveStatus, AbsenceStatus,
  CompanyDocument, DocumentAcknowledgment, Absence, AbsenceDocument, AbsenceType
} from './types';

import { PermissionsProvider } from './usePermissions';
import { pathToView, viewToPath } from './routes';

// === Composant de chargement pour Suspense ===
const PageLoader: React.FC = () => (
  <div className="flex items-center justify-center h-full min-h-[400px]">
    <div className="text-center">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-3" />
      <p className="text-slate-500 text-sm">Chargement...</p>
    </div>
  </div>
);

const App: React.FC = () => {
  // --- AUTH STATE ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Navigation — vue initiale dérivée de l'URL (deep-link / rafraîchissement)
  const [currentView, setCurrentView] = useState<ViewState>(() => pathToView(window.location.pathname));
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Network State
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Data (Initialisé vide, rempli par Firebase)
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  // Publie la position du chauffeur connecté (~30s) pour la carte dispatch
  useDriverLocationPublisher(currentUser);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [companyDocuments, setCompanyDocuments] = useState<CompanyDocument[]>([]);
  const [documentAcknowledgments, setDocumentAcknowledgments] = useState<DocumentAcknowledgment[]>([]);

  // Selection for Detail Views
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [targetIssueVehicleId, setTargetIssueVehicleId] = useState<string | null>(null);

  // --- ROUTAGE URL : chaque vue a une URL (deep-link, refresh, retour navigateur) ---
  useEffect(() => {
    // Ne JAMAIS réécrire l'URL tant qu'un lien d'activation (?token=) est présent :
    // sinon on écrase le token avant que la page d'activation ne puisse le lire.
    if (new URLSearchParams(window.location.search).get('token')) return;
    const path = viewToPath(currentView);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  }, [currentView]);
  useEffect(() => {
    const onPop = () => setCurrentView(pathToView(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // --- ONLINE / OFFLINE DETECTION ---
  useEffect(() => {
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
      };
  }, []);

  // --- CONTEXTE DES LOGS D'ERREUR ---
  // Attache l'utilisateur courant à toute erreur loguée (error_logs) et vide
  // le tampon local vers Firestore dès qu'on est connecté.
  useEffect(() => {
    setLogUser(currentUser);
  }, [currentUser]);

  // --- 1. AUTHENTICATION & PROFILE LISTENER ---
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser: any) => {
      setIsAuthLoading(true);
      
      if (firebaseUser) {
        try {
            // ETAPE 1 : VÉRIFICATION D'ACCÈS
            // On vérifie si le profil existe via son UID.
            let existingProfile = await getUserProfile(firebaseUser.uid);

            // LOGIQUE DE RÉCUPÉRATION (Recovery)
            if (!existingProfile && firebaseUser.email) {
                console.log("Profil introuvable par UID. Tentative de récupération par email...");
                try {
                    await linkAuthToProfile(firebaseUser.email, firebaseUser.uid);
                    existingProfile = await getUserProfile(firebaseUser.uid);
                } catch (recoveryError) {
                    console.error("Échec de la récupération automatique du profil :", recoveryError);
                }
            }

            if (existingProfile) {
                // ACCÈS AUTORISÉ
                setCurrentUser(existingProfile);

                // Enregistrer la dernière connexion (non bloquant)
                recordUserLogin(firebaseUser.uid);

                // REDIRECTION SÉCURITÉ CLIENT
                // Si l'utilisateur est un client, on le force vers le tableau de bord client
                const role = String(existingProfile.role || '').toLowerCase();
                if (role.includes('client')) {
                    // Honorer l'URL si c'est une vue client autorisée (deep-link/refresh), sinon accueil
                    const allowed = ['client_dashboard', 'client_list', 'client_shipments', 'client_tracking', 'client_team', 'client_analytics', 'client_recipients', 'client_company', 'client_help', 'help', 'settings'];
                    setCurrentView(prev => allowed.includes(prev) ? prev : 'client_dashboard');
                }
                // Si l'utilisateur est un stagiaire, pas de tableau de bord - redirect vers véhicules
                if (role.includes('stag')) {
                    setCurrentView('vehicles');
                }

                // ETAPE 2 : ABONNEMENT TEMPS RÉEL
                if (unsubscribeProfile) unsubscribeProfile();
                
                unsubscribeProfile = subscribeToUserProfile(firebaseUser.uid, (updatedProfile) => {
                    if (updatedProfile) {
                        setCurrentUser(prev => {
                            if (JSON.stringify(prev) === JSON.stringify(updatedProfile)) return prev;
                            return updatedProfile;
                        });
                        // Vérification continue du rôle en temps réel
                        const updatedRole = String(updatedProfile.role || '').toLowerCase();
                        if (updatedRole.includes('client') && !['client_dashboard', 'client_list', 'client_shipments', 'client_tracking', 'client_team', 'client_analytics', 'client_recipients', 'client_company', 'client_help', 'help', 'settings'].includes(currentView)) {
                             setCurrentView('client_dashboard');
                        }
                        // Stagiaire ne peut pas accéder au dashboard
                        if (updatedRole.includes('stag') && currentView === 'dashboard') {
                             setCurrentView('vehicles');
                        }
                    } else {
                        signOut(auth);
                        setCurrentUser(null);
                    }
                });
            } else {
                console.error("Aucun profil trouvé pour cet utilisateur (UID: " + firebaseUser.uid + "). Accès refusé.");
                await signOut(auth);
                setCurrentUser(null);
                alert("Votre compte n'est pas associé à un profil autorisé. Contactez l'administrateur si vous pensez qu'il s'agit d'une erreur.");
            }

        } catch (error) {
            console.error("Erreur critique lors du chargement du profil:", error);
            await signOut(auth);
        } finally {
            setIsAuthLoading(false);
        }
      } else {
        setCurrentUser(null);
        if (unsubscribeProfile) {
            unsubscribeProfile();
            unsubscribeProfile = null;
        }
        setIsAuthLoading(false);
      }
    });

    return () => {
        unsubscribeAuth();
        if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  // --- 2. DATA SUBSCRIPTIONS (Only if logged in) ---
  useEffect(() => {
    if (!currentUser) return;

    // SECURE: We pass currentUser to filter data server-side (for Users and Quotes)
    const unsubscribeVehicles = subscribeToVehicles(setVehicles);
    const unsubscribeFuel = subscribeToFuelLogs(setFuelLogs);
    const unsubscribeMaint = subscribeToMaintenance(setMaintenanceLogs);
    const unsubscribeIssues = subscribeToIssues(setIssues);
    const unsubscribeUsers = subscribeToUsers(currentUser, setUsers);
    const unsubscribeLeaves = subscribeToLeaves(setLeaves);
    const unsubscribeAbsences = subscribeToAbsences(setAbsences);
    const unsubscribeQuotes = subscribeToQuotes(currentUser, setQuotes);
    const unsubscribeDocs = subscribeToCompanyDocuments(setCompanyDocuments);
    const unsubscribeAcks = subscribeToDocumentAcknowledgments(setDocumentAcknowledgments);

    return () => {
      unsubscribeVehicles();
      unsubscribeFuel();
      unsubscribeMaint();
      unsubscribeIssues();
      unsubscribeUsers();
      unsubscribeLeaves();
      unsubscribeAbsences();
      unsubscribeQuotes();
      unsubscribeDocs();
      unsubscribeAcks();
    };
  }, [currentUser?.id, currentUser?.role]);

  // --- DERIVED STATE ---
  const selectedVehicle = useMemo(() => 
    vehicles.find(v => v.id === selectedVehicleId) || null
  , [vehicles, selectedVehicleId]);

  // Calcul des documents en attente de signature pour l'utilisateur courant
  const pendingDocumentsCount = useMemo(() => {
    if (!currentUser) return 0;
    
    // Helper pour normaliser les rôles
    const normalizeRole = (role: string | UserRole): UserRole => {
      const r = String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (r.includes('admin')) return UserRole.ADMIN;
      if (r.includes('presiden')) return UserRole.PRESIDENT;
      if (r.includes('direction') || r.includes('directeur')) return UserRole.DIRECTOR;
      if (r.includes('secret')) return UserRole.SECRETARY;
      if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
      if (r.includes('mecan') || r.includes('mech')) return UserRole.MECHANIC;
      if (r.includes('client')) return UserRole.CLIENT;
      return role as UserRole;
    };
    
    const effectiveRole = normalizeRole(currentUser.role);
    
    // Documents concernant l'utilisateur
    const myDocs = companyDocuments.filter(doc => {
      if (!doc.isActive) return false;
      if (doc.targetRoles.length === 0) return true;
      return doc.targetRoles.includes(effectiveRole);
    });
    
    // Documents non signés
    return myDocs.filter(doc => {
      const ack = documentAcknowledgments.find(a => 
        a.documentId === doc.id && 
        a.userId === currentUser.id &&
        a.documentVersion === doc.version
      );
      if (!ack) return true;
      if (doc.requiresSignature && ack.status !== 'SIGNED') return true;
      return false;
    }).length;
  }, [companyDocuments, documentAcknowledgments, currentUser]);

  // Badges de comptage pour la navigation
  const pendingCounts = useMemo(() => ({
    leaves: leaves.filter(l => l.status === LeaveStatus.PENDING).length,
    absences: absences.filter(a => a.status === AbsenceStatus.PENDING).length,
    issues: issues.filter(i => i.status === IssueStatus.NEW).length,
    maintenance: maintenanceLogs.filter(m => m.status === 'Pending').length,
    quotes: quotes.filter(q => q.status === QuoteStatus.REQUESTED).length,
  }), [leaves, absences, issues, maintenanceLogs, quotes]);

  // Liste complète des documents en attente (pour le modal d'alerte)
  const pendingDocumentsList = useMemo(() => {
    if (!currentUser) return [];
    
    const normalizeRole = (role: string | UserRole): UserRole => {
      const r = String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (r.includes('admin')) return UserRole.ADMIN;
      if (r.includes('presiden')) return UserRole.PRESIDENT;
      if (r.includes('direction') || r.includes('directeur')) return UserRole.DIRECTOR;
      if (r.includes('secret')) return UserRole.SECRETARY;
      if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
      if (r.includes('mecan') || r.includes('mech')) return UserRole.MECHANIC;
      if (r.includes('client')) return UserRole.CLIENT;
      return role as UserRole;
    };
    
    const effectiveRole = normalizeRole(currentUser.role);
    
    const myDocs = companyDocuments.filter(doc => {
      if (!doc.isActive) return false;
      if (doc.targetRoles.length === 0) return true;
      return doc.targetRoles.includes(effectiveRole);
    });
    
    return myDocs.filter(doc => {
      const ack = documentAcknowledgments.find(a => 
        a.documentId === doc.id && 
        a.userId === currentUser.id &&
        a.documentVersion === doc.version
      );
      if (!ack) return true;
      if (doc.requiresSignature && ack.status !== 'SIGNED') return true;
      return false;
    });
  }, [companyDocuments, documentAcknowledgments, currentUser]);

  // State pour le modal d'alerte documents
  const [showDocumentAlert, setShowDocumentAlert] = useState(false);
  const [documentAlertDismissed, setDocumentAlertDismissed] = useState(false);

  // Afficher l'alerte au chargement si documents en attente
  useEffect(() => {
    if (currentUser && pendingDocumentsList.length > 0 && !documentAlertDismissed) {
      // Délai pour laisser l'app se charger
      const timer = setTimeout(() => {
        setShowDocumentAlert(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [currentUser, pendingDocumentsList.length, documentAlertDismissed]);

  // --- HANDLERS ---
  
  const handleViewChange = (view: ViewState) => {
    if (view !== 'issues') {
        setTargetIssueVehicleId(null);
    }
    setCurrentView(view);
    setIsMobileMenuOpen(false);
  };

  const handleNavigateToVehicleIssues = (vehicleId: string) => {
      setTargetIssueVehicleId(vehicleId);
      setCurrentView('issues');
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  // Vehicles
  const handleAddVehicle = async (vehicle: Vehicle) => {
    await addVehicleToFirestore(vehicle);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.VEHICLE_CREATED, {
        targetType: 'vehicle',
        targetId: vehicle.id,
        targetName: `${vehicle.plate} - ${vehicle.make || ''} ${vehicle.model}`.trim()
      });
    }
  };
  const handleUpdateVehicle = async (vehicle: Vehicle) => {
    await updateVehicleInFirestore(vehicle);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.VEHICLE_UPDATED, {
        targetType: 'vehicle',
        targetId: vehicle.id,
        targetName: `${vehicle.plate} - ${vehicle.make || ''} ${vehicle.model}`.trim()
      });
    }
  };
  const handleDeleteVehicle = async (id: string) => {
    const vehicle = vehicles.find(v => v.id === id);
    await deleteVehicleFromFirestore(id);
    if (currentUser && vehicle) {
      logActivity(currentUser, ActivityAction.VEHICLE_DELETED, {
        targetType: 'vehicle',
        targetId: id,
        targetName: `${vehicle.plate} - ${vehicle.make || ''} ${vehicle.model}`.trim()
      });
    }
  };
  const handleSelectVehicle = (id: string) => {
    setSelectedVehicleId(id);
  };
  const closeVehicleDetail = () => {
    setSelectedVehicleId(null);
  };

  // Fuel
  const handleAddFuelLog = async (log: FuelLog) => {
    await addFuelLogToFirestore(log);
    if (currentUser) {
      const vehicle = vehicles.find(v => v.id === log.vehicleId);
      logActivity(currentUser, ActivityAction.FUEL_CREATED, {
        targetType: 'fuel',
        targetId: log.id,
        targetName: vehicle ? `${vehicle.plate} - ${log.volume}L` : `${log.volume}L`,
        details: {
          metadata: { volume: log.volume, cost: log.cost, mileage: log.mileage }
        }
      });
    }
  };

  const handleUpdateFuelLog = async (log: FuelLog) => {
    await updateFuelLogInFirestore(log);
    if (currentUser) {
      const vehicle = vehicles.find(v => v.id === log.vehicleId);
      logActivity(currentUser, ActivityAction.FUEL_UPDATED, {
        targetType: 'fuel',
        targetId: log.id,
        targetName: vehicle ? `${vehicle.plate} - ${log.volume}L` : `${log.volume}L`,
        details: {
          metadata: { volume: log.volume, cost: log.cost, mileage: log.mileage }
        }
      });
    }
  };

  // Maintenance
  const handleAddMaintenance = async (log: MaintenanceLog) => {
    console.log("Add Maintenance not fully implemented in firestore service yet", log);
  };

  // Issues
  const handleAddIssue = async (issue: Issue) => {
    setIssues(prev => [issue, ...prev]); 
    await addIssueToFirestore(issue);
    if (currentUser) {
      const vehicle = vehicles.find(v => v.id === issue.vehicleId);
      logActivity(currentUser, ActivityAction.ISSUE_CREATED, {
        targetType: 'issue',
        targetId: issue.id,
        targetName: vehicle ? `${vehicle.plate} - ${issue.description}` : issue.description
      });
    }
  };

  const handleResolveIssue = async (id: string, details?: any) => {
    setIssues(prev => prev.map(i => i.id === id ? { ...i, ...details } : i));
    const issueToUpdate = issues.find(i => i.id === id);
    if (issueToUpdate) {
        const updatedIssue = { ...issueToUpdate, ...details };
        await updateIssueInFirestore(updatedIssue);
        if (currentUser) {
          const vehicle = vehicles.find(v => v.id === issueToUpdate.vehicleId);
          logActivity(currentUser, ActivityAction.ISSUE_RESOLVED, {
            targetType: 'issue',
            targetId: id,
            targetName: vehicle ? `${vehicle.plate} - ${issueToUpdate.description}` : issueToUpdate.description
          });
        }
    }
  };

  // Users
  const handleAddUser = async (newUser: User) => {
    await createUserProfile(newUser);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.USER_CREATED, {
        targetType: 'user',
        targetId: newUser.id,
        targetName: `${newUser.firstName} ${newUser.lastName} (${newUser.role})`
      });
    }
  };

  const handleUpdateUser = async (updatedUser: User) => {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    await updateUserProfile(updatedUser);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.USER_UPDATED, {
        targetType: 'user',
        targetId: updatedUser.id,
        targetName: `${updatedUser.firstName} ${updatedUser.lastName}`
      });
    }
  };

  const handleDeleteUser = async (userId: string, email?: string) => {
    // Optimistic update
    setUsers(prev => prev.filter(u => u.id !== userId));
    
    // Trouver l'utilisateur avant suppression pour le log
    const userToDelete = users.find(u => u.id === userId);
    const userEmail = email || userToDelete?.email;
    
    try {
      // Essayer d'utiliser la Cloud Function (suppression complète)
      const { deleteUserCompletely } = await import('./services/cloudFunctions');
      const result = await deleteUserCompletely(userId, userEmail || '');
      
      if (!result.success) {
        console.warn('Suppression partielle:', result.message);
      }
    } catch (error) {
      // Fallback: supprimer seulement le profil Firestore
      // (la Cloud Function n'est peut-être pas encore déployée)
      console.warn('Cloud Function non disponible, suppression Firestore uniquement');
      await deleteUserProfile(userId);
    }
    
    // Log après suppression
    if (currentUser && userToDelete) {
      logActivity(currentUser, ActivityAction.USER_DELETED, {
        targetType: 'user',
        targetId: userId,
        targetName: `${userToDelete.firstName} ${userToDelete.lastName} (${userToDelete.role})`
      });
    }
  };

  // Leaves
  const handleAddLeave = async (leave: LeaveRequest) => {
    await addLeaveToFirestore(leave);
  };
  const handleUpdateLeave = async (leave: LeaveRequest) => {
    await updateLeaveInFirestore(leave);
  };
  const handleDeleteLeave = async (id: string) => {
    await deleteLeaveFromFirestore(id);
  };

  // Absences (nouveau système)
  const handleAddAbsence = async (absence: Absence) => {
    await addAbsenceToFirestore(absence);
    if (currentUser) {
      const user = users.find(u => u.id === absence.userId);
      logActivity(currentUser, ActivityAction.ABSENCE_CREATED, {
        targetType: 'absence',
        targetId: absence.id,
        targetName: user ? `${user.firstName} ${user.lastName} - ${absence.type}` : absence.type
      });
    }
  };
  const handleUpdateAbsence = async (absence: Absence) => {
    await updateAbsenceInFirestore(absence);
  };
  const handleDeleteAbsence = async (id: string) => {
    await deleteAbsenceFromFirestore(id);
  };
  const handleUploadAbsenceDocument = async (absenceId: string, file: File, docType: AbsenceDocument['type']): Promise<string> => {
    return await uploadAbsenceDocument(absenceId, file, docType);
  };

  // Quotes
  const handleAddQuote = async (quote: QuoteRequest) => {
    await addQuoteToFirestore(quote);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.QUOTE_CREATED, {
        targetType: 'quote',
        targetId: quote.id,
        targetName: `Devis ${quote.id.slice(-6)} - ${quote.clientName}`
      });
    }
  };
  const handleUpdateQuoteStatus = async (id: string, status: QuoteStatus) => {
    const quote = quotes.find(q => q.id === id);
    if (quote) {
      const updatedQuote = { ...quote, status };

      // Si le devis est ACCEPTÉ → créer automatiquement un colis
      if (status === QuoteStatus.ACCEPTED && currentUser) {
        try {
          const result = await convertQuoteToPackage(quote, currentUser);
          if (result) {
            updatedQuote.convertedToPackageId = result.packageId;
            updatedQuote.convertedAt = new Date().toISOString();
            console.log(`✅ Devis ${id.slice(-6)} converti en colis ${result.packageId} (zone ${result.zone})`);
          } else {
            console.warn(`⚠️ Conversion devis ${id.slice(-6)} en colis échouée (adresse non reconnue ?)`);
          }
        } catch (err) {
          console.error('Erreur conversion devis → colis:', err);
        }
      }

      await updateQuoteInFirestore(updatedQuote);

      if (currentUser) {
        const action = status === QuoteStatus.ACCEPTED ? ActivityAction.QUOTE_APPROVED 
                     : status === QuoteStatus.REJECTED ? ActivityAction.QUOTE_REJECTED 
                     : ActivityAction.QUOTE_UPDATED;
        logActivity(currentUser, action, {
          targetType: 'quote',
          targetId: id,
          targetName: `Devis ${id.slice(-6)} - ${quote.clientName}`,
          details: status === QuoteStatus.ACCEPTED && updatedQuote.convertedToPackageId ? {
            metadata: { convertedToPackageId: updatedQuote.convertedToPackageId }
          } : undefined
        });
      }
    }
  };
  const handleUpdateQuote = async (quote: QuoteRequest) => {
    await updateQuoteInFirestore(quote);
  };

  // Company Documents (Ordres de service, Règlement intérieur...)
  const handleAddCompanyDocument = async (doc: CompanyDocument) => {
    await addCompanyDocumentToFirestore(doc);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.DOCUMENT_CREATED, {
        targetType: 'document',
        targetId: doc.id,
        targetName: doc.title
      });
    }
  };
  const handleUpdateCompanyDocument = async (doc: CompanyDocument) => {
    await updateCompanyDocumentInFirestore(doc);
    if (currentUser) {
      logActivity(currentUser, ActivityAction.DOCUMENT_UPDATED, {
        targetType: 'document',
        targetId: doc.id,
        targetName: doc.title
      });
    }
  };
  const handleDeleteCompanyDocument = async (id: string) => {
    const doc = companyDocuments.find(d => d.id === id);
    await deleteCompanyDocumentFromFirestore(id);
    if (currentUser && doc) {
      logActivity(currentUser, ActivityAction.DOCUMENT_DELETED, {
        targetType: 'document',
        targetId: id,
        targetName: doc.title
      });
    }
  };
  const handleAcknowledgeDocument = async (ack: DocumentAcknowledgment) => {
    await addDocumentAcknowledgmentToFirestore(ack);
    if (currentUser) {
      const doc = companyDocuments.find(d => d.id === ack.documentId);
      const action = ack.status === 'SIGNED' ? ActivityAction.DOCUMENT_SIGNED : ActivityAction.DOCUMENT_READ;
      logActivity(currentUser, action, {
        targetType: 'document',
        targetId: ack.documentId,
        targetName: doc?.title || ack.documentId
      });
    }
  };
  
  // Client Team
  const handleAddTeamMember = (user: User) => {
      // Force le rôle CLIENT et la société du créateur pour la sécurité
      const safeUser = {
          ...user,
          role: UserRole.CLIENT,
          companyName: currentUser?.companyName // Héritage strict
      };
      handleAddUser(safeUser);
  };
  const handleUpdateTeamMember = (user: User) => {
      handleUpdateUser(user);
  };
  const handleDeleteTeamMember = (userId: string) => {
      handleDeleteUser(userId);
  };

  // --- RENDER ---

  if (isAuthLoading) {
      return (
          <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 text-slate-400">
              <Loader2 size={48} className="animate-spin text-brand-600 mb-4" />
              <p className="font-medium animate-pulse">Chargement de FleetGenius...</p>
          </div>
      );
  }

  // Vérifier si c'est une page d'activation avec token
  const urlParams = new URLSearchParams(window.location.search);
  const activationToken = urlParams.get('token');
  
  // Si un token d'activation est présent dans l'URL → afficher la page d'activation,
  // MÊME si une autre session est ouverte (sinon le lien ouvrait juste le tableau de
  // bord de la personne connectée). L'activation valide le token puis connecte le
  // nouveau compte.
  if (activationToken) {
    return (
      <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center bg-slate-50"><Loader2 size={48} className="animate-spin text-blue-600" /></div>}>
        <ActivateAccount 
          token={activationToken} 
          onSuccess={() => {
            // Nettoyer l'URL après activation réussie
            window.history.replaceState({}, document.title, window.location.pathname);
          }}
        />
      </Suspense>
    );
  }

  if (!currentUser) {
      return <Login />;
  }

  const renderContent = () => {
    // GARDE-FOU CLIENT (défense en profondeur) : un client ne peut JAMAIS rendre
    // une vue interne (dashboard flotte, missions, vue de dieu, logs…). Même si
    // currentView était forcé à une valeur interne, on le ramène au portail.
    const isClientRole = currentUser.role === UserRole.CLIENT || String(currentUser.role || '').toLowerCase().includes('client');
    const CLIENT_ALLOWED = ['client_dashboard', 'client_list', 'client_shipments', 'client_tracking', 'client_team', 'client_analytics', 'client_recipients', 'client_company', 'client_help', 'help', 'settings'];
    const view: ViewState = (isClientRole && !CLIENT_ALLOWED.includes(currentView)) ? 'client_dashboard' : currentView;

    // GARDE-FOU CARTE CHAUFFEURS : réservée à la direction + secrétariat (défense
    // en profondeur, même par accès direct à l'URL /carte-chauffeurs).
    if (view === 'fleet_map') {
      const r = String(currentUser.role || '').toLowerCase();
      const canSeeFleetMap = /pr[eé]sident|directeur|directrice|direction|secr[eé]ta|admin/.test(r);
      if (!canSeeFleetMap) {
        return <div className="p-10 text-center text-slate-500 font-semibold">Accès réservé à la direction et au secrétariat.</div>;
      }
    }

    switch (view) {
      case 'dashboard':
        return <Dashboard
            vehicles={vehicles} 
            logs={fuelLogs} 
            maintenanceLogs={maintenanceLogs}
            issues={issues}
            quotes={quotes}
            leaves={leaves}
            absences={absences}
            currentUser={currentUser}
            users={users}
            pendingDocuments={pendingDocumentsCount}
            onNavigate={handleViewChange}
        />;
      
      case 'vehicles':
        return <VehicleList 
            vehicles={vehicles}
            users={users}
            issues={issues} 
            currentUser={currentUser}
            logs={fuelLogs}
            maintenanceLogs={maintenanceLogs}
            onAddVehicle={handleAddVehicle}
            onUpdateVehicle={handleUpdateVehicle}
            onDeleteVehicle={handleDeleteVehicle}
            onSelectVehicle={handleSelectVehicle}
            onViewIncidents={handleNavigateToVehicleIssues}
        />;

      case 'drivers':
        return <DriverList 
            users={users}
            vehicles={vehicles}
            leaves={leaves}
            currentUser={currentUser}
            onUpdateUser={handleUpdateUser}
        />;

      case 'fuel':
        return <FuelManager 
            logs={fuelLogs}
            vehicles={vehicles}
            users={users}
            currentUser={currentUser}
            onAddLog={handleAddFuelLog}
            onUpdateLog={handleUpdateFuelLog}
        />;

      case 'maintenance':
        return <MaintenanceManager 
            logs={maintenanceLogs}
            vehicles={vehicles}
            currentUserRole={currentUser.role}
            onAddMaintenance={handleAddMaintenance}
        />;

      case 'issues':
        return <IssueManager 
            issues={issues}
            vehicles={vehicles}
            users={users}
            currentUser={currentUser}
            maintenanceLogs={maintenanceLogs}
            onAddIssue={handleAddIssue}
            onResolveIssue={handleResolveIssue}
            onAddMaintenance={handleAddMaintenance}
            preselectedVehicleId={targetIssueVehicleId}
        />;

      case 'users':
        return <UserManager 
            users={users}
            currentUser={currentUser}
            onAddUser={handleAddUser}
            onUpdateUser={handleUpdateUser}
            onDeleteUser={handleDeleteUser}
        />;

      case 'permissions':
        return <PermissionsManager 
            users={users}
            currentUser={currentUser}
        />;

      case 'documents':
        // Vue chauffeur : DocumentManager filtré sur ses documents uniquement
        return <DocumentManager 
            documents={companyDocuments}
            acknowledgments={documentAcknowledgments}
            users={users}
            currentUser={currentUser}
            onAddDocument={handleAddCompanyDocument}
            onUpdateDocument={handleUpdateCompanyDocument}
            onDeleteDocument={handleDeleteCompanyDocument}
            onAcknowledge={handleAcknowledgeDocument}
            viewMode="employee"
        />;

      case 'ai_advisor':
        return <AIAdvisor 
            vehicles={vehicles}
            users={users}
            logs={fuelLogs}
            maintenanceLogs={maintenanceLogs}
        />;
      
      case 'map':
        return <FleetMap 
            vehicles={vehicles} 
            onVehicleSelect={handleSelectVehicle} 
        />;

      case 'leaves':
        // Vue "Congés" = AbsenceManager pré-filtré sur Congés Payés
        return <AbsenceManager 
            absences={absences}
            users={users}
            currentUser={currentUser}
            onAddAbsence={handleAddAbsence}
            onUpdateAbsence={handleUpdateAbsence}
            onDeleteAbsence={handleDeleteAbsence}
            onUploadDocument={handleUploadAbsenceDocument}
            onUpdateUserBalance={handleUpdateUser}
            defaultTypeFilter={AbsenceType.CP}
            customTitle="Gestion des Congés"
        />;

      case 'absences':
        return <AbsenceManager 
            absences={absences}
            users={users}
            currentUser={currentUser}
            onAddAbsence={handleAddAbsence}
            onUpdateAbsence={handleUpdateAbsence}
            onDeleteAbsence={handleDeleteAbsence}
            onUploadDocument={handleUploadAbsenceDocument}
            onUpdateUserBalance={handleUpdateUser}
        />;

      case 'company_docs':
        return <DocumentManager 
            documents={companyDocuments}
            acknowledgments={documentAcknowledgments}
            users={users}
            currentUser={currentUser}
            onAddDocument={handleAddCompanyDocument}
            onUpdateDocument={handleUpdateCompanyDocument}
            onDeleteDocument={handleDeleteCompanyDocument}
            onAcknowledge={handleAcknowledgeDocument}
        />;

      case 'quotes':
        return <QuoteManager 
            quotes={quotes}
            onUpdateQuote={handleUpdateQuote}
        />;

      case 'settings':
        return <Settings 
            currentUser={currentUser}
            onUpdateUser={handleUpdateUser}
        />;

      // === NOUVELLES VUES ADMINISTRATION & PARAMÈTRES ===
      case 'company_settings':
        return (
          <div className="p-8">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🏢</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Paramètres Entreprise</h2>
              <p className="text-slate-500 mb-4">Configuration de l'identité de l'entreprise (nom, logo, SIRET, TVA...)</p>
              <span className="inline-block px-3 py-1 bg-amber-100 text-amber-700 text-sm font-bold rounded-full">À venir</span>
            </div>
          </div>
        );

      case 'activity_logs':
        return (
          <ActivityLogs
            users={users}
            currentUser={currentUser}
          />
        );

      case 'error_logs':
        return (
          <ActivityLogs
            users={users}
            currentUser={currentUser}
            initialTab="errors"
          />
        );

      case 'president_overview':
        return <PresidentOverview />;

      case 'fleet_map':
        return <FleetMapView users={users} />;

      case 'missions': {
        // Chauffeurs → vue mobile dédiée
        if (currentUser.role === UserRole.DRIVER) {
          return (
            <DriverMissionView
              currentUser={currentUser}
            />
          );
        }
        // Dispatch / Direction / Admin → vue complète
        return (
          <MissionManager
            currentUser={currentUser}
            users={users}
            vehicles={vehicles}
          />
        );
      }

      case 'notifications_settings':
        return (
          <div className="p-8">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🔔</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Notifications</h2>
              <p className="text-slate-500 mb-4">Configurer les alertes email, seuils carburant, rappels contrôle technique...</p>
              <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-sm font-bold rounded-full">À venir</span>
            </div>
          </div>
        );

      case 'delivery_schedule':
        return (
          <div className="p-4 md:p-8">
            <DeliveryScheduleSettings currentUser={currentUser} />
          </div>
        );

      case 'zone_management':
        return (
          <div className="p-4 md:p-8">
            <ZoneManager />
          </div>
        );

      case 'hub_operations':
        return (
          <div className="p-4 md:p-8">
            <HubOperations
              currentUser={currentUser}
              vehicles={vehicles}
              users={users}
            />
          </div>
        );

      case 'driver_tour':
        return (
          <div className="p-4 md:p-8 max-w-lg mx-auto">
            <DriverTourView
              currentUser={currentUser}
              vehicles={vehicles}
            />
          </div>
        );

      case 'api_diagnostic':
        return (
          <div className="p-8">
            <ApiDiagnostic />
          </div>
        );

      case 'import_export':
        return (
          <div className="p-8">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">📥</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Imports / Exports</h2>
              <p className="text-slate-500 mb-4">Exporter vos données en Excel, importer un historique...</p>
              <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full">À venir</span>
            </div>
          </div>
        );

      case 'client_dashboard':
      case 'client_list':
      case 'client_shipments':
      case 'client_tracking':
      case 'client_team':
      case 'client_company':
      case 'client_analytics':
      case 'client_recipients':
      case 'client_help':
        // Sécurité : On filtre strictement les utilisateurs visibles par le client
        const companyTeam = users.filter(u =>
            u.companyName === currentUser.companyName &&
            (u.role === UserRole.CLIENT || String(u.role).toLowerCase().includes('client'))
        );

        return <ClientPortal
            activeView={view}
            currentUser={currentUser}
            quotes={quotes}
            companyUsers={companyTeam}
            onNavigate={handleViewChange}
            onAddQuote={handleAddQuote}
            onUpdateQuoteStatus={handleUpdateQuoteStatus}
            onAddTeamMember={handleAddTeamMember}
            onUpdateTeamMember={handleUpdateTeamMember}
            onDeleteTeamMember={handleDeleteTeamMember}
        />;

      case 'help':
        // Centre d'aide - accessible à tous les utilisateurs
        return <HelpCenter currentUser={currentUser} />;

      default:
        // Par défaut, si c'est un client on affiche le portail, sinon le dashboard flotte
        if (currentUser.role === UserRole.CLIENT) {
             const team = users.filter(u => u.companyName === currentUser.companyName && u.role === UserRole.CLIENT);
             return <ClientPortal 
                activeView="client_dashboard"
                currentUser={currentUser}
                quotes={quotes}
                companyUsers={team}
                onAddQuote={handleAddQuote}
                onUpdateQuoteStatus={handleUpdateQuoteStatus}
                onAddTeamMember={handleAddTeamMember}
                onUpdateTeamMember={handleUpdateTeamMember}
                onDeleteTeamMember={handleDeleteTeamMember}
            />;
        }
        return <Dashboard 
            vehicles={vehicles} 
            logs={fuelLogs} 
            maintenanceLogs={maintenanceLogs}
            issues={issues}
            quotes={quotes}
            leaves={leaves}
            absences={absences}
            currentUser={currentUser}
            users={users}
            pendingDocuments={pendingDocumentsCount}
            onNavigate={handleViewChange}
        />;
    }
  };

  const canViewAs = ['presiden', 'admin', 'direct'].some(k =>
    String(currentUser?.role || '').toLowerCase().includes(k)
  );

  return (
    <ErrorBoundary>
      <PermissionsProvider currentUser={currentUser}>
      <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
        
        {/* NETWORK STATUS BANNER */}
        {isOffline && (
            <div className="fixed top-0 left-0 right-0 bg-red-600 text-white text-center text-xs font-bold py-1 z-[1000] flex items-center justify-center gap-2 animate-pulse">
                <WifiOff size={12} /> MODE HORS-LIGNE - Les modifications ne seront pas sauvegardées
            </div>
        )}

        {/* Sidebar */}
        <div className={`fixed inset-y-0 left-0 z-50 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 transition-transform duration-300 ease-in-out`}>
          <Sidebar
            currentView={currentView}
            onChangeView={handleViewChange}
            isCollapsed={isSidebarCollapsed}
            currentUser={currentUser}
            onLogout={handleLogout}
            pendingDocsCount={pendingDocumentsCount}
            pendingCounts={pendingCounts}
          />
        </div>

        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          ></div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-screen overflow-hidden w-full relative">
          <div className="bg-white border-b border-slate-200 p-4 flex items-center justify-between lg:hidden shrink-0">
              <button onClick={() => setIsMobileMenuOpen(true)} className="text-slate-600">
                  <Menu size={24} />
              </button>
              <div className="flex flex-col items-center">
                  <span className="font-bold text-lg text-slate-800">FleetGenius</span>
                  <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">{currentUser.role}</span>
              </div>
              <div className="flex items-center gap-2">
                {canViewAs && <ViewAsSwitcher currentUser={currentUser} users={users} quotes={quotes} />}
                <NotificationCenter currentUser={currentUser} onNavigate={setCurrentView} />
                <div className="w-6">
                  {currentUser.avatarUrl && <img src={currentUser.avatarUrl} className="w-6 h-6 rounded-full border border-slate-200" />}
                </div>
              </div>
          </div>

          <div className="hidden lg:flex items-center p-4 absolute top-0 left-0 right-0 z-10 justify-between">
              <button 
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  className="bg-white p-2 rounded-lg shadow-sm border border-slate-200 text-slate-500 hover:text-brand-600 transition-colors"
              >
                  <Menu size={20} />
              </button>
              <div className="flex items-center gap-2 pr-2">
                {canViewAs && <ViewAsSwitcher currentUser={currentUser} users={users} quotes={quotes} />}
                <NotificationCenter currentUser={currentUser} onNavigate={setCurrentView} />
              </div>
          </div>

          <main className="flex-1 overflow-y-auto p-4 lg:p-8 custom-scrollbar pt-14 lg:pt-20 pb-20 lg:pb-8">
              <div className="max-w-7xl mx-auto h-full">
                <Suspense fallback={<PageLoader />}>
                  {renderContent()}
                </Suspense>
              </div>
          </main>
        </div>

        {selectedVehicle && (
          <Suspense fallback={null}>
            <VehicleDetail 
                vehicle={selectedVehicle} 
                logs={fuelLogs} 
                maintenanceLogs={maintenanceLogs} 
                onClose={closeVehicleDetail} 
            />
          </Suspense>
        )}

        {/* Mobile Nav n'est affiché que si on n'est pas Client (car menu différent) */}
        {currentUser.role !== UserRole.CLIENT && (
            <MobileNavBar
              currentView={currentView}
              onChangeView={handleViewChange}
              onOpenMenu={() => setIsMobileMenuOpen(true)}
            />
        )}

        {/* Raccourci scan rapide — disponible sur tous les écrans (usage interne) */}
        {currentUser.role !== UserRole.CLIENT && <QuickScanButton currentUser={currentUser} clients={users.filter(u => u.role === UserRole.CLIENT || String(u.role).toLowerCase().includes('client'))} />}

        {/* MODAL ALERTE DOCUMENTS NON SIGNÉS */}
        <Suspense fallback={null}>
          <DocumentAlertModal
            isOpen={showDocumentAlert}
            onClose={() => {
              setShowDocumentAlert(false);
              setDocumentAlertDismissed(true);
            }}
            onGoToDocuments={() => {
              setShowDocumentAlert(false);
              setDocumentAlertDismissed(true);
              setCurrentView('documents');
            }}
            pendingDocuments={pendingDocumentsList}
            currentUser={currentUser}
          />
        </Suspense>

      </div>
      </PermissionsProvider>
    </ErrorBoundary>
  );
};

export default App;