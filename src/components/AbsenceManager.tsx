
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Calendar, CalendarDays, ChevronLeft, ChevronRight, Plus, CheckCircle, XCircle,
  Clock, User as UserIcon, AlertTriangle, Trash2, Edit2, Upload, FileText,
  Download, Filter, Search, Eye, MessageSquare, AlertOctagon, Briefcase,
  Heart, GraduationCap, Baby, Ban, RotateCcw, HelpCircle, X, Save,
  FileCheck, CalendarRange, Users, PieChart, List, LayoutGrid, Printer, Mail, MapPin, Lock, Loader2
} from 'lucide-react';
import {
  Absence, AbsenceStatus, AbsenceType, AbsenceDocument, AbsenceModificationProposal, User, UserRole,
  ABSENCE_REQUIRES_DOCUMENT, ABSENCE_EMPLOYEE_CAN_REQUEST, ABSENCE_DIRECTION_ONLY, ABSENCE_IMPACTS_CP_BALANCE,
  Zone, ZONE_COLORS
} from '../types';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import {
  sendLeaveRequestEmail,
  sendLeaveApprovedEmail,
  sendLeaveRejectedEmail,
  sendLeaveModificationProposalEmail,
  getAdminEmails
} from '../services/emailService';
import { notifyLeaveRequest } from '../services/notificationService';
import { usePermissions, Permission } from '../usePermissions';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface AbsenceManagerProps {
  absences: Absence[];
  users: User[];
  currentUser: User;
  onAddAbsence: (absence: Absence) => Promise<void>;
  onUpdateAbsence: (absence: Absence) => Promise<void>;
  onDeleteAbsence: (id: string) => Promise<void>;
  onUploadDocument?: (absenceId: string, file: File, type: AbsenceDocument['type']) => Promise<string>;
  onUpdateUserBalance?: (user: User) => Promise<void>;
  defaultTypeFilter?: AbsenceType;  // Pré-filtre (ex: pour vue "Congés")
  customTitle?: string;              // Titre personnalisé (ex: "Gestion des Congés")
}

type ViewMode = 'calendar' | 'list' | 'today' | 'stats';
type CalendarView = 'month' | 'week';

// ============================================================================
// HELPERS
// ============================================================================

