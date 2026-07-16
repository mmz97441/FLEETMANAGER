/**
 * TIMELINE D'UN COLIS
 *
 * Parcours chronologique des mouvements, façon suivi transporteur :
 * "Enregistré 8h02 → Collecté 8h45 → Au centre de tri 9h30 → Livré 14h05".
 *
 * Par défaut, vue grand public (portail client) : libellés simples, pas de
 * détails internes. `showInternalDetails` ajoute chauffeur/notes (usage admin).
 */
import React from 'react';
import { PackageMovement } from '../types';

const MOVEMENT_META: Record<PackageMovement['action'], { label: string; icon: string; tone?: 'success' | 'error' }> = {
  IMPORTED: { label: 'Colis enregistré', icon: '📥' },
  COLLECTED: { label: "Collecté chez l'expéditeur", icon: '📦' },
  HUB_ARRIVAL: { label: 'Arrivé au centre de tri', icon: '🏭' },
  SORTED: { label: 'Trié et affecté à une zone', icon: '🗂️' },
  LOADED: { label: 'Chargé dans le véhicule de livraison', icon: '🚚' },
  LOADING_COMPLETE: { label: 'Départ en tournée', icon: '🛣️' },
  TRANSFERRED: { label: 'Transféré vers un autre véhicule', icon: '🔁' },
  OUT_FOR_DELIVERY: { label: 'En cours de livraison', icon: '🚚' },
  DELIVERED: { label: 'Livré', icon: '✅', tone: 'success' },
  FAILED: { label: 'Échec de livraison', icon: '❌', tone: 'error' },
  RETURN_REQUESTED: { label: 'Retour programmé', icon: '↩️' },
  RETURNED: { label: 'Retourné au centre', icon: '🏭' },
  STOP_DELETED: { label: 'Livraison annulée', icon: '🚫', tone: 'error' },
  MANUAL_STATUS_CHANGE: { label: 'Statut mis à jour', icon: '✏️' }
};

const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

interface PackageTimelineProps {
  movements: PackageMovement[];
  showInternalDetails?: boolean;
}

const PackageTimeline: React.FC<PackageTimelineProps> = ({ movements, showInternalDetails = false }) => {
  const sorted = [...(movements || [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (sorted.length === 0) {
    return <p className="text-xs text-slate-400 py-2">Aucun mouvement enregistré pour ce colis.</p>;
  }

  return (
    <div className="py-2">
      {sorted.map((move, i) => {
        const meta = MOVEMENT_META[move.action] || { label: move.action, icon: '•' };
        const isLast = i === sorted.length - 1;
        const dotColor =
          meta.tone === 'success' ? 'bg-green-500' :
          meta.tone === 'error' ? 'bg-red-500' :
          isLast ? 'bg-blue-500' : 'bg-slate-300';

        return (
          <div key={`${move.timestamp}-${i}`} className="flex gap-3">
            {/* Pastille + trait vertical */}
            <div className="flex flex-col items-center">
              <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
              {!isLast && <div className="w-px flex-1 bg-slate-200 my-0.5" />}
            </div>

            {/* Contenu */}
            <div className={`pb-3 min-w-0 ${isLast ? '' : ''}`}>
              <p className={`text-xs font-bold ${isLast ? 'text-slate-800' : 'text-slate-600'}`}>
                {meta.icon} {meta.label}
                {move.hubName && <span className="font-medium text-slate-500"> — {move.hubName}</span>}
              </p>
              <p className="text-[11px] text-slate-400">{formatDateTime(move.timestamp)}</p>
              {showInternalDetails && (move.driverName || move.notes) && (
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {[move.driverName, move.notes].filter(Boolean).join(' • ')}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PackageTimeline;
