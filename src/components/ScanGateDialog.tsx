/**
 * GARDE-FOU DE COMPLÉTUDE (scan)
 *
 * Bloque la validation d'un point (enlèvement / livraison) tant que tous les
 * colis attendus pour ce client ne sont pas scannés. Affiche clairement ce
 * qui manque et propose un bouton "Forcer" (action tracée) pour les cas
 * exceptionnels (étiquette abîmée, colis absent…).
 */
import React from 'react';
import { AlertTriangle, ScanLine } from 'lucide-react';

interface ScanGateDialogProps {
  clientName: string;
  missingCodes: string[];   // N° des colis non scannés (BR…/GFL…)
  total: number;
  actionLabel: string;      // ex : "Forcer la livraison"
  onForce: () => void;
  onCancel: () => void;
}

const ScanGateDialog: React.FC<ScanGateDialogProps> = ({
  clientName, missingCodes, total, actionLabel, onForce, onCancel
}) => (
  <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onCancel}>
    <div
      className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md animate-slide-up"
      onClick={e => e.stopPropagation()}
    >
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
          Scannez-les pour continuer. Si c'est impossible (étiquette abîmée, colis absent…),
          vous pouvez forcer — l'action sera <b>tracée dans l'historique</b>.
        </p>
      </div>

      <div className="p-4 border-t border-slate-100 flex flex-col gap-2">
        <button
          onClick={onCancel}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
        >
          <ScanLine size={18} /> Continuer le scan
        </button>
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

export default ScanGateDialog;
