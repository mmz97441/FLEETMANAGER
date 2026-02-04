
import React, { useState, useMemo } from 'react';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import { User, UserRole, LeaveRequest, LeaveStatus, LeaveType } from '../types';
import { CalendarDays, Calendar, ChevronLeft, ChevronRight, Plus, CheckCircle, XCircle, Clock, User as UserIcon, AlertOctagon, Trash2, Edit2, AlertTriangle, ShieldCheck, Lock } from 'lucide-react';
import { usePermissions, Permission } from '../usePermissions';
import { notifyLeaveRequest, notifyLeaveApproved, notifyLeaveRejected } from '../services/notificationService';
import { sendLeaveRequestEmail, sendLeaveDecisionEmail } from '../services/cloudFunctions';

interface LeaveManagerProps {
  currentUser: User;
  users: User[];
  leaves: LeaveRequest[];
  onAddLeave: (leave: LeaveRequest) => void;
  onUpdateLeave: (leave: LeaveRequest) => void;
  onDeleteLeave: (id: string) => void;
  onUpdateUserBalance: (user: User) => void; // Nouvelle prop pour mettre à jour l'utilisateur
}

const LeaveManager: React.FC<LeaveManagerProps> = ({ currentUser, users, leaves, onAddLeave, onUpdateLeave, onDeleteLeave, onUpdateUserBalance }) => {
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewOwn = hasPermission(Permission.ABSENCES_VIEW_OWN);
  const canViewAll = hasPermission(Permission.ABSENCES_VIEW_ALL);
  const canCreate = hasPermission(Permission.ABSENCES_CREATE);
  const canValidate = hasPermission(Permission.ABSENCES_VALIDATE);
  const isAdminOrDirector = canViewAll;

  // === TOUS LES HOOKS DOIVENT ÊTRE ICI (avant tout return conditionnel) ===
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'calendar' | 'list'>('calendar');
  
  // --- STATE MODALS ---
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  
  // --- STATE SELECTION ---
  const [selectedLeave, setSelectedLeave] = useState<LeaveRequest | null>(null);
  
  // --- STATE ACTIONS ---
  const [pendingAction, setPendingAction] = useState<{
      type: 'VALIDATE' | 'REJECT' | 'DELETE' | 'CREATE' | 'UPDATE';
      data?: any;
  } | null>(null);

  // --- FORM STATE ---
  const [formData, setFormData] = useState<Partial<LeaveRequest>>({
      startDate: '',
      endDate: '',
      type: LeaveType.PAID,
      reason: ''
  });
  const [formError, setFormError] = useState<string | null>(null);

  // --- HELPERS ---
  const getUserName = (id: string) => {
      const u = users.find(user => user.id === id);
      return u ? `${u.firstName} ${u.lastName}` : 'Utilisateur inconnu';
  };

  // === JOURS FÉRIÉS FRANÇAIS (à mettre à jour chaque année ou calculer dynamiquement) ===
  const getFrenchHolidays = (year: number): string[] => {
    const holidays: string[] = [];
    
    // Fêtes fixes
    holidays.push(`${year}-01-01`); // Jour de l'an
    holidays.push(`${year}-05-01`); // Fête du travail
    holidays.push(`${year}-05-08`); // Victoire 1945
    holidays.push(`${year}-07-14`); // Fête nationale
    holidays.push(`${year}-08-15`); // Assomption
    holidays.push(`${year}-11-01`); // Toussaint
    holidays.push(`${year}-11-11`); // Armistice
    holidays.push(`${year}-12-25`); // Noël

    // Calcul de Pâques (algorithme de Meeus/Jones/Butcher)
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    
    const easter = new Date(year, month - 1, day);
    
    // Lundi de Pâques (Pâques + 1)
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    holidays.push(easterMonday.toISOString().slice(0, 10));
    
    // Ascension (Pâques + 39)
    const ascension = new Date(easter);
    ascension.setDate(easter.getDate() + 39);
    holidays.push(ascension.toISOString().slice(0, 10));
    
    // Lundi de Pentecôte (Pâques + 50)
    const pentecost = new Date(easter);
    pentecost.setDate(easter.getDate() + 50);
    holidays.push(pentecost.toISOString().slice(0, 10));
    
    return holidays;
  };

  // Vérifie si une date est un jour férié
  const isHoliday = (date: Date): boolean => {
    const year = date.getFullYear();
    const holidays = getFrenchHolidays(year);
    const dateStr = date.toISOString().slice(0, 10);
    return holidays.includes(dateStr);
  };

  // Vérifie si une date est un jour ouvrable (Lundi-Samedi, hors fériés)
  const isWorkingDay = (date: Date): boolean => {
    const dayOfWeek = date.getDay(); // 0 = Dimanche, 6 = Samedi
    if (dayOfWeek === 0) return false; // Dimanche = non ouvrable
    if (isHoliday(date)) return false; // Férié = non ouvrable
    return true;
  };

  // === CALCUL DES JOURS OUVRABLES AVEC RÈGLE VENDREDI-LUNDI ===
  const calculateWorkingDays = (startStr: string, endStr: string, userId: string): { days: number; saturdaysDeducted: number; details: string } => {
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { days: 0, saturdaysDeducted: 0, details: 'Dates invalides' };
    }

    // Récupérer le nombre de samedis déjà décomptés pour cette période de référence
    const periodStart = new Date(startDate.getFullYear(), 5, 1); // 1er juin de l'année en cours
    const periodEnd = new Date(startDate.getFullYear() + 1, 4, 31); // 31 mai de l'année suivante
    
    // Si on est avant le 1er juin, la période de référence est l'année précédente
    if (startDate < periodStart) {
      periodStart.setFullYear(periodStart.getFullYear() - 1);
      periodEnd.setFullYear(periodEnd.getFullYear() - 1);
    }

    // Compter les samedis déjà décomptés pour cet utilisateur dans la période
    const existingSaturdaysDeducted = leaves
      .filter(l => 
        l.userId === userId && 
        l.status === LeaveStatus.APPROVED &&
        new Date(l.startDate) >= periodStart &&
        new Date(l.endDate) <= periodEnd
      )
      .reduce((acc, l) => acc + (l.saturdaysDeducted || 0), 0);

    let workingDays = 0;
    let saturdaysInThisRequest = 0;
    const saturdayLimit = 5;
    const remainingSaturdayQuota = Math.max(0, saturdayLimit - existingSaturdaysDeducted);

    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      
      if (dayOfWeek === 0) {
        // Dimanche - ne compte pas
      } else if (dayOfWeek === 6) {
        // Samedi - compte seulement si pas férié et quota non atteint
        if (!isHoliday(current) && saturdaysInThisRequest < remainingSaturdayQuota) {
          workingDays++;
          saturdaysInThisRequest++;
        }
      } else {
        // Lundi à Vendredi - compte si pas férié
        if (!isHoliday(current)) {
          workingDays++;
        }
      }
      
      current.setDate(current.getDate() + 1);
    }

    // === RÈGLE VENDREDI-LUNDI ===
    // Si le dernier jour posé est un vendredi ET la reprise est le lundi suivant
    const endDayOfWeek = endDate.getDay();
    if (endDayOfWeek === 5) { // Vendredi
      const saturday = new Date(endDate);
      saturday.setDate(endDate.getDate() + 1);
      
      // Vérifier que le samedi n'est pas déjà inclus dans la période
      // (il ne l'est pas car endDate est le vendredi)
      // Ajouter le samedi si:
      // 1. Il n'est pas férié
      // 2. Le quota de samedis n'est pas atteint
      if (!isHoliday(saturday) && saturdaysInThisRequest < remainingSaturdayQuota) {
        workingDays++;
        saturdaysInThisRequest++;
      }
    }

    let details = `${workingDays} jour(s) ouvrable(s)`;
    if (saturdaysInThisRequest > 0) {
      details += ` (dont ${saturdaysInThisRequest} samedi(s))`;
    }
    if (existingSaturdaysDeducted >= saturdayLimit) {
      details += ' - Quota samedis atteint';
    }

    return { 
      days: workingDays, 
      saturdaysDeducted: saturdaysInThisRequest, 
      details 
    };
  };

  // Fonction simplifiée pour l'affichage (garde la compatibilité)
  const calculateDays = (start: string, end: string) => {
      const result = calculateWorkingDays(start, end, currentUser.id);
      return result.days;
  };

  // --- CALENDAR LOGIC ---
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const monthLabel = currentDate.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  // --- ACTIONS HANDLERS ---

  const handleOpenCreate = () => {
      setFormData({
          startDate: '',
          endDate: '',
          type: LeaveType.PAID,
          reason: ''
      });
      setSelectedLeave(null);
      setFormError(null);
      setIsFormModalOpen(true);
  };

  const handleViewDetail = (leave: LeaveRequest) => {
      if (isAdminOrDirector || leave.userId === currentUser.id) {
          setSelectedLeave(leave);
          setIsDetailModalOpen(true);
      }
  };

  const handleEditClick = () => {
      if (!selectedLeave) return;
      setFormData({
          startDate: selectedLeave.startDate,
          endDate: selectedLeave.endDate,
          type: selectedLeave.type,
          reason: selectedLeave.reason
      });
      setIsDetailModalOpen(false);
      setIsFormModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      if (!formData.startDate || !formData.endDate) return;

      const duration = calculateDays(formData.startDate, formData.endDate);
      
      // Simple verification locale du solde (pas bloquante pour l'admin, mais informative)
      if (formData.type === LeaveType.PAID && duration > currentUser.leaveBalance) {
          setFormError(`Attention : Solde insuffisant ! Demandé : ${duration}j. Disponible : ${currentUser.leaveBalance}j.`);
          // On permet quand même de soumettre, l'admin tranchera
      }

      setPendingAction({
          type: selectedLeave ? 'UPDATE' : 'CREATE',
          data: formData
      });
      setIsFormModalOpen(false);
      setIsConfirmModalOpen(true);
  };

  const triggerAction = (type: 'VALIDATE' | 'REJECT' | 'DELETE', leave: LeaveRequest) => {
      setSelectedLeave(leave);
      setPendingAction({ type, data: leave });
      setIsDetailModalOpen(false);
      setIsConfirmModalOpen(true);
  };

  // --- EXECUTION FINALE AVEC CALCUL SOLDE ---
  const executePendingAction = () => {
      if (!pendingAction) return;

      if (pendingAction.type === 'CREATE') {
          // Calcul des jours ouvrables avec la nouvelle logique
          const calculation = calculateWorkingDays(
              pendingAction.data.startDate, 
              pendingAction.data.endDate, 
              currentUser.id
          );
          
          const newLeave: LeaveRequest = {
              id: `leave-${Date.now()}`,
              userId: currentUser.id,
              startDate: pendingAction.data.startDate,
              endDate: pendingAction.data.endDate,
              type: pendingAction.data.type,
              status: LeaveStatus.PENDING,
              reason: pendingAction.data.reason,
              // Stocker le calcul pour transparence et audit
              workingDays: calculation.days,
              saturdaysDeducted: calculation.saturdaysDeducted,
              calculationDetails: calculation.details
          };
          onAddLeave(newLeave);
          
          // Notifier les admins/direction de la nouvelle demande
          const adminIds = users
            .filter(u => u.role === UserRole.ADMIN || u.role === UserRole.DIRECTOR || u.role === UserRole.MANAGER || u.role === UserRole.PRESIDENT)
            .map(u => u.id);
          
          const leaveTypeLabels: Record<LeaveType, string> = {
            [LeaveType.PAID]: 'congés payés',
            [LeaveType.UNPAID]: 'congés sans solde',
            [LeaveType.SICK]: 'arrêt maladie',
            [LeaveType.RTT]: 'RTT',
            [LeaveType.FAMILY]: 'congés exceptionnels',
            [LeaveType.OTHER]: 'autre absence'
          };
          
          const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');
          
          // Notification in-app
          notifyLeaveRequest(
            adminIds,
            `${currentUser.firstName} ${currentUser.lastName}`,
            leaveTypeLabels[pendingAction.data.type as LeaveType] || pendingAction.data.type,
            formatDate(pendingAction.data.startDate),
            formatDate(pendingAction.data.endDate),
            calculation.days
          ).catch(e => console.warn('[Notif] Erreur:', e));
          
          // Email
          sendLeaveRequestEmail(
            `${currentUser.firstName} ${currentUser.lastName}`,
            currentUser.email || '',
            leaveTypeLabels[pendingAction.data.type as LeaveType] || pendingAction.data.type,
            formatDate(pendingAction.data.startDate),
            formatDate(pendingAction.data.endDate),
            calculation.days,
            pendingAction.data.reason || ''
          ).catch(e => console.warn('[Email] Erreur:', e));
      } 
      else if (pendingAction.type === 'UPDATE' && selectedLeave) {
          // Recalculer les jours ouvrables
          const calculation = calculateWorkingDays(
              pendingAction.data.startDate, 
              pendingAction.data.endDate, 
              selectedLeave.userId
          );
          
          const updated: LeaveRequest = {
              ...selectedLeave,
              startDate: pendingAction.data.startDate,
              endDate: pendingAction.data.endDate,
              type: pendingAction.data.type,
              reason: pendingAction.data.reason,
              status: LeaveStatus.PENDING, 
              validatedBy: undefined,
              validationDate: undefined,
              workingDays: calculation.days,
              saturdaysDeducted: calculation.saturdaysDeducted,
              calculationDetails: calculation.details
          };
          onUpdateLeave(updated);
      }
      else if (pendingAction.type === 'DELETE' && selectedLeave) {
          onDeleteLeave(selectedLeave.id);
      }
      else if (pendingAction.type === 'VALIDATE' && selectedLeave) {
          // Recalculer au moment de la validation pour être sûr
          const calculation = calculateWorkingDays(
              selectedLeave.startDate, 
              selectedLeave.endDate, 
              selectedLeave.userId
          );
          
          // 1. UPDATE LEAVE avec calcul final
          const updatedLeave: LeaveRequest = {
              ...selectedLeave,
              status: LeaveStatus.APPROVED,
              validatedBy: currentUser.id,
              validationDate: new Date().toISOString(),
              workingDays: calculation.days,
              saturdaysDeducted: calculation.saturdaysDeducted,
              calculationDetails: calculation.details
          };
          onUpdateLeave(updatedLeave);

          // 2. AUTOMATIC BALANCE DEDUCTION - utiliser les jours ouvrables calculés
          if (selectedLeave.type === LeaveType.PAID || selectedLeave.type === LeaveType.RTT) {
              const requester = users.find(u => u.id === selectedLeave.userId);
              if (requester) {
                  // Utiliser le calcul des jours ouvrables, pas les jours calendaires
                  const duration = calculation.days;
                  const newBalance = requester.leaveBalance - duration;
                  
                  // Update User in Firestore via App handler
                  onUpdateUserBalance({
                      ...requester,
                      leaveBalance: newBalance
                  });
              }
          }
          
          // 3. Notifier le chauffeur de l'approbation
          const leaveTypeLabels: Record<LeaveType, string> = {
            [LeaveType.PAID]: 'congés payés',
            [LeaveType.UNPAID]: 'congés sans solde',
            [LeaveType.SICK]: 'arrêt maladie',
            [LeaveType.RTT]: 'RTT',
            [LeaveType.FAMILY]: 'congés exceptionnels',
            [LeaveType.OTHER]: 'autre absence'
          };
          const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');
          const requester = users.find(u => u.id === selectedLeave.userId);
          
          // Notification in-app
          notifyLeaveApproved(
            selectedLeave.userId,
            leaveTypeLabels[selectedLeave.type as LeaveType] || selectedLeave.type,
            formatDate(selectedLeave.startDate),
            formatDate(selectedLeave.endDate),
            `${currentUser.firstName} ${currentUser.lastName}`
          ).catch(e => console.warn('[Notif] Erreur:', e));
          
          // Email
          if (requester?.email) {
            sendLeaveDecisionEmail(
              `${requester.firstName} ${requester.lastName}`,
              requester.email,
              leaveTypeLabels[selectedLeave.type as LeaveType] || selectedLeave.type,
              formatDate(selectedLeave.startDate),
              formatDate(selectedLeave.endDate),
              'approved',
              `${currentUser.firstName} ${currentUser.lastName}`
            ).catch(e => console.warn('[Email] Erreur:', e));
          }
      }
      else if (pendingAction.type === 'REJECT' && selectedLeave) {
          const updated: LeaveRequest = {
              ...selectedLeave,
              status: LeaveStatus.REJECTED,
              validatedBy: currentUser.id,
              validationDate: new Date().toISOString()
          };
          onUpdateLeave(updated);
          
          // Notifier le chauffeur du refus
          const leaveTypeLabels: Record<LeaveType, string> = {
            [LeaveType.PAID]: 'congés payés',
            [LeaveType.UNPAID]: 'congés sans solde',
            [LeaveType.SICK]: 'arrêt maladie',
            [LeaveType.RTT]: 'RTT',
            [LeaveType.FAMILY]: 'congés exceptionnels',
            [LeaveType.OTHER]: 'autre absence'
          };
          const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');
          const requester = users.find(u => u.id === selectedLeave.userId);
          
          // Notification in-app
          notifyLeaveRejected(
            selectedLeave.userId,
            leaveTypeLabels[selectedLeave.type as LeaveType] || selectedLeave.type,
            formatDate(selectedLeave.startDate),
            formatDate(selectedLeave.endDate),
            `${currentUser.firstName} ${currentUser.lastName}`
          ).catch(e => console.warn('[Notif] Erreur:', e));
          
          // Email
          if (requester?.email) {
            sendLeaveDecisionEmail(
              `${requester.firstName} ${requester.lastName}`,
              requester.email,
              leaveTypeLabels[selectedLeave.type as LeaveType] || selectedLeave.type,
              formatDate(selectedLeave.startDate),
              formatDate(selectedLeave.endDate),
              'rejected',
              `${currentUser.firstName} ${currentUser.lastName}`
            ).catch(e => console.warn('[Email] Erreur:', e));
          }
      }

      setIsConfirmModalOpen(false);
      setPendingAction(null);
      setSelectedLeave(null);
  };

  const getLeavesForDay = (day: number) => {
      const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toISOString().split('T')[0];
      return leaves.filter(l => dateStr >= l.startDate && dateStr <= l.endDate).map(l => {
          const isMe = l.userId === currentUser.id;
          const user = users.find(u => u.id === l.userId);
          
          if (isAdminOrDirector || isMe) {
              return { ...l, userName: user ? `${user.firstName} ${user.lastName}` : 'Inconnu', isMe };
          } else {
              return { ...l, userName: 'Chauffeur', isMe: false };
          }
      });
  };

  const pendingLeaves = leaves.filter(l => l.status === LeaveStatus.PENDING);

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewOwn && !canViewAll) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès à la gestion des congés.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in relative h-full flex flex-col">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <CalendarDays className="text-brand-600" /> Planning Congés
                </h2>
                <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                   <div className="bg-brand-50 text-brand-700 px-3 py-1 rounded-full font-bold border border-brand-100">
                       Mon solde CP : {currentUser.leaveBalance} jours
                   </div>
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                {canValidate && (
                    <div className="bg-slate-100 p-1 rounded-lg flex text-sm font-medium border border-slate-200">
                        <button 
                            onClick={() => setActiveTab('calendar')}
                            className={`px-3 py-1.5 rounded-md transition-all ${activeTab === 'calendar' ? 'bg-white shadow text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                            Calendrier
                        </button>
                        <button 
                            onClick={() => setActiveTab('list')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeTab === 'list' ? 'bg-white shadow text-brand-700 font-bold' : 'text-slate-500 hover:text-slate-800'}`}
                        >
                            À Valider
                            {pendingLeaves.length > 0 && <span className="bg-red-600 text-white text-[10px] px-1.5 rounded-full font-bold">{pendingLeaves.length}</span>}
                        </button>
                    </div>
                )}
                
                <button onClick={handleOpenCreate} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg">
                    <Plus size={18} /> Poser Congés
                </button>
            </div>
        </div>

        {/* --- CALENDAR VIEW --- */}
        {activeTab === 'calendar' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                    <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ChevronLeft /></button>
                    <h3 className="text-xl font-bold text-slate-800 capitalize">{monthLabel}</h3>
                    <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><ChevronRight /></button>
                </div>

                <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden border border-slate-200 flex-1 min-h-[500px]">
                    {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => (
                        <div key={day} className="bg-slate-50 p-2 text-center text-xs font-bold text-slate-600 uppercase">{day}</div>
                    ))}
                    {Array.from({ length: startOffset }).map((_, i) => <div key={`empty-${i}`} className="bg-white opacity-50"></div>)}

                    {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const dayLeaves = getLeavesForDay(day);
                        return (
                            <div key={day} className="bg-white p-2 min-h-[80px] hover:bg-slate-50 transition-colors relative border-t border-l border-transparent">
                                <span className="text-sm font-bold text-slate-700">{day}</span>
                                <div className="flex flex-col gap-1 mt-1 overflow-y-auto max-h-[80px] custom-scrollbar">
                                    {dayLeaves.map((leave, idx) => (
                                        <div 
                                            key={`${leave.id}-${idx}`}
                                            onClick={(e) => { e.stopPropagation(); handleViewDetail(leave as LeaveRequest); }}
                                            className={`text-[10px] px-1.5 py-0.5 rounded border truncate cursor-pointer hover:opacity-80 transition-opacity font-bold ${
                                                leave.status === LeaveStatus.PENDING ? 'bg-orange-100 text-orange-800 border-orange-200' :
                                                leave.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-800 border-red-200 opacity-50' :
                                                leave.isMe ? 'bg-brand-100 text-brand-800 border-brand-200' :
                                                'bg-slate-100 text-slate-700 border-slate-200'
                                            }`}
                                        >
                                            {leave.userName}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}

        {/* --- VALIDATION LIST VIEW --- */}
        {activeTab === 'list' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100"><h3 className="font-bold text-slate-800">Demandes en attente</h3></div>
                {pendingLeaves.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 font-medium"><CheckCircle className="mx-auto mb-4 text-green-500 opacity-50" size={48} /><p>Tout est à jour.</p></div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {pendingLeaves.map(leave => {
                            const user = users.find(u => u.id === leave.userId);
                            const duration = calculateDays(leave.startDate, leave.endDate);
                            return (
                                <div key={leave.id} className="p-6 flex flex-col md:flex-row justify-between items-center gap-4 hover:bg-slate-50">
                                    <div className="flex items-center gap-4">
                                        <div className="bg-brand-50 p-3 rounded-full text-brand-600"><UserIcon size={24} /></div>
                                        <div>
                                            <h4 className="font-bold text-slate-800">{user ? `${user.firstName} ${user.lastName}` : 'Inconnu'}</h4>
                                            <p className="text-slate-600 text-sm font-medium">{leave.type} • {leave.reason}</p>
                                            <p className="text-xs text-slate-500 mt-1 font-bold">Solde actuel: {user?.leaveBalance}j</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right mr-4">
                                            <p className="font-bold text-slate-800">{duration} jours</p>
                                            <p className="text-xs text-slate-500 font-medium">{new Date(leave.startDate).toLocaleDateString()} au {new Date(leave.endDate).toLocaleDateString()}</p>
                                        </div>
                                        <button onClick={() => triggerAction('REJECT', leave)} className="px-4 py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 font-bold">Refuser</button>
                                        <button onClick={() => triggerAction('VALIDATE', leave)} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow-lg">Valider & Débiter</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        )}

        {/* --- MODALS (Create, Detail, Confirm) --- */}
        <Modal
            isOpen={isFormModalOpen}
            onClose={() => setIsFormModalOpen(false)}
            title={selectedLeave ? 'Modifier la demande' : 'Poser des congés'}
            size="md"
            headerIcon={<Calendar size={20} />}
        >
            <form onSubmit={handleFormSubmit} className="space-y-4">
                {formError && <div className="bg-red-50 text-red-700 p-3 rounded-xl flex items-start gap-2 text-sm font-medium"><AlertOctagon size={18} /><p>{formError}</p></div>}
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-sm font-bold text-slate-700 mb-1">Du</label><input type="date" required className="w-full px-3 py-2 border border-slate-300 rounded-xl text-slate-900 font-medium" value={formData.startDate} onChange={(e) => setFormData({...formData, startDate: e.target.value})} /></div>
                    <div><label className="block text-sm font-bold text-slate-700 mb-1">Au</label><input type="date" required className="w-full px-3 py-2 border border-slate-300 rounded-xl text-slate-900 font-medium" value={formData.endDate} onChange={(e) => setFormData({...formData, endDate: e.target.value})} /></div>
                </div>
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Type</label>
                    <select className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-900 font-medium" value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value as LeaveType})}>
                        {Object.values(LeaveType).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Motif</label>
                    <textarea rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-slate-900 font-medium" value={formData.reason} onChange={(e) => setFormData({...formData, reason: e.target.value})} />
                </div>
                
                {/* AFFICHAGE DU CALCUL DES JOURS OUVRABLES */}
                {formData.startDate && formData.endDate && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <CalendarDays size={18} className="text-blue-600" />
                            <span className="font-bold text-blue-800">Calcul des jours ouvrables</span>
                        </div>
                        {(() => {
                            const calc = calculateWorkingDays(formData.startDate!, formData.endDate!, currentUser.id);
                            return (
                                <div className="space-y-1 text-sm">
                                    <p className="text-blue-900 font-semibold">
                                        <span className="text-2xl">{calc.days}</span> jour(s) ouvrable(s) à déduire
                                    </p>
                                    {calc.saturdaysDeducted > 0 && (
                                        <p className="text-blue-700">
                                            Dont {calc.saturdaysDeducted} samedi(s) inclus
                                        </p>
                                    )}
                                    <p className="text-blue-600 text-xs mt-2">
                                        ℹ️ Jours ouvrables = Lundi à Samedi, hors dimanches et jours fériés
                                    </p>
                                    {new Date(formData.endDate!).getDay() === 5 && (
                                        <p className="text-amber-700 text-xs font-medium">
                                            ⚠️ Règle vendredi-lundi appliquée : le samedi suivant est inclus
                                        </p>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}
                
                <button type="submit" className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold shadow-lg">
                    {selectedLeave ? 'Enregistrer les modifications' : 'Envoyer la demande'}
                </button>
            </form>
        </Modal>

        {/* --- DETAIL MODAL --- */}
        <Modal
            isOpen={isDetailModalOpen && !!selectedLeave}
            onClose={() => setIsDetailModalOpen(false)}
            title="Détail de la demande"
            size="lg"
            headerIcon={<Calendar size={20} />}
        >
            {selectedLeave && (
                <div className="space-y-4">
                    <div className="flex items-center gap-4 mb-4">
                         <div className="bg-slate-100 p-3 rounded-full"><UserIcon size={24} className="text-slate-600"/></div>
                         <div>
                             <p className="font-bold text-slate-800 text-lg">{getUserName(selectedLeave.userId)}</p>
                             <p className="text-slate-600 text-sm font-medium">{selectedLeave.type}</p>
                         </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                         <div>
                             <p className="text-xs text-slate-500 uppercase font-bold">Début</p>
                             <p className="font-bold text-slate-900">{new Date(selectedLeave.startDate).toLocaleDateString()}</p>
                         </div>
                         <div>
                             <p className="text-xs text-slate-500 uppercase font-bold">Fin</p>
                             <p className="font-bold text-slate-900">{new Date(selectedLeave.endDate).toLocaleDateString()}</p>
                         </div>
                    </div>

                    {/* DÉTAIL DU CALCUL DES JOURS OUVRABLES */}
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <p className="text-xs text-blue-600 uppercase font-bold mb-1">Jours ouvrables décomptés</p>
                        <p className="text-2xl font-bold text-blue-900">
                            {selectedLeave.workingDays ?? calculateDays(selectedLeave.startDate, selectedLeave.endDate)} jour(s)
                        </p>
                        {selectedLeave.saturdaysDeducted && selectedLeave.saturdaysDeducted > 0 && (
                            <p className="text-sm text-blue-700 mt-1">
                                Dont {selectedLeave.saturdaysDeducted} samedi(s) inclus
                            </p>
                        )}
                        {selectedLeave.calculationDetails && (
                            <p className="text-xs text-blue-600 mt-2">
                                {selectedLeave.calculationDetails}
                            </p>
                        )}
                    </div>

                    <div>
                        <p className="text-sm font-bold text-slate-700 mb-1">Statut</p>
                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${
                            selectedLeave.status === LeaveStatus.APPROVED ? 'bg-green-100 text-green-800' :
                            selectedLeave.status === LeaveStatus.REJECTED ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
                        }`}>
                            {selectedLeave.status}
                        </div>
                    </div>

                    {selectedLeave.status !== LeaveStatus.PENDING && (
                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-sm">
                            <p className="font-bold text-blue-900 flex items-center gap-2">
                                <ShieldCheck size={16}/> Traitement
                            </p>
                            <p className="text-blue-800 mt-1">
                                Décision prise par <strong>{selectedLeave.validatedBy ? getUserName(selectedLeave.validatedBy) : 'Administration'}</strong>
                            </p>
                        </div>
                    )}

                    {(isAdminOrDirector || (selectedLeave.userId === currentUser.id && selectedLeave.status === LeaveStatus.PENDING)) && (
                        <div className="pt-4 flex gap-3 border-t border-slate-100 mt-4">
                            <button onClick={handleEditClick} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors">
                                <Edit2 size={16} /> Modifier
                            </button>
                            <button onClick={() => triggerAction('DELETE', selectedLeave)} className="flex-1 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors">
                                <Trash2 size={16} /> Supprimer
                            </button>
                        </div>
                    )}
                </div>
            )}
        </Modal>

        {/* --- CONFIRMATION MODAL --- */}
        {pendingAction && (
            <ConfirmModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={executePendingAction}
                title="Confirmer l'action"
                message={
                    pendingAction.type === 'VALIDATE' 
                        ? "Confirmez-vous la validation de ces congés ? Le solde de l'utilisateur sera automatiquement débité."
                        : "Voulez-vous vraiment continuer ?"
                }
                type={pendingAction.type === 'DELETE' || pendingAction.type === 'REJECT' ? 'danger' : 'info'}
                confirmLabel="Confirmer"
                cancelLabel="Annuler"
            />
        )}
    </div>
  );
};

export default LeaveManager;
