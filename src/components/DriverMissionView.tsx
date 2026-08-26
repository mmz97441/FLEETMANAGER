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

import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import {
  Mission, MissionStatus, MissionType, MissionStop, StopStatus,
  PackageStatus, FailureReason, Package, DeliveryLocation, TransferReason,
  User, MISSION_STATUS_COLORS, Issue, IssueStatus
} from '../types';
import { addIssueToFirestore } from '../services/firestore';
import { todayISO, localDatePart } from '../utils/date';
import {
  subscribeToMissions,
  subscribeToPackages,
  updateMission,
  updateMissionFields,
  optimizeDriverMission,
  addManualStopToMission,
  updateMissionStatus,
  updatePackageStatus,
  recomputeMissionCounters,
  getPackagesByIds,
  transferPackagesToDriver
} from '../services/missionService';
import { uploadAndCreatePOD, uploadFailurePOD, UploadProgress } from '../services/podService';
import { finalizePickup } from '../services/pickupService';
import { reportError } from '../services/logService';
import PickupScanView from './PickupScanView';
import TransferReceiveModal from './TransferReceiveModal';
import ClaimScanModal from './ClaimScanModal';
import ScanGateDialog from './ScanGateDialog';
import StopReorderModal from './StopReorderModal';
import { packageMatchesCode, packageScanCodes, packageDisplayCode, matchScansToPackages } from '../utils/barcode';
import { sameDeliveryPoint, placeKey } from '../utils/address';
import { getTourProgress } from '../utils/missionProgress';
import { getCurrentPosition } from '../utils/geo';
import { formatDistance, formatDuration } from '../utils/format';
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));
import {
  Truck, Package as PackageIcon, MapPin, Clock, Phone,
  CheckCircle, XCircle, Navigation, Play,
  Camera, PenTool, ChevronRight,
  Loader2, ArrowLeft,
  MapPinned
} from 'lucide-react';

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
    <div className="bg-white rounded-xl border-2 border-amber-300 overflow-hidden shadow-lg">
      <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
        <span className="text-sm font-bold text-amber-800">✍️ Signature du destinataire</span>
        <div className="flex gap-2">
          <button onClick={undo} disabled={strokesRef.current.length === 0}
            className="text-xs text-slate-500 hover:text-amber-600 disabled:opacity-30 font-medium">
            ↩ Annuler
          </button>
          <button onClick={clear} className="text-xs text-red-500 hover:text-red-700 font-medium">
            Effacer tout
          </button>
        </div>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={280}
          className="w-full h-[160px] touch-none bg-white cursor-crosshair"
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
            <p className="text-slate-300 text-sm">Signez ici avec le doigt</p>
          </div>
        )}
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg">
          Annuler
        </button>
        <button
          onClick={save}
          disabled={!hasContent}
          className="flex-1 py-2.5 text-sm font-bold text-white bg-green-600 rounded-lg disabled:opacity-40"
        >
          ✓ Valider signature
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const DriverMissionView: React.FC<DriverMissionViewProps> = ({ currentUser }) => {
  // === State ===
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [activeStopIndex, setActiveStopIndex] = useState(0);
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
  const [showTransferModal, setShowTransferModal] = useState(false); // réception de colis en route
  const [showClaimModal, setShowClaimModal] = useState(false); // prise en charge par scan
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [showManualStop, setShowManualStop] = useState(false);
  const [manualStop, setManualStop] = useState({ contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });
  const [showIssue, setShowIssue] = useState(false);
  const [issueForm, setIssueForm] = useState<{ category: string; description: string; priority: 'Low' | 'Medium' | 'High' }>({ category: 'Véhicule / panne', description: '', priority: 'Medium' });
  const [issueSubmitting, setIssueSubmitting] = useState(false);
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

  const today = todayISO();

  // === Abonnement missions du chauffeur ===
  useEffect(() => {
    hasAutoSelectedRef.current = false; // reset si le jour change
    const unsub = subscribeToMissions((data) => {
      // Les filtres sont appliqués par subscribeToMissions
      const myMissions = data.filter(m => m.status !== MissionStatus.CANCELLED);
      setMissions(myMissions);
      setLoading(false);

      // Auto-sélectionner la mission active — UNE SEULE FOIS
      if (!hasAutoSelectedRef.current) {
        const active = myMissions.find(m => m.status === MissionStatus.IN_PROGRESS);
        if (active) {
          setActiveMissionId(active.id);
          // Trouver le premier stop en attente pour cette mission
          const sorted = [...active.stops].sort((a, b) => a.sequence - b.sequence);
          const pendingIdx = sorted.findIndex(s => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED);
          setActiveStopIndex(pendingIdx >= 0 ? pendingIdx : 0);
        }
        hasAutoSelectedRef.current = true;
      }
    }, { date: today, driverId: currentUser.id });
    return unsub;
  }, [currentUser.id, today]);

  // === Données dérivées ===
  const activeMission = useMemo(() =>
    missions.find(m => m.id === activeMissionId) || null
  , [missions, activeMissionId]);

  const sortedStops = useMemo(() =>
    activeMission ? [...activeMission.stops].sort((a, b) => a.sequence - b.sequence) : []
  , [activeMission]);

  const currentStop = sortedStops[activeStopIndex] || null;
  const isPickupStop = currentStop?.type === 'PICKUP';

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
    let unsub: () => void = () => {};
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

  // Reset scan quand on change de stop
  useEffect(() => {
    setScannedBarcodes([]);
    setShowScanner(false);
    setScanBypass(false);
    setDeliveryStep(0);
    setMerchandiseGood(true);
    setReservesNote('');
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
    });
    return unsub;
  }, [currentUser.id]);

  const nextPendingStopIndex = useMemo(() => {
    return sortedStops.findIndex(s => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED);
  }, [sortedStops]);

  const missionProgress = useMemo(() => {
    if (!activeMission) return 0;
    return getTourProgress(activeMission).pct; // avancement = arrêts traités / total
  }, [activeMission]);

  // === Notifications éphémères ===
  const showNotif = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // Rattacher à l'arrêt courant les colis détectés à la MÊME adresse mais absents
  // de l'arrêt (bandeau rouge). On ne rattache QUE ceux qui sont sûrs :
  //  - pas affectés à un AUTRE chauffeur (sinon on lui volerait un colis) ;
  //  - même placeKey que l'arrêt courant (sinon ils ne fusionneraient pas ICI).
  // On cible la MISSION ACTIVE (pas forcément la tournée-scan DLV) ; grâce à la
  // fusion par adresse (transferPackagesToDriver), ils atterrissent dans l'arrêt
  // courant → le chauffeur scanne/livre tout ensemble.
  const claimableOthers = useMemo(() =>
    otherAtAddress.filter(p =>
      (!p.currentDriverId || p.currentDriverId === currentUser.id) &&
      (!currentStop || placeKey(p) === placeKey(currentStop))
    ),
  [otherAtAddress, currentStop, currentUser.id]);

  const [isClaimingOthers, setIsClaimingOthers] = useState(false);
  const handleClaimOthersToStop = async () => {
    if (!activeMission || claimableOthers.length === 0 || isClaimingOthers) return;
    setIsClaimingOthers(true);
    try {
      const n = await transferPackagesToDriver({
        packages: claimableOthers,
        toMission: activeMission,
        toDriver: { id: currentUser.id, name: `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email },
        reason: TransferReason.OTHER,
        claimMode: true,
        newStatus: PackageStatus.IN_DELIVERY,
      });
      showNotif(`📦 ${n} colis rattaché${n > 1 ? 's' : ''} à cet arrêt`);
    } catch (err) {
      showNotif(`❌ Rattachement impossible${err instanceof Error ? ` (${err.message})` : ''}`);
    }
    setIsClaimingOthers(false);
  };

  // === GPS ===
  // getCurrentPosition est centralisé dans utils/geo (défaut : enableHighAccuracy,
  // timeout 10 s, maximumAge 0 — équivalent aux anciennes options locales).

  // Message GPS personnalisé (prénom) + ciblé selon la cause de l'échec.
  const buildGpsMessage = (err: any): { msg: string; isPermission: boolean } => {
    const hi = currentUser.firstName ? `${currentUser.firstName}, ` : '';
    const code = err && typeof err.code === 'number' ? err.code : null;
    if (code === 1) // PERMISSION_DENIED
      return { msg: `${hi}autorise la localisation pour ce site dans les réglages du navigateur stp 🙏`, isPermission: true };
    if (code === 2) // POSITION_UNAVAILABLE (GPS OS coupé)
      return { msg: `${hi}active le GPS de ton téléphone pour continuer stp 🙏`, isPermission: false };
    if (code === 3) // TIMEOUT
      return { msg: `${hi}impossible de te localiser — vérifie que le GPS est bien activé, puis réessaie stp 🙏`, isPermission: false };
    return { msg: `${hi}active ta localisation pour continuer stp 🙏`, isPermission: false };
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
    // GPS obligatoire DÈS LE DÉPART : on bloque ici (au hub) plutôt qu'au 1er client,
    // pour que le chauffeur active sa localisation en début de tournée.
    const startPos = await ensureGps(() => handleLoadingComplete(mission));
    if (!startPos) return;
    setIsProcessing(true);
    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // 1. Recalculer les ETAs basées sur l'heure réelle de départ
      const updatedStops = mission.stops.map((stop, idx) => {
        const cumulativeMinutes = mission.stops
          .slice(0, idx + 1)
          .reduce((sum, s) => sum + (s.durationFromPrevious || 0) + (s.serviceTime || 5), 0);

        const etaDate = new Date(now.getTime() + cumulativeMinutes * 60000);
        const estimatedArrival = etaDate.toISOString();
        const estimatedDeparture = new Date(etaDate.getTime() + (stop.serviceTime || 5) * 60000).toISOString();

        return { ...stop, estimatedArrival, estimatedDeparture };
      });

      // 2. Colis → IN_DELIVERY + heure de livraison prévue (dénormalisée pour le client)
      for (const stop of updatedStops) {
        for (const pkgId of (stop.packageIds || [])) {
          try {
            await updatePackageStatus(pkgId, PackageStatus.IN_DELIVERY, {
              action: 'LOADING_COMPLETE',
              driverId: currentUser.id,
              driverName: `${currentUser.firstName} ${currentUser.lastName}`,
              notes: `Chargement terminé — départ ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
            }, { estimatedDeliveryAt: stop.estimatedArrival });
          } catch (e) { reportError('driver.loadComplete.item', e, { silent: true, extra: { pkgId } }); }
        }
      }

      // 3. Mission → IN_PROGRESS avec loadedAt + stops recalculés
      await updateMissionFields(mission.id, {
        status: MissionStatus.IN_PROGRESS,
        loadedAt: nowISO,
        startedAt: nowISO,
        stops: updatedStops
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
        } catch (e) { reportError('driver.return.photo', e, { level: 'warning', silent: true, extra: { packageId: returningPackage.id } }); }
      }

      // Uploader la signature si présente
      let signatureUrl: string | undefined;
      if (returnSignature) {
        try {
          const { uploadProofPhoto } = await import('../services/podService');
          signatureUrl = await uploadProofPhoto(returnSignature, returningPackage.id, 'return-signature');
        } catch (e) { reportError('driver.return.signature', e, { level: 'warning', silent: true, extra: { packageId: returningPackage.id } }); }
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
        coordinates: coords || { lat: 0, lng: 0 },
        timestamp: new Date().toISOString(),
        notes: `Retourné par ${currentUser.firstName} ${currentUser.lastName}`
      };

      // Mettre à jour le colis : RETURNED + enregistrer la preuve
      await updatePackageStatus(returningPackage.id, PackageStatus.RETURNED, {
        action: 'RETURNED',
        driverId: currentUser.id,
        driverName: `${currentUser.firstName} ${currentUser.lastName}`,
        notes: `Retour hub confirmé — ${photoUrls.length} photo(s)`
      });

      // Sauvegarder la preuve de retour dans le colis
      const { updatePackageFields } = await import('../services/missionService');
      await updatePackageFields(returningPackage.id, {
        returnProof,
        currentHubId: activeMission?.hubId,
        missionId: undefined,
        stopId: undefined,
        currentDriverId: undefined,
        currentVehicleId: undefined
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
    setIsProcessing(true);
    try {
      let coords: { lat: number; lng: number } | undefined;
      try { coords = await getCurrentPosition(); } catch {}

      const updatedStops = activeMission.stops.map(s =>
        s.id === currentStop.id ? {
          ...s,
          status: StopStatus.ARRIVED,
          arrivalTime: new Date().toISOString(),
          arrivalCoordinates: coords
        } : s
      );

      await updateMission({ ...activeMission, stops: updatedStops });
      showNotif('📍 Arrivée enregistrée');
    } catch (err) {
      reportError('driver.arrival', err, { silent: true });
      showNotif(`❌ Erreur${err instanceof Error ? ` — ${err.message}` : ''}`);
    }
    setIsProcessing(false);
  };

  // Livraison réussie
  const handleDeliverySuccess = async () => {
    // Trace du scan de contrôle (pour POD + historique colis)
    const scanTrace = stopPackages.length === 0
      ? undefined
      : deliveryScannedCount === stopPackages.length
        ? `Colis scannés: ${deliveryScannedCount}/${stopPackages.length}`
        : `⚠️ Validé sans scan complet (${deliveryScannedCount}/${stopPackages.length} scannés)`;
    if (!activeMission || !currentStop) return;
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
    try {
      const now = new Date().toISOString();

      // 1. Mettre à jour le stop
      const updatedStops = activeMission.stops.map(s =>
        s.id === currentStop.id ? {
          ...s,
          status: StopStatus.COMPLETED,
          completionTime: now,
          arrivalCoordinates: coords || s.arrivalCoordinates
        } : s
      );

      // 2. Compter les stats
      const { completedStops, failedStops } = recomputeMissionCounters(updatedStops);
      const deliveredPkgs = (activeMission.deliveredPackages || 0) + currentStop.packageCount;

      // 3. Check si toute la mission est terminée
      const allDone = updatedStops.every(s =>
        s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED
      );

      await updateMission({
        ...activeMission,
        stops: updatedStops,
        completedStops,
        failedStops,
        deliveredPackages: deliveredPkgs,
        status: allDone ? MissionStatus.COMPLETED : MissionStatus.IN_PROGRESS,
        ...(allDone ? { completedAt: now } : {})
      });

      // 4. Statut des colis EN PREMIER = source de vérité de la livraison.
      //    L'upload des preuves (lourd, sensible au réseau mobile) se fait APRÈS.
      //    Ainsi, si l'upload échoue, le colis reste bien "Livré" (seule la preuve
      //    est à renvoyer) au lieu de rester bloqué "En livraison".
      let deliveredCount = 0;
      for (const pkgId of currentStop.packageIds) {
        try {
          await updatePackageStatus(
            pkgId,
            PackageStatus.DELIVERED,
            {
              action: 'DELIVERED',
              driverId: currentUser.id,
              driverName: `${currentUser.firstName} ${currentUser.lastName}`,
              vehicleId: activeMission.vehicleId,
              vehiclePlate: activeMission.vehiclePlate,
              location: coords,
              notes: [
                recipientName ? `Réceptionné par: ${recipientName}` : null,
                scanTrace || null
              ].filter(Boolean).join(' • ') || undefined
            },
            {
              missionId: activeMission.id,
              stopId: currentStop.id,
              currentDriverId: currentUser.id,
              currentVehicleId: activeMission.vehicleId
            }
          );
          deliveredCount++;
        } catch (e) {
          reportError('driver.delivery.item', e, {
            silent: true,
            extra: { pkgId, missionId: activeMission.id, stopId: currentStop.id }
          });
        }
      }
      if (deliveredCount < currentStop.packageIds.length) {
        const stuck = currentStop.packageIds.length - deliveredCount;
        reportError('driver.delivery.partial', new Error(`${stuck} colis non passés en Livré`), {
          level: 'warning',
          userMessage: `⚠️ ${stuck} colis sur ${currentStop.packageIds.length} n'ont pas pu passer en "Livré" (réseau ?). Ils restent "En livraison" — resynchronisez une fois en ligne.`,
          extra: { missionId: activeMission.id, stopId: currentStop.id }
        });
      }

      // 5. Upload des preuves (POD) — best-effort : NE DOIT JAMAIS annuler la livraison.
      try {
        setUploadProgress({ step: 'compressing', current: 0, total: 1, message: 'Préparation...' });
        const podResult = await uploadAndCreatePOD({
          missionId: activeMission.id,
          stopId: currentStop.id,
          packageIds: currentStop.packageIds,
          driverId: currentUser.id,
          driverName: `${currentUser.firstName} ${currentUser.lastName}`,
          vehicleId: activeMission.vehicleId || '',
          vehiclePlate: activeMission.vehiclePlate || '',
          recipientName: recipientName || undefined,
          deliveryLocation,
          merchandiseGoodCondition: merchandiseGood,
          reservesNote: merchandiseGood ? undefined : (reservesNote.trim() || undefined),
          signatureBase64: signatureData || undefined,
          photosBase64: capturedPhotos,
          coordinates: coords || { lat: 0, lng: 0 },
          notes: [
            recipientName ? `${deliveryLocation} — Réceptionné par: ${recipientName}` : null,
            merchandiseGood ? null : `⚠️ Réserves: ${reservesNote.trim() || 'oui'}`,
            scanTrace || null
          ].filter(Boolean).join(' • ') || undefined
        }, setUploadProgress);
        if (podResult) showNotif('📸 Preuves uploadées ✓');
      } catch (e) {
        reportError('driver.delivery.pod', e, {
          level: 'warning',
          userMessage: "⚠️ Colis livré, mais l'envoi des preuves (photo/signature) a échoué. Elles pourront être renvoyées.",
          extra: { missionId: activeMission.id, stopId: currentStop.id }
        });
      }

      // 6. FIX BUG 2: Trouver le prochain stop en attente dans l'ORDRE TRIÉ (par sequence)
      const updatedSorted = [...updatedStops].sort((a, b) => a.sequence - b.sequence);
      const nextSortedIdx = updatedSorted.findIndex(s =>
        s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
      );
      if (nextSortedIdx >= 0) {
        setActiveStopIndex(nextSortedIdx);
      }

      // Reset UI
      setSignatureData(null);
      setCapturedPhotos([]);
      setRecipientName('');
      setDeliveryLocation(DeliveryLocation.HAND_DELIVERY);
      setShowSignature(false);
      setUploadProgress(null);
      setDeliveryStep(0);
      setMerchandiseGood(true);
      setReservesNote('');

      showNotif(allDone ? '🎉 Tournée terminée !' : `✅ Stop ${currentStop.sequence} livré !`);
    } catch (err) {
      reportError('driver.delivery', err, { silent: true });
      showNotif(`❌ Erreur livraison${err instanceof Error ? ` — ${err.message}` : ''}`);
    }
    setIsProcessing(false);
  };

  // Échec livraison
  const handleDeliveryFailure = async () => {
    if (!activeMission || !currentStop) return;
    setIsProcessing(true);
    try {
      let coords: { lat: number; lng: number } | undefined;
      try { coords = await getCurrentPosition(); } catch {}

      const now = new Date().toISOString();

      const updatedStops = activeMission.stops.map(s =>
        s.id === currentStop.id ? {
          ...s,
          status: StopStatus.FAILED,
          completionTime: now,
          arrivalCoordinates: coords || s.arrivalCoordinates
        } : s
      );

      const { completedStops, failedStops } = recomputeMissionCounters(updatedStops);
      const failedPkgs = (activeMission.failedPackages || 0) + currentStop.packageCount;

      const allDone = updatedStops.every(s =>
        s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED
      );

      await updateMission({
        ...activeMission,
        stops: updatedStops,
        completedStops,
        failedStops,
        failedPackages: failedPkgs,
        status: allDone ? MissionStatus.COMPLETED : MissionStatus.IN_PROGRESS,
        ...(allDone ? { completedAt: now } : {})
      });

      // Mettre à jour colis en échec — BON format PackageMovement
      for (const pkgId of currentStop.packageIds) {
        try {
          await updatePackageStatus(
            pkgId,
            PackageStatus.FAILED,
            {
              action: 'FAILED',
              driverId: currentUser.id,
              driverName: `${currentUser.firstName} ${currentUser.lastName}`,
              vehicleId: activeMission.vehicleId,
              vehiclePlate: activeMission.vehiclePlate,
              location: coords,
              notes: `${failureReason}${failureNotes ? ' - ' + failureNotes : ''}`
            },
            {
              missionId: activeMission.id,
              stopId: currentStop.id,
              currentDriverId: currentUser.id,
              currentVehicleId: activeMission.vehicleId
            }
          );
        } catch (e) { reportError('driver.multiColis.item', e, { silent: true }); }
      }

      // Upload photos d'échec si présentes (preuve de tentative)
      if (failurePhotos.length > 0) {
        setUploadProgress({ step: 'compressing', current: 0, total: 1, message: 'Envoi preuve...' });
        await uploadFailurePOD({
          missionId: activeMission.id,
          stopId: currentStop.id,
          packageIds: currentStop.packageIds,
          driverId: currentUser.id,
          driverName: `${currentUser.firstName} ${currentUser.lastName}`,
          vehicleId: activeMission.vehicleId || '',
          vehiclePlate: activeMission.vehiclePlate || '',
          failureReason,
          failureNotes,
          photosBase64: failurePhotos,
          coordinates: coords || { lat: 0, lng: 0 }
        }, setUploadProgress);
      }

      // FIX BUG 2: Prochain stop dans l'ORDRE TRIÉ
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

      showNotif(allDone ? '🏁 Tournée terminée' : `⚠️ Stop ${currentStop.sequence} — échec enregistré`);
    } catch (err) {
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
      try {
        coords = await getCurrentPosition();
      } catch {
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

  // Ajouter un arrêt manuel (adresse hors import)
  const handleAddManualStop = async () => {
    if (!activeMission) return;
    if (!manualStop.address.trim() || !manualStop.city.trim()) {
      showNotif('⚠️ Adresse et ville obligatoires');
      return;
    }
    try {
      await addManualStopToMission(activeMission.id, {
        contactName: manualStop.contactName.trim() || 'Arrêt manuel',
        address: manualStop.address.trim(),
        postalCode: manualStop.postalCode.trim(),
        city: manualStop.city.trim(),
        contactPhone: manualStop.contactPhone.trim() || undefined
      });
      setShowManualStop(false);
      setManualStop({ contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });
      showNotif('➕ Arrêt manuel ajouté à votre tournée');
    } catch (e) {
      reportError('driver.addManualStop', e, { silent: true });
      showNotif(`❌ Erreur lors de l'ajout de l'arrêt${e instanceof Error ? ` — ${e.message}` : ''}`);
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
      await finalizePickup({
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

      // 2. MAJ du stop
      const updatedStops = activeMission.stops.map(s =>
        s.id === currentStop.id ? {
          ...s,
          status: StopStatus.COMPLETED,
          completionTime: now,
          arrivalCoordinates: coords || s.arrivalCoordinates
        } : s
      );

      const { completedStops, failedStops } = recomputeMissionCounters(updatedStops);
      const collectedPkgs = (activeMission.deliveredPackages || 0) + scannedIds.length;

      const allDone = updatedStops.every(s =>
        s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED
      );

      await updateMission({
        ...activeMission,
        stops: updatedStops,
        completedStops,
        failedStops,
        deliveredPackages: collectedPkgs,
        status: allDone ? MissionStatus.COMPLETED : MissionStatus.IN_PROGRESS,
        ...(allDone ? { completedAt: now } : {})
      });

      // 3. Prochain stop
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
          ? '🎉 Tournée terminée !'
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

  // ============================================================================
  // RENDU — Loading
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-slate-500">Chargement de vos tournées...</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDU — Aucune mission
  // ============================================================================

  if (missions.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center px-6">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Truck size={36} className="text-slate-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">Aucune tournée aujourd'hui</h2>
          <p className="text-slate-500 text-sm">
            Vos missions du {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} apparaîtront ici quand le dispatch les enverra.
          </p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDU — Vue active (navigation stop-par-stop)
  // ============================================================================

  if (activeMission && activeMission.status === MissionStatus.IN_PROGRESS) {
    return (
      <div className="max-w-lg mx-auto pb-6 space-y-3 animate-fade-in">
        {/* Notification toast */}
        {notification && (
          <div className="fixed top-4 left-4 right-4 z-50 bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-center text-sm font-medium animate-fade-in">
            {notification}
          </div>
        )}

        {/* === ALERTE COLIS À RETOURNER === */}
        {returnPackages.length > 0 && (
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-xl">⚠️</span>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-yellow-800 text-sm">
                  {returnPackages.length} colis à retourner au hub
                </h3>
                <p className="text-xs text-yellow-700 mt-0.5">
                  Ces colis ont été retirés de votre tournée. Ramenez-les au hub.
                </p>
                <div className="mt-2 space-y-1.5">
                  {returnPackages.map(pkg => (
                    <div key={pkg.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-yellow-200">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{pkg.orderNumber}</p>
                        <p className="text-xs text-slate-500 truncate">{pkg.contactName}</p>
                      </div>
                      <button
                        onClick={() => openReturnModal(pkg)}
                        className="ml-2 px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-bold hover:bg-yellow-600 active:scale-95 transition-all"
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

        {/* === HEADER PROGRESSION === */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Ma tournée — {activeMission.zone}</h2>
                <p className="text-xs text-slate-500">
                  {activeMission.vehiclePlate} • {activeMission.hubName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold text-slate-800">{missionProgress}%</p>
                <p className="text-[10px] text-slate-500 uppercase font-medium">
                  {activeMission.completedStops || 0}/{sortedStops.length} stops
                </p>
              </div>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${missionProgress}%`,
                  background: missionProgress >= 90 ? '#22c55e' : missionProgress >= 50 ? '#f59e0b' : '#3b82f6'
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
              <span>✅ {activeMission.deliveredPackages || 0} livrés</span>
              {(activeMission.failedPackages || 0) > 0 && (
                <span className="text-red-500">❌ {activeMission.failedPackages} échecs</span>
              )}
              <span>📦 {activeMission.totalPackages} total</span>
            </div>
          </div>

          {/* Mini liste stops scrollable */}
          <div className="border-t border-slate-100 px-2 py-2 flex gap-1.5 overflow-x-auto">
            {sortedStops.map((stop, idx) => (
              <button
                key={stop.id}
                onClick={() => setActiveStopIndex(idx)}
                className={`flex-shrink-0 w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                  idx === activeStopIndex
                    ? 'bg-blue-600 text-white ring-2 ring-blue-300 scale-110'
                    : stop.status === StopStatus.COMPLETED
                      ? 'bg-green-100 text-green-700'
                      : stop.status === StopStatus.FAILED || stop.status === StopStatus.SKIPPED
                        ? 'bg-red-100 text-red-700'
                        : stop.status === StopStatus.ARRIVED
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                }`}
              >
                {stop.status === StopStatus.COMPLETED ? '✓' :
                 stop.status === StopStatus.FAILED ? '✗' :
                 stop.sequence}
              </button>
            ))}
          </div>
        </div>

        {/* === STOP ACTIF === */}
        {currentStop && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            {/* Header stop */}
            <div className={`p-4 ${
              currentStop.status === StopStatus.COMPLETED ? 'bg-green-50' :
              currentStop.status === StopStatus.FAILED ? 'bg-red-50' :
              currentStop.status === StopStatus.ARRIVED ? 'bg-blue-50' :
              'bg-white'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-500">
                  STOP {currentStop.sequence}/{sortedStops.length}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  currentStop.status === StopStatus.COMPLETED ? 'bg-green-100 text-green-700' :
                  currentStop.status === StopStatus.FAILED ? 'bg-red-100 text-red-700' :
                  currentStop.status === StopStatus.ARRIVED ? 'bg-blue-100 text-blue-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {currentStop.status}
                </span>
              </div>

              {/* Contact + type badge */}
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl font-bold text-slate-800">{currentStop.contactName || 'Sans contact'}</h3>
                {isPickupStop && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold uppercase tracking-wide">
                    📦 Enlèvement
                  </span>
                )}
              </div>

              {/* Adresse */}
              <p className="text-sm text-slate-600 mb-2">
                📍 {currentStop.address}, {currentStop.postalCode} {currentStop.city}
              </p>

              {/* Info rapides */}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 bg-white rounded-lg border border-slate-200 font-medium">
                  📦 {currentStop.packageCount} colis
                </span>
                <span className="px-2 py-1 bg-white rounded-lg border border-slate-200 font-medium">
                  ⏱ ~{currentStop.serviceTime} min
                </span>
                {currentStop.floor != null && (
                  <span className="px-2 py-1 bg-white rounded-lg border border-slate-200 font-medium">
                    🏢 Étage {currentStop.floor} {currentStop.hasElevator ? '(asc.)' : ''}
                  </span>
                )}
                {currentStop.timeWindowStart && currentStop.timeWindowEnd && (
                  <span className="px-2 py-1 bg-amber-50 border border-amber-200 rounded-lg font-medium text-amber-700">
                    🕐 {currentStop.timeWindowStart} - {currentStop.timeWindowEnd}
                  </span>
                )}
              </div>

              {/* Liste des colis à remettre à ce point de livraison */}
              {!isPickupStop && stopPackages.length > 0 && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-1.5">
                    {stopPackages.length > 1 ? `${stopPackages.length} colis à remettre` : 'Colis à remettre'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {stopPackages.map((p, i) => (
                      <span
                        key={p.id}
                        className="px-2 py-1 bg-white border border-blue-200 rounded-lg text-[11px] font-mono font-bold text-blue-800"
                      >
                        {p.externalId || p.barcode}
                        {stopPackages.length > 1 && (
                          <span className="ml-1 font-sans font-medium text-blue-500">{i + 1}/{stopPackages.length}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Filet de sécurité : colis à la même adresse hors de cet arrêt */}
              {!isPickupStop && otherAtAddress.length > 0 && (
                <div className="mt-2 p-3 bg-red-50 border-2 border-red-300 rounded-lg">
                  <p className="text-xs font-black text-red-700 flex items-center gap-1.5">
                    <XCircle size={14} />
                    ATTENTION — {otherAtAddress.length} autre{otherAtAddress.length > 1 ? 's' : ''} colis à cette adresse !
                  </p>
                  <p className="text-[11px] text-red-600 mt-1">
                    {stopPackages.length + otherAtAddress.length} colis semblent destinés à ce client, tu n'en as que <b>{stopPackages.length}</b> dans cet arrêt. Vérifie avec le client avant de repartir.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {otherAtAddress.map(p => (
                      <span key={p.id} className="px-2 py-1 bg-white border border-red-200 rounded-lg text-[11px] font-mono font-bold text-red-700">
                        {p.externalId || p.barcode}
                      </span>
                    ))}
                  </div>
                  {claimableOthers.length > 0 && (
                    <button
                      onClick={handleClaimOthersToStop}
                      disabled={isClaimingOthers}
                      className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-red-600 text-white rounded-lg font-bold text-xs active:scale-95 transition-transform disabled:opacity-50"
                    >
                      {isClaimingOthers ? <Loader2 size={14} className="animate-spin" /> : <PackageIcon size={14} />}
                      Ajouter {claimableOthers.length} colis à cet arrêt
                    </button>
                  )}
                </div>
              )}

              {currentStop.notes && (
                <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  📝 {currentStop.notes}
                </div>
              )}
            </div>

            {/* Actions rapides */}
            <div className="p-3 border-t border-slate-100 flex gap-2">
              {/* Naviguer */}
              <button
                onClick={() => openNavigation(currentStop)}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              >
                <Navigation size={18} />
                Naviguer
              </button>

              {/* Appeler */}
              {currentStop.contactPhone && (
                <button
                  onClick={() => callContact(currentStop.contactPhone!)}
                  className="flex items-center justify-center w-12 h-12 bg-green-50 border border-green-200 rounded-xl text-green-700 active:scale-95 transition-transform"
                >
                  <Phone size={20} />
                </button>
              )}
            </div>

            {/* === ACTIONS DE LIVRAISON === */}
            {currentStop.status !== StopStatus.COMPLETED && currentStop.status !== StopStatus.FAILED && currentStop.status !== StopStatus.SKIPPED && (
              <div className="p-3 border-t border-slate-100 space-y-2">
                {/* Étape 1: Arrivée */}
                {currentStop.status === StopStatus.PENDING && (
                  <button
                    onClick={handleArriveAtStop}
                    disabled={isProcessing}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-50 border-2 border-blue-200 text-blue-700 rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <MapPinned size={18} />}
                    Je suis arrivé
                  </button>
                )}

                {/* Étape 2: Actions selon le type de stop */}
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

                {/* ===== MODE LIVRAISON (DELIVERY) ===== */}
                {currentStop.status === StopStatus.ARRIVED && !isPickupStop && (
                  <>
                    {/* Progression de l'assistant de livraison */}
                    <div className="flex items-center gap-1 px-1 pb-1">
                      {DELIVERY_STEPS.map((label, i) => (
                        <div key={label} className="flex-1 flex flex-col items-center gap-1">
                          <div className={`w-full h-1.5 rounded-full ${i <= deliveryStep ? 'bg-green-500' : 'bg-slate-200'}`} />
                          <span className={`text-[9px] font-bold ${i === deliveryStep ? 'text-green-700' : 'text-slate-400'}`}>{label}</span>
                        </div>
                      ))}
                    </div>

                    {/* ===== ÉTAPE 1 · COLIS ===== */}
                    {deliveryStep === 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-slate-800 px-1">Étape 1 · Vérifier les colis ({stopPackages.length})</p>
                        {stopPackages.length > 0 ? (
                          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-slate-700">
                                📷 Colis scannés : {deliveryScannedCount}/{stopPackages.length}
                              </p>
                              <button
                                onClick={() => setShowScanner(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold active:scale-95 transition-transform"
                              >
                                <Camera size={14} />
                                Scanner
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {stopPackages.map(p => {
                                const ok = scannedStopIds.has(p.id);
                                const noCode = packageScanCodes(p).length === 0;
                                return (
                                  <span
                                    key={p.id}
                                    title={noCode ? 'Ce colis n’a pas de code scannable — à valider en « Forcer »' : undefined}
                                    className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold border ${
                                      ok
                                        ? 'bg-green-50 border-green-300 text-green-700'
                                        : noCode
                                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                                          : 'bg-slate-50 border-slate-200 text-slate-500'
                                    }`}
                                  >
                                    {ok ? '✓ ' : noCode ? '⚠️ ' : ''}{packageDisplayCode(p) || 'sans code'}
                                  </span>
                                );
                              })}
                            </div>
                            {!allStopScanned && (
                              <p className="text-[11px] text-amber-600 font-medium">
                                ⚠️ {missingStopCodes.length} colis non scanné{missingStopCodes.length > 1 ? 's' : ''} — le compte sera demandé à la validation
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500 px-1">Aucun colis listé pour ce point.</p>
                        )}
                      </div>
                    )}

                    {/* ===== ÉTAPE 2 · ÉTAT MARCHANDISE ===== */}
                    {deliveryStep === 1 && (
                      <div className="space-y-2">
                        <p className="text-sm font-bold text-slate-800 px-1">Étape 2 · État de la marchandise</p>
                        <button
                          onClick={() => setMerchandiseGood(g => !g)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${merchandiseGood ? 'bg-green-50 border-green-400' : 'bg-white border-slate-200'}`}
                        >
                          <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${merchandiseGood ? 'bg-green-500 text-white' : 'border-2 border-slate-300'}`}>
                            {merchandiseGood && <CheckCircle size={18} />}
                          </div>
                          <span className="text-sm font-medium text-slate-800">Marchandises reçues en <b>bon état</b>, sans réserve</span>
                        </button>
                        {!merchandiseGood && (
                          <div className="px-1">
                            <label className="text-xs font-bold text-amber-700 mb-1 block">⚠️ Réserves — précisez :</label>
                            <textarea
                              value={reservesNote}
                              onChange={(e) => setReservesNote(e.target.value)}
                              placeholder="Colis manquant, emballage endommagé, contenu non conforme…"
                              rows={3}
                              className="w-full px-3 py-2.5 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* ===== ÉTAPE 3 · RÉCEPTION ===== */}
                    {deliveryStep === 2 && (
                      <div className="space-y-3">
                        <p className="text-sm font-bold text-slate-800 px-1">Étape 3 · Réception</p>
                        {/* Nom réceptionnaire */}
                        <div className="px-1">
                          <label className="text-xs font-medium text-slate-500 mb-1 block">
                            Nom du réceptionnaire
                            <span className="text-red-400 ml-1">*</span>
                          </label>
                          <input
                            type="text"
                            value={recipientName}
                            onChange={(e) => setRecipientName(e.target.value)}
                            placeholder="Nom de la personne qui réceptionne"
                            className="w-full px-3 py-3 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 focus:border-green-400 outline-none"
                          />
                        </div>
                        {/* Lieu de remise */}
                        <div className="px-1">
                          <label className="text-xs font-medium text-slate-500 mb-1 block">
                            📍 Lieu de remise
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.values(DeliveryLocation).map(loc => (
                              <button
                                key={loc}
                                onClick={() => setDeliveryLocation(loc as DeliveryLocation)}
                                className={`px-2 py-2.5 rounded-lg text-xs font-medium transition-colors text-left ${
                                  deliveryLocation === loc
                                    ? 'bg-green-100 border-2 border-green-400 text-green-800'
                                    : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {loc === DeliveryLocation.HAND_DELIVERY && '🤝 '}
                                {loc === DeliveryLocation.NEIGHBOR && '🏠 '}
                                {loc === DeliveryLocation.CONCIERGE && '🔑 '}
                                {loc === DeliveryLocation.MAILBOX && '📬 '}
                                {loc === DeliveryLocation.RECEPTION && '🏢 '}
                                {loc === DeliveryLocation.SAFE_PLACE && '🔒 '}
                                {loc === DeliveryLocation.OTHER && '📋 '}
                                {loc}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ===== ÉTAPE 4 · PREUVE ===== */}
                    {deliveryStep === 3 && (
                      <div className="space-y-3">
                        <p className="text-sm font-bold text-slate-800 px-1">Étape 4 · Preuve (signature + photos)</p>
                        {/* Signature */}
                        {!showSignature && !signatureData && (
                          <button
                            onClick={() => setShowSignature(true)}
                            className="w-full flex items-center justify-center gap-2 py-3.5 bg-amber-50 border-2 border-dashed border-amber-300 text-amber-700 rounded-xl font-bold text-sm"
                          >
                            <PenTool size={16} />
                            ✍️ Capturer la signature *
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
                            <CheckCircle size={16} className="text-green-600" />
                            <span className="text-xs text-green-700 font-bold flex-1">Signature enregistrée ✓</span>
                            <button onClick={() => { setSignatureData(null); setShowSignature(true); }} className="text-xs text-green-600 underline font-medium">
                              Refaire
                            </button>
                          </div>
                        )}

                        {/* Photos — max 5 */}
                        <div className="px-1">
                          <label className="text-xs font-medium text-slate-500 mb-1.5 block">
                            📸 Photos du colis / lieu de livraison
                          </label>
                          <button
                            onClick={() => photoInputRef.current?.click()}
                            disabled={capturedPhotos.length >= MAX_PHOTOS}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Camera size={16} />
                            {capturedPhotos.length >= MAX_PHOTOS
                              ? `Maximum atteint (${MAX_PHOTOS}/${MAX_PHOTOS})`
                              : `Prendre une photo (${capturedPhotos.length}/${MAX_PHOTOS})`
                            }
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
                                <img src={photo} alt={`Photo ${i+1}`} className="w-20 h-20 rounded-lg object-cover border-2 border-slate-200" />
                                <button
                                  onClick={() => setCapturedPhotos(prev => prev.filter((_, idx) => idx !== i))}
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] shadow-md"
                                >
                                  ✕
                                </button>
                                <span className="absolute bottom-0.5 left-0.5 bg-black/50 text-white text-[9px] px-1 rounded">
                                  {i + 1}/{capturedPhotos.length}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {!signatureData && (
                          <p className="text-[11px] text-amber-600 font-medium text-center px-2">
                            ⚠️ Signature obligatoire pour valider la livraison
                          </p>
                        )}
                      </div>
                    )}

                    {/* ===== ÉTAPE 5 · VALIDATION ===== */}
                    {deliveryStep === 4 && (
                      <div className="space-y-3">
                        <p className="text-sm font-bold text-slate-800 px-1">Étape 5 · Validation</p>
                        {/* Récapitulatif */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm space-y-1.5">
                          <div className="flex justify-between"><span className="text-slate-500">Colis</span><span className="font-bold">{stopPackages.length}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">État marchandise</span><span className={`font-bold ${merchandiseGood ? 'text-green-700' : 'text-amber-700'}`}>{merchandiseGood ? 'Bon état' : 'Réserves'}</span></div>
                          {!merchandiseGood && reservesNote.trim() && (
                            <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">{reservesNote.trim()}</div>
                          )}
                          <div className="flex justify-between"><span className="text-slate-500">Réceptionné par</span><span className="font-bold">{recipientName || '—'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Lieu de remise</span><span className="font-bold">{deliveryLocation}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Signature</span><span className="font-bold">{signatureData ? '✓' : '—'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Photos</span><span className="font-bold">{capturedPhotos.length}</span></div>
                        </div>

                        {/* Barre de progression upload */}
                        {uploadProgress && uploadProgress.step !== 'done' && uploadProgress.step !== 'error' && (
                          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Loader2 size={14} className="animate-spin text-blue-600" />
                              <span className="text-xs font-bold text-blue-700">{uploadProgress.message}</span>
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
                          onClick={() => { if (allStopScanned) { handleDeliverySuccess(); } else { setShowScanGate(true); } }}
                          disabled={isProcessing || !signatureData || !recipientName.trim()}
                          className="w-full flex items-center justify-center gap-2 py-4 bg-green-600 text-white rounded-xl font-bold text-base active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                          Livré ✓
                        </button>
                      </div>
                    )}

                    {/* Navigation entre étapes */}
                    <div className="flex gap-2 pt-1">
                      {deliveryStep > 0 && (
                        <button
                          onClick={() => setDeliveryStep(s => Math.max(0, s - 1))}
                          disabled={isProcessing}
                          className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40"
                        >
                          ← Retour
                        </button>
                      )}
                      {deliveryStep < 4 && (
                        <button
                          onClick={() => setDeliveryStep(s => Math.min(4, s + 1))}
                          disabled={(deliveryStep === 2 && !recipientName.trim()) || (deliveryStep === 3 && !signatureData)}
                          className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Suivant →
                        </button>
                      )}
                    </div>

                    {/* Échec possible à tout moment */}
                    <button
                      onClick={() => setShowFailureModal(true)}
                      disabled={isProcessing}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-red-600 text-xs font-bold disabled:opacity-50"
                    >
                      <XCircle size={14} />
                      Signaler un échec de livraison
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Stop déjà traité */}
            {(currentStop.status === StopStatus.COMPLETED || currentStop.status === StopStatus.FAILED) && (
              <div className={`p-4 border-t ${currentStop.status === StopStatus.COMPLETED ? 'bg-green-50' : 'bg-red-50'}`}>
                <p className="text-sm font-bold text-center">
                  {currentStop.status === StopStatus.COMPLETED ? '✅ Ce stop a été livré' : '❌ Échec enregistré'}
                </p>
                {currentStop.completionTime && (
                  <p className="text-xs text-center text-slate-500 mt-1">
                    {new Date(currentStop.completionTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation entre stops */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveStopIndex(Math.max(0, activeStopIndex - 1))}
            disabled={activeStopIndex === 0}
            className="flex-1 flex items-center justify-center gap-1 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 disabled:opacity-30"
          >
            <ArrowLeft size={16} /> Précédent
          </button>
          {nextPendingStopIndex >= 0 && nextPendingStopIndex !== activeStopIndex && (
            <button
              onClick={() => setActiveStopIndex(nextPendingStopIndex)}
              className="flex-1 flex items-center justify-center gap-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold"
            >
              Prochain stop <ChevronRight size={16} />
            </button>
          )}
          <button
            onClick={() => setActiveStopIndex(Math.min(sortedStops.length - 1, activeStopIndex + 1))}
            disabled={activeStopIndex >= sortedStops.length - 1}
            className="flex-1 flex items-center justify-center gap-1 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 disabled:opacity-30"
          >
            Suivant <ChevronRight size={16} />
          </button>
        </div>

        {/* Recevoir des colis d'un autre chauffeur (transfert en route) */}
        <button
          onClick={() => setShowTransferModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-blue-200 rounded-xl text-sm font-medium text-blue-700 active:scale-95 transition-transform"
        >
          🔁 Recevoir des colis (transfert)
        </button>

        {/* Prendre en charge des colis par scan (importés non affectés) */}
        <button
          onClick={() => setShowClaimModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl text-sm font-bold active:scale-95 transition-transform"
        >
          📦 Prendre en charge des colis (scan)
        </button>

        {/* Organisation de la tournée : optimiser / réorganiser / ajouter un arrêt */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleOptimizeTour}
            disabled={isOptimizing}
            className="flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
          >
            {isOptimizing ? <Loader2 size={16} className="animate-spin" /> : '🧭'} Optimiser
          </button>
          <button
            onClick={() => setShowReorder(true)}
            className="flex items-center justify-center gap-2 py-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-700 active:scale-95 transition-transform"
          >
            ↕️ Réorganiser
          </button>
        </div>
        <button
          onClick={() => setShowManualStop(true)}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-amber-300 rounded-xl text-sm font-medium text-amber-700 active:scale-95 transition-transform"
        >
          ➕ Ajouter un arrêt manuel
        </button>

        {/* Signaler un problème au bureau (incident) */}
        <button
          onClick={() => setShowIssue(true)}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-red-200 rounded-xl text-sm font-medium text-red-600 active:scale-95 transition-transform"
        >
          🛠️ Signaler un problème
        </button>

        {/* Bouton retour liste */}
        <button
          onClick={() => setActiveMissionId(null)}
          className="w-full flex items-center justify-center gap-2 py-3 text-slate-500 text-sm"
        >
          <ArrowLeft size={14} /> Voir toutes mes tournées
        </button>

        {/* === GARDE-FOU : colis manquants avant validation livraison === */}
        {showScanGate && currentStop && (
          <ScanGateDialog
            clientName={currentStop.contactName || 'ce client'}
            missingCodes={missingStopCodes}
            total={stopPackages.length}
            actionLabel="Forcer la livraison"
            onCancel={() => setShowScanGate(false)}
            onForce={() => { setShowScanGate(false); setScanBypass(true); handleDeliverySuccess(); }}
          />
        )}

        {/* === MODAL TRANSFERT EN ROUTE === */}
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

        {/* === MODAL GPS OBLIGATOIRE (action bloquée sans localisation) === */}
        {gpsBlocked && (
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 text-center space-y-3">
              <div className="text-5xl">📍</div>
              <h3 className="font-bold text-lg text-slate-900">Localisation obligatoire</h3>
              <p className="text-sm font-semibold text-slate-800">
                {gpsErrorMsg || `${currentUser.firstName ? currentUser.firstName + ', ' : ''}active ta localisation pour continuer stp 🙏`}
              </p>
              <div className="text-left text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                {gpsIsPermission ? (
                  <>
                    <p>1️⃣ Ouvre le <b>menu du navigateur</b> (cadenas 🔒 dans la barre d'adresse)</p>
                    <p>2️⃣ <b>Autorise la localisation</b> pour ce site</p>
                    <p>3️⃣ Reviens ici et appuie sur <b>Réessayer</b></p>
                  </>
                ) : (
                  <>
                    <p>1️⃣ Ouvre les <b>réglages</b> de ton téléphone</p>
                    <p>2️⃣ Active la <b>localisation / GPS</b></p>
                    <p>3️⃣ Reviens ici et appuie sur <b>Réessayer</b></p>
                  </>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setGpsBlocked(false)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm active:scale-95 transition-transform"
                >
                  Annuler
                </button>
                <button
                  onClick={() => { setGpsBlocked(false); (gpsRetry || handleDeliverySuccess)(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
                >
                  <MapPin size={16} /> Réessayer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === MODAL PRISE EN CHARGE PAR SCAN === */}
        {showClaimModal && (
          <ClaimScanModal
            currentUser={currentUser}
            onClose={() => setShowClaimModal(false)}
            onDone={(count) => {
              setShowClaimModal(false);
              showNotif(`📦 ${count} colis pris en charge dans votre tournée`);
            }}
          />
        )}

        {/* === MODAL RÉORGANISER (drag & drop) === */}
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

        {/* === MODAL AJOUT ARRÊT MANUEL === */}
        {showManualStop && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowManualStop(false)}>
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">➕ Ajouter un arrêt manuel</h3>
                <button onClick={() => setShowManualStop(false)} className="p-2 rounded-full hover:bg-slate-100"><XCircle size={20} className="text-slate-400" /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <span className="text-lg">⚠️</span>
                  <p className="text-xs text-amber-800">
                    Cet arrêt n'a <b>pas de colis rattaché</b> et ne provient pas d'un import client. Il ne sera pas suivi dans le portail client. À utiliser uniquement pour un passage exceptionnel.
                  </p>
                </div>
                <input type="text" placeholder="Nom du destinataire (optionnel)" value={manualStop.contactName}
                  onChange={e => setManualStop(s => ({ ...s, contactName: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                <input type="text" placeholder="Adresse *" value={manualStop.address}
                  onChange={e => setManualStop(s => ({ ...s, address: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                <div className="flex gap-2">
                  <input type="text" inputMode="numeric" placeholder="Code postal" value={manualStop.postalCode}
                    onChange={e => setManualStop(s => ({ ...s, postalCode: e.target.value }))}
                    className="w-1/3 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                  <input type="text" placeholder="Ville *" value={manualStop.city}
                    onChange={e => setManualStop(s => ({ ...s, city: e.target.value }))}
                    className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                </div>
                <input type="tel" placeholder="Téléphone (optionnel)" value={manualStop.contactPhone}
                  onChange={e => setManualStop(s => ({ ...s, contactPhone: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
              </div>
              <div className="p-4 border-t border-slate-200 flex gap-2">
                <button onClick={handleAddManualStop} className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform">
                  Ajouter l'arrêt
                </button>
                <button onClick={() => setShowManualStop(false)} className="px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm">
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === MODAL SIGNALER UN PROBLÈME === */}
        {showIssue && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowIssue(false)}>
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">🛠️ Signaler un problème</h3>
                <button onClick={() => setShowIssue(false)} className="p-2 rounded-full hover:bg-slate-100"><XCircle size={20} className="text-slate-400" /></button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Type de problème</label>
                  <select value={issueForm.category} onChange={e => setIssueForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                    <option>Véhicule / panne</option>
                    <option>Accident</option>
                    <option>Colis abîmé / manquant</option>
                    <option>Adresse introuvable / erronée</option>
                    <option>Client / destinataire</option>
                    <option>Autre</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Description *</label>
                  <textarea value={issueForm.description} onChange={e => setIssueForm(f => ({ ...f, description: e.target.value }))}
                    rows={3} placeholder="Décrivez le problème…"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Urgence</label>
                  <div className="flex gap-2">
                    {([['Low', 'Basse'], ['Medium', 'Moyenne'], ['High', 'Haute']] as const).map(([val, label]) => (
                      <button key={val} onClick={() => setIssueForm(f => ({ ...f, priority: val }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold border ${issueForm.priority === val ? (val === 'High' ? 'bg-red-600 text-white border-red-600' : val === 'Medium' ? 'bg-amber-500 text-white border-amber-500' : 'bg-slate-600 text-white border-slate-600') : 'bg-white text-slate-600 border-slate-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-200 flex gap-2">
                <button onClick={handleSubmitIssue} disabled={issueSubmitting} className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50">
                  {issueSubmitting ? 'Envoi…' : 'Envoyer au bureau'}
                </button>
                <button onClick={() => setShowIssue(false)} className="px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm">
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* === MODAL ÉCHEC === */}
        {showFailureModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center p-0 sm:items-center sm:p-4">
            <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden animate-slide-up max-h-[85vh] overflow-y-auto">
              <div className="p-4 bg-red-50 border-b border-red-100">
                <h3 className="text-lg font-bold text-red-800">Raison de l'échec</h3>
                <p className="text-xs text-red-600">Stop {currentStop?.sequence} — {currentStop?.contactName}</p>
              </div>
              <div className="p-4 space-y-3">
                {Object.values(FailureReason).map(reason => (
                  <button
                    key={reason}
                    onClick={() => setFailureReason(reason as FailureReason)}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      failureReason === reason
                        ? 'bg-red-50 border-red-300 text-red-800'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
                <textarea
                  value={failureNotes}
                  onChange={(e) => setFailureNotes(e.target.value)}
                  placeholder="Commentaire supplémentaire (optionnel)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none h-20"
                />

                {/* Photo preuve d'échec */}
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-bold text-slate-500 mb-2">📷 Photo preuve <span className="text-red-500">obligatoire</span></p>
                  <button
                    onClick={() => failurePhotoInputRef.current?.click()}
                    disabled={failurePhotos.length >= MAX_PHOTOS}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium disabled:opacity-40"
                  >
                    <Camera size={14} />
                    Photo porte / boîte aux lettres ({failurePhotos.length}/{MAX_PHOTOS})
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
                    <p className="text-[11px] text-red-500 font-medium mt-1.5 text-center">
                      ⚠️ Au moins 1 photo requise pour confirmer l'échec
                    </p>
                  )}
                  {failurePhotos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {failurePhotos.map((photo, i) => (
                        <div key={i} className="relative flex-shrink-0">
                          <img src={photo} alt={`Échec ${i+1}`} className="w-16 h-16 rounded-lg object-cover border border-red-200" />
                          <button
                            onClick={() => setFailurePhotos(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[9px]"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Barre progression si upload en cours */}
                {uploadProgress && uploadProgress.step !== 'done' && uploadProgress.step !== 'error' && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-2">
                    <div className="flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin text-red-600" />
                      <span className="text-xs text-red-700">{uploadProgress.message}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-4 border-t border-slate-100 flex gap-2">
                <button
                  onClick={() => { setShowFailureModal(false); setFailureNotes(''); setFailurePhotos([]); }}
                  className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600"
                >
                  Annuler
                </button>
                <button
                  onClick={handleDeliveryFailure}
                  disabled={isProcessing || failurePhotos.length === 0}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold disabled:opacity-50"
                >
                  {isProcessing ? 'Envoi...' : failurePhotos.length === 0 ? '📷 Photo requise' : 'Confirmer échec'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scanner code-barres (plein écran, lazy-loaded) */}
        {showScanner && (
          <Suspense fallback={
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
              <div className="text-center text-white">
                <Loader2 size={32} className="animate-spin mx-auto mb-3" />
                <p className="text-sm">Chargement du scanner...</p>
              </div>
            </div>
          }>
            <BarcodeScanner
              onScan={handleBarcodeScan}
              onClose={() => setShowScanner(false)}
              expectedBarcodes={stopPackages.flatMap(p => packageScanCodes(p))}
              alreadyScanned={scannedBarcodes}
              title={`${isPickupStop ? 'Scan enlèvement' : 'Scan livraison'} — ${currentStop?.contactName || ''}`}
              hint={isPickupStop ? undefined : 'Scannez le code DELIVREX — le petit carré (DataMatrix) en bas à gauche'}
              progress={stopPackages.length > 0 ? { done: deliveryScannedCount, total: stopPackages.length } : undefined}
              isMatch={(code) => stopPackages.some(p => packageMatchesCode(p, code))}
            />
          </Suspense>
        )}

        {/* === MODAL RETOUR HUB === */}
        {showReturnModal && returningPackage && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center">
            <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
              {/* Header */}
              <div className="p-4 border-b border-slate-200 bg-yellow-50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800">Retour hub</h3>
                    <p className="text-xs text-yellow-700">{returningPackage.orderNumber} — {returningPackage.contactName}</p>
                  </div>
                  <button 
                    onClick={() => setShowReturnModal(false)}
                    className="p-2 rounded-full hover:bg-yellow-100"
                  >
                    <XCircle size={20} className="text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Raison du retour */}
              <div className="p-4 bg-amber-50 border-b border-amber-200">
                <p className="text-xs text-amber-800 font-medium">
                  ⚠️ {returningPackage.returnReason || 'Ce colis a été retiré de votre tournée'}
                </p>
              </div>

              {/* Contenu */}
              <div className="p-4 space-y-4">
                {/* Photos (obligatoire) */}
                <div>
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1 mb-2">
                    📷 Photo du colis <span className="text-red-500">*</span>
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
                          onClick={() => setReturnPhotos(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {returnPhotos.length < 5 && (
                      <button
                        onClick={() => returnPhotoInputRef.current?.click()}
                        className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-yellow-400 hover:text-yellow-500"
                      >
                        <Camera size={24} />
                      </button>
                    )}
                  </div>
                  {returnPhotos.length === 0 && (
                    <p className="text-xs text-red-500 mt-1">⚠️ Au moins 1 photo obligatoire</p>
                  )}
                </div>

                {/* Signature (optionnelle) */}
                <div>
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1 mb-2">
                    ✍️ Signature réception hub <span className="text-slate-400">(optionnel)</span>
                  </label>
                  {returnSignature ? (
                    <div className="relative">
                      <img src={returnSignature} alt="Signature" className="w-full h-20 object-contain border border-slate-200 rounded-lg bg-white" />
                      <button
                        onClick={() => setReturnSignature(null)}
                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowReturnSignature(true)}
                      className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 text-sm flex items-center justify-center gap-2 hover:border-yellow-400"
                    >
                      <PenTool size={16} />
                      Ajouter signature
                    </button>
                  )}
                </div>

                {/* Info géoloc */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-500">
                    📍 Votre position GPS sera enregistrée automatiquement pour confirmer la remise au hub.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="p-4 border-t border-slate-200 space-y-2">
                <button
                  onClick={handleConfirmReturn}
                  disabled={isProcessing || returnPhotos.length === 0}
                  className="w-full py-3.5 bg-yellow-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
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
                  onClick={() => setShowReturnModal(false)}
                  disabled={isProcessing}
                  className="w-full py-2 text-slate-500 text-sm"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal signature retour */}
        {showReturnSignature && (
          <div className="fixed inset-0 z-[60] bg-black flex flex-col">
            <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
              <h3 className="text-white font-bold">Signature réception hub</h3>
              <button onClick={() => setShowReturnSignature(false)} className="text-white p-1">
                <XCircle size={24} />
              </button>
            </div>
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
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDU — Liste des missions (quand pas de mission active)
  // ============================================================================

  return (
    <div className="max-w-lg mx-auto pb-6 space-y-4 animate-fade-in">
      {/* Notification toast */}
      {notification && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-center text-sm font-medium animate-fade-in">
          {notification}
        </div>
      )}

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-800">Mes tournées</h2>
        <p className="text-sm text-slate-500">
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Prendre en charge des colis par scan (même sans tournée active) */}
      <button
        onClick={() => setShowClaimModal(true)}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl text-sm font-bold active:scale-95 transition-transform shadow-sm"
      >
        📦 Prendre en charge des colis (scan)
      </button>

      {/* Modal prise en charge (vue liste) */}
      {showClaimModal && (
        <ClaimScanModal
          currentUser={currentUser}
          onClose={() => setShowClaimModal(false)}
          onDone={(count) => {
            setShowClaimModal(false);
            showNotif(`📦 ${count} colis pris en charge dans votre tournée`);
          }}
        />
      )}

      {/* Liste des missions */}
      {missions.map(mission => {
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
                    <h3 className="text-lg font-bold text-slate-800">Tournée {mission.zone}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusColors.bg} ${statusColors.text}`}>
                      {mission.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500">
                    {mission.vehiclePlate} • {mission.hubName} • {mission.stops.length} stops
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-extrabold text-slate-800">{mission.totalPackages}</p>
                  <p className="text-[10px] text-slate-500 uppercase">colis</p>
                </div>
              </div>

              {/* Métriques */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500">Distance</p>
                  <p className="text-sm font-bold text-slate-800">{formatDistance(mission.totalDistance) || '-'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500">Durée est.</p>
                  <p className="text-sm font-bold text-slate-800">{formatDuration(mission.estimatedDuration) || '-'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500">Livrés</p>
                  <p className="text-sm font-bold text-green-600">{mission.deliveredPackages || 0}</p>
                </div>
              </div>

              {/* Barre progression */}
              {(isInProgress || isCompleted) && (
                <div className="mb-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 text-right">{progress}%</p>
                </div>
              )}

              {/* Heure de départ prévue */}
              {mission.plannedDepartureTime && mission.status === MissionStatus.DISPATCHED && (
                <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl">
                  <Clock size={14} className="text-blue-500" />
                  <span className="text-xs text-blue-700 font-medium">Départ prévu : </span>
                  <span className="text-sm font-bold text-blue-800 font-mono">{mission.plannedDepartureTime}</span>
                </div>
              )}

              {/* Bouton action */}
              {mission.status === MissionStatus.DISPATCHED && !isLoadingPhase && (
                <button
                  onClick={() => handleStartLoading(mission)}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                  📦 Commencer le chargement
                </button>
              )}

              {/* Phase chargement en cours */}
              {mission.status === MissionStatus.DISPATCHED && isLoadingPhase && activeMissionId === mission.id && (
                <div className="space-y-2">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 size={14} className="animate-spin text-amber-600" />
                      <span className="text-sm font-bold text-amber-800">Chargement en cours...</span>
                    </div>
                    <p className="text-xs text-amber-600">
                      {mission.totalPackages} colis • {mission.stops.length} stops à charger
                    </p>
                  </div>
                  {/* Scan à l'embarquement (rafale) — vérifie chaque colis chargé.
                      Alerte si le colis est sur une autre tournée (passation) ;
                      ajoute les colis non affectés (prise en charge directe). */}
                  <button
                    onClick={() => setShowClaimModal(true)}
                    disabled={isProcessing}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                  >
                    <Camera size={18} />
                    📷 Scanner les colis à l'embarquement
                  </button>
                  <button
                    onClick={() => handleLoadingComplete(mission)}
                    disabled={isProcessing}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Mise à jour en cours...
                      </>
                    ) : (
                      <>
                        <CheckCircle size={18} />
                        ✅ Chargement terminé — Départ !
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelLoading}
                    disabled={isProcessing}
                    className="w-full flex items-center justify-center gap-2 py-2 text-slate-500 text-xs font-medium"
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
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange-500 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
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
