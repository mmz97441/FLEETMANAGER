/**
 * BOUTON FLOTTANT DE SCAN RAPIDE
 *
 * Raccourci disponible sur tous les écrans (usage interne) : ouvre la caméra,
 * scanne un colis (étiquette client BR…/2D, tracking GFL… ou N° commande) et
 * affiche instantanément sa fiche — statut, destinataire et suivi complet.
 * Lecture seule : aucun risque de modifier une donnée.
 */
import React, { useState, lazy, Suspense } from 'react';
import { ScanLine, X, Loader2, MapPin, Package as PackageIcon, Search } from 'lucide-react';
import { Package, PackageStatus, PACKAGE_STATUS_COLORS } from '../types';
import { findPackageByCode } from '../services/missionService';
import { packageDisplayCode } from '../utils/barcode';
import PackageTimeline from './PackageTimeline';

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

const statusEmoji = (s: PackageStatus): string => {
  if (s === PackageStatus.DELIVERED) return '✅';
  if (s === PackageStatus.FAILED) return '❌';
  if (s === PackageStatus.PENDING) return '⏳';
  if (s === PackageStatus.COLLECTED) return '📦';
  if (s === PackageStatus.RETURNED || s === PackageStatus.RETURN_REQUESTED) return '↩️';
  return '🚚';
};

const QuickScanButton: React.FC = () => {
  const [showScanner, setShowScanner] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<{ pkg: Package | null; scannedCode: string } | null>(null);

  const handleScan = async (code: string) => {
    setShowScanner(false);
    setIsSearching(true);
    setResult(null);
    try {
      const pkg = await findPackageByCode(code);
      setResult({ pkg, scannedCode: code });
    } catch {
      setResult({ pkg: null, scannedCode: code });
    }
    setIsSearching(false);
  };

  const reset = () => {
    setResult(null);
    setIsSearching(false);
  };

  return (
    <>
      {/* Bouton flottant — au-dessus de la barre de nav mobile */}
      <button
        onClick={() => { reset(); setShowScanner(true); }}
        title="Scanner un colis"
        aria-label="Scanner un colis"
        className="fixed z-40 bottom-20 right-4 lg:bottom-6 lg:right-6 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-600/30 flex items-center justify-center active:scale-90 transition-transform"
      >
        <ScanLine size={24} />
      </button>

      {/* Scanner plein écran */}
      {showScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white" />
          </div>
        }>
          <BarcodeScanner
            onScan={handleScan}
            onClose={() => setShowScanner(false)}
            expectedBarcodes={[]}
            alreadyScanned={[]}
            title="Scan rapide — rechercher un colis"
          />
        </Suspense>
      )}

      {/* Recherche en cours */}
      {isSearching && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-6 py-5 flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-brand-600" />
            <span className="text-sm font-medium text-slate-700">Recherche du colis…</span>
          </div>
        </div>
      )}

      {/* Fiche résultat */}
      {result && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={reset}>
          <div
            className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            {result.pkg ? (
              <>
                {/* En-tête fiche colis */}
                <div className="p-4 border-b border-slate-200 flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-lg font-bold text-slate-800">{packageDisplayCode(result.pkg)}</p>
                    <p className="text-xs text-slate-500">Commande {result.pkg.orderNumber}</p>
                  </div>
                  <button onClick={reset} className="p-2 rounded-full hover:bg-slate-100 shrink-0">
                    <X size={20} className="text-slate-400" />
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  {/* Statut */}
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${
                      (PACKAGE_STATUS_COLORS[result.pkg.status] || { bg: 'bg-slate-100', text: 'text-slate-700' }).bg
                    } ${(PACKAGE_STATUS_COLORS[result.pkg.status] || { text: 'text-slate-700' }).text}`}>
                      {statusEmoji(result.pkg.status)} {result.pkg.status}
                    </span>
                  </div>

                  {/* Destinataire */}
                  <div className="flex items-start gap-2 text-sm">
                    <PackageIcon size={16} className="text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-800">{result.pkg.contactName}</p>
                      <p className="text-slate-500 flex items-center gap-1 text-xs">
                        <MapPin size={12} /> {result.pkg.address}, {result.pkg.postalCode} {result.pkg.city}
                      </p>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="border-t border-slate-100 pt-2">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Suivi du colis</p>
                    <PackageTimeline movements={result.pkg.movements || []} showInternalDetails />
                  </div>
                </div>
              </>
            ) : (
              /* Colis introuvable */
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <Search size={24} className="text-amber-600" />
                </div>
                <p className="font-bold text-slate-800">Colis introuvable</p>
                <p className="text-sm text-slate-500 mt-1">
                  Aucun colis ne correspond au code scanné :
                </p>
                <p className="font-mono text-sm font-bold text-slate-700 mt-1 break-all">{result.scannedCode}</p>
                <p className="text-xs text-slate-400 mt-2">
                  Vérifiez qu'il a bien été importé, ou notez ce code pour le service.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="p-4 border-t border-slate-200 flex gap-2">
              <button
                onClick={() => { reset(); setShowScanner(true); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              >
                <ScanLine size={18} /> Scanner un autre
              </button>
              <button
                onClick={reset}
                className="px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default QuickScanButton;
