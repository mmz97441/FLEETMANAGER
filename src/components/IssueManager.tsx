
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Issue, Vehicle, User, IssueStatus, UserRole, MaintenanceLog, InvoiceLine, IssueLog } from '../types';
import { 
  AlertCircle, Plus, AlertTriangle, CheckCircle, Clock, Filter, Calendar, X, Wrench, 
  Save, MessageSquare, ShieldAlert, User as UserIcon, ArrowUpDown, Receipt, Euro, 
  Trash2, FileText, CheckSquare, Search, Activity, ChevronRight, Mail, Send, 
  PlayCircle, StopCircle, Camera, Image as ImageIcon, Loader2, Eye, History,
  ChevronDown, ChevronUp, XCircle, ArrowDown, ArrowUp, SortAsc, SortDesc,
  FileWarning, Folder, FolderOpen, MoreVertical, ExternalLink, Upload, Lock
} from 'lucide-react';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import { updateIssueInFirestore, uploadImageToStorage } from '../services/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  sendIncidentCreatedEmail, 
  sendIncidentResponseEmail, 
  sendIncidentClosedEmail,
  getAdminEmails,
  getMechanicEmails 
} from '../services/emailService';
import { usePermissions, Permission } from '../usePermissions';

// ============================================================================
// TYPES
// ============================================================================

interface IssueManagerProps {
  issues: Issue[];
  vehicles: Vehicle[];
  users: User[];
  currentUser: User;
  maintenanceLogs: MaintenanceLog[];
  onAddIssue: (issue: Issue) => Promise<void>;
  onResolveIssue: (id: string, details?: { status: IssueStatus, response: string, date?: string }) => Promise<void>;
  onAddMaintenance?: (log: MaintenanceLog) => Promise<void>;
  preselectedVehicleId?: string | null; 
}

type SortField = 'date' | 'priority' | 'status' | 'vehicle';
type SortOrder = 'asc' | 'desc';

// ============================================================================
// HELPERS
// ============================================================================

const normalizeRole = (role: string | UserRole): UserRole => {
  const r = String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (r.includes('admin')) return UserRole.ADMIN;
  if (r.includes('presiden')) return UserRole.PRESIDENT;
  if (r.includes('direction') || r.includes('directeur')) return UserRole.DIRECTOR;
  if (r.includes('secret')) return UserRole.SECRETARY;
  if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
  if (r.includes('mecan') || r.includes('mech')) return UserRole.MECHANIC;
  if (r.includes('client')) return UserRole.CLIENT;
  if (r.includes('stag') || r.includes('intern')) return UserRole.INTERN;
  return role as UserRole;
};

const getPriorityOrder = (priority: string): number => {
  switch(priority) {
    case 'High': return 0;
    case 'Medium': return 1;
    default: return 2;
  }
};

const getStatusOrder = (status: IssueStatus): number => {
  switch(status) {
    case IssueStatus.NEW: return 0;
    case IssueStatus.ACKNOWLEDGED: return 1;
    case IssueStatus.IN_PROGRESS: return 2;
    case IssueStatus.RESOLVED: return 3;
    default: return 4;
  }
};

