import React, { useSyncExternalStore } from 'react';
import { clearUxMetrics, exportUxMetrics, getUxMetrics, getUxMetricsVersion, setUxMetricsEnabled, subscribeUxMetrics, summarizeUxMetrics, UxTask } from '../utils/uxMetrics';

const names: Record<UxTask,string> = { find_package: 'Recherche de colis', create_shipment: 'Création / reprise d’expédition', dispatch: 'Affectation de tournée', deliver: 'Validation de livraison', sync: 'Synchronisation des preuves', load_packages: 'Chargement des colis' };
const roles = { office: 'Bureau', driver: 'Chauffeur', client: 'Client', other: 'Autre profil' };
export default function UxMetricsPanel() {
  useSyncExternalStore(subscribeUxMetrics, getUxMetricsVersion, () => 0);
  const state = getUxMetrics();
  const rows = summarizeUxMetrics(state.records);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportUxMetrics(), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'observations-usage-session.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const seconds = (value: number | null) => value === null ? 'Non mesuré' : `${(value / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} s`;
  return <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4" aria-labelledby="ux-observations-title">
    <h3 id="ux-observations-title" className="text-lg font-bold text-slate-900">Observations de cette session</h3>
    <p className="text-sm text-slate-700">Temps et résultats des actions mesurées sur cet appareil, limités aux {state.limit} dernières observations. Aucun nom, adresse, référence de colis, photo ou signature n’est enregistré ici. Ces mesures restent dans cet onglet et ne sont pas envoyées automatiquement.</p>
    <label className="flex items-center gap-3 min-h-11 text-sm font-semibold"><input type="checkbox" checked={state.enabled} onChange={e => setUxMetricsEnabled(e.target.checked)} className="w-5 h-5"/> Mesurer les prochaines actions de cette session</label>
    <p role="status" className="text-sm text-slate-700">{state.records.length} observation{state.records.length > 1 ? 's' : ''}. Un temps technique ne mesure pas à lui seul la facilité d’usage.</p>
    {rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Résultats locaux par action et profil ; durées des réussites uniquement</caption><thead><tr>{['Action','Résultats','Médiane','p95'].map(label => <th key={label} scope="col" className="p-2 border-b">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.task+row.role}><th scope="row" className="p-2 border-b font-medium">{names[row.task]}<span className="block text-slate-600">{roles[row.role]}</span></th><td className="p-2 border-b">{row.successes} réussites · {row.errors} erreurs · {row.cancelled} abandons</td><td className="p-2 border-b whitespace-nowrap">{seconds(row.medianMs)}</td><td className="p-2 border-b whitespace-nowrap">{seconds(row.p95Ms)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">Aucune action mesurée pour le moment. Effectuez un parcours, puis revenez consulter ses observations.</p>}
    <p className="text-sm text-slate-600">La médiane et le p95 portent uniquement sur les réussites. Avec peu d’essais, ces valeurs ne sont pas représentatives ; comparez le même parcours et le même appareil avant et après correction.</p>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={download} disabled={!rows.length} className="min-h-11 rounded-xl bg-blue-800 text-white px-4 font-semibold disabled:opacity-50">Exporter le bilan</button><button type="button" onClick={clearUxMetrics} disabled={!rows.length} className="min-h-11 rounded-xl border border-slate-300 px-4 font-semibold disabled:opacity-50">Effacer les observations locales</button></div>
  </section>;
}
