import React, { useEffect, useState } from 'react';
import { OfficeSavedView, officeViewParams, readOfficeSavedViews } from '../utils/officeSavedViews';
import { notifyError, notifyInfo, notifySuccess } from '../services/logService';

interface Props { userId: string; label: string; params: Record<string, string>; onApply: (params: Record<string, string>) => void; }

export default function OfficeSavedViews({ userId, label, params, onApply }: Props) {
  const key = `fleet:office-views:v1:${userId}`;
  const [views, setViews] = useState<OfficeSavedView[]>([]);
  useEffect(() => {
    try { setViews(readOfficeSavedViews(localStorage.getItem(key))); } catch { setViews([]); }
  }, [key]);
  const persist = (next: OfficeSavedView[]) => {
    try { localStorage.setItem(key, JSON.stringify(next)); setViews(next); return true; }
    catch { notifyError('Le navigateur ne peut pas conserver les vues favorites. Les filtres restent dans le lien de cette page.'); return false; }
  };
  const save = () => {
    const filtered = officeViewParams(params);
    if (views.some(view => JSON.stringify(view.params) === JSON.stringify(filtered))) { notifyInfo('Cette vue est déjà dans vos favoris.'); return; }
    if (views.length >= 8) { notifyInfo('Vous avez 8 vues favorites. Retirez-en une avant d’en ajouter une autre.'); return; }
    if (persist([...views, { id: crypto.randomUUID(), label, params: filtered }])) notifySuccess('Vue favorite conservée dans ce navigateur.');
  };
  return <details className="rounded-xl border border-slate-200 bg-white text-sm">
    <summary className="min-h-11 cursor-pointer px-3 py-3 font-semibold text-slate-700">Mes vues favorites{views.length ? ` (${views.length})` : ''}</summary>
    <div className="space-y-3 px-3 pb-3">
      <p className="text-slate-600">Filtres et tri conservés dans ce navigateur, pour votre compte. Une vue s’ouvre à la date du jour, sans recherche nominative ni sélection de colis.</p>
      <button type="button" onClick={save} className="min-h-11 rounded-lg border border-blue-300 bg-blue-50 px-3 font-semibold text-blue-800">Mémoriser les filtres actuels</button>
      {views.map(view => <div key={view.id} className="flex items-start gap-2">
        <button type="button" onClick={() => onApply(view.params)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-left text-slate-800">{view.label}</button>
        <button type="button" aria-label={`Retirer la vue ${view.label}`} onClick={() => persist(views.filter(item => item.id !== view.id))} className="min-h-11 shrink-0 rounded-lg px-3 text-red-800">Retirer</button>
      </div>)}
    </div>
  </details>;
}
