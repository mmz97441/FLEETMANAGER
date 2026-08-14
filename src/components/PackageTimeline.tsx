/**
 * TIMELINE D'UN COLIS
 *
 * Parcours chronologique des mouvements, façon suivi transporteur :
 * "Enregistré 8h02 → Collecté 8h45 → Au centre de tri 9h30 → Livré 14h05".
 *
 * Trois niveaux d'affichage :
 * - défaut : vue grand public simple.
 * - `showActors` : traçabilité EXPÉDITEUR — qui a manipulé le colis à chaque
 *   étape (chauffeur, véhicule, hub), + carte preuve de livraison (GPS,
 *   signature, photos, réceptionnaire, état marchandise) sur l'étape « Livré ».
 * - `showInternalDetails` : ajoute les notes techniques internes (usage admin).
 */
import React from 'react';
import { PackageMovement, ProofOfDelivery } from '../types';

const MOVEMENT_META: Record<PackageMovement['action'], { label: string; icon: string; tone?: 'success' | 'error' }> = {
  IMPORTED: { label: 'Colis enregistré', icon: '📥' },
  COLLECTED: { label: "Collecté chez l'expéditeur", icon: '📦' },
  HUB_ARRIVAL: { label: 'Arrivé au centre de tri', icon: '🏭' },
  SORTED: { label: 'Trié et affecté à une zone', icon: '🗂️' },
  LOADED: { label: 'Chargé dans le véhicule de livraison', icon: '🚚' },
  LOADING_COMPLETE: { label: 'Départ en tournée', icon: '🛣️' },
  TRANSFERRED: { label: 'Transféré vers un autre chauffeur', icon: '🔁' },
  OUT_FOR_DELIVERY: { label: 'Pris en charge pour livraison', icon: '🚚' },
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
  showActors?: boolean;      // traçabilité expéditeur (intervenants + preuve)
  pod?: ProofOfDelivery;     // preuve de livraison, rattachée à l'étape « Livré »
}

// Carte « preuve de livraison » (visible expéditeur) rattachée à l'étape Livré.
const ProofCard: React.FC<{ pod: ProofOfDelivery }> = ({ pod }) => {
  const mapsUrl = pod.coordinates
    ? `https://www.google.com/maps?q=${pod.coordinates.lat},${pod.coordinates.lng}`
    : '';
  return (
    <div className="mt-2 rounded-xl border border-green-200 bg-green-50/60 p-3 space-y-2">
      <p className="text-[11px] font-bold text-green-800 uppercase tracking-wide">Preuve de livraison</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {pod.recipientName && (
          <div><span className="text-slate-500">Réceptionné par</span><br /><span className="font-semibold text-slate-800">{pod.recipientName}</span></div>
        )}
        {pod.deliveryLocation && (
          <div><span className="text-slate-500">Lieu de remise</span><br /><span className="font-semibold text-slate-800">{pod.deliveryLocation}</span></div>
        )}
        {pod.driverName && (
          <div><span className="text-slate-500">Chauffeur</span><br /><span className="font-semibold text-slate-800">{pod.driverName}</span></div>
        )}
        {pod.vehiclePlate && (
          <div><span className="text-slate-500">Véhicule</span><br /><span className="font-semibold text-slate-800">{pod.vehiclePlate}</span></div>
        )}
      </div>

      {/* État marchandise */}
      {typeof pod.merchandiseGoodCondition === 'boolean' && (
        pod.merchandiseGoodCondition
          ? <p className="text-[11px] font-semibold text-green-700">✓ Marchandises reçues en bon état</p>
          : <p className="text-[11px] font-semibold text-amber-700">⚠️ Réserves : {pod.reservesNote || 'signalées à la réception'}</p>
      )}

      {/* GPS */}
      {pod.coordinates && (
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 underline">
          📍 Voir le point GPS de livraison
        </a>
      )}

      {/* Signature + photos */}
      <div className="flex flex-wrap items-end gap-2 pt-1">
        {pod.signatureUrl && (
          <div>
            <p className="text-[10px] text-slate-500 mb-0.5">Signature</p>
            <img src={pod.signatureUrl} alt="signature" className="h-14 rounded-md border border-slate-200 bg-white p-1" />
          </div>
        )}
        {(pod.photoUrls || []).slice(0, 4).map((u, i) => (
          <img key={i} src={u} alt={`photo ${i + 1}`} className="h-14 w-14 rounded-md border border-slate-200 object-cover" />
        ))}
      </div>
    </div>
  );
};

const PackageTimeline: React.FC<PackageTimelineProps> = ({ movements, showInternalDetails = false, showActors = false, pod }) => {
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

        // Intervenants (traçabilité expéditeur)
        const actors: string[] = [];
        if (showActors) {
          if (move.driverName) actors.push(`👤 ${move.driverName}`);
          if (move.vehiclePlate) actors.push(`🚚 ${move.vehiclePlate}`);
        }

        return (
          <div key={`${move.timestamp}-${i}`} className="flex gap-3">
            {/* Pastille + trait vertical */}
            <div className="flex flex-col items-center">
              <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
              {!isLast && <div className="w-px flex-1 bg-slate-200 my-0.5" />}
            </div>

            {/* Contenu */}
            <div className="pb-3 min-w-0 flex-1">
              <p className={`text-xs font-bold ${isLast ? 'text-slate-800' : 'text-slate-600'}`}>
                {meta.icon} {meta.label}
                {move.hubName && <span className="font-medium text-slate-500"> — {move.hubName}</span>}
              </p>
              <p className="text-[11px] text-slate-400">{formatDateTime(move.timestamp)}</p>
              {actors.length > 0 && (
                <p className="text-[11px] text-slate-600 mt-0.5 font-medium">{actors.join('  ·  ')}</p>
              )}
              {showInternalDetails && move.notes && (
                <p className="text-[11px] text-slate-500 mt-0.5">{move.notes}</p>
              )}
              {/* Preuve de livraison rattachée à l'étape Livré */}
              {showActors && pod && move.action === 'DELIVERED' && <ProofCard pod={pod} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PackageTimeline;
