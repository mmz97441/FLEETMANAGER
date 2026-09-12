import { assertMissionReadyToClose, submitDelivery, pendingDeliveries, outboxChangeEvent } from '../services/deliveryOutbox';
/**
 * DRIVER MISSION VIEW — Interface Mobile Chauffeur
 *
 * Vue mobile-first pour les chauffeurs sur le terrain.
 * Fonctionnalités :
 * - Voir sa/ses tournée(s) du jour
 * - Navigation stop-par-stop
 * - Marquer arrivée (GPS)
 * - Valider livraison avec POD (signature + photo)
 * - Déclarer échec avec raison
 * - Appeler le contact
 * - Naviguer (Google Maps / Waze)
 * - Vue progression en temps réel
 */

import { emptyDriverManualStop, makeDriverManualStopRequest } from '../utils/driverManualStopRequest';
import { PendingManualStop, readPendingManualStop, reservePendingManualStop, clearPendingManualStop } from '../utils/pendingManualStop';
import { stopFormPayload } from '../utils/missionStopForm';
import { startUxTask } from '../utils/uxMetrics';
import { missionStatusLabel, stopStatusLabel } from '../utils/operationalLabels';
import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  Mission, MissionStatus, MissionType, MissionStop, StopStatus,
  PackageStatus, FailureReason, Package, DeliveryLocation,
  User, MISSION_STATUS_COLORS, Issue, IssueStatus, ActivityAction
} from '../types';
import { addIssueToFirestore } from '../services/firestore';
import { todayISO, localDatePart } from '../utils/date';
import {
  subscribeToMissions,
  subscribeToPackages,
  updateMission,
  commitStopOutcome,
  updateMissionFields,
  optimizeDriverMission,
  addManualStopToMission,
  updateMissionStatus,
  startDriverMission,
  recomputeMissionCounters,
  getPackagesByIds,
  addPackagesToStop
} from '../services/missionService';
import { UploadProgress } from '../services/podService';
import { finalizePickup } from '../services/pickupService';
import { reportError } from '../services/logService';
import { logActivity } from '../services/activityLogService';
import PickupScanView from './PickupScanView';
import Modal from './shared/Modal';
import { FormInput } from './shared/FormInput';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useUrlParam } from '../hooks/useUrlState';
import TransferReceiveModal from './TransferReceiveModal';
import ClaimScanModal from './ClaimScanModal';
import ScanGateDialog from './ScanGateDialog';
import StopReorderModal from './StopReorderModal';
import { packageMatchesCode, packageScanCodes, packageDisplayCode, matchScansToPackages } from '../utils/barcode';
import { sameDeliveryPoint } from '../utils/address';
import { getTourProgress } from '../utils/missionProgress';
import { getCurrentPosition } from '../utils/geo';
import { formatDistance, formatDuration } from '../utils/format';
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));
import {
  Truck,
  Package as PackageIcon,
  MapPin,
  Clock,
  Phone,
  CheckCircle,
  XCircle,
  Navigation,
  Play,
  Camera,
  PenTool,
  ChevronRight,
  Loader2,
  ArrowLeft,
  MapPinned,
  AlertTriangle,
  Building2,
  StickyNote,
  ScanLine,
  Route,
  Wrench,
  Undo2,
  Lock,
  Plus,
  X,
  Handshake,
  Home,
  KeyRound,
  Mail,
  ClipboardList,
} from 'lucide-react';

const NotificationText = ({ message }: { message: string }) => {
  const Icon = /❌|impossible|Erreur/i.test(message)
    ? XCircle
    : /⚠️/.test(message)
      ? AlertTriangle
      : /✅/.test(message)
        ? CheckCircle
        : PackageIcon;
  return (
    <>
      <Icon
        size={18}
        className="inline mr-2 align-text-bottom"
        aria-hidden="true"
      />
      {message.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim()}
    </>
  );
};

// ============================================================================
// REGROUPEMENT PAR POINT DE LIVRAISON (même logique que l'import)
// Sert au filet de sécurité : détecter un colis à la même adresse non inclus
// dans l'arrêt courant, pour éviter que le chauffeur reparte en oubliant un colis.
// ============================================================================

/** Un colis et un arrêt sont-ils au MÊME point de livraison ? (adresse OU tél+CP)
 *  Règle centralisée dans utils/address.ts (source de vérité unique). */
const samePlace = sameDeliveryPoint;

// ============================================================================
// TYPES
// ============================================================================

interface DriverMissionViewProps {
  currentUser: User;
  // Clients expéditeurs — pour créer un colis hors-import à la récupération
  // (le chauffeur choisit l'expéditeur). Optionnel : sans, la création propose
  // la saisie libre du nom du client.
  clients?: User[];
  // Raccourci scan depuis un autre écran : ouvre le choix Récupérer/Livraison
  // dès l'arrivée sur la vue tournée.
  scanIntent?: boolean;
  onScanIntentHandled?: () => void;
}

// ============================================================================
// SIGNATURE PAD (Composant interne léger)
// ============================================================================

