import { CheckCircle, Loader2 } from 'lucide-react';
import type { Package } from '../types';
import { packageDisplayCode } from '../utils/barcode';

export default function DeliveryParcelList({ packages, expectedCount, scannedIds, loading, error, onRetry }: {
  packages: Package[]; expectedCount: number; scannedIds: Set<string>; loading: boolean; error: string; onRetry: () => void;
}) {
  return <section aria-label="Colis à prendre pour cet arrêt" className="rounded-xl border border-brand-200 bg-brand-50 p-3 space-y-3">
    <h4 className="text-base font-bold text-slate-900">{expectedCount} colis à prendre pour cet arrêt</h4>
    <p className="text-sm text-slate-700">Repérez ces BR sur les cartons, puis scannez-les à la suite.</p>
    {loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Chargement des références…</p>}
    <ul className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
      {packages.map(parcel => <li key={parcel.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${scannedIds.has(parcel.id) ? 'border-green-500 bg-green-50 text-green-900' : 'border-slate-300 bg-white text-slate-900'}`}>
        {scannedIds.has(parcel.id) && <CheckCircle size={20} className="shrink-0" aria-hidden="true" />}
        <span className="font-mono text-lg font-bold break-all">{packageDisplayCode(parcel) || 'Référence manquante'}</span>
        {scannedIds.has(parcel.id) && <span className="sr-only"> — vérifié</span>}
      </li>)}
    </ul>
    {error && <div role="alert" className="space-y-2 text-sm text-red-800"><p>{error}</p><button type="button" className="ui-button ui-button-secondary" onClick={onRetry}>Recharger les BR</button></div>}
    {expectedCount > 1 && <p className="text-sm font-medium text-slate-700">Une photo, un réceptionnaire et une signature pour la remise de ces {expectedCount} colis.</p>}
  </section>;
}
