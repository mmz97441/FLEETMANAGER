
import React, { useState, useMemo, useEffect, useRef, useId } from 'react';
import { QuoteRequest, QuoteStatus, User, UserRole, ViewState, SavedAddress, DeliveryTimeSlot, Zone, ProofOfDelivery, Package as PackageType, PackageStatus, PACKAGE_STATUS_COLORS } from '../types';
import { Package, MapPin, Calendar, Plus, CheckCircle, XCircle, Clock, Truck, Euro, Send, X, ArrowRight, User as UserIcon, Phone, Box, Info, Bell, FileText, Weight, Building2, StickyNote, BarChart3, Users, Mail, UserPlus, AlertTriangle, PieChart as PieChartIcon, Edit, Trash2, HelpCircle, PhoneCall, FileQuestion, BookOpen, ChevronDown, ChevronUp, Bookmark, Star, Printer, Search, Download, QrCode, Eye, FileSpreadsheet, Navigation } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import Modal from './shared/Modal';
import PageHeader from './shared/PageHeader';
import { packageStatusLabel } from '../utils/operationalLabels';
import { FormInput } from './shared/FormInput';
import { useUrlParam, updateUrlParams } from '../hooks/useUrlState';
import ConfirmModal from './ConfirmModal';
import PackageTimeline from './PackageTimeline';
import { sendUserInvitationEmail } from '../services/emailService';
import { createInvitation, getActivationUrl, resendInvitation } from '../services/invitationService';
import { subscribeToSavedAddresses, addSavedAddress, incrementAddressUsage, updateUserProfile, updateSavedAddress, deleteSavedAddress } from '../services/firestore';
import { getDeliveryScheduleConfig, getAvailableSlotsForZone, estimateZoneFromAddress } from '../services/deliveryService';
import { getPODByPackage } from '../services/podService';
import { subscribeToClientPackages } from '../services/missionService';
import { generateBatchLabelsHTML } from '../services/pickupService';
import ShippingLabel, { quoteToLabelData, ShippingLabelData } from './ShippingLabel';
import PODViewer from './PODViewer';
import { openDeliveryNote } from '../utils/deliveryNote';
import { placeKey } from '../utils/address';
import { formatEuro, formatWeight } from '../utils/format';
import CreateShipmentModal from './CreateShipmentModal';
import ImportShipmentsModal from './ImportShipmentsModal';
import ImportRecipientsModal from './ImportRecipientsModal';
import AccountHub from './AccountHub';
import ClientAnalytics from './ClientAnalytics';
import InsightsPanel from './analytics/InsightsPanel';
import RecipientsManager from './RecipientsManager';
import ClientLiveTracking from './ClientLiveTracking';
import ClientHelp, { HelpNavTarget } from './ClientHelp';
import HintTooltip from './shared/Tooltip';
import { getClientInsights } from '../services/clientInsights';
import { notifySuccess, notifyWarning, notifyInfo } from '../services/logService';
import { ClientAccessContext, ClientAccess } from './client/ClientAccessContext';
import { ClientMutationAudit, runClientMutation } from '../utils/clientMutation';
import ShipmentReference from './client/ShipmentReference';
import { changePassword } from '../services/accountService';

// ============================================================================
// COMPOSANT InputField DÉFINI EN DEHORS pour éviter le bug de focus
// ============================================================================
const InputField = ({ icon, label, placeholder, ...props }: any) => (
    <FormInput icon={icon} label={label || placeholder} placeholder={placeholder} {...props} />
);

