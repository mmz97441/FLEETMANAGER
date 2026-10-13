import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { Package } from '../types';

interface ImportRun { id: string; clientName: string; fileName?: string; status: string; expectedCount: number; confirmedCount: number; rejectedRows: number; pendingReferences: string[] }
export default function ImportReadiness({ packages, onAssociate }: { packages: Package[]; onAssociate: (code: string) => void }) {
  const [runs, setRuns] = useState<ImportRun[]>([]), [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false), [visible, setVisible] = useState(20);
  useEffect(() => onSnapshot(query(collection(db, 'import_runs'), orderBy('updatedAt', 'desc'), limit(100)), snapshot => {
    setRuns(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }) as ImportRun)); setLoaded(true); setError('');
  }, () => { setLoaded(true); setError('Le suivi des imports ne peut pas être chargé. Actualisez la page pour réessayer.'); }), []);
  const incomplete = runs.filter(run => run.status !== 'Terminé');
  const missing = packages.filter(p => !['Livré', 'Retourné', 'À retourner'].includes(p.status) &&
    (/boiron/i.test(p.clientName) || (/^BR\d+$/i.test(p.externalId || '') && /^\d{8}$/.test(p.clientReference || ''))) && !p.carrierBarcode);
  return <details className="rounded-xl border border-amber-200 bg-amber-50 p-4">
    <summary className="cursor-pointer font-semibold min-h-11">Préparation des scans : {missing.length} étiquette(s) Boiron à associer{loaded && !error ? ` · ${incomplete.length} import(s) incomplet(s) parmi les 100 derniers` : ''}</summary>
    <p className="text-sm mb-3">Vérifiez les imports et les deux étiquettes de chaque carton avant le départ. Les anciens imports sans suivi ne sont pas comptés ici.</p>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {!loaded && <p role="status">Chargement des confirmations d’import…</p>}
    {incomplete.map(run => <div key={run.id} className="border rounded-lg bg-white p-3 mb-2">
      <strong>{run.clientName} — {run.fileName || 'Import de colis'}</strong>
      <p>{run.confirmedCount}/{run.expectedCount} références confirmées · {run.rejectedRows || 0} ligne(s) rejetée(s).</p>
      <p className="break-words text-sm">À vérifier : {(run.pendingReferences || []).slice(0, 30).map(ref => ref.split('\t')[0]).join(', ') || 'les lignes rejetées du fichier'}{run.pendingReferences?.length > 30 ? '…' : ''}</p>
      <p className="text-sm">Reprenez le fichier d’origine : les références déjà enregistrées ne seront pas recréées.</p>
    </div>)}
    {missing.slice(0, visible).map(parcel => <div key={parcel.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2">
      <span className="text-sm">{parcel.externalId || parcel.barcode} — {parcel.contactName}</span>
      <button className="ui-button ui-button-secondary min-h-11" onClick={() => onAssociate(parcel.externalId || parcel.barcode || '')}>Associer les étiquettes</button>
    </div>)}
    {missing.length > visible && <button className="ui-button ui-button-secondary min-h-11" onClick={() => setVisible(n => n + 40)}>Afficher plus de cartons ({missing.length - visible})</button>}
  </details>;
}
