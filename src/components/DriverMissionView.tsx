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
  PackageStatus, FailureReason, Package, DeliveryLocation,
  User, MISSION_STATUS_COLORS
} from '../types';
import {
  subscribeToMissions,
  subscribeToPackages,
  updateMission,
  updateMissionFields,
  updateMissionStatus,
  updatePackageStatus
} from '../services/missionService';
import { uploadAndCreatePOD, uploadFailurePOD, UploadProgress } from '../services/podService';
import { finalizePickup } from '../services/pickupService';
import PickupScanView from './PickupScanView';
import TransferReceiveModal from './TransferReceiveModal';
import { packageMatchesCode, packageScanCodes, packageDisplayCode } from '../utils/barcode';
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));
import {
  Truck, Package as PackageIcon, MapPin, Clock, Phone,
  CheckCircle, XCircle, Navigation, Play,
  Camera, PenTool, ChevronRight,
  Loader2, ArrowLeft,
  MapPinned
} from 'lucide-react';

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
  const [showTransferModal, setShowTransferModal] = useState(false); // réception de colis en route
  const [stopPackages, setStopPackages] = useState<Package[]>([]);
  
  // Return to hub workflow
  const [returnPackages, setReturnPackages] = useState<Package[]>([]);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returningPackage, setReturningPackage] = useState<Package | null>(null);
  const [returnPhotos, setReturnPhotos] = useState<string[]>([]);
  const [returnSignature, setReturnSignature] = useState<string | null>(null);
  const [showReturnSignature, setShowReturnSignature] = useState(false);
  const returnPhotoInputRef = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().split('T')[0];

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
    if (!currentStop?.packageIds?.length) {
      setStopPackages([]);
      return;
    }
    const unsub = subscribeToPackages((pkgs) => {
      const filtered = pkgs.filter(p => currentStop.packageIds.includes(p.id));
      setStopPackages(filtered);
    });
    return unsub;
  }, [currentStop?.id]);

  // Reset scan quand on change de stop
  useEffect(() => {
    setScannedBarcodes([]);
    setShowScanner(false);
    setScanBypass(false);
  }, [currentStop?.id]);

  // Scan de contrôle à la livraison : chaque colis du stop doit être scanné
  // (étiquette client BR… ou tracking GFL…) avant de pouvoir valider.
  const deliveryScannedCount = stopPackages.filter(p =>
    scannedBarcodes.some(b => packageMatchesCode(p, b))
  ).length;
  const scanRequirementMet =
    stopPackages.length === 0 || deliveryScannedCount === stopPackages.length || scanBypass;

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
    if (!activeMission || sortedStops.length === 0) return 0;
    const done = sortedStops.filter(s => s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length;
    return Math.round((done / sortedStops.length) * 100);
  }, [activeMission, sortedStops]);

  // === Notifications éphémères ===
  const showNotif = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // === GPS ===
  const getCurrentPosition = (): Promise<{ lat: number; lng: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('GPS non supporté'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
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
    setIsProcessing(true);
    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // 1. Passer tous les colis SORTED → LOADED → IN_DELIVERY
      const packageIds = mission.stops.flatMap(s => s.packageIds);
      for (const pkgId of packageIds) {
        try {
          await updatePackageStatus(pkgId, PackageStatus.IN_DELIVERY, {
            action: 'LOADING_COMPLETE',
            driverId: currentUser.id,
            driverName: `${currentUser.firstName} ${currentUser.lastName}`,
            notes: `Chargement terminé — départ ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
          });
        } catch (e) { /* silenced */ }
      }

      // 2. Recalculer les ETAs basées sur l'heure réelle de départ
      const updatedStops = mission.stops.map((stop, idx) => {
        const baseMinutes = (stop.durationFromPrevious || 0);
        const cumulativeMinutes = mission.stops
          .slice(0, idx + 1)
          .reduce((sum, s) => sum + (s.durationFromPrevious || 0) + (s.serviceTime || 5), 0);
        
        const etaDate = new Date(now.getTime() + cumulativeMinutes * 60000);
        const estimatedArrival = etaDate.toISOString();
        const estimatedDeparture = new Date(etaDate.getTime() + (stop.serviceTime || 5) * 60000).toISOString();
        
        return {
          ...stop,
          estimatedArrival,
          estimatedDeparture
        };
      });

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
      console.error('Erreur chargement terminé:', err);
      showNotif('❌ Erreur — Réessayez');
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
        } catch (e) { /* silenced */ }
      }

      // Uploader la signature si présente
      let signatureUrl: string | undefined;
      if (returnSignature) {
        try {
          const { uploadProofPhoto } = await import('../services/podService');
          signatureUrl = await uploadProofPhoto(returnSignature, returningPackage.id, 'return-signature');
        } catch (e) { /* silenced */ }
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
      console.error('Erreur confirmation retour:', err);
      showNotif('❌ Erreur — Réessayez');
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
      console.error('Erreur arrivée:', err);
      showNotif('❌ Erreur');
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
    try {
      let coords: { lat: number; lng: number } | undefined;
      try { coords = await getCurrentPosition(); } catch {}

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
      const completedStops = updatedStops.filter(s => s.status === StopStatus.COMPLETED).length;
      const failedStops = updatedStops.filter(s => s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length;
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

      // 4. Upload POD vers Firebase Storage + persistence Firestore
      //    (signature + photos compressées, uploadées avec barre de progression)
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
        signatureBase64: signatureData || undefined,
        photosBase64: capturedPhotos,
        coordinates: coords || { lat: 0, lng: 0 },
        notes: [
          recipientName ? `${deliveryLocation} — Réceptionné par: ${recipientName}` : null,
          scanTrace || null
        ].filter(Boolean).join(' • ') || undefined
      }, setUploadProgress);

      if (podResult) {
        showNotif('📸 Preuves uploadées ✓');
      }

      // 5. Mettre à jour statut des colis avec le BON format PackageMovement
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
        } catch (e) { /* silenced */ }
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

      showNotif(allDone ? '🎉 Tournée terminée !' : `✅ Stop ${currentStop.sequence} livré !`);
    } catch (err) {
      console.error('Erreur livraison:', err);
      showNotif('❌ Erreur livraison');
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

      const completedStops = updatedStops.filter(s => s.status === StopStatus.COMPLETED).length;
      const failedStops = updatedStops.filter(s => s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length;
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
        } catch (e) { /* silenced */ }
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
      console.error('Erreur échec:', err);
      showNotif('❌ Erreur');
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

      const completedStops = updatedStops.filter(s => s.status === StopStatus.COMPLETED).length;
      const failedStops = updatedStops.filter(s => s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length;
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
      console.error('Erreur enlèvement:', err);
      showNotif('❌ Erreur enlèvement');
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
                    {/* Scan de contrôle des colis avant remise */}
                    {stopPackages.length > 0 && (
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
                            const ok = scannedBarcodes.some(b => packageMatchesCode(p, b));
                            return (
                              <span
                                key={p.id}
                                className={`px-2 py-1 rounded-lg text-[11px] font-mono font-bold border ${
                                  ok
                                    ? 'bg-green-50 border-green-300 text-green-700'
                                    : 'bg-slate-50 border-slate-200 text-slate-500'
                                }`}
                              >
                                {ok ? '✓ ' : ''}{packageDisplayCode(p)}
                              </span>
                            );
                          })}
                        </div>
                        {!scanRequirementMet && (
                          <button
                            onClick={() => {
                              if (window.confirm('Valider la livraison sans avoir scanné tous les colis ?\nCette action sera tracée dans l\'historique.')) {
                                setScanBypass(true);
                              }
                            }}
                            className="text-[11px] text-slate-400 underline"
                          >
                            Impossible de scanner un colis ?
                          </button>
                        )}
                        {scanBypass && (
                          <p className="text-[11px] text-amber-600 font-medium">
                            ⚠️ Validation sans scan complet — tracée dans l'historique du colis
                          </p>
                        )}
                      </div>
                    )}

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
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 focus:border-green-400 outline-none"
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
                            className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
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

                    {/* Photos — max 5, previews plus grandes */}
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

                    {/* Alerte si signature manquante */}
                    {!signatureData && (
                      <p className="text-[11px] text-amber-600 font-medium text-center px-2">
                        ⚠️ Signature obligatoire pour valider la livraison
                      </p>
                    )}

                    {/* Boutons Livré / Échec */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleDeliverySuccess}
                        disabled={isProcessing || !signatureData || !recipientName.trim() || !scanRequirementMet}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                        Livré ✓
                      </button>
                      <button
                        onClick={() => setShowFailureModal(true)}
                        disabled={isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-red-50 border-2 border-red-200 text-red-700 rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                      >
                        <XCircle size={18} />
                        Échec
                      </button>
                    </div>
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

        {/* Bouton retour liste */}
        <button
          onClick={() => setActiveMissionId(null)}
          className="w-full flex items-center justify-center gap-2 py-3 text-slate-500 text-sm"
        >
          <ArrowLeft size={14} /> Voir toutes mes tournées
        </button>

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
              progress={stopPackages.length > 0 ? { done: deliveryScannedCount, total: stopPackages.length } : undefined}
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
                onClear={() => {}}
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
                  <p className="text-sm font-bold text-slate-800">{mission.totalDistance ? Math.round(mission.totalDistance) + ' km' : '-'}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500">Durée est.</p>
                  <p className="text-sm font-bold text-slate-800">{mission.estimatedDuration ? Math.round(mission.estimatedDuration) + ' min' : '-'}</p>
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