// ============================================================================
// COMPOSANT AddressAutocomplete
// ============================================================================
interface AddressAutocompleteProps {
    savedAddresses: SavedAddress[];
    type: 'pickup' | 'delivery';
    value: { address: string; city: string; contactName: string; contactPhone: string };
    onChange: (data: { address: string; city: string; contactName: string; contactPhone: string }) => void;
    onSelectSaved: (addressId: string) => void;
    selectedLabel?: string;
    onClearSelection?: () => void;
}

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({ 
    savedAddresses, 
    type, 
    value, 
    onChange,
    onSelectSaved,
    selectedLabel,
    onClearSelection
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    // Filtrer les adresses compatibles avec le type
    const filteredAddresses = useMemo(() => {
        const compatible = savedAddresses.filter(addr => 
            addr.type === 'both' || addr.type === type
        );
        
        if (!searchTerm) return compatible;
        
        const term = searchTerm.toLowerCase();
        return compatible.filter(addr =>
            addr.label?.toLowerCase().includes(term) ||
            addr.address?.toLowerCase().includes(term) ||
            addr.city?.toLowerCase().includes(term) ||
            addr.contactName?.toLowerCase().includes(term)
        );
    }, [savedAddresses, type, searchTerm]);

    // Fermer le dropdown quand on clique ailleurs
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelectAddress = (addr: SavedAddress) => {
        onChange({
            address: addr.address,
            city: addr.city,
            contactName: addr.contactName,
            contactPhone: addr.contactPhone
        });
        onSelectSaved(addr.id);
        setIsOpen(false);
        setSearchTerm('');
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bouton pour ouvrir le sélecteur */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                className="ui-button ui-button-secondary w-full mb-3 !justify-between !text-left"
            >
                <span className="flex items-center gap-2 min-w-0">
                    {selectedLabel ? (
                        <>
                            <CheckCircle size={16} className="flex-shrink-0" />
                            <span className="break-words min-w-0">{selectedLabel}</span>
                        </>
                    ) : (
                        <>
                            <Bookmark size={16} className="flex-shrink-0" />
                            <span>Choisir une adresse enregistrée</span>
                        </>
                    )}
                </span>
                <div className="flex items-center gap-1">
                    {selectedLabel && onClearSelection && (
                        <span 
                            onClick={(e) => { e.stopPropagation(); onClearSelection(); }}
                            className="p-1 hover:bg-green-200 rounded-full"
                        >
                            <X size={14} />
                        </span>
                    )}
                    <ChevronDown size={16} className={`transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute z-[100] w-full bg-white rounded-xl shadow-2xl border border-slate-200 mt-1 max-h-72 overflow-hidden">
                    {/* Recherche */}
                    <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                            <input
                                type="text"
                                placeholder="Rechercher une adresse..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 text-base border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none min-h-11"
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Liste des adresses */}
                    <div className="max-h-52 overflow-y-auto">
                        {filteredAddresses.length > 0 ? (
                            filteredAddresses.map(addr => (
                                <button
                                    key={addr.id}
                                    type="button"
                                    onClick={() => handleSelectAddress(addr)}
                                    className="ui-button ui-button-secondary w-full text-left border-b last:border-0"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                {addr.isFavorite && <Star size={14} className="text-amber-500 fill-amber-500 flex-shrink-0" />}
                                                <span className="font-bold text-slate-800 text-sm break-words">
                                                    {addr.label || addr.address}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-600 mt-0.5 break-words">
                                                {addr.address}, {addr.city}
                                            </p>
                                            <p className="text-sm text-slate-600 mt-0.5">
                                                {addr.contactName} • {addr.contactPhone}
                                            </p>
                                        </div>
                                        <span className={`flex-shrink-0 text-sm font-bold px-2 py-0.5 rounded-full ${
                                            addr.type === 'pickup' ? 'bg-green-100 text-green-700' :
                                            addr.type === 'delivery' ? 'bg-blue-100 text-blue-700' :
                                            'bg-purple-100 text-purple-700'
                                        }`}>
                                            {addr.type === 'pickup' ? 'Enlèvement' : 
                                             addr.type === 'delivery' ? 'Livraison' : 'Les deux'}
                                        </span>
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="px-4 py-6 text-center text-slate-600 text-sm">
                                <Bookmark size={24} className="mx-auto mb-2 opacity-50" />
                                {searchTerm ? 'Aucune adresse trouvée' : 'Aucune adresse enregistrée'}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

interface ClientPortalProps {
  activeView: ViewState; // NEW: Controlled by global navigation
  currentUser: User;
  quotes: QuoteRequest[];
  companyUsers?: User[];
  onNavigate?: (view: ViewState) => void;
  onAddQuote: (quote: QuoteRequest) => void;
  onUpdateQuoteStatus: (id: string, status: QuoteStatus) => void;
  onAddTeamMember?: (user: User) => void;
  onUpdateTeamMember?: (user: User) => void;
  onDeleteTeamMember?: (userId: string) => void;
  previewMode?: boolean;
  interventionActorLabel?: string;
  interventionAudit?: ClientMutationAudit; // absent = lecture seule en aperçu
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];

// Découpe "10 rue X, 97400 Ville" en { street, city:"97400 Ville" } (best-effort)
const splitCompanyAddress = (full?: string): { street: string; city: string } => {
  const s = (full || '').trim();
  const m = s.match(/(97\d{3}|\d{5})/);
  if (!m) return { street: s, city: '' };
  const idx = s.indexOf(m[1]);
  return { street: s.slice(0, idx).replace(/[,\s]+$/, '').trim(), city: s.slice(idx).trim() };
};

// Code couleur (bordure gauche) + explication (tooltip) par stade de livraison
const STATUS_BORDER: Record<string, string> = {
  [PackageStatus.PENDING]: 'border-l-slate-400',
  [PackageStatus.COLLECTED]: 'border-l-blue-400',
  [PackageStatus.AT_HUB]: 'border-l-indigo-400',
  [PackageStatus.SORTED]: 'border-l-purple-400',
  [PackageStatus.IN_TRANSIT]: 'border-l-cyan-400',
  [PackageStatus.LOADED]: 'border-l-amber-400',
  [PackageStatus.IN_DELIVERY]: 'border-l-orange-400',
  [PackageStatus.DELIVERED]: 'border-l-green-500',
  [PackageStatus.FAILED]: 'border-l-red-500',
  [PackageStatus.RETURN_REQUESTED]: 'border-l-yellow-400',
  [PackageStatus.RETURNED]: 'border-l-rose-400',
};
const STATUS_TOOLTIP: Record<string, string> = {
  [PackageStatus.PENDING]: 'Colis enregistré — en attente de collecte par le transporteur',
  [PackageStatus.COLLECTED]: 'Colis collecté chez vous',
  [PackageStatus.AT_HUB]: 'Arrivé au centre de tri',
  [PackageStatus.SORTED]: 'Trié et affecté à une tournée',
  [PackageStatus.IN_TRANSIT]: 'En transit vers la zone de livraison',
  [PackageStatus.LOADED]: 'Chargé dans le véhicule de livraison',
  [PackageStatus.IN_DELIVERY]: 'En cours de livraison — le chauffeur est en route',
  [PackageStatus.DELIVERED]: 'Livré au destinataire (preuve disponible)',
  [PackageStatus.FAILED]: 'Livraison en échec — voir le détail',
  [PackageStatus.RETURN_REQUESTED]: 'Retour programmé au centre',
  [PackageStatus.RETURNED]: 'Retourné au centre',
};

const ClientPortal: React.FC<ClientPortalProps> = ({ activeView, currentUser, quotes, companyUsers = [], onNavigate, onAddQuote, onUpdateQuoteStatus, onAddTeamMember, onUpdateTeamMember, onDeleteTeamMember, previewMode = false, interventionAudit, interventionActorLabel }) => {
  const formFieldId = useId();
  const readOnly = previewMode && !interventionAudit;
  const access = useMemo<ClientAccess>(() => ({
    readOnly, impersonating: previewMode,
    contextLabel: previewMode ? `Client : ${currentUser.companyName || currentUser.email} · Intervenant : ${interventionActorLabel || 'session authentifiée'}` : undefined,
    runMutation: (action, operation) => runClientMutation({ readOnly, audit: previewMode ? interventionAudit : undefined, onAuditFailure: () => notifyWarning("Le résultat de l’intervention n’a pas pu être journalisé. La demande initiale reste tracée ; vérifiez le résultat avant toute relance.") }, action, operation),
  }), [readOnly, previewMode, interventionAudit, interventionActorLabel, currentUser.companyName, currentUser.email]);
  const [quoteError, setQuoteError] = useState('');
  const [quoteResult, setQuoteResult] = useState<{ reference: string; addresses: Array<{ label: string; status: 'saved' | 'existing' | 'unconfirmed' }> } | null>(null);
  const [teamMessages, setTeamMessages] = useState<Record<string, string>>({});
  const [sendingInvitation, setSendingInvitation] = useState<string | null>(null);
  const [podMessages, setPodMessages] = useState<Record<string, string>>({});
  // En mode "Voir en tant que", l'auth Firebase reste celle de l'admin : on
  // interdit le changement de mot de passe (il modifierait le compte admin).
  const blockedChangePassword = async () => {
    throw new Error('Le mot de passe doit être modifié par le titulaire du compte depuis sa propre session.');
  };
  // Navigation Local State REMOVED in favor of activeView prop
  const [listFilter, setListFilter] = useState<'active' | 'history'>('active');
  
  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  
  // Edit Mode State for Team
  const [editingMember, setEditingMember] = useState<User | null>(null);

  // FAQ State
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Pending Action State for Confirm Modal
  const [pendingAction, setPendingAction] = useState<{
      type: 'ADD_QUOTE' | 'ACCEPT_OFFER' | 'REJECT_OFFER' | 'ADD_MEMBER' | 'DELETE_MEMBER' | 'UPDATE_MEMBER';
      data?: any;
  } | null>(null);

  // Form State - Quote
  // L'expéditeur (enlèvement) = le client lui-même → pré-rempli depuis "Mon entreprise"
  const _origin = splitCompanyAddress(currentUser.companyAddress);
  const [newRequest, setNewRequest] = useState({
      originAddress: _origin.street, originCity: _origin.city,
      originContactName: currentUser.companyName || '', originContactPhone: currentUser.companyPhone || '',
      destinationAddress: '', destinationCity: '', destContactName: '', destContactPhone: '',
      goodsDescription: '', weight: '' as any,
      length: '' as any, width: '' as any, height: '' as any, volume: 0,
      pickupDate: '', deliveryDate: '', clientNotes: ''
  });

  // Form State - Team Member
  const [memberForm, setMemberForm] = useState({ firstName: '', lastName: '', email: '' });

  // ============================================================================
  // CARNET D'ADRESSES
  // ============================================================================
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [saveOriginAddress, setSaveOriginAddress] = useState(false);
  const [saveDestAddress, setSaveDestAddress] = useState(false);
  const [originLabel, setOriginLabel] = useState('');
  const [destLabel, setDestLabel] = useState('');
  const [selectedOriginLabel, setSelectedOriginLabel] = useState<string | null>(null);
  const [selectedDestLabel, setSelectedDestLabel] = useState<string | null>(null);
  const [addressSaveMessage, setAddressSaveMessage] = useState<string | null>(null);

  // Créneaux de livraison
  const [deliverySlots, setDeliverySlots] = useState<DeliveryTimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<DeliveryTimeSlot | null>(null);
  const [detectedZone, setDetectedZone] = useState<Zone | null>(null);
  const [labelData, setLabelData] = useState<ShippingLabelData | null>(null);
  const [viewingPOD, setViewingPOD] = useState<{ pod: ProofOfDelivery; quote: QuoteRequest } | null>(null);
  const [loadingPOD, setLoadingPOD] = useState<string | null>(null);

  // === MON ENTREPRISE (identité expéditeur pour les BL) ===
  const [companyForm, setCompanyForm] = useState({
    companyName: currentUser.companyName || '',
    companyAddress: currentUser.companyAddress || '',
    companySiret: currentUser.companySiret || '',
    companyPhone: currentUser.companyPhone || '',
  });
  const [companySaveMsg, setCompanySaveMsg] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const companyInfoComplete = !!(companyForm.companyName.trim() && companyForm.companyAddress.trim());
  const handleSaveCompany = async () => {
    setSavingCompany(true);
    try {
      await access.runMutation('Enregistrer les informations entreprise', () => updateUserProfile({
        ...currentUser,
        companyName: companyForm.companyName.trim(),
        companyAddress: companyForm.companyAddress.trim(),
        companySiret: companyForm.companySiret.trim(),
        companyPhone: companyForm.companyPhone.trim(),
      }));
      setCompanySaveMsg('Infos entreprise enregistrées — elles apparaîtront sur vos BL.');
    } catch (e) {
      setCompanySaveMsg(e instanceof Error ? e.message : 'Échec de l’enregistrement. Vos informations sont conservées ; réessayez.');
    }
    setSavingCompany(false);

  };

  // === MES EXPÉDITIONS (colis du client) ===
  const [clientPackages, setClientPackages] = useState<PackageType[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(true);
  const [packagesError, setPackagesError] = useState('');
  const [packagesRetry, setPackagesRetry] = useState(0);
  const [labelPrintError, setLabelPrintError] = useState('');
  const printShipmentLabels = (parcels: PackageType[]) => {
    if (!parcels.length) return;
    setLabelPrintError('');
    try {
      const win = window.open('', '_blank');
      if (!win) { setLabelPrintError('La fenêtre d’impression est bloquée. Autorisez les fenêtres de ce site puis cliquez à nouveau sur Imprimer. Vos colis sont déjà enregistrés.'); return; }
      win.opener = null;
      win.document.write(generateBatchLabelsHTML(parcels, currentUser.companyName || 'Expéditeur')); win.document.close();
    } catch { setLabelPrintError('L’impression n’a pas pu s’ouvrir. Les colis sont enregistrés ; vous pouvez réessayer.'); }
  };

  // Gestion du carnet de destinataires (CRUD)
  const recipientPackageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    clientPackages.forEach(p => { const n = (p.contactName || '').trim(); if (n) m[n] = (m[n] || 0) + 1; });
    return m;
  }, [clientPackages]);
  const handleCreateRecipient = async (fields: { contactName: string; address: string; city: string; contactPhone: string; contactEmail?: string; notes?: string }) => {
    await access.runMutation('Ajouter un destinataire', () => addSavedAddress({
      companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`,
      createdBy: currentUser.id,
      label: fields.contactName,
      type: 'delivery',
      address: fields.address,
      city: fields.city,
      contactName: fields.contactName,
      contactPhone: fields.contactPhone,
      contactEmail: fields.contactEmail,
      notes: fields.notes,
      createdAt: '', updatedAt: '',
    } as any));
  };
  const handleUpdateRecipient = async (addr: SavedAddress) => { await access.runMutation('Modifier un destinataire', () => updateSavedAddress(addr)); };
  const handleDeleteRecipient = async (id: string) => { await access.runMutation('Supprimer un destinataire', () => deleteSavedAddress(id)); };

  // Liens réels depuis le centre d'aide vers les vraies pages/actions
  const handleHelpNavigate = (target: HelpNavTarget) => {
    switch (target) {
      case 'home': onNavigate?.('client_dashboard'); break;
      case 'shipments': onNavigate?.('client_shipments'); break;
      case 'recipients': onNavigate?.('client_recipients'); break;
      case 'analytics': onNavigate?.('client_analytics'); break;
      case 'create': if (!readOnly) setShowCreateShipment(true); break;
      case 'account': setShowAccountHub(true); break;
    }
  };

  const [shipmentSearch, setShipmentSearchParam] = useUrlParam<string>('clientSearch', '');
  const setShipmentSearch = (value: string) => updateUrlParams({ clientSearch: value, package: null }, true);
  const [shipmentFilter, setShipmentFilterParam] = useUrlParam<'all' | 'pending' | 'transit' | 'delivered' | 'failed'>('clientStatus', 'all', ['all', 'pending', 'transit', 'delivered', 'failed']);
  const setShipmentFilter = (value: 'all' | 'pending' | 'transit' | 'delivered' | 'failed') => updateUrlParams({ clientStatus: value === 'all' ? null : value, package: null });
  const [expandedShipmentId, setExpandedShipmentParam] = useUrlParam<string>('package', '');
  const setExpandedShipmentId = (id: string | null) => setExpandedShipmentParam(id || '');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null); // groupe pharmacie déplié
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [showCreateShipment, setShowCreateShipment] = useState(false);
  const [showImportShipments, setShowImportShipments] = useState(false);
  const [showImportRecipients, setShowImportRecipients] = useState(false);
  const [showAccountHub, setShowAccountHub] = useState(false);

  // Sauvegarde des infos entreprise depuis "Mon compte" (persiste + rafraîchit le formulaire local)
  const handleSaveCompanyFromHub = async (fields: { companyName: string; companyAddress: string; companyPhone: string; companySiret: string }) => {
    await access.runMutation('Enregistrer les informations entreprise', () => updateUserProfile({
      ...currentUser,
      companyName: currentUser.companyName || '',
      companyAddress: fields.companyAddress.trim(),
      companyPhone: fields.companyPhone.trim(),
      companySiret: fields.companySiret.trim(),
    }));
    setCompanyForm({
      companyName: currentUser.companyName || '',
      companyAddress: fields.companyAddress.trim(),
      companySiret: fields.companySiret.trim(),
      companyPhone: fields.companyPhone.trim(),
    });
  };

  // Charger la config créneaux au montage
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const cfg = await getDeliveryScheduleConfig();
        // Stocker tous les slots actifs, on filtrera quand on connaîtra la zone
        setDeliverySlots(cfg.slots.filter(s => s.isActive));
      } catch (e) {
        /* silenced */
      }
    };
    loadConfig();
  }, []);

  // Charger les colis du client (pour "Mes expéditions")
  // Abonnement dédié : requête server-side par clientId + clientName (tous les
  // colis du client, sans la limite globale de 500 qui en masquait d'anciens).
  useEffect(() => {
    if (!currentUser?.id) return;
    setIsLoadingPackages(true);
    setPackagesError('');
    setClientPackages([]);
    const unsub = subscribeToClientPackages(
      { id: currentUser.id, companyName: currentUser.companyName },
      (pkgs) => {
        setClientPackages(pkgs);
        setIsLoadingPackages(false);
        setPackagesError('');
      },
      () => {
        setIsLoadingPackages(false);
        setPackagesError('Vos colis n’ont pas pu être chargés complètement. Vérifiez votre connexion et réessayez. Les éventuelles données déjà affichées ne sont plus à jour.');
      }
    );
    return unsub;
  }, [currentUser.id, currentUser.companyName, packagesRetry]);

  // Détecter la zone quand l'adresse destination change
  useEffect(() => {
    const detect = async () => {
      const fullAddr = `${newRequest.destinationAddress},${newRequest.destinationCity}`;
      if (fullAddr.length < 8) {
        setDetectedZone(null);
        return;
      }
      const result = await estimateZoneFromAddress(fullAddr);
      setDetectedZone(result?.zone || null);
    };
    const timer = setTimeout(detect, 500); // debounce
    return () => clearTimeout(timer);
  }, [newRequest.destinationAddress, newRequest.destinationCity]);

  // Filtrer les créneaux disponibles selon zone et date
  const availableSlots = useMemo(() => {
    if (!detectedZone || !newRequest.deliveryDate) return [];
    const dateStr = newRequest.deliveryDate.split('T')[0];
    return deliverySlots
      .filter(s => s.zones.includes(detectedZone))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [detectedZone, newRequest.deliveryDate, deliverySlots]);

  // S'abonner aux adresses enregistrées de l'entreprise
  useEffect(() => {
    if (!currentUser.companyName) return;
    
    const unsubscribe = subscribeToSavedAddresses(currentUser.companyName, (addresses) => {
      setSavedAddresses(addresses);
    });
    
    return () => unsubscribe();
  }, [currentUser.companyName]);

  // Fonction pour sauvegarder une nouvelle adresse (avec vérification doublons)
  const handleSaveNewAddress = async (
    type: 'pickup' | 'delivery',
    data: { address: string; city: string; contactName: string; contactPhone: string },
    label: string
  ): Promise<'saved' | 'existing' | 'unconfirmed'> => {
    if (!currentUser.companyName) return 'unconfirmed';
    
    // Vérifier si l'adresse existe déjà (même point de livraison, cf. address.ts)
    const exists = savedAddresses.some(addr => placeKey(addr) === placeKey(data));
    
    if (exists) {
      return 'existing';
    }
    
    try {
      await access.runMutation('Ajouter une adresse au carnet', () => addSavedAddress({
        companyName: currentUser.companyName!,
        createdBy: currentUser.id,
        label: label || `${type === 'pickup' ? 'Enlèvement' : 'Livraison'} - ${data.city}`,
        type,
        address: data.address,
        city: data.city,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      return 'saved';
    } catch (error) {
      console.error('Erreur sauvegarde adresse:', error);
      return 'unconfirmed';
    }
  };

  // --- DATA PREPARATION ---
  const myQuotes = useMemo(() => {
      const companyUserIds = companyUsers.map(u => u.id);
      if (!companyUserIds.includes(currentUser.id)) companyUserIds.push(currentUser.id);

      return quotes.filter(q => companyUserIds.includes(q.clientId) || (Boolean(currentUser.companyName) && q.clientName === currentUser.companyName))
                   .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [quotes, currentUser, companyUsers]);

  // KPIS
  const kpis = useMemo(() => {
      const accepted = myQuotes.filter(q => q.status === QuoteStatus.ACCEPTED);
      const totalSpent = accepted.reduce((sum, q) => sum + (q.priceOffer || 0), 0);
      const totalVolume = accepted.reduce((sum, q) => sum + (q.volume || 0), 0);
      const totalWeight = accepted.reduce((sum, q) => sum + (q.weight || 0), 0);
      const activeCount = myQuotes.filter(q => [QuoteStatus.REQUESTED, QuoteStatus.OFFER_SENT].includes(q.status)).length;
      
      return { totalSpent, totalVolume, totalWeight, activeCount, totalQuotes: myQuotes.length };
  }, [myQuotes]);

  // Charts
  const spendingData = useMemo(() => {
      const data: any[] = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthKey = d.toLocaleString('fr-FR', { month: 'short' });
          const total = myQuotes
              .filter(q => q.status === QuoteStatus.ACCEPTED && new Date(q.date).getMonth() === d.getMonth())
              .reduce((sum, q) => sum + (q.priceOffer || 0), 0);
          data.push({ name: monthKey, amount: total });
      }
      return data;
  }, [myQuotes]);

  const statusData = useMemo(() => [
      { name: 'En Attente', value: myQuotes.filter(q => q.status === QuoteStatus.REQUESTED).length },
      { name: 'Validé', value: myQuotes.filter(q => q.status === QuoteStatus.ACCEPTED).length },
      { name: 'Offre Reçue', value: myQuotes.filter(q => q.status === QuoteStatus.OFFER_SENT).length },
      { name: 'Refusé', value: myQuotes.filter(q => q.status === QuoteStatus.REJECTED).length },
  ].filter(d => d.value > 0), [myQuotes]);


  const activeQuotes = myQuotes.filter(q => [QuoteStatus.REQUESTED, QuoteStatus.OFFER_SENT].includes(q.status));
  const historyQuotes = myQuotes.filter(q => [QuoteStatus.ACCEPTED, QuoteStatus.REJECTED].includes(q.status));
  const pendingOffersCount = activeQuotes.filter(q => q.status === QuoteStatus.OFFER_SENT).length;
  const displayQuotes = listFilter === 'active' ? activeQuotes : historyQuotes;

  // --- LOGIC: VOLUME & DATES ---
  useEffect(() => {
      const l = Number(newRequest.length) || 0;
      const w = Number(newRequest.width) || 0;
      const h = Number(newRequest.height) || 0;
      if (l > 0 && w > 0 && h > 0) {
          const volM3 = (l * w * h) / 1000000; 
          setNewRequest(prev => ({ ...prev, volume: Number(volM3.toFixed(3)) }));
      } else {
          setNewRequest(prev => ({ ...prev, volume: 0 }));
      }
  }, [newRequest.length, newRequest.width, newRequest.height]);

  const getMinPickupDate = () => {
      const now = new Date();
      now.setHours(now.getHours() + 2);
      if (now.getHours() >= 17) {
          now.setDate(now.getDate() + 1);
          now.setHours(8, 0, 0, 0);
      }
      return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  };
  const getMinDeliveryDate = () => {
      if (!newRequest.pickupDate) return '';
      const pickup = new Date(newRequest.pickupDate);
      pickup.setHours(pickup.getHours() + 3);
      if (pickup.getHours() >= 17) {
          pickup.setDate(pickup.getDate() + 1);
          pickup.setHours(8, 0, 0, 0);
      }
      return new Date(pickup.getTime() - pickup.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  };
  const minPickup = getMinPickupDate();
  const minDelivery = getMinDeliveryDate();

  // --- CONFIRMATION HANDLERS ---
  const executePendingAction = async () => {
      if (!pendingAction) return;
      if (readOnly || previewMode) throw new Error('Cette action se gère depuis le compte client ou la gestion dédiée, en dehors de la consultation.');

      try {
      switch (pendingAction.type) {
          case 'ADD_QUOTE': {
              await onAddQuote(pendingAction.data);
              // Creation is confirmed. Address outcomes are independent and cannot request another quote.
              const addressResults: NonNullable<typeof quoteResult>['addresses'] = [];
              
              // Sauvegarder les adresses si cochées
              if (saveOriginAddress && newRequest.originAddress && newRequest.originCity) {
                  const status = await handleSaveNewAddress('pickup', {
                      address: newRequest.originAddress,
                      city: newRequest.originCity,
                      contactName: newRequest.originContactName,
                      contactPhone: newRequest.originContactPhone
                  }, originLabel);
                  addressResults.push({ label: 'Adresse d’enlèvement', status });
              }
              if (saveDestAddress && newRequest.destinationAddress && newRequest.destinationCity) {
                  const status = await handleSaveNewAddress('delivery', {
                      address: newRequest.destinationAddress,
                      city: newRequest.destinationCity,
                      contactName: newRequest.destContactName,
                      contactPhone: newRequest.destContactPhone
                  }, destLabel);
                  addressResults.push({ label: 'Adresse de livraison', status });
              }
              
              setQuoteResult({ reference: pendingAction.data.id, addresses: addressResults });
              setIsModalOpen(false);
              setNewRequest({
                  originAddress: _origin.street, originCity: _origin.city, originContactName: currentUser.companyName || '', originContactPhone: currentUser.companyPhone || '',
                  destinationAddress: '', destinationCity: '', destContactName: '', destContactPhone: '',
                  goodsDescription: '', weight: '', length: '', width: '', height: '', volume: 0,
                  pickupDate: '', deliveryDate: '', clientNotes: ''
              });
              // Reset les checkboxes
              setSaveOriginAddress(false);
              setSaveDestAddress(false);
              setOriginLabel('');
              setDestLabel('');
              setSelectedOriginLabel(null);
              setSelectedDestLabel(null);
              setSelectedSlot(null);
              break;
          }
          case 'ADD_MEMBER':
              if (onAddTeamMember) {
                  await onAddTeamMember(pendingAction.data);
                  setIsTeamModalOpen(false);
                  setMemberForm({ firstName: '', lastName: '', email: '' });
                  
                  // Créer l'invitation avec token et envoyer l'email
                  try {
                    const { token, expiresAt } = await createInvitation(
                      pendingAction.data.email,
                      pendingAction.data.id,
                      {
                        id: currentUser.id,
                        name: `${currentUser.firstName} ${currentUser.lastName}`
                      }
                    );
                    
                    const activationUrl = getActivationUrl(token);
                    
                    const sent = await sendUserInvitationEmail(
                      {
                        email: pendingAction.data.email,
                        firstName: pendingAction.data.firstName,
                        lastName: pendingAction.data.lastName,
                        role: pendingAction.data.role || 'Client'
                      },
                      {
                        firstName: currentUser.firstName,
                        lastName: currentUser.lastName
                      },
                      activationUrl,
                      expiresAt
                    );
                    if (!sent) throw new Error('Email non envoyé.');
                    notifySuccess(`Invitation envoyée à ${pendingAction.data.email}.`);
                    setTeamMessages(messages => ({ ...messages, [pendingAction.data.id]: 'Invitation envoyée. Le lien d’activation est valable 7 jours.' }));
                  } catch (emailError) {
                    console.error('Erreur envoi email invitation:', emailError);
                    setTeamMessages(messages => ({ ...messages, [pendingAction.data.id]: 'Collaborateur ajouté, mais email non envoyé. Utilisez Renvoyer l’invitation sur cette fiche.' }));
                    notifyWarning('Collaborateur ajouté, mais email non envoyé. Vous pouvez renvoyer l’invitation depuis sa fiche.');
                  }
              }
              break;
          case 'UPDATE_MEMBER':
              if (onUpdateTeamMember) {
                  await onUpdateTeamMember(pendingAction.data);
                  setIsTeamModalOpen(false);
                  setEditingMember(null);
                  setMemberForm({ firstName: '', lastName: '', email: '' });
              }
              break;
          case 'DELETE_MEMBER':
              if (onDeleteTeamMember) {
                  await onDeleteTeamMember(pendingAction.data.id);
              }
              break;
          case 'ACCEPT_OFFER':
              await onUpdateQuoteStatus(pendingAction.data.id, QuoteStatus.ACCEPTED);
              break;
          case 'REJECT_OFFER':
              await onUpdateQuoteStatus(pendingAction.data.id, QuoteStatus.REJECTED);
              break;
      }
      setIsConfirmModalOpen(false);
      setPendingAction(null);
      } catch (error) {
        throw error; // ConfirmModal keeps the failure visible and the pending payload available.
      }
  };

  // --- SUBMITS (TRIGGER CONFIRMATION) ---
  const handleQuoteSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (readOnly || previewMode) return;
      setQuoteError('');
      if (!newRequest.originCity || !newRequest.destinationCity || !newRequest.goodsDescription || newRequest.volume <= 0) {
          setQuoteError('Renseignez les villes de départ et d’arrivée, la description et les dimensions du chargement.');
          return;
      }

      const request: QuoteRequest = {
          id: `q-${Date.now()}`,
          clientId: currentUser.id,
          clientName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`,
          requesterId: currentUser.id,
          requesterName: `${currentUser.firstName} ${currentUser.lastName}`,
          date: new Date().toISOString(),
          origin: newRequest.originCity,
          originAddress: newRequest.originAddress,
          originContact: { name: newRequest.originContactName, phone: newRequest.originContactPhone },
          destination: newRequest.destinationCity,
          destinationAddress: newRequest.destinationAddress,
          destinationContact: { name: newRequest.destContactName, phone: newRequest.destContactPhone },
          goodsDescription: newRequest.goodsDescription,
          weight: Number(newRequest.weight) || 0,
          dimensions: { length: Number(newRequest.length), width: Number(newRequest.width), height: Number(newRequest.height) },
          volume: newRequest.volume,
          pickupDate: newRequest.pickupDate,
          deliveryDate: newRequest.deliveryDate,
          clientNotes: newRequest.clientNotes,
          status: QuoteStatus.REQUESTED,
          // Créneau de livraison choisi
          deliverySlotId: selectedSlot?.id,
          deliveryTimeWindow: selectedSlot ? {
            start: selectedSlot.start,
            end: selectedSlot.end,
            label: selectedSlot.label
          } : undefined
      };

      setPendingAction({ type: 'ADD_QUOTE', data: request });
      setIsConfirmModalOpen(true);
  };

  const handleTeamMemberSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      
      // Normaliser l'email (lowercase, trim)
      const normalizedEmail = memberForm.email.toLowerCase().trim();
      
      if (editingMember) {
          const updatedUser: User = {
              ...editingMember,
              firstName: memberForm.firstName,
              lastName: memberForm.lastName,
              email: normalizedEmail
          };
          setPendingAction({ type: 'UPDATE_MEMBER', data: updatedUser });
      } else {
          const newUser: User = {
              id: `u-${Date.now()}`,
              firstName: memberForm.firstName,
              lastName: memberForm.lastName,
              email: normalizedEmail,
              role: UserRole.CLIENT,
              companyName: currentUser.companyName!,
              leaveBalance: 0,
              avatarUrl: `https://ui-avatars.com/api/?name=${memberForm.firstName}+${memberForm.lastName}&background=random`
          };
          setPendingAction({ type: 'ADD_MEMBER', data: newUser });
      }
      setIsConfirmModalOpen(true);
  };

  const openAddMemberModal = () => {
      setEditingMember(null);
      setMemberForm({ firstName: '', lastName: '', email: '' });
      setIsTeamModalOpen(true);
  };

  const openEditMemberModal = (user: User) => {
      setEditingMember(user);
      setMemberForm({ firstName: user.firstName, lastName: user.lastName, email: user.email });
      setIsTeamModalOpen(true);
  };

  const confirmDeleteMember = (user: User) => {
      setPendingAction({ type: 'DELETE_MEMBER', data: user });
      setIsConfirmModalOpen(true);
  };

  // Charger la POD d'un devis converti en colis
  const handleViewPOD = async (quote: QuoteRequest) => {
    if (!quote.convertedToPackageId) return;
    setLoadingPOD(quote.id);
    setPodMessages(messages => ({ ...messages, [quote.id]: '' }));
    try {
      const pod = await getPODByPackage(quote.convertedToPackageId);
      if (pod) {
        setViewingPOD({ pod, quote });
      } else {
        setPodMessages(messages => ({ ...messages, [quote.id]: 'La preuve de livraison n’est pas encore disponible. Réessayez après confirmation par le chauffeur.' }));
        notifyInfo('Preuve de livraison en attente de disponibilité.');
      }
    } catch (e) {
      setPodMessages(messages => ({ ...messages, [quote.id]: 'Impossible de charger la preuve. Vérifiez votre connexion puis réessayez.' }));
    }
    setLoadingPOD(null);
  };

  const confirmStatusChange = (id: string, status: QuoteStatus) => {
      if (status === QuoteStatus.ACCEPTED) {
          setPendingAction({ type: 'ACCEPT_OFFER', data: { id } });
      } else {
          setPendingAction({ type: 'REJECT_OFFER', data: { id } });
      }
      setIsConfirmModalOpen(true);
  };

  // FAQ DATA
  const faqItems = [
      { question: "Comment suivre ma livraison en temps réel ?", answer: "Une fois votre commande validée, vous recevrez un lien de tracking. Vous pouvez aussi consulter la section 'Mes expéditions' pour voir le statut." },
      { question: "Quels sont les délais de paiement ?", answer: "Pour les clients en compte, les factures sont émises en fin de mois avec un délai de règlement à 30 jours." },
      { question: "Comment modifier une demande en cours ?", answer: "Tant que l'offre n'est pas acceptée, vous pouvez contacter notre service support pour modifier les détails. Si validée, appelez-nous d'urgence." },
      { question: "Proposez-vous une assurance Ad Valorem ?", answer: "Oui, tous nos transports incluent une assurance standard. Une assurance Ad Valorem peut être ajoutée sur demande lors du devis." }
  ];

  const getStatusBadge = (status: QuoteStatus) => {
      switch(status) {
          case QuoteStatus.REQUESTED: return <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 border border-slate-200"><Clock size={12} /> En traitement</span>;
          case QuoteStatus.OFFER_SENT: return <span className="bg-blue-50 text-blue-800 px-3 py-1 rounded-md text-sm font-semibold flex items-center gap-1"><Euro size={12} /> Offre disponible</span>;
          case QuoteStatus.ACCEPTED: return <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 border border-emerald-200"><CheckCircle size={12} /> Validé</span>;
          case QuoteStatus.REJECTED: return <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 border border-red-100"><XCircle size={12} /> Refusé</span>;
      }
  };

  return (
    <ClientAccessContext.Provider value={access}>
    <div className="space-y-4 animate-fade-in pb-10 min-w-0">
        {quoteResult && <div role={quoteResult.addresses.some(address => address.status === 'unconfirmed') ? 'alert' : 'status'} className={`ui-notice ${quoteResult.addresses.some(address => address.status === 'unconfirmed') ? 'ui-notice-warning' : 'ui-notice-success'}`}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">Demande de devis enregistrée</p><p className="text-sm break-words">Référence : {quoteResult.reference}</p></div><button type="button" onClick={() => setQuoteResult(null)} className="ui-button ui-button-ghost shrink-0" aria-label="Fermer le bilan du devis"><X size={18} aria-hidden="true" /></button></div>
            {quoteResult.addresses.length > 0 && <ul className="mt-2 space-y-1">{quoteResult.addresses.map(address => <li key={address.label}>{address.label} : {address.status === 'saved' ? 'ajout au carnet confirmé.' : address.status === 'existing' ? 'déjà présente dans le carnet.' : 'ajout au carnet non confirmé.'}</li>)}</ul>}
            {quoteResult.addresses.some(address => address.status === 'unconfirmed') && <><p className="mt-2">Le devis est enregistré. Ne le recréez pas pour compléter le carnet. Vérifiez les destinataires avant tout nouvel ajout.</p>{onNavigate && <button type="button" onClick={() => onNavigate('client_recipients')} className="ui-button ui-button-secondary mt-2">Vérifier mon carnet</button>}</>}
        </div>}

        
        {previewMode && (activeView === 'client_company' || activeView === 'client_list') && <p className="text-sm text-slate-700">Les devis et l’équipe se gèrent depuis les écrans de gestion dédiés. Le mot de passe reste réservé au titulaire du compte.</p>}
        {packagesError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{packagesError}</p><button type="button" onClick={() => setPackagesRetry(attempt => attempt + 1)} className="ui-button ui-button-secondary mt-2 min-h-11 border">Réessayer le chargement des colis</button></div>}
        {isLoadingPackages && activeView !== 'client_shipments' && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">Chargement de vos colis…</p>}


        {!previewMode && <p className="flex items-start gap-2 text-sm text-slate-600"><Building2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" /><span className="break-words min-w-0">{currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`}</span></p>}

        {/* --- NOTIFICATION BANNER --- */}
        {pendingOffersCount > 0 && (
            <div className="ui-notice ui-notice-info flex items-start gap-3">
                <div className="flex items-center gap-4">
                    <div className="bg-white/20 p-2.5 rounded-full backdrop-blur-sm">
                        <Bell size={24} aria-hidden="true" />
                    </div>
                    <div>
                        <p className="font-bold text-lg leading-tight">Action requise</p>
                        <p className="text-sm">Vous avez reçu {pendingOffersCount} nouvelle{pendingOffersCount > 1 ? 's' : ''} offre{pendingOffersCount > 1 ? 's' : ''} à valider.</p>
                    </div>
                </div>
            </div>
        )}

        {/* --- VIEW: DASHBOARD --- */}
        {activeView === 'client_dashboard' && (
          <div className="space-y-6">
            {/* Accueil guidé — "Que voulez-vous faire ?" (simple pour tous) */}
            <div>
              <PageHeader title={`Bonjour ${currentUser.firstName}`} description="Que voulez-vous faire ?" className="mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { icon: Plus, label: 'Créer une expédition', hint: 'Créer les colis à collecter',  writes: true, onClick: () => setShowCreateShipment(true) },
                  { icon: Search, label: 'Suivre mes colis', hint: 'Où sont mes envois ?',  onClick: () => onNavigate?.('client_shipments') },
                  { icon: Navigation, label: 'Suivi des livraisons', hint: 'Dernières positions reçues',  onClick: () => onNavigate?.('client_tracking') },
                  { icon: BarChart3, label: 'Mes statistiques', hint: 'Résultats et tendances',  onClick: () => onNavigate?.('client_analytics') },
                  { icon: UserPlus, label: 'Mes destinataires', hint: 'Ajouter, modifier, importer',  onClick: () => onNavigate?.('client_recipients') },
                  { icon: Building2, label: 'Mon entreprise', hint: 'Infos société + équipe',  onClick: () => onNavigate?.('client_company') },
                  { icon: UserIcon, label: 'Mon compte', hint: 'Profil & mot de passe',  onClick: () => setShowAccountHub(true) },
                ].map((a, i) => (
                  <button
                    key={i}
                    disabled={readOnly && a.writes}
                    onClick={a.onClick}
                    className={`ui-button ${i === 0 ? 'ui-button-primary' : 'ui-button-secondary'} !justify-start !text-left !p-4 gap-3`}
                  >
                    <span className="flex items-center justify-center">
                      <a.icon size={22} />
                    </span>
                    <span className="min-w-0"><span className="block font-semibold leading-tight">{a.label}</span><span className="block text-sm font-normal mt-1">{a.hint}</span></span>
                  </button>
                ))}
              </div>
              {!previewMode && <button type="button" onClick={() => setIsModalOpen(true)} className="ui-button ui-button-secondary mt-4"><FileText size={18} aria-hidden="true" />Demander un devis</button>}
            </div>

            {/* Check-list de démarrage (masquée une fois tout fait) */}
            {(() => {
              const step1 = companyInfoComplete;
              const step2 = savedAddresses.length > 0;
              const step3 = clientPackages.length > 0;
              if (readOnly || isLoadingPackages || packagesError || (step1 && step2 && step3)) return null;
              const steps = [
                { done: step1, label: 'Complétez votre entreprise', hint: 'Raison sociale + adresse (pour vos BL)', action: () => onNavigate?.('client_company'), cta: 'Compléter' },
                { done: step2, label: 'Importez vos destinataires', hint: 'Une fois, puis choix en un clic', action: () => setShowImportRecipients(true), cta: 'Importer' },
                { done: step3, label: 'Créez votre 1ʳᵉ expédition', hint: 'Formulaire + étiquette', action: () => setShowCreateShipment(true), cta: 'Créer' },
              ];
              return (
                <div className="ui-panel p-4 sm:p-5">
                  <h3 className="font-bold text-brand-900 mb-3">Pour bien démarrer</h3>
                  <div className="space-y-2">
                    {steps.map((s, i) => (
                      <div key={i} className={`flex items-center gap-3 bg-white rounded-xl p-3 ${s.done ? 'opacity-70' : ''}`}>
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${s.done ? 'bg-green-500 text-white' : 'bg-indigo-100 text-brand-700'}`}>
                          {s.done ? <CheckCircle size={16} /> : i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-bold ${s.done ? 'text-slate-600 line-through' : 'text-slate-800'}`}>{s.label}</p>
                          <p className="text-sm text-slate-600">{s.hint}</p>
                        </div>
                        {!s.done && (
                          <button onClick={s.action} className="ui-button ui-button-secondary text-sm shrink-0">
                            {s.cta}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* --- VIEW: MON ENTREPRISE (identité expéditeur + équipe) --- */}
        {activeView === 'client_company' && (
          <div className="space-y-4">
            <PageHeader title="Mon entreprise" description="Identité de l’expéditeur et accès de votre équipe." />
            {/* Mon entreprise (identité expéditeur pour les BL) */}
            <div id="mon-entreprise" className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-sm ${companyInfoComplete ? 'border-slate-200' : 'border-amber-300'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={18} className="text-brand-600" />
                <h3 className="font-bold text-slate-800">Mon entreprise (expéditeur)</h3>
              </div>
              {!companyInfoComplete && (
                <div className="mb-3 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>Raison sociale et adresse sont <b>obligatoires</b> : elles figurent sur chaque bon de livraison. Complétez-les.</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${formFieldId}-companyName`} className="text-sm font-medium text-slate-600 mb-1 block">Raison sociale *</label>
                  <input
                    type="text"
                    id={`${formFieldId}-companyName`} value={companyForm.companyName}
                    readOnly title="Le nom de société est géré par votre responsable."
                    onChange={(e) => setCompanyForm(f => ({ ...f, companyName: e.target.value }))}
                    placeholder="Ex : PREM BPA"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none min-h-11"
                  />
                </div>
                <div>
                  <label htmlFor={`${formFieldId}-companyPhone`} className="text-sm font-medium text-slate-600 mb-1 block">Téléphone</label>
                  <input
                    type="tel"
                    disabled={readOnly} id={`${formFieldId}-companyPhone`} value={companyForm.companyPhone}
                    onChange={(e) => setCompanyForm(f => ({ ...f, companyPhone: e.target.value }))}
                    placeholder="0262 00 00 00"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none min-h-11"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`${formFieldId}-companyAddress`} className="text-sm font-medium text-slate-600 mb-1 block">Adresse complète *</label>
                  <input
                    type="text"
                    disabled={readOnly} id={`${formFieldId}-companyAddress`} value={companyForm.companyAddress}
                    onChange={(e) => setCompanyForm(f => ({ ...f, companyAddress: e.target.value }))}
                    placeholder="12 rue des Lilas, 97400 Saint-Denis"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none min-h-11"
                  />
                </div>
                <div>
                  <label htmlFor={`${formFieldId}-companySiret`} className="text-sm font-medium text-slate-600 mb-1 block">SIRET</label>
                  <input
                    type="text"
                    disabled={readOnly} id={`${formFieldId}-companySiret`} value={companyForm.companySiret}
                    onChange={(e) => setCompanyForm(f => ({ ...f, companySiret: e.target.value }))}
                    placeholder="123 456 789 00012"
                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none min-h-11"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleSaveCompany}
                    disabled={readOnly || savingCompany || !companyForm.companyName.trim() || !companyForm.companyAddress.trim()}
                    className="ui-button ui-button-primary w-full sm:w-auto text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {savingCompany ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </div>
              {companySaveMsg && <p className="text-sm font-medium text-slate-600 mt-2">{companySaveMsg}</p>}
            </div>
          </div>
        )}

        {/* --- VIEW: TEAM MANAGEMENT (dans Mon entreprise) --- */}
        {(activeView === 'client_team' || activeView === 'client_company') && (
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-t border-slate-200 pt-5">
                    <div>
                        <h3 className="text-xl font-bold text-brand-900">Mon équipe logistique</h3>
                        <p className="text-brand-700 mt-1">Invitez des collaborateurs pour qu'ils puissent gérer les demandes en toute autonomie.</p>
                    </div>
                    {!(previewMode || !onAddTeamMember) && (<button
                         onClick={openAddMemberModal}
                        className="ui-button ui-button-secondary flex items-center gap-2"
                    >
                        <UserPlus size={18} /> Ajouter un collaborateur
                    </button>)}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Current User Card */}
                    <div className="bg-white p-6 rounded-2xl shadow-md border border-indigo-200 relative overflow-hidden ring-2 ring-indigo-50">
                        <div className="absolute top-0 right-0 bg-indigo-600 text-white text-sm px-3 py-1 rounded-bl-xl font-bold">Administrateur principal</div>
                        <div className="flex items-center gap-4 mb-4">
                            <img src={currentUser.avatarUrl} className="w-16 h-16 rounded-full border-4 border-indigo-50" alt="Me" />
                            <div>
                                <h4 className="font-bold text-slate-900 text-lg">{currentUser.firstName} {currentUser.lastName}</h4>
                                <p className="text-slate-600 text-sm">{currentUser.email}</p>
                            </div>
                        </div>
                        <div className="bg-green-50 p-3 rounded-xl text-center text-green-700 text-sm font-bold flex items-center justify-center gap-2">
                            <CheckCircle size={16} />
                            Compte actif
                        </div>
                    </div>

                    {/* Team Members */}
                    {companyUsers.filter(u => u.id !== currentUser.id).map(user => {
                        // Déterminer le statut du collaborateur
                        const getCollaboratorStatus = () => {
                            if (user.isDisabled) {
                                return {
                                    label: 'Suspendu',
                                    color: 'bg-red-50 text-red-600 border-red-200',
                                    icon: <XCircle size={14} />,
                                    tooltip: 'Ce compte a été suspendu. L\'utilisateur ne peut plus se connecter.'
                                };
                            }
                            if (user.activatedAt) {
                                return {
                                    label: 'Actif',
                                    color: 'bg-green-50 text-green-600 border-green-200',
                                    icon: <CheckCircle size={14} />,
                                    tooltip: 'Ce collaborateur a activé son compte et peut accéder à l\'application.'
                                };
                            }
                            return {
                                label: 'En attente',
                                color: 'bg-orange-50 text-orange-600 border-orange-200',
                                icon: <Clock size={14} />,
                                tooltip: 'L\'invitation a été envoyée mais le collaborateur n\'a pas encore activé son compte.'
                            };
                        };
                        
                        const status = getCollaboratorStatus();
                        
                        return (
                        <div key={user.id} className={`bg-white p-6 rounded-2xl shadow-sm border hover:shadow-md transition-all group relative ${
                            user.isDisabled ? 'border-red-200 opacity-75' : 'border-slate-200'
                        }`}>
                            {/* Badge de statut en haut à gauche */}
                            <div className="absolute top-4 left-4">
                                <div 
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-bold border cursor-help ${status.color}`}
                                    title={status.tooltip}
                                >
                                    {status.icon}
                                    {status.label}
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-4 mb-4 mt-8">
                                <div className="relative">
                                    <img src={user.avatarUrl} className={`w-16 h-16 rounded-full border-2 ${
                                        user.isDisabled ? 'border-red-200 grayscale' : 
                                        user.activatedAt ? 'border-green-200' : 'border-orange-200'
                                    }`} alt={user.firstName} />
                                    {/* Indicateur visuel sur l'avatar */}
                                    <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center ${
                                        user.isDisabled ? 'bg-red-500' : 
                                        user.activatedAt ? 'bg-green-500' : 'bg-orange-500'
                                    }`}>
                                        {user.isDisabled ? <XCircle size={10} className="text-white" /> : 
                                         user.activatedAt ? <CheckCircle size={10} className="text-white" /> : 
                                         <Clock size={10} className="text-white" />}
                                    </div>
                                </div>
                                <div>
                                    <h4 className={`font-bold text-lg ${user.isDisabled ? 'text-slate-600' : 'text-slate-900'}`}>
                                        {user.firstName} {user.lastName}
                                    </h4>
                                    <p className="text-slate-600 text-sm flex items-center gap-1"><Mail size={12}/> {user.email}</p>
                                    <span className="inline-block mt-2 text-sm bg-slate-100 text-slate-600 px-2 py-1 rounded font-medium">
                                        Collaborateur
                                    </span>
                                </div>
                            </div>
                            
                            {/* Message d'info selon le statut */}
                            {!previewMode && !user.activatedAt && !user.isDisabled && (
                                <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100">
                                    <p className="text-sm text-orange-700 flex items-start gap-2">
                                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                        <span>Ce collaborateur n'a pas encore activé son compte. Vous pouvez lui renvoyer une invitation.</span>
                                    </p>
                                </div>
                            )}
                            
                            {user.isDisabled && (
                                <div className="mb-4 p-3 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-sm text-red-700 flex items-start gap-2">
                                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                        <span>Ce compte a été suspendu par un administrateur.</span>
                                    </p>
                                </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
                                {!(previewMode || !onUpdateTeamMember) && (<button
                                     onClick={() => openEditMemberModal(user)}
                                    className="ui-button ui-button-secondary flex items-center justify-center gap-2 text-sm"
                                >
                                    <Edit size={14} /> Modifier
                                </button>)}
                                {!(previewMode || !onDeleteTeamMember) && (<button
                                     onClick={() => confirmDeleteMember(user)}
                                    className="ui-button ui-button-ghost flex items-center justify-center gap-2 text-sm"
                                >
                                    <Trash2 size={14} /> Supprimer
                                </button>)}
                            </div>
                            
                            {teamMessages[user.id] && <p role="status" className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-800">{teamMessages[user.id]}</p>}
                            {/* Bouton Renvoyer invitation - visible seulement si pas encore activé */}
                            {!previewMode && !user.activatedAt && !user.isDisabled && (
                                <button 
                                    disabled={sendingInvitation !== null}
                                    onClick={async () => {
                                      if (sendingInvitation || previewMode) return;
                                      setSendingInvitation(user.id);
                                      setTeamMessages(messages => ({ ...messages, [user.id]: '' }));
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
                                          const sent = await sendUserInvitationEmail(
                                            { email: user.email, firstName: user.firstName, lastName: user.lastName, role: 'Client' },
                                            { firstName: currentUser.firstName, lastName: currentUser.lastName },
                                            activationUrl,
                                            result.expiresAt
                                          );
                                          if (!sent) throw new Error('Email non envoyé.');
                                          notifySuccess(`Invitation renvoyée à ${user.email}.`);
                                          setTeamMessages(messages => ({ ...messages, [user.id]: 'Invitation renvoyée. Le lien d’activation est valable 7 jours.' }));
                                        } else {
                                          setTeamMessages(messages => ({ ...messages, [user.id]: 'L’invitation n’a pas pu être renouvelée. Réessayez depuis cette fiche.' }));
                                        }
                                      } catch (e) {
                                        setTeamMessages(messages => ({ ...messages, [user.id]: 'Email non envoyé. Vérifiez l’adresse puis réessayez.' }));
                                      } finally { setSendingInvitation(null); }
                                    }}
                                    className="ui-button ui-button-ghost w-full mt-3 text-sm flex items-center justify-center gap-2"
                                >
                                    <Send size={14} /> Renvoyer l'invitation
                                </button>
                            )}
                        </div>
                    )})}
                    
                    {/* Add Button Card */}
                    {!(previewMode || !onAddTeamMember) && (<button
                         onClick={openAddMemberModal}
                        className="ui-button ui-button-secondary border-2 border-dashed flex flex-col items-center justify-center h-full min-h-[200px]"
                    >
                        <div className="bg-white p-4 rounded-full shadow-sm mb-3">
                            <Plus size={24} />
                        </div>
                        <span className="font-bold">Ajouter un membre</span>
                    </button>)}
                </div>
            </div>
        )}

        {/* --- VIEW: LIST (MES EXPEDITIONS) --- */}
        {activeView === 'client_list' && (
            <div className="space-y-4">
                <PageHeader title="Mes devis" description="Offres à valider et demandes de transport." actions={!previewMode && <button type="button" onClick={() => setIsModalOpen(true)} className="ui-button ui-button-primary"><Plus size={18} aria-hidden="true" />Demander un devis</button>} />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les devis">
                    <button type="button" onClick={() => setListFilter('active')} aria-pressed={listFilter === 'active'} className="ui-filter">En cours ({activeQuotes.length})</button>
                    <button type="button" onClick={() => setListFilter('history')} aria-pressed={listFilter === 'history'} className="ui-filter">Historique ({historyQuotes.length})</button>
                </div>

                <div className="grid grid-cols-1 gap-5">
                    {displayQuotes.map((quote) => (
                        <div 
                            key={quote.id} 
                            className={`bg-white rounded-2xl border transition-all duration-200 ${
                                quote.status === QuoteStatus.OFFER_SENT 
                                ? 'border-blue-300 shadow-md ring-1 ring-blue-100' 
                                : 'border-slate-200 shadow-sm hover:shadow-md'
                            }`}
                        >
                            <div className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200">
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className={`p-3 rounded-xl flex-shrink-0 ${quote.status === QuoteStatus.OFFER_SENT ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
                                        <Package size={24} />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-semibold text-slate-900 text-lg break-words">{quote.goodsDescription}</h3>
                                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 break-words">
                                            <span>Réf: {quote.id}</span>
                                            {/* DISPLAY REQUESTER IF DIFFERENT */}
                                            {quote.requesterId && quote.requesterId !== currentUser.id && (
                                                <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 flex items-center gap-1">
                                                    <UserIcon size={10} /> Demandé par : {quote.requesterName}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {getStatusBadge(quote.status)}
                            </div>

                            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-5">
                                <div className="space-y-1">
                                    <p className="text-sm text-slate-600 font-semibold mb-2 flex items-center gap-1"><MapPin size={12}/> Trajet</p>
                                    <div className="flex flex-wrap items-center gap-3 text-sm">
                                        <span className="font-bold text-slate-800">{quote.origin}</span>
                                        <ArrowRight size={16} className="text-slate-300" />
                                        <span className="font-bold text-slate-800">{quote.destination}</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-slate-600 font-semibold mb-2 flex items-center gap-1"><Calendar size={12}/> Départ souhaité</p>
                                    <p className="font-bold text-slate-800 text-sm">
                                        {new Date(quote.pickupDate).toLocaleDateString()} 
                                        <span className="text-slate-600 font-normal ml-2">à {new Date(quote.pickupDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-slate-600 font-semibold mb-2 flex items-center gap-1"><Box size={12}/> Chargement</p>
                                    <p className="font-bold text-slate-800 text-sm">
                                        {quote.volume.toFixed(2)} m3 
                                        <span className="text-slate-300 mx-2">|</span>
                                        {formatWeight(quote.weight) || '-'}
                                    </p>
                                </div>
                            </div>

                            {/* CLIENT NOTES */}
                            {quote.clientNotes && (
                                <div className="px-6 pb-4">
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
                                        <StickyNote size={16} className="text-yellow-600 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-bold text-yellow-800  mb-1">Vos instructions spéciales</p>
                                            <p className="text-sm text-yellow-900">{quote.clientNotes}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Action Footer */}
                            {quote.status === QuoteStatus.OFFER_SENT && (
                                <div className="px-6 py-4 bg-blue-50/50 border-t border-blue-100 flex flex-col md:flex-row justify-between items-center gap-4 rounded-b-2xl">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-white p-2 rounded-full shadow-sm text-blue-600 border border-blue-100">
                                            <Euro size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm text-blue-600 font-bold ">Offre reçue</p>
                                            <p className="text-2xl font-extrabold text-slate-900">{formatEuro(quote.priceOffer ?? 0)} <span className="text-sm font-medium text-slate-600">HT</span></p>
                                        </div>
                                    </div>
                                    
                                    {quote.adminNotes && (
                                        <div className="hidden md:block flex-1 mx-6 px-4 py-2 bg-white rounded-lg border border-blue-100 text-sm text-slate-600 italic">
                                            " {quote.adminNotes} "
                                        </div>
                                    )}

                                    <div className="flex gap-3 w-full md:w-auto">
                                        {!(previewMode) && (<button
                                             onClick={() => confirmStatusChange(quote.id, QuoteStatus.REJECTED)}
                                            className="ui-button ui-button-secondary flex-1 md:flex-none border text-sm"
                                        >
                                            Refuser
                                        </button>)}
                                        {!(previewMode) && (<button
                                             onClick={() => confirmStatusChange(quote.id, QuoteStatus.ACCEPTED)}
                                            className="ui-button ui-button-primary flex-1 md:flex-none flex items-center justify-center gap-2 text-sm"
                                        >
                                            <CheckCircle size={16} /> Accepter l'offre
                                        </button>)}
                                    </div>
                                </div>
                            )}

                            {podMessages[quote.id] && <p role="status" className="mx-4 my-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-800">{podMessages[quote.id]}</p>}
                            {/* Footer devis ACCEPTÉ — Bouton Étiquette */}
                            {quote.status === QuoteStatus.ACCEPTED && (
                                <div className="px-6 py-4 bg-emerald-50/50 border-t border-emerald-100 flex flex-col md:flex-row justify-between items-center gap-4 rounded-b-2xl">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-white p-2 rounded-full shadow-sm text-emerald-600 border border-emerald-100">
                                            <CheckCircle size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm text-emerald-600 font-bold ">Commande validée</p>
                                            <p className="text-sm text-slate-600">
                                                {formatEuro(quote.priceOffer ?? 0)} HT
                                                {quote.convertedToPackageId && (
                                                    <span className="ml-2 text-sm text-emerald-500">Colis créé</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setLabelData(quoteToLabelData(quote))}
                                            className="ui-button ui-button-primary flex items-center gap-2 text-sm"
                                        >
                                            <Printer size={14} />
                                            Étiquette
                                        </button>
                                        {quote.convertedToPackageId && (
                                            <button
                                                onClick={() => handleViewPOD(quote)}
                                                disabled={loadingPOD === quote.id}
                                                className="ui-button ui-button-primary flex items-center gap-2 text-sm disabled:opacity-50"
                                            >
                                                {loadingPOD === quote.id ? (
                                                    <Clock size={14} className="animate-spin" />
                                                ) : (
                                                    <FileText size={14} />
                                                )}
                                                Preuve de livraison
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {displayQuotes.length === 0 && (
                        <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                            <div className="bg-white p-4 rounded-full shadow-sm inline-block mb-3">
                                <Package className="text-slate-300" size={32} />
                            </div>
                            <p className="text-slate-600 font-medium">Aucune demande dans cette section.</p>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* --- VIEW: STATISTIQUES (Studio Analytique) --- */}
        {activeView === 'client_analytics' && !isLoadingPackages && !packagesError && (
            <ClientAnalytics packages={clientPackages} />
        )}

        {/* --- VIEW: SUIVI LIVE (livreurs de mes colis en cours) --- */}
        {activeView === 'client_tracking' && !isLoadingPackages && !packagesError && (
            <ClientLiveTracking packages={clientPackages} currentUser={currentUser} />
        )}

        {/* --- VIEW: AIDE (guide + FAQ, onglet) --- */}
        {activeView === 'client_help' && (
            <ClientHelp embedded onNavigate={handleHelpNavigate} onClose={() => onNavigate?.('client_dashboard')} />
        )}

        {/* --- VIEW: MES DESTINATAIRES (carnet, CRUD) --- */}
        {activeView === 'client_recipients' && (
            <RecipientsManager
                addresses={savedAddresses}
                packageCounts={recipientPackageCounts}
                onCreate={handleCreateRecipient}
                onUpdate={handleUpdateRecipient}
                onDelete={handleDeleteRecipient}
                onImport={() => setShowImportRecipients(true)}
            />
        )}

        {/* --- VIEW: MES EXPÉDITIONS (Tracking + Étiquettes) --- */}
        {activeView === 'client_shipments' && (
            <div className="space-y-4 animate-fade-in">
                <PageHeader title="Mes expéditions" description={isLoadingPackages ? 'Chargement du nombre de colis…' : packagesError ? 'Nombre de colis indisponible' : `${clientPackages.length} colis au total`} actions={
                    <button type="button" disabled={readOnly} onClick={() => setShowCreateShipment(true)} className="ui-button ui-button-primary"><Plus size={18} aria-hidden="true" />Créer une expédition</button>
                } />
                <div className="space-y-3" aria-label="Rechercher et filtrer mes colis">
                    <div className="relative">
                        <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                        <input type="search" aria-label="Rechercher dans mes colis" value={shipmentSearch} onChange={event => setShipmentSearch(event.target.value)} placeholder="Code, destinataire ou adresse" className="w-full min-h-11 pl-10 pr-3 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-700 outline-none" />
                    </div>
                    {(() => {
                        const filters = [
                            { label: 'Tous', count: clientPackages.length, filter: 'all' as const },
                            { label: 'En attente', count: clientPackages.filter(p => p.status === PackageStatus.PENDING).length, filter: 'pending' as const },
                            { label: 'En transit', count: clientPackages.filter(p => [PackageStatus.COLLECTED, PackageStatus.AT_HUB, PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED, PackageStatus.IN_DELIVERY].includes(p.status)).length, filter: 'transit' as const },
                            { label: 'Livrés', count: clientPackages.filter(p => p.status === PackageStatus.DELIVERED).length, filter: 'delivered' as const },
                            { label: 'Échecs / retours', count: clientPackages.filter(p => [PackageStatus.FAILED, PackageStatus.RETURNED, PackageStatus.RETURN_REQUESTED].includes(p.status)).length, filter: 'failed' as const },
                        ];
                        return <>
                            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700 sm:hidden">Statut<select aria-label="Filtrer mes colis par statut" value={shipmentFilter} disabled={isLoadingPackages || Boolean(packagesError)} onChange={event => setShipmentFilter(event.target.value as typeof shipmentFilter)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 bg-white text-base">{filters.map(filter => <option key={filter.filter} value={filter.filter}>{filter.label} ({isLoadingPackages || packagesError ? '—' : filter.count})</option>)}</select></label>
                            <div className="hidden sm:flex flex-wrap items-center gap-2" role="group" aria-label="Filtrer par statut"><span className="text-sm font-semibold text-slate-700 mr-1">Statut</span>{filters.map(filter => <button type="button" key={filter.filter} disabled={isLoadingPackages || Boolean(packagesError)} aria-pressed={shipmentFilter === filter.filter} onClick={() => setShipmentFilter(filter.filter)} className="ui-filter">{filter.label} <span>({isLoadingPackages || packagesError ? '—' : filter.count})</span></button>)}</div>
                        </>;
                    })()}
                    <details className="text-sm text-slate-700">
                        <summary className="min-h-11 cursor-pointer py-3 font-semibold">Imports et étiquettes</summary>
                        <div className="flex flex-wrap gap-2 py-2">
                            <button type="button" disabled={readOnly} onClick={() => setShowImportRecipients(true)} className="ui-button ui-button-secondary"><UserPlus size={18} aria-hidden="true" />Importer des destinataires</button>
                            <button type="button" disabled={readOnly} onClick={() => setShowImportShipments(true)} className="ui-button ui-button-secondary"><FileSpreadsheet size={18} aria-hidden="true" />Importer des expéditions</button>
                            <button type="button" disabled={isLoadingPackages || Boolean(packagesError) || !clientPackages.some(p => p.status === PackageStatus.PENDING)} onClick={() => printShipmentLabels(clientPackages.filter(p => p.status === PackageStatus.PENDING))} className="ui-button ui-button-secondary"><Printer size={18} aria-hidden="true" />Étiquettes en attente ({isLoadingPackages || packagesError ? '—' : clientPackages.filter(p => p.status === PackageStatus.PENDING).length})</button>
                            {selectedLabels.size > 0 && <button type="button" onClick={() => { const selected = clientPackages.filter(p => selectedLabels.has(p.id)); if (selected.length) printShipmentLabels(selected); }} className="ui-button ui-button-secondary"><Printer size={18} aria-hidden="true" />Imprimer {selectedLabels.size} étiquette{selectedLabels.size > 1 ? 's' : ''}</button>}
                        </div>
                    </details>
                </div>
                {labelPrintError && <p role="alert" className="ui-notice ui-notice-danger">{labelPrintError}</p>}

                {/* Liste des colis */}
{expandedShipmentId && <div role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 flex flex-wrap justify-between gap-3 text-sm text-brand-900">
                      <p>{packagesError ? 'Le colis demandé ne peut pas être vérifié tant que le chargement a échoué.' : isLoadingPackages ? 'Chargement du colis demandé…' : clientPackages.some(parcel => parcel.id === expandedShipmentId) ? 'Colis ouvert depuis un lien. Les filtres précédents sont temporairement ignorés.' : 'Ce colis est indisponible dans votre compte ou n’existe plus.'}</p>
                      <button type="button" onClick={() => updateUrlParams({ package: null, clientSearch: null, clientStatus: null })} className="ui-button ui-button-ghost underline min-h-11">Afficher tous mes colis</button>
                    </div>}
                                {(() => {
                    const filtered = clientPackages.filter(p => {
                        if (expandedShipmentId) return p.id === expandedShipmentId;
                        // Filtre statut
                        if (shipmentFilter === 'pending' && p.status !== PackageStatus.PENDING) return false;
                        if (shipmentFilter === 'transit' && ![PackageStatus.COLLECTED, PackageStatus.AT_HUB, PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED, PackageStatus.IN_DELIVERY].includes(p.status)) return false;
                        if (shipmentFilter === 'delivered' && p.status !== PackageStatus.DELIVERED) return false;
                        if (shipmentFilter === 'failed' && p.status !== PackageStatus.FAILED && p.status !== PackageStatus.RETURNED && p.status !== PackageStatus.RETURN_REQUESTED) return false;
                        // Filtre recherche
                        if (shipmentSearch) {
                            const term = shipmentSearch.toLowerCase();
                            return (
                                (p.externalId || '').toLowerCase().includes(term) ||
                                (p.barcode || '').toLowerCase().includes(term) ||
                                p.orderNumber.toLowerCase().includes(term) ||
                                p.contactName.toLowerCase().includes(term) ||
                                p.address.toLowerCase().includes(term) ||
                                p.city.toLowerCase().includes(term)
                            );
                        }
                        return true;
                    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

                    // Exposer pour le bouton "Toutes les étiquettes"

                    return (
                        <div className="ui-panel overflow-hidden">
                            {/* En-tête : une ligne par PHARMACIE (point de livraison), dépliable */}
                            <div className="px-4 py-3 border-b border-slate-200 text-sm text-slate-600">
                                Colis regroupés par destinataire
                            </div>

                            {/* Lignes — regroupées par jour puis par pharmacie */}
                            <div className="divide-y divide-slate-200">
                                {(() => {
                                    // Regroupement par JOUR puis par PHARMACIE (point de livraison, cf. address.ts)
                                    const pointKey = (p: PackageType) => placeKey(p);
                                    const dayOf = (p: PackageType) => new Date(p.createdAt).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
                                    const dayMap = new Map<string, Map<string, PackageType[]>>();
                                    for (const p of filtered) {
                                        const d = dayOf(p);
                                        if (!dayMap.has(d)) dayMap.set(d, new Map());
                                        const pm = dayMap.get(d)!;
                                        const k = pointKey(p);
                                        if (!pm.has(k)) pm.set(k, []);
                                        pm.get(k)!.push(p);
                                    }
                                    const summaryStatus = (pkgs: PackageType[]) => {
                                        if (pkgs.some(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED)) return PackageStatus.FAILED;
                                        if (pkgs.some(p => p.status === PackageStatus.IN_DELIVERY)) return PackageStatus.IN_DELIVERY;
                                        if (pkgs.every(p => p.status === PackageStatus.DELIVERED)) return PackageStatus.DELIVERED;
                                        if (pkgs.some(p => [PackageStatus.COLLECTED,PackageStatus.AT_HUB,PackageStatus.SORTED,PackageStatus.IN_TRANSIT,PackageStatus.LOADED].includes(p.status))) return PackageStatus.IN_TRANSIT;
                                        return pkgs[0].status;
                                    };
                                    return Array.from(dayMap.entries()).map(([day, pointsMap]) => {
                                        const dayCount = Array.from(pointsMap.values()).reduce((acc: number, arr) => acc + arr.length, 0);
                                        return (
                                        <React.Fragment key={day}>
                                            <div className="px-4 py-3 bg-slate-50 flex flex-wrap items-center justify-between gap-1">
                                                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Calendar size={16} aria-hidden="true" />{day}</p>
                                                <span className="text-sm text-slate-600">{dayCount} colis · {pointsMap.size} destinataire{pointsMap.size > 1 ? 's' : ''}</span>
                                            </div>
                                            {Array.from(pointsMap.entries()).map(([key, pkgs]) => {
                                                const rep = pkgs[0];
                                                const groupId = day + '||' + key;
                                                const open = expandedGroupId === groupId || pkgs.some(parcel => parcel.id === expandedShipmentId);
                                                const sStatus = summaryStatus(pkgs);
                                                const sColors = PACKAGE_STATUS_COLORS[sStatus] || { bg:'bg-slate-100', text:'text-slate-700' };
                                                const delivered = pkgs.filter(p => p.status === PackageStatus.DELIVERED).length;
                                                const etaPkg = pkgs.find(p => p.status === PackageStatus.IN_DELIVERY && p.estimatedDeliveryAt);
                                                return (
                                                <React.Fragment key={groupId}>
                                                    <div data-client-shipment-group className="p-4 space-y-3 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
                                                        <div className="min-w-0 flex-1 space-y-1">
                                                            <p className="text-base font-semibold text-slate-900 break-words">{rep.contactName}</p>
                                                            <p className="text-sm text-slate-600 break-words">{rep.address} · {rep.postalCode} {rep.city}</p>
                                                            <p className="flex flex-wrap items-center gap-2 pt-1 text-sm"><span className={`inline-flex rounded-md px-2 py-1 font-semibold ${sColors.bg} ${sColors.text}`} title={STATUS_TOOLTIP[sStatus]}>{delivered === pkgs.length ? (pkgs.length > 1 ? 'Tous livrés' : 'Livré') : delivered > 0 ? `${delivered}/${pkgs.length} livrés` : packageStatusLabel(sStatus)}</span><span className="text-slate-600">{pkgs.length} colis</span></p>
                                                            {etaPkg && (() => { const eta=new Date(etaPkg.estimatedDeliveryAt!); if(isNaN(eta.getTime()))return null; const today=eta.toDateString()===new Date().toDateString(); const hhmm=eta.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); return <p className="text-sm text-slate-700 flex items-start gap-2 pt-1"><Clock size={16} aria-hidden="true" className="shrink-0 mt-0.5" />Estimation d’arrivée {today?`vers ${hhmm}`:`le ${eta.toLocaleDateString('fr-FR')} vers ${hhmm}`}</p>; })()}
                                                        </div>
                                                        <button type="button" aria-label={open ? 'Masquer les colis du destinataire' : 'Afficher les colis du destinataire'} aria-expanded={open} onClick={() => { if (open && pkgs.some(parcel => parcel.id === expandedShipmentId)) setExpandedShipmentId(null); setExpandedGroupId(open ? null : groupId); }} className="ui-button ui-button-secondary shrink-0">{open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}{open ? 'Masquer les colis' : 'Voir les colis'}</button>
                                                    </div>
                                                    {open && (
                                                        <div className="border-t border-slate-200 divide-y divide-slate-200">
                                                            <div className="px-4 py-3 flex flex-wrap gap-2 bg-slate-50">
                                                                <button type="button" aria-label="Imprimer les étiquettes du destinataire" onClick={() => printShipmentLabels(pkgs)} className="ui-button ui-button-secondary"><Printer size={18} aria-hidden="true" />Étiquettes du destinataire</button>
                                                                <button type="button" aria-label="Ouvrir le bon de livraison du destinataire" onClick={() => openDeliveryNote(rep as PackageType, clientPackages, { companyName: companyForm.companyName || currentUser?.companyName || rep.clientName, address: companyForm.companyAddress || undefined, siret: companyForm.companySiret || undefined, phone: companyForm.companyPhone || undefined, email: currentUser?.email })} className="ui-button ui-button-secondary"><FileText size={18} aria-hidden="true" />Bon de livraison</button>
                                                            </div>
                                                            {pkgs.map(pkg => {
                                                                const sc = PACKAGE_STATUS_COLORS[pkg.status] || { bg:'bg-slate-100', text:'text-slate-700' };
                                                                const tOpen = expandedShipmentId === pkg.id;
                                                                return (
                                                                <div key={pkg.id} className="p-4 space-y-3">
                                                                    <div className="space-y-3 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
                                                                        <div className="min-w-0 flex-1 space-y-2">
                                                                            <p><span className={`inline-flex px-2 py-1 rounded-md text-sm font-semibold ${sc.bg} ${sc.text}`} title={STATUS_TOOLTIP[pkg.status]}>{packageStatusLabel(pkg.status)}</span></p>
                                                                            <ShipmentReference reference={pkg.externalId || pkg.barcode || pkg.orderNumber} />
                                                                            <p className="text-sm text-slate-600 break-words">Commande : {pkg.orderNumber}{pkg.clientReference ? ` · Votre référence : ${pkg.clientReference}` : ''}</p>
                                                                            {pkg.requestedDeliveryDate && pkg.status !== PackageStatus.DELIVERED && <p className="text-sm text-slate-700">Créneau demandé : {new Date(pkg.requestedDeliveryDate + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>}
                                                                        </div>
                                                                        <div className="flex flex-wrap gap-2 sm:max-w-64 sm:justify-end">
                                                                            <button type="button" aria-label={tOpen ? 'Masquer le suivi du colis' : 'Afficher le suivi du colis'} aria-expanded={tOpen} onClick={() => setExpandedShipmentId(tOpen ? null : pkg.id)} className="ui-button ui-button-secondary">{tOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}{tOpen ? 'Masquer le suivi' : 'Voir le suivi'}</button>
                                                                            <button type="button" aria-label={`Imprimer l’étiquette du colis ${pkg.externalId || pkg.orderNumber}`} onClick={() => printShipmentLabels([pkg])} className="ui-button ui-button-ghost"><Printer size={18} aria-hidden="true" />Étiquette</button>
                                                                            {pkg.status === PackageStatus.DELIVERED && pkg.pod && <button type="button" onClick={() => setViewingPOD({ pod: pkg.pod!, quote: { id: pkg.id, clientName: pkg.clientName, destination: pkg.city, destinationAddress: pkg.address, destinationContact: { name: pkg.contactName } } as any })} className="ui-button ui-button-ghost"><Eye size={18} aria-hidden="true" />Preuve de livraison</button>}
                                                                        </div>
                                                                    </div>
                                                                    {tOpen && (
                                                                        <div className="mt-2">
                                                                            <PackageTimeline movements={pkg.movements || []} showActors pod={pkg.pod} />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </React.Fragment>
                                                );
                                            })}
                                        </React.Fragment>
                                        );
                                    });
                                })()}

                                {isLoadingPackages && filtered.length === 0 && (
                                    <div role="status" className="text-center py-16">
                                        <div className="inline-block w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3" />
                                        <p className="text-slate-600 font-medium">Chargement de vos expéditions…</p>
                                    </div>
                                )}

                                {!isLoadingPackages && !packagesError && filtered.length === 0 && (
                                    <div className="text-center py-16">
                                        <Package className="mx-auto text-slate-300 mb-3" size={40} />
                                        <p className="text-slate-600 font-bold">
                                            {shipmentSearch || shipmentFilter !== 'all' ? 'Aucun colis ne correspond à ces filtres' : 'Vous n’avez pas encore de colis'}
                                        </p>
                                        <p className="text-sm text-slate-600 mt-1 mb-4">
                                            {shipmentSearch || shipmentFilter !== 'all' ? 'Modifiez la recherche ou effacez les filtres.' : 'Créez votre première expédition en un clic.'}
                                        </p>
                                        {(shipmentSearch || shipmentFilter !== 'all') && <button type="button" onClick={() => updateUrlParams({ clientSearch: null, clientStatus: null, package: null })} className="ui-button ui-button-secondary min-h-11 border">Effacer les filtres</button>}
                                        {!shipmentSearch && shipmentFilter === 'all' && (
                                            <button
                                                disabled={readOnly} onClick={() => setShowCreateShipment(true)}
                                                className="ui-button ui-button-primary inline-flex items-center gap-2 text-sm"
                                            >
                                                <Plus size={16} /> Créer une expédition
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            {filtered.length > 0 && (
                                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-sm text-slate-600">
                                    <span>{filtered.length} colis affiché{filtered.length > 1 ? 's' : ''}</span>
                                    {selectedLabels.size > 0 && (
                                        <span className="font-bold text-brand-600">{selectedLabels.size} sélectionnée{selectedLabels.size > 1 ? 's' : ''}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        )}

        {activeView === 'help' && <ClientHelp embedded onNavigate={handleHelpNavigate} onClose={() => onNavigate?.('client_dashboard')} />}

        {/* --- MODAL NEW REQUEST --- */}
        <Modal mobileFullscreen
            isOpen={!previewMode && isModalOpen}
            onClose={() => setIsModalOpen(false)}
            dirty={newRequest.originAddress !== _origin.street || newRequest.originCity !== _origin.city || newRequest.originContactName !== (currentUser.companyName || '') || newRequest.originContactPhone !== (currentUser.companyPhone || '') || Object.entries(newRequest).some(([key, value]) => !['originAddress', 'originCity', 'originContactName', 'originContactPhone', 'volume'].includes(key) && Boolean(value)) || saveOriginAddress || saveDestAddress}
            title="Demander un devis"
            footer={<button type="submit" form={`${formFieldId}-quote`} className="ui-button ui-button-primary w-full"><Send size={18} aria-hidden="true" />Envoyer ma demande de devis</button>}
            subtitle={`Demandeur : ${currentUser.firstName} ${currentUser.lastName}`}
            size="3xl"
            headerIcon={<Send size={20} />}
        >
<form id={`${formFieldId}-quote`} onSubmit={handleQuoteSubmit} className="space-y-8">
{quoteError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{quoteError}</p>}
                <p className="text-sm text-slate-600">Cette demande permet de recevoir un prix. Le transport sera confirmé après votre acceptation de l’offre. Pour préparer directement vos colis, utilisez Créer une expédition.</p>
                {/* Toast de feedback pour la sauvegarde d'adresse */}
                {addressSaveMessage && (
                    <div role={addressSaveMessage.startsWith('Erreur') ? 'alert' : 'status'} className={`ui-notice ${addressSaveMessage.startsWith('Erreur') ? 'ui-notice-danger' : addressSaveMessage.startsWith('Cette adresse existe') ? 'ui-notice-warning' : 'ui-notice-success'}`}>
                        <p className="font-medium text-sm">{addressSaveMessage}</p>
                    </div>
                )}
                
                {/* BLOCK 1: TRAJET */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* DÉPART */}
                    <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-brand-600 mb-2">
                            <MapPin size={18} />
                            <h4 className="font-bold text-sm ">Expéditeur (enlèvement)</h4>
                        </div>
                        
                        {/* Sélecteur d'adresse enregistrée */}
                        {savedAddresses.length > 0 && (
                            <AddressAutocomplete
                                savedAddresses={savedAddresses}
                                type="pickup"
                                value={{
                                    address: newRequest.originAddress,
                                    city: newRequest.originCity,
                                    contactName: newRequest.originContactName,
                                    contactPhone: newRequest.originContactPhone
                                }}
                                onChange={(data) => setNewRequest({
                                    ...newRequest,
                                    originAddress: data.address,
                                    originCity: data.city,
                                    originContactName: data.contactName,
                                    originContactPhone: data.contactPhone
                                })}
                                onSelectSaved={(addressId) => {
                                    const addr = savedAddresses.find(a => a.id === addressId);
                                    if (addr) {
                                        setSelectedOriginLabel(addr.label || addr.address);
                                    }
                                    void access.runMutation('Utiliser une adresse du carnet', () => incrementAddressUsage(addressId)).catch(() => notifyWarning('L’utilisation de cette adresse n’a pas pu être mémorisée.'));
                                    setSaveOriginAddress(false);
                                }}
                                selectedLabel={selectedOriginLabel || undefined}
                                onClearSelection={() => {
                                    setSelectedOriginLabel(null);
                                    setNewRequest({
                                        ...newRequest,
                                        originAddress: '',
                                        originCity: '',
                                        originContactName: '',
                                        originContactPhone: ''
                                    });
                                }}
                            />
                        )}
                        
                        <div className="space-y-3">
                            <InputField 
                                icon={MapPin} type="text" required placeholder="Rue et Numéro"
                                value={newRequest.originAddress}
                                onChange={(e: any) => setNewRequest({...newRequest, originAddress: e.target.value})}
                            />
                            <InputField 
                                icon={Building2} type="text" required placeholder="Code Postal et Ville"
                                value={newRequest.originCity}
                                onChange={(e: any) => setNewRequest({...newRequest, originCity: e.target.value})}
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <InputField 
                                    icon={UserIcon} type="text" required placeholder="Contact"
                                    value={newRequest.originContactName}
                                    onChange={(e: any) => setNewRequest({...newRequest, originContactName: e.target.value})}
                                />
                                <InputField 
                                    icon={Phone} type="tel" required placeholder="Tél."
                                    value={newRequest.originContactPhone}
                                    onChange={(e: any) => setNewRequest({...newRequest, originContactPhone: e.target.value})}
                                />
                            </div>
                            
                            {/* Checkbox mémoriser l'adresse */}
                            {newRequest.originAddress && newRequest.originCity && (
                                <label className="flex items-center gap-2 cursor-pointer mt-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                                    <input
                                        type="checkbox"
                                        checked={saveOriginAddress}
                                        onChange={(e) => setSaveOriginAddress(e.target.checked)}
                                        className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                                    />
                                    <Star size={14} className={saveOriginAddress ? 'text-amber-500 fill-amber-500' : 'text-amber-400'} />
                                    <span className="text-sm font-medium text-amber-700">Mémoriser cette adresse</span>
                                </label>
                            )}
                            {saveOriginAddress && (
                                <input
                                    type="text"
                                    placeholder="Nom de l'adresse (ex: Entrepôt principal)"
                                    value={originLabel}
                                    onChange={(e) => setOriginLabel(e.target.value)}
                                    className="w-full px-3 py-2 text-base border border-amber-200 rounded-lg bg-amber-50 focus:ring-2 focus:ring-amber-500 outline-none min-h-11"
                                />
                            )}
                            
                            <div className="pt-2">

                                <InputField 
                                    label="Date d’enlèvement" icon={Calendar} type="datetime-local" required min={minPickup}
                                    value={newRequest.pickupDate}
                                    onChange={(e: any) => setNewRequest({...newRequest, pickupDate: e.target.value})}
                                />
                            </div>
                        </div>
                    </div>

                    {/* ARRIVÉE */}
                    <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-brand-600 mb-2">
                            <MapPin size={18} />
                            <h4 className="font-bold text-sm ">Destinataire (livraison)</h4>
                        </div>
                        
                        {/* Sélecteur d'adresse enregistrée */}
                        {savedAddresses.length > 0 && (
                            <AddressAutocomplete
                                savedAddresses={savedAddresses}
                                type="delivery"
                                value={{
                                    address: newRequest.destinationAddress,
                                    city: newRequest.destinationCity,
                                    contactName: newRequest.destContactName,
                                    contactPhone: newRequest.destContactPhone
                                }}
                                onChange={(data) => setNewRequest({
                                    ...newRequest,
                                    destinationAddress: data.address,
                                    destinationCity: data.city,
                                    destContactName: data.contactName,
                                    destContactPhone: data.contactPhone
                                })}
                                onSelectSaved={(addressId) => {
                                    const addr = savedAddresses.find(a => a.id === addressId);
                                    if (addr) {
                                        setSelectedDestLabel(addr.label || addr.address);
                                    }
                                    void access.runMutation('Utiliser une adresse du carnet', () => incrementAddressUsage(addressId)).catch(() => notifyWarning('L’utilisation de cette adresse n’a pas pu être mémorisée.'));
                                    setSaveDestAddress(false);
                                }}
                                selectedLabel={selectedDestLabel || undefined}
                                onClearSelection={() => {
                                    setSelectedDestLabel(null);
                                    setNewRequest({
                                        ...newRequest,
                                        destinationAddress: '',
                                        destinationCity: '',
                                        destContactName: '',
                                        destContactPhone: ''
                                    });
                                }}
                            />
                        )}
                        
                        <div className="space-y-3">
                            <InputField 
                                icon={MapPin} type="text" required placeholder="Rue et Numéro"
                                value={newRequest.destinationAddress}
                                onChange={(e: any) => setNewRequest({...newRequest, destinationAddress: e.target.value})}
                            />
                            <InputField 
                                icon={Building2} type="text" required placeholder="Code Postal et Ville"
                                value={newRequest.destinationCity}
                                onChange={(e: any) => setNewRequest({...newRequest, destinationCity: e.target.value})}
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <InputField 
                                    icon={UserIcon} type="text" required placeholder="Contact"
                                    value={newRequest.destContactName}
                                    onChange={(e: any) => setNewRequest({...newRequest, destContactName: e.target.value})}
                                />
                                <InputField 
                                    icon={Phone} type="tel" required placeholder="Tél."
                                    value={newRequest.destContactPhone}
                                    onChange={(e: any) => setNewRequest({...newRequest, destContactPhone: e.target.value})}
                                />
                            </div>
                            
                            {/* Checkbox mémoriser l'adresse */}
                            {newRequest.destinationAddress && newRequest.destinationCity && (
                                <label className="flex items-center gap-2 cursor-pointer mt-2 p-2 bg-amber-50 rounded-lg border border-amber-100">
                                    <input
                                        type="checkbox"
                                        checked={saveDestAddress}
                                        onChange={(e) => setSaveDestAddress(e.target.checked)}
                                        className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                                    />
                                    <Star size={14} className={saveDestAddress ? 'text-amber-500 fill-amber-500' : 'text-amber-400'} />
                                    <span className="text-sm font-medium text-amber-700">Mémoriser cette adresse</span>
                                </label>
                            )}
                            {saveDestAddress && (
                                <input
                                    type="text"
                                    placeholder="Nom de l'adresse (ex: Client Carrefour)"
                                    value={destLabel}
                                    onChange={(e) => setDestLabel(e.target.value)}
                                    className="w-full px-3 py-2 text-base border border-amber-200 rounded-lg bg-amber-50 focus:ring-2 focus:ring-amber-500 outline-none min-h-11"
                                />
                            )}
                            
                            <div className="pt-2">

                                <InputField 
                                    label="Date de livraison" icon={Calendar} type="datetime-local" required min={minDelivery} disabled={!newRequest.pickupDate}
                                    value={newRequest.deliveryDate}
                                    onChange={(e: any) => setNewRequest({...newRequest, deliveryDate: e.target.value})}
                                />
                            </div>

                            {/* Créneau de livraison */}
                            {newRequest.deliveryDate && (
                              <div className="pt-2">
                                <label className="block text-sm font-bold text-slate-600 mb-1 ml-1">
                                  Créneau de livraison souhaité
                                  {detectedZone && (
                                    <span className="ml-2 text-brand-500 font-normal">(Zone {detectedZone})</span>
                                  )}
                                </label>
                                {availableSlots.length > 0 ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    {availableSlots.map(slot => (
                                      <button
                                        key={slot.id}
                                        type="button"
                                        onClick={() => setSelectedSlot(selectedSlot?.id === slot.id ? null : slot)}
                                        aria-pressed={selectedSlot?.id === slot.id} className="ui-filter !justify-start"
                                      >
                                        <Clock size={14} className={selectedSlot?.id === slot.id ? 'text-brand-500' : 'text-slate-600'} />
                                        <div className="text-left">
                                          <div className="font-bold text-sm">{slot.label}</div>
                                          <div className="text-sm opacity-70">{slot.start} — {slot.end}</div>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                ) : detectedZone ? (
                                  <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                                    Aucun créneau disponible pour cette zone/date. Contactez-nous pour un arrangement.
                                  </p>
                                ) : (
                                  <p className="text-sm text-slate-600 px-3 py-2">
                                    Renseignez l'adresse de destination pour voir les créneaux disponibles.
                                  </p>
                                )}
                              </div>
                            )}
                        </div>
                    </div>
                </div>

                            {/* BLOCK 2: MARCHANDISE */}
                            <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 space-y-4">
                                <h4 className="font-bold text-brand-900 flex items-center gap-2">
                                    <Box size={20} className="text-brand-600" /> Détails de la marchandise
                                </h4>
                                
                                <div className="relative">
                                    <FileText className="absolute left-3 top-3 text-slate-600" size={18} />
                                    <textarea 
                                        id={`${formFieldId}-quote-description`} aria-label="Description de la marchandise" required rows={2} placeholder="Description (Ex: 3 Palettes Europe, Matériel fragile...)"
                                        className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl text-base text-slate-900 font-medium focus:ring-2 focus:ring-brand-500 outline-none bg-white placeholder:text-slate-600 min-h-11"
                                        value={newRequest.goodsDescription}
                                        onChange={(e) => setNewRequest({...newRequest, goodsDescription: e.target.value})}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label htmlFor={`${formFieldId}-quote-length`} className="block text-sm font-bold text-slate-600 mb-1">Long. (cm)</label>
                                            <input type="number" min="0" placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base bg-white text-slate-900 font-bold text-center focus:ring-2 focus:ring-brand-500 outline-none min-h-11" id={`${formFieldId}-quote-length`} value={newRequest.length} onChange={(e) => setNewRequest({...newRequest, length: e.target.value})}/>
                                        </div>
                                        <div>
                                            <label htmlFor={`${formFieldId}-quote-width`} className="block text-sm font-bold text-slate-600 mb-1">Larg. (cm)</label>
                                            <input type="number" min="0" placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base bg-white text-slate-900 font-bold text-center focus:ring-2 focus:ring-brand-500 outline-none min-h-11" id={`${formFieldId}-quote-width`} value={newRequest.width} onChange={(e) => setNewRequest({...newRequest, width: e.target.value})}/>
                                        </div>
                                        <div>
                                            <label htmlFor={`${formFieldId}-quote-height`} className="block text-sm font-bold text-slate-600 mb-1">Haut. (cm)</label>
                                            <input type="number" min="0" placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-base bg-white text-slate-900 font-bold text-center focus:ring-2 focus:ring-brand-500 outline-none min-h-11" id={`${formFieldId}-quote-height`} value={newRequest.height} onChange={(e) => setNewRequest({...newRequest, height: e.target.value})}/>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="flex-1 bg-white rounded-xl border border-indigo-100 flex flex-col justify-center items-center p-2 shadow-sm">
                                            <span className="text-sm  font-bold text-brand-400">Volume</span>
                                            <span className="font-extrabold text-xl text-brand-700">{newRequest.volume} <span className="text-sm">m³</span></span>
                                        </div>
                                        <div className="flex-1">
                                            <label htmlFor={`${formFieldId}-quote-weight`} className="block text-sm font-bold text-slate-600 mb-1">Poids (kg)</label>
                                            <div className="relative">
                                                <Weight className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" size={16} />
                                                <input 
                                                    type="number" min="0" required placeholder="0"
                                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-base bg-white text-slate-900 font-bold focus:ring-2 focus:ring-brand-500 outline-none min-h-11"
                                                    id={`${formFieldId}-quote-weight`} value={newRequest.weight}
                                                    onChange={(e) => setNewRequest({...newRequest, weight: e.target.value})}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* BLOCK 3: NOTES */}
                            <div className="bg-yellow-50/50 p-6 rounded-2xl border border-yellow-200 space-y-4">
                                <h4 className="font-bold text-yellow-800 flex items-center gap-2">
                                    <StickyNote size={20} className="text-yellow-600" /> Consignes de transport
                                </h4>
                                <div className="relative">
                                    <textarea 
                                        id={`${formFieldId}-quote-notes`} aria-label="Consignes de transport" rows={2} placeholder="Ex: Besoin d'un hayon, code portail 1234, appeler 30min avant..."
                                        className="w-full px-4 py-3 border border-yellow-300 rounded-xl text-base text-slate-900 font-medium focus:ring-2 focus:ring-yellow-500 outline-none bg-white placeholder:text-slate-600 min-h-11"
                                        value={newRequest.clientNotes}
                                        onChange={(e) => setNewRequest({...newRequest, clientNotes: e.target.value})}
                                    />
                                </div>
                            </div>


            </form>
        </Modal>

        {/* --- MODAL ADD/EDIT TEAM MEMBER --- */}
        <Modal mobileFullscreen
            isOpen={!previewMode && isTeamModalOpen}
            onClose={() => setIsTeamModalOpen(false)}
            title={editingMember ? 'Modifier Collaborateur' : 'Ajouter un Collaborateur'}
            size="md"
            headerIcon={<UserPlus size={20} />}
        >
            <form onSubmit={handleTeamMemberSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Prénom</label>
                    <input 
                        type="text" required
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none min-h-11"
                        value={memberForm.firstName}
                        onChange={(e) => setMemberForm({...memberForm, firstName: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Nom</label>
                    <input 
                        type="text" required
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none min-h-11"
                                value={memberForm.lastName}
                                onChange={(e) => setMemberForm({...memberForm, lastName: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Email professionnel</label>
                            <input 
                                type="email" required
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none min-h-11"
                                value={memberForm.email}
                                readOnly={!!editingMember}
                                title={editingMember ? "Adresse de connexion gérée par votre responsable" : undefined}
                                onChange={(e) => setMemberForm({...memberForm, email: e.target.value})}
                            />
                        </div>
                <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">
                    {editingMember 
                        ? "Mettre à jour les informations de contact. L'utilisateur recevra une notification." 
                        : `Ce collaborateur aura accès uniquement au compte ${currentUser.companyName}. Il pourra créer et gérer les demandes.`}
                </div>
                <button type="submit" className="ui-button ui-button-primary w-full">
                    {editingMember ? 'Enregistrer les modifications' : 'Envoyer l\'invitation'}
                </button>
            </form>
        </Modal>

        {/* --- GLOBAL CONFIRMATION MODAL --- */}
        {pendingAction && (
            <ConfirmModal
                isOpen={!previewMode && isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={executePendingAction}
                title="Confirmer l'action"
                message={
                    pendingAction.type === 'ADD_QUOTE' ? "Vous êtes sur le point d'envoyer une demande de devis. Confirmez-vous ?" :
                    pendingAction.type === 'ACCEPT_OFFER' ? "En acceptant cette offre, vous validez la commande de transport." :
                    pendingAction.type === 'REJECT_OFFER' ? "Êtes-vous sûr de vouloir refuser cette offre ?" :
                    pendingAction.type === 'ADD_MEMBER' ? `Inviter ${pendingAction.data.firstName} ${pendingAction.data.lastName} à rejoindre l'équipe entreprise ?` :
                    pendingAction.type === 'UPDATE_MEMBER' ? `Enregistrer les modifications pour ${pendingAction.data.firstName} ?` :
                    pendingAction.type === 'DELETE_MEMBER' ? `Supprimer définitivement ${pendingAction.data.firstName} ${pendingAction.data.lastName} de l'équipe ?` : ''
                }
                type={pendingAction.type.includes('DELETE') || pendingAction.type.includes('REJECT') ? 'danger' : 'info'}
                confirmLabel="Confirmer"
                cancelLabel="Annuler"
            />
        )}

        {/* ÉTIQUETTE D'EXPÉDITION */}
        {labelData && (
          <ShippingLabel
            data={labelData}
            onClose={() => setLabelData(null)}
            companyName={currentUser.companyName || 'FleetGenius Transport'}
          />
        )}

        {/* CRÉER UNE EXPÉDITION (self-service) */}
        {!readOnly && showCreateShipment && (
          <CreateShipmentModal
            currentUser={currentUser}
            savedAddresses={savedAddresses}
            onClose={() => setShowCreateShipment(false)}
            onCreated={() => { /* la liste se met à jour via l'abonnement temps réel */ }}
            onViewPackages={() => onNavigate?.('client_shipments')}
            onSaveRecipient={handleCreateRecipient}
          />
        )}

        {/* IMPORTER DES EXPÉDITIONS (fichier Excel/CSV, avec contrôle qualité) */}
        {!readOnly && showImportShipments && (
          <ImportShipmentsModal
            currentUser={currentUser}
            onClose={() => setShowImportShipments(false)}
            onViewPackages={() => onNavigate?.('client_shipments')}
            onImported={(count) => {
              setAddressSaveMessage(`Référence${count > 1 ? 's' : ''} confirmée${count > 1 ? 's' : ''} : ${count}. Retrouvez vos envois dans « Mes colis ».`);
              setTimeout(() => setAddressSaveMessage(''), 6000);
            }}
          />
        )}

        {/* IMPORTER LE CARNET DE DESTINATAIRES */}
        {!readOnly && showImportRecipients && (
          <ImportRecipientsModal
            currentUser={currentUser}
            existingAddresses={savedAddresses}
            onViewRecipients={() => onNavigate?.('client_recipients')}
            onClose={() => setShowImportRecipients(false)}
            onDone={(count) => {
              setAddressSaveMessage(`${count} destinataire${count > 1 ? 's' : ''} importé${count > 1 ? 's' : ''} dans votre carnet.`);
              setTimeout(() => setAddressSaveMessage(''), 5000);
            }}
          />
        )}

        {/* MON COMPTE (espace d'administration client) */}
        {showAccountHub && (
          <AccountHub
            currentUser={currentUser}
            companyUsers={companyUsers}
            packages={clientPackages}
            onClose={() => setShowAccountHub(false)}
            onChangePassword={previewMode ? blockedChangePassword : changePassword}
            onSaveCompany={handleSaveCompanyFromHub}
          />
        )}

        {/* PREUVE DE LIVRAISON */}
        {viewingPOD && (
          <PODViewer
            pod={viewingPOD.pod}
            onClose={() => setViewingPOD(null)}
            packageInfo={{
              orderNumber: viewingPOD.quote.id.slice(-8),
              contactName: viewingPOD.quote.destinationContact?.name || 'Destinataire',
              address: viewingPOD.quote.destinationAddress || viewingPOD.quote.destination,
              city: viewingPOD.quote.destination
            }}
            showDriverInfo={false}
          />
        )}
    </div>
    </ClientAccessContext.Provider>
  );
};

export default ClientPortal;
