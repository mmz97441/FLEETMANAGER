
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { QuoteRequest, QuoteStatus, User, UserRole, ViewState, SavedAddress, DeliveryTimeSlot, Zone, ProofOfDelivery, Package as PackageType, PackageStatus, PACKAGE_STATUS_COLORS } from '../types';
import { Package, MapPin, Calendar, Plus, CheckCircle, XCircle, Clock, Truck, Euro, Send, X, ArrowRight, User as UserIcon, Phone, Box, Info, Bell, FileText, Weight, Building2, StickyNote, BarChart3, Users, Mail, UserPlus, AlertTriangle, PieChart as PieChartIcon, Edit, Trash2, HelpCircle, PhoneCall, FileQuestion, BookOpen, ChevronDown, ChevronUp, Bookmark, Star, Printer, Search, Download, QrCode, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';
import PackageTimeline from './PackageTimeline';
import { sendUserInvitationEmail } from '../services/emailService';
import { createInvitation, getActivationUrl, resendInvitation } from '../services/invitationService';
import { subscribeToSavedAddresses, addSavedAddress, incrementAddressUsage } from '../services/firestore';
import { getDeliveryScheduleConfig, getAvailableSlotsForZone, estimateZoneFromAddress } from '../services/deliveryService';
import { getPODByPackage } from '../services/podService';
import { subscribeToPackages } from '../services/missionService';
import { generateBatchLabelsHTML } from '../services/pickupService';
import ShippingLabel, { quoteToLabelData, ShippingLabelData } from './ShippingLabel';
import PODViewer from './PODViewer';
import ClientKPIs from './ClientKPIs';

// ============================================================================
// COMPOSANT InputField DÉFINI EN DEHORS pour éviter le bug de focus
// ============================================================================
const InputField = ({ icon: Icon, ...props }: any) => (
    <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon size={18} />
        </div>
        <input 
            {...props}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-400 shadow-sm"
        />
    </div>
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
                className={`w-full mb-3 px-4 py-2.5 border rounded-xl text-sm font-medium flex items-center justify-between gap-2 transition-colors ${
                    selectedLabel 
                        ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-700' 
                        : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'
                }`}
            >
                <span className="flex items-center gap-2 truncate">
                    {selectedLabel ? (
                        <>
                            <CheckCircle size={16} className="flex-shrink-0" />
                            <span className="truncate">{selectedLabel}</span>
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
                            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Rechercher une adresse..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
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
                                    className="w-full px-4 py-3 text-left hover:bg-indigo-50 border-b border-slate-50 last:border-0 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                {addr.isFavorite && <Star size={14} className="text-amber-500 fill-amber-500 flex-shrink-0" />}
                                                <span className="font-bold text-slate-800 text-sm truncate">
                                                    {addr.label || addr.address}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                                                {addr.address}, {addr.city}
                                            </p>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                {addr.contactName} • {addr.contactPhone}
                                            </p>
                                        </div>
                                        <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
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
                            <div className="px-4 py-6 text-center text-slate-400 text-sm">
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
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];

const ClientPortal: React.FC<ClientPortalProps> = ({ activeView, currentUser, quotes, companyUsers = [], onNavigate, onAddQuote, onUpdateQuoteStatus, onAddTeamMember, onUpdateTeamMember, onDeleteTeamMember }) => {
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
  const [newRequest, setNewRequest] = useState({
      originAddress: '', originCity: '', originContactName: '', originContactPhone: '',
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

  // === MES EXPÉDITIONS (colis du client) ===
  const [clientPackages, setClientPackages] = useState<PackageType[]>([]);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [shipmentFilter, setShipmentFilter] = useState<'all' | 'pending' | 'transit' | 'delivered' | 'failed'>('all');
  const [expandedShipmentId, setExpandedShipmentId] = useState<string | null>(null); // timeline dépliée
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());

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

  // Charger les colis du client (pour "Mes Expéditions")
  useEffect(() => {
    if (!currentUser?.id) return;
    // Un colis appartient au client si son clientId = l'identifiant du compte
    // (valeur stockée à l'import) OU si son clientName = la société du client
    // (couvre les comptes d'équipe d'une même société). L'ancien filtre par
    // companyName seul ne matchait jamais les colis (stockés par identifiant)
    // → le client ne voyait plus rien.
    const company = (currentUser.companyName || '').trim().toLowerCase();
    const unsub = subscribeToPackages((pkgs) => {
      const mine = pkgs.filter(p =>
        p.clientId === currentUser.id ||
        (!!company && (p.clientName || '').trim().toLowerCase() === company)
      );
      setClientPackages(mine);
    });
    return unsub;
  }, [currentUser.id, currentUser.companyName]);

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
  ): Promise<boolean> => {
    if (!currentUser.companyName) return false;
    
    // Vérifier si l'adresse existe déjà (même adresse + ville)
    const exists = savedAddresses.some(addr => 
      addr.address.toLowerCase().trim() === data.address.toLowerCase().trim() &&
      addr.city.toLowerCase().trim() === data.city.toLowerCase().trim()
    );
    
    if (exists) {
      setAddressSaveMessage('⚠️ Cette adresse existe déjà dans votre carnet');
      setTimeout(() => setAddressSaveMessage(null), 3000);
      return false;
    }
    
    try {
      await addSavedAddress({
        companyName: currentUser.companyName,
        createdBy: currentUser.id,
        label: label || `${type === 'pickup' ? 'Enlèvement' : 'Livraison'} - ${data.city}`,
        type,
        address: data.address,
        city: data.city,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      setAddressSaveMessage('✅ Adresse enregistrée dans votre carnet');
      setTimeout(() => setAddressSaveMessage(null), 3000);
      return true;
    } catch (error) {
      console.error('❌ Erreur sauvegarde adresse:', error);
      setAddressSaveMessage('❌ Erreur lors de la sauvegarde');
      setTimeout(() => setAddressSaveMessage(null), 3000);
      return false;
    }
  };

  // --- DATA PREPARATION ---
  const myQuotes = useMemo(() => {
      const companyUserIds = companyUsers.map(u => u.id);
      if (!companyUserIds.includes(currentUser.id)) companyUserIds.push(currentUser.id);

      return quotes.filter(q => companyUserIds.includes(q.clientId) || q.clientName === currentUser.companyName)
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
      return now.toISOString().slice(0, 16);
  };
  const getMinDeliveryDate = () => {
      if (!newRequest.pickupDate) return '';
      const pickup = new Date(newRequest.pickupDate);
      pickup.setHours(pickup.getHours() + 3);
      if (pickup.getHours() >= 17) {
          pickup.setDate(pickup.getDate() + 1);
          pickup.setHours(8, 0, 0, 0);
      }
      return pickup.toISOString().slice(0, 16);
  };
  const minPickup = getMinPickupDate();
  const minDelivery = getMinDeliveryDate();

  // --- CONFIRMATION HANDLERS ---
  const executePendingAction = async () => {
      if (!pendingAction) return;

      switch (pendingAction.type) {
          case 'ADD_QUOTE':
              onAddQuote(pendingAction.data);
              
              // 💾 Sauvegarder les adresses si cochées
              if (saveOriginAddress && newRequest.originAddress && newRequest.originCity) {
                  await handleSaveNewAddress('pickup', {
                      address: newRequest.originAddress,
                      city: newRequest.originCity,
                      contactName: newRequest.originContactName,
                      contactPhone: newRequest.originContactPhone
                  }, originLabel);
              }
              if (saveDestAddress && newRequest.destinationAddress && newRequest.destinationCity) {
                  await handleSaveNewAddress('delivery', {
                      address: newRequest.destinationAddress,
                      city: newRequest.destinationCity,
                      contactName: newRequest.destContactName,
                      contactPhone: newRequest.destContactPhone
                  }, destLabel);
              }
              
              setIsModalOpen(false);
              setNewRequest({
                  originAddress: '', originCity: '', originContactName: '', originContactPhone: '',
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
          case 'ADD_MEMBER':
              if (onAddTeamMember) {
                  onAddTeamMember(pendingAction.data);
                  setIsTeamModalOpen(false);
                  setMemberForm({ firstName: '', lastName: '', email: '' });
                  
                  // 📧 Créer l'invitation avec token et envoyer l'email
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
                    
                    await sendUserInvitationEmail(
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
                    alert(`✅ Un email d'invitation a été envoyé à ${pendingAction.data.email}`);
                  } catch (emailError) {
                    console.error('❌ Erreur envoi email invitation:', emailError);
                    alert(`⚠️ Le compte a été créé mais l'email n'a pas pu être envoyé. Veuillez renvoyer l'invitation.`);
                  }
              }
              break;
          case 'UPDATE_MEMBER':
              if (onUpdateTeamMember) {
                  onUpdateTeamMember(pendingAction.data);
                  setIsTeamModalOpen(false);
                  setEditingMember(null);
                  setMemberForm({ firstName: '', lastName: '', email: '' });
              }
              break;
          case 'DELETE_MEMBER':
              if (onDeleteTeamMember) {
                  onDeleteTeamMember(pendingAction.data.id);
              }
              break;
          case 'ACCEPT_OFFER':
              onUpdateQuoteStatus(pendingAction.data.id, QuoteStatus.ACCEPTED);
              break;
          case 'REJECT_OFFER':
              onUpdateQuoteStatus(pendingAction.data.id, QuoteStatus.REJECTED);
              break;
      }
      setIsConfirmModalOpen(false);
      setPendingAction(null);
  };

  // --- SUBMITS (TRIGGER CONFIRMATION) ---
  const handleQuoteSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRequest.originCity || !newRequest.destinationCity || !newRequest.goodsDescription || newRequest.volume <= 0) {
          alert("Veuillez remplir les champs obligatoires.");
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
              companyName: currentUser.companyName,
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
    try {
      const pod = await getPODByPackage(quote.convertedToPackageId);
      if (pod) {
        setViewingPOD({ pod, quote });
      } else {
        alert('La preuve de livraison n\'est pas encore disponible.');
      }
    } catch (e) {
      console.error('Erreur chargement POD:', e);
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
      { question: "Comment suivre ma livraison en temps réel ?", answer: "Une fois votre commande validée, vous recevrez un lien de tracking. Vous pouvez aussi consulter la section 'Mes Expéditions' pour voir le statut." },
      { question: "Quels sont les délais de paiement ?", answer: "Pour les clients en compte, les factures sont émises en fin de mois avec un délai de règlement à 30 jours." },
      { question: "Comment modifier une demande en cours ?", answer: "Tant que l'offre n'est pas acceptée, vous pouvez contacter notre service support pour modifier les détails. Si validée, appelez-nous d'urgence." },
      { question: "Proposez-vous une assurance Ad Valorem ?", answer: "Oui, tous nos transports incluent une assurance standard. Une assurance Ad Valorem peut être ajoutée sur demande lors du devis." }
  ];

  const getStatusBadge = (status: QuoteStatus) => {
      switch(status) {
          case QuoteStatus.REQUESTED: return <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-slate-200"><Clock size={12} /> En traitement</span>;
          case QuoteStatus.OFFER_SENT: return <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-md shadow-blue-200 animate-pulse"><Euro size={12} /> Offre Disponible</span>;
          case QuoteStatus.ACCEPTED: return <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-emerald-200"><CheckCircle size={12} /> Validé</span>;
          case QuoteStatus.REJECTED: return <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border border-red-100"><XCircle size={12} /> Refusé</span>;
      }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
        
        {/* --- GLOBAL HEADER (PROFILE CARD - SIMPLIFIED) --- */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-indigo-50 to-transparent skew-x-12 opacity-50 pointer-events-none"></div>
            
            <div className="flex flex-col lg:flex-row justify-between items-center gap-6 relative z-10">
                {/* Identity Section */}
                <div className="flex items-center gap-5 w-full lg:w-auto">
                    <div className="relative flex-shrink-0">
                        <img src={currentUser.avatarUrl} alt="Avatar" className="w-16 h-16 rounded-2xl object-cover shadow-sm border-2 border-white ring-1 ring-indigo-50" />
                        <div className="absolute -bottom-2 -right-2 bg-indigo-600 text-white p-1 rounded-lg border-2 border-white shadow-sm">
                            <Building2 size={14} />
                        </div>
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900 leading-tight">{currentUser.companyName}</h2>
                        <div className="flex flex-wrap items-center gap-3 text-slate-500 text-sm font-medium mt-1">
                            <div className="flex items-center gap-1.5">
                                <UserIcon size={14} className="text-indigo-500" />
                                <span>{currentUser.firstName} {currentUser.lastName}</span>
                            </div>
                            <span className="hidden sm:inline text-slate-300">|</span>
                            <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wide border border-indigo-100">Compte Premium</span>
                        </div>
                    </div>
                </div>

                {/* Quick Action */}
                <div className="flex flex-wrap items-center justify-center gap-3 w-full lg:w-auto">
                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 transform active:scale-95"
                    >
                        <Plus size={18} /> Nouvelle Demande
                    </button>
                </div>
            </div>
        </div>

        {/* --- NOTIFICATION BANNER --- */}
        {pendingOffersCount > 0 && (
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-xl shadow-lg shadow-blue-200 flex items-center justify-between animate-bounce-subtle border border-blue-500/50">
                <div className="flex items-center gap-4">
                    <div className="bg-white/20 p-2.5 rounded-full backdrop-blur-sm">
                        <Bell size={24} className="animate-swing" />
                    </div>
                    <div>
                        <p className="font-bold text-lg leading-tight">Action requise</p>
                        <p className="text-blue-50 text-sm">Vous avez reçu {pendingOffersCount} nouvelle(s) offre(s) à valider.</p>
                    </div>
                </div>
            </div>
        )}

        {/* --- VIEW: DASHBOARD --- */}
        {activeView === 'client_dashboard' && (
            <ClientKPIs
              packages={clientPackages}
              clientName={currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`}
              onDrillDown={(filter) => {
                setShipmentFilter(filter);
                onNavigate?.('client_shipments');
              }}
            />
        )}

        {/* --- VIEW: TEAM MANAGEMENT --- */}
        {activeView === 'client_team' && (
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-indigo-50 p-6 rounded-2xl border border-indigo-100 gap-4">
                    <div>
                        <h3 className="text-xl font-bold text-indigo-900">Mon Équipe Logistique</h3>
                        <p className="text-indigo-700 mt-1">Invitez des collaborateurs pour qu'ils puissent gérer les demandes en toute autonomie.</p>
                    </div>
                    <button 
                        onClick={openAddMemberModal}
                        className="bg-white text-indigo-700 px-5 py-3 rounded-xl font-bold shadow-sm hover:bg-white/80 transition-colors flex items-center gap-2"
                    >
                        <UserPlus size={18} /> Ajouter un collaborateur
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Current User Card */}
                    <div className="bg-white p-6 rounded-2xl shadow-md border border-indigo-200 relative overflow-hidden ring-2 ring-indigo-50">
                        <div className="absolute top-0 right-0 bg-indigo-600 text-white text-xs px-3 py-1 rounded-bl-xl font-bold">Admin Principal</div>
                        <div className="flex items-center gap-4 mb-4">
                            <img src={currentUser.avatarUrl} className="w-16 h-16 rounded-full border-4 border-indigo-50" alt="Me" />
                            <div>
                                <h4 className="font-bold text-slate-900 text-lg">{currentUser.firstName} {currentUser.lastName}</h4>
                                <p className="text-slate-500 text-sm">{currentUser.email}</p>
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
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border cursor-help ${status.color}`}
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
                                    <h4 className={`font-bold text-lg ${user.isDisabled ? 'text-slate-400' : 'text-slate-900'}`}>
                                        {user.firstName} {user.lastName}
                                    </h4>
                                    <p className="text-slate-500 text-sm flex items-center gap-1"><Mail size={12}/> {user.email}</p>
                                    <span className="inline-block mt-2 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded font-medium">
                                        Collaborateur
                                    </span>
                                </div>
                            </div>
                            
                            {/* Message d'info selon le statut */}
                            {!user.activatedAt && !user.isDisabled && (
                                <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100">
                                    <p className="text-xs text-orange-700 flex items-start gap-2">
                                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                        <span>Ce collaborateur n'a pas encore activé son compte. Vous pouvez lui renvoyer une invitation.</span>
                                    </p>
                                </div>
                            )}
                            
                            {user.isDisabled && (
                                <div className="mb-4 p-3 bg-red-50 rounded-xl border border-red-100">
                                    <p className="text-xs text-red-700 flex items-start gap-2">
                                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                        <span>Ce compte a été suspendu par un administrateur.</span>
                                    </p>
                                </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
                                <button 
                                    onClick={() => openEditMemberModal(user)}
                                    className="flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold text-sm transition-colors"
                                >
                                    <Edit size={14} /> Modifier
                                </button>
                                <button 
                                    onClick={() => confirmDeleteMember(user)}
                                    className="flex items-center justify-center gap-2 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm transition-colors"
                                >
                                    <Trash2 size={14} /> Supprimer
                                </button>
                            </div>
                            
                            {/* Bouton Renvoyer invitation - visible seulement si pas encore activé */}
                            {!user.activatedAt && !user.isDisabled && (
                                <button 
                                    onClick={async () => {
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
                                            { email: user.email, firstName: user.firstName, lastName: user.lastName, role: 'Client' },
                                            { firstName: currentUser.firstName, lastName: currentUser.lastName },
                                            activationUrl,
                                            result.expiresAt
                                          );
                                          alert(`✅ Invitation renvoyée à ${user.email}`);
                                        } else {
                                          alert(`❌ Erreur lors du renvoi`);
                                        }
                                      } catch (e) {
                                        alert(`❌ Erreur lors de l'envoi`);
                                      }
                                    }}
                                    className="w-full mt-3 py-2 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-700 font-bold text-sm transition-colors flex items-center justify-center gap-2"
                                >
                                    <Send size={14} /> Renvoyer l'invitation
                                </button>
                            )}
                        </div>
                    )})}
                    
                    {/* Add Button Card */}
                    <button 
                        onClick={openAddMemberModal}
                        className="bg-slate-50 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center p-6 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all h-full min-h-[200px]"
                    >
                        <div className="bg-white p-4 rounded-full shadow-sm mb-3">
                            <Plus size={24} />
                        </div>
                        <span className="font-bold">Ajouter un membre</span>
                    </button>
                </div>
            </div>
        )}

        {/* --- VIEW: LIST (MES EXPEDITIONS) --- */}
        {activeView === 'client_list' && (
            <div className="space-y-6">
                <div className="flex gap-6 border-b border-slate-200 px-2">
                    <button 
                        onClick={() => setListFilter('active')}
                        className={`pb-4 px-2 font-bold text-sm transition-all relative ${listFilter === 'active' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        En cours ({activeQuotes.length})
                        {listFilter === 'active' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full"></div>}
                    </button>
                    <button 
                        onClick={() => setListFilter('history')}
                        className={`pb-4 px-2 font-bold text-sm transition-all relative ${listFilter === 'history' ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        Historique ({historyQuotes.length})
                        {listFilter === 'history' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full"></div>}
                    </button>
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
                            <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-50">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${quote.status === QuoteStatus.OFFER_SENT ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                                        <Package size={24} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-lg">{quote.goodsDescription}</h3>
                                        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
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

                            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8">
                                <div className="space-y-1">
                                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1"><MapPin size={12}/> Trajet</p>
                                    <div className="flex items-center gap-3 text-sm">
                                        <span className="font-bold text-slate-800">{quote.origin}</span>
                                        <ArrowRight size={16} className="text-slate-300" />
                                        <span className="font-bold text-slate-800">{quote.destination}</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1"><Calendar size={12}/> Départ Souhaité</p>
                                    <p className="font-bold text-slate-800 text-sm">
                                        {new Date(quote.pickupDate).toLocaleDateString()} 
                                        <span className="text-slate-400 font-normal ml-2">à {new Date(quote.pickupDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1"><Box size={12}/> Chargement</p>
                                    <p className="font-bold text-slate-800 text-sm">
                                        {quote.volume.toFixed(2)} m3 
                                        <span className="text-slate-300 mx-2">|</span>
                                        {quote.weight ? `${quote.weight} kg` : '-'}
                                    </p>
                                </div>
                            </div>

                            {/* CLIENT NOTES */}
                            {quote.clientNotes && (
                                <div className="px-6 pb-4">
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-3">
                                        <StickyNote size={16} className="text-yellow-600 mt-0.5" />
                                        <div>
                                            <p className="text-xs font-bold text-yellow-800 uppercase mb-1">Vos instructions spéciales</p>
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
                                            <p className="text-xs text-blue-600 font-bold uppercase">Offre reçue</p>
                                            <p className="text-2xl font-extrabold text-slate-900">{quote.priceOffer?.toLocaleString()} € <span className="text-sm font-medium text-slate-500">HT</span></p>
                                        </div>
                                    </div>
                                    
                                    {quote.adminNotes && (
                                        <div className="hidden md:block flex-1 mx-6 px-4 py-2 bg-white rounded-lg border border-blue-100 text-sm text-slate-600 italic">
                                            " {quote.adminNotes} "
                                        </div>
                                    )}

                                    <div className="flex gap-3 w-full md:w-auto">
                                        <button 
                                            onClick={() => confirmStatusChange(quote.id, QuoteStatus.REJECTED)}
                                            className="flex-1 md:flex-none px-5 py-2.5 bg-white border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 rounded-xl font-bold transition-colors text-sm"
                                        >
                                            Refuser
                                        </button>
                                        <button 
                                            onClick={() => confirmStatusChange(quote.id, QuoteStatus.ACCEPTED)}
                                            className="flex-1 md:flex-none px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 text-sm transition-transform active:scale-95"
                                        >
                                            <CheckCircle size={16} /> Accepter l'offre
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Footer devis ACCEPTÉ — Bouton Étiquette */}
                            {quote.status === QuoteStatus.ACCEPTED && (
                                <div className="px-6 py-4 bg-emerald-50/50 border-t border-emerald-100 flex flex-col md:flex-row justify-between items-center gap-4 rounded-b-2xl">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-white p-2 rounded-full shadow-sm text-emerald-600 border border-emerald-100">
                                            <CheckCircle size={20} />
                                        </div>
                                        <div>
                                            <p className="text-xs text-emerald-600 font-bold uppercase">Commande validée</p>
                                            <p className="text-sm text-slate-600">
                                                {quote.priceOffer?.toLocaleString()} € HT
                                                {quote.convertedToPackageId && (
                                                    <span className="ml-2 text-xs text-emerald-500">• Colis créé ✓</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setLabelData(quoteToLabelData(quote))}
                                            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-200 text-sm transition-all active:scale-95"
                                        >
                                            <Printer size={14} />
                                            Étiquette
                                        </button>
                                        {quote.convertedToPackageId && (
                                            <button
                                                onClick={() => handleViewPOD(quote)}
                                                disabled={loadingPOD === quote.id}
                                                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
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
                            <p className="text-slate-500 font-medium">Aucune demande dans cette section.</p>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* --- VIEW: MES EXPÉDITIONS (Tracking + Étiquettes) --- */}
        {activeView === 'client_shipments' && (
            <div className="space-y-6 animate-fade-in">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-700 to-indigo-600 rounded-3xl p-6 text-white shadow-xl">
                    <h2 className="text-2xl font-bold flex items-center gap-3">
                        <QrCode size={28} />
                        Mes Expéditions
                    </h2>
                    <p className="text-blue-100 mt-1">
                        {clientPackages.length} colis au total — Suivez vos envois et téléchargez vos étiquettes
                    </p>
                </div>

                {/* Stats rapides */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { label: 'En attente', count: clientPackages.filter(p => p.status === PackageStatus.PENDING).length, color: 'bg-slate-100 text-slate-700', filter: 'pending' as const },
                        { label: 'En transit', count: clientPackages.filter(p => [PackageStatus.COLLECTED, PackageStatus.AT_HUB, PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED, PackageStatus.IN_DELIVERY].includes(p.status)).length, color: 'bg-blue-100 text-blue-700', filter: 'transit' as const },
                        { label: 'Livrés', count: clientPackages.filter(p => p.status === PackageStatus.DELIVERED).length, color: 'bg-green-100 text-green-700', filter: 'delivered' as const },
                        { label: 'Échecs', count: clientPackages.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length, color: 'bg-red-100 text-red-700', filter: 'failed' as const },
                        { label: 'Tous', count: clientPackages.length, color: 'bg-indigo-100 text-indigo-700', filter: 'all' as const },
                    ].map(s => (
                        <button
                            key={s.filter}
                            onClick={() => setShipmentFilter(s.filter)}
                            className={`p-3 rounded-xl text-center transition-all ${
                                shipmentFilter === s.filter ? `${s.color} ring-2 ring-offset-1 ring-current shadow-md` : 'bg-white border border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <p className="text-2xl font-black">{s.count}</p>
                            <p className="text-[11px] font-medium">{s.label}</p>
                        </button>
                    ))}
                </div>

                {/* Actions : Recherche + Impression lot */}
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={shipmentSearch}
                            onChange={(e) => setShipmentSearch(e.target.value)}
                            placeholder="Rechercher par code, destinataire, adresse..."
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                        />
                    </div>

                    {selectedLabels.size > 0 && (
                        <button
                            onClick={() => {
                                const selected = clientPackages.filter(p => selectedLabels.has(p.id));
                                if (selected.length === 0) return;
                                const html = generateBatchLabelsHTML(selected, 'FleetGenius Transport');
                                const win = window.open('', '_blank');
                                if (win) { win.document.write(html); win.document.close(); }
                            }}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 active:scale-95 transition-transform"
                        >
                            <Printer size={16} />
                            Imprimer {selectedLabels.size} étiquette{selectedLabels.size > 1 ? 's' : ''}
                        </button>
                    )}

                    <button
                        onClick={() => {
                            const pending = clientPackages.filter(p => p.status === PackageStatus.PENDING);
                            if (pending.length === 0) return;
                            const html = generateBatchLabelsHTML(pending as PackageType[], 'FleetGenius Transport');
                            const win = window.open('', '_blank');
                            if (win) { win.document.write(html); win.document.close(); }
                        }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors"
                    >
                        <Download size={16} />
                        Toutes les étiquettes en attente ({clientPackages.filter(p => p.status === PackageStatus.PENDING).length})
                    </button>
                </div>

                {/* Liste des colis */}
                {(() => {
                    const filtered = clientPackages.filter(p => {
                        // Filtre statut
                        if (shipmentFilter === 'pending' && p.status !== PackageStatus.PENDING) return false;
                        if (shipmentFilter === 'transit' && ![PackageStatus.COLLECTED, PackageStatus.AT_HUB, PackageStatus.SORTED, PackageStatus.IN_TRANSIT, PackageStatus.LOADED, PackageStatus.IN_DELIVERY].includes(p.status)) return false;
                        if (shipmentFilter === 'delivered' && p.status !== PackageStatus.DELIVERED) return false;
                        if (shipmentFilter === 'failed' && p.status !== PackageStatus.FAILED && p.status !== PackageStatus.RETURNED) return false;
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
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                            {/* Header tableau */}
                            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                                <div className="col-span-1 flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedLabels.size === filtered.length && filtered.length > 0}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedLabels(new Set(filtered.map(p => p.id)));
                                            else setSelectedLabels(new Set());
                                        }}
                                        className="rounded"
                                    />
                                </div>
                                <div className="col-span-2">Code-barres</div>
                                <div className="col-span-3">Destinataire</div>
                                <div className="col-span-2">Ville</div>
                                <div className="col-span-2">Statut</div>
                                <div className="col-span-2 text-right">Actions</div>
                            </div>

                            {/* Lignes — regroupées par jour d'import */}
                            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                                {filtered.map((pkg, idx) => {
                                    // En-tête de jour quand la date change (liste triée par date décroissante)
                                    const dayOf = (p: PackageType) => new Date(p.createdAt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                                    const day = dayOf(pkg);
                                    const isNewDay = idx === 0 || dayOf(filtered[idx - 1]) !== day;
                                    const dayCount = isNewDay ? filtered.filter(p => dayOf(p) === day).length : 0;
                                    const statusColors = PACKAGE_STATUS_COLORS[pkg.status] || { bg: 'bg-slate-100', text: 'text-slate-700' };
                                    const lastMove = pkg.movements?.[pkg.movements.length - 1];
                                    
                                    const isExpanded = expandedShipmentId === pkg.id;
                                    return (
                                        <React.Fragment key={pkg.id}>
                                        {isNewDay && (
                                            <div className="px-4 py-2 bg-indigo-50/70 border-y border-indigo-100 flex items-center justify-between sticky top-0 z-10">
                                                <p className="text-xs font-bold text-indigo-800 capitalize">📅 {day}</p>
                                                <span className="text-[11px] font-bold text-indigo-500">{dayCount} colis</span>
                                            </div>
                                        )}
                                        <div
                                            onClick={(e) => {
                                                // Ne pas déplier quand on clique sur un bouton/checkbox de la ligne
                                                if ((e.target as HTMLElement).closest('button, input')) return;
                                                setExpandedShipmentId(isExpanded ? null : pkg.id);
                                            }}
                                            className="grid grid-cols-1 md:grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-slate-50 transition-colors cursor-pointer">
                                            {/* Checkbox */}
                                            <div className="hidden md:flex col-span-1 items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLabels.has(pkg.id)}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedLabels);
                                                        e.target.checked ? next.add(pkg.id) : next.delete(pkg.id);
                                                        setSelectedLabels(next);
                                                    }}
                                                    className="rounded"
                                                />
                                            </div>

                                            {/* Code-barres */}
                                            <div className="md:col-span-2">
                                                <p className="font-mono text-xs font-bold text-slate-800">{pkg.externalId || pkg.barcode || pkg.orderNumber}</p>
                                                <p className="text-[10px] text-slate-400">Cmd: {pkg.orderNumber}</p>
                                            </div>

                                            {/* Destinataire */}
                                            <div className="md:col-span-3">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{pkg.contactName}</p>
                                                <p className="text-xs text-slate-500 truncate">{pkg.address}</p>
                                            </div>

                                            {/* Ville */}
                                            <div className="md:col-span-2">
                                                <p className="text-xs font-medium text-slate-600">{pkg.postalCode} {pkg.city}</p>
                                                <p className="text-[10px] text-slate-400">{pkg.zone}</p>
                                            </div>

                                            {/* Statut */}
                                            <div className="md:col-span-2">
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold ${statusColors.bg} ${statusColors.text}`}>
                                                    {pkg.status === PackageStatus.DELIVERED && '✅'}
                                                    {pkg.status === PackageStatus.PENDING && '⏳'}
                                                    {pkg.status === PackageStatus.COLLECTED && '📦'}
                                                    {(pkg.status === PackageStatus.IN_TRANSIT || pkg.status === PackageStatus.IN_DELIVERY) && '🚚'}
                                                    {pkg.status === PackageStatus.FAILED && '❌'}
                                                    {pkg.status}
                                                </span>
                                                {lastMove && (
                                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                                        {new Date(lastMove.timestamp).toLocaleDateString('fr-FR')} {new Date(lastMove.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="md:col-span-2 flex items-center justify-end gap-2">
                                                {/* Imprimer étiquette */}
                                                <button
                                                    onClick={() => {
                                                        const html = generateBatchLabelsHTML([pkg as PackageType], 'FleetGenius Transport');
                                                        const win = window.open('', '_blank');
                                                        if (win) { win.document.write(html); win.document.close(); }
                                                    }}
                                                    title="Imprimer l'étiquette"
                                                    className="p-2 bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 rounded-lg transition-colors"
                                                >
                                                    <QrCode size={14} />
                                                </button>

                                                {/* Voir POD si livré */}
                                                {pkg.status === PackageStatus.DELIVERED && pkg.pod && (
                                                    <button
                                                        onClick={() => setViewingPOD({ pod: pkg.pod!, quote: { id: pkg.id, clientName: pkg.clientName, destination: pkg.city, destinationAddress: pkg.address, destinationContact: { name: pkg.contactName } } as any })}
                                                        title="Preuve de livraison"
                                                        className="p-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg transition-colors"
                                                    >
                                                        <Eye size={14} />
                                                    </button>
                                                )}

                                                {/* Chevron timeline */}
                                                <button
                                                    onClick={() => setExpandedShipmentId(isExpanded ? null : pkg.id)}
                                                    title={isExpanded ? 'Masquer le suivi' : 'Voir le suivi du colis'}
                                                    className="p-2 bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 rounded-lg transition-colors"
                                                >
                                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Timeline du colis (dépliable) */}
                                        {isExpanded && (
                                            <div className="px-6 pb-4 pt-1 bg-slate-50/70 border-t border-slate-100">
                                                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                                                    Suivi du colis {pkg.externalId || pkg.barcode || pkg.orderNumber}
                                                </p>
                                                <PackageTimeline movements={pkg.movements || []} />
                                            </div>
                                        )}
                                        </React.Fragment>
                                    );
                                })}

                                {filtered.length === 0 && (
                                    <div className="text-center py-16">
                                        <Package className="mx-auto text-slate-300 mb-3" size={40} />
                                        <p className="text-slate-500 font-medium">Aucune expédition trouvée</p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            {shipmentSearch ? 'Essayez un autre terme de recherche' : 'Vos colis apparaîtront ici après import'}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            {filtered.length > 0 && (
                                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                                    <span>{filtered.length} expédition{filtered.length > 1 ? 's' : ''}</span>
                                    {selectedLabels.size > 0 && (
                                        <span className="font-bold text-indigo-600">{selectedLabels.size} sélectionnée{selectedLabels.size > 1 ? 's' : ''}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        )}

        {/* --- VIEW: HELP & SUPPORT --- */}
        {activeView === 'help' && (
            <div className="space-y-8 animate-fade-in">
                
                {/* Intro Section */}
                <div className="bg-gradient-to-r from-indigo-700 to-blue-600 rounded-3xl p-8 text-white shadow-xl relative overflow-hidden">
                    <div className="relative z-10 max-w-2xl">
                        <h2 className="text-3xl font-bold mb-3 flex items-center gap-3">
                            <HelpCircle className="text-indigo-200" size={32} />
                            Centre d'Aide & Support
                        </h2>
                        <p className="text-indigo-100 text-lg">
                            Besoin d'assistance ? Retrouvez ici toutes les réponses à vos questions et les coordonnées de vos interlocuteurs dédiés.
                        </p>
                    </div>
                    <div className="absolute right-0 bottom-0 opacity-10 transform translate-x-1/4 translate-y-1/4">
                        <FileQuestion size={300} />
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    
                    {/* Colonne Gauche : FAQ */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                                <BookOpen className="text-indigo-600" /> Questions Fréquentes
                            </h3>
                            <div className="space-y-4">
                                {faqItems.map((item, index) => (
                                    <div key={index} className="border border-slate-100 rounded-xl overflow-hidden">
                                        <button 
                                            onClick={() => setOpenFaqIndex(openFaqIndex === index ? null : index)}
                                            className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left font-bold text-slate-800"
                                        >
                                            {item.question}
                                            {openFaqIndex === index ? <ChevronUp size={20} className="text-indigo-600" /> : <ChevronDown size={20} className="text-slate-400" />}
                                        </button>
                                        {openFaqIndex === index && (
                                            <div className="p-4 bg-white text-slate-600 text-sm leading-relaxed border-t border-slate-100 animate-fade-in">
                                                {item.answer}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Contact Form */}
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <h3 className="text-xl font-bold text-slate-800 mb-4">Envoyer une demande spécifique</h3>
                            <form className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <input type="text" placeholder="Sujet" className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
                                    <select className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-white">
                                        <option>Urgence Transport</option>
                                        <option>Facturation</option>
                                        <option>Technique / Bug</option>
                                        <option>Autre</option>
                                    </select>
                                </div>
                                <textarea rows={4} placeholder="Détaillez votre demande..." className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"></textarea>
                                <button type="button" onClick={() => alert("Message envoyé au support.")} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg">
                                    Envoyer le message
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* Colonne Droite : Contacts */}
                    <div className="space-y-6">
                        {/* Contact Card */}
                        <div className="bg-white p-6 rounded-2xl border border-indigo-100 shadow-lg shadow-indigo-50">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Votre Interlocuteur Dédié</h4>
                            <div className="flex items-center gap-4 mb-6">
                                <img src="https://ui-avatars.com/api/?name=Marie+Logistics&background=random" className="w-16 h-16 rounded-full border-4 border-indigo-50" alt="Support" />
                                <div>
                                    <p className="font-bold text-slate-900 text-lg">Marie L.</p>
                                    <p className="text-indigo-600 font-medium text-sm">Account Manager</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <a href="tel:+33100000000" className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-indigo-50 transition-colors group">
                                    <div className="bg-white p-2 rounded-full shadow-sm text-slate-400 group-hover:text-indigo-600"><PhoneCall size={18} /></div>
                                    <span className="font-bold text-slate-700 group-hover:text-indigo-900">01 23 45 67 89</span>
                                </a>
                                <a href="mailto:support@fleetgenius.com" className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-indigo-50 transition-colors group">
                                    <div className="bg-white p-2 rounded-full shadow-sm text-slate-400 group-hover:text-indigo-600"><Mail size={18} /></div>
                                    <span className="font-bold text-slate-700 group-hover:text-indigo-900">marie@fleetgenius.com</span>
                                </a>
                            </div>
                        </div>

                        {/* Emergency Box */}
                        <div className="bg-red-50 p-6 rounded-2xl border border-red-100">
                            <h4 className="font-bold text-red-800 flex items-center gap-2 mb-2">
                                <AlertTriangle size={20} /> Urgence 24/7
                            </h4>
                            <p className="text-red-700 text-sm mb-4">
                                Pour tout problème critique concernant un transport en cours hors horaires de bureau.
                            </p>
                            <div className="text-2xl font-black text-red-600 tracking-wider">0 800 123 456</div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* --- MODAL NEW REQUEST --- */}
        <Modal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title="Demander un Devis"
            subtitle={`Demandeur : ${currentUser.firstName} ${currentUser.lastName}`}
            size="3xl"
            headerIcon={<Send size={20} />}
        >
            <form onSubmit={handleQuoteSubmit} className="space-y-8">
                {/* Toast de feedback pour la sauvegarde d'adresse */}
                {addressSaveMessage && (
                    <div className={`fixed top-4 right-4 z-[200] px-4 py-3 rounded-xl shadow-lg border animate-fade-in ${
                        addressSaveMessage.startsWith('✅') 
                            ? 'bg-green-50 border-green-200 text-green-700' 
                            : addressSaveMessage.startsWith('⚠️')
                            ? 'bg-amber-50 border-amber-200 text-amber-700'
                            : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                        <p className="font-medium text-sm">{addressSaveMessage}</p>
                    </div>
                )}
                
                {/* BLOCK 1: TRAJET */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* DÉPART */}
                    <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-indigo-600 mb-2">
                            <MapPin size={18} />
                            <h4 className="font-bold text-sm uppercase tracking-wider">Expéditeur (Enlèvement)</h4>
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
                                    incrementAddressUsage(addressId);
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
                                    <span className="text-xs font-medium text-amber-700">Mémoriser cette adresse</span>
                                </label>
                            )}
                            {saveOriginAddress && (
                                <input
                                    type="text"
                                    placeholder="Nom de l'adresse (ex: Entrepôt principal)"
                                    value={originLabel}
                                    onChange={(e) => setOriginLabel(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg bg-amber-50 focus:ring-2 focus:ring-amber-500 outline-none"
                                />
                            )}
                            
                            <div className="pt-2">
                                <label className="block text-xs font-bold text-slate-500 mb-1 ml-1">Date d'Enlèvement</label>
                                <InputField 
                                    icon={Calendar} type="datetime-local" required min={minPickup}
                                    value={newRequest.pickupDate}
                                    onChange={(e: any) => setNewRequest({...newRequest, pickupDate: e.target.value})}
                                />
                            </div>
                        </div>
                    </div>

                    {/* ARRIVÉE */}
                    <div className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 text-indigo-600 mb-2">
                            <MapPin size={18} />
                            <h4 className="font-bold text-sm uppercase tracking-wider">Destinataire (Livraison)</h4>
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
                                    incrementAddressUsage(addressId);
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
                                    <span className="text-xs font-medium text-amber-700">Mémoriser cette adresse</span>
                                </label>
                            )}
                            {saveDestAddress && (
                                <input
                                    type="text"
                                    placeholder="Nom de l'adresse (ex: Client Carrefour)"
                                    value={destLabel}
                                    onChange={(e) => setDestLabel(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg bg-amber-50 focus:ring-2 focus:ring-amber-500 outline-none"
                                />
                            )}
                            
                            <div className="pt-2">
                                <label className="block text-xs font-bold text-slate-500 mb-1 ml-1">Date de Livraison</label>
                                <InputField 
                                    icon={Calendar} type="datetime-local" required min={minDelivery} disabled={!newRequest.pickupDate}
                                    value={newRequest.deliveryDate}
                                    onChange={(e: any) => setNewRequest({...newRequest, deliveryDate: e.target.value})}
                                />
                            </div>

                            {/* Créneau de livraison */}
                            {newRequest.deliveryDate && (
                              <div className="pt-2">
                                <label className="block text-xs font-bold text-slate-500 mb-1 ml-1">
                                  Créneau de livraison souhaité
                                  {detectedZone && (
                                    <span className="ml-2 text-indigo-500 font-normal">(Zone {detectedZone})</span>
                                  )}
                                </label>
                                {availableSlots.length > 0 ? (
                                  <div className="grid grid-cols-2 gap-2">
                                    {availableSlots.map(slot => (
                                      <button
                                        key={slot.id}
                                        type="button"
                                        onClick={() => setSelectedSlot(selectedSlot?.id === slot.id ? null : slot)}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                                          selectedSlot?.id === slot.id
                                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-2 ring-indigo-200'
                                            : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'
                                        }`}
                                      >
                                        <Clock size={14} className={selectedSlot?.id === slot.id ? 'text-indigo-500' : 'text-slate-400'} />
                                        <div className="text-left">
                                          <div className="font-bold text-xs">{slot.label}</div>
                                          <div className="text-[10px] opacity-70">{slot.start} — {slot.end}</div>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                ) : detectedZone ? (
                                  <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                                    Aucun créneau disponible pour cette zone/date. Contactez-nous pour un arrangement.
                                  </p>
                                ) : (
                                  <p className="text-xs text-slate-400 px-3 py-2">
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
                                <h4 className="font-bold text-indigo-900 flex items-center gap-2">
                                    <Box size={20} className="text-indigo-600" /> Détails Marchandise
                                </h4>
                                
                                <div className="relative">
                                    <FileText className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <textarea 
                                        required rows={2} placeholder="Description (Ex: 3 Palettes Europe, Matériel fragile...)"
                                        className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl text-sm text-slate-900 font-medium focus:ring-2 focus:ring-indigo-500 outline-none bg-white placeholder:text-slate-400"
                                        value={newRequest.goodsDescription}
                                        onChange={(e) => setNewRequest({...newRequest, goodsDescription: e.target.value})}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Long. (cm)</label>
                                            <input type="number" min="0" placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 font-bold text-center focus:ring-2 focus:ring-indigo-500 outline-none" value={newRequest.length} onChange={(e) => setNewRequest({...newRequest, length: e.target.value})}/>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Larg. (cm)</label>
                                            <input type="number" min="0" placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 font-bold text-center focus:ring-2 focus:ring-indigo-500 outline-none" value={newRequest.width} onChange={(e) => setNewRequest({...newRequest, width: e.target.value})}/>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Haut. (cm)</label>
                                            <input type="number" min="0" placeholder="0" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-900 font-bold text-center focus:ring-2 focus:ring-indigo-500 outline-none" value={newRequest.height} onChange={(e) => setNewRequest({...newRequest, height: e.target.value})}/>
                                        </div>
                                    </div>

                                    <div className="flex gap-4">
                                        <div className="flex-1 bg-white rounded-xl border border-indigo-100 flex flex-col justify-center items-center p-2 shadow-sm">
                                            <span className="text-[10px] uppercase font-bold text-indigo-400">Volume</span>
                                            <span className="font-extrabold text-xl text-indigo-700">{newRequest.volume} <span className="text-xs">m3</span></span>
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-slate-500 mb-1">Poids (kg)</label>
                                            <div className="relative">
                                                <Weight className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                                <input 
                                                    type="number" min="0" required placeholder="0"
                                                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-sm bg-white text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    value={newRequest.weight}
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
                                    <StickyNote size={20} className="text-yellow-600" /> Instructions Spéciales
                                </h4>
                                <div className="relative">
                                    <textarea 
                                        rows={2} placeholder="Ex: Besoin d'un hayon, code portail 1234, appeler 30min avant..."
                                        className="w-full px-4 py-3 border border-yellow-300 rounded-xl text-sm text-slate-900 font-medium focus:ring-2 focus:ring-yellow-500 outline-none bg-white placeholder:text-slate-400"
                                        value={newRequest.clientNotes}
                                        onChange={(e) => setNewRequest({...newRequest, clientNotes: e.target.value})}
                                    />
                                </div>
                            </div>

                <div className="pt-2">
                    <button 
                        type="submit"
                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-3 text-lg transform active:scale-[0.99]"
                    >
                        <Send size={22} /> Envoyer ma demande
                    </button>
                </div>
            </form>
        </Modal>

        {/* --- MODAL ADD/EDIT TEAM MEMBER --- */}
        <Modal
            isOpen={isTeamModalOpen}
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
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={memberForm.firstName}
                        onChange={(e) => setMemberForm({...memberForm, firstName: e.target.value})}
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Nom</label>
                    <input 
                        type="text" required
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={memberForm.lastName}
                                onChange={(e) => setMemberForm({...memberForm, lastName: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Email professionnel</label>
                            <input 
                                type="email" required
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={memberForm.email}
                                onChange={(e) => setMemberForm({...memberForm, email: e.target.value})}
                            />
                        </div>
                <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700">
                    {editingMember 
                        ? "Mettre à jour les informations de contact. L'utilisateur recevra une notification." 
                        : `Ce collaborateur aura accès uniquement au compte ${currentUser.companyName}. Il pourra créer et gérer les demandes.`}
                </div>
                <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg">
                    {editingMember ? 'Enregistrer les modifications' : 'Envoyer l\'invitation'}
                </button>
            </form>
        </Modal>

        {/* --- GLOBAL CONFIRMATION MODAL --- */}
        {pendingAction && (
            <ConfirmModal
                isOpen={isConfirmModalOpen}
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
  );
};

export default ClientPortal;