const SignaturePad: React.FC<{
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
  driverName?: string;
}> = ({ onSave, onCancel, driverName }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const strokesRef = useRef<{ x: number; y: number }[][]>([]);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);

  const getPos = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const redraw = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i++) {
        const mx = (stroke[i].x + stroke[i + 1].x) / 2;
        const my = (stroke[i].y + stroke[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, mx, my);
      }
      ctx.lineTo(stroke[stroke.length - 1].x, stroke[stroke.length - 1].y);
      ctx.stroke();
    }
  };

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    currentStrokeRef.current = [pos];
    setIsDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    currentStrokeRef.current.push(pos);

    // Live drawing du trait courant
    const pts = currentStrokeRef.current;
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const prev = pts[pts.length - 2];
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasContent(true);
  };

  const stopDrawing = () => {
    if (isDrawing && currentStrokeRef.current.length > 1) {
      strokesRef.current.push([...currentStrokeRef.current]);
      currentStrokeRef.current = [];
      redraw(); // Redessine avec Bézier pour lisser
    }
    setIsDrawing(false);
  };

  const undo = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    redraw();
    setHasContent(strokesRef.current.length > 0);
  };

  const clear = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    strokesRef.current = [];
    currentStrokeRef.current = [];
    setHasContent(false);
  };

  const save = () => {
    if (!canvasRef.current || !hasContent) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) { onSave(canvas.toDataURL('image/png')); return; }

    // Watermark en bas : date + heure + chauffeur
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const watermark = `${dateStr} ${timeStr}${driverName ? ` — ${driverName}` : ''}`;

    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, canvas.height - 22, canvas.width, 22);
    ctx.font = '11px Arial, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.textBaseline = 'middle';
    ctx.fillText(watermark, 6, canvas.height - 11);

    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div className="min-w-0 max-w-full bg-white rounded-xl border-2 border-amber-300 overflow-hidden shadow-lg">
      <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <span className="text-sm font-bold text-amber-800">
          <PenTool
            size={18}
            className="inline shrink-0 align-text-bottom"
            aria-hidden="true"
          />{" "}
          Signature du destinataire
        </span>
        <div className="flex gap-2">
          <button
            onClick={undo}
            disabled={strokesRef.current.length === 0}
            className="ui-button ui-button-secondary disabled:opacity-30"
          >
            <Undo2 size={18} aria-hidden="true" />
            Annuler
          </button>
          <button onClick={clear} className="ui-button ui-button-secondary">
            Effacer tout
          </button>
        </div>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={280}
          aria-label="Zone de signature manuscrite du destinataire" className="block max-w-full w-full h-[160px] touch-none bg-white cursor-crosshair"
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
        />
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-600 text-sm">Signez ici avec le doigt</p>
          </div>
        )}
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2">
        <button
          onClick={onCancel}
          className="ui-button ui-button-secondary flex-1"
        >
          Annuler
        </button>
        <button
          onClick={save}
          disabled={!hasContent}
          className="ui-button ui-button-primary flex-1"
        >
          <CheckCircle size={18} aria-hidden="true" />
          Valider signature
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const DriverMissionView: React.FC<DriverMissionViewProps> = ({ currentUser, clients = [], scanIntent = false, onScanIntentHandled }) => {
  // === State ===
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [activeStopIndex, setActiveStopIndex] = useState(0);
  const [linkedMission] = useUrlParam<string>('mission', '');
  const [linkedPackage] = useUrlParam<string>('package', '');
  const appliedLink = useRef('');
  const hasAutoSelectedRef = useRef(false); // FIX BUG 3: empêche la re-sélection forcée

  // UI state
  const [showSignature, setShowSignature] = useState(false);
  const [showFailureModal, setShowFailureModal] = useState(false);
  const [failureReason, setFailureReason] = useState<FailureReason>(FailureReason.ABSENT);
  const [failureNotes, setFailureNotes] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocation>(DeliveryLocation.HAND_DELIVERY);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const MAX_PHOTOS = 5;
  // Assistant de livraison pas-à-pas (petits écrans) + état marchandise à la réception
  const [deliveryStep, setDeliveryStep] = useState(0);
  const [merchandiseGood, setMerchandiseGood] = useState(true);
  const [reservesNote, setReservesNote] = useState('');
  const [showReserves, setShowReserves] = useState(false); // étape État : saisie de réserve dépliée
  const [gpsBlocked, setGpsBlocked] = useState(false); // action bloquée : GPS obligatoire non activé
  const [gpsErrorMsg, setGpsErrorMsg] = useState(''); // message personnalisé selon la cause
  const [gpsIsPermission, setGpsIsPermission] = useState(false); // true = permission navigateur refusée (vs GPS OS coupé)
  const [gpsRetry, setGpsRetry] = useState<null | (() => void)>(null); // action à rejouer après activation
  const DELIVERY_STEPS = ['Colis', 'État', 'Réception', 'Preuve', 'Validation'];
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [failurePhotos, setFailurePhotos] = useState<string[]>([]);
  const [notification, setNotification] = useState<string | null>(null);
  const [isLoadingPhase, setIsLoadingPhase] = useState(false); // Phase chargement véhicule
  const photoInputRef = useRef<HTMLInputElement>(null);
  const failurePhotoInputRef = useRef<HTMLInputElement>(null);

  // Pickup/Scan state
  const [showScanner, setShowScanner] = useState(false);
  const [scannedBarcodes, setScannedBarcodes] = useState<string[]>([]);
  const [scanBypass, setScanBypass] = useState(false); // validation sans scan complet (tracée)
  const [showScanGate, setShowScanGate] = useState(false); // garde-fou "colis manquants"
  // D'où le garde-fou scan est ouvert : à l'ÉTAPE SCAN (on résout puis on avance) ou à
  // la VALIDATION finale (on résout puis on livre). Le scan se décide au DÉBUT, plus à la fin.
  const [scanGateFrom, setScanGateFrom] = useState<'scan' | 'final'>('scan');
  const [showTransferModal, setShowTransferModal] = useState(false); // réception de colis en route
  const [showClaimModal, setShowClaimModal] = useState(false); // prise en charge par scan
  const [showScanChoice, setShowScanChoice] = useState(false); // choix Enlèvement / Livraison au scan
  const [driverTab, setDriverTab] = useState<'encours' | 'historique'>('encours'); // liste tournées : en cours vs historique
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [showManualStop, setShowManualStop] = useState(false);
  const [manualStop, setManualStop] = useState(emptyDriverManualStop);
  const [pendingManualStop, setPendingManualStop] = useState<PendingManualStop | null>(null);
  const [manualStopError, setManualStopError] = useState('');
  const [manualJournalError, setManualJournalError] = useState('');
  const manualStopLock = useRef(false);
  useEffect(() => {
    const restore = () => {
      try {
        const saved = readPendingManualStop(localStorage, currentUser.id);
        setPendingManualStop(saved);
        setManualJournalError('');
        if (saved) setManualStop({ ...saved.form });
      } catch {
        setManualJournalError('La demande précédente ne peut pas être relue sur ce téléphone. Contactez le bureau pour vérifier son résultat avant tout nouvel ajout.');
      }
    };
    restore();
    window.addEventListener('storage', restore);
    return () => window.removeEventListener('storage', restore);
  }, [currentUser.id]);
  const [showIssue, setShowIssue] = useState(false);
  const [issueForm, setIssueForm] = useState<{ category: string; description: string; priority: 'Low' | 'Medium' | 'High' }>({ category: 'Véhicule / panne', description: '', priority: 'Medium' });
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [showFinishBlocked, setShowFinishBlocked] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [pendingProofs, setPendingProofs] = useState<string[]>([]);
  const [pendingProofError, setPendingProofError] = useState('');
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopCardRef = useRef<HTMLDivElement>(null);
  const [stepAnnouncement, setStepAnnouncement] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener('online', refresh); window.addEventListener('offline', refresh);
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);
  useEffect(() => {
    setShowFinishBlocked(false);
    setFinishError('');
  }, [activeMissionId]);
  const [stopPackages, setStopPackages] = useState<Package[]>([]);
  // Filet de sécurité : colis à la même adresse NON inclus dans l'arrêt courant
  const [otherAtAddress, setOtherAtAddress] = useState<Package[]>([]);

  // Return to hub workflow
  const [returnPackages, setReturnPackages] = useState<Package[]>([]);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returningPackage, setReturningPackage] = useState<Package | null>(null);
  const [returnPhotos, setReturnPhotos] = useState<string[]>([]);
  const [returnSignature, setReturnSignature] = useState<string | null>(null);
  const [showReturnSignature, setShowReturnSignature] = useState(false);
  const returnPhotoInputRef = useRef<HTMLInputElement>(null);

  const closeManual = useUnsavedChanges(showManualStop && !pendingManualStop && Object.values(manualStop).some(Boolean), isProcessing);
  const closeIssue = useUnsavedChanges(showIssue && (!!issueForm.description.trim() || issueForm.category !== 'Véhicule / panne' || issueForm.priority !== 'Medium'), issueSubmitting);
  const closeFailure = useUnsavedChanges(showFailureModal && (!!failureNotes || failurePhotos.length > 0 || failureReason !== FailureReason.ABSENT), isProcessing);
  const closeReturn = useUnsavedChanges(showReturnModal && (returnPhotos.length > 0 || !!returnSignature), isProcessing);
  const changeStop = useUnsavedChanges(!!signatureData || capturedPhotos.length > 0 || !!recipientName || !!reservesNote || scannedBarcodes.length > 0, isProcessing);
  useEffect(() => () => clearTimeout(notificationTimer.current), []);
  useEffect(() => {
    let active = true;
    const refresh = () => pendingDeliveries(currentUser.id, activeMissionId || undefined).then(rows => {
      if (active) { setPendingProofs(rows.map(row => row.action.stopId)); setPendingProofError(''); }
    }).catch(() => { if (active) setPendingProofError('Impossible de vérifier les preuves conservées sur ce téléphone.'); });
    void refresh();
    window.addEventListener(outboxChangeEvent, refresh);
    return () => { active = false; window.removeEventListener(outboxChangeEvent, refresh); };
  }, [currentUser.id, activeMissionId]);

  const today = todayISO();

  // Raccourci scan venu d'un autre écran → ouvre le choix Récupérer/Livraison.
  useEffect(() => {
    if (scanIntent) {
      setShowScanChoice(true);
      onScanIntentHandled?.();
    }
  }, [scanIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  // === Abonnement missions du chauffeur ===
  useEffect(() => {
    hasAutoSelectedRef.current = false; // reset si le jour change
    const unsub = subscribeToMissions((data) => {
      // Les filtres sont appliqués par subscribeToMissions
      const myMissions = data.filter(m => m.status !== MissionStatus.CANCELLED);
      setMissions(myMissions);
      setLoading(false);

      // Auto-sélectionner la mission active. On ne VERROUILLE qu'une fois une
      // mission RÉELLEMENT sélectionnée : sinon, quand le chauffeur ouvre l'app
      // sans tournée puis récupère des colis, la mission créée juste après n'était
      // jamais auto-sélectionnée (verrou posé au 1er callback vide) → écran sans
      // tournée. Ici, tant qu'aucune tournée EN COURS n'existe, on reste à l'écoute.
      if (!hasAutoSelectedRef.current) {
        const active = myMissions.find(m => m.status === MissionStatus.IN_PROGRESS);
        if (active) {
          setActiveMissionId(active.id);
          // Trouver le premier stop en attente pour cette mission
          const sorted = [...active.stops].sort((a, b) => a.sequence - b.sequence);
          const pendingIdx = sorted.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED);
          setActiveStopIndex(pendingIdx >= 0 ? pendingIdx : 0);
          hasAutoSelectedRef.current = true;
        }
      }
    }, { date: today, driverId: currentUser.id });
    return unsub;
  }, [currentUser.id, today]);

  useEffect(() => {
    const key = `${linkedMission}/${linkedPackage}`;
    if (!linkedMission && !linkedPackage) { appliedLink.current = ''; return; }
    if (loading || appliedLink.current === key) return;
    const target = missions.find(mission => (!linkedMission || mission.id === linkedMission) && (!linkedPackage || mission.stops.some(stop => stop.packageIds.includes(linkedPackage))));
    if (!target) { setNotification('La tournée ou le colis de ce lien n’est pas présent dans vos tournées du jour. Vérifiez la date avec le bureau.'); return; }
    appliedLink.current = key;
    void changeStop(() => {
      setActiveMissionId(target.id);
      const ordered = [...target.stops].sort((a, b) => a.sequence - b.sequence);
      const index = linkedPackage ? ordered.findIndex(stop => stop.packageIds.includes(linkedPackage)) : ordered.findIndex(stop => ![StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED].includes(stop.status));
      setActiveStopIndex(Math.max(0, index));
      if (target.status === MissionStatus.COMPLETED) setDriverTab('historique');
    });
  }, [linkedMission, linkedPackage, loading, missions, changeStop]);

  // === Données dérivées ===
  const activeMission = useMemo(() =>
    missions.find(m => m.id === activeMissionId) || null
  , [missions, activeMissionId]);

  const sortedStops = useMemo(() =>
    activeMission ? [...activeMission.stops].sort((a, b) => a.sequence - b.sequence) : []
  , [activeMission]);

  const currentStop = sortedStops[activeStopIndex] || null;
  const isPickupStop = currentStop?.type === 'PICKUP';

  // Tous les arrêts sont traités (livrés / échoués / passés) → on peut proposer de
  // clôturer la tournée. La mission ne se termine plus toute seule (choix chauffeur).
  const allStopsDone = sortedStops.length > 0 && sortedStops.every(s =>
    s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED
  );
  // L'arrêt courant est-il DÉJÀ traité ? → on masque tout le « bruit » de livraison
  // (colis à remettre, Naviguer, note, boutons de gestion) et on ne montre qu'un résumé.
  const currentStopDone = !!currentStop && (
    currentStop.status === StopStatus.COMPLETED || currentStop.status === StopStatus.FAILED ||
    currentStop.status === StopStatus.SKIPPED
  );

  // Charger les colis du stop courant (PICKUP : pour le scan ; DELIVERY : pour
  // afficher au chauffeur les N° de colis à remettre)
  useEffect(() => {
    if (!currentStop) {
      setStopPackages([]);
      setOtherAtAddress([]);
      return;
    }
    const ids = currentStop.packageIds || [];
    let cancelled = false;

    // #1 : les colis de l'arrêt sont chargés par leurs IDs EXACTS (getPackagesByIds),
    // et NON en filtrant les « 500 plus récents » — sinon, sur gros volume ou colis
    // importés un jour précédent, la liste devenait vide/incomplète (compte faux et
    // gate de scan neutralisé). Par IDs, le compte est toujours complet.
    getPackagesByIds(ids)
      .then(pkgs => { if (!cancelled) setStopPackages(pkgs); })
      .catch(err => {
        // Ne PAS laisser stopPackages à [] sur erreur : combiné au gate, « 0 colis »
        // vaudrait « tout scanné ». On loggue ; le gate reste fermé car il compare
        // au compte autoritaire currentStop.packageIds (voir expectedStopCount).
        console.error('Chargement colis de l’arrêt échoué:', err);
      });

    // Filet de sécurité (livraison uniquement) : colis destinés à CE point mais PAS
    // dans l'arrêt (oubli / mal regroupé). Requête large volontairement (best-effort).
    let unsub: () => void = () => { /* GPS indispo : l'arrivée est déjà enregistrée */ };
    if (currentStop.type === 'DELIVERY') {
      unsub = subscribeToPackages((pkgs) => {
        const others = pkgs.filter(p =>
          !ids.includes(p.id) &&
          samePlace(p, currentStop) &&
          p.status !== PackageStatus.DELIVERED &&
          p.status !== PackageStatus.RETURNED &&
          p.status !== PackageStatus.FAILED &&
          (p.currentDriverId === currentUser.id ||
            (!!activeMission && p.missionId === activeMission.id) ||
            localDatePart(p.createdAt || '') === today)
        );
        setOtherAtAddress(others);
      });
    } else {
      setOtherAtAddress([]);
    }
    return () => { cancelled = true; unsub(); };
  }, [currentStop?.id, currentStop?.type, (currentStop?.packageIds || []).join(','), activeMission?.id, currentUser.id, today]);

  // Reset COMPLET quand on change de stop. CRUCIAL avec le mode guidé auto : sans
  // remise à zéro de la preuve (photo/signature/nom), un arrêt non terminé laissait
  // ces valeurs en place et l'étape Preuve s'auto-franchissait à l'arrêt SUIVANT avec
  // la preuve du précédent (faux POD). On repart donc de zéro à chaque arrêt.
  useEffect(() => {
    setScannedBarcodes([]);
    setShowScanner(false);
    setScanBypass(false);
    setDeliveryStep(0);
    setStepAnnouncement('');
    setMerchandiseGood(true);
    setReservesNote('');
    setShowReserves(false);
    setSignatureData(null);
    setShowSignature(false);
    setCapturedPhotos([]);
    setRecipientName('');
    setDeliveryLocation(DeliveryLocation.HAND_DELIVERY);
  }, [currentStop?.id]);

  // Scan de contrôle à la livraison : chaque colis du stop doit être scanné
  // (étiquette client BR… ou tracking GFL…) avant de pouvoir valider.
  // Assignation 1:1 (matchScansToPackages) : un scan couvre AU PLUS un colis →
  // pas de sur-comptage quand plusieurs colis partagent un identifiant.
  const scannedStopIds = matchScansToPackages(stopPackages, scannedBarcodes);
  const deliveryScannedCount = scannedStopIds.size;
  // Le gate se base sur le compte AUTORITAIRE des colis de l'arrêt
  // (currentStop.packageIds, toujours à jour via la mission), et NON sur
  // stopPackages.length : ainsi, si le chargement des colis échoue/incomplet
  // (réseau), le gate ne s'auto-valide pas à tort (il reste à scanner ou forcer).
  const expectedStopCount = currentStop?.packageIds?.length || 0;
  const allStopScanned = expectedStopCount === 0 || deliveryScannedCount === expectedStopCount;
  const scanRequirementMet = allStopScanned || scanBypass;
  const missingStopCodes = stopPackages
    .filter(p => !scannedStopIds.has(p.id))
    .map(p => packageDisplayCode(p) || 'sans code');

  // Charger les colis "À retourner" pour ce chauffeur
  useEffect(() => {
    const unsub = subscribeToPackages((pkgs) => {
      const toReturn = pkgs.filter(p => 
        p.status === PackageStatus.RETURN_REQUESTED &&
        p.currentDriverId === currentUser.id
      );
      setReturnPackages(toReturn);
    }, {driverId: currentUser.id, status: PackageStatus.RETURN_REQUESTED});
    return unsub;
  }, [currentUser.id]);

  const nextPendingStopIndex = useMemo(() => {
    return sortedStops.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED);
  }, [sortedStops]);

  const missionProgress = useMemo(() => {
    if (!activeMission) return 0;
    return getTourProgress(activeMission).pct; // avancement = arrêts traités / total
  }, [activeMission]);

  // === Notifications éphémères ===
  const showNotif = (msg: string) => {
    clearTimeout(notificationTimer.current);
    setNotification(msg);
    if (!/❌|⚠️|impossible|Erreur/i.test(msg)) notificationTimer.current = setTimeout(() => setNotification(null), 7000);
  };

  // « Livraison » : aller livrer — sélectionne la tournée du jour et se place sur le
  // premier arrêt à faire. Si aucune tournée n'existe encore, on renvoie vers l'enlèvement.
  const goToDelivery = () => {
    const dlvId = `DLV-${currentUser.id}-${today}`;
    const tour = missions.find(m => (m.id === activeMissionId || m.id === dlvId) && m.status === MissionStatus.IN_PROGRESS)
      || missions.find(m => m.status === MissionStatus.IN_PROGRESS);
    if (tour) {
      setActiveMissionId(tour.id);
      const sorted = [...(tour.stops || [])].sort((a, b) => a.sequence - b.sequence);
      const idx = sorted.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED);
      setActiveStopIndex(idx >= 0 ? idx : 0);
      return;
    }
    // Pas de tournée EN COURS : une tournée dispatchée existe ? → la démarrer via sa carte.
    if (missions.some(m => m.status === MissionStatus.DISPATCHED)) {
      showNotif('Votre tournée est prête — appuyez sur « Commencer le chargement »');
    } else {
      showNotif('Aucune tournée à livrer — récupérez d’abord des colis');
    }
  };

  // Modale de choix au scan : Enlèvement (charger, transfert auto) ou Livraison (livrer).
  const renderScanChoice = () =>
    showScanChoice && (
      <Modal isOpen onClose={() => setShowScanChoice(false)} title="Choisir une opération" bodyClassName="!p-0">
        <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-black text-lg text-slate-800">
              Quelle opération souhaitez-vous effectuer ?
            </h3>
          </div>
          <div className="p-4 grid grid-cols-1 gap-3">
            <button
              onClick={() => { setShowScanChoice(false); setShowClaimModal(true); }}
              className="ui-button ui-button-secondary w-full !flex-col !items-start !text-left"
            >
              <div className="font-black text-base flex items-center gap-2">
                <PackageIcon
                  size={18}
                  className="inline shrink-0 align-text-bottom"
                  aria-hidden="true"
                />{" "}
                Récupérer des colis
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Scannez les colis à récupérer : ils rejoignent votre tournée. Un
                colis déjà chez un collègue = transfert automatique.
              </div>
            </button>
            <button
              onClick={() => { setShowScanChoice(false); goToDelivery(); }}
              className="ui-button ui-button-secondary w-full !flex-col !items-start !text-left"
            >
              <div className="font-black text-base flex items-center gap-2">
                <Truck
                  size={18}
                  className="inline shrink-0 align-text-bottom"
                  aria-hidden="true"
                />{" "}
                Livraison — remettre au client
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Ouvrez votre tournée, arrêt par arrêt (scan, photo, signature).
              </div>
            </button>
            <button
              onClick={() => setShowScanChoice(false)}
              className="ui-button ui-button-secondary w-full"
            >
              Annuler
            </button>
          </div>
        </div>
      </Modal>
    );

  // Rattacher à l'arrêt courant les colis détectés au MÊME point de livraison mais
  // absents de l'arrêt (bandeau rouge). `otherAtAddress` est déjà restreint au même
  // point (adresse OU téléphone) et aux colis pertinents ; on n'exclut ici que ceux
  // affectés à un AUTRE chauffeur (sinon on lui volerait un colis). On les ajoute
  // DIRECTEMENT à cet arrêt via addPackagesToStop (transaction atomique) → plus
  // aucune dépendance au regroupement placeKey qui bloquait avant.
  // On ne rattache QUE les colis « libres » : non affectés à un autre chauffeur ET
  // non déjà rattachés à une AUTRE tournée (sinon on créerait un doublon inter-missions
  // — le colis serait livré et compté deux fois). Un colis d'une autre mission doit
  // passer par le flux TRANSFERT (qui le retire de la mission d'origine), pas par ici.
  const claimableOthers = useMemo(() =>
    otherAtAddress.filter(p =>
      (!p.currentDriverId || p.currentDriverId === currentUser.id) &&
      (!p.missionId || p.missionId === activeMission?.id)
    ),
  [otherAtAddress, currentUser.id, activeMission?.id]);

  const [isClaimingOthers, setIsClaimingOthers] = useState(false);
  const handleClaimOthersToStop = async () => {
    if (!activeMission || !currentStop || claimableOthers.length === 0 || isClaimingOthers) return;
    if (currentStop.status === StopStatus.COMPLETED) {
      showNotif('⚠️ Arrêt déjà terminé — impossible d’y rattacher des colis');
      return;
    }
    setIsClaimingOthers(true);
    try {
      let location: { lat: number; lng: number } | undefined;
      try { location = await getCurrentPosition({ timeout: 5000 }); } catch {}
      const n = await addPackagesToStop(
        activeMission.id,
        currentStop.id,
        claimableOthers,
        { id: currentUser.id, name: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email },
        location,
      );
      showNotif(n > 0 ? `📦 ${n} colis rattaché${n > 1 ? 's' : ''} à cet arrêt` : 'Aucun colis à rattacher');
    } catch (err) {
      showNotif(`❌ Rattachement impossible${err instanceof Error ? ` (${err.message})` : ''}`);
    }
    setIsClaimingOthers(false);
  };

  // === GPS ===
  // getCurrentPosition est centralisé dans utils/geo (défaut : enableHighAccuracy,
  // timeout 10 s, maximumAge 0 — équivalent aux anciennes options locales).

  // Message GPS personnalisé (prénom) + ciblé selon la cause de l'échec.
  const buildGpsMessage = (
    err: any,
  ): { msg: string; isPermission: boolean } => {
    const hi = currentUser.firstName ? `${currentUser.firstName}, ` : '';
    const code = err && typeof err.code === 'number' ? err.code : null;
    if (code === 1)
      // PERMISSION_DENIED
      return {
        msg: `${hi}autorisez la localisation pour ce site dans les réglages du navigateur `,
        isPermission: true,
      };
    if (code === 2)
      // POSITION_UNAVAILABLE (GPS OS coupé)
      return {
        msg: `${hi}activez le GPS de votre téléphone pour continuer `,
        isPermission: false,
      };
    if (code === 3)
      // TIMEOUT
      return {
        msg: `${hi}position indisponible — vérifiez que le GPS est bien activé, puis réessayez `,
        isPermission: false,
      };
    return { msg: `${hi}activez votre localisation pour continuer`, isPermission: false };
  };

  // Garde GPS réutilisable : renvoie la position, ou déclenche la modale bloquante
  // (message personnalisé + action à rejouer) et renvoie null. Utilisée pour la
  // LIVRAISON et le DÉPART de tournée. NE PAS utiliser pour la passation entre chauffeurs.
  const ensureGps = async (retry: () => void): Promise<{ lat: number; lng: number } | null> => {
    try {
      return await getCurrentPosition();
    } catch (e) {
      const { msg, isPermission } = buildGpsMessage(e);
      reportError('driver.gpsRequired', e, {
        level: 'warning',
        silent: true,
        extra: { driverId: currentUser.id, driverName: `${currentUser.firstName} ${currentUser.lastName}` }
      });
      setGpsErrorMsg(msg);
      setGpsIsPermission(isPermission);
      setGpsRetry(() => retry);
      setGpsBlocked(true);
      return null;
    }
  };

  // === ACTIONS ===

  // Phase 1 : Commencer le chargement (DISPATCHED → LOADING en mémoire)
  const handleStartLoading = (mission: Mission) => {
    setActiveMissionId(mission.id);
    setIsLoadingPhase(true);
    showNotif('📦 Chargement en cours — Confirmez quand vous avez tout chargé');
  };

  // Phase 2 : Chargement terminé → packages IN_DELIVERY + mission IN_PROGRESS + recalcul ETA
  const handleLoadingComplete = async (mission: Mission) => {
    // Spinner IMMÉDIAT (avant l'attente GPS) → le bouton réagit tout de suite au tap.
    // Sans ça, ensureGps() pouvait attendre ~10 s avant tout retour visuel (« bouton mort »).
    setIsProcessing(true);
    // GPS obligatoire DÈS LE DÉPART : on bloque ici (au hub) plutôt qu'au 1er client,
    // pour que le chauffeur active sa localisation en début de tournée.
    const startPos = await ensureGps(() => handleLoadingComplete(mission));
    if (!startPos) { setIsProcessing(false); return; }
    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // Relire la tournée et ses colis, puis les démarrer ensemble : aucune
      // affectation récente ni erreur de colis ne doit être écrasée ou ignorée.
      const updatedStops = await startDriverMission(mission.id, {
        driverId: currentUser.id,
        driverName: `${currentUser.firstName} ${currentUser.lastName}`,
        startedAt: nowISO,
        coordinates: startPos,
      });

      // JOURNAL — départ de tournée.
      void logActivity(currentUser, ActivityAction.MISSION_STARTED, {
        targetType: 'mission', targetId: mission.id, targetName: `Tournée ${mission.zone || ''}`.trim(),
        description: `${currentUser.firstName} ${currentUser.lastName} a démarré sa tournée (${updatedStops.length} arrêts)`,
        details: { metadata: { arrêts: updatedStops.length, zone: mission.zone } }
      });

      setIsLoadingPhase(false);
      setActiveStopIndex(0);
      showNotif('🚀 Chargement terminé — Bonne tournée !');
    } catch (err) {
      reportError('driver.loadCompleted', err, { silent: true });
      showNotif(`❌ Erreur — Réessayez${err instanceof Error ? ` (${err.message})` : ''}`);
    }
    setIsProcessing(false);
  };

  // Annuler le chargement
  const handleCancelLoading = () => {
    setIsLoadingPhase(false);
    setActiveMissionId(null);
    showNotif('Chargement annulé');
  };

  // === WORKFLOW RETOUR HUB ===

  // Ouvrir le modal de retour pour un colis
  const openReturnModal = (pkg: Package) => {
    setReturningPackage(pkg);
    setReturnPhotos([]);
    setReturnSignature(null);
    setShowReturnModal(true);
  };

  // Prendre photo retour
  const handleReturnPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      if (returnPhotos.length < 5) {
        setReturnPhotos(prev => [...prev, reader.result as string]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Valider le retour au hub
  const handleConfirmReturn = async () => {
    if (!returningPackage) return;
    if (returnPhotos.length === 0) {
      showNotif('❌ Photo obligatoire pour le retour');
      return;
    }

    setIsProcessing(true);
    try {
      let coords: { lat: number; lng: number } | undefined;
      try { coords = await getCurrentPosition(); } catch {}

      // Uploader les photos
      const photoUrls: string[] = [];
      for (const photoBase64 of returnPhotos) {
        try {
          const { uploadProofPhoto } = await import('../services/podService');
          const url = await uploadProofPhoto(photoBase64, returningPackage.id, 'return');
          photoUrls.push(url);
        } catch (e) { throw new Error('La photo du retour n’a pas été envoyée. Réessayez avant de confirmer.'); }
      }

      // Uploader la signature si présente
      let signatureUrl: string | undefined;
      if (returnSignature) {
        try {
          const { uploadProofPhoto } = await import('../services/podService');
          signatureUrl = await uploadProofPhoto(returnSignature, returningPackage.id, 'return-signature');
        } catch (e) { throw new Error('La signature du retour n’a pas été envoyée. Réessayez avant de confirmer.'); }
      }

      // Créer la preuve de retour
      const returnProof = {
        packageId: returningPackage.id,
        missionId: returningPackage.missionId,
        driverId: currentUser.id,
        driverName: `${currentUser.firstName} ${currentUser.lastName}`,
        vehicleId: activeMission?.vehicleId,
        vehiclePlate: activeMission?.vehiclePlate,
        hubId: activeMission?.hubId || '',
        hubName: activeMission?.hubName || 'Hub',
        reason: 'STOP_DELETED' as const,
        reasonLabel: returningPackage.returnReason || 'Stop supprimé',
        photoUrls,
        signatureUrl,
        coordinates:coords ?? null,
        locationStatus: coords
          ? ('captured' as const)
          : ('unavailable' as const),
        timestamp: new Date().toISOString(),
        notes: `Retourné par ${currentUser.firstName} ${currentUser.lastName}`,
      };

      // Sauvegarder la preuve de retour dans le colis
      const { detachPackageFromTour } = await import('../services/missionService');
      // Détache VRAIMENT le colis (écrit null, pas undefined) → il quitte la
      // tournée et n'est plus une cible du resync « arrêt terminé ».
      await detachPackageFromTour(returningPackage.id, {
        returnProof,
        currentHubId: activeMission?.hubId,
      });

      showNotif('✅ Retour hub confirmé !');
      setShowReturnModal(false);
      setReturningPackage(null);
      setReturnPhotos([]);
      setReturnSignature(null);
    } catch (err) {
      reportError('driver.confirmReturn', err, { silent: true });
      showNotif(`❌ Erreur — Réessayez${err instanceof Error ? ` (${err.message})` : ''}`);
    }
    setIsProcessing(false);
  };

  // Marquer arrivée au stop
  const handleArriveAtStop = async () => {
    if (!activeMission || !currentStop) return;
    const missionId = activeMission.id;
    const stopId = currentStop.id;
    setIsProcessing(true);
    try {
      // ARRIVÉE IMMÉDIATE : on NE bloque PLUS sur le GPS. Le guide s'ouvre tout de
      // suite (avant, le bouton attendait la position jusqu'à ~10 s → « rien ne se
      // passe »). Le point GPS d'arrivée est capté en arrière-plan (best-effort).
      await commitStopOutcome({
        missionId,
        stopId,
        stopPatch: {
          status: StopStatus.ARRIVED,
          arrivalTime: new Date().toISOString()
        }
      });
      getCurrentPosition({ timeout: 5000 })
        .then(coords => commitStopOutcome({ missionId, stopId, stopPatch: { arrivalCoordinates: coords } }))
        .catch(() => {});
      showNotif('📍 Arrivée enregistrée');
    } catch (err) {
      reportError('driver.arrival', err, { silent: true });
      showNotif(`❌ Erreur${err instanceof Error ? ` — ${err.message}` : ''}`);
    }
    setIsProcessing(false);
  };

  // Clôturer la tournée (choix explicite du chauffeur quand tous les arrêts sont faits).
  // Nombre d'arrêts encore à traiter (ni terminés/échoués/passés).
  const remainingStops = sortedStops.filter(s =>
    s.status !== StopStatus.COMPLETED && s.status !== StopStatus.FAILED && s.status !== StopStatus.SKIPPED
  ).length;

  // Les arrêts non traités doivent être résolus avant toute clôture.
  const activeReturns = returnPackages.filter(pkg => pkg.missionId === activeMission?.id || sortedStops.some(stop => stop.packageIds.includes(pkg.id)));
  const proofStopIds = new Set([...pendingProofs, ...sortedStops.filter(stop => stop.proofSyncPending).map(stop => stop.id)]);
  const closureNeedsAttention = remainingStops > 0 || activeReturns.length > 0 || proofStopIds.size > 0 || !!pendingProofError;
  const requestFinishTour = () => { if (!isProcessing) setShowFinishBlocked(true); };
  const openStop = (index: number) => { void changeStop(() => { setActiveStopIndex(index); setShowFinishBlocked(false); window.setTimeout(() => stopCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }); };
  const openPendingProofs = () => {
    setShowFinishBlocked(false);
    window.dispatchEvent(new CustomEvent('fleet-show-pending-sync', { detail: { missionId: activeMission?.id } }));
  };

  const handleFinishTour = async () => {
    if (!activeMission || isProcessing) return;
    if (remainingStops > 0) { setShowFinishBlocked(true); return; }
    setShowFinishBlocked(false);
    setFinishError('');
    setIsProcessing(true);
    try {
      await assertMissionReadyToClose(currentUser.id, activeMission.id, activeMission.stops);
      await updateMissionStatus(activeMission.id, MissionStatus.COMPLETED);
      // JOURNAL — fin de tournée (avec bilan livrés/échecs pour le président).
      void logActivity(currentUser, ActivityAction.MISSION_COMPLETED, {
        targetType: 'mission', targetId: activeMission.id, targetName: `Tournée ${activeMission.zone || ''}`.trim(),
        outcome: 'success',
        description: `${currentUser.firstName} ${currentUser.lastName} a terminé sa tournée — ${activeMission.deliveredPackages || 0} livrés, ${activeMission.failedPackages || 0} échecs`,
        details: { metadata: { livrés: activeMission.deliveredPackages || 0, échecs: activeMission.failedPackages || 0, arrêts: activeMission.stops.length } }
      });
      showNotif('🏁 Tournée terminée — bravo !');
      setActiveMissionId(null); // repart sur la liste (la tournée n'est plus « en cours »)
    } catch (err) {
      reportError('driver.finishTour', err, { silent: true });
      setFinishError(err instanceof Error ? err.message : 'Impossible de terminer la tournée. Réessayez.');
    }
    setIsProcessing(false);
  };

  // Intention de livraison PAR COLIS : ensemble des IDs réellement remis, ESTAMPILLÉ
  // avec l'arrêt concerné. null = tous remis. Mémorisé dans un ref pour survivre au
  // retry GPS (qui rappelle handleDeliverySuccess sans argument). L'estampille
  // stopId est CRUCIALE : sans elle, une intention partielle laissée sur l'arrêt A
  // (ex. GPS annulé) « fuyait » sur l'arrêt B et marquait à tort ses colis en échec.
  const deliverIntentRef = useRef<{ stopId: string; ids: Set<string> } | null>(null);
  // Purge l'intention dès qu'on change d'arrêt (navigation) — double sécurité en
  // plus de la garde stopId ci-dessous.
  useEffect(() => { deliverIntentRef.current = null; }, [currentStop?.id]);

  // ===== MODE GUIDÉ (livraison « pris par la main ») =====
  // Le guide avance TOUT SEUL dès qu'une étape-action est terminée. On mémorise les
  // étapes déjà auto-franchies (par arrêt) pour NE PAS re-pousser le chauffeur en
  // avant s'il revient en arrière corriger quelque chose (avancement sur transition,
  // pas sur état). Réinitialisé à chaque changement d'arrêt.
  const autoAdvancedRef = useRef<Set<number>>(new Set());
  useEffect(() => { autoAdvancedRef.current.clear(); }, [currentStop?.id]);

  // Dès qu'on est (ou revient) à l'étape SCAN, on efface toute décision de scan
  // précédente (intention « colis absents » + bypass) et on ré-arme l'auto-avance :
  // si le chauffeur revient scanner les colis « absents » et les scanne pour de vrai,
  // ils ne doivent PLUS être marqués en échec, et le passage à l'étape suivante doit
  // pouvoir se refaire automatiquement.
  useEffect(() => {
    if (deliveryStep === 0) {
      deliverIntentRef.current = null;
      setScanBypass(false);
      autoAdvancedRef.current.delete(0);
    }
  }, [deliveryStep]);

  // Étape 1 (Colis) → dès que TOUS les colis de l'arrêt sont scannés : on referme le
  // scanner (s'il est ouvert) ET on passe à l'État. Le chauffeur enchaîne sans rien toucher.
  useEffect(() => {
    if (isPickupStop || currentStop?.status !== StopStatus.ARRIVED || deliveryStep !== 0) return;
    if (expectedStopCount > 0 && deliveryScannedCount >= expectedStopCount && !autoAdvancedRef.current.has(0)) {
      autoAdvancedRef.current.add(0);
      if (showScanner) setShowScanner(false);
      setDeliveryStep(1);
      setStepAnnouncement('Tous les colis sont scannés. Étape 2 sur 5 : état de la marchandise.');
    }
  }, [deliveryScannedCount, expectedStopCount, deliveryStep, currentStop?.status, isPickupStop, showScanner]);

  // Étape Preuve : PAS d'auto-avance. Le nombre de photos est variable (le chauffeur
  // peut en vouloir plusieurs) → on le laisse ajouter photo(s) + signature, puis
  // avancer lui-même via « Continuer ». Avancer dès la 1re photo l'empêchait d'en
  // ajouter une 2ᵉ (le guide passait à la validation avant).

  // Livraison réussie. `deliveredIds` = colis réellement remis (les autres colis
  // de l'arrêt sont marqués « non remis »/échec). Absent = reprendre l'intention
  // en cours pour CET arrêt (retry GPS), sinon tous remis.
  const handleDeliverySuccess = async (deliveredIds?: Set<string>) => {
    if (!activeMission || !currentStop) { deliverIntentRef.current = null; return; }
    if (deliveredIds !== undefined) {
      deliverIntentRef.current = { stopId: currentStop.id, ids: deliveredIds };
    }
    // Garde stopId : on n'utilise l'intention QUE si elle vise l'arrêt courant.
    const intent = deliverIntentRef.current;
    const idsToDeliver = intent && intent.stopId === currentStop.id ? intent.ids : null;
    // Trace du scan de contrôle (pour POD + historique colis)
    const scanTrace = stopPackages.length === 0
      ? undefined
      : deliveryScannedCount === stopPackages.length
        ? `Colis scannés: ${deliveryScannedCount}/${stopPackages.length}`
        : `⚠️ Validé sans scan complet (${deliveryScannedCount}/${stopPackages.length} scannés)`;
    setIsProcessing(true);
    // GPS OBLIGATOIRE : toute LIVRAISON doit avoir un point GPS précis (mode strict).
    // (La passation entre chauffeurs — prise en charge / transfert — n'est PAS
    // concernée : elle a son propre flux sans GPS obligatoire.)
    // Sans position, on NE valide PAS : on logue l'incident (plus d'échec silencieux)
    // et on affiche une modale bloquante qui force l'activation du GPS du téléphone.
    let coords: { lat: number; lng: number };
    const pos = await ensureGps(handleDeliverySuccess);
    if (!pos) { setIsProcessing(false); return; }
    coords = pos;
    let observation: ReturnType<typeof startUxTask> | null = null;
    try {
      const now = new Date().toISOString();
      const driverFullName = `${currentUser.firstName} ${currentUser.lastName}`;
      const linkFields = {
        missionId: activeMission.id,
        stopId: currentStop.id,
        currentDriverId: currentUser.id,
        currentVehicleId: activeMission.vehicleId
      };

      // Partition de l'arrêt : colis REMIS vs NON remis (déclarés absents).
      const stopIds = currentStop.packageIds;
      const deliverIds = stopIds.filter(id => !idsToDeliver || idsToDeliver.has(id));
      const failIds = stopIds.filter(id => idsToDeliver && !idsToDeliver.has(id));

      if (!deliverIds.length) throw new Error('Aucun colis remis : utilisez la déclaration d’échec de livraison.');
      const okDelivered = deliverIds, okFailed = failIds;
      observation = startUxTask('deliver', String(currentUser.role));
      const { allDone, stops: updatedStops } = await submitDelivery({
        id:`${currentUser.id}/${activeMission.id}/${currentStop.id}`,
        userId:currentUser.id, kind: 'success', createdAt:now,
        action: {
          missionId: activeMission.id, stopId: currentStop.id,
          stopPatch: {
          status: StopStatus.COMPLETED,
          completionTime: now,
          arrivalCoordinates: coords
        },
          packageOutcomes: stopIds.map(packageId => ({
            packageId, status: deliverIds.includes(packageId) ? PackageStatus.DELIVERED : PackageStatus.FAILED,
            movement: { action: deliverIds.includes(packageId) ? 'DELIVERED' : 'FAILED',
              driverId: currentUser.id, driverName:driverFullName,
              notes: deliverIds.includes(packageId) ? scanTrace : 'Colis déclaré non remis' }
          }))
        },
        proof: { missionId: activeMission.id,stopId: currentStop.id,packageIds:deliverIds,
          driverId: currentUser.id,driverName:driverFullName,vehicleId: activeMission.vehicleId || '',vehiclePlate: activeMission.vehiclePlate || '',
          recipientName:recipientName || undefined,deliveryLocation,merchandiseGoodCondition:merchandiseGood,
          reservesNote:merchandiseGood ? undefined : reservesNote,signatureBase64:signatureData || undefined,
          photosBase64:capturedPhotos,coordinates: coords,notes:scanTrace }
      });

      observation.finish('success', { items: stopIds.length });

      // 4bis. JOURNAL — livraison (succès + éventuels non remis). Trace « qui a livré
      //       quoi » visible par le président. Best-effort, n'interrompt jamais.
      void logActivity(currentUser, ActivityAction.PACKAGE_DELIVERED, {
        targetType: 'package', targetId: currentStop.id, targetName: currentStop.contactName || currentStop.address,
        outcome: 'success',
        description: `${currentUser.firstName} ${currentUser.lastName} a livré ${okDelivered.length} colis à ${currentStop.contactName || currentStop.city}${okFailed.length > 0 ? ` (${okFailed.length} non remis)` : ''}`,
        details: { metadata: { livrés: okDelivered.length, nonRemis: okFailed.length, ville: currentStop.city, gps: !!coords } }
      });

      // 6. FIX BUG 2: Trouver le prochain stop en attente dans l'ORDRE TRIÉ (par sequence)
      const updatedSorted = [...updatedStops].sort((a, b) => a.sequence - b.sequence);
      const nextSortedIdx = updatedSorted.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
      );
      if (nextSortedIdx >= 0) {
        setActiveStopIndex(nextSortedIdx);
      }

      // Reset UI
      deliverIntentRef.current = null; // repartir « tous livrés » pour le prochain stop
      setSignatureData(null);
      setCapturedPhotos([]);
      setRecipientName('');
      setDeliveryLocation(DeliveryLocation.HAND_DELIVERY);
      setShowSignature(false);
      setUploadProgress(null);
      setDeliveryStep(0);
      setMerchandiseGood(true);
      setReservesNote('');
      setShowReserves(false);

      const nonRemis = okFailed.length > 0 ? ` (${okFailed.length} non remis)` : '';
      showNotif(allDone ? `✅ Dernier arrêt livré${nonRemis} — terminez votre tournée` : `✅ Arrêt ${currentStop.sequence} livré !${nonRemis}`);
    } catch (err) {
      observation?.finish('error', { items: currentStop.packageIds.length, errors: 1 });
      // Ne PAS conserver une intention partielle après une erreur : elle pourrait
      // « fuiter » sur une prochaine livraison. Le chauffeur repart propre.
      deliverIntentRef.current = null;
      reportError('driver.delivery', err, { silent: true });
      showNotif(`❌ Erreur livraison${err instanceof Error ? ` — ${err.message}` : ''}`);
    }
    setIsProcessing(false);
  };

  // Échec livraison
  const handleDeliveryFailure = async () => {
    if (!activeMission || !currentStop || isProcessing) return;
    if (!failurePhotos.length) { showNotif('❌ Une photo est obligatoire pour déclarer l’échec.'); return; }
    setIsProcessing(true);
    let observation: ReturnType<typeof startUxTask> | null = null;
    try {
      let coords: { lat: number; lng: number } | undefined;
      try { coords = await getCurrentPosition(); } catch {}

      const now = new Date().toISOString();

      observation = startUxTask('deliver', String(currentUser.role));
      const { allDone, stops: updatedStops } = await submitDelivery({
        id:`${currentUser.id}/${activeMission.id}/${currentStop.id}`,userId:currentUser.id,kind:'failure',createdAt:now,
        action:{missionId: activeMission.id,stopId: currentStop.id,
          stopPatch:{status:StopStatus.FAILED,completionTime: now,arrivalCoordinates: coords},
          packageOutcomes:currentStop.packageIds.map(packageId=>({packageId,status:PackageStatus.FAILED,
            movement:{action:'FAILED',driverId: currentUser.id,driverName: `${currentUser.firstName} ${currentUser.lastName}`,notes:`${failureReason} ${failureNotes}`}}))},
        proof:{missionId: activeMission.id,stopId: currentStop.id,packageIds:currentStop.packageIds,
          driverId: currentUser.id,driverName: `${currentUser.firstName} ${currentUser.lastName}`,vehicleId: activeMission.vehicleId || '',vehiclePlate: activeMission.vehiclePlate || '',
          failureReason,failureNotes,photosBase64:failurePhotos,coordinates:coords ?? null}
      });

      observation.finish('success', { items: currentStop.packageIds.length });

      // FIX BUG 2: Prochain arrêt dans l'ORDRE TRIÉ
      const updatedSorted = [...updatedStops].sort((a, b) => a.sequence - b.sequence);
      const nextSortedIdx = updatedSorted.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
      );
      if (nextSortedIdx >= 0) setActiveStopIndex(nextSortedIdx);

      // Reset
      setShowFailureModal(false);
      setFailureReason(FailureReason.ABSENT);
      setFailureNotes('');
      setFailurePhotos([]);
      setUploadProgress(null);

      showNotif(allDone ? '✅ Dernier arrêt traité — terminez votre tournée' : `⚠️ Arrêt ${currentStop.sequence} — échec enregistré`);
    } catch (err) {
      observation?.finish('error', { items: currentStop.packageIds.length, errors: 1 });
      reportError('driver.markFailed', err, { silent: true });
      showNotif(`❌ Erreur${err instanceof Error ? ` — ${err.message}` : ''}`);
    }
    setIsProcessing(false);
  };

  // Photo livraison
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (capturedPhotos.length >= MAX_PHOTOS) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        setCapturedPhotos(prev => prev.length < MAX_PHOTOS ? [...prev, reader.result as string] : prev);
      }
    };
    reader.readAsDataURL(file);
    // Reset pour pouvoir reprendre la même photo
    e.target.value = '';
  };

  // Photo échec (preuve de tentative)
  const handleFailurePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (failurePhotos.length >= MAX_PHOTOS) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        setFailurePhotos(prev => prev.length < MAX_PHOTOS ? [...prev, reader.result as string] : prev);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ============================================================================
  // SCAN / ENLÈVEMENT
  // ============================================================================

  const handleBarcodeScan = (barcode: string) => {
    setScannedBarcodes(prev => {
      if (prev.some(b => b.toUpperCase() === barcode.toUpperCase())) return prev;
      return [...prev, barcode];
    });
  };

  // Optimiser l'ordre des arrêts depuis la position GPS du chauffeur
  const handleOptimizeTour = async () => {
    if (!activeMission || isOptimizing) return;
    setIsOptimizing(true);
    try {
      let coords: { lat: number; lng: number };
      try { coords = await getCurrentPosition(); } catch {
        showNotif('📍 Position GPS indisponible — activez la localisation');
        setIsOptimizing(false);
        return;
      }
      const n = await optimizeDriverMission(activeMission.id, coords);
      if (n === -1) showNotif('❌ Optimisation impossible (adresses non géolocalisées)');
      else if (n === 0) showNotif('Rien à optimiser');
      else showNotif(`🧭 Tournée optimisée — ${n} arrêts réordonnés`);
    } catch (e) {
      reportError('driver.optimize', e, { silent: true });
      showNotif(`❌ Erreur lors de l'optimisation${e instanceof Error ? ` — ${e.message}` : ''}`);
    }
    setIsOptimizing(false);
  };

  // Keep the exact mission, payload and request identity until the server confirms it.
  const openManualStop = () => {
    if (manualJournalError) { showNotif(manualJournalError); return; }
    if (pendingManualStop) setManualStop({ ...pendingManualStop.form });
    setManualStopError('');
    setShowManualStop(true);
  };
  const handleAddManualStop = async () => {
    if (isProcessing || manualStopLock.current || manualJournalError) return;
    if (!pendingManualStop && !activeMission) return;
    if (!pendingManualStop && (!manualStop.address.trim() || !manualStop.city.trim())) {
      setManualStopError('Adresse et ville obligatoires.');
      return;
    }
    manualStopLock.current = true;
    setIsProcessing(true);
    let request: PendingManualStop;
    try {
      // Re-read before sending: a request retained by this or another open tab wins.
      const retained = readPendingManualStop(localStorage, currentUser.id);
      request = retained || pendingManualStop || makeDriverManualStopRequest(activeMission!, manualStop, crypto.randomUUID());
      request = await reservePendingManualStop(localStorage, currentUser.id, request);
    } catch {
      manualStopLock.current = false;
      setIsProcessing(false);
      setManualStopError('La demande ne peut pas être conservée pour une reprise sûre. Aucun nouvel ajout n’a été envoyé. Vérifiez le stockage du navigateur, puis réessayez.');
      return;
    }
    setPendingManualStop(request);
    setManualStop({ ...request.form });
    setManualStopError('');
    try {
      const payload = stopFormPayload(request.form);
      await addManualStopToMission(request.missionId, { ...payload, contactPhone: payload.contactPhone || undefined, timeWindowStart: payload.timeWindowStart || undefined, timeWindowEnd: payload.timeWindowEnd || undefined, notes: payload.notes || undefined }, request.requestId);
      let journalCleared = true;
      try {
        await clearPendingManualStop(localStorage, currentUser.id, request.requestId);
        const retained = readPendingManualStop(localStorage, currentUser.id);
        setPendingManualStop(retained);
        setManualStop(retained ? { ...retained.form } : emptyDriverManualStop());
      } catch {
        journalCleared = false;
        setPendingManualStop(request);
      }
      setShowManualStop(false);
      showNotif(journalCleared ? 'L’arrêt manuel est confirmé dans la tournée.' : 'L’arrêt est confirmé. Sa référence de reprise reste conservée ; une nouvelle vérification ne créera pas de doublon.');
    } catch (error) {
      reportError('driver.addManualStop', error, { silent: true });
      setManualStopError('Le résultat de cet ajout n’est pas confirmé. Vérifiez cette même demande : les informations et la référence sont conservées pour éviter un deuxième arrêt.');
    } finally {
      manualStopLock.current = false;
      setIsProcessing(false);
    }
  };

  // Signaler un problème depuis la tournée (crée un incident vu par le bureau)
  const handleSubmitIssue = async () => {
    if (!issueForm.description.trim()) { showNotif('⚠️ Décrivez le problème'); return; }
    setIssueSubmitting(true);
    try {
      const now = new Date().toISOString();
      const issue: Issue = {
        id: '',
        vehicleId: activeMission?.vehicleId || '',
        reportedByUserId: currentUser.id,
        reportedBy: `${currentUser.firstName} ${currentUser.lastName}`,
        description: `[${issueForm.category}] ${issueForm.description.trim()}`,
        date: now,
        priority: issueForm.priority,
        status: IssueStatus.NEW,
        logs: [{
          id: `log-${now}`,
          date: now,
          message: `Signalé depuis la tournée par ${currentUser.firstName} ${currentUser.lastName}`,
          authorName: `${currentUser.firstName} ${currentUser.lastName}`,
          type: 'NOTE'
        }]
      };
      await addIssueToFirestore(issue);
      setShowIssue(false);
      setIssueForm({ category: 'Véhicule / panne', description: '', priority: 'Medium' });
      showNotif('🛠️ Problème signalé au bureau');
    } catch (e) {
      reportError('driver.reportIssue', e, { silent: true });
      showNotif(`❌ Erreur lors du signalement${e instanceof Error ? ` — ${e.message}` : ''}`);
    }
    setIssueSubmitting(false);
  };

  const handlePickupComplete = async (scannedIds: string[], missingIds: string[], signatureBase64?: string) => {
    if (!activeMission || !currentStop) return;
    setIsProcessing(true);
    try {
      let coords: { lat: number; lng: number } | undefined;
      try { coords = await getCurrentPosition(); } catch {}

      const now = new Date().toISOString();

      // 1. Finaliser l'enlèvement (MAJ colis → COLLECTED + manifeste)
      const manifest = await finalizePickup({
        missionId: activeMission.id,
        stopId: currentStop.id,
        clientId: activeMission.clientId || '',
        clientName: currentStop.contactName,
        driverId: currentUser.id,
        driverName: `${currentUser.firstName} ${currentUser.lastName}`,
        vehicleId: activeMission.vehicleId || '',
        vehiclePlate: activeMission.vehiclePlate || '',
        address: `${currentStop.address}, ${currentStop.postalCode} ${currentStop.city}`,
        coordinates: coords,
        expectedPackageIds: currentStop.packageIds,
        scannedPackageIds: scannedIds,
        missingPackageIds: missingIds,
        unknownBarcodes: scannedBarcodes.filter(b => !stopPackages.some(p => packageMatchesCode(p, b))),
        signatureBase64
      });

      if (!manifest) throw new Error('Enlèvement non enregistré : vos scans sont conservés.');
      // 2. MAJ du stop — patch ATOMIQUE (relecture fraîche + compteurs).
      const { allDone, stops: updatedStops } = await commitStopOutcome({
        missionId: activeMission.id,
        stopId: currentStop.id,
        stopPatch: {
          status: StopStatus.COMPLETED,
          completionTime: now,
          arrivalCoordinates: coords
        },
        deliveredDelta: scannedIds.length
      });

      // 3. Prochain arrêt
      const updatedSorted = [...updatedStops].sort((a, b) => a.sequence - b.sequence);
      const nextIdx = updatedSorted.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
      );
      if (nextIdx >= 0) setActiveStopIndex(nextIdx);

      // Reset
      setScannedBarcodes([]);
      setShowScanner(false);

      showNotif(
        allDone 
          ? '✅ Dernier enlèvement traité — terminez votre tournée'
          : `✅ Enlèvement terminé — ${scannedIds.length}/${currentStop.packageIds.length} colis collectés`
      );
    } catch (err) {
      reportError('driver.pickup', err, { silent: true });
      showNotif(`❌ Erreur enlèvement${err instanceof Error ? ` — ${err.message}` : ''}`);
    }
    setIsProcessing(false);
  };

  // Navigation externe
  const openNavigation = (stop: MissionStop) => {
    const addr = encodeURIComponent(`${stop.address}, ${stop.postalCode} ${stop.city}`);
    if (stop.coordinates) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${stop.coordinates.lat},${stop.coordinates.lng}`, '_blank');
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${addr}`, '_blank');
    }
  };

  // Appel téléphonique
  const callContact = (phone: string) => {
    window.open(`tel:${phone}`, '_self');
  };

  const manualStopRecovery = (pendingManualStop || manualJournalError) && (
    <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-950">
      {manualJournalError ? (
        <p>{manualJournalError}</p>
      ) : (
        <>
          <p className="font-semibold">
            Un ajout d’arrêt reste à confirmer — tournée du{" "}
            {pendingManualStop!.date}.
          </p>
          <p>
            Votre demande est conservée sur ce téléphone. Vérifiez son résultat
            avant de créer un nouvel arrêt.
          </p>
          <button
            type="button"
            disabled={isProcessing}
            onClick={openManualStop}
            className="ui-button ui-button-secondary mt-2"
          >
            Reprendre la demande d’arrêt
          </button>
        </>
      )}
    </div>
  );
  const manualStopDialog = (
    <Modal
      mobileFullscreen
      isOpen={showManualStop}
      onClose={() => { void closeManual(() => setShowManualStop(false)); }}
      title={pendingManualStop ? 'Vérifier l’ajout d’arrêt' : 'Ajouter un arrêt manuel'}
      preventClose={isProcessing}
      size="lg"
      footer={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isProcessing || !!manualJournalError}
            onClick={handleAddManualStop}
            className="ui-button ui-button-primary flex-1"
          >
            {isProcessing ? 'Vérification…' : pendingManualStop ? 'Vérifier cette demande' : 'Ajouter l’arrêt'}
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => { void closeManual(() => setShowManualStop(false)); }}
            className="ui-button ui-button-secondary"
          >
            {pendingManualStop ? 'Fermer — demande conservée' : 'Annuler'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Cet arrêt n’a pas de colis rattaché et ne provient pas d’un import
          client. Il ne sera pas suivi dans le portail client. À utiliser
          uniquement pour un passage exceptionnel.
        </p>
        {pendingManualStop && (
          <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
            Tournée du {pendingManualStop.date}. Les champs sont verrouillés
            jusqu’à confirmation de la demande initiale. Vous pourrez ensuite
            demander une modification au bureau.
          </p>
        )}
        {manualStopError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
            {manualStopError}
          </p>
        )}
        <fieldset disabled={isProcessing || !!pendingManualStop || !!manualJournalError} className="space-y-3">
          <FormInput label="Nom du destinataire" value={manualStop.contactName} onChange={event => setManualStop(previous => ({ ...previous, contactName: event.target.value }))} hint="Optionnel" />
          <FormInput label="Adresse" required value={manualStop.address} onChange={event => setManualStop(previous => ({ ...previous, address: event.target.value }))} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput label="Code postal" inputMode='numeric' autoComplete="postal-code" value={manualStop.postalCode} onChange={event => setManualStop(previous => ({ ...previous, postalCode: event.target.value }))} />
            <FormInput label="Ville" required value={manualStop.city} onChange={event => setManualStop(previous => ({ ...previous, city: event.target.value }))} />
          </div>
          <FormInput label="Téléphone" type="tel" autoComplete="tel" value={manualStop.contactPhone} onChange={event => setManualStop(previous => ({ ...previous, contactPhone: event.target.value }))} hint="Optionnel" />
        </fieldset>
      </div>
    </Modal>
  );

  // ============================================================================
  // RENDU — Loading
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className='text-slate-500'>Chargement de vos tournées...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDU — Aucune mission
  // ============================================================================

  if (missions.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-6 pt-10 pb-6 text-center space-y-5">
        {manualStopRecovery}
        {manualStopDialog}
        {notification && (
          <div role="status" className="bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-center text-sm font-medium animate-fade-in">
            <NotificationText message={notification} />
          </div>
        )}
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
          <Truck size={36} className="text-slate-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">
            Aucune tournée aujourd'hui
          </h2>
          <p className="text-slate-500 text-sm">
            Scannez des colis pour démarrer votre tournée, ou attendez que le
            bureau vous en affecte une.
          </p>
        </div>
        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        <button
          onClick={() => setShowScanChoice(true)}
          className="ui-button ui-button-primary w-full gap-2"
        >
          <Camera
            size={18}
            className="inline shrink-0 align-text-bottom"
            aria-hidden="true"
          />{" "}
          Scanner des colis
        </button>

        {renderScanChoice()}
        {showClaimModal && (
        <ClaimScanModal
          currentUser={currentUser}
          clients={clients}
          confirmLabel="Commencer ma tournée"
          onClose={() => setShowClaimModal(false)}
          onDone={(count) => {
            setShowClaimModal(false);
            if (count > 0) {
              setActiveMissionId(`DLV-${currentUser.id}-${today}`);
              setActiveStopIndex(0);
              showNotif(`🚚 ${count} colis chargé${count > 1 ? 's' : ''} — en route !`);
            }
          }}
        />
      )}
      </div>
    );
  }

  // ============================================================================
  // RENDU — Vue active (navigation stop-par-stop)
  // ============================================================================

  if (activeMission && activeMission.status === MissionStatus.IN_PROGRESS) {
    return (
      <div className="max-w-lg mx-auto pb-6 space-y-3 animate-fade-in">
        {manualStopRecovery}
        {manualStopDialog}
        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {notification && (
          <div role="status" className="bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-center text-sm font-medium animate-fade-in">
            <NotificationText message={notification} />
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="ui-button ui-button-ghost !text-white ml-2 underline"
            >
              Masquer
            </button>
          </div>
        )}

        <Modal isOpen={showFinishBlocked} onClose={() => setShowFinishBlocked(false)} title="Bilan avant de terminer la tournée" size="lg" preventClose={isProcessing}>
          <p className="text-sm text-slate-600 mb-4">
            Vérifiez les arrêts, les retours au hub et l’envoi des preuves. La
            clôture est confirmée après vérification du serveur.
          </p>
          <div className="space-y-4">
            <section>
              <h4 className="font-bold text-base">
                {remainingStops} arrêt{remainingStops > 1 ? 's' : ''} à traiter
              </h4>
              {sortedStops.map(
                (stop, index) =>
                  ![StopStatus.COMPLETED, StopStatus.FAILED, StopStatus.SKIPPED].includes(stop.status) && (
                    <button
                      key={stop.id}
                      type="button"
                      onClick={() => openStop(index)}
                      className="ui-button ui-button-secondary mt-2 w-full text-left"
                    >
                      <b>Arrêt {stop.sequence}</b> ·{" "}
                      {stop.contactName || stop.address}
                      <span className="block text-sm text-slate-600">
                        {stop.address} · {stopStatusLabel(stop.status)} → Ouvrir
                        l’arrêt
                      </span>
                    </button>
                  ),
              )}
            </section>
            <section>
              <h4 className="font-bold text-base">
                {activeReturns.length} colis à remettre au hub
              </h4>
              {activeReturns.map((pkg) => (
                <button
                  type="button"
                  key={pkg.id}
                  onClick={() => { setShowFinishBlocked(false); openReturnModal(pkg); }}
                  className="ui-button ui-button-secondary mt-2 w-full text-left"
                >
                  {packageDisplayCode(pkg)} · {pkg.contactName}
                  <span className="block text-sm">
                    Confirmer la remise au hub →
                  </span>
                </button>
              ))}
            </section>
            <section>
              <h4 className="font-bold text-base">
                {proofStopIds.size} arrêt{proofStopIds.size > 1 ? 's' : ''} avec
                un envoi en attente
              </h4>
              {pendingProofError && (
                <p role="alert" className="text-sm text-red-800 mt-2">
                  {pendingProofError}
                </p>
              )}
              <button
                type="button"
                onClick={openPendingProofs}
                className="ui-button ui-button-secondary mt-2"
              >
                Voir les preuves et réessayer l’envoi
              </button>
            </section>
            {!online && (
              <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-950">
                Reconnectez le téléphone pour demander la clôture. Vos preuves
                restent conservées sur cet appareil.
              </p>
            )}
            {closureNeedsAttention ? (
              <p className="text-sm text-slate-700">
                Ouvrez les éléments ci-dessus pour terminer ce qui reste à
                faire.
              </p>
            ) : (
              <button
                type="button"
                disabled={isProcessing || !online}
                onClick={handleFinishTour}
                className="ui-button ui-button-primary w-full"
              >
                {isProcessing ? 'Vérification de la tournée…' : 'Confirmer la fin de ma tournée'}
              </button>
            )}
          </div>
        </Modal>

        {finishError && (
          <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            {finishError}
          </div>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {allStopsDone && (
          <div className="ui-panel p-4 space-y-3">
            <p className="flex items-start gap-2 text-lg font-bold text-slate-900">
              <CheckCircle size={22} className="text-green-700 shrink-0" />
              Tous les arrêts sont traités
            </p>
            <p className="text-sm text-slate-700">
              Vérifiez les retours et les preuves avant de terminer la tournée.
            </p>
            <button
              onClick={requestFinishTour}
              disabled={isProcessing}
              className="ui-button ui-button-primary w-full"
            >
              {isProcessing ? (
                <Loader2 size={18} className="animate-spin inline" />
              ) : closureNeedsAttention ? (
                'Voir ce qu’il reste à faire'
              ) : (
                'Vérifier et terminer ma tournée'
              )}
            </button>
          </div>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {currentStop && (
          <div ref={stopCardRef} className="scroll-mt-4 bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-3 pt-2 pb-3 space-y-2">
              <div className="flex items-center gap-2 min-h-11">
                <span className="text-sm font-medium text-slate-600">
                  Arrêt {currentStop.sequence}/{sortedStops.length}
                </span>
                <span
                  className={`text-sm font-semibold ${currentStop.status === StopStatus.COMPLETED ? "text-green-800" : currentStop.status === StopStatus.FAILED ? "text-red-800" : "text-brand-800"}`}
                >
                  {stopStatusLabel(currentStop.status)}
                </span>
                {isPickupStop && (
                  <span className="inline-flex items-center gap-1 text-sm text-slate-700">
                    <PackageIcon aria-hidden="true" size={16} />
                    Enlèvement
                  </span>
                )}
                {!currentStopDone && currentStop.contactPhone && (
                  <button
                    type="button"
                    onClick={() => callContact(currentStop.contactPhone!)}
                    aria-label={`Appeler ${currentStop.contactName || 'le destinataire'}`}
                    title="Appeler le destinataire"
                    className="ui-button ui-button-secondary ml-auto shrink-0"
                  >
                    <Phone aria-hidden="true" size={18} />
                    <span className="sr-only">Appeler</span>
                  </button>
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-900 break-words leading-snug">
                {currentStop.contactName || 'Sans contact'}
              </h3>
              <p className="flex items-start gap-2 text-base text-slate-700 leading-snug">
                <MapPin
                  aria-hidden="true"
                  size={18}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  {currentStop.address}, {currentStop.postalCode}{" "}
                  {currentStop.city}
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <PackageIcon aria-hidden="true" size={16} />
                  {currentStop.packageCount} colis
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock aria-hidden="true" size={16} />
                  Environ {currentStop.serviceTime} min
                </span>
                {currentStop.floor != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 aria-hidden="true" size={16} />
                    Étage {currentStop.floor}
                    {currentStop.hasElevator ? " · ascenseur" : ''}
                  </span>
                )}
                {(currentStop.timeWindowStart || currentStop.timeWindowEnd) && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-amber-900">
                    <Clock aria-hidden="true" size={16} />
                    {currentStop.timeWindowStart && currentStop.timeWindowEnd ? `${currentStop.timeWindowStart} – ${currentStop.timeWindowEnd}` : currentStop.timeWindowStart ? `À partir de ${currentStop.timeWindowStart}` : `Avant ${currentStop.timeWindowEnd}`}
                  </span>
                )}
              </div>
              {!isPickupStop && !currentStopDone &&
                deliveryStep > 0 &&
                stopPackages.length > 0 && (
                  <details className="text-sm text-slate-700">
                    <summary className="min-h-11 flex items-center cursor-pointer font-medium">
                      Références des {stopPackages.length} colis
                    </summary>
                    <ul className="space-y-1 pb-2">
                      {stopPackages.map((pkg) => (
                        <li key={pkg.id} className="break-all font-mono">
                          {packageDisplayCode(pkg) || "Sans code"}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

              {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
              {!isPickupStop && currentStop.status !== StopStatus.COMPLETED && otherAtAddress.length > 0 && (
                  <div className="mt-2 p-3 bg-red-50 border-2 border-red-300 rounded-lg">
                    <p className="text-sm font-black text-red-700 flex items-center gap-1.5">
                      <XCircle size={14} />À vérifier : {otherAtAddress.length}{" "}
                      autre{otherAtAddress.length > 1 ? 's' : ''} colis à cette
                      adresse !
                    </p>
                    <p className="text-sm text-red-800 mt-1">
                      {stopPackages.length + otherAtAddress.length} colis
                      semblent destinés à ce client, vous n’en avez que{" "}
                      <b>{stopPackages.length}</b> dans cet arrêt. Vérifiez avec
                      le client avant de repartir.
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {otherAtAddress.map((p) => (
                        <span key={p.id} className="px-2 py-1 bg-white border border-red-200 rounded-lg text-sm font-mono font-bold text-red-700">
                          {p.externalId || p.barcode}
                        </span>
                      ))}
                    </div>
                    {claimableOthers.length > 0 && (
                      <button
                        onClick={handleClaimOthersToStop}
                        disabled={isClaimingOthers}
                        className="ui-button ui-button-primary mt-2 w-full gap-2"
                      >
                        {isClaimingOthers ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <PackageIcon size={14} />
                        )}
                        Ajouter {claimableOthers.length} colis à cet arrêt
                      </button>
                    )}
                  </div>
                )}

              {!currentStopDone && currentStop.notes && (
                <p className="flex items-start gap-2 border-l-2 border-amber-400 pl-2 text-sm text-amber-900">
                  <StickyNote
                    aria-hidden="true"
                    size={16}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="whitespace-pre-wrap break-words">
                    {currentStop.notes}
                  </span>
                </p>
              )}
            </div>

            {!currentStopDone && currentStop.status !== StopStatus.ARRIVED && (
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={() => openNavigation(currentStop)}
                  className="ui-button ui-button-secondary w-full"
                >
                  <Navigation aria-hidden="true" size={18} />
                  Naviguer vers cet arrêt
                </button>
              </div>
            )}

            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            {currentStop.status !== StopStatus.COMPLETED && currentStop.status !== StopStatus.FAILED && currentStop.status !== StopStatus.SKIPPED && (
                <div className="p-3 border-t border-slate-100 space-y-2">
                  {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                  {currentStop.status === StopStatus.PENDING && (
                    <button
                      onClick={handleArriveAtStop}
                      disabled={isProcessing}
                      className="ui-button ui-button-primary w-full gap-2"
                    >
                      {isProcessing ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <MapPinned size={18} />
                      )}
                      Je suis arrivé
                    </button>
                  )}

                  {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                  {currentStop.status === StopStatus.ARRIVED && isPickupStop && (
                  /* ===== MODE ENLÈVEMENT (PICKUP) ===== */
                  <PickupScanView
                    expectedPackages={stopPackages.map(p => ({
                      id: p.id,
                      orderNumber: p.orderNumber,
                      barcode: p.barcode,
                      externalId: p.externalId,
                      contactName: p.contactName,
                      address: p.address,
                      city: `${p.postalCode} ${p.city}`,
                      comment: p.comment,
                      weight: p.weight
                    }))}
                    clientName={currentStop.contactName}
                    stopAddress={`${currentStop.address}, ${currentStop.postalCode} ${currentStop.city}`}
                    onComplete={handlePickupComplete}
                    onOpenScanner={() => setShowScanner(true)}
                    scannedBarcodes={scannedBarcodes}
                    isProcessing={isProcessing}
                  />
                )}

                  {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                  {currentStop.status === StopStatus.ARRIVED && !isPickupStop && (
                      <>
                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        <p role="status" aria-live="polite" className="text-base font-bold text-slate-900 px-1">
                          Étape {deliveryStep + 1} sur {DELIVERY_STEPS.length} ·{" "}
                          {DELIVERY_STEPS[deliveryStep]}
                        </p>
                        <p className="sr-only" aria-live="polite">
                          {stepAnnouncement}
                        </p>
                        <div
                          aria-hidden="true"
                          className="flex gap-1 px-1 pb-1"
                        >
                          {DELIVERY_STEPS.map((label, index) => (
                            <div
                              key={label}
                              title={label}
                              className={`h-1 flex-1 rounded-full ${index <= deliveryStep ? "bg-brand-700" : 'bg-slate-200'}`}
                            />
                          ))}
                        </div>

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        {deliveryStep === 0 && (
                          <div className="space-y-2">
                            {stopPackages.length > 0 ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-bold text-slate-700">
                                    Colis scannés : {deliveryScannedCount}/
                                    {stopPackages.length}
                                  </p>
                                  <button
                                    onClick={() => setShowScanner(true)}
                                    className={`ui-button ${allStopScanned ? "ui-button-secondary" : "ui-button-primary"} gap-1.5`}
                                  >
                                    <ScanLine aria-hidden="true" size={18} />
                                    Scanner
                                  </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {stopPackages.map((p) => {
                                    const ok = scannedStopIds.has(p.id);
                                    const noCode = packageScanCodes(p).length === 0;
                                    return (
                                      <span
                                        key={p.id}
                                        title={noCode ? 'Ce colis n’a pas de code scannable — à valider en « Forcer »' : undefined}
                                        className={`max-w-full break-all px-2 py-1 rounded-lg text-sm font-mono font-bold border ${
                                          ok
                                        ? 'bg-green-50 border-green-300 text-green-700'
                                        : noCode
                                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                                          : 'bg-slate-50 border-slate-200 text-slate-500'
                                    }`}
                                      >
                                        {ok ? (
                                          <CheckCircle
                                            aria-hidden="true"
                                            size={16}
                                            className="inline mr-1"
                                          />
                                        ) : noCode ? (
                                          <AlertTriangle
                                            aria-hidden="true"
                                            size={16}
                                            className="inline mr-1"
                                          />
                                        ) : null}
                                        {packageDisplayCode(p) || "Sans code"}
                                      </span>
                                    );
                                  })}
                                </div>
                                {!allStopScanned && (
                                  <p className="flex items-start gap-2 text-sm text-amber-900">
                                    <AlertTriangle
                                      aria-hidden="true"
                                      size={18}
                                      className="mt-0.5 shrink-0"
                                    />
                                    <span>
                                      {missingStopCodes.length} colis non scanné
                                      {missingStopCodes.length > 1 ? 's' : ''}.
                                      Scannez{" "}
                                      {missingStopCodes.length > 1
                                        ? "les colis"
                                        : 'le colis'}
                                      , ou utilisez Continuer pour déclarer une
                                      exception.
                                    </span>
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-slate-500 px-1">
                                Aucun colis listé pour ce point.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        {deliveryStep === 1 && (
                          <div className="space-y-3">
                            <p className="text-lg font-black text-slate-800 px-1">
                              La marchandise est-elle en bon état ?
                            </p>
                            {!showReserves ? (
                              <div className="grid grid-cols-2 gap-2.5">
                                <button
                                  onClick={() => { setMerchandiseGood(true); setReservesNote(''); setShowReserves(false); setDeliveryStep(2); }}
                                  className="ui-button ui-button-primary flex-col gap-1.5"
                                >
                                  <CheckCircle size={26} /> Oui, bon état
                                </button>
                                <button
                                  onClick={() => { setMerchandiseGood(false); setShowReserves(true); }}
                                  className="ui-button ui-button-secondary flex-col gap-1.5"
                                >
                                  <AlertTriangle size={26} /> Non, réserves
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2 px-1">
                                <div className="flex items-center justify-between">
                                  <label htmlFor="delivery-reserves" className="text-sm font-bold text-amber-700 block">
                                    <AlertTriangle
                                      size={18}
                                      className="inline shrink-0 align-text-bottom"
                                      aria-hidden="true"
                                    />{" "}
                                    Décrivez la réserve :
                                  </label>
                                  {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                                  <button
                                    onClick={() => { setShowReserves(false); setMerchandiseGood(true); setReservesNote(''); }}
                                    className="ui-button ui-button-ghost underline"
                                  >
                                    ← Changer
                                  </button>
                                </div>
                                <textarea id="delivery-reserves"
                              value={reservesNote}
                              onChange={(e) => setReservesNote(e.target.value)}
                              placeholder="Colis manquant, emballage endommagé, contenu non conforme…"
                              rows={3}
                              className="w-full px-3 py-2.5 border border-amber-300 rounded-lg text-base focus:ring-2 focus:ring-amber-200 outline-none"
                            />
                                <button
                                  onClick={() => setDeliveryStep(2)}
                                  disabled={!reservesNote.trim()}
                                  className="ui-button ui-button-primary w-full disabled:cursor-not-allowed"
                                >
                                  Continuer{" "}
                                  <ChevronRight size={18} aria-hidden="true" />
                                </button>
                                {!reservesNote.trim() && (
                                  <p className="text-sm text-amber-800 font-medium text-center">
                                    Décrivez la réserve pour continuer
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        {deliveryStep === 2 && (
                          <div className="space-y-3">
                            <p className="text-lg font-black text-slate-800 px-1">
                              Qui réceptionne le colis ?
                            </p>
                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            <div className="px-1">
                              <label htmlFor="delivery-recipient" className="text-sm font-medium text-slate-500 mb-1 block">
                                Nom du réceptionnaire
                                <span className="text-red-700 ml-1">*</span>
                              </label>
                              <input
                                id="delivery-recipient"
                                autoComplete="name"
                                type="text"
                                value={recipientName}
                                onChange={(e) => setRecipientName(e.target.value)}
                                placeholder="Nom de la personne qui réceptionne"
                                className="w-full px-3 py-3 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-brand-200 focus:border-brand-400 outline-none"
                              />
                            </div>
                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            <div className="px-1">
                              <label className="text-sm font-medium text-slate-500 mb-1 block">
                                <MapPin
                                  size={18}
                                  className="inline shrink-0 align-text-bottom"
                                  aria-hidden="true"
                                />{" "}
                                Lieu de remise
                              </label>
                              <div className="grid grid-cols-2 gap-1.5">
                                {Object.values(DeliveryLocation).map((loc) => (
                                  <button
                                    key={loc}
                                    onClick={() => setDeliveryLocation(loc as DeliveryLocation)}
                                    aria-pressed={deliveryLocation === loc}
                                    className={`ui-button ui-button-secondary !justify-start text-left ${deliveryLocation === loc ? "!border-brand-600 !bg-brand-50 !text-brand-900 ring-1 ring-brand-600" : ''}`}
                                  >
                                    {loc === DeliveryLocation.HAND_DELIVERY && (
                                      <Handshake
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc === DeliveryLocation.NEIGHBOR && (
                                      <Home
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc === DeliveryLocation.CONCIERGE && (
                                      <KeyRound
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc === DeliveryLocation.MAILBOX && (
                                      <Mail
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc === DeliveryLocation.RECEPTION && (
                                      <Building2
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc === DeliveryLocation.SAFE_PLACE && (
                                      <Lock
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc === DeliveryLocation.OTHER && (
                                      <ClipboardList
                                        size={18}
                                        className="shrink-0"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {loc}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            <button
                              onClick={() => setDeliveryStep(3)}
                              disabled={!recipientName.trim()}
                              className="ui-button ui-button-primary w-full disabled:cursor-not-allowed"
                            >
                              C’est bon{" "}
                              <ChevronRight size={18} aria-hidden="true" />
                            </button>
                            {!recipientName.trim() && (
                              <p className="text-sm text-amber-800 font-medium text-center px-2">
                                Saisissez le nom pour continuer
                              </p>
                            )}
                          </div>
                        )}

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        {deliveryStep === 3 && (
                          <div className="space-y-3">
                            <p className="text-lg font-black text-slate-800 px-1">
                              Prends 1 photo, puis fais signer
                            </p>
                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            {!showSignature && !signatureData && (
                              <button
                                onClick={() => setShowSignature(true)}
                                className="ui-button ui-button-secondary w-full gap-2 border-dashed"
                              >
                                <PenTool size={16} />
                                <PenTool
                                  size={18}
                                  className="inline shrink-0 align-text-bottom"
                                  aria-hidden="true"
                                />{" "}
                                Capturer la signature *
                              </button>
                            )}

                            {showSignature && (
                          <SignaturePad
                            onSave={(data) => { setSignatureData(data); setShowSignature(false); }}
                            onCancel={() => setShowSignature(false)}
                            driverName={`${currentUser.firstName} ${currentUser.lastName}`}
                          />
                        )}

                            {signatureData && (
                              <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl">
                                <CheckCircle size={16} className="text-green-700" />
                                <span className="text-sm text-green-700 font-bold flex-1">
                                  Signature enregistrée
                                </span>
                                <button
                                  onClick={() => { setSignatureData(null); setShowSignature(true); }}
                                  className="ui-button ui-button-ghost underline"
                                >
                                  Refaire
                                </button>
                              </div>
                            )}

                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            <div className="px-1">
                              <label className="text-sm font-medium text-slate-500 mb-1.5 block">
                                <Camera
                                  size={18}
                                  className="inline shrink-0 align-text-bottom"
                                  aria-hidden="true"
                                />{" "}
                                Photos de la livraison{" "}
                                <span className="text-red-700">*</span>
                                <span className="block text-sm text-slate-600 font-normal mt-0.5">
                                  1 photo minimum. Tu peux en ajouter d'autres
                                  (jusqu'à {MAX_PHOTOS}) en réappuyant sur le
                                  bouton.
                                </span>
                              </label>
                              <button
                            onClick={() => photoInputRef.current?.click()}
                            disabled={capturedPhotos.length >= MAX_PHOTOS}
                            className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                              capturedPhotos.length === 0
                                ? 'bg-blue-600 text-white'
                                : 'bg-white border-2 border-blue-500 text-blue-700'
                            }`}
                          >
                                <Camera size={18} />
                                {capturedPhotos.length >= MAX_PHOTOS
                                  ? `Maximum atteint (${MAX_PHOTOS}/${MAX_PHOTOS})`
                                  : capturedPhotos.length === 0
                                    ? 'Prendre une photo'
                                    : `Ajouter une autre photo (${capturedPhotos.length}/${MAX_PHOTOS})`}
                              </button>
                              <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={handlePhotoCapture}
                          />
                            </div>

                            {capturedPhotos.length > 0 && (
                              <div className="flex gap-2 px-1 overflow-x-auto pb-1">
                                {capturedPhotos.map((photo, i) => (
                                  <div key={i} className="relative flex-shrink-0">
                                    <img src={photo} alt={`Photo ${i + 1}`} className="w-20 h-20 rounded-lg object-cover border-2 border-slate-200" />
                                    <button
                                      aria-label={`Supprimer la photo de livraison ${i + 1}`}
                                      onClick={() => setCapturedPhotos(prev => prev.filter((_, idx) => idx !== i))}
                                      className="ui-button ui-button-danger absolute -top-1.5 -right-1.5 w-11 h-11"
                                    >
                                      <X
                                        size={18}
                                        className="inline shrink-0 align-text-bottom"
                                        aria-hidden="true"
                                      />
                                    </button>
                                    <span className="absolute bottom-0.5 left-0.5 bg-black/50 text-white text-sm px-1 rounded">
                                      {i + 1}/{capturedPhotos.length}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {!signatureData && (
                              <p className="text-sm text-amber-800 font-medium text-center px-2">
                                <AlertTriangle
                                  size={18}
                                  className="inline shrink-0 align-text-bottom"
                                  aria-hidden="true"
                                />{" "}
                                Signature obligatoire pour valider la livraison
                              </p>
                            )}
                            {capturedPhotos.length === 0 && (
                              <p className="text-sm text-amber-800 font-medium text-center px-2">
                                <AlertTriangle
                                  size={18}
                                  className="inline shrink-0 align-text-bottom"
                                  aria-hidden="true"
                                />{" "}
                                Au moins 1 photo obligatoire (une seule photo du
                                lot suffit)
                              </p>
                            )}
                          </div>
                        )}

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        {deliveryStep === 4 && (
                          <div className="space-y-3">
                            <p className="text-lg font-black text-slate-800 px-1">
                              Valide la livraison
                            </p>
                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm space-y-1.5">
                              <div className="flex justify-between">
                                <span className='text-slate-500'>Colis</span>
                                <span className="font-bold">
                                  {stopPackages.length}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className='text-slate-500'>
                                  État marchandise
                                </span>
                                <span className={`font-bold ${merchandiseGood ? 'text-green-700' : 'text-amber-700'}`}>
                                  {merchandiseGood ? 'Bon état' : 'Réserves'}
                                </span>
                              </div>
                              {!merchandiseGood && reservesNote.trim() && (
                                <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
                                  {reservesNote.trim()}
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span className='text-slate-500'>
                                  Réceptionné par
                                </span>
                                <span className="font-bold">
                                  {recipientName || '—'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className='text-slate-500'>
                                  Lieu de remise
                                </span>
                                <span className="font-bold">
                                  {deliveryLocation}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className='text-slate-500'>
                                  Signature
                                </span>
                                <span className="font-bold">
                                  {signatureData ? (
                                    <CheckCircle
                                      size={18}
                                      aria-label="Enregistrée"
                                    />
                                  ) : (
                                    '—'
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className='text-slate-500'>Photos</span>
                                <span className="font-bold">
                                  {capturedPhotos.length}
                                </span>
                              </div>
                            </div>

                            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                            {uploadProgress && uploadProgress.step !== 'done' && uploadProgress.step !== 'error' && (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Loader2 size={14} className="animate-spin text-blue-600" />
                                    <span className="text-sm font-bold text-blue-700">
                                      {uploadProgress.message}
                                    </span>
                                  </div>
                                  <div className="w-full bg-blue-100 rounded-full h-2">
                                    <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%` }}
                              />
                                  </div>
                                </div>
                              )}

                            <button
                              onClick={() => { if (scanRequirementMet) { handleDeliverySuccess(); } else { setScanGateFrom('final'); setShowScanGate(true); } }}
                              disabled={isProcessing || !signatureData || !recipientName.trim() || capturedPhotos.length === 0}
                              className="ui-button ui-button-primary w-full gap-2 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? (
                                <Loader2 size={18} className="animate-spin" />
                              ) : (
                                <CheckCircle size={18} />
                              )}
                              Livré <CheckCircle size={18} aria-hidden="true" />
                            </button>
                          </div>
                        )}

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        <div className="flex gap-2 pt-1">
                          {deliveryStep > 0 && (
                            <button
                              onClick={() => setDeliveryStep(s => Math.max(0, s - 1))}
                              disabled={isProcessing}
                              className="ui-button ui-button-secondary"
                            >
                              <ArrowLeft size={18} aria-hidden="true" />
                              Retour
                            </button>
                          )}
                          {(deliveryStep === 0 || deliveryStep === 3) && (
                            <button
                              onClick={() => {
                            // À l'étape SCAN : si tout n'est pas scanné, on ouvre le
                            // garde-fou ICI (scanner plus, ou déclarer absents / forcer)
                            // au lieu de laisser filer jusqu'à la fin puis bloquer.
                            if (deliveryStep === 0 && !scanRequirementMet) {
                              setScanGateFrom('scan');
                              setShowScanGate(true);
                            } else {
                              setDeliveryStep(s => Math.min(4, s + 1));
                            }
                          }}
                              disabled={deliveryStep === 3 && (!signatureData || capturedPhotos.length === 0)}
                              className={`ui-button ${deliveryStep === 0 && !allStopScanned ? "ui-button-secondary" : "ui-button-primary"} flex-1 gap-2 disabled:cursor-not-allowed`}
                            >
                              Continuer{" "}
                              <ChevronRight size={18} aria-hidden="true" />
                            </button>
                          )}
                        </div>

                        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                        <button
                          onClick={() => setShowFailureModal(true)}
                          disabled={isProcessing}
                          className="ui-button ui-button-secondary w-full gap-1.5"
                        >
                          <XCircle size={14} />
                          Signaler un échec de livraison
                        </button>
                      </>
                    )}
                </div>
              )}

            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            {(currentStop.status === StopStatus.COMPLETED || currentStop.status === StopStatus.FAILED) && (
              <div className={`p-4 border-t ${currentStop.status === StopStatus.COMPLETED ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className="text-sm font-bold text-center">
                  {currentStop.status === StopStatus.COMPLETED
                    ? `Livré${currentStop.packageCount > 0 ? ` · ${currentStop.packageCount} colis remis` : ''}`
                    : "Échec enregistré"}
                </p>
                {currentStop.completionTime && (
                  <p className="text-sm text-center text-slate-500 mt-1">
                    {new Date(currentStop.completionTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {currentStop?.status !== StopStatus.ARRIVED && (
          <div className="flex gap-2">
            <button
              onClick={() => openStop(Math.max(0, activeStopIndex - 1))}
              disabled={activeStopIndex === 0}
              className="ui-button ui-button-secondary flex-1 gap-1 disabled:opacity-30"
            >
              <ArrowLeft size={16} /> Précédent
            </button>
            {nextPendingStopIndex >= 0 && nextPendingStopIndex !== activeStopIndex && (
                <button
                  onClick={() => openStop(nextPendingStopIndex)}
                  className="ui-button ui-button-primary flex-1 gap-1"
                >
                  Prochain arrêt <ChevronRight size={16} />
                </button>
              )}
            <button
              onClick={() => openStop(Math.min(sortedStops.length - 1, activeStopIndex + 1))}
              disabled={activeStopIndex >= sortedStops.length - 1}
              className="ui-button ui-button-secondary flex-1 gap-1 disabled:opacity-30"
            >
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        )}

        <details className="rounded-2xl border border-slate-200 bg-white p-4" open={allStopsDone || undefined}>
          <summary className="min-h-11 cursor-pointer text-base font-bold text-slate-800">
            Bilan et arrêts de la tournée · {missionProgress}%
            {returnPackages.length
              ? ` · ${returnPackages.length} retour${returnPackages.length > 1 ? 's' : ''} au hub`
              : ''}
          </summary>
          <div className="mt-3 space-y-4">
            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            {returnPackages.length > 0 && (
              <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-xl">
                      <AlertTriangle
                        size={18}
                        className="inline shrink-0 align-text-bottom"
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-yellow-800 text-sm">
                      {returnPackages.length} colis à retourner au hub
                    </h3>
                    <p className="text-sm text-yellow-700 mt-0.5">
                      Ces colis ont été retirés de votre tournée. Ramenez-les au
                      hub.
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {returnPackages.map((pkg) => (
                        <div key={pkg.id} className="flex flex-wrap gap-2 items-center justify-between bg-white rounded-lg px-3 py-2 border border-yellow-200">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">
                              {pkg.orderNumber}
                            </p>
                            <p className="text-sm text-slate-500 truncate">
                              {pkg.contactName}
                            </p>
                          </div>
                          <button
                            onClick={() => openReturnModal(pkg)}
                            className="ui-button ui-button-primary ml-2"
                          >
                            Retour hub
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">
                      Ma tournée — {activeMission.zone}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {activeMission.vehiclePlate} • {activeMission.hubName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-slate-800">
                      {missionProgress}%
                    </p>
                    <p className="text-sm text-slate-500 uppercase font-medium">
                      {activeMission.completedStops || 0}/{sortedStops.length}{" "}
                      arrêts
                    </p>
                  </div>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${missionProgress}%`,
                      background: "var(--ui-action)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2 text-sm text-slate-500">
                  <span>
                    <CheckCircle
                      size={18}
                      className="inline shrink-0 align-text-bottom"
                      aria-hidden="true"
                    />{" "}
                    {activeMission.deliveredPackages || 0} livré
                    {(activeMission.deliveredPackages || 0) > 1 ? 's' : ''}
                  </span>
                  {(activeMission.failedPackages || 0) > 0 && (
                    <span className="text-red-700">
                      <XCircle
                        size={18}
                        className="inline shrink-0 align-text-bottom"
                        aria-hidden="true"
                      />{" "}
                      {activeMission.failedPackages} échec
                      {(activeMission.failedPackages || 0) > 1 ? 's' : ''}
                    </span>
                  )}
                  <span>
                    <PackageIcon
                      size={18}
                      className="inline shrink-0 align-text-bottom"
                      aria-hidden="true"
                    />{" "}
                    {activeMission.totalPackages} total
                  </span>
                </div>
              </div>

              {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
              <div className="border-t border-slate-100 px-2 py-2 flex gap-1.5 overflow-x-auto">
                {sortedStops.map((stop, idx) => (
                  <button
                    key={stop.id}
                    onClick={() => openStop(idx)}
                    aria-label={`Ouvrir l’arrêt ${stop.sequence}, ${stop.contactName || stop.address}, ${stopStatusLabel(stop.status)}`}
                    aria-current={idx === activeStopIndex ? 'step' : undefined}
                    className={`flex-shrink-0 w-11 h-11 rounded-full text-sm font-bold flex items-center justify-center transition-all ${
                      idx === activeStopIndex
                        ? "bg-brand-700 text-white ring-2 ring-brand-300"
                        : stop.status === StopStatus.COMPLETED
                      ? 'bg-green-100 text-green-700'
                      : stop.status === StopStatus.FAILED || stop.status === StopStatus.SKIPPED
                        ? 'bg-red-100 text-red-700'
                        : stop.status === StopStatus.ARRIVED
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {stop.status === StopStatus.COMPLETED ? (
                      <CheckCircle size={18} aria-hidden="true" />
                    ) : stop.status === StopStatus.FAILED ? (
                      <XCircle size={18} aria-hidden="true" />
                    ) : (
                      stop.sequence
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            {!allStopsDone && deliveryStep === 0 && (
              <button
                onClick={requestFinishTour}
                disabled={isProcessing}
                className="ui-button ui-button-secondary w-full gap-2"
              >
                Voir ce qu’il reste à faire · {remainingStops} arrêt
                {remainingStops > 1 ? 's' : ''}, {activeReturns.length} retour
                {activeReturns.length > 1 ? 's' : ''}, {proofStopIds.size}{" "}
                preuve{proofStopIds.size > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </details>

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {currentStop?.status === StopStatus.PENDING && (
          <>
            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            <button
              onClick={() => setShowScanChoice(true)}
              className="ui-button ui-button-primary w-full gap-2"
            >
              <Camera
                size={18}
                className="inline shrink-0 align-text-bottom"
                aria-hidden="true"
              />{" "}
              Scanner des colis
            </button>

            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleOptimizeTour}
                disabled={isOptimizing}
                className="ui-button ui-button-primary gap-2"
              >
                {isOptimizing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Route size={18} />
                )}{" "}
                Optimiser
              </button>
              <button
                onClick={() => setShowReorder(true)}
                className="ui-button ui-button-secondary gap-2"
              >
                ↕️ Réorganiser
              </button>
            </div>
            <button
              onClick={openManualStop}
              className="ui-button ui-button-secondary w-full gap-2"
            >
              {pendingManualStop
                ? 'Reprendre l’ajout d’arrêt'
                : 'Ajouter un arrêt manuel'}
            </button>

            {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            <button
              onClick={() => setShowIssue(true)}
              className="ui-button ui-button-secondary w-full gap-2"
            >
              <Wrench
                size={18}
                className="inline shrink-0 align-text-bottom"
                aria-hidden="true"
              />{" "}
              Signaler un problème
            </button>
          </>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {currentStop?.status !== StopStatus.ARRIVED && (
          <button
            onClick={() => { void changeStop(() => setActiveMissionId(null)); }}
            className="ui-button ui-button-secondary w-full gap-2"
          >
            <ArrowLeft size={14} /> Voir toutes mes tournées
          </button>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showScanGate && currentStop && (
          <ScanGateDialog
            clientName={currentStop.contactName || 'ce client'}
            missingCodes={missingStopCodes}
            total={stopPackages.length}
            actionLabel="Forcer : tout est remis"
            scannedCount={deliveryScannedCount}
            onDeliverScannedOnly={() => {
              setShowScanGate(false); setScanBypass(true);
              if (scanGateFrom === 'scan') {
                // Décision prise à l'étape scan : on mémorise les colis remis (les
                // autres = non remis) et on avance ; la livraison réelle se fera au bout.
                deliverIntentRef.current = { stopId: currentStop.id, ids: new Set(scannedStopIds) };
                setDeliveryStep(1);
              } else {
                handleDeliverySuccess(new Set(scannedStopIds));
              }
            }}
            onCancel={() => { setShowScanGate(false); setShowScanner(true); }}
            onForce={() => {
              setShowScanGate(false); setScanBypass(true); deliverIntentRef.current = null;
              if (scanGateFrom === 'scan') setDeliveryStep(1); else handleDeliverySuccess();
            }}
          />
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showTransferModal && activeMission && (
          <TransferReceiveModal
            currentUser={currentUser}
            toMission={activeMission}
            onClose={() => setShowTransferModal(false)}
            onDone={(count) => {
              setShowTransferModal(false);
              showNotif(`🔁 ${count} colis récupéré${count > 1 ? 's' : ''} dans votre tournée`);
            }}
          />
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {gpsBlocked && (
          <Modal isOpen onClose={() => { setGpsBlocked(false); setGpsRetry(null); deliverIntentRef.current = null; }} title="Localisation requise pour cette action" closeOnOverlay={false} bodyClassName="!p-0">
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 text-center space-y-3">
              <MapPin
                size={24}
                className="text-brand-700 mx-auto"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-slate-800">
                {gpsErrorMsg || `${currentUser.firstName ? currentUser.firstName + ', ' : ''}activez votre localisation pour continuer`}
              </p>
              <div className="text-left text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                {gpsIsPermission ? (
                  <>
                    <p>
                      1. Ouvrez le <b>menu du navigateur</b> (cadenas{" "}
                      <Lock
                        size={18}
                        className="inline shrink-0 align-text-bottom"
                        aria-hidden="true"
                      />{" "}
                      dans la barre d'adresse)
                    </p>
                    <p>
                      2. <b>Autorisez la localisation</b> pour ce site
                    </p>
                    <p>
                      3. Revenez ici et appuyez sur <b>Réessayer</b>
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      1. Ouvrez les <b>réglages</b> de votre téléphone
                    </p>
                    <p>
                      2. Activez la <b>localisation / GPS</b>
                    </p>
                    <p>
                      3. Revenez ici et appuyez sur <b>Réessayer</b>
                    </p>
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setGpsBlocked(false); setGpsRetry(null); deliverIntentRef.current = null; }}
                  className="ui-button ui-button-secondary flex-1"
                >
                  Annuler
                </button>
                <button
                  onClick={() => { setGpsBlocked(false); (gpsRetry || handleDeliverySuccess)(); }}
                  className="ui-button ui-button-primary flex-1 gap-1.5"
                >
                  <MapPin size={16} /> Réessayer
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showClaimModal && (
          <ClaimScanModal
            currentUser={currentUser}
            clients={clients}
            confirmLabel="Ajouter à ma tournée"
            // Récupération PENDANT une tournée en cours → on alimente CETTE tournée
            // (et pas une 2ᵉ mission « DLV-… » séparée), sinon les colis récupérés
            // n'apparaissent jamais dans la tournée livrée.
            targetMissionId={activeMission?.id}
            onClose={() => setShowClaimModal(false)}
            onDone={(count) => {
              setShowClaimModal(false);
              if (count > 0) showNotif(`📦 ${count} colis ajouté${count > 1 ? 's' : ''} à votre tournée`);
            }}
          />
        )}

        {renderScanChoice()}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showReorder && activeMission && (
          <StopReorderModal
            isOpen={showReorder}
            mission={activeMission}
            onClose={() => setShowReorder(false)}
            onSave={async (m, newStops) => {
              await updateMissionFields(m.id, { stops: newStops });
              setShowReorder(false);
              showNotif('↕️ Ordre de tournée mis à jour');
            }}
          />
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showIssue && (
          <Modal
            mobileFullscreen
            isOpen
            onClose={() => { void closeIssue(() => setShowIssue(false)); }}
            title="Signaler un problème"
            preventClose={issueSubmitting}
            bodyClassName="!p-0"
            footer={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSubmitIssue}
                  disabled={issueSubmitting}
                  className="ui-button ui-button-primary flex-1"
                >
                  {issueSubmitting ? 'Envoi…' : 'Envoyer au bureau'}
                </button>
                <button
                  onClick={() => { void closeIssue(() => setShowIssue(false)); }}
                  className="ui-button ui-button-secondary"
                >
                  Annuler
                </button>
              </div>
            }
          >
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="p-4 space-y-3">
                <div>
                  <label htmlFor="driver-issue-category" className="text-sm font-bold text-slate-500 block mb-1">
                    Type de problème
                  </label>
                  <select id="driver-issue-category" value={issueForm.category} onChange={e => setIssueForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 outline-none">
                    <option>Véhicule / panne</option>
                    <option>Accident</option>
                    <option>Colis abîmé / manquant</option>
                    <option>Adresse introuvable / erronée</option>
                    <option>Client / destinataire</option>
                    <option>Autre</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="driver-issue-description" className="text-sm font-bold text-slate-500 block mb-1">
                    Description *
                  </label>
                  <textarea id="driver-issue-description" value={issueForm.description} onChange={e => setIssueForm(f => ({ ...f, description: e.target.value }))}
                    rows={3} placeholder="Décrivez le problème…"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label className="text-sm font-bold text-slate-500 block mb-1">
                    Urgence
                  </label>
                  <div className="flex gap-2">
                    {([['Low', 'Basse'], ['Medium', 'Moyenne'], ['High', 'Haute']] as const).map(([val, label]) => (
                      <button
                        key={val}
                        aria-pressed={issueForm.priority === val}
                        onClick={() => setIssueForm(f => ({ ...f, priority: val }))}
                        className={`ui-button ui-button-secondary flex-1 ${issueForm.priority === val ? (val === 'High' ? "!bg-red-700 !text-white !border-red-700" : val === 'Medium' ? "!bg-amber-800 !text-white !border-amber-800" : "!bg-slate-700 !text-white !border-slate-700") : 'bg-white text-slate-600 border-slate-300'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Modal>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showFailureModal && (
          <Modal
            mobileFullscreen
            isOpen
            onClose={() => { void closeFailure(() => setShowFailureModal(false)); }}
            title="Déclarer un échec de livraison"
            preventClose={isProcessing}
            closeOnOverlay={false}
            bodyClassName="!p-0"
            footer={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { void closeFailure(() => { setShowFailureModal(false); setFailureNotes(''); setFailurePhotos([]); }); }}
                  className="ui-button ui-button-secondary flex-1"
                >
                  Annuler
                </button>
                <button
                  onClick={handleDeliveryFailure}
                  disabled={isProcessing || failurePhotos.length === 0}
                  className="ui-button ui-button-danger flex-1"
                >
                  {isProcessing
                    ? 'Envoi...'
                    : failurePhotos.length === 0
                      ? "Photo requise"
                      : 'Confirmer échec'}
                </button>
              </div>
            }
          >
            <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden animate-slide-up ">
              <div className="p-4 bg-red-50 border-b border-red-100">
                <h3 className="text-lg font-bold text-red-800">
                  Raison de l'échec
                </h3>
                <p className="text-sm text-red-800">
                  Arrêt {currentStop?.sequence} — {currentStop?.contactName}
                </p>
              </div>
              <div className="p-4 space-y-3">
                {Object.values(FailureReason).map((reason) => (
                  <button
                    key={reason}
                    onClick={() => setFailureReason(reason as FailureReason)}
                    aria-pressed={failureReason === reason}
                    className={`ui-button ui-button-secondary !justify-start w-full text-left ${
                      failureReason === reason
                        ? "!bg-red-50 !border-red-300 !text-red-800"
                        : ''
                    }`}
                  >
                    {reason}
                  </button>
                ))}
                <label htmlFor="failure-notes" className="block text-sm font-medium text-slate-700">
                  Commentaire de l’échec (optionnel)
                </label>
                <textarea id="failure-notes"
                  value={failureNotes}
                  onChange={(e) => setFailureNotes(e.target.value)}
                  placeholder="Commentaire supplémentaire (optionnel)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-base resize-none h-20"
                />

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-sm font-bold text-slate-500 mb-2">
                    <Camera
                      size={18}
                      className="inline shrink-0 align-text-bottom"
                      aria-hidden="true"
                    />{" "}
                    Photo preuve{" "}
                    <span className="text-red-700">obligatoire</span>
                  </p>
                  <button
                    onClick={() => failurePhotoInputRef.current?.click()}
                    disabled={failurePhotos.length >= MAX_PHOTOS}
                    className="ui-button ui-button-secondary w-full gap-2"
                  >
                    <Camera size={14} />
                    Photo porte / boîte aux lettres ({failurePhotos.length}/
                    {MAX_PHOTOS})
                  </button>
                  <input
                    ref={failurePhotoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFailurePhotoCapture}
                  />
                  {failurePhotos.length === 0 && (
                    <p className="text-sm text-red-700 font-medium mt-1.5 text-center">
                      <AlertTriangle
                        size={18}
                        className="inline shrink-0 align-text-bottom"
                        aria-hidden="true"
                      />{" "}
                      Au moins 1 photo requise pour confirmer l'échec
                    </p>
                  )}
                  {failurePhotos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {failurePhotos.map((photo, i) => (
                        <div key={i} className="relative flex-shrink-0">
                          <img src={photo} alt={`Échec ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-red-200" />
                          <button
                            aria-label={`Supprimer la photo d’échec ${i + 1}`}
                            onClick={() => setFailurePhotos(prev => prev.filter((_, idx) => idx !== i))}
                            className="ui-button ui-button-danger absolute -top-1 -right-1 w-11 h-11"
                          >
                            <X
                              size={18}
                              className="inline shrink-0 align-text-bottom"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                {uploadProgress && uploadProgress.step !== 'done' && uploadProgress.step !== 'error' && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-2">
                      <div className="flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin text-red-800" />
                        <span className="text-sm text-red-700">
                          {uploadProgress.message}
                        </span>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </Modal>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showScanner && (
          <Suspense
            fallback={
              <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
                <div className="text-center text-white">
                  <Loader2 size={32} className="animate-spin mx-auto mb-3" />
                  <p className="text-sm">Chargement du scanner...</p>
                </div>
              </div>
            }
          >
            <BarcodeScanner
              onScan={handleBarcodeScan}
              onClose={() => setShowScanner(false)}
              expectedBarcodes={stopPackages.flatMap(p => packageScanCodes(p))}
              alreadyScanned={scannedBarcodes}
              title={`${isPickupStop ? 'Scan enlèvement' : 'Scan livraison'} — ${currentStop?.contactName || ''}`}
              hint={isPickupStop ? undefined : 'Scannez le code DELIVREX — le petit carré (DataMatrix) en bas à gauche'}
              progress={stopPackages.length > 0 ? { done: deliveryScannedCount, total: stopPackages.length } : undefined}
              isMatch={(code) => stopPackages.some(p => packageMatchesCode(p, code))}
              checklist={stopPackages.map(p => ({ code: packageDisplayCode(p) || 'sans code', done: scannedStopIds.has(p.id) }))}
            />
          </Suspense>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showReturnModal && returningPackage && (
          <Modal
            mobileFullscreen
            isOpen
            onClose={() => { void closeReturn(() => setShowReturnModal(false)); }}
            title="Confirmer un retour au hub"
            size="lg"
            preventClose={isProcessing}
            bodyClassName="!p-0"
            footer={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleConfirmReturn}
                  disabled={isProcessing || returnPhotos.length === 0}
                  className="ui-button ui-button-primary flex-1 gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Envoi en cours...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={18} />
                      Confirmer retour au hub
                    </>
                  )}
                </button>
                <button
                  onClick={() => { void closeReturn(() => setShowReturnModal(false)); }}
                  disabled={isProcessing}
                  className="ui-button ui-button-secondary"
                >
                  Annuler
                </button>
              </div>
            }
          >
            <div className="bg-white rounded-t-3xl w-full max-w-lg animate-slide-up">
              <p className="p-4 text-base font-semibold text-slate-800 break-words">
                {returningPackage.orderNumber} · {returningPackage.contactName}
              </p>

              {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
              <div className="p-4 bg-amber-50 border-b border-amber-200">
                <p className="text-sm text-amber-800 font-medium">
                  <AlertTriangle
                    size={18}
                    className="inline shrink-0 align-text-bottom"
                    aria-hidden="true"
                  />{" "}
                  {returningPackage.returnReason || 'Ce colis a été retiré de votre tournée'}
                </p>
              </div>

              {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
              <div className="p-4 space-y-4">
                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                <div>
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-1 mb-2">
                    <Camera
                      size={18}
                      className="inline shrink-0 align-text-bottom"
                      aria-hidden="true"
                    />{" "}
                    Photo du colis <span className="text-red-700">*</span>
                  </label>
                  <input
                    ref={returnPhotoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleReturnPhoto}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    {returnPhotos.map((photo, idx) => (
                      <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                        <img src={photo} alt="" className="w-full h-full object-cover" />
                        <button
                          aria-label={`Supprimer la photo de retour ${idx + 1}`}
                          onClick={() => setReturnPhotos(prev => prev.filter((_, i) => i !== idx))}
                          className="ui-button ui-button-danger absolute top-0.5 right-0.5 w-11 h-11"
                        >
                          <X
                            size={18}
                            className="inline shrink-0 align-text-bottom"
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    ))}
                    {returnPhotos.length < 5 && (
                      <button
                        aria-label="Prendre une photo du colis retourné"
                        onClick={() => returnPhotoInputRef.current?.click()}
                        className="ui-button ui-button-secondary w-16 h-16 border-dashed"
                      >
                        <Camera size={24} />
                      </button>
                    )}
                  </div>
                  {returnPhotos.length === 0 && (
                    <p className="text-sm text-red-700 mt-1">
                      <AlertTriangle
                        size={18}
                        className="inline shrink-0 align-text-bottom"
                        aria-hidden="true"
                      />{" "}
                      Au moins 1 photo obligatoire
                    </p>
                  )}
                </div>

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                <div>
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-1 mb-2">
                    <PenTool
                      size={18}
                      className="inline shrink-0 align-text-bottom"
                      aria-hidden="true"
                    />{" "}
                    Signature réception hub{" "}
                    <span className="text-slate-600">(optionnel)</span>
                  </label>
                  {returnSignature ? (
                    <div className="relative">
                      <img src={returnSignature} alt="Signature" className="w-full h-20 object-contain border border-slate-200 rounded-lg bg-white" />
                      <button
                        aria-label="Supprimer la signature de réception au hub"
                        onClick={() => setReturnSignature(null)}
                        className="ui-button ui-button-danger absolute top-1 right-1 w-11 h-11"
                      >
                        <X
                          size={18}
                          className="inline shrink-0 align-text-bottom"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowReturnSignature(true)}
                      className="ui-button ui-button-secondary w-full border-dashed gap-2"
                    >
                      <PenTool size={16} />
                      Ajouter signature
                    </button>
                  )}
                </div>

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-sm text-slate-500">
                    <MapPin
                      size={18}
                      className="inline shrink-0 align-text-bottom"
                      aria-hidden="true"
                    />{" "}
                    Votre position GPS sera enregistrée automatiquement pour
                    confirmer la remise au hub.
                  </p>
                </div>
              </div>

              {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
            </div>
          </Modal>
        )}

        {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
        {showReturnSignature && (
          <Modal isOpen onClose={() => setShowReturnSignature(false)} title="Signature de réception au hub" size="lg" closeOnOverlay={false} bodyClassName="!p-0">
            <div className="flex-1 bg-white relative">
              <SignaturePad
                onSave={(data) => {
                  setReturnSignature(data);
                  setShowReturnSignature(false);
                }}
                onCancel={() => setShowReturnSignature(false)}
                driverName={`${currentUser.firstName} ${currentUser.lastName}`}
              />
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDU — Liste des missions (quand pas de mission active)
  // ============================================================================

  return (
    <div className="max-w-lg mx-auto pb-6 space-y-4 animate-fade-in">
      {manualStopRecovery}
      {manualStopDialog}
      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
      {notification && (
        <div role="status" className="bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-center text-sm font-medium animate-fade-in">
          <NotificationText message={notification} />
        </div>
      )}

      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
      <div>
        <h2 className="text-xl font-bold text-slate-800">Mes tournées</h2>
        <p className="text-sm text-slate-500">
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
      <button
        onClick={() => setShowScanChoice(true)}
        className="ui-button ui-button-primary w-full gap-2"
      >
        <Camera
          size={18}
          className="inline shrink-0 align-text-bottom"
          aria-hidden="true"
        />{" "}
        Scanner des colis
      </button>

      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
      {showClaimModal && (
        <ClaimScanModal
          currentUser={currentUser}
          clients={clients}
          confirmLabel="Commencer ma tournée"
          onClose={() => setShowClaimModal(false)}
          onDone={(count) => {
            setShowClaimModal(false);
            if (count > 0) {
              setActiveMissionId(`DLV-${currentUser.id}-${today}`);
              setActiveStopIndex(0);
              showNotif(`🚚 ${count} colis chargé${count > 1 ? 's' : ''} — en route !`);
            }
          }}
        />
      )}

      {renderScanChoice()}

      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
      {(() => {
        const isHistorique = (m: Mission) => m.status === MissionStatus.COMPLETED || m.status === MissionStatus.CANCELLED;
        const enCours = missions.filter(m => !isHistorique(m));
        const historique = [...missions
        .filter(isHistorique)].sort((a, b) =>
          (b.completedAt || b.date || '').localeCompare(a.completedAt || a.date || ''));
        const list = driverTab === 'encours' ? enCours : historique;
        return (
          <>
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              <button
                onClick={() => setDriverTab('encours')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${driverTab === 'encours' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
              >
                En cours{enCours.length > 0 ? ` (${enCours.length})` : ''}
              </button>
              <button
                onClick={() => setDriverTab('historique')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${driverTab === 'historique' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
              >
                Historique
                {historique.length > 0 ? ` (${historique.length})` : ''}
              </button>
            </div>
            {list.length === 0 && (
              <div className="text-center text-slate-600 text-sm py-8">
                {driverTab === 'encours' ? 'Aucune tournée en cours. Scanne des colis pour démarrer.' : 'Aucune tournée terminée pour l’instant.'}
              </div>
            )}
          </>
        );
      })()}

      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
      {missions
        .filter((m) =>
          driverTab === 'historique'
            ? m.status === MissionStatus.COMPLETED || m.status === MissionStatus.CANCELLED
            : m.status !== MissionStatus.COMPLETED && m.status !== MissionStatus.CANCELLED,
        )
        .sort((a, b) => driverTab === 'historique'
          ? (b.completedAt || b.date || '').localeCompare(a.completedAt || a.date || '')
          : 0,
        )
        .map((mission) => {
          const progress = mission.totalPackages > 0
          ? Math.round(((mission.deliveredPackages || 0) / mission.totalPackages) * 100) : 0;
          const statusColors = MISSION_STATUS_COLORS[mission.status];
          const isCompleted = mission.status === MissionStatus.COMPLETED;
          const isInProgress = mission.status === MissionStatus.IN_PROGRESS;

          return (
            <div key={mission.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-slate-800">
                        Tournée {mission.zone}
                      </h3>
                      <span className={`px-2 py-0.5 rounded-full text-sm font-bold ${statusColors.bg} ${statusColors.text}`}>
                        {missionStatusLabel(mission.status)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {mission.vehiclePlate} • {mission.hubName} •{" "}
                      {mission.stops.length} arrêts
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-slate-800">
                      {mission.totalPackages}
                    </p>
                    <p className="text-sm text-slate-500 uppercase">colis</p>
                  </div>
                </div>

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-sm text-slate-500">Distance</p>
                    <p className="text-sm font-bold text-slate-800">
                      {formatDistance(mission.totalDistance) || '-'}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-sm text-slate-500">Durée est.</p>
                    <p className="text-sm font-bold text-slate-800">
                      {formatDuration(mission.estimatedDuration) || '-'}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-sm text-slate-500">Livrés</p>
                    <p className="text-sm font-bold text-green-700">
                      {mission.deliveredPackages || 0}
                    </p>
                  </div>
                </div>

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                {(isInProgress || isCompleted) && (
                  <div className="mb-3">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                      className={`h-full rounded-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                    </div>
                    <p className="text-sm text-slate-500 mt-1 text-right">
                      {progress}%
                    </p>
                  </div>
                )}

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                {mission.plannedDepartureTime && mission.status === MissionStatus.DISPATCHED && (
                    <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl">
                      <Clock size={14} className="text-blue-500" />
                      <span className="text-sm text-blue-700 font-medium">
                        Départ prévu :{" "}
                      </span>
                      <span className="text-sm font-bold text-blue-800 font-mono">
                        {mission.plannedDepartureTime}
                      </span>
                    </div>
                  )}

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                {mission.status === MissionStatus.DISPATCHED && !isLoadingPhase && (
                    <button
                      onClick={() => handleStartLoading(mission)}
                      disabled={isProcessing}
                      className="ui-button ui-button-primary w-full gap-2"
                    >
                      {isProcessing ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Play size={18} />
                      )}
                      <PackageIcon
                        size={18}
                        className="inline shrink-0 align-text-bottom"
                        aria-hidden="true"
                      />{" "}
                      Commencer le chargement
                    </button>
                  )}

                {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                {mission.status === MissionStatus.DISPATCHED && isLoadingPhase && activeMissionId === mission.id && (
                    <div className="space-y-2">
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Loader2 size={14} className="animate-spin text-amber-800" />
                          <span className="text-sm font-bold text-amber-800">
                            Chargement en cours...
                          </span>
                        </div>
                        <p className="text-sm text-amber-800">
                          {mission.totalPackages} colis • {mission.stops.length}{" "}
                          arrêts à charger
                        </p>
                      </div>
                      {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                      <button
                        onClick={() => setShowClaimModal(true)}
                        disabled={isProcessing}
                        className="ui-button ui-button-primary w-full gap-2"
                      >
                        <Camera size={18} />
                        <Camera
                          size={18}
                          className="inline shrink-0 align-text-bottom"
                          aria-hidden="true"
                        />{" "}
                        Scanner les colis à l'embarquement
                      </button>
                      <button
                        onClick={() => handleLoadingComplete(mission)}
                        disabled={isProcessing}
                        className="ui-button ui-button-primary w-full gap-2"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 size={18} className="animate-spin" />
                            Mise à jour en cours...
                          </>
                        ) : (
                          <>
                            <CheckCircle size={18} />
                            <CheckCircle
                              size={18}
                              className="inline shrink-0 align-text-bottom"
                              aria-hidden="true"
                            />{" "}
                            Chargement terminé — Départ !
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleCancelLoading}
                        disabled={isProcessing}
                        className="ui-button ui-button-secondary w-full gap-2"
                      >
                        Annuler
                      </button>
                    </div>
                  )}

                {isInProgress && (
                  <button
                    onClick={() => {
                    // FIX: Calculer le prochain stop en attente pour CETTE mission spécifique
                    const missionSortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
                    const pendingIdx = missionSortedStops.findIndex(s =>
                      s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
                    );
                    setActiveMissionId(mission.id);
                    setActiveStopIndex(pendingIdx >= 0 ? pendingIdx : 0);
                  }}
                    className="ui-button ui-button-primary w-full gap-2"
                  >
                    <Navigation size={18} />
                    Continuer la tournée
                  </button>
                )}

                {isCompleted && (
                  <div className="w-full flex items-center justify-center gap-2 py-3 bg-green-50 text-green-700 rounded-xl text-sm font-bold">
                    <CheckCircle size={18} />
                    Tournée terminée
                  </div>
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
};

export default DriverMissionView;
