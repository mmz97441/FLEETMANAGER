/**
 * GARDE-FOU DE COMPLÉTUDE (scan)
 *
 * Bloque la validation d'un point (enlèvement / livraison) tant que tous les
 * colis attendus pour ce client ne sont pas scannés. Affiche clairement ce
 * qui manque et propose deux issues d'exception, TRACÉES :
 *  - « Tout est là » → livrer tous les colis (étiquette illisible mais colis présent) ;
 *  - « Déclarer absents » → livrer seulement les scannés, marquer les autres NON REMIS.
 *
 * Le 2ᵉ cas est destructif (le client est notifié d'un échec, le colis n'est pas
 * récupérable depuis le terrain) : il exige une confirmation explicite pour ne
 * PAS confondre « scanner ne lit pas l'étiquette » et « colis réellement absent ».
 */
import React, { useState } from 'react';
import { AlertTriangle, ScanLine, PackageX } from 'lucide-react';

interface ScanGateDialogProps {
  clientName: string;
  missingCodes: string[];   // N° des colis non scannés (BR…/GFL…)
  total: number;
  actionLabel: string;      // ex : "Forcer : tout est remis"
  onForce: () => void;      // livrer TOUS les colis (les non scannés compris)
  onCancel: () => void;     // continuer le scan
  /**
   * Optionnel : livrer UNIQUEMENT les colis scannés, marquer les manquants NON
   * REMIS. N'apparaît que si au moins 1 colis a été scanné et qu'il en reste.
   * Passe par une confirmation explicite « colis absents » (voir plus haut).
   */
  scannedCount?: number;
  onDeliverScannedOnly?: () => void;
}

const ScanGateDialog: React.FC<ScanGateDialogProps> = ({
  clientName, missingCodes, total, actionLabel, onForce, onCancel,
  scannedCount = 0, onDeliverScannedOnly
}) => {
  const [confirmAbsent, setConfirmAbsent] = useState(false);
  const canDeclareAbsent = !!onDeliverScannedOnly && scannedCount > 0 && scannedCount < total;

  // ÉCRAN DE CONFIRMATION « colis absents » (2ᵉ étape, destructive).
  if (confirmAbsent) {
    return (
      <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onCancel}>
        <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
          <div className="p-4 flex items-start gap-3 border-b border-slate-100">
            <div className="w-11 h-11 rounded-full bg-red-100 flex items-center justify-center shrink-0">
              <PackageX size={22} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Déclarer {missingCodes.length} colis absent{missingCodes.length > 1 ? 's' : ''} ?</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Uniquement si ces colis ne sont <b>physiquement pas là</b>. Si l'étiquette
                est juste illisible, revenez et scannez-les.
              </p>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {missingCodes.map(code => (
                <span key={code} className="px-2 py-1 rounded-lg text-[11px] font-mono font-bold bg-red-50 border border-red-200 text-red-700">
                  {code}
                </span>
              ))}
            </div>
            <p className="text-xs text-red-600 font-semibold">
              Le client sera notifié d'un échec pour ces colis. Action tracée (chauffeur, heure, GPS).
            </p>
          </div>
          <div className="p-4 border-t border-slate-100 flex flex-col gap-2">
            <button
              onClick={() => setConfirmAbsent(false)}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              <ScanLine size={18} /> Non, je continue le scan
            </button>
            <button
              onClick={() => { setConfirmAbsent(false); onDeliverScannedOnly?.(); }}
              className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              Oui, ces {missingCodes.length} colis sont absents — livrer les {scannedCount} autres
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onCancel}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="p-4 flex items-start gap-3 border-b border-slate-100">
          <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle size={22} className="text-amber-600" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Colis non scannés</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Il reste <b>{missingCodes.length}</b> colis sur <b>{total}</b> non scannés pour <b>{clientName}</b>.
            </p>
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {missingCodes.map(code => (
              <span key={code} className="px-2 py-1 rounded-lg text-[11px] font-mono font-bold bg-red-50 border border-red-200 text-red-700">
                {code}
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Scannez-les pour continuer. Le mieux : tout scanner. Les exceptions ci-dessous
            sont <b>tracées dans l'historique</b>.
          </p>
        </div>

        <div className="p-4 border-t border-slate-100 flex flex-col gap-2">
          <button
            onClick={onCancel}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
          >
            <ScanLine size={18} /> Continuer le scan
          </button>
          {canDeclareAbsent && (
            <button
              onClick={() => setConfirmAbsent(true)}
              className="w-full py-3 bg-white border border-red-300 text-red-700 rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              Déclarer {missingCodes.length} colis absent{missingCodes.length > 1 ? 's' : ''} (livrer les {scannedCount} scanné{scannedCount > 1 ? 's' : ''})
            </button>
          )}
          <button
            onClick={onForce}
            className="w-full py-3 bg-white border border-amber-300 text-amber-700 rounded-xl font-bold text-sm active:scale-95 transition-transform"
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScanGateDialog;
