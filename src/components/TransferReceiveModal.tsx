/**
 * TRANSFERT EN ROUTE — CÔTÉ RECEVEUR
 *
 * Le chauffeur qui RÉCUPÈRE des colis (point de rencontre avec un autre
 * chauffeur) scanne les étiquettes des cartons qu'on lui remet :
 * - chaque scan retrouve le colis, quelle que soit sa tournée d'origine
 * - à la confirmation, les colis basculent dans SA tournée et sortent
 *   de celle de l'ancien chauffeur (traçabilité complète)
 */
import React, { useState, useRef, lazy, Suspense } from 'react';
import {
  X, Camera, Loader2, CheckCircle, AlertTriangle, Trash2, ArrowRightLeft
} from 'lucide-react';
import { Package, Mission, User, TransferReason } from '../types';
import { findDispatchedPackageByCode, transferPackagesToDriver } from '../services/missionService';
import { packageDisplayCode } from '../utils/barcode';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

interface TransferReceiveModalProps {
  currentUser: User;
  toMission: Mission;
  onClose: () => void;
  onDone: (count: number) => void;
}

const TransferReceiveModal: React.FC<TransferReceiveModalProps> = ({
  currentUser, toMission, onClose, onDone
}) => {
  const [scannedPkgs, setScannedPkgs] = useState<Package[]>([]);
  const [showScanner, setShowScanner] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [reason, setReason] = useState<TransferReason>(TransferReason.PROXIMITY);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn'; message: string } | null>(null);

  // File d'attente : scan rafale traité en série, sans perte de code.
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const addedIdsRef = useRef<Set<string>>(new Set());

  const notify = (type: 'ok' | 'warn', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const lookupCode = (code: string) => {
    const cleaned = code.trim();
    if (!cleaned) return;
    queueRef.current.push(cleaned);
    void drainQueue();
  };

  const drainQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsSearching(true);
    try {
      while (queueRef.current.length > 0) {
        const cleaned = queueRef.current.shift()!;
        try {
          const pkg = await findDispatchedPackageByCode(cleaned);
          if (!pkg) {
            notify('warn', `${cleaned} — colis introuvable`);
          } else if (addedIdsRef.current.has(pkg.id)) {
            notify('warn', `${packageDisplayCode(pkg)} — déjà scanné`);
          } else if (pkg.currentDriverId === currentUser.id || pkg.missionId === toMission.id) {
            notify('warn', `${packageDisplayCode(pkg)} — déjà dans votre tournée`);
          } else if (!pkg.missionId) {
            notify('warn', `${packageDisplayCode(pkg)} — colis non dispatché (à traiter au hub)`);
          } else {
            addedIdsRef.current.add(pkg.id);
            setScannedPkgs(prev => [...prev, pkg]);
            notify('ok', `${packageDisplayCode(pkg)} — ${pkg.contactName} ✓`);
          }
        } catch {
          notify('warn', `${cleaned} — erreur lors de la recherche`);
        }
      }
    } finally {
      processingRef.current = false;
      setIsSearching(false);
    }
  };

  const handleConfirm = async () => {
    if (scannedPkgs.length === 0 || isTransferring) return;
    setIsTransferring(true);
    try {
      let location: { lat: number; lng: number } | undefined;
      try {
        location = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            reject,
            { timeout: 5000 }
          );
        });
      } catch { /* géoloc indisponible : le transfert reste valide */ }

      const count = await transferPackagesToDriver({
        packages: scannedPkgs,
        toMission,
        toDriver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        reason,
        location
      });
      onDone(count);
    } catch (e) {
      notify('warn', e instanceof Error ? e.message : 'Erreur lors du transfert');
      setIsTransferring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center sm:items-center sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-blue-50 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-blue-600" />
                Recevoir des colis
              </h3>
              <p className="text-xs text-blue-700 mt-0.5">
                Scannez les cartons remis par l'autre chauffeur — ils basculeront dans votre tournée
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-blue-100" disabled={isTransferring}>
              <X size={20} className="text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Feedback scan */}
          {feedback && (
            <div className={`flex items-center gap-2 p-3 rounded-xl text-xs font-bold ${
              feedback.type === 'ok'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              {feedback.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              {feedback.message}
            </div>
          )}

          {/* Boutons scan + saisie manuelle */}
          <button
            onClick={() => setShowScanner(true)}
            disabled={isTransferring}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
          >
            <Camera size={18} />
            Scanner un colis
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  lookupCode(manualCode);
                  setManualCode('');
                }
              }}
              placeholder="Ou saisir le N° colis (ex: BR0513)"
              className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <button
              onClick={() => { lookupCode(manualCode); setManualCode(''); }}
              disabled={!manualCode.trim() || isSearching || isTransferring}
              className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 disabled:opacity-40"
            >
              {isSearching ? <Loader2 size={16} className="animate-spin" /> : 'OK'}
            </button>
          </div>

          {/* Liste des colis scannés */}
          {scannedPkgs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700">
                {scannedPkgs.length} colis à récupérer :
              </p>
              {scannedPkgs.map(pkg => (
                <div key={pkg.id} className="flex items-center justify-between p-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-green-800">{packageDisplayCode(pkg)}</p>
                    <p className="text-[11px] text-slate-600 truncate">
                      {pkg.contactName} • {pkg.city}
                    </p>
                  </div>
                  <button
                    onClick={() => { addedIdsRef.current.delete(pkg.id); setScannedPkgs(prev => prev.filter(p => p.id !== pkg.id)); }}
                    disabled={isTransferring}
                    className="p-2 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Raison du transfert */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Raison du transfert</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as TransferReason)}
              disabled={isTransferring}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {Object.values(TransferReason).map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Confirmer */}
          <button
            onClick={handleConfirm}
            disabled={scannedPkgs.length === 0 || isTransferring}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40"
          >
            {isTransferring ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Transfert en cours...
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Récupérer {scannedPkgs.length > 0 ? `${scannedPkgs.length} colis` : 'les colis'} dans ma tournée
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scanner plein écran */}
      {showScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 z-[60] bg-black flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white" />
          </div>
        }>
          <BarcodeScanner
            onScan={(code: string) => lookupCode(code)}
            onClose={() => setShowScanner(false)}
            expectedBarcodes={[]}
            alreadyScanned={[]}
            title="Scan transfert — colis reçus"
          />
        </Suspense>
      )}
    </div>
  );
};

export default TransferReceiveModal;
