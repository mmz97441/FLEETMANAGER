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
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, Keyboard, X, Loader2, AlertTriangle } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose: () => void;
  expectedBarcodes?: string[];        // Liste des codes attendus (pour feedback couleur)
  alreadyScanned?: string[];          // Codes déjà scannés (pour anti-doublon visuel)
  title?: string;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  onClose,
  expectedBarcodes = [],
  alreadyScanned = [],
  title = 'Scanner un code-barres'
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<'success' | 'duplicate' | 'unknown' | null>(null);
  const [error, setError] = useState<string | null>(null);
  
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

    // Vérifier si attendu
    const isExpected = expectedBarcodes.length === 0 || expectedBarcodes.includes(barcode);
    setLastScanned(barcode);
    setLastScanResult(isExpected ? 'success' : 'unknown');

    // Vibration longue = succès
    try { navigator.vibrate?.([100, 50, 100]); } catch {}

    // Remonter au parent
    onScan(barcode);

    setTimeout(() => setLastScanResult(null), 2000);
  }, [onScan, expectedBarcodes, alreadyScanned, lastScanned]);

  // Démarrer le scanner caméra
  useEffect(() => {
    if (manualMode) return;

    let mounted = true;
    const startScanner = async () => {
      try {
        const scanner = new Html5Qrcode(scannerContainerId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },  // Caméra arrière
          {
            fps: 10,
            qrbox: { width: 280, height: 120 },
            aspectRatio: 1.5,
          },
          (decodedText) => {
            if (mounted) feedbackScan(decodedText);
          },
          () => {} // Ignore erreurs de scan continu
        );

        if (mounted) setIsScanning(true);
      } catch (err: any) {
        console.error('Scanner error:', err);
        if (mounted) {
          setError(
            err?.message?.includes('NotAllowed') || err?.message?.includes('Permission')
              ? 'Accès caméra refusé. Autorisez la caméra ou utilisez la saisie manuelle.'
              : 'Impossible de démarrer la caméra. Utilisez la saisie manuelle.'
          );
          setManualMode(true);
        }
      }
    };

    // Petit délai pour laisser le DOM se monter
    const timer = setTimeout(startScanner, 300);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear();
        scannerRef.current = null;
      }
    };
  }, [manualMode, feedbackScan]);

  // Switch vers mode manuel
  const switchToManual = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current.clear();
      scannerRef.current = null;
    }
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
    feedbackScan(code);
    setManualInput('');
  };

  // Fermer proprement
  const handleClose = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <h3 className="text-white font-bold text-sm">{title}</h3>
        <button onClick={handleClose} className="text-white/70 hover:text-white p-1">
          <X size={22} />
        </button>
      </div>

      {/* Feedback flash */}
      {lastScanResult && (
        <div className={`absolute top-14 left-4 right-4 z-20 px-4 py-3 rounded-xl text-sm font-bold text-center animate-fade-in ${
          lastScanResult === 'success' ? 'bg-green-500 text-white' :
          lastScanResult === 'duplicate' ? 'bg-amber-500 text-white' :
          'bg-blue-500 text-white'
        }`}>
          {lastScanResult === 'success' && `✅ ${lastScanned}`}
          {lastScanResult === 'duplicate' && `⚠️ Déjà scanné : ${lastScanned}`}
          {lastScanResult === 'unknown' && `📦 ${lastScanned} (non prévu)`}
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

            {/* Overlay viseur */}
            {isScanning && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="absolute inset-0 bg-black/30" />
                <div className="relative w-72 h-28 border-2 border-white/80 rounded-lg">
                  <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-green-400 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-green-400 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-green-400 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-green-400 rounded-br-lg" />
                  {/* Ligne de scan animée */}
                  <div className="absolute top-0 left-2 right-2 h-0.5 bg-green-400 animate-pulse" style={{ top: '50%' }} />
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
