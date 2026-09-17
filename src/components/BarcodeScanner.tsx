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
import Modal from './shared/Modal';
import { recordDiagnosticAction } from '../utils/runtimeDiagnostics';
import { reportError } from '../services/logService';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Camera,
  Keyboard,
  X,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Flashlight,
  FlashlightOff,
} from 'lucide-react';

export interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  forwardDuplicates?: boolean;
  busy?: boolean;
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
  // Compteur texte permanent (ex. enlèvement : « 3 colis pris en charge ») affiché en
  // clair PAR-DESSUS la caméra, quand il n'y a pas de liste fixe attendue.
  countLabel?: string;
  // Message d'issue AUTORITAIRE piloté par le parent (résultat réel après recherche
  // async : « pris », « introuvable », « passation »…), affiché PAR-DESSUS la caméra.
  // Sans lui, le flash interne (synchrone) ne connaît pas encore le vrai résultat.
  flashMessage?: { type: 'ok' | 'warn'; text: string; } | null;
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
  checklist,
  countLabel,
  flashMessage,
  forwardDuplicates = false,
  busy = false
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<'success' | 'duplicate' | 'unknown' | 'read' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanHistory, setScanHistory] = useState<{ text: string; warning: boolean; time: string }[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [persistentWarning, setPersistentWarning] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanTime = useRef(0);
  const scannerContainerId = 'barcode-scanner-container';

  const recordScan = useCallback((text: string, warning: boolean) => {
    setScanHistory(previous => [{ text, warning, time: new Date().toLocaleTimeString('fr-FR') }, ...previous].slice(0, 6));
    if (warning) setPersistentWarning(text);
  }, []);
  useEffect(() => {
    if (flashMessage) recordScan(flashMessage.text, flashMessage.type === 'warn');
  }, [flashMessage?.type, flashMessage?.text, recordScan]);

  // Feedback haptique + visuel
  const feedbackScan = useCallback((barcode: string) => {
    const now = Date.now();
    // Anti-spam: ignorer si même code scanné il y a moins de 3 secondes
    if (now - lastScanTime.current < 3000 && lastScanned === barcode) return;
    lastScanTime.current = now;
    recordDiagnosticAction('scanner.code.read');

    // Vérifier si déjà scanné
    if (alreadyScanned.includes(barcode)) {
      setLastScanned(barcode);
      setLastScanResult('duplicate');
      recordScan(`${barcode} · déjà scanné`, true);
      // Vibration courte = doublon
      try { navigator.vibrate?.(100); } catch {}
      setTimeout(() => setLastScanResult(null), 2000);
      if (forwardDuplicates) onScan(barcode);
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
    recordScan(`${barcode} · ${result === 'success' ? 'code attendu reconnu' : result === 'unknown' ? 'code non prévu pour cet arrêt' : 'code lu, vérification en cours'}`, result === 'unknown');

    // Vibration : succès = double pulse, inconnu = long, neutre = court.
    try {
      navigator.vibrate?.(result === 'success' ? [100, 50, 100] : result === 'unknown' ? [300] : 60);
    } catch {}

    // Remonter au parent
    onScan(barcode);

    setTimeout(() => setLastScanResult(null), 2000);
  }, [onScan, expectedBarcodes, alreadyScanned, lastScanned, isMatch, recordScan, forwardDuplicates]);

  // Référence toujours à jour vers feedbackScan, pour que l'effet caméra ne
  // dépende PAS de feedbackScan (sinon il redémarre la caméra à chaque scan,
  // ce qui déclenchait "Cannot clear while scan is ongoing" → écran d'erreur).
  const feedbackScanRef = useRef(feedbackScan);
  useEffect(() => { feedbackScanRef.current = feedbackScan; }, [feedbackScan]);

  // AUTO-FERMETURE : dès que TOUS les colis de la checklist sont scannés (livraison),
  // le scanner se referme tout seul après un court instant (le temps de voir la
  // dernière coche verte). Le chauffeur n'a plus à fermer manuellement.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const autoClosedRef = useRef(false);
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(autoCloseTimer.current), []);
  useEffect(() => {
    if (busy || !checklist || checklist.length === 0 || autoClosedRef.current) return;
    if (checklist.every(c => c.done)) {
      autoClosedRef.current = true;
      autoCloseTimer.current = setTimeout(() => { if (!busyRef.current) onCloseRef.current(); else autoClosedRef.current = false; }, 1200);
    }
  }, [checklist, busy]);

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
          reportError('scanner.camera.start', err, { silent: true, extra: { attempts: attempt + 1, permissionDenied } });
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
    recordDiagnosticAction('scanner.manual');
    await stopAndClear();
    setTorchOn(false);
    setTorchAvailable(false);
    setIsScanning(false);
    setManualMode(true);
    setError(null);
  };

  // Switch vers mode caméra
  const switchToCamera = () => {
    recordDiagnosticAction('scanner.camera');
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
    if (busyRef.current) return;
    await stopAndClear();
    onClose();
  };

  // PORTAIL vers document.body : sinon un conteneur parent transformé (animate-fade-in,
  // etc.) « emprisonne » le position:fixed → le scanner ne couvrait pas tout l'écran et
  // son bas (checklist/infos) passait sous la barre de navigation. En portail, il est
  // VRAIMENT plein écran, quel que soit l'écran d'où on l'ouvre.
  return (
    <Modal isOpen busy={busy} onClose={() => { void handleClose(); }} ariaLabel={title} size="full" showCloseButton={false} closeOnOverlay={false} bodyClassName="!p-0 bg-black">
      <div className="bg-black flex flex-col h-[calc(100dvh-3rem)] min-h-[22rem]">
        {/* Footer — Switch mode */}
        <style>{`
        #${scannerContainerId} { width: 100%; height: 100%; }
        #${scannerContainerId} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
        #${scannerContainerId} img { display: none !important; }
      `}</style>
        {/* Footer — Switch mode */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/80 gap-2">
          <h3 className="text-white font-bold text-base min-w-0">{title}</h3>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!manualMode && torchAvailable && (
              <button
              onClick={toggleTorch}
              title={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'}
              aria-label={torchOn ? 'Éteindre la lampe' : 'Allumer la lampe'} aria-pressed={torchOn}
              className={`min-w-11 min-h-11 p-2 rounded-lg ${torchOn ? 'text-amber-300 bg-white/10' : 'text-white/70 hover:text-white'}`}
            >
                {torchOn ? (
                  <Flashlight size={20} />
                ) : (
                  <FlashlightOff size={20} />
                )}
              </button>
            )}
            <button disabled={busy} onClick={handleClose} aria-label="Fermer le scanner" className="min-w-11 min-h-11 text-white/70 hover:text-white p-1">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Footer — Switch mode */}
        {!manualMode && hint && !checklist && (
          <div className="px-4 py-2 bg-amber-100 text-amber-950 text-sm font-semibold text-center">
            {hint}
          </div>
        )}

        {/* Footer — Switch mode */}
        {!manualMode && countLabel && (
          <div className="px-4 py-2.5 bg-green-700 text-white text-base font-black text-center">
            <CheckCircle size={18} className="inline mr-1" aria-hidden="true" />
            {countLabel}
          </div>
        )}

        {/* Footer — Switch mode */}
        {!manualMode && flashMessage && (
          <div
            className={`px-4 py-3 text-white text-center text-sm font-black ${flashMessage.type === 'ok' ? 'bg-green-700' : "bg-amber-800"}`}
          >
            {flashMessage.type === 'ok' ? (
              <CheckCircle
                size={18}
                className="inline mr-1"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                size={18}
                className="inline mr-1"
                aria-hidden="true"
              />
            )}{" "}
            {flashMessage.text}
          </div>
        )}

        {/* Footer — Switch mode */}
        {!manualMode && progress && progress.total > 0 && !checklist && (
          <div
            className={`px-4 py-2.5 ${progress.done >= progress.total ? 'bg-green-700' : 'bg-brand-600'} text-white`}
          >
            <div className="flex items-center justify-between text-sm font-bold">
              <span>
                {progress.done >= progress.total ? (
                  <>
                    <CheckCircle size={18} className="inline mr-1" />
                    Tous les colis scannés
                  </>
                ) : (
                  <>Scan en cours</>
                )}
              </span>
              <span className="tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-black/20 rounded-full overflow-hidden">
              <div
              className="h-full bg-white/90 rounded-full transition-all duration-200"
              style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
            />
            </div>
          </div>
        )}

        {/* Footer — Switch mode */}
        {lastScanResult && (
          <div
            className={`absolute top-14 left-4 right-4 z-20 px-4 py-3 rounded-xl text-sm font-bold text-center break-words animate-fade-in ${
              lastScanResult === 'success'
                ? "bg-green-700 text-white"
                : lastScanResult === 'duplicate'
                  ? 'bg-amber-700 text-white'
                  : lastScanResult === 'read'
                    ? 'bg-slate-700 text-white'
                    : "bg-brand-700 text-white"
            }`}
          >
            {lastScanResult === 'success' && (
              <>
                <CheckCircle size={18} className="inline mr-1" />
                {lastScanned}
              </>
            )}
            {lastScanResult === 'duplicate' && (
              <>
                <AlertTriangle size={18} className="inline mr-1" />
                Déjà scanné : {lastScanned}
              </>
            )}
            {lastScanResult === 'unknown' && <>{lastScanned} (non prévu)</>}
            {lastScanResult === 'read' && (
              <>
                <Camera size={18} className="inline mr-1" />
                {lastScanned}…
              </>
            )}
          </div>
        )}

        {/* Footer — Switch mode */}
        <div className="flex-1 relative min-h-40">
          {!manualMode ? (
            <>
              {/* Footer — Switch mode */}
              <div id={scannerContainerId} className="w-full h-full" />

              {!isScanning && !error && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-white">
                    <Loader2 size={32} className="animate-spin mx-auto mb-2" />
                    <p className="text-sm">Démarrage de la caméra...</p>
                  </div>
                </div>
              )}

              {/* Footer — Switch mode */}
              {isScanning && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                  <div className="relative w-72 h-72 max-w-[80vw] max-h-[80vw] rounded-2xl ring-2 ring-white/70">
                    <div className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 border-green-400 rounded-tl-2xl" />
                    <div className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 border-green-400 rounded-tr-2xl" />
                    <div className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 border-green-400 rounded-bl-2xl" />
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 border-green-400 rounded-br-2xl" />
                  </div>
                  <p className="mt-4 px-3 py-1.5 rounded-full bg-black/60 text-white text-sm font-semibold">
                    Visez le code — n'importe où dans l'image
                  </p>
                </div>
              )}

              {/* Footer — Switch mode */}
              {checklist && checklist.length > 0 && (
                <div className="absolute bottom-0 left-0 right-0 z-20 bg-black/75 backdrop-blur-sm px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-white text-lg font-black tabular-nums shrink-0">
                      {checklist.filter(c => c.done).length}/
                      {checklist.length}
                    </span>
                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                      {checklist.map((it, i) => (
                        <span
                          key={`${it.code}-${i}`}
                          className={`px-2 py-1 rounded-md text-sm font-mono font-bold whitespace-nowrap ${
                            it.done
                              ? "bg-green-700 text-white"
                              : 'bg-white/15 text-white border border-white/30'
                          }`}
                        >
                          {it.done ? (
                            <CheckCircle
                              size={14}
                              className="inline mr-1"
                              aria-label="Scanné"
                            />
                          ) : (
                            <span className="sr-only">À scanner : </span>
                          )}{" "}
                          {it.code}
                        </span>
                      ))}
                    </div>
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
                    <p className="text-sm text-amber-300">{error}</p>
                  </div>
                )}
                <div>
                  <label htmlFor="manual-barcode" className="text-white/90 text-sm font-medium block mb-1">
                    Saisir le numéro manuellement
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="manual-barcode"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                      placeholder="N° commande / code-barres"
                      autoFocus
                      className="min-w-0 flex-1 px-4 py-3 bg-white rounded-xl text-base font-mono font-bold text-slate-800 focus:ring-2 focus:ring-brand-400 outline-none"
                    />
                    <button
                      onClick={handleManualSubmit}
                      disabled={!manualInput.trim()}
                      className="ui-button ui-button-primary"
                    >
                      OK
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {persistentWarning && (
          <div role="alert" className="flex items-start gap-2 px-3 py-2 bg-amber-100 text-amber-950 text-sm">
            <p className="flex-1 break-words">{persistentWarning}</p>
            <button type="button" aria-label="Masquer cet avertissement de scan" onClick={() => setPersistentWarning('')} className="shrink-0 min-w-11 min-h-11 rounded-lg border border-amber-400">
              <X size={18} className="mx-auto" />
            </button>
          </div>
        )}
        {scanHistory.length > 0 && (
          <details open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)} className="bg-slate-900 text-white text-sm px-3">
            <summary className="min-h-11 py-3 cursor-pointer font-semibold">
              Derniers scans ({scanHistory.length})
            </summary>
            <ol className="max-h-28 overflow-y-auto pb-2 space-y-2">
              {scanHistory.map((entry, index) => (
                <li key={`${entry.time}-${index}`} className={entry.warning ? 'text-amber-200' : 'text-white'}>
                  <time>{entry.time}</time> · {entry.text}
                </li>
              ))}
            </ol>
          </details>
        )}
        {checklist?.length && checklist.every(item => item.done) ? (
          <p role="status" className="bg-green-800 text-white px-3 py-2 text-sm">
            Tous les colis sont scannés. Retour à la livraison…
          </p>
        ) : null}
        {/* Footer — Switch mode */}
        <div className="px-4 py-3 bg-black/80 flex gap-2">
          {!manualMode ? (
            <button
            onClick={switchToManual}
            className="min-h-11 flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 text-white rounded-xl text-sm font-medium"
          >
              <Keyboard size={16} />
              Saisie manuelle
            </button>
          ) : (
            <button
            onClick={switchToCamera}
            className="min-h-11 flex-1 flex items-center justify-center gap-2 py-3 bg-white/10 text-white rounded-xl text-sm font-medium"
          >
              <Camera size={16} />
              Retour caméra
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default BarcodeScanner;
