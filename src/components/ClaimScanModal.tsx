/**
 * PRISE EN CHARGE PAR SCAN (côté chauffeur)
 *
 * Le chauffeur scanne des colis (importés non affectés, ou déjà à un autre
 * chauffeur) → ils rejoignent SA tournée de livraison du jour. Modèle métier :
 * "scan = prise en charge en livraison".
 */
import React, { useState, useRef, lazy, Suspense } from 'react';
import { X, Camera, Loader2, CheckCircle, AlertTriangle, Trash2, PackageCheck } from 'lucide-react';
import { Package, User, PackageStatus } from '../types';
import { todayISO } from '../utils/date';
import { findPackageByCode, claimPackagesForDelivery } from '../services/missionService';
import { packageDisplayCode, packageScanCodes } from '../utils/barcode';
import { getCurrentPosition } from '../utils/geo';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

interface ClaimScanModalProps {
  currentUser: User;
  onClose: () => void;
  onDone: (count: number) => void;
  confirmLabel?: string; // ex. "Commencer ma tournée" (démarrage) vs "Ajouter à ma tournée"
}

const ClaimScanModal: React.FC<ClaimScanModalProps> = ({ currentUser, onClose, onDone, confirmLabel = 'Prendre en charge dans ma tournée' }) => {
  const [scannedPkgs, setScannedPkgs] = useState<Package[]>([]);
  const [showScanner, setShowScanner] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn'; message: string } | null>(null);

  // File d'attente : en scan rafale, les codes sont traités en série SANS être
  // perdus (contrairement à un simple "ignore si occupé" qui droppait des colis).
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
          const pkg = await findPackageByCode(cleaned);
          if (!pkg) {
            notify('warn', `${cleaned} — colis introuvable (importé ?)`);
          } else if (addedIdsRef.current.has(pkg.id)) {
            notify('warn', `${packageDisplayCode(pkg)} — déjà scanné`);
          } else if (pkg.status === PackageStatus.DELIVERED) {
            notify('warn', `${packageDisplayCode(pkg)} — déjà livré`);
          } else if (pkg.currentDriverId === currentUser.id && pkg.missionId) {
            notify('warn', `${packageDisplayCode(pkg)} — déjà dans votre tournée`);
          } else {
            // Anti-confusion embarquement : un colis NON affecté = prise en charge
            // directe normale (ex. récupéré sans passer par le hub). Un colis
            // affecté à un AUTRE chauffeur = alerte (c'est une passation).
            const foreign = !!pkg.currentDriverId && pkg.currentDriverId !== currentUser.id && !!pkg.missionId;
            addedIdsRef.current.add(pkg.id);
            setScannedPkgs(prev => [...prev, pkg]);
            if (foreign) {
              notify('warn', `⚠️ ${packageDisplayCode(pkg)} — ce colis est sur une autre tournée. Le prendre = passation.`);
            } else {
              notify('ok', `${packageDisplayCode(pkg)} — ${pkg.contactName} ✓`);
            }
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
    if (scannedPkgs.length === 0 || isClaiming) return;
    setIsClaiming(true);
    try {
      let location: { lat: number; lng: number } | undefined;
      try {
        location = await getCurrentPosition({ timeout: 5000 });
      } catch { /* géoloc optionnelle */ }

      const today = todayISO();
      const count = await claimPackagesForDelivery({
        packages: scannedPkgs,
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: today,
        location
      });
      onDone(count);
    } catch (e) {
      notify('warn', e instanceof Error ? e.message : 'Erreur lors de la prise en charge');
      setIsClaiming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 bg-green-50 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <PackageCheck size={18} className="text-green-600" />
                Prendre en charge des colis
              </h3>
              <p className="text-xs text-green-700 mt-0.5">
                Scannez vos colis (un colis déjà chez un collègue = transfert automatique), puis « {confirmLabel} »
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-green-100" disabled={isClaiming}>
              <X size={20} className="text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {feedback && (
            <div className={`flex items-center gap-2 p-3 rounded-xl text-xs font-bold ${
              feedback.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              {feedback.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              {feedback.message}
            </div>
          )}

          <button
            onClick={() => setShowScanner(true)}
            disabled={isClaiming}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
          >
            <Camera size={18} /> Scanner un colis
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { lookupCode(manualCode); setManualCode(''); } }}
              placeholder="Ou saisir le N° colis (ex: BR0513)"
              className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none"
            />
            <button
              onClick={() => { lookupCode(manualCode); setManualCode(''); }}
              disabled={!manualCode.trim() || isSearching || isClaiming}
              className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 disabled:opacity-40"
            >
              {isSearching ? <Loader2 size={16} className="animate-spin" /> : 'OK'}
            </button>
          </div>

          {scannedPkgs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700">{scannedPkgs.length} colis à prendre en charge :</p>
              {scannedPkgs.map(pkg => (
                <div key={pkg.id} className="flex items-center justify-between p-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-green-800">{packageDisplayCode(pkg)}</p>
                    <p className="text-[11px] text-slate-600 truncate">{pkg.contactName} • {pkg.postalCode} {pkg.city}</p>
                  </div>
                  <button onClick={() => { addedIdsRef.current.delete(pkg.id); setScannedPkgs(prev => prev.filter(p => p.id !== pkg.id)); }} disabled={isClaiming} className="p-2 text-slate-400 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={scannedPkgs.length === 0 || isClaiming}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40"
          >
            {isClaiming ? (<><Loader2 size={18} className="animate-spin" /> Chargement…</>) : (<><PackageCheck size={18} /> {confirmLabel}{scannedPkgs.length > 0 ? ` (${scannedPkgs.length})` : ''}</>)}
          </button>
        </div>
      </div>

      {showScanner && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black flex items-center justify-center"><Loader2 size={32} className="animate-spin text-white" /></div>}>
          <BarcodeScanner
            onScan={(code: string) => lookupCode(code)}
            onClose={() => setShowScanner(false)}
            expectedBarcodes={[]}
            // Codes déjà pris → re-scan affiche « ⚠️ déjà scanné » (clair).
            alreadyScanned={scannedPkgs.flatMap(p => packageScanCodes(p))}
            // PAS de isMatch={()=>true} : sinon un colis introuvable flashait VERT à tort.
            // Le vrai résultat (pris / introuvable / passation) est poussé via flashMessage.
            flashMessage={feedback ? { type: feedback.type, text: feedback.message } : null}
            // Compteur permanent visible PAR-DESSUS la caméra (le vrai feedback terrain).
            countLabel={scannedPkgs.length > 0 ? `${scannedPkgs.length} colis pris en charge` : undefined}
            title="Scan — prise en charge"
          />
        </Suspense>
      )}
    </div>
  );
};

export default ClaimScanModal;
