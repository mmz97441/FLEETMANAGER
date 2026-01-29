
import React, { useState, useMemo } from 'react';
import { 
  CompanyDocument, DocumentAcknowledgment, DocumentType, DocumentPriority, 
  User, UserRole 
} from '../types';
import { 
  FileText, Plus, Eye, Edit2, Trash2, CheckCircle, Clock, AlertTriangle, 
  Users, Calendar, Download, Upload, X, Search, Filter, Shield, 
  PenTool, FileSignature, AlertOctagon, ChevronRight, ExternalLink,
  CheckSquare, XCircle, Hash, Info, Lock
} from 'lucide-react';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import { usePermissions, Permission } from '../usePermissions';

interface DocumentManagerProps {
  documents: CompanyDocument[];
  acknowledgments: DocumentAcknowledgment[];
  users: User[];
  currentUser: User;
  onAddDocument: (doc: CompanyDocument) => Promise<void>;
  onUpdateDocument: (doc: CompanyDocument) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
  onAcknowledge: (ack: DocumentAcknowledgment) => Promise<void>;
  viewMode?: 'admin' | 'employee'; // Mode d'affichage : admin (gestion) ou employee (lecture seule)
}

// Helper pour normaliser les rôles (gardé pour le filtrage des documents par rôle cible)
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

