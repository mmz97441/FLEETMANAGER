/**
 * PICKUP SCAN VIEW — Workflow d'enlèvement avec scan code-barres
 * 
 * Utilisé par le chauffeur quand il arrive chez un client pour enlever des colis.
 * 
 * Workflow :
 * 1. Arrivée → Voir le manifeste (liste des colis prévus)
 * 2. Ouvrir le scanner → Scanner chaque code-barres
 * 3. À chaque scan : colis passe vert, compteur +1
 * 4. Fin : résumé X/Y scannés, Z manquants
 * 5. Signature client pour valider l'enlèvement
 * 6. Tous les colis scannés passent en statut COLLECTED
 * 
 * Intégré dans DriverMissionView quand le stop est de type PICKUP.
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  Package as PackageIcon, CheckCircle, XCircle, Camera,
  Loader2, PenTool, Search, AlertTriangle, ChevronDown, ChevronUp
} from 'lucide-react';
import { packageMatchesCode, packageDisplayCode, matchScansToPackages, packageScanCodes } from '../utils/barcode';
import { formatWeight } from '../utils/format';
import ScanGateDialog from './ScanGateDialog';

interface PickupPackage {
  id: string;
  orderNumber: string;
  barcode?: string;
  externalId?: string;             // N° colis client (étiquette d'origine, ex: BR0513)
  contactName: string;
  address: string;
  city: string;
  comment?: string;
  weight?: number;
}

interface PickupScanViewProps {
  expectedPackages: PickupPackage[];
  clientName: string;
  stopAddress: string;
  onComplete: (scannedIds: string[], missingIds: string[], signatureBase64?: string) => void;
  onOpenScanner: () => void;
  scannedBarcodes: string[];   // Gérés par le parent (DriverMissionView)
  isProcessing: boolean;
}

const PickupScanView: React.FC<PickupScanViewProps> = ({
  expectedPackages,
  clientName,
  stopAddress,
  onComplete,
  onOpenScanner,
  scannedBarcodes,
  isProcessing
}) => {
  const [showManifest, setShowManifest] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);
  const [showGate, setShowGate] = useState(false);

  // Mapper les scans aux colis en 1:1 (matchScansToPackages) : un scan couvre AU
  // PLUS un colis → pas de sur-comptage quand plusieurs colis partagent un code.
  const { scanned, missing, unknown, scannedIds } = useMemo(() => {
    const matchedIds = matchScansToPackages(expectedPackages, scannedBarcodes);
    const scannedPkgs = expectedPackages.filter(p => matchedIds.has(p.id));
    const missingPkgs = expectedPackages.filter(p => !matchedIds.has(p.id));
    // Codes scannés qui ne correspondent à aucun colis prévu
    const unknownCodes = scannedBarcodes.filter(b => !expectedPackages.some(p => packageMatchesCode(p, b)));
    return { scanned: scannedPkgs, missing: missingPkgs, unknown: unknownCodes, scannedIds: matchedIds };
  }, [expectedPackages, scannedBarcodes]);

  const total = expectedPackages.length;
  const scannedCount = scanned.length;
  const progress = total > 0 ? Math.round((scannedCount / total) * 100) : 0;
  const allScanned = scannedCount === total;

  // Filtrer pour la recherche
  const filteredPackages = useMemo(() => {
    if (!searchTerm) return expectedPackages;
    const term = searchTerm.toLowerCase();
    return expectedPackages.filter(p =>
      p.orderNumber.toLowerCase().includes(term) ||
      (p.barcode || '').toLowerCase().includes(term) ||
      (p.externalId || '').toLowerCase().includes(term) ||
      p.contactName.toLowerCase().includes(term)
    );
  }, [expectedPackages, searchTerm]);

  const isScanned = (pkg: PickupPackage) => scannedIds.has(pkg.id);

  const doFinalize = () => {
    const scannedIds = scanned.map(p => p.id);
    const missingIds = missing.map(p => p.id);
    onComplete(scannedIds, missingIds, signatureData || undefined);
  };

  const handleFinalize = () => {
    // Garde-fou : bloquer si des colis attendus n'ont pas été scannés
    if (!allScanned && scannedCount >= 0 && total > 0) {
      setShowGate(true);
      return;
    }
    doFinalize();
  };

  return (
    <div className="space-y-3">

      {/* En-tête enlèvement */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-1">
          <PackageIcon size={16} className="text-blue-600" />
          <span className="text-xs font-bold text-blue-700 uppercase">Enlèvement</span>
        </div>
        <p className="font-bold text-slate-800 text-sm">{clientName}</p>
        <p className="text-xs text-slate-500">{stopAddress}</p>
      </div>

      {/* Compteur principal */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-slate-700">Progression scan</span>
          <span className={`text-2xl font-black ${allScanned ? 'text-green-600' : 'text-slate-800'}`}>
            {scannedCount}/{total}
          </span>
        </div>
        
        {/* Barre de progression */}
        <div className="w-full bg-slate-100 rounded-full h-3 mb-2">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              allScanned ? 'bg-green-500' : progress > 50 ? 'bg-blue-500' : 'bg-amber-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-slate-500">
          <span>✅ {scannedCount} scannés</span>
          {missing.length > 0 && <span className="text-red-500">❌ {missing.length} restants</span>}
          {unknown.length > 0 && <span className="text-amber-500">⚠️ {unknown.length} imprévus</span>}
        </div>
      </div>

      {/* Bouton Scanner */}
      <button
        onClick={onOpenScanner}
        className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-base active:scale-95 transition-transform ${
          allScanned
            ? 'bg-green-100 border-2 border-green-300 text-green-700'
            : 'bg-blue-600 text-white shadow-lg shadow-blue-200'
        }`}
      >
        <Camera size={22} />
        {allScanned ? '✅ Tout scanné — Rescanner ?' : `📷 Scanner (${missing.length} restants)`}
      </button>

      {/* Manifeste détaillé */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowManifest(!showManifest)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          <span>📋 Manifeste ({total} colis)</span>
          {showManifest ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showManifest && (
          <>
            {/* Recherche */}
            {total > 5 && (
              <div className="px-3 pb-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Rechercher..."
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
              </div>
            )}

            {/* Liste */}
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
              {filteredPackages.map(pkg => {
                const scanned = isScanned(pkg);
                const noCode = packageScanCodes(pkg).length === 0;
                return (
                  <div
                    key={pkg.id}
                    className={`px-4 py-2.5 flex items-center gap-3 transition-colors ${
                      scanned ? 'bg-green-50' : 'bg-white'
                    }`}
                  >
                    {/* Icône statut */}
                    {scanned ? (
                      <CheckCircle size={18} className="text-green-600 flex-shrink-0" />
                    ) : (
                      <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-300 flex-shrink-0" />
                    )}

                    {/* Infos colis */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-xs font-bold ${scanned ? 'text-green-700' : 'text-slate-800'}`}>
                          {packageDisplayCode(pkg)}
                        </span>
                        {scanned && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[9px] font-bold">
                            SCANNÉ
                          </span>
                        )}
                        {!scanned && noCode && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px] font-bold" title="Ce colis n’a pas de code scannable — à valider en « Forcer »">
                            SANS CODE
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        → {pkg.contactName} • {pkg.city}
                      </p>
                    </div>

                    {/* Poids */}
                    {pkg.weight && (
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{formatWeight(pkg.weight)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Codes imprévus */}
      {unknown.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-600" />
            <span className="text-xs font-bold text-amber-700">Codes non prévus ({unknown.length})</span>
          </div>
          <div className="space-y-1">
            {unknown.map((code, i) => (
              <p key={i} className="text-xs font-mono text-amber-600">{code}</p>
            ))}
          </div>
        </div>
      )}

      {/* Manquants explicites */}
      {allScanned && missing.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-green-700 font-bold text-sm">🎉 Tous les colis ont été scannés !</p>
          <p className="text-xs text-green-600 mt-1">Faites signer le client pour valider l'enlèvement.</p>
        </div>
      )}

      {/* Section signature client */}
      <div className="border-t border-slate-200 pt-3 space-y-2">
        {!showSignature && !signatureData && (
          <button
            onClick={() => setShowSignature(true)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-amber-50 border-2 border-dashed border-amber-300 text-amber-700 rounded-xl font-bold text-sm"
          >
            <PenTool size={16} />
            ✍️ Signature du client (enlèvement)
          </button>
        )}

        {showSignature && (
          <SignaturePadMini
            onSave={(data) => { setSignatureData(data); setShowSignature(false); }}
            onCancel={() => setShowSignature(false)}
          />
        )}

        {signatureData && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle size={16} className="text-green-600" />
            <span className="text-xs text-green-700 font-bold flex-1">Signature client enregistrée ✓</span>
            <button
              onClick={() => { setSignatureData(null); setShowSignature(true); }}
              className="text-xs text-green-600 underline font-medium"
            >
              Refaire
            </button>
          </div>
        )}
      </div>

      {/* Bouton finaliser */}
      <button
        onClick={handleFinalize}
        disabled={isProcessing || total === 0}
        className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm active:scale-95 transition-transform ${
          allScanned && signatureData
            ? 'bg-green-600 text-white shadow-lg shadow-green-200'
            : 'bg-slate-800 text-white'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {isProcessing ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <CheckCircle size={18} />
        )}
        {isProcessing
          ? 'Enregistrement...'
          : allScanned
            ? 'Valider l\'enlèvement ✓'
            : `Valider (${scannedCount}/${total} scannés${missing.length > 0 ? `, ${missing.length} manquants` : ''})`
        }
      </button>

      {/* Avertissement si manquants */}
      {!allScanned && scannedCount > 0 && (
        <p className="text-[11px] text-amber-600 text-center">
          ⚠️ {missing.length} colis manquants — Ils resteront en "En attente"
        </p>
      )}

      {/* Garde-fou : colis manquants avant de valider l'enlèvement */}
      {showGate && (
        <ScanGateDialog
          clientName={clientName || 'ce client'}
          missingCodes={missing.map(packageDisplayCode)}
          total={total}
          actionLabel="Forcer l'enlèvement (colis manquants)"
          onCancel={() => setShowGate(false)}
          onForce={() => { setShowGate(false); doFinalize(); }}
        />
      )}
    </div>
  );
};