const getPriorityConfig = (priority: string) => {
  switch(priority) {
    case 'High': return { color: 'bg-red-500', bg: 'bg-red-50', text: 'text-red-700', label: 'CRITIQUE', border: 'border-red-200', icon: AlertTriangle };
    case 'Medium': return { color: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', label: 'MOYENNE', border: 'border-amber-200', icon: AlertCircle };
    default: return { color: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', label: 'FAIBLE', border: 'border-blue-200', icon: Activity };
  }
};

const getStatusConfig = (status: IssueStatus) => {
  switch(status) {
    case IssueStatus.NEW: return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', label: 'Nouveau', icon: AlertCircle };
    case IssueStatus.ACKNOWLEDGED: return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', label: 'Pris en charge', icon: CheckSquare };
    case IssueStatus.IN_PROGRESS: return { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', label: 'En réparation', icon: Wrench };
    case IssueStatus.RESOLVED: return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', label: 'Clôturé', icon: CheckCircle };
    default: return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', label: status, icon: Folder };
  }
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatDateTime = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const IssueManager: React.FC<IssueManagerProps> = ({ 
  issues, vehicles, users, currentUser, maintenanceLogs, 
  onAddIssue, onResolveIssue, onAddMaintenance, preselectedVehicleId 
}) => {
  
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  const canViewIssues = hasPermission(Permission.ISSUES_VIEW);
  const canViewAllIssues = hasPermission(Permission.ISSUES_VIEW_ALL);
  const canCreateIssue = hasPermission(Permission.ISSUES_CREATE);
  const canManageIssue = hasPermission(Permission.ISSUES_MANAGE);
  const canResolveIssue = hasPermission(Permission.ISSUES_RESOLVE);
  
  // Backwards compatibility
  const hasFullAccess = canViewAllIssues;
  const canManage = canManageIssue;
  const isDriver = !canViewAllIssues && canViewIssues;
  
  const getDriverId = (v: Vehicle) => v.assignedDriverId || v.driverId || null;
  
  // === TOUS LES HOOKS DOIVENT ÊTRE ICI (avant tout return conditionnel) ===
  const accessibleVehicles = useMemo(() => {
    if (canViewAllIssues) return vehicles;
    if (canViewIssues) return vehicles.filter(v => getDriverId(v) === currentUser.id);
    return [];
  }, [vehicles, currentUser.id, canViewAllIssues, canViewIssues]);

  const accessibleIssues = useMemo(() => {
    if (canViewAllIssues) return issues;
    if (canViewIssues) return issues.filter(i => i.reportedByUserId === currentUser.id || i.reportedBy === currentUser.id);
    return [];
  }, [issues, currentUser.id, canViewAllIssues, canViewIssues]);

  // === STATE ===
  const [activeTab, setActiveTab] = useState<string>('open'); // 'open', 'closed', 'all'
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Modals
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  // Photos
  const [selectedFiles, setSelectedFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Form state
  const [newIssue, setNewIssue] = useState({
    vehicleId: '',
    description: '',
    priority: 'Medium' as 'Low' | 'Medium' | 'High'
  });

  const [replyForm, setReplyForm] = useState({
    message: '',
    type: 'RESPONSE' as 'RESPONSE' | 'APPOINTMENT' | 'NOTE',
    appointmentDate: '',
    sendEmail: true
  });

  const [closeForm, setCloseForm] = useState({
    comment: '',
    createInvoice: false,
    cost: '',
    provider: '',
    invoiceNumber: '',
    invoiceDescription: '',
    sendEmail: true
  });
  const [closeFormError, setCloseFormError] = useState('');

  // Photo facture pour la clôture (OBLIGATOIRE)
  const [invoicePhoto, setInvoicePhoto] = useState<File | null>(null);
  const [invoicePhotoPreview, setInvoicePhotoPreview] = useState<string | null>(null);
  const [isUploadingInvoice, setIsUploadingInvoice] = useState(false);

  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);

  // Confirm
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    type: string;
    title: string;
    message: string;
  }>({ isOpen: false, type: '', title: '', message: '' });

  // Effects
  useEffect(() => {
    if (preselectedVehicleId) setVehicleFilter(preselectedVehicleId);
  }, [preselectedVehicleId]);

  useEffect(() => {
    return () => {
      selectedFiles.forEach(f => URL.revokeObjectURL(f.previewUrl));
    };
  }, [selectedFiles]);

  useEffect(() => {
    if (invoiceLines.length > 0) {
      const total = invoiceLines.reduce((acc, line) => acc + line.total, 0);
      setCloseForm(prev => ({ ...prev, cost: total.toString() }));
    }
  }, [invoiceLines]);

  // === COMPUTED ===
  const getVehiclePlate = (id: string) => vehicles.find(v => v.id === id)?.plate || id;
  const getVehicleModel = (id: string) => vehicles.find(v => v.id === id)?.model || '';
  const getUserName = (id: string) => {
    const u = users.find(user => user.id === id);
    return u ? `${u.firstName} ${u.lastName}` : 'Inconnu';
  };

  const filteredIssues = useMemo(() => {
    return accessibleIssues
      .filter(issue => {
        // Tab filter
        if (activeTab === 'open' && issue.status === IssueStatus.RESOLVED) return false;
        if (activeTab === 'closed' && issue.status !== IssueStatus.RESOLVED) return false;
        
        // Vehicle filter
        if (vehicleFilter !== 'all' && issue.vehicleId !== vehicleFilter) return false;
        
        // Priority filter
        if (priorityFilter !== 'all' && issue.priority !== priorityFilter) return false;
        
        // Search
        if (searchTerm) {
          const v = vehicles.find(veh => veh.id === issue.vehicleId);
          const searchStr = `${v?.plate} ${v?.model} ${issue.description}`.toLowerCase();
          if (!searchStr.includes(searchTerm.toLowerCase())) return false;
        }
        
        return true;
      })
      .sort((a, b) => {
        let comparison = 0;
        
        switch (sortField) {
          case 'date':
            comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
            break;
          case 'priority':
            comparison = getPriorityOrder(a.priority) - getPriorityOrder(b.priority);
            break;
          case 'status':
            comparison = getStatusOrder(a.status) - getStatusOrder(b.status);
            break;
          case 'vehicle':
            comparison = getVehiclePlate(a.vehicleId).localeCompare(getVehiclePlate(b.vehicleId));
            break;
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [accessibleIssues, activeTab, vehicleFilter, priorityFilter, searchTerm, sortField, sortOrder, vehicles]);

  const stats = useMemo(() => ({
    total: accessibleIssues.length,
    open: accessibleIssues.filter(i => i.status !== IssueStatus.RESOLVED).length,
    new: accessibleIssues.filter(i => i.status === IssueStatus.NEW).length,
    inProgress: accessibleIssues.filter(i => i.status === IssueStatus.IN_PROGRESS).length,
    closed: accessibleIssues.filter(i => i.status === IssueStatus.RESOLVED).length,
    high: accessibleIssues.filter(i => i.priority === 'High' && i.status !== IssueStatus.RESOLVED).length
  }), [accessibleIssues]);

  // === HANDLERS ===
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const openDetailModal = (issue: Issue) => {
    setSelectedIssue(issue);
    setIsDetailModalOpen(true);
  };

  const openReplyModal = (issue: Issue) => {
    setSelectedIssue(issue);
    setReplyForm({ message: '', type: 'RESPONSE', appointmentDate: issue.interventionDate || '', sendEmail: true });
    setIsReplyModalOpen(true);
  };

  const openCloseModal = (issue: Issue) => {
    setSelectedIssue(issue);
    setCloseForm({
      comment: '',
      createInvoice: true, // Maintenant obligatoire par défaut
      cost: '',
      provider: '',
      invoiceNumber: '',
      invoiceDescription: `Réparation : ${issue.description.slice(0, 50)}...`,
      sendEmail: true
    });
    setCloseFormError('');
    setInvoiceLines([]);
    // Reset photo facture
    setInvoicePhoto(null);
    setInvoicePhotoPreview(null);
    setIsCloseModalOpen(true);
  };

  // Handler pour la photo facture
  const handleInvoicePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setCloseFormError('Le fichier doit être une image');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setCloseFormError('L\'image ne doit pas dépasser 5 Mo');
        return;
      }
      setInvoicePhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setInvoicePhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setCloseFormError('');
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        alert("L'image est trop volumineuse (Max 5Mo)");
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      setSelectedFiles(prev => [...prev, { file, previewUrl }]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(selectedFiles[index].previewUrl);
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitReport = async () => {
    if (!newIssue.vehicleId || !newIssue.description) return;
    
    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];
      if (selectedFiles.length > 0) {
        const uploadPromises = selectedFiles.map(fileObj => uploadImageToStorage(fileObj.file, 'issues'));
        const results = await Promise.all(uploadPromises);
        uploadedUrls.push(...results);
      }

      const issue: Issue = { 
        id: 'i-' + Date.now(), 
        vehicleId: newIssue.vehicleId, 
        reportedByUserId: currentUser.id, 
        description: newIssue.description, 
        priority: newIssue.priority, 
        date: new Date().toISOString(), 
        status: IssueStatus.NEW,
        logs: [],
        photos: uploadedUrls
      };
      
      await onAddIssue(issue);
      
      // 📧 ENVOI EMAIL AUX ADMINS/MÉCANICIENS
      const vehicle = vehicles.find(v => v.id === newIssue.vehicleId);
      if (vehicle) {
        const adminEmails = getAdminEmails(users);
        const mechanicEmails = getMechanicEmails(users);
        const allRecipients = [...new Set([...adminEmails, ...mechanicEmails])];
        
        if (allRecipients.length > 0) {
          await sendIncidentCreatedEmail(issue, currentUser, vehicle, allRecipients);
        }
      }
      
      setIsReportModalOpen(false);
      setNewIssue({ vehicleId: accessibleVehicles.length === 1 ? accessibleVehicles[0].id : '', description: '', priority: 'Medium' });
      setSelectedFiles([]);
    } catch (error) {
      console.error("Erreur création incident:", error);
      alert("Erreur lors de l'envoi du rapport.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmitReply = async () => {
    if (!selectedIssue || !replyForm.message) return;
    
    const newLog: IssueLog = {
      id: `log-${Date.now()}`,
      date: new Date().toISOString(),
      message: replyForm.message,
      authorName: `${currentUser.firstName} ${currentUser.lastName}`,
      type: replyForm.type
    };

    let updatedIssue: Issue = {
      ...selectedIssue,
      logs: [...(selectedIssue.logs || []), newLog]
    };

    if (replyForm.type === 'APPOINTMENT' && replyForm.appointmentDate) {
      updatedIssue.interventionDate = replyForm.appointmentDate;
      if (updatedIssue.status === IssueStatus.NEW) updatedIssue.status = IssueStatus.ACKNOWLEDGED;
    } else if (updatedIssue.status === IssueStatus.NEW) {
      updatedIssue.status = IssueStatus.ACKNOWLEDGED;
    }

    await updateIssueInFirestore(updatedIssue);

    // 📧 ENVOI EMAIL AU CHAUFFEUR
    if (replyForm.sendEmail) {
      const driver = users.find(u => u.id === selectedIssue.reportedByUserId);
      const vehicle = vehicles.find(v => v.id === selectedIssue.vehicleId);
      
      if (driver?.email && vehicle) {
        await sendIncidentResponseEmail(
          selectedIssue,
          vehicle,
          driver.email,
          `${driver.firstName} ${driver.lastName}`,
          replyForm.message,
          replyForm.type === 'APPOINTMENT' ? replyForm.appointmentDate : undefined
        );
      }
    }

    setIsReplyModalOpen(false);
    setSelectedIssue(null);
  };

  const handleStartWork = async (issue: Issue) => {
    const updatedIssue: Issue = { ...issue, status: IssueStatus.IN_PROGRESS };
    await updateIssueInFirestore(updatedIssue);
  };

  const handleCloseIssue = async () => {
    if (!selectedIssue) return;
    
    // VALIDATION: Commentaire obligatoire
    if (!closeForm.comment.trim()) {
      setCloseFormError('Un commentaire de clôture est obligatoire');
      return;
    }
    
    if (closeForm.comment.trim().length < 10) {
      setCloseFormError('Le commentaire doit faire au moins 10 caractères');
      return;
    }

    // VALIDATION: Photo facture obligatoire
    if (!invoicePhoto) {
      setCloseFormError('La photo de la facture est obligatoire');
      return;
    }

    // VALIDATION: Au moins une ligne de facture
    if (invoiceLines.length === 0) {
      setCloseFormError('Ajoutez au moins une ligne de facture (pièce ou main d\'œuvre)');
      return;
    }

    setIsUploadingInvoice(true);

    try {
      // Upload photo facture vers Firebase Storage
      const storage = getStorage();
      const fileName = `invoices/${selectedIssue.vehicleId}/${Date.now()}_${invoicePhoto.name}`;
      const storageRef = ref(storage, fileName);
      await uploadBytes(storageRef, invoicePhoto);
      const invoiceUrl = await getDownloadURL(storageRef);

      // Calculer le coût total
      const totalCost = invoiceLines.reduce((acc, l) => acc + l.total, 0);

      // Créer le log de clôture
      const closeLog: IssueLog = {
        id: `log-close-${Date.now()}`,
        date: new Date().toISOString(),
        message: `CLÔTURE : ${closeForm.comment}`,
        authorName: `${currentUser.firstName} ${currentUser.lastName}`,
        type: 'NOTE'
      };

      // Créer l'entrée MaintenanceLog (TOUJOURS maintenant)
      let linkedMaintenanceId: string | undefined;
      if (onAddMaintenance) {
        const maintId = 'm-' + Date.now();
        const maintLog: MaintenanceLog = { 
          id: maintId, 
          vehicleId: selectedIssue.vehicleId, 
          date: new Date().toISOString(), 
          type: 'Réparation incident', 
          description: closeForm.invoiceDescription || `Réparation suite à incident`, 
          cost: totalCost, 
          mileageAtService: 0, 
          garageName: closeForm.provider, 
          provider: closeForm.provider, 
          invoiceNumber: closeForm.invoiceNumber, 
          status: 'Completed',
          completedDate: new Date().toISOString(),
          lines: invoiceLines,
          linkedIssueId: selectedIssue.id,
          invoiceUrl: invoiceUrl
        };
        await onAddMaintenance(maintLog);
        linkedMaintenanceId = maintId;
      }

      // Mettre à jour l'issue avec les infos de réparation
      const updatedIssue: Issue = {
        ...selectedIssue,
        status: IssueStatus.RESOLVED,
        garageResponse: closeForm.comment,
        logs: [...(selectedIssue.logs || []), closeLog],
        resolvedDate: new Date().toISOString(),
        resolvedBy: currentUser.id,
        // Nouvelles données de réparation
        repairCost: totalCost,
        repairLines: invoiceLines,
        invoiceUrl: invoiceUrl,
        linkedMaintenanceId: linkedMaintenanceId
      };

      await updateIssueInFirestore(updatedIssue);

      // 📧 ENVOI EMAIL AU CHAUFFEUR
      if (closeForm.sendEmail) {
        const driver = users.find(u => u.id === selectedIssue.reportedByUserId);
        const vehicle = vehicles.find(v => v.id === selectedIssue.vehicleId);
        
        if (driver?.email && vehicle) {
          await sendIncidentClosedEmail(
            selectedIssue,
            vehicle,
            driver.email,
            `${driver.firstName} ${driver.lastName}`,
            closeForm.comment
          );
        }
      }
      
      setIsCloseModalOpen(false);
      setIsDetailModalOpen(false);
      setSelectedIssue(null);
      
    } catch (error) {
      console.error('Erreur lors de la clôture:', error);
      setCloseFormError('Erreur lors de l\'envoi. Veuillez réessayer.');
    } finally {
      setIsUploadingInvoice(false);
    }
  };

  const addInvoiceLine = () => {
    setInvoiceLines([...invoiceLines, { description: '', quantity: 1, unitPrice: 0, total: 0 }]);
  };

  const updateInvoiceLine = (index: number, field: keyof InvoiceLine, value: any) => {
    const updated = [...invoiceLines];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      updated[index].total = updated[index].quantity * updated[index].unitPrice;
    }
    setInvoiceLines(updated);
  };

  const removeInvoiceLine = (index: number) => {
    setInvoiceLines(invoiceLines.filter((_, i) => i !== index));
  };

  // === TABS ===
  const tabs = [
    { id: 'open', label: 'En cours', count: stats.open, icon: FolderOpen, color: 'text-orange-600' },
    { id: 'closed', label: 'Clôturés', count: stats.closed, icon: Folder, color: 'text-green-600' },
    { id: 'all', label: 'Tous', count: stats.total, icon: Filter, color: 'text-slate-600' }
  ];

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewIssues) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès à la gestion des incidents.
        </p>
      </div>
    );
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      
      {/* === KPI HEADER === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-xs font-bold uppercase">En cours</p>
            <h3 className="text-2xl font-extrabold text-slate-800">{stats.open}</h3>
          </div>
          <div className="bg-orange-50 p-3 rounded-xl text-orange-600"><FolderOpen size={24}/></div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-xs font-bold uppercase">Nouveaux</p>
            <h3 className="text-2xl font-extrabold text-red-600">{stats.new}</h3>
          </div>
          <div className="bg-red-50 p-3 rounded-xl text-red-600"><AlertCircle size={24}/></div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-xs font-bold uppercase">Critiques</p>
            <h3 className="text-2xl font-extrabold text-red-600">{stats.high}</h3>
          </div>
          <div className="bg-red-50 p-3 rounded-xl text-red-600"><AlertTriangle size={24}/></div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-slate-500 text-xs font-bold uppercase">Clôturés</p>
            <h3 className="text-2xl font-extrabold text-green-600">{stats.closed}</h3>
          </div>
          <div className="bg-green-50 p-3 rounded-xl text-green-600"><CheckCircle size={24}/></div>
        </div>
      </div>

      {/* === TOOLBAR === */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 space-y-4">
        {/* Tabs */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                  activeTab === tab.id 
                    ? 'bg-white text-slate-800 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon size={16} className={activeTab === tab.id ? tab.color : ''} />
                {tab.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-slate-200' : 'bg-slate-200/50'
                }`}>{tab.count}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => { setNewIssue({ vehicleId: accessibleVehicles.length === 1 ? accessibleVehicles[0].id : '', description: '', priority: 'Medium' }); setSelectedFiles([]); setIsReportModalOpen(true); }}
            className="bg-slate-900 hover:bg-black text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg"
          >
            <Plus size={18} /> Signaler un incident
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>

          <select
            value={vehicleFilter}
            onChange={e => setVehicleFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          >
            <option value="all">Tous les véhicules</option>
            {accessibleVehicles.map(v => (
              <option key={v.id} value={v.id}>{v.plate} - {v.model}</option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          >
            <option value="all">Toutes priorités</option>
            <option value="High">🔴 Critique</option>
            <option value="Medium">🟠 Moyenne</option>
            <option value="Low">🔵 Faible</option>
          </select>

          {/* Sort */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            <span className="text-xs text-slate-500 px-2">Tri:</span>
            {[
              { field: 'date' as SortField, label: 'Date' },
              { field: 'priority' as SortField, label: 'Priorité' },
              { field: 'status' as SortField, label: 'Statut' }
            ].map(s => (
              <button
                key={s.field}
                onClick={() => handleSort(s.field)}
                className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${
                  sortField === s.field ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {s.label}
                {sortField === s.field && (sortOrder === 'desc' ? <ChevronDown size={12}/> : <ChevronUp size={12}/>)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* === LIST === */}
      <div className="space-y-3">
        {filteredIssues.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <Folder size={48} className="mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">Aucun incident trouvé</p>
          </div>
        ) : (
          filteredIssues.map(issue => {
            const priority = getPriorityConfig(issue.priority);
            const status = getStatusConfig(issue.status);
            const plate = getVehiclePlate(issue.vehicleId);
            const model = getVehicleModel(issue.vehicleId);
            const reporter = getUserName(issue.reportedByUserId);
            const isResolved = issue.status === IssueStatus.RESOLVED;

            return (
              <div 
                key={issue.id} 
                onClick={() => openDetailModal(issue)}
                className={`bg-white rounded-2xl shadow-sm border overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                  isResolved ? 'border-slate-200 opacity-80' : 'border-slate-200 hover:border-brand-300'
                }`}
              >
                <div className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  {/* Priority indicator */}
                  <div className={`w-1 md:w-2 md:h-16 rounded-full self-stretch ${priority.color}`}></div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border ${priority.bg} ${priority.text} ${priority.border}`}>
                        {priority.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border flex items-center gap-1 ${status.bg} ${status.text} ${status.border}`}>
                        <status.icon size={12} />
                        {status.label}
                      </span>
                      {issue.interventionDate && !isResolved && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-100 text-yellow-700 border border-yellow-200 flex items-center gap-1">
                          <Calendar size={12} />
                          RDV: {formatDate(issue.interventionDate)}
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-slate-800 text-sm md:text-base">
                      {plate} <span className="text-slate-400 font-normal">- {model}</span>
                    </h3>
                    <p className="text-sm text-slate-600 line-clamp-1 mt-1">{issue.description}</p>
                  </div>

                  {/* Meta & Actions */}
                  <div className="flex flex-col items-end gap-2 text-right">
                    <p className="text-xs text-slate-400">{formatDate(issue.date)}</p>
                    <p className="text-xs text-slate-500">Par: {reporter}</p>
                    
                    {issue.logs && issue.logs.length > 0 && (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <MessageSquare size={12} /> {issue.logs.length} message(s)
                      </span>
                    )}

                    {issue.photos && issue.photos.length > 0 && (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <ImageIcon size={12} /> {issue.photos.length} photo(s)
                      </span>
                    )}
                  </div>

                  <ChevronRight size={20} className="text-slate-300" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ============== MODALS ============== */}

      {/* === DETAIL MODAL === */}
      <Modal
        isOpen={isDetailModalOpen && !!selectedIssue}
        onClose={() => { setIsDetailModalOpen(false); setSelectedIssue(null); }}
        title="Détail du dossier"
        size="2xl"
        headerIcon={<Folder size={20} />}
      >
        {selectedIssue && (() => {
          const priority = getPriorityConfig(selectedIssue.priority);
          const status = getStatusConfig(selectedIssue.status);
          const plate = getVehiclePlate(selectedIssue.vehicleId);
          const model = getVehicleModel(selectedIssue.vehicleId);
          const reporter = getUserName(selectedIssue.reportedByUserId);
          const isResolved = selectedIssue.status === IssueStatus.RESOLVED;

          return (
            <div className="space-y-6">
              {/* Header */}
              <div className={`p-4 rounded-xl border ${priority.bg} ${priority.border}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-bold border ${priority.bg} ${priority.text} ${priority.border}`}>
                      {priority.label}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-bold border flex items-center gap-1 ${status.bg} ${status.text} ${status.border}`}>
                      <status.icon size={14} />
                      {status.label}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">Réf: {selectedIssue.id}</span>
                </div>
                <h3 className="text-xl font-bold text-slate-800">{plate} - {model}</h3>
                <p className="text-sm text-slate-600 mt-1">Signalé le {formatDateTime(selectedIssue.date)} par {reporter}</p>
              </div>

              {/* Description */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Description du problème</h4>
                <p className="text-slate-800 bg-slate-50 p-4 rounded-xl border border-slate-200">{selectedIssue.description}</p>
              </div>

              {/* Photos */}
              {selectedIssue.photos && selectedIssue.photos.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Photos ({selectedIssue.photos.length})</h4>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {selectedIssue.photos.map((photo, index) => (
                      <div 
                        key={index} 
                        onClick={() => window.open(photo, '_blank')}
                        className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200 flex-shrink-0 cursor-pointer hover:border-brand-500 transition-colors"
                      >
                        <img src={photo} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
                          <ExternalLink className="text-white opacity-0 hover:opacity-100" size={20} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline / Historique */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                  <History size={14} /> Historique des actions
                </h4>
                <div className="relative pl-6 border-l-2 border-slate-200 space-y-4">
                  {/* Création */}
                  <div className="relative">
                    <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-blue-500 border-4 border-white"></div>
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                      <p className="text-xs font-bold text-blue-700 uppercase">Signalement créé</p>
                      <p className="text-xs text-blue-600">{formatDateTime(selectedIssue.date)} - {reporter}</p>
                    </div>
                  </div>

                  {/* Logs */}
                  {selectedIssue.logs?.map(log => (
                    <div key={log.id} className="relative">
                      <div className={`absolute -left-[25px] w-4 h-4 rounded-full border-4 border-white ${
                        log.type === 'APPOINTMENT' ? 'bg-yellow-500' : 'bg-slate-400'
                      }`}></div>
                      <div className={`p-3 rounded-lg border ${
                        log.type === 'APPOINTMENT' ? 'bg-yellow-50 border-yellow-100' : 'bg-slate-50 border-slate-100'
                      }`}>
                        <p className={`text-xs font-bold uppercase ${
                          log.type === 'APPOINTMENT' ? 'text-yellow-700' : 'text-slate-700'
                        }`}>
                          {log.type === 'APPOINTMENT' ? 'RDV fixé' : log.type === 'NOTE' ? 'Note interne' : 'Réponse'}
                        </p>
                        <p className="text-xs text-slate-500">{formatDateTime(log.date)} - {log.authorName}</p>
                        <p className="text-sm text-slate-800 mt-1 italic">"{log.message}"</p>
                      </div>
                    </div>
                  ))}

                  {/* Clôture */}
                  {isResolved && (
                    <div className="relative">
                      <div className="absolute -left-[25px] w-4 h-4 rounded-full bg-green-500 border-4 border-white"></div>
                      <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                        <p className="text-xs font-bold text-green-700 uppercase">Dossier clôturé</p>
                        <p className="text-xs text-green-600">
                          {selectedIssue.resolvedDate ? formatDateTime(selectedIssue.resolvedDate) : ''} 
                          {selectedIssue.resolvedBy ? ` - ${getUserName(selectedIssue.resolvedBy)}` : ''}
                        </p>
                        {selectedIssue.garageResponse && (
                          <p className="text-sm text-green-800 mt-1 italic">"{selectedIssue.garageResponse}"</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              {!isResolved && canManage && (
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200">
                  <button
                    onClick={() => { setIsDetailModalOpen(false); openReplyModal(selectedIssue); }}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-sm font-bold flex items-center gap-2"
                  >
                    <MessageSquare size={16} /> Ajouter une réponse
                  </button>

                  {selectedIssue.status !== IssueStatus.IN_PROGRESS && (
                    <button
                      onClick={async () => { await handleStartWork(selectedIssue); setSelectedIssue({...selectedIssue, status: IssueStatus.IN_PROGRESS}); }}
                      className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-200 rounded-lg text-sm font-bold flex items-center gap-2"
                    >
                      <PlayCircle size={16} /> Réceptionner en atelier
                    </button>
                  )}

                  <button
                    onClick={() => { setIsDetailModalOpen(false); openCloseModal(selectedIssue); }}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold flex items-center gap-2"
                  >
                    <CheckCircle size={16} /> Clôturer le dossier
                  </button>
                </div>
              )}

              {isResolved && (
                <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-center">
                  <CheckCircle size={24} className="mx-auto mb-2 text-green-600" />
                  <p className="font-bold text-green-700">Dossier clôturé</p>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* === REPORT MODAL === */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="Signaler un incident"
        size="lg"
        headerIcon={<AlertTriangle size={20} />}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Véhicule *</label>
            <select
              value={newIssue.vehicleId}
              onChange={e => setNewIssue({ ...newIssue, vehicleId: e.target.value })}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
              required
            >
              <option value="">Sélectionner un véhicule</option>
              {accessibleVehicles.map(v => (
                <option key={v.id} value={v.id}>{v.plate} - {v.model}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Priorité</label>
            <div className="flex gap-2">
              {[
                { value: 'Low', label: 'Faible', color: 'bg-blue-100 text-blue-700 border-blue-200' },
                { value: 'Medium', label: 'Moyenne', color: 'bg-amber-100 text-amber-700 border-amber-200' },
                { value: 'High', label: 'Critique', color: 'bg-red-100 text-red-700 border-red-200' }
              ].map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setNewIssue({ ...newIssue, priority: p.value as any })}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${
                    newIssue.priority === p.value
                      ? `${p.color} ring-2 ring-offset-2 ring-slate-400`
                      : 'bg-white border-slate-200 text-slate-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description *</label>
            <textarea
              value={newIssue.description}
              onChange={e => setNewIssue({ ...newIssue, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none"
              placeholder="Décrivez le problème rencontré..."
              required
            />
          </div>

          {/* Photos - RECOMMANDÉ */}
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
            <label className="block text-xs font-bold text-amber-700 uppercase mb-2 flex items-center gap-2">
              <Camera size={14} />
              Photos du problème
              <span className="text-[10px] font-normal bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">Recommandé</span>
            </label>
            <p className="text-xs text-amber-600 mb-3">
              Une photo aide à mieux comprendre le problème et accélère la prise en charge.
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedFiles.map((file, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                  <img src={file.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg text-sm font-bold flex items-center gap-2 border border-amber-300"
            >
              <Camera size={16} /> Ajouter une photo
            </button>
          </div>

          <button
            onClick={handleSubmitReport}
            disabled={isUploading || !newIssue.vehicleId || !newIssue.description}
            className="w-full py-3 bg-slate-900 hover:bg-black disabled:bg-slate-400 text-white rounded-xl font-bold flex items-center justify-center gap-2"
          >
            {isUploading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            {isUploading ? 'Envoi...' : 'Signaler l\'incident'}
          </button>
        </div>
      </Modal>

      {/* === REPLY MODAL === */}
      <Modal
        isOpen={isReplyModalOpen && !!selectedIssue}
        onClose={() => setIsReplyModalOpen(false)}
        title="Ajouter une réponse"
        size="lg"
        headerIcon={<MessageSquare size={20} />}
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setReplyForm({ ...replyForm, type: 'RESPONSE' })}
              className={`flex-1 py-3 rounded-xl text-sm font-bold border flex items-center justify-center gap-2 ${
                replyForm.type === 'RESPONSE' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              <MessageSquare size={16} /> Réponse
            </button>
            <button
              type="button"
              onClick={() => setReplyForm({ ...replyForm, type: 'APPOINTMENT' })}
              className={`flex-1 py-3 rounded-xl text-sm font-bold border flex items-center justify-center gap-2 ${
                replyForm.type === 'APPOINTMENT' ? 'bg-yellow-500 text-white' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              <Calendar size={16} /> Fixer RDV
            </button>
          </div>

          {replyForm.type === 'APPOINTMENT' && (
            <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100">
              <label className="block text-xs font-bold text-yellow-800 uppercase mb-1">Date du RDV *</label>
              <input
                type="date"
                value={replyForm.appointmentDate}
                onChange={e => setReplyForm({ ...replyForm, appointmentDate: e.target.value })}
                className="w-full px-4 py-2 border border-yellow-200 rounded-lg focus:ring-2 focus:ring-yellow-500 outline-none"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message *</label>
            <textarea
              value={replyForm.message}
              onChange={e => setReplyForm({ ...replyForm, message: e.target.value })}
              rows={4}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none"
              placeholder="Votre message..."
              required
            />
          </div>

          {/* Option envoi email */}
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100">
            <input
              type="checkbox"
              id="sendEmailReply"
              checked={replyForm.sendEmail}
              onChange={e => setReplyForm({ ...replyForm, sendEmail: e.target.checked })}
              className="w-4 h-4 rounded border-blue-300 text-blue-600"
            />
            <label htmlFor="sendEmailReply" className="flex items-center gap-2 text-sm font-bold text-blue-800 cursor-pointer">
              <Mail size={16} /> Notifier le chauffeur par email
            </label>
          </div>

          <button
            onClick={handleSubmitReply}
            disabled={!replyForm.message}
            className="w-full py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-400 text-white rounded-xl font-bold flex items-center justify-center gap-2"
          >
            <Send size={18} /> Envoyer
          </button>
        </div>
      </Modal>

      {/* === CLOSE MODAL === */}
      <Modal
        isOpen={isCloseModalOpen && !!selectedIssue}
        onClose={() => setIsCloseModalOpen(false)}
        title="Clôturer le dossier"
        size="xl"
        headerIcon={<CheckCircle size={20} />}
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {closeFormError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-700">
              <AlertTriangle size={18} />
              <span className="text-sm font-medium">{closeFormError}</span>
            </div>
          )}

          {/* Commentaire de clôture */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Commentaire de clôture <span className="text-red-500">*</span>
            </label>
            <textarea
              value={closeForm.comment}
              onChange={e => { setCloseForm({ ...closeForm, comment: e.target.value }); setCloseFormError(''); }}
              rows={3}
              className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-brand-500 outline-none resize-none ${
                closeFormError && !closeForm.comment ? 'border-red-300 bg-red-50' : 'border-slate-300'
              }`}
              placeholder="Décrivez la résolution du problème, les travaux effectués, etc."
              required
            />
            <p className="text-xs text-slate-400 mt-1">{closeForm.comment.length}/10 caractères minimum</p>
          </div>

          {/* SECTION FACTURATION - OBLIGATOIRE */}
          <div className="p-4 bg-orange-50 rounded-xl border border-orange-200">
            <div className="flex items-center gap-2 mb-4">
              <Receipt size={18} className="text-orange-600" />
              <h4 className="font-bold text-orange-800">Détails de la facture fournisseur</h4>
              <span className="text-xs text-red-500 font-bold">(obligatoire)</span>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Prestataire / Garage</label>
                  <input
                    type="text"
                    value={closeForm.provider}
                    onChange={e => setCloseForm({ ...closeForm, provider: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                    placeholder="Nom du garage"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">N° Facture</label>
                  <input
                    type="text"
                    value={closeForm.invoiceNumber}
                    onChange={e => setCloseForm({ ...closeForm, invoiceNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                    placeholder="FAC-2024-001"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description des travaux</label>
                <input
                  type="text"
                  value={closeForm.invoiceDescription}
                  onChange={e => setCloseForm({ ...closeForm, invoiceDescription: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Réparation frein, remplacement pièces..."
                />
              </div>

              {/* Lignes de facture - OBLIGATOIRE */}
              <div className="bg-white p-3 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-bold text-slate-600 uppercase flex items-center gap-2">
                    <FileText size={14} /> Lignes de facture <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={addInvoiceLine}
                    className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1"
                  >
                    <Plus size={14} /> Ajouter une ligne
                  </button>
                </div>
                
                {invoiceLines.length === 0 ? (
                  <div className="text-center py-4 text-slate-400 text-sm">
                    <FileText size={24} className="mx-auto mb-2 opacity-50" />
                    Ajoutez au moins une ligne (pièce ou main d'œuvre)
                  </div>
                ) : (
                  <div className="space-y-2">
                    {invoiceLines.map((line, idx) => (
                      <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2 rounded-lg">
                        <input
                          type="text"
                          placeholder="Description (ex: Plaquettes frein)"
                          value={line.description}
                          onChange={e => updateInvoiceLine(idx, 'description', e.target.value)}
                          className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                        />
                        <input
                          type="number"
                          placeholder="Qté"
                          min="1"
                          value={line.quantity || ''}
                          onChange={e => updateInvoiceLine(idx, 'quantity', Number(e.target.value))}
                          className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center"
                        />
                        <input
                          type="number"
                          placeholder="Prix €"
                          min="0"
                          step="0.01"
                          value={line.unitPrice || ''}
                          onChange={e => updateInvoiceLine(idx, 'unitPrice', Number(e.target.value))}
                          className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right"
                        />
                        <span className="w-24 text-right font-bold text-sm text-slate-700">{line.total.toFixed(2)} €</span>
                        <button 
                          onClick={() => removeInvoiceLine(idx)} 
                          className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Total */}
                <div className="flex items-center justify-between p-3 mt-3 bg-green-50 rounded-lg border border-green-200">
                  <span className="font-bold text-green-800 flex items-center gap-2">
                    <Euro size={18} /> TOTAL
                  </span>
                  <span className="text-2xl font-extrabold text-green-700">
                    {invoiceLines.reduce((acc, l) => acc + l.total, 0).toFixed(2)} €
                  </span>
                </div>
              </div>

              {/* PHOTO FACTURE - OBLIGATOIRE */}
              <div className={`rounded-xl border-2 border-dashed p-4 transition-all ${
                invoicePhoto 
                  ? 'border-green-300 bg-green-50' 
                  : closeFormError && closeFormError.includes('photo')
                    ? 'border-red-300 bg-red-50' 
                    : 'border-orange-300 bg-white hover:border-orange-400'
              }`}>
                <label className="block text-xs font-bold text-slate-600 uppercase mb-3 flex items-center gap-2">
                  <Camera size={16} className="text-orange-500" />
                  Photo de la facture
                  <span className="text-red-500">*</span>
                  <span className="text-[10px] font-normal text-slate-400 normal-case">(obligatoire)</span>
                </label>
                
                {invoicePhotoPreview ? (
                  <div className="relative">
                    <img 
                      src={invoicePhotoPreview} 
                      alt="Aperçu facture" 
                      className="w-full h-40 object-cover rounded-lg border border-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setInvoicePhoto(null);
                        setInvoicePhotoPreview(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                    >
                      <X size={14} />
                    </button>
                    <div className="absolute bottom-2 left-2 px-2 py-1 bg-green-500 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                      <CheckCircle size={12} /> Photo ajoutée
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center cursor-pointer py-4">
                    <div className="p-3 rounded-full mb-2 bg-orange-100">
                      <Upload size={24} className="text-orange-500" />
                    </div>
                    <span className="text-sm font-medium text-slate-600">
                      Cliquez ou glissez la photo de la facture
                    </span>
                    <span className="text-xs text-slate-400 mt-1">
                      JPG, PNG • Max 5 Mo
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleInvoicePhotoSelect}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Option envoi email au chauffeur */}
          <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-100">
            <input
              type="checkbox"
              id="sendEmailClose"
              checked={closeForm.sendEmail}
              onChange={e => setCloseForm({ ...closeForm, sendEmail: e.target.checked })}
              className="w-4 h-4 rounded border-green-300 text-green-600"
            />
            <label htmlFor="sendEmailClose" className="flex items-center gap-2 text-sm font-bold text-green-800 cursor-pointer">
              <Mail size={16} /> Notifier le chauffeur de la résolution
            </label>
          </div>

          {/* Bouton clôturer */}
          <button
            onClick={handleCloseIssue}
            disabled={isUploadingInvoice || !invoicePhoto || invoiceLines.length === 0 || closeForm.comment.length < 10}
            className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
              isUploadingInvoice || !invoicePhoto || invoiceLines.length === 0 || closeForm.comment.length < 10
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {isUploadingInvoice ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Envoi en cours...
              </>
            ) : (
              <>
                <CheckCircle size={18} /> Clôturer le dossier
              </>
            )}
          </button>
          
          {/* Indicateurs manquants */}
          {(!invoicePhoto || invoiceLines.length === 0 || closeForm.comment.length < 10) && (
            <div className="text-xs text-slate-500 text-center space-y-1">
              {closeForm.comment.length < 10 && <p>⚠️ Commentaire trop court (min. 10 caractères)</p>}
              {invoiceLines.length === 0 && <p>⚠️ Ajoutez au moins une ligne de facture</p>}
              {!invoicePhoto && <p>⚠️ Photo de la facture requise</p>}
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState({ ...confirmState, isOpen: false })}
        onConfirm={() => setConfirmState({ ...confirmState, isOpen: false })}
        title={confirmState.title}
        message={confirmState.message}
      />
    </div>
  );
};

export default IssueManager;