const DocumentManager: React.FC<DocumentManagerProps> = ({
  documents, acknowledgments, users, currentUser,
  onAddDocument, onUpdateDocument, onDeleteDocument, onAcknowledge,
  viewMode = 'admin'
}) => {
  // === PERMISSIONS ===
  const { hasPermission } = usePermissions();
  
  // En mode employee, on désactive les fonctions d'administration
  const isEmployeeMode = viewMode === 'employee';
  
  const canViewOwn = hasPermission(Permission.DOCS_VIEW_OWN);
  const canViewAll = hasPermission(Permission.DOCS_VIEW_ALL) && !isEmployeeMode;
  const canManage = hasPermission(Permission.DOCS_MANAGE) && !isEmployeeMode;
  const canAcknowledge = hasPermission(Permission.DOCS_ACKNOWLEDGE);
  
  // Pour le filtrage des documents par rôle cible
  const effectiveRole = normalizeRole(currentUser.role);

  // === TOUS LES HOOKS DOIVENT ÊTRE ICI (avant tout return conditionnel) ===
  const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'manage'>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  
  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  
  const [selectedDocument, setSelectedDocument] = useState<CompanyDocument | null>(null);
  const [editingDocument, setEditingDocument] = useState<CompanyDocument | null>(null);
  
  // Signature state
  const [hasReadDocument, setHasReadDocument] = useState(false);
  const [readStartTime, setReadStartTime] = useState<number | null>(null);
  const [signatureConfirmed, setSignatureConfirmed] = useState(false);
  const [fullName, setFullName] = useState('');
  
  // Confirm modal
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    type: 'DELETE' | 'SIGN';
    title: string;
    message: string;
    data?: any;
  }>({ isOpen: false, type: 'DELETE', title: '', message: '' });

  // Form state
  const initialFormState: Partial<CompanyDocument> = {
    title: '',
    type: DocumentType.ORDRE_SERVICE,
    description: '',
    content: '',
    targetRoles: [],
    requiresSignature: true,
    effectiveDate: new Date().toISOString().slice(0, 10),
    version: '1.0',
    priority: DocumentPriority.NORMAL,
    isActive: true
  };
  const [formData, setFormData] = useState<Partial<CompanyDocument>>(initialFormState);

  // === CALCULS ===
  
  // Documents concernant l'utilisateur courant
  const myDocuments = useMemo(() => {
    return documents.filter(doc => {
      if (!doc.isActive) return false;
      if (doc.targetRoles.length === 0) return true; // Tous concernés
      return doc.targetRoles.includes(effectiveRole);
    });
  }, [documents, effectiveRole]);

  // Documents non lus/signés par l'utilisateur
  const pendingDocuments = useMemo(() => {
    return myDocuments.filter(doc => {
      const ack = acknowledgments.find(a => 
        a.documentId === doc.id && 
        a.userId === currentUser.id &&
        a.documentVersion === doc.version
      );
      if (!ack) return true; // Pas encore lu
      if (doc.requiresSignature && ack.status !== 'SIGNED') return true; // Lu mais pas signé
      return false;
    });
  }, [myDocuments, acknowledgments, currentUser.id]);

  // Stats pour un document
  const getDocumentStats = (doc: CompanyDocument) => {
    const targetUsers = users.filter(u => {
      if (doc.targetRoles.length === 0) return true;
      return doc.targetRoles.includes(normalizeRole(u.role));
    });
    
    const acks = acknowledgments.filter(a => 
      a.documentId === doc.id && 
      a.documentVersion === doc.version
    );
    
    const readCount = acks.length;
    const signedCount = acks.filter(a => a.status === 'SIGNED').length;
    
    return {
      total: targetUsers.length,
      read: readCount,
      signed: signedCount,
      pending: targetUsers.length - (doc.requiresSignature ? signedCount : readCount)
    };
  };

  // === HANDLERS ===

  const handleOpenCreate = () => {
    setFormData(initialFormState);
    setEditingDocument(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (doc: CompanyDocument) => {
    setFormData({ ...doc });
    setEditingDocument(doc);
    setIsFormModalOpen(true);
  };

  const handleOpenView = (doc: CompanyDocument) => {
    setSelectedDocument(doc);
    setReadStartTime(Date.now());
    setHasReadDocument(false);
    setIsViewModalOpen(true);
  };

  const handleOpenSign = (doc: CompanyDocument) => {
    setSelectedDocument(doc);
    setSignatureConfirmed(false);
    setFullName('');
    setIsSignModalOpen(true);
  };

  const handleViewStats = (doc: CompanyDocument) => {
    setSelectedDocument(doc);
    setIsStatsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const docData: CompanyDocument = {
      ...formData as CompanyDocument,
      id: editingDocument?.id || `doc-${Date.now()}`,
      createdAt: editingDocument?.createdAt || new Date().toISOString(),
      createdBy: editingDocument?.createdBy || currentUser.id,
      updatedAt: new Date().toISOString()
    };

    if (editingDocument) {
      await onUpdateDocument(docData);
    } else {
      await onAddDocument(docData);
    }
    
    setIsFormModalOpen(false);
    setEditingDocument(null);
  };

  const handleMarkAsRead = () => {
    setHasReadDocument(true);
  };

  const handleSign = async () => {
    if (!selectedDocument || !hasReadDocument) return;
    
    const readDuration = readStartTime ? Math.round((Date.now() - readStartTime) / 1000) : 0;
    
    // Générer un hash unique pour la signature
    const signatureData = `${currentUser.id}-${selectedDocument.id}-${selectedDocument.version}-${Date.now()}`;
    const signatureHash = btoa(signatureData); // Simple base64, en prod utiliser crypto
    
    const acknowledgment: DocumentAcknowledgment = {
      id: `ack-${Date.now()}`,
      documentId: selectedDocument.id,
      documentTitle: selectedDocument.title,
      documentVersion: selectedDocument.version,
      userId: currentUser.id,
      userName: `${currentUser.firstName} ${currentUser.lastName}`,
      readAt: new Date().toISOString(),
      readDuration,
      signedAt: selectedDocument.requiresSignature ? new Date().toISOString() : undefined,
      signatureHash: selectedDocument.requiresSignature ? signatureHash : undefined,
      userAgent: navigator.userAgent,
      status: selectedDocument.requiresSignature ? 'SIGNED' : 'READ'
    };

    await onAcknowledge(acknowledgment);
    setIsViewModalOpen(false);
    setIsSignModalOpen(false);
    setSelectedDocument(null);
  };

  const handleDelete = async () => {
    if (confirmState.data) {
      await onDeleteDocument(confirmState.data);
    }
    setConfirmState({ ...confirmState, isOpen: false });
  };

  // === RENDER HELPERS ===

  const getPriorityBadge = (priority: DocumentPriority) => {
    switch (priority) {
      case DocumentPriority.URGENT:
        return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">URGENT</span>;
      case DocumentPriority.IMPORTANT:
        return <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-full">Important</span>;
      default:
        return <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">Normal</span>;
    }
  };

  const getTypeBadge = (type: DocumentType) => {
    const colors: Record<DocumentType, string> = {
      [DocumentType.ORDRE_SERVICE]: 'bg-blue-100 text-blue-700',
      [DocumentType.REGLEMENT_INTERIEUR]: 'bg-purple-100 text-purple-700',
      [DocumentType.NOTE_SERVICE]: 'bg-green-100 text-green-700',
      [DocumentType.PROCEDURE]: 'bg-amber-100 text-amber-700',
      [DocumentType.CHARTE]: 'bg-indigo-100 text-indigo-700',
      [DocumentType.AVENANT]: 'bg-rose-100 text-rose-700'
    };
    return <span className={`px-2 py-1 ${colors[type]} text-xs font-bold rounded-full`}>{type}</span>;
  };

  const getAckStatus = (doc: CompanyDocument) => {
    const ack = acknowledgments.find(a => 
      a.documentId === doc.id && 
      a.userId === currentUser.id &&
      a.documentVersion === doc.version
    );
    
    if (!ack) {
      return { status: 'PENDING', label: 'À lire', color: 'text-orange-600 bg-orange-50' };
    }
    if (doc.requiresSignature && ack.status !== 'SIGNED') {
      return { status: 'READ', label: 'À signer', color: 'text-blue-600 bg-blue-50' };
    }
    return { status: 'DONE', label: 'Signé', color: 'text-green-600 bg-green-50' };
  };

  const filteredDocuments = useMemo(() => {
    let filtered = activeTab === 'pending' ? pendingDocuments : 
                   activeTab === 'manage' ? documents : myDocuments;
    
    if (searchTerm) {
      filtered = filtered.filter(d => 
        d.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (typeFilter !== 'all') {
      filtered = filtered.filter(d => d.type === typeFilter);
    }
    
    return filtered.sort((a, b) => {
      // Urgent en premier
      if (a.priority === DocumentPriority.URGENT && b.priority !== DocumentPriority.URGENT) return -1;
      if (b.priority === DocumentPriority.URGENT && a.priority !== DocumentPriority.URGENT) return 1;
      // Puis par date
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [activeTab, pendingDocuments, myDocuments, documents, searchTerm, typeFilter]);

  // === VÉRIFICATION D'ACCÈS (après tous les hooks) ===
  if (!canViewOwn && !canViewAll) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <div className="bg-slate-100 p-6 rounded-full mb-4">
          <Lock size={48} className="text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-700 mb-2">Accès Restreint</h3>
        <p className="text-slate-500 max-w-md">
          Vous n'avez pas accès aux documents.
        </p>
      </div>
    );
  }

  // === RENDER ===

  return (
    <div className="space-y-6 animate-fade-in">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FileSignature className="text-brand-600" />
            {isEmployeeMode ? 'Mes Documents' : 'Documents & Règlements'}
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            {pendingDocuments.length > 0 
              ? `${pendingDocuments.length} document(s) en attente de signature`
              : 'Tous les documents sont à jour'
            }
          </p>
        </div>
        
        {canManage && (
          <button 
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold shadow-lg transition-all"
          >
            <Plus size={18} /> Nouveau Document
          </button>
        )}
      </div>

      {/* ALERTE DOCUMENTS URGENTS */}
      {pendingDocuments.some(d => d.priority === DocumentPriority.URGENT) && (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-start gap-3 animate-pulse-slow">
          <div className="bg-red-100 p-2 rounded-full">
            <AlertOctagon className="text-red-600" size={24} />
          </div>
          <div>
            <h4 className="font-bold text-red-800">Documents urgents à signer</h4>
            <p className="text-red-700 text-sm">
              Vous avez des documents urgents en attente de signature. Veuillez les traiter dès que possible.
            </p>
          </div>
        </div>
      )}

      {/* TABS */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('pending')}
          className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-colors flex items-center gap-2 ${
            activeTab === 'pending' 
              ? 'bg-brand-600 text-white' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Clock size={16} />
          En attente
          {pendingDocuments.length > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
              {pendingDocuments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-colors flex items-center gap-2 ${
            activeTab === 'all' 
              ? 'bg-brand-600 text-white' 
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText size={16} />
          Tous mes documents
        </button>
        {canManage && (
          <button
            onClick={() => setActiveTab('manage')}
            className={`px-4 py-2 rounded-t-lg font-bold text-sm transition-colors flex items-center gap-2 ${
              activeTab === 'manage' 
                ? 'bg-brand-600 text-white' 
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Shield size={16} />
            Gestion
          </button>
        )}
      </div>

      {/* FILTERS */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher un document..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-slate-800 font-medium focus:ring-2 focus:ring-brand-500 outline-none"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-700 font-medium"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">Tous les types</option>
          {Object.values(DocumentType).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* LISTE DES DOCUMENTS */}
      {filteredDocuments.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl">
          <FileText size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500 font-medium">
            {activeTab === 'pending' 
              ? 'Aucun document en attente' 
              : 'Aucun document trouvé'
            }
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDocuments.map(doc => {
            const ackStatus = getAckStatus(doc);
            const stats = canManage ? getDocumentStats(doc) : null;
            
            return (
              <div 
                key={doc.id}
                className={`bg-white rounded-2xl border-2 p-4 transition-all hover:shadow-md ${
                  doc.priority === DocumentPriority.URGENT ? 'border-red-200' :
                  ackStatus.status === 'PENDING' ? 'border-orange-200' :
                  ackStatus.status === 'READ' ? 'border-blue-200' :
                  'border-slate-200'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Icône */}
                  <div className={`p-3 rounded-xl ${
                    doc.type === DocumentType.REGLEMENT_INTERIEUR ? 'bg-purple-100 text-purple-600' :
                    doc.type === DocumentType.ORDRE_SERVICE ? 'bg-blue-100 text-blue-600' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {doc.requiresSignature ? <FileSignature size={24} /> : <FileText size={24} />}
                  </div>
                  
                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-slate-800 text-lg">{doc.title}</h4>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {getTypeBadge(doc.type)}
                          {getPriorityBadge(doc.priority)}
                          <span className="text-xs text-slate-500">v{doc.version}</span>
                          {doc.requiresSignature && (
                            <span className="text-xs text-purple-600 flex items-center gap-1">
                              <PenTool size={12} /> Signature requise
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Statut utilisateur */}
                      {activeTab !== 'manage' && (
                        <div className={`px-3 py-1 rounded-full text-xs font-bold ${ackStatus.color}`}>
                          {ackStatus.label}
                        </div>
                      )}
                    </div>
                    
                    {doc.description && (
                      <p className="text-slate-600 text-sm mt-2 line-clamp-2">{doc.description}</p>
                    )}
                    
                    <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        Effectif le {new Date(doc.effectiveDate).toLocaleDateString()}
                      </span>
                      {stats && (
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {stats.signed}/{stats.total} signatures
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {activeTab !== 'manage' && ackStatus.status !== 'DONE' && (
                      <button
                        onClick={() => handleOpenView(doc)}
                        className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-colors"
                      >
                        {ackStatus.status === 'PENDING' ? (
                          <><Eye size={16} /> Lire</>
                        ) : (
                          <><PenTool size={16} /> Signer</>
                        )}
                      </button>
                    )}
                    
                    {ackStatus.status === 'DONE' && (
                      <button
                        onClick={() => handleOpenView(doc)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors"
                      >
                        <Eye size={16} /> Consulter
                      </button>
                    )}
                    
                    {canManage && activeTab === 'manage' && (
                      <>
                        <button
                          onClick={() => handleViewStats(doc)}
                          className="p-2 text-slate-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          title="Statistiques"
                        >
                          <Users size={18} />
                        </button>
                        <button
                          onClick={() => handleOpenEdit(doc)}
                          className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Modifier"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => setConfirmState({
                            isOpen: true,
                            type: 'DELETE',
                            title: 'Supprimer le document ?',
                            message: `Êtes-vous sûr de vouloir supprimer "${doc.title}" ? Cette action est irréversible.`,
                            data: doc.id
                          })}
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL CRÉATION/ÉDITION - RESPONSIVE */}
      <Modal
        isOpen={isFormModalOpen}
        onClose={() => setIsFormModalOpen(false)}
        title={editingDocument ? 'Modifier' : 'Nouveau document'}
        size="xl"
        headerIcon={<FileText size={20} />}
      >
        <form onSubmit={handleFormSubmit} className="space-y-3 sm:space-y-4">
          {/* Titre */}
          <div>
            <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Titre *</label>
            <input
              type="text"
              required
              className="w-full px-3 py-2 sm:py-2.5 border border-slate-300 rounded-lg sm:rounded-xl font-medium text-slate-900 text-sm"
              placeholder="Ex: Règlement intérieur 2025"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          
          {/* Type + Priorité - responsive grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Type *</label>
              <select
                required
                className="w-full px-3 py-2 sm:py-2.5 border border-slate-300 rounded-lg sm:rounded-xl bg-white font-medium text-slate-900 text-sm"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as DocumentType })}
              >
                {Object.values(DocumentType).map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Priorité</label>
                  <select
                    className="w-full px-3 py-2 sm:py-2.5 border border-slate-300 rounded-lg sm:rounded-xl bg-white font-medium text-slate-900 text-sm"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as DocumentPriority })}
                  >
                    {Object.values(DocumentPriority).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              {/* Description - compact */}
              <div>
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg sm:rounded-xl font-medium text-slate-900 text-sm resize-none"
                  placeholder="Brève description..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              
              {/* Contenu - réduit */}
              <div>
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Contenu du document</label>
                <textarea
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg sm:rounded-xl font-medium text-slate-900 font-mono text-xs sm:text-sm resize-none"
                  placeholder="Contenu texte ou lien PDF..."
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                />
              </div>
              
              {/* Date + Version - responsive */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Date d'effet *</label>
                  <input
                    type="date"
                    required
                    className="w-full px-3 py-2 sm:py-2.5 border border-slate-300 rounded-lg sm:rounded-xl font-medium text-slate-900 text-sm"
                    value={formData.effectiveDate}
                    onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1">Version</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 sm:py-2.5 border border-slate-300 rounded-lg sm:rounded-xl font-medium text-slate-900 text-sm"
                    placeholder="1.0"
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                  />
                </div>
              </div>
              
              {/* Destinataires - compact */}
              <div>
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-2">Destinataires</label>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {[UserRole.PRESIDENT, UserRole.DIRECTOR, UserRole.SECRETARY, UserRole.DRIVER, UserRole.MECHANIC].map(role => (
                    <label key={role} className="flex items-center gap-1.5 px-2 py-1.5 sm:px-3 sm:py-2 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-100 text-xs sm:text-sm">
                      <input
                        type="checkbox"
                        checked={formData.targetRoles?.includes(role)}
                        onChange={(e) => {
                          const roles = formData.targetRoles || [];
                          if (e.target.checked) {
                            setFormData({ ...formData, targetRoles: [...roles, role] });
                          } else {
                            setFormData({ ...formData, targetRoles: roles.filter(r => r !== role) });
                          }
                        }}
                        className="rounded text-brand-600 w-3.5 h-3.5"
                      />
                      <span className="font-medium text-slate-700">{role}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] sm:text-xs text-slate-500 mt-1">Vide = tout le monde</p>
              </div>
              
              {/* Signature - compact */}
              <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl border border-purple-200">
                <input
                  type="checkbox"
                  checked={formData.requiresSignature}
                  onChange={(e) => setFormData({ ...formData, requiresSignature: e.target.checked })}
                  className="w-5 h-5 rounded text-purple-600 flex-shrink-0"
                />
                <div className="min-w-0">
                  <span className="font-bold text-purple-800 flex items-center gap-1.5 text-sm">
                    <PenTool size={14} /> Signature obligatoire
                  </span>
                  <p className="text-[10px] sm:text-xs text-purple-600">Signature électronique requise</p>
                </div>
              </div>
              
              {/* Boutons - sticky en bas */}
              <div className="flex gap-2 pt-2 sticky bottom-0 bg-white pb-1">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="flex-1 py-2.5 sm:py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm"
                >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 sm:py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm"
            >
              {editingDocument ? 'Enregistrer' : 'Publier'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL LECTURE + SIGNATURE - RESPONSIVE */}
      <Modal
        isOpen={isViewModalOpen && !!selectedDocument}
        onClose={() => setIsViewModalOpen(false)}
        title={selectedDocument?.title || ''}
        subtitle={selectedDocument ? `Publié le ${new Date(selectedDocument.createdAt).toLocaleDateString()}` : ''}
        size="2xl"
        headerIcon={<Eye size={20} />}
      >
        {selectedDocument && (
          <>
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {getTypeBadge(selectedDocument.type)}
              {getPriorityBadge(selectedDocument.priority)}
              <span className="text-[10px] sm:text-xs text-slate-500">v{selectedDocument.version}</span>
            </div>
            
            {/* Description */}
            {selectedDocument.description && (
              <div className="bg-blue-50 p-3 rounded-xl mb-3 border border-blue-200">
                <p className="text-blue-800 font-medium text-sm">{selectedDocument.description}</p>
              </div>
            )}
            
            {/* Contenu */}
            <div className="prose prose-sm prose-slate max-w-none">
              {selectedDocument.content ? (
                <div className="whitespace-pre-wrap text-slate-700 leading-relaxed text-sm">
                  {selectedDocument.content}
                </div>
              ) : (
                <p className="text-slate-500 italic text-sm">Aucun contenu texte disponible.</p>
              )}
            </div>
            
            {/* Footer - Actions compact */}
            <div className="p-3 sm:p-4 border-t border-slate-100 bg-slate-50 mt-4 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 rounded-b-2xl">
              {!hasReadDocument ? (
                <div className="space-y-3">
                  <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 flex items-start gap-2">
                    <Info className="text-amber-600 flex-shrink-0" size={18} />
                    <div>
                      <p className="font-bold text-amber-800 text-sm">Lecture obligatoire</p>
                      <p className="text-xs text-amber-700">Lisez le document avant de confirmer.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleMarkAsRead}
                    className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm"
                  >
                    <CheckCircle size={16} />
                    J'ai lu et compris
                  </button>
                </div>
              ) : selectedDocument.requiresSignature ? (
                <div className="space-y-3">
                  <div className="bg-purple-50 p-3 rounded-xl border border-purple-200">
                    <h4 className="font-bold text-purple-800 flex items-center gap-2 mb-2 text-sm">
                      <FileSignature size={16} /> Signature électronique
                    </h4>
                    
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs font-medium text-purple-700 mb-1">
                          Tapez votre nom complet
                        </label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 border border-purple-300 rounded-lg font-medium text-sm"
                          placeholder={`${currentUser.firstName} ${currentUser.lastName}`}
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                        />
                      </div>
                      
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={signatureConfirmed}
                          onChange={(e) => setSignatureConfirmed(e.target.checked)}
                          className="mt-0.5 rounded text-purple-600"
                        />
                        <span className="text-xs text-purple-700">
                          Je certifie avoir lu et compris ce document et m'engage à le respecter.
                        </span>
                      </label>
                    </div>
                  </div>
                  
                  <button
                    onClick={handleSign}
                    disabled={!signatureConfirmed || fullName.trim().toLowerCase() !== `${currentUser.firstName} ${currentUser.lastName}`.toLowerCase()}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-colors"
                  >
                    <PenTool size={16} />
                    Signer
                  </button>
                  
                  <p className="text-[10px] text-center text-slate-500">
                    Signature horodatée et sécurisée
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleSign}
                  className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 text-sm"
                >
                  <CheckCircle size={16} />
                  Confirmer la lecture
                </button>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* MODAL STATISTIQUES - RESPONSIVE */}
      <Modal
        isOpen={isStatsModalOpen && !!selectedDocument}
        onClose={() => setIsStatsModalOpen(false)}
        title="Suivi des signatures"
        size="lg"
        headerIcon={<Users size={20} />}
      >
        {selectedDocument && (
          <div className="space-y-3">
            <div className="bg-slate-50 p-3 rounded-xl">
              <h4 className="font-bold text-slate-800 text-sm line-clamp-1">{selectedDocument.title}</h4>
              <p className="text-xs text-slate-500">Version {selectedDocument.version}</p>
            </div>
            
            {(() => {
              const stats = getDocumentStats(selectedDocument);
              return (
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-blue-50 p-2 sm:p-3 rounded-xl text-center">
                    <p className="text-xl sm:text-2xl font-bold text-blue-600">{stats.total}</p>
                    <p className="text-[10px] sm:text-xs text-blue-700 font-medium">Concernés</p>
                  </div>
                  <div className="bg-green-50 p-2 sm:p-3 rounded-xl text-center">
                    <p className="text-xl sm:text-2xl font-bold text-green-600">{stats.signed}</p>
                    <p className="text-[10px] sm:text-xs text-green-700 font-medium">Signés</p>
                  </div>
                  <div className="bg-orange-50 p-2 sm:p-3 rounded-xl text-center">
                    <p className="text-xl sm:text-2xl font-bold text-orange-600">{stats.pending}</p>
                    <p className="text-[10px] sm:text-xs text-orange-700 font-medium">En attente</p>
                  </div>
                </div>
              );
            })()}
            
            <div className="space-y-1.5">
              <h4 className="font-bold text-slate-700 text-sm">Détail par utilisateur</h4>
              {users
                .filter(u => {
                  if (selectedDocument.targetRoles.length === 0) return true;
                  return selectedDocument.targetRoles.includes(normalizeRole(u.role));
                })
                .map(u => {
                  const ack = acknowledgments.find(a => 
                    a.documentId === selectedDocument.id &&
                      a.userId === u.id &&
                      a.documentVersion === selectedDocument.version
                    );
                    
                    return (
                      <div key={u.id} className="flex items-center justify-between p-2 sm:p-3 bg-white rounded-lg border border-slate-200">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800 text-sm truncate">{u.firstName} {u.lastName}</p>
                          <p className="text-xs text-slate-500">{u.role}</p>
                        </div>
                        <div className="text-right">
                          {ack ? (
                            <div>
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                                ack.status === 'SIGNED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {ack.status === 'SIGNED' ? <CheckCircle size={12} /> : <Eye size={12} />}
                                {ack.status === 'SIGNED' ? 'Signé' : 'Lu'}
                              </span>
                              <p className="text-[10px] text-slate-500 mt-1">
                                {new Date(ack.signedAt || ack.readAt).toLocaleString()}
                              </p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                              <Clock size={12} /> En attente
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>
        )}
      </Modal>

      {/* CONFIRM MODAL */}
      {confirmState.isOpen && (
        <ConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.title}
          message={confirmState.message}
          type="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmState({ ...confirmState, isOpen: false })}
        />
      )}
    </div>
  );
};

export default DocumentManager;
