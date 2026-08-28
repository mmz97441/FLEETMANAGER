/**
 * BARCODE SCANNER — Scan code-barres via caméra mobile
 * 
 * Utilise html5-qrcode pour lire les codes Code128.
 * Fonctionne sur smartphone (Chrome, Safari).
 * 
 * Features :
 * - Scan caméra temps réel
 * - Vibration + son au scan réussi
 * - Saisie manuelle en fallback
 * - Anti-doublon (ne scanne pas 2x le même en 3s)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, Keyboard, X, Loader2, AlertTriangle, Flashlight, FlashlightOff } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  expectedBarcodes?: string[];        // Liste des codes attendus (pour feedback couleur)
  alreadyScanned?: string[];          // Codes déjà scannés (pour anti-doublon visuel)
  title?: string;
  progress?: { done: number; total: number }; // Compteur permanent pour le scan en rafale
  hint?: string; // Message d'aide permanent (ex. quel code viser)
  // Prédicat « ce code correspond-il à un colis attendu ? ». Si fourni, il fait
  // AUTORITÉ pour le feedback couleur (à brancher sur packageMatchesCode côté
  // parent), au lieu d'une simple égalité de chaîne sur expectedBarcodes — qui
  // affichait « non prévu » sur un DataMatrix/code à rang pourtant valide.
  isMatch?: (code: string) => boolean;
  // Checklist VIVANTE affichée par-dessus la caméra : la liste des colis à scanner,
  // chacun coché (✓) en direct dès qu'il est scanné. Le chauffeur voit en permanence
  // combien il en reste ET lesquels (numéros), sans quitter la caméra.
  checklist?: { code: string; done: boolean }[];
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onClose,
  expectedBarcodes = [],
  alreadyScanned = [],
  title = 'Scanner un code-barres',
  progress,
  hint,
  isMatch,
  checklist
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<'success' | 'duplicate' | 'unknown' | 'read' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanTime = useRef(0);
  const scannerContainerId = 'barcode-scanner-container';

  // Feedback haptique + visuel
  const feedbackScan = useCallback((barcode: string) => {
    const now = Date.now();
    // Anti-spam: ignorer si même code scanné il y a moins de 3 secondes
    if (now - lastScanTime.current < 3000 && lastScanned === barcode) return;
    lastScanTime.current = now;

    // Vérifier si déjà scanné
    if (alreadyScanned.includes(barcode)) {
      setLastScanned(barcode);
      setLastScanResult('duplicate');
      // Vibration courte = doublon
      try { navigator.vibrate?.(100); } catch {}
      setTimeout(() => setLastScanResult(null), 2000);
      return;
    }

    // Feedback HONNÊTE : on n'affiche « ✅ succès » QUE si le scanner a une
    // AUTORITÉ pour juger (prédicat isMatch fourni, branché sur packageMatchesCode,
    // OU liste expectedBarcodes non vide). Sans autorité (scan de recherche pur),
    // on montre un état NEUTRE « 📷 scanné » — le vrai résultat est décidé par le
    // parent (recherche/prise en charge asynchrone). Avant, l'absence d'autorité
    // affichait un faux vert systématique.
    let result: 'success' | 'unknown' | 'read';
    if (isMatch) result = isMatch(barcode) ? 'success' : 'unknown';
    else if (expectedBarcodes.length > 0) {
      result = expectedBarcodes.some(b => b.toUpperCase() === barcode.toUpperCase()) ? 'success' : 'unknown';
    } else {
      result = 'read'; // aucune autorité → neutre
    }
    setLastScanned(barcode);
    setLastScanResult(result);

    // Vibration : succès = double pulse, inconnu = long, neutre = court.
    try {
      navigator.vibrate?.(result === 'success' ? [100, 50, 100] : result === 'unknown' ? [300] : 60);
    } catch {}

    // Remonter au parent
    onScan(barcode);

    setTimeout(() => setLastScanResult(null), 2000);
  }, [onScan, expectedBarcodes, alreadyScanned, lastScanned, isMatch]);

  // Référence toujours à jour vers feedbackScan, pour que l'effet caméra ne
  // dépende PAS de feedbackScan (sinon il redémarre la caméra à chaque scan,
  // ce qui déclenchait "Cannot clear while scan is ongoing" → écran d'erreur).
  const feedbackScanRef = useRef(feedbackScan);
  useEffect(() => { feedbackScanRef.current = feedbackScan; }, [feedbackScan]);

  // Arrêt propre : clear() UNIQUEMENT après que stop() soit terminé, sinon
  // html5-qrcode lève "Cannot clear while scan is ongoing, close it first".
  const stopAndClear = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try { await s.stop(); } catch {}
    try { s.clear(); } catch {}
  }, []);

  // Démarrer le scanner caméra
  useEffect(() => {
    if (manualMode) return;

    let mounted = true;
    // Démarrage de la caméra avec RETRY. Au 2ᵉ/3ᵉ scan d'affilée, le flux vidéo
    // de l'ouverture précédente n'est parfois pas encore libéré par l'OS →
    // start() échoue ("NotReadableError / Could not start video source"). Avant,
    // on basculait aussitôt en saisie manuelle (caméra « qui ne s'ouvre pas »).
    // Désormais on retente 2 fois à 700 ms d'intervalle, ce qui laisse le temps
    // au téléphone de rendre la caméra. Seul un refus de permission bascule
    // directement en manuel (inutile de réessayer).
    const attemptStart = async (attempt: number): Promise<void> => {
      if (!mounted) return;
      try {
        // Formats à décoder. Les étiquettes rencontrées sont variées :
        // - clients (BOIRON) : codes 2D DataMatrix + QR imprimés sur le carton
        // - étiquettes FleetGenius (GFL…) : Code128 via jsbarcode
        // On active donc 1D ET 2D. useBarCodeDetectorIfSupported utilise le
        // détecteur natif du navigateur quand il existe (Android/Chrome, fiable
        // sur 1D) ; sur iPhone/Safari il n'existe pas → repli sur ZXing, qui est
        // performant sur les codes 2D.
        const scanner = new Html5Qrcode(scannerContainerId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.AZTEC,
          ],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },  // Caméra arrière
          {
            fps: 15, // acquisition plus rapide pour le scan en rafale
            // PAS de qrbox : on décode TOUTE l'image de la caméra. Ainsi la
            // position du code n'a plus d'importance (le trait/viseur n'a plus
            // besoin d'être « en face »), ce qui fiabilise le scan pour tous.
            // (Avant : zone restreinte 72% désalignée du viseur affiché.)
            aspectRatio: undefined,
          },
          (decodedText) => {
            if (mounted) feedbackScanRef.current(decodedText);
          },
          () => {} // Ignore erreurs de scan continu
        );

        if (!mounted) {
          // Composant démonté pendant le start : on relâche la caméra proprement.
          try { await scanner.stop(); } catch {}
          try { scanner.clear(); } catch {}
          scannerRef.current = null;
          return;
        }

        setError(null);
        setIsScanning(true);
        // Détecter la disponibilité de la torche (Android surtout ; iOS ne la
        // supporte pas via le web, le bouton reste alors masqué)
        try {
          const torch = scanner.getRunningTrackCameraCapabilities().torchFeature();
          if (torch.isSupported()) setTorchAvailable(true);
        } catch {}
      } catch (err: any) {
        console.error(`Scanner error (essai ${attempt + 1}):`, err);
        // Libérer l'instance ratée avant tout nouvel essai.
        try { await scannerRef.current?.stop(); } catch {}
        try { scannerRef.current?.clear(); } catch {}
        scannerRef.current = null;

        const msg = String(err?.message || err || '');
        const permissionDenied = msg.includes('NotAllowed') || msg.includes('Permission');

        if (!permissionDenied && attempt < 2 && mounted) {
          await new Promise((r) => setTimeout(r, 700));
          return attemptStart(attempt + 1);
        }

        if (mounted) {
          setError(
            permissionDenied
              ? 'Accès caméra refusé. Autorisez la caméra ou utilisez la saisie manuelle.'
              : 'Impossible de démarrer la caméra. Réessayez ou utilisez la saisie manuelle.'
          );
          setManualMode(true);
        }
      }
    };

    // Petit délai pour laisser le DOM se monter
    const timer = setTimeout(() => { void attemptStart(0); }, 300);

    return () => {
      mounted = false;
      clearTimeout(timer);
      void stopAndClear();
    };
  }, [manualMode, stopAndClear]);

  // Allumer / éteindre la torche
  const toggleTorch = async () => {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.getRunningTrackCameraCapabilities().torchFeature().apply(!torchOn);
      setTorchOn(!torchOn);
    } catch {
      setTorchAvailable(false);
    }
  };

  // Switch vers mode manuel
  const switchToManual = async () => {
    await stopAndClear();
    setTorchOn(false);
    setTorchAvailable(false);
    setIsScanning(false);
    setManualMode(true);
    setError(null);
  };

  // Switch vers mode caméra
  const switchToCamera = () => {
    setManualMode(false);
    setError(null);
  };

  // Soumettre saisie manuelle
  const handleManualSubmit = () => {
    const code = manualInput.trim();
    if (!code) return;
    feedbackScanRef.current(code);
    setManualInput('');
  };

  // Fermer proprement
  const handleClose = async () => {
    await stopAndClear();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* La caméra html5-qrcode remplit tout le conteneur (sinon bandes noires
          et viseur désaligné). object-fit: cover → aperçu plein écran, centré. */}
      <style>{`
        #${scannerContainerId} { width: 100%; height: 100%; }
        #${scannerContainerId} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        #${scannerContainerId} img { display: none !important; }
      `}</style>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <h3 className="text-white font-bold text-sm">{title}</h3>
        <div className="flex items-center gap-1">
          {!manualMode && torchAvailable && (
            <button
              onClick={toggleTorch}
              title={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'}
              className={`p-1.5 rounded-lg ${torchOn ? 'text-amber-300 bg-white/10' : 'text-white/70 hover:text-white'}`}
            >
              {torchOn ? <Flashlight size={20} /> : <FlashlightOff size={20} />}
            </button>
          )}
          <button onClick={handleClose} className="text-white/70 hover:text-white p-1">
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Aide permanente : quel code viser */}
      {!manualMode && hint && (
        <div className="px-4 py-2 bg-amber-500/90 text-white text-xs font-semibold text-center">
          {hint}
        </div>
      )}

      {/* Compteur permanent — scan en rafale (enlèvement de plusieurs colis) */}
      {!manualMode && progress && progress.total > 0 && (
        <div className={`px-4 py-2.5 ${progress.done >= progress.total ? 'bg-green-600' : 'bg-brand-600'} text-white`}>
          <div className="flex items-center justify-between text-sm font-bold">
            <span>{progress.done >= progress.total ? '✅ Tous les colis scannés' : '📦 Scan en cours'}</span>
            <span className="tabular-nums">{progress.done} / {progress.total}</span>
          </div>
          <div className="mt-1 h-1.5 bg-black/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/90 rounded-full transition-all duration-200"
              style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Feedback flash */}
      {lastScanResult && (
        <div className={`absolute top-14 left-4 right-4 z-20 px-4 py-3 rounded-xl text-sm font-bold text-center animate-fade-in ${
          lastScanResult === 'success' ? 'bg-green-500 text-white' :
          lastScanResult === 'duplicate' ? 'bg-amber-500 text-white' :
          lastScanResult === 'read' ? 'bg-slate-700 text-white' :
          'bg-blue-500 text-white'
        }`}>
          {lastScanResult === 'success' && `✅ ${lastScanned}`}
          {lastScanResult === 'duplicate' && `⚠️ Déjà scanné : ${lastScanned}`}
          {lastScanResult === 'unknown' && `📦 ${lastScanned} (non prévu)`}
          {lastScanResult === 'read' && `📷 ${lastScanned}…`}
        </div>
      )}

      {/* Zone scanner / saisie manuelle */}
      <div className="flex-1 relative">
        {!manualMode ? (
          <>
            {/* Scanner caméra */}
            <div id={scannerContainerId} className="w-full h-full" />
            
            {!isScanning && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-white">
                  <Loader2 size={32} className="animate-spin mx-auto mb-2" />
                  <p className="text-sm">Démarrage de la caméra...</p>
                </div>
              </div>
            )}

            {/* Cadre de confort (purement visuel). On décode TOUTE l'image, donc
                le code peut être n'importe où : pas besoin d'être « en face ». */}
            {isScanning && (
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                <div className="relative w-72 h-72 max-w-[80vw] max-h-[80vw] rounded-2xl ring-2 ring-white/70">
                  <div className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 border-green-400 rounded-tl-2xl" />
                  <div className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 border-green-400 rounded-tr-2xl" />
                  <div className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 border-green-400 rounded-bl-2xl" />
                  <div className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 border-green-400 rounded-br-2xl" />
                </div>
                <p className="mt-4 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs font-semibold">
                  Visez le code — n'importe où dans l'image
                </p>
              </div>
            )}

            {/* Checklist vivante : liste des colis à scanner, cochés en direct.
                Bandeau bas semi-transparent → ne masque pas la cible (centrée). */}
            {checklist && checklist.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 z-20 bg-black/80 backdrop-blur-sm px-3 pt-2.5 pb-3 max-h-[38vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white text-sm font-black">Colis à scanner</span>
                  <span className="text-white text-sm font-black tabular-nums">
                    {checklist.filter(c => c.done).length} / {checklist.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {checklist.map((it, i) => (
                    <span
                      key={`${it.code}-${i}`}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-bold ${
                        it.done
                          ? 'bg-green-500 text-white'
                          : 'bg-white/15 text-white border border-white/30'
                      }`}
                    >
                      {it.done ? '✓ ' : '○ '}{it.code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Mode saisie manuelle */
          <div className="flex items-center justify-center h-full bg-slate-900 px-6">
            <div className="w-full max-w-sm space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-amber-900/50 border border-amber-700 rounded-xl p-3">
                  <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-300">{error}</p>
                </div>
              )}
              <div>
                <label className="text-white/70 text-xs font-medium block mb-1">
                  Saisir le numéro manuellement
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                    placeholder="N° commande / code-barres"
                    autoFocus
                    className="flex-1 px-4 py-3 bg-white rounded-xl text-sm font-mono font-bold text-slate-800 focus:ring-2 focus:ring-green-400 outline-none"
                  />
                  <button
                    onClick={handleManualSubmit}
                    disabled={!manualInput.trim()}
                    className="px-5 py-3 bg-green-600 text-white rounded-xl font-bold text-sm disabled:opacity-40"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer — Switch mode */}
      <div className="px-4 py-3 bg-black/80 flex gap-2">
        {!manualMode ? (
          <button
            onClick={switchToManual}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 text-white rounded-xl text-sm font-medium"
          >
            <Keyboard size={16} />
            Saisie manuelle
          </button>
        ) : (
          <button
            onClick={switchToCamera}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 text-white rounded-xl text-sm font-medium"
          >
            <Camera size={16} />
            Retour caméra
          </button>
        )}
      </div>
    </div>
  );
};

export default BarcodeScanner;