// ============================================================================
// MINI SIGNATURE PAD (version simplifiée pour l'enlèvement)
// ============================================================================

const SignaturePadMini: React.FC<{ onSave: (data: string) => void; onCancel: () => void }> = ({ onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  const getCoords = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const scaleCoords = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x, y };
    return {
      x: x * (canvas.width / canvas.clientWidth),
      y: y * (canvas.height / canvas.clientHeight)
    };
  };

  const startDrawing = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    const scaled = scaleCoords(x, y);
    ctx.beginPath();
    ctx.moveTo(scaled.x, scaled.y);
    setIsDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    const scaled = scaleCoords(x, y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e293b';
    ctx.lineTo(scaled.x, scaled.y);
    ctx.stroke();
    setHasContent(true);
  };

  const stopDrawing = () => setIsDrawing(false);

  const clear = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHasContent(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="p-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700">✍️ Signature client (enlèvement)</span>
        <button onClick={clear} className="text-[10px] text-slate-500 hover:text-red-500">Effacer</button>
      </div>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="w-full h-[100px] touch-none bg-white cursor-crosshair"
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
      <div className="p-2 bg-slate-50 border-t border-slate-200 flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg">
          Annuler
        </button>
        <button
          onClick={() => hasContent && canvasRef.current && onSave(canvasRef.current.toDataURL('image/png'))}
          disabled={!hasContent}
          className="flex-1 py-2 text-xs font-bold text-white bg-green-600 rounded-lg disabled:opacity-40"
        >
          Valider
        </button>
      </div>
    </div>
  );
};

export default PickupScanView;