const normalizeRole = (role: string | UserRole): string => {
  return String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const canManageAbsences = (user: User): boolean => {
  const r = normalizeRole(user.role);
  return r.includes('admin') || r.includes('presid') || r.includes('direct') || r.includes('secret');
};

const canValidateAbsences = (user: User): boolean => {
  const r = normalizeRole(user.role);
  return r.includes('admin') || r.includes('presid') || r.includes('direct') || r.includes('secret');
};

const getAbsenceTypeIcon = (type: AbsenceType) => {
  switch (type) {
    case AbsenceType.CP: return <CalendarDays size={16} className="text-blue-600" />;
    case AbsenceType.RTT: return <Clock size={16} className="text-indigo-600" />;
    case AbsenceType.CSS: return <Ban size={16} className="text-slate-600" />;
    case AbsenceType.MALADIE: return <Heart size={16} className="text-red-600" />;
    case AbsenceType.AT: return <AlertOctagon size={16} className="text-orange-600" />;
    case AbsenceType.MATERNITE: return <Baby size={16} className="text-pink-600" />;
    case AbsenceType.PATERNITE: return <Baby size={16} className="text-cyan-600" />;
    case AbsenceType.FORMATION: return <GraduationCap size={16} className="text-purple-600" />;
    case AbsenceType.INJUSTIFIEE: return <AlertTriangle size={16} className="text-red-700" />;
    case AbsenceType.RECUP: return <RotateCcw size={16} className="text-green-600" />;
    default: return <HelpCircle size={16} className="text-slate-400" />;
  }
};

const getAbsenceTypeColor = (type: AbsenceType): string => {
  switch (type) {
    case AbsenceType.CP: return 'bg-blue-100 text-blue-700 border-blue-200';
    case AbsenceType.RTT: return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case AbsenceType.CSS: return 'bg-slate-100 text-slate-700 border-slate-200';
    case AbsenceType.MALADIE: return 'bg-red-100 text-red-700 border-red-200';
    case AbsenceType.AT: return 'bg-orange-100 text-orange-700 border-orange-200';
    case AbsenceType.MATERNITE: return 'bg-pink-100 text-pink-700 border-pink-200';
    case AbsenceType.PATERNITE: return 'bg-cyan-100 text-cyan-700 border-cyan-200';
    case AbsenceType.FORMATION: return 'bg-purple-100 text-purple-700 border-purple-200';
    case AbsenceType.INJUSTIFIEE: return 'bg-red-200 text-red-800 border-red-300';
    case AbsenceType.RECUP: return 'bg-green-100 text-green-700 border-green-200';
    default: return 'bg-slate-100 text-slate-600 border-slate-200';
  }
};

const getStatusBadge = (status: AbsenceStatus) => {
  switch (status) {
    case AbsenceStatus.PENDING:
      return <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">En attente</span>;
    case AbsenceStatus.APPROVED:
      return <span className="px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Validé</span>;
    case AbsenceStatus.REJECTED:
      return <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Refusé</span>;
    case AbsenceStatus.MODIFICATION_PROPOSED:
      return <span className="px-2 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700">Modification</span>;
    default:
      return null;
  }
};

// Calcul des jours ouvrables (lun-ven + samedis si configuré)
const calculateWorkingDays = (start: string, end: string, countSaturdays: boolean = false): { days: number; saturdays: number; details: string } => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  let days = 0;
  let saturdays = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      days++;
    } else if (dayOfWeek === 6 && countSaturdays) {
      days++;
      saturdays++;
    }
    current.setDate(current.getDate() + 1);
  }

  const details = countSaturdays && saturdays > 0 
    ? `${days - saturdays} jours ouvrés + ${saturdays} samedi(s)`
    : `${days} jours ouvrés`;

  return { days, saturdays, details };
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateShort = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// --- Stats Card ---
interface StatsCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, subtitle, icon, color }) => (
  <div className={`p-4 rounded-xl border ${color}`}>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-bold uppercase opacity-70">{title}</p>
        <p className="text-2xl font-extrabold">{value}</p>
        {subtitle && <p className="text-xs opacity-70">{subtitle}</p>}
      </div>
      <div className="opacity-50">{icon}</div>
    </div>
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const AbsenceManager: React.FC<AbsenceManagerProps> = ({
  absences,
  users,
  currentUser,
  onAddAbsence,
  onUpdateAbsence,
  onDeleteAbsence,
  onUploadDocument,
  onUpdateUserBalance,
  defaultTypeFilter,
  customTitle
}) => {
  // --- STATE ---
  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<AbsenceType | 'all'>(defaultTypeFilter || 'all');
  const [statusFilter, setStatusFilter] = useState<AbsenceStatus | 'all'>('all');
  const [userFilter, setUserFilter] = useState<string>('all');

  // Modals
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editingAbsence, setEditingAbsence] = useState<Absence | null>(null);
  const [selectedAbsence, setSelectedAbsence] = useState<Absence | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  
  // Modification proposal
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [proposalData, setProposalData] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });
  const [isProposing, setIsProposing] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<Absence>>({
    type: AbsenceType.CP,
    startDate: '',
    endDate: '',
    reason: '',
    userId: ''
  });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Report state
  const [reportStartDate, setReportStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [reportEndDate, setReportEndDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 0);
    return d.toISOString().split('T')[0];
  });
  const [reportTypes, setReportTypes] = useState<AbsenceType[]>(Object.values(AbsenceType));
  const [reportUserId, setReportUserId] = useState<string>('all');

  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewOwn = hasPermission(Permission.ABSENCES_VIEW_OWN);
  const canViewTeam = hasPermission(Permission.ABSENCES_VIEW_TEAM);
  const canViewAll = hasPermission(Permission.ABSENCES_VIEW_ALL);
  const canCreate = hasPermission(Permission.ABSENCES_CREATE);
  const canEditOwn = hasPermission(Permission.ABSENCES_EDIT_OWN);
  const canDeleteOwn = hasPermission(Permission.ABSENCES_DELETE_OWN);
  const canValidateAbsence = hasPermission(Permission.ABSENCES_VALIDATE);
  const canExport = hasPermission(Permission.ABSENCES_REPORT);

  // Rétrocompatibilité avec l'ancien code
  const isManager = canViewAll;
  const canValidate = canValidateAbsence;
  const isDriver = canViewOwn && !canViewAll;
  // ÉQUIPE DE DIRECTION uniquement (président / directeur / admin — PAS secrétariat) :
  // seule habilitée à déclarer les arrêts maladie et accidents du travail.
  const isDirection = (() => {
    const r = normalizeRole(currentUser.role);
    return r.includes('admin') || r.includes('presid') || r.includes('direct');
  })();

  // --- COMPUTED ---
  const drivers = useMemo(() => {
    return users.filter(u => {
      const r = normalizeRole(u.role);
      return r.includes('chauff') || r.includes('driver');
    });
  }, [users]);

  // Absences accessibles selon le rôle et la zone
  const accessibleAbsences = useMemo(() => {
    if (isManager) return absences; // Managers voient tout
    
    // Chauffeurs voient :
    // - Leurs propres absences
    // - Les absences de leur zone (autres chauffeurs)
    return absences.filter(a => {
      // Toujours voir ses propres absences
      if (a.userId === currentUser.id) return true;
      
      // Si chauffeur avec une zone, voir les absences de la même zone
      if (isDriver && currentUser.zone) {
        const absenceUser = users.find(u => u.id === a.userId);
        if (absenceUser?.zone === currentUser.zone) return true;
      }
      
      return false;
    });
  }, [absences, isManager, isDriver, currentUser, users]);

  const todayAbsences = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return accessibleAbsences.filter(a => {
      if (a.status === AbsenceStatus.REJECTED) return false;
      const start = new Date(a.startDate);
      const end = new Date(a.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return today >= start && today <= end;
    });
  }, [accessibleAbsences]);

  const pendingAbsences = useMemo(() => {
    return accessibleAbsences.filter(a => a.status === AbsenceStatus.PENDING);
  }, [accessibleAbsences]);

  const filteredAbsences = useMemo(() => {
    return accessibleAbsences.filter(a => {
      // Search
      if (searchTerm) {
        const user = users.find(u => u.id === a.userId);
        const userName = user ? `${user.firstName} ${user.lastName}`.toLowerCase() : '';
        if (!userName.includes(searchTerm.toLowerCase()) && !a.reason?.toLowerCase().includes(searchTerm.toLowerCase())) {
          return false;
        }
      }
      // Type filter
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      // Status filter
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      // User filter
      if (userFilter !== 'all' && a.userId !== userFilter) return false;
      
      return true;
    }).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [accessibleAbsences, searchTerm, typeFilter, statusFilter, userFilter, users]);

  // Compteurs par zone pour le rappel
  const zoneStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const stats: Record<Zone, number> = {
      [Zone.NORD]: 0,
      [Zone.EST]: 0,
      [Zone.SUD]: 0,
      [Zone.OUEST]: 0
    };
    
    absences.forEach(a => {
      if (a.status === AbsenceStatus.REJECTED) return;
      const start = new Date(a.startDate);
      const end = new Date(a.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      
      if (today >= start && today <= end) {
        const user = users.find(u => u.id === a.userId);
        if (user?.zone) {
          stats[user.zone]++;
        }
      }
    });
    
    return stats;
  }, [absences, users]);

  // Stats
  const stats = useMemo(() => {
    const thisMonth = new Date();
    const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
    const monthEnd = new Date(thisMonth.getFullYear(), thisMonth.getMonth() + 1, 0);

    const thisMonthAbsences = absences.filter(a => {
      const start = new Date(a.startDate);
      return start >= monthStart && start <= monthEnd && a.status !== AbsenceStatus.REJECTED;
    });

    const byType: Record<string, number> = {};
    thisMonthAbsences.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + (a.workingDays || 0);
    });

    const totalDays = Object.values(byType).reduce((sum, d) => sum + d, 0);

    return {
      totalDays,
      maladieDays: byType[AbsenceType.MALADIE] || 0,
      cpDays: byType[AbsenceType.CP] || 0,
      atCount: absences.filter(a => a.type === AbsenceType.AT && new Date(a.startDate).getFullYear() === thisMonth.getFullYear()).length,
      formationDays: byType[AbsenceType.FORMATION] || 0
    };
  }, [absences]);

  // Calendar data
  const calendarData = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // Adjust to start on Monday
    const startOffset = (firstDay.getDay() + 6) % 7;
    const calendarStart = new Date(firstDay);
    calendarStart.setDate(calendarStart.getDate() - startOffset);

    const days: { date: Date; absences: Absence[]; isCurrentMonth: boolean }[] = [];
    const current = new Date(calendarStart);

    for (let i = 0; i < 42; i++) {
      const dateAbsences = absences.filter(a => {
        if (a.status === AbsenceStatus.REJECTED) return false;
        const start = new Date(a.startDate);
        const end = new Date(a.endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        const check = new Date(current);
        check.setHours(12, 0, 0, 0);
        return check >= start && check <= end;
      });

      days.push({
        date: new Date(current),
        absences: dateAbsences,
        isCurrentMonth: current.getMonth() === month
      });

      current.setDate(current.getDate() + 1);
    }

    return days;
  }, [currentMonth, absences]);

  // --- HANDLERS ---
  const openCreateModal = (forUser?: string) => {
    setEditingAbsence(null);
    setFormData({
      type: AbsenceType.CP,
      startDate: '',
      endDate: '',
      reason: '',
      userId: forUser || (isManager ? '' : currentUser.id)
    });
    setFormErrors([]);
    setIsFormModalOpen(true);
  };

  const openEditModal = (absence: Absence) => {
    setEditingAbsence(absence);
    setFormData({ ...absence });
    setFormErrors([]);
    setIsFormModalOpen(true);
  };

  const openDetailModal = (absence: Absence) => {
    setSelectedAbsence(absence);
    setIsDetailModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setPendingDelete(id);
    setIsConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (pendingDelete) {
      await onDeleteAbsence(pendingDelete);
      setPendingDelete(null);
      setIsConfirmOpen(false);
      setIsDetailModalOpen(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: string[] = [];
    
    if (!formData.userId && isManager) errors.push('Veuillez sélectionner un employé');
    if (!formData.type) errors.push('Veuillez sélectionner un type');
    if (!formData.startDate) errors.push('Date de début requise');
    if (!formData.endDate) errors.push('Date de fin requise');
    if (formData.startDate && formData.endDate && new Date(formData.startDate) > new Date(formData.endDate)) {
      errors.push('La date de fin doit être après la date de début');
    }
    
    // AT specific
    if (formData.type === AbsenceType.AT && !formData.accidentDate) {
      errors.push('Date de l\'accident requise pour un AT');
    }

    setFormErrors(errors);
    return errors.length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setIsSubmitting(true);

    const { days, saturdays, details } = calculateWorkingDays(formData.startDate!, formData.endDate!);

    const absenceData: Absence = {
      id: editingAbsence?.id || `abs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: formData.userId || currentUser.id,
      type: formData.type!,
      startDate: formData.startDate!,
      endDate: formData.endDate!,
      halfDayStart: formData.halfDayStart,
      halfDayEnd: formData.halfDayEnd,
      status: editingAbsence?.status || (isManager && !ABSENCE_EMPLOYEE_CAN_REQUEST.includes(formData.type!) 
        ? AbsenceStatus.APPROVED 
        : AbsenceStatus.PENDING),
      reason: formData.reason,
      workingDays: days,
      saturdaysDeducted: saturdays,
      calculationDetails: details,
      
      // Documents
      documents: editingAbsence?.documents || [],
      documentReceived: formData.documentReceived,
      documentReceivedDate: formData.documentReceivedDate,
      documentReceivedBy: formData.documentReceivedBy,
      
      // AT specific
      accidentDate: formData.accidentDate,
      accidentDescription: formData.accidentDescription,
      accidentLocation: formData.accidentLocation,
      accidentWitnesses: formData.accidentWitnesses,
      
      // Maladie specific
      sicknessStartDate: formData.sicknessStartDate,
      sicknessEndDate: formData.sicknessEndDate,
      extension: formData.extension,
      
      // Validation
      validatedBy: editingAbsence?.validatedBy,
      validatedAt: editingAbsence?.validatedAt,
      adminComment: formData.adminComment,
      
      // Modification proposal
      modificationProposal: editingAbsence?.modificationProposal,
      
      // Metadata
      createdAt: editingAbsence?.createdAt || new Date().toISOString(),
      createdBy: editingAbsence?.createdBy || currentUser.id,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editingAbsence) {
        await onUpdateAbsence(absenceData);
        alert('✅ Demande mise à jour avec succès !');
      } else {
        await onAddAbsence(absenceData);
        
        // 📧 ENVOI EMAIL + NOTIFICATION IN-APP À LA DIRECTION (nouvelle demande en attente)
        if (absenceData.status === AbsenceStatus.PENDING) {
          const employee = users.find(u => u.id === absenceData.userId) || currentUser;
          
          // Récupérer les IDs des admins/direction/président pour notification in-app
          const adminIds = users
            .filter(u => u.role === UserRole.ADMIN || u.role === UserRole.DIRECTOR ||
                        u.role === UserRole.PRESIDENT)
            .map(u => u.id);
          
          // Labels pour les types d'absence
          const typeLabels: Record<AbsenceType, string> = {
            [AbsenceType.CP]: 'congés payés',
            [AbsenceType.RTT]: 'RTT',
            [AbsenceType.CSS]: 'congés sans solde',
            [AbsenceType.MALADIE]: 'arrêt maladie',
            [AbsenceType.AT]: 'accident du travail',
            [AbsenceType.MATERNITE]: 'congé maternité',
            [AbsenceType.PATERNITE]: 'congé paternité',
            [AbsenceType.FORMATION]: 'formation',
            [AbsenceType.INJUSTIFIEE]: 'absence injustifiée',
            [AbsenceType.RECUP]: 'récupération',
            [AbsenceType.AUTRE]: 'autre absence'
          };
          
          const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');
          
          // Notification in-app
          if (adminIds.length > 0) {
            notifyLeaveRequest(
              adminIds,
              `${employee.firstName} ${employee.lastName}`,
              typeLabels[absenceData.type] || absenceData.type,
              formatDate(absenceData.startDate),
              formatDate(absenceData.endDate),
              days
            ).catch(e => console.warn('[Notif in-app] Erreur:', e));
          }
          
          // Email
          const approverEmails = getAdminEmails(users);
          if (approverEmails.length > 0) {
            sendLeaveRequestEmail(absenceData, employee, approverEmails)
              .catch(e => console.warn('[Email] Erreur:', e));
          }
        }
        
        alert('✅ Demande de congé créée avec succès !');
      }

      setIsFormModalOpen(false);
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde:', error);
      alert('❌ Erreur lors de la sauvegarde de la demande. Veuillez réessayer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleValidate = async (absence: Absence, status: AbsenceStatus, comment?: string) => {
    const updated: Absence = {
      ...absence,
      status,
      validatedBy: currentUser.id,
      validatedAt: new Date().toISOString(),
      adminComment: comment || absence.adminComment,
      updatedAt: new Date().toISOString()
    };

    await onUpdateAbsence(updated);

    // Update user balance if CP approved
    if (status === AbsenceStatus.APPROVED && ABSENCE_IMPACTS_CP_BALANCE.includes(absence.type) && onUpdateUserBalance) {
      const user = users.find(u => u.id === absence.userId);
      if (user) {
        const newBalance = (user.leaveBalance || 0) - (absence.workingDays || 0);
        await onUpdateUserBalance({ ...user, leaveBalance: Math.max(0, newBalance) });
      }
    }

    // 📧 ENVOI EMAIL À L'EMPLOYÉ
    const employee = users.find(u => u.id === absence.userId);
    if (employee?.email) {
      const approverName = `${currentUser.firstName} ${currentUser.lastName}`;
      
      if (status === AbsenceStatus.APPROVED) {
        await sendLeaveApprovedEmail(updated, employee, approverName);
      } else if (status === AbsenceStatus.REJECTED) {
        await sendLeaveRejectedEmail(updated, employee, approverName, comment);
      }
    }

    setIsDetailModalOpen(false);
  };

  // === PROPOSITION DE MODIFICATION ===
  
  const openProposalModal = (absence: Absence) => {
    setProposalData({
      startDate: absence.startDate,
      endDate: absence.endDate,
      reason: ''
    });
    setIsProposalModalOpen(true);
  };

  const handleProposeModification = async () => {
    if (!selectedAbsence || !proposalData.startDate || !proposalData.endDate) return;
    if (!proposalData.reason.trim()) {
      alert('Veuillez indiquer la raison de la modification proposée.');
      return;
    }
    
    setIsProposing(true);
    
    try {
      const proposal: AbsenceModificationProposal = {
        proposedStartDate: proposalData.startDate,
        proposedEndDate: proposalData.endDate,
        reason: proposalData.reason,
        proposedBy: currentUser.id,
        proposedAt: new Date().toISOString()
      };
      
      const updated: Absence = {
        ...selectedAbsence,
        status: AbsenceStatus.MODIFICATION_PROPOSED,
        modificationProposal: proposal,
        updatedAt: new Date().toISOString()
      };
      
      await onUpdateAbsence(updated);
      
      // Notification in-app au collaborateur
      const employee = users.find(u => u.id === selectedAbsence.userId);
      if (employee) {
        // Notification
        notifyLeaveRequest(
          [employee.id],
          `${currentUser.firstName} ${currentUser.lastName}`,
          `MODIFICATION PROPOSÉE pour vos congés`,
          new Date(proposalData.startDate).toLocaleDateString('fr-FR'),
          new Date(proposalData.endDate).toLocaleDateString('fr-FR'),
          0
        ).catch(e => console.warn('[Notif] Erreur:', e));
        
        // Email si disponible
        if (employee.email) {
          sendLeaveModificationProposalEmail(
            selectedAbsence,
            employee,
            `${currentUser.firstName} ${currentUser.lastName}`,
            proposalData.startDate,
            proposalData.endDate,
            proposalData.reason
          ).catch(e => console.warn('[Email] Erreur envoi proposition:', e));
        }
      }
      
      alert('✅ Proposition de modification envoyée au collaborateur !');
      setIsProposalModalOpen(false);
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error('Erreur proposition modification:', error);
      alert('❌ Erreur lors de l\'envoi de la proposition');
    } finally {
      setIsProposing(false);
    }
  };

  const handleAcceptProposal = async (absence: Absence) => {
    if (!absence.modificationProposal) return;
    
    try {
      const { days, saturdays, details } = calculateWorkingDays(
        absence.modificationProposal.proposedStartDate,
        absence.modificationProposal.proposedEndDate
      );
      
      const updated: Absence = {
        ...absence,
        startDate: absence.modificationProposal.proposedStartDate,
        endDate: absence.modificationProposal.proposedEndDate,
        workingDays: days,
        saturdaysDeducted: saturdays,
        calculationDetails: details,
        status: AbsenceStatus.APPROVED,
        modificationProposal: undefined, // Clear proposal
        validatedBy: absence.modificationProposal.proposedBy,
        validatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await onUpdateAbsence(updated);
      
      // Débiter le solde CP si nécessaire
      if (ABSENCE_IMPACTS_CP_BALANCE.includes(absence.type) && onUpdateUserBalance) {
        const user = users.find(u => u.id === absence.userId);
        if (user) {
          const newBalance = (user.leaveBalance || 0) - days;
          await onUpdateUserBalance({ ...user, leaveBalance: Math.max(0, newBalance) });
        }
      }
      
      // Notification au manager qui a proposé
      const proposer = users.find(u => u.id === absence.modificationProposal?.proposedBy);
      if (proposer) {
        notifyLeaveRequest(
          [proposer.id],
          `${currentUser.firstName} ${currentUser.lastName}`,
          'a ACCEPTÉ votre proposition de modification',
          new Date(absence.modificationProposal.proposedStartDate).toLocaleDateString('fr-FR'),
          new Date(absence.modificationProposal.proposedEndDate).toLocaleDateString('fr-FR'),
          days
        ).catch(e => console.warn('[Notif] Erreur:', e));
      }
      
      alert('✅ Modification acceptée ! Vos congés sont maintenant validés.');
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error('Erreur acceptation proposition:', error);
      alert('❌ Erreur lors de l\'acceptation');
    }
  };

  const handleRejectProposal = async (absence: Absence) => {
    if (!confirm('Refuser la modification proposée ? La demande reviendra en attente de validation.')) return;
    
    try {
      const updated: Absence = {
        ...absence,
        status: AbsenceStatus.PENDING,
        modificationProposal: undefined, // Clear proposal
        updatedAt: new Date().toISOString()
      };
      
      await onUpdateAbsence(updated);
      
      // Notification au manager
      const proposer = users.find(u => u.id === absence.modificationProposal?.proposedBy);
      if (proposer) {
        notifyLeaveRequest(
          [proposer.id],
          `${currentUser.firstName} ${currentUser.lastName}`,
          'a REFUSÉ votre proposition de modification',
          new Date(absence.startDate).toLocaleDateString('fr-FR'),
          new Date(absence.endDate).toLocaleDateString('fr-FR'),
          0
        ).catch(e => console.warn('[Notif] Erreur:', e));
      }
      
      alert('Modification refusée. La demande est de nouveau en attente.');
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error('Erreur refus proposition:', error);
      alert('❌ Erreur lors du refus');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingAbsence || !onUploadDocument) return;

    setUploadingFile(true);
    try {
      const url = await onUploadDocument(editingAbsence.id, file, 'certificat_medical');
      
      const newDoc: AbsenceDocument = {
        id: `doc_${Date.now()}`,
        name: file.name,
        url,
        uploadedAt: new Date().toISOString(),
        uploadedBy: currentUser.id,
        type: 'certificat_medical'
      };

      setFormData(prev => ({
        ...prev,
        documents: [...(prev.documents || []), newDoc],
        documentReceived: true,
        documentReceivedDate: new Date().toISOString(),
        documentReceivedBy: currentUser.id
      }));
    } catch (err) {
      console.error('Erreur upload:', err);
    } finally {
      setUploadingFile(false);
    }
  };

  // --- REPORT GENERATION ---
  const generateReport = () => {
    const filtered = absences.filter(a => {
      const start = new Date(a.startDate);
      const rStart = new Date(reportStartDate);
      const rEnd = new Date(reportEndDate);
      
      if (start < rStart || start > rEnd) return false;
      if (reportUserId !== 'all' && a.userId !== reportUserId) return false;
      if (!reportTypes.includes(a.type)) return false;
      
      return true;
    }).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

    // Generate CSV
    const headers = ['Employé', 'Type', 'Du', 'Au', 'Jours', 'Statut', 'Motif', 'Justificatif'];
    const rows = filtered.map(a => {
      const user = users.find(u => u.id === a.userId);
      return [
        user ? `${user.firstName} ${user.lastName}` : 'Inconnu',
        a.type,
        formatDate(a.startDate),
        formatDate(a.endDate),
        a.workingDays || 0,
        a.status,
        a.reason || '',
        a.documentReceived ? 'Oui' : 'Non'
      ];
    });

    // Summary by type
    const summary: Record<string, number> = {};
    filtered.forEach(a => {
      summary[a.type] = (summary[a.type] || 0) + (a.workingDays || 0);
    });

    const csvContent = [
      `Rapport des absences du ${formatDate(reportStartDate)} au ${formatDate(reportEndDate)}`,
      '',
      headers.join(';'),
      ...rows.map(r => r.join(';')),
      '',
      'RÉSUMÉ PAR TYPE',
      ...Object.entries(summary).map(([type, days]) => `${type};${days} jours`)
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rapport_absences_${reportStartDate}_${reportEndDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setIsReportModalOpen(false);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6 animate-fade-in">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarDays className="text-brand-600" /> {customTitle || 'Gestion des Absences'}
          </h2>
          <p className="text-slate-500">
            {isManager 
              ? (defaultTypeFilter ? 'Gérez les congés de votre équipe' : 'Gérez les absences de votre équipe')
              : (defaultTypeFilter ? 'Gérez vos demandes de congés' : 'Gérez vos demandes d\'absence')
            }
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isManager && (
            <button
              onClick={() => setIsReportModalOpen(true)}
              className="px-4 py-2 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <Download size={16} /> Rapport
            </button>
          )}
          <button
            onClick={() => openCreateModal()}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg"
          >
            <Plus size={16} /> Nouvelle absence
          </button>
        </div>
      </div>

      {/* STATS CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          title="Absents aujourd'hui"
          value={todayAbsences.length}
          subtitle={`sur ${drivers.length} chauffeurs`}
          icon={<Users size={24} />}
          color="bg-blue-50 text-blue-700 border-blue-200"
        />
        <StatsCard
          title="Demandes en attente"
          value={pendingAbsences.length}
          subtitle="à valider"
          icon={<Clock size={24} />}
          color="bg-amber-50 text-amber-700 border-amber-200"
        />
        <StatsCard
          title="Maladie (ce mois)"
          value={`${stats.maladieDays} j`}
          icon={<Heart size={24} />}
          color="bg-red-50 text-red-700 border-red-200"
        />
        <StatsCard
          title="AT (cette année)"
          value={stats.atCount}
          subtitle="accidents"
          icon={<AlertOctagon size={24} />}
          color="bg-orange-50 text-orange-700 border-orange-200"
        />
      </div>

      {/* ZONE SUMMARY BANNER */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-2xl p-4 text-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MapPin size={24} className="text-slate-300" />
            <div>
              <h3 className="font-bold text-lg">
                {isDriver && currentUser.zone 
                  ? `Absences Zone ${currentUser.zone} aujourd'hui` 
                  : "Absences par zone aujourd'hui"}
              </h3>
              <p className="text-slate-300 text-sm">
                {isDriver && currentUser.zone
                  ? "Vos collègues de secteur"
                  : "Vue d'ensemble de toutes les zones"}
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {(isManager ? Object.values(Zone) : (currentUser.zone ? [currentUser.zone] : [])).map(zone => {
              const colors = ZONE_COLORS[zone];
              const count = zoneStats[zone];
              return (
                <div 
                  key={zone}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl ${colors.bg} ${colors.text} border ${colors.border}`}
                >
                  <span className={`w-3 h-3 rounded-full ${colors.dot}`}></span>
                  <span className="font-bold">{zone}</span>
                  <span className="bg-white/50 px-2 py-0.5 rounded-full text-sm font-extrabold">{count}</span>
                </div>
              );
            })}
            {isManager && (
              <div className="flex items-center gap-2 px-3 py-2 bg-white/10 rounded-xl text-white">
                <span className="font-bold">Total</span>
                <span className="bg-white text-slate-800 px-2 py-0.5 rounded-full text-sm font-extrabold">
                  {Object.values(zoneStats).reduce((a, b) => a + b, 0)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VIEW TABS & FILTERS */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          {/* View mode tabs */}
          <div className="flex bg-slate-100 rounded-xl p-1">
            {[
              { mode: 'today' as ViewMode, label: 'Aujourd\'hui', icon: CalendarDays },
              { mode: 'list' as ViewMode, label: 'Liste', icon: List },
              { mode: 'calendar' as ViewMode, label: 'Calendrier', icon: Calendar },
              { mode: 'stats' as ViewMode, label: 'Stats', icon: PieChart }
            ].map(tab => (
              <button
                key={tab.mode}
                onClick={() => setViewMode(tab.mode)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                  viewMode === tab.mode 
                    ? 'bg-white text-slate-800 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon size={16} /> {tab.label}
              </button>
            ))}
          </div>

          {/* Filters */}
          {(viewMode === 'list' || viewMode === 'calendar') && (
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Rechercher..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                />
              </div>

              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as AbsenceType | 'all')}
                className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
              >
                <option value="all">Tous les types</option>
                {Object.values(AbsenceType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              {isManager && (
                <select
                  value={userFilter}
                  onChange={e => setUserFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                >
                  <option value="all">Tous les employés</option>
                  {drivers.map(u => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ================ VIEW: TODAY ================ */}
      {viewMode === 'today' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Absents aujourd'hui */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Users size={18} className="text-blue-500" /> Absents aujourd'hui
              </h3>
              <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                {todayAbsences.length}
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
              {todayAbsences.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <CheckCircle size={40} className="mx-auto mb-2 text-green-400" />
                  <p>Aucun absent aujourd'hui</p>
                </div>
              ) : (
                todayAbsences.map(a => {
                  const user = users.find(u => u.id === a.userId);
                  return (
                    <div 
                      key={a.id}
                      onClick={() => openDetailModal(a)}
                      className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${getAbsenceTypeColor(a.type)}`}>
                            {getAbsenceTypeIcon(a.type)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">
                              {user ? `${user.firstName} ${user.lastName}` : 'Inconnu'}
                            </p>
                            <p className="text-xs text-slate-500">{a.type}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-slate-600">
                            {formatDateShort(a.startDate)} → {formatDateShort(a.endDate)}
                          </p>
                          <p className="text-xs text-slate-400">{a.workingDays} jour(s)</p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Demandes en attente */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Clock size={18} className="text-amber-500" /> Demandes en attente
              </h3>
              <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                {pendingAbsences.length}
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
              {pendingAbsences.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <CheckCircle size={40} className="mx-auto mb-2 text-green-400" />
                  <p>Aucune demande en attente</p>
                </div>
              ) : (
                pendingAbsences.map(a => {
                  const user = users.find(u => u.id === a.userId);
                  return (
                    <div 
                      key={a.id}
                      onClick={() => openDetailModal(a)}
                      className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${getAbsenceTypeColor(a.type)}`}>
                            {getAbsenceTypeIcon(a.type)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800">
                              {user ? `${user.firstName} ${user.lastName}` : 'Inconnu'}
                            </p>
                            <p className="text-xs text-slate-500">{a.type} • {a.workingDays} jour(s)</p>
                          </div>
                        </div>
                        {canValidate && (
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleValidate(a, AbsenceStatus.APPROVED); }}
                              className="p-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg"
                              title="Valider"
                            >
                              <CheckCircle size={16} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedAbsence(a); setRejectReason(''); setIsRejectModalOpen(true); }}
                              className="p-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
                              title="Refuser"
                            >
                              <XCircle size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================ VIEW: LIST ================ */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Employé</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Période</th>
                  <th className="px-4 py-3 text-center">Jours</th>
                  <th className="px-4 py-3 text-center">Statut</th>
                  <th className="px-4 py-3 text-center">Justificatif</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAbsences.map(a => {
                  const user = users.find(u => u.id === a.userId);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-800">
                          {user ? `${user.firstName} ${user.lastName}` : 'Inconnu'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getAbsenceTypeIcon(a.type)}
                          <span className="text-sm text-slate-700">{a.type}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {formatDate(a.startDate)} → {formatDate(a.endDate)}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-800">
                        {a.workingDays}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {getStatusBadge(a.status)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ABSENCE_REQUIRES_DOCUMENT.includes(a.type) ? (
                          a.documentReceived ? (
                            <span className="text-green-600"><FileCheck size={18} /></span>
                          ) : (
                            <span className="text-orange-500"><AlertTriangle size={18} /></span>
                          )
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openDetailModal(a)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
                            title="Détails"
                          >
                            <Eye size={16} />
                          </button>
                          {(isManager || a.userId === currentUser.id) && a.status === AbsenceStatus.PENDING && (
                            <>
                              <button
                                onClick={() => openEditModal(a)}
                                className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
                                title="Modifier"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleDelete(a.id)}
                                className="p-2 hover:bg-red-50 rounded-lg text-red-500"
                                title="Supprimer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredAbsences.length === 0 && (
              <div className="p-12 text-center text-slate-400">
                <CalendarDays size={48} className="mx-auto mb-3 opacity-50" />
                <p>Aucune absence trouvée</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================ VIEW: CALENDAR (BARRES HORIZONTALES) ================ */}
      {viewMode === 'calendar' && (() => {
        // Calculer les jours de la semaine actuelle
        const weekStart = new Date(currentMonth);
        const dayOfWeek = weekStart.getDay();
        weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1)); // Lundi
        
        const weekDays: Date[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart);
          d.setDate(d.getDate() + i);
          weekDays.push(d);
        }
        
        // Récupérer les absences de la période avec infos utilisateur
        const periodAbsences = accessibleAbsences
          .filter(a => {
            if (a.status === AbsenceStatus.REJECTED) return false;
            const start = new Date(a.startDate);
            const end = new Date(a.endDate);
            const weekEnd = weekDays[6];
            return start <= weekEnd && end >= weekDays[0];
          })
          .map(a => {
            const user = users.find(u => u.id === a.userId);
            return { ...a, user };
          })
          .sort((a, b) => {
            // Trier par zone puis par nom
            const zoneA = a.user?.zone || '';
            const zoneB = b.user?.zone || '';
            if (zoneA !== zoneB) return zoneA.localeCompare(zoneB);
            const nameA = `${a.user?.firstName} ${a.user?.lastName}`;
            const nameB = `${b.user?.firstName} ${b.user?.lastName}`;
            return nameA.localeCompare(nameB);
          });
        
        // Grouper par zone
        const byZone: Record<string, typeof periodAbsences> = {};
        periodAbsences.forEach(a => {
          const zone = a.user?.zone || 'Non assigné';
          if (!byZone[zone]) byZone[zone] = [];
          byZone[zone].push(a);
        });
        
        const zoneOrder = isManager ? [...Object.values(Zone), 'Non assigné'] : (currentUser.zone ? [currentUser.zone] : ['Non assigné']);

        return (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    const d = new Date(currentMonth);
                    d.setDate(d.getDate() - 7);
                    setCurrentMonth(d);
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <ChevronLeft size={20} />
                </button>
                <h3 className="text-xl font-bold text-slate-800 min-w-[280px] text-center">
                  Semaine du {weekDays[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
                </h3>
                <button
                  onClick={() => {
                    const d = new Date(currentMonth);
                    d.setDate(d.getDate() + 7);
                    setCurrentMonth(d);
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="px-3 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50 rounded-lg"
              >
                Cette semaine
              </button>
            </div>

            {/* Légende zones */}
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-500 uppercase">Zones :</span>
              {Object.values(Zone).map(zone => {
                const colors = ZONE_COLORS[zone];
                return (
                  <div key={zone} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded-full ${colors.dot}`}></span>
                    <span className="text-xs font-medium text-slate-600">{zone}</span>
                  </div>
                );
              })}
            </div>

            {/* Header jours */}
            <div className="grid grid-cols-[200px_repeat(7,1fr)] gap-1 mb-2">
              <div className="text-xs font-bold text-slate-500 uppercase p-2">Employé</div>
              {weekDays.map((day, idx) => {
                const isToday = day.toDateString() === new Date().toDateString();
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <div 
                    key={idx} 
                    className={`text-center text-xs font-bold p-2 rounded ${
                      isToday ? 'bg-brand-100 text-brand-700' : 
                      isWeekend ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    <div>{['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][day.getDay()]}</div>
                    <div className="text-lg">{day.getDate()}</div>
                  </div>
                );
              })}
            </div>

            {/* Barres par zone */}
            {zoneOrder.map(zone => {
              const zoneAbsences = byZone[zone] || [];
              if (zoneAbsences.length === 0) return null;
              
              const zoneColor = zone !== 'Non assigné' ? ZONE_COLORS[zone as Zone] : { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', dot: 'bg-slate-400' };
              
              return (
                <div key={zone} className="mb-4">
                  {/* Header zone */}
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg ${zoneColor.bg} ${zoneColor.text} border ${zoneColor.border}`}>
                    <span className={`w-3 h-3 rounded-full ${zoneColor.dot}`}></span>
                    <span className="text-xs font-bold uppercase">{zone}</span>
                    <span className="text-xs">({zoneAbsences.length} absence{zoneAbsences.length > 1 ? 's' : ''})</span>
                  </div>
                  
                  {/* Lignes */}
                  <div className="border border-t-0 border-slate-200 rounded-b-lg overflow-hidden">
                    {zoneAbsences.map((absence, idx) => {
                      const user = absence.user;
                      const startDate = new Date(absence.startDate);
                      const endDate = new Date(absence.endDate);
                      
                      // Calculer position de la barre
                      const cells = weekDays.map(day => {
                        const dayStart = new Date(day);
                        dayStart.setHours(0, 0, 0, 0);
                        const dayEnd = new Date(day);
                        dayEnd.setHours(23, 59, 59, 999);
                        
                        const isInRange = startDate <= dayEnd && endDate >= dayStart;
                        return isInRange;
                      });
                      
                      const canSeeReason = isManager || absence.userId === currentUser.id;
                      
                      return (
                        <div 
                          key={absence.id}
                          className={`grid grid-cols-[200px_repeat(7,1fr)] gap-1 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-slate-100 transition-colors`}
                        >
                          {/* Nom */}
                          <div 
                            onClick={() => openDetailModal(absence)}
                            className="p-2 flex items-center gap-2 cursor-pointer hover:text-brand-600"
                          >
                            <span className={`w-2 h-2 rounded-full ${zoneColor.dot}`}></span>
                            <span className="text-sm font-medium truncate">
                              {user?.firstName} {user?.lastName}
                            </span>
                          </div>
                          
                          {/* Jours */}
                          {cells.map((isActive, dayIdx) => (
                            <div key={dayIdx} className="p-1 relative">
                              {isActive && (
                                <div 
                                  onClick={() => openDetailModal(absence)}
                                  className={`h-8 rounded cursor-pointer flex items-center justify-center text-xs font-bold ${getAbsenceTypeColor(absence.type)} hover:opacity-80 transition-opacity`}
                                  title={`${absence.type}${canSeeReason && absence.reason ? ` - ${absence.reason}` : ''}`}
                                >
                                  {dayIdx === cells.findIndex(c => c) && (
                                    <span className="truncate px-1">{absence.type}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Message si vide */}
            {periodAbsences.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <Calendar size={48} className="mx-auto mb-3 opacity-50" />
                <p>Aucune absence cette semaine</p>
              </div>
            )}

            {/* Légende types */}
            <div className="mt-6 pt-4 border-t border-slate-200 flex flex-wrap gap-3 justify-center">
              <span className="text-xs font-bold text-slate-500 uppercase mr-2">Types :</span>
              {[AbsenceType.CP, AbsenceType.RTT, AbsenceType.MALADIE, AbsenceType.AT, AbsenceType.FORMATION].map(type => (
                <div key={type} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded ${getAbsenceTypeColor(type)}`}></div>
                  <span className="text-xs text-slate-600">{type}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ================ VIEW: STATS ================ */}
      {viewMode === 'stats' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Statistiques du mois</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatsCard
              title="Congés Payés"
              value={`${stats.cpDays} j`}
              icon={<CalendarDays size={24} />}
              color="bg-blue-50 text-blue-700 border-blue-200"
            />
            <StatsCard
              title="Maladie"
              value={`${stats.maladieDays} j`}
              icon={<Heart size={24} />}
              color="bg-red-50 text-red-700 border-red-200"
            />
            <StatsCard
              title="Formation"
              value={`${stats.formationDays} j`}
              icon={<GraduationCap size={24} />}
              color="bg-purple-50 text-purple-700 border-purple-200"
            />
            <StatsCard
              title="Total"
              value={`${stats.totalDays} j`}
              icon={<CalendarRange size={24} />}
              color="bg-slate-100 text-slate-700 border-slate-200"
            />
          </div>
        </div>
      )}

      {/* ================ MODALS ================ */}

      {/* Form Modal */}
      <Modal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingAbsence ? 'Modifier l\'absence' : 'Nouvelle absence'}
        size="2xl"
        headerIcon={<CalendarDays size={20} />}
      >
        <div className="space-y-4">
          {formErrors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              {formErrors.map((err, i) => (
                <p key={i} className="text-sm text-red-700">{err}</p>
              ))}
            </div>
          )}

          {/* Employee selection (manager only) */}
          {isManager && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Employé</label>
              <select
                value={formData.userId || ''}
                onChange={e => setFormData({ ...formData, userId: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              >
                <option value="">Sélectionner un employé</option>
                {drivers.map(u => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
            </div>
          )}

          {/* Type selection */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Type d'absence</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.values(AbsenceType)
                .filter(type => {
                  // Maladie / AT : direction uniquement
                  if (ABSENCE_DIRECTION_ONLY.includes(type)) return isDirection;
                  // Autres types manager : tout manager (dont secrétariat)
                  if (isManager) return true;
                  // Salarié : uniquement les types auto-demandables
                  return ABSENCE_EMPLOYEE_CAN_REQUEST.includes(type);
                })
                .map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFormData({ ...formData, type })}
                    className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-bold transition-all ${
                      formData.type === type
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {getAbsenceTypeIcon(type)}
                    <span className="truncate">{type}</span>
                  </button>
                ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date début</label>
              <input
                type="date"
                value={formData.startDate || ''}
                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date fin</label>
              <input
                type="date"
                value={formData.endDate || ''}
                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          {/* Working days preview */}
          {formData.startDate && formData.endDate && (
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-sm text-slate-600">
                <span className="font-bold">{calculateWorkingDays(formData.startDate, formData.endDate).days}</span> jour(s) ouvré(s)
              </p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Motif (optionnel)</label>
            <textarea
              value={formData.reason || ''}
              onChange={e => setFormData({ ...formData, reason: e.target.value })}
              rows={2}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none"
              placeholder="Précisez le motif de l'absence..."
            />
          </div>

          {/* AT specific fields */}
          {formData.type === AbsenceType.AT && (
            <div className="p-4 bg-orange-50 rounded-xl border border-orange-200 space-y-3">
              <h4 className="font-bold text-orange-800 flex items-center gap-2">
                <AlertOctagon size={16} /> Informations Accident de Travail
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-orange-700 uppercase mb-1">Date de l'accident *</label>
                  <input
                    type="date"
                    value={formData.accidentDate || ''}
                    onChange={e => setFormData({ ...formData, accidentDate: e.target.value })}
                    className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-orange-700 uppercase mb-1">Lieu</label>
                  <input
                    type="text"
                    value={formData.accidentLocation || ''}
                    onChange={e => setFormData({ ...formData, accidentLocation: e.target.value })}
                    className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
                    placeholder="Adresse / Lieu"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-orange-700 uppercase mb-1">Description</label>
                <textarea
                  value={formData.accidentDescription || ''}
                  onChange={e => setFormData({ ...formData, accidentDescription: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                  placeholder="Décrivez les circonstances..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-orange-700 uppercase mb-1">Témoins</label>
                <input
                  type="text"
                  value={formData.accidentWitnesses || ''}
                  onChange={e => setFormData({ ...formData, accidentWitnesses: e.target.value })}
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="Noms des témoins éventuels"
                />
              </div>
            </div>
          )}

          {/* Document upload for types requiring it */}
          {editingAbsence && ABSENCE_REQUIRES_DOCUMENT.includes(formData.type!) && isManager && (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-3">
                <FileText size={16} /> Justificatif
              </h4>
              
              {formData.documents && formData.documents.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {formData.documents.map(doc => (
                    <a
                      key={doc.id}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 hover:bg-slate-50"
                    >
                      <FileCheck size={16} className="text-green-600" />
                      <span className="text-sm text-slate-700">{doc.name}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 mb-3">Aucun justificatif uploadé</p>
              )}

              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
              >
                <Upload size={16} />
                {uploadingFile ? 'Upload...' : 'Ajouter un document'}
              </button>

              <div className="mt-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  id="docReceived"
                  checked={formData.documentReceived || false}
                  onChange={e => setFormData({ 
                    ...formData, 
                    documentReceived: e.target.checked,
                    documentReceivedDate: e.target.checked ? new Date().toISOString() : undefined,
                    documentReceivedBy: e.target.checked ? currentUser.id : undefined
                  })}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <label htmlFor="docReceived" className="text-sm text-slate-700">
                  Justificatif reçu (original papier)
                </label>
              </div>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Enregistrement...
              </>
            ) : (
              <>
                <Save size={18} />
                {editingAbsence ? 'Enregistrer les modifications' : 'Créer l\'absence'}
              </>
            )}
          </button>
        </div>
      </Modal>

      {/* Detail Modal */}
      {selectedAbsence && (
        <Modal
          isOpen={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          title="Détails de l'absence"
          size="xl"
          headerIcon={getAbsenceTypeIcon(selectedAbsence.type)}
        >
          {(() => {
            const user = users.find(u => u.id === selectedAbsence.userId);
            const validator = users.find(u => u.id === selectedAbsence.validatedBy);
            
            return (
              <div className="space-y-4">
                {/* User & Status */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-slate-200 rounded-full">
                      <UserIcon size={24} className="text-slate-600" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">
                        {user ? `${user.firstName} ${user.lastName}` : 'Inconnu'}
                      </p>
                      <p className="text-sm text-slate-500">{selectedAbsence.type}</p>
                    </div>
                  </div>
                  {getStatusBadge(selectedAbsence.status)}
                </div>

                {/* Dates */}
                <div className="grid grid-cols-3 gap-4 p-4 bg-blue-50 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase">Du</p>
                    <p className="font-bold text-blue-800">{formatDate(selectedAbsence.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase">Au</p>
                    <p className="font-bold text-blue-800">{formatDate(selectedAbsence.endDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase">Durée</p>
                    <p className="font-bold text-blue-800">{selectedAbsence.workingDays} jour(s)</p>
                  </div>
                </div>

                {/* Reason - Visible uniquement pour le propriétaire ou les managers */}
                {selectedAbsence.reason && (isManager || selectedAbsence.userId === currentUser.id) && (
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">Motif</p>
                    <p className="text-slate-700">{selectedAbsence.reason}</p>
                  </div>
                )}
                
                {/* Message confidentialité si motif masqué */}
                {selectedAbsence.reason && !isManager && selectedAbsence.userId !== currentUser.id && (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm text-slate-500 italic">
                    Le motif n'est pas visible pour des raisons de confidentialité
                  </div>
                )}

                {/* AT Info - Visible uniquement pour le propriétaire ou les managers */}
                {selectedAbsence.type === AbsenceType.AT && (isManager || selectedAbsence.userId === currentUser.id) && (
                  <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
                    <h4 className="font-bold text-orange-800 mb-2">Accident de Travail</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-orange-600 font-medium">Date</p>
                        <p className="text-orange-800">{selectedAbsence.accidentDate ? formatDate(selectedAbsence.accidentDate) : 'Non renseignée'}</p>
                      </div>
                      <div>
                        <p className="text-orange-600 font-medium">Lieu</p>
                        <p className="text-orange-800">{selectedAbsence.accidentLocation || 'Non renseigné'}</p>
                      </div>
                      {selectedAbsence.accidentDescription && (
                        <div className="col-span-2">
                          <p className="text-orange-600 font-medium">Description</p>
                          <p className="text-orange-800">{selectedAbsence.accidentDescription}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Documents */}
                {ABSENCE_REQUIRES_DOCUMENT.includes(selectedAbsence.type) && (
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-2">
                      <FileText size={16} /> Justificatif
                    </h4>
                    {selectedAbsence.documentReceived ? (
                      <div className="flex items-center gap-2 text-green-600">
                        <FileCheck size={18} />
                        <span className="text-sm">Reçu le {selectedAbsence.documentReceivedDate ? formatDate(selectedAbsence.documentReceivedDate) : ''}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-orange-600">
                        <AlertTriangle size={18} />
                        <span className="text-sm">En attente de réception</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Validation info */}
                {selectedAbsence.validatedBy && selectedAbsence.status !== AbsenceStatus.MODIFICATION_PROPOSED && (
                  <div className="text-sm text-slate-500">
                    Validé par {validator ? `${validator.firstName} ${validator.lastName}` : 'Inconnu'} 
                    {selectedAbsence.validatedAt && ` le ${formatDate(selectedAbsence.validatedAt)}`}
                  </div>
                )}

                {/* === PROPOSITION DE MODIFICATION === */}
                {selectedAbsence.status === AbsenceStatus.MODIFICATION_PROPOSED && selectedAbsence.modificationProposal && (
                  <div className="p-4 bg-amber-50 rounded-xl border-2 border-amber-300">
                    <h4 className="font-bold text-amber-800 flex items-center gap-2 mb-3">
                      <AlertTriangle size={18} />
                      Modification proposée par la direction
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-amber-600 text-xs font-medium">Dates actuelles</p>
                          <p className="text-slate-600 line-through">
                            {formatDate(selectedAbsence.startDate)} → {formatDate(selectedAbsence.endDate)}
                          </p>
                        </div>
                        <div>
                          <p className="text-amber-600 text-xs font-medium">Nouvelles dates proposées</p>
                          <p className="font-bold text-amber-800">
                            {formatDate(selectedAbsence.modificationProposal.proposedStartDate)} → {formatDate(selectedAbsence.modificationProposal.proposedEndDate)}
                          </p>
                        </div>
                      </div>
                      
                      {selectedAbsence.modificationProposal.reason && (
                        <div className="mt-3 p-3 bg-white rounded-lg border border-amber-200">
                          <p className="text-xs text-amber-600 font-medium mb-1">Commentaire de la direction :</p>
                          <p className="text-slate-700">{selectedAbsence.modificationProposal.reason}</p>
                        </div>
                      )}
                      
                      <p className="text-xs text-amber-600 mt-2">
                        Proposé par {users.find(u => u.id === selectedAbsence.modificationProposal?.proposedBy)?.firstName || 'Direction'} 
                        {selectedAbsence.modificationProposal.proposedAt && ` le ${formatDate(selectedAbsence.modificationProposal.proposedAt)}`}
                      </p>
                    </div>
                    
                    {/* Boutons pour le collaborateur */}
                    {selectedAbsence.userId === currentUser.id && (
                      <div className="flex gap-2 mt-4 pt-3 border-t border-amber-200">
                        <button
                          onClick={() => handleAcceptProposal(selectedAbsence)}
                          className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                        >
                          <CheckCircle size={18} /> Accepter
                        </button>
                        <button
                          onClick={() => handleRejectProposal(selectedAbsence)}
                          className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                        >
                          <XCircle size={18} /> Refuser
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200">
                  {canValidate && selectedAbsence.status === AbsenceStatus.PENDING && (
                    <>
                      <button
                        onClick={() => handleValidate(selectedAbsence, AbsenceStatus.APPROVED)}
                        className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                      >
                        <CheckCircle size={18} /> Valider
                      </button>
                      <button
                        onClick={() => openProposalModal(selectedAbsence)}
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                      >
                        <Edit2 size={18} /> Proposer modification
                      </button>
                      <button
                        onClick={() => { setRejectReason(''); setIsRejectModalOpen(true); }}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
                      >
                        <XCircle size={18} /> Refuser
                      </button>
                    </>
                  )}
                  {(isManager || selectedAbsence.userId === currentUser.id) && selectedAbsence.status === AbsenceStatus.PENDING && (
                    <button
                      onClick={() => { setIsDetailModalOpen(false); openEditModal(selectedAbsence); }}
                      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold flex items-center gap-2"
                    >
                      <Edit2 size={18} /> Modifier
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Report Modal */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="Générer un rapport"
        size="lg"
        headerIcon={<Download size={20} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date début</label>
              <input
                type="date"
                value={reportStartDate}
                onChange={e => setReportStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date fin</label>
              <input
                type="date"
                value={reportEndDate}
                onChange={e => setReportEndDate(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Types d'absence</label>
            <div className="flex flex-wrap gap-2">
              {Object.values(AbsenceType).map(type => (
                <label key={type} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100">
                  <input
                    type="checkbox"
                    checked={reportTypes.includes(type)}
                    onChange={e => {
                      if (e.target.checked) {
                        setReportTypes([...reportTypes, type]);
                      } else {
                        setReportTypes(reportTypes.filter(t => t !== type));
                      }
                    }}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm">{type}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Employé</label>
            <select
              value={reportUserId}
              onChange={e => setReportUserId(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value="all">Tous les employés</option>
              {drivers.map(u => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
          </div>

          <button
            onClick={generateReport}
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
          >
            <Download size={18} /> Télécharger le rapport (CSV)
          </button>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal
        isOpen={isRejectModalOpen && !!selectedAbsence}
        onClose={() => setIsRejectModalOpen(false)}
        title="Refuser la demande"
        size="lg"
        headerIcon={<XCircle size={20} />}
      >
        <div className="space-y-4">
          <div className="p-4 bg-red-50 rounded-xl border border-red-200">
            <p className="text-sm text-red-800">
              Vous êtes sur le point de refuser la demande de{' '}
              <strong>
                {selectedAbsence && (() => {
                  const user = users.find(u => u.id === selectedAbsence.userId);
                  return user ? `${user.firstName} ${user.lastName}` : 'Inconnu';
                })()}
              </strong>
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Motif du refus (optionnel)
            </label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500 outline-none resize-none"
              placeholder="Expliquez la raison du refus (sera envoyée par email à l'employé)..."
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <Mail size={18} className="text-blue-600" />
            <span className="text-sm text-blue-800">
              Un email de notification sera envoyé à l'employé
            </span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsRejectModalOpen(false)}
              className="flex-1 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold"
            >
              Annuler
            </button>
            <button
              onClick={async () => {
                if (selectedAbsence) {
                  await handleValidate(selectedAbsence, AbsenceStatus.REJECTED, rejectReason || undefined);
                  setIsRejectModalOpen(false);
                }
              }}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <XCircle size={18} /> Confirmer le refus
            </button>
          </div>
        </div>
      </Modal>

      {/* Modification Proposal Modal */}
      <Modal
        isOpen={isProposalModalOpen && !!selectedAbsence}
        onClose={() => setIsProposalModalOpen(false)}
        title="Proposer une modification"
        size="lg"
        headerIcon={<Edit2 size={20} />}
      >
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
            <p className="text-sm text-amber-800">
              Vous proposez une modification à{' '}
              <strong>
                {selectedAbsence && (() => {
                  const user = users.find(u => u.id === selectedAbsence.userId);
                  return user ? `${user.firstName} ${user.lastName}` : 'Inconnu';
                })()}
              </strong>
            </p>
            <p className="text-xs text-amber-600 mt-1">
              Le collaborateur devra accepter ou refuser cette proposition avant validation.
            </p>
          </div>

          {/* Dates actuelles */}
          <div className="p-3 bg-slate-50 rounded-xl">
            <p className="text-xs text-slate-500 uppercase font-bold mb-1">Dates demandées actuellement</p>
            <p className="font-medium text-slate-700">
              {selectedAbsence && formatDate(selectedAbsence.startDate)} → {selectedAbsence && formatDate(selectedAbsence.endDate)}
              <span className="text-slate-400 ml-2">({selectedAbsence?.workingDays} jours)</span>
            </p>
          </div>

          {/* Nouvelles dates proposées */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Nouvelle date de début *
              </label>
              <input
                type="date"
                value={proposalData.startDate}
                onChange={e => setProposalData(prev => ({ ...prev, startDate: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Nouvelle date de fin *
              </label>
              <input
                type="date"
                value={proposalData.endDate}
                onChange={e => setProposalData(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>
          </div>

          {/* Calcul des nouveaux jours */}
          {proposalData.startDate && proposalData.endDate && (
            <div className="p-3 bg-green-50 rounded-xl border border-green-200">
              <p className="text-sm text-green-800">
                <strong>Nouvelles dates proposées :</strong>{' '}
                {calculateWorkingDays(proposalData.startDate, proposalData.endDate).days} jours ouvrés
              </p>
            </div>
          )}

          {/* Commentaire obligatoire */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Motif de la modification * <span className="text-red-500">(obligatoire)</span>
            </label>
            <textarea
              value={proposalData.reason}
              onChange={e => setProposalData(prev => ({ ...prev, reason: e.target.value }))}
              rows={3}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none resize-none"
              placeholder="Expliquez pourquoi vous proposez ces nouvelles dates (ex: nécessité de service, chevauchement avec un autre congé, etc.)..."
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <Mail size={18} className="text-blue-600" />
            <span className="text-sm text-blue-800">
              Le collaborateur recevra une notification et devra accepter ou refuser cette proposition.
            </span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setIsProposalModalOpen(false)}
              className="flex-1 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold"
            >
              Annuler
            </button>
            <button
              onClick={handleProposeModification}
              disabled={isProposing || !proposalData.startDate || !proposalData.endDate || !proposalData.reason.trim()}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProposing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Envoi...
                </>
              ) : (
                <>
                  <Edit2 size={18} /> Envoyer la proposition
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Supprimer l'absence ?"
        message="Cette action est irréversible. L'absence sera définitivement supprimée."
        type="danger"
        confirmLabel="Supprimer"
      />
    </div>
  );
};

export default AbsenceManager;
