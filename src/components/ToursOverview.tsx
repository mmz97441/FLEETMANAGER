/**
 * SUIVI DES TOURNÉES (dispatch / direction)
 * =========================================
 * Tableau de bord interne EN LECTURE SEULE : toutes les tournées actives
 * (en cours + dispatchées) en un seul écran. Pour chaque chauffeur, on voit
 * d'un coup d'œil l'avancement de ses livraisons, le prochain arrêt, puis —
 * en dépliant la carte — la liste ordonnée de tous ses arrêts.
 *
 * Ce n'est PAS une carte (aucun Leaflet) : c'est un board / une liste.
 * Le composant possède son propre abonnement temps réel aux missions ;
 * il suffit de lui passer la liste des utilisateurs pour résoudre les noms.
 */
import React, { useEffect, useMemo, useState } from 'react';

import {
  User,
  Mission,
  MissionStatus,
  MissionStop,
  StopStatus,
  MISSION_STATUS_COLORS,
  STOP_STATUS_COLORS,
} from '../types';
import { subscribeToMissions } from '../services/missionService';
import { getDeliveryStopStats } from '../utils/missionProgress';

interface ToursOverviewProps {
  users: User[];
}

// View-model d'une tournée active, prêt pour l'affichage.
interface TourVM {
  mission: Mission;
  driverName: string;
  deliveryStops: MissionStop[]; // arrêts DELIVERY triés par séquence
  delivered: number;
  total: number;
  pct: number;
  nextStop?: MissionStop;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** "à l'instant" / "il y a N min" / "il y a N h" / "il y a N j". */
const timeAgo = (iso?: string): string => {
  if (!iso) return 'jamais';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'jamais';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return "à l'instant";
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
};

/** Formate un ETA (ISO ou "HH:MM") en horaire court HH:MM. */
const formatEta = (eta?: string): string | undefined => {
  if (!eta) return undefined;
  const t = Date.parse(eta);
  if (!Number.isNaN(t)) {
    return new Date(t).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return eta;
};

/** Nom complet du chauffeur résolu depuis `users`, sinon fallback mission. */
const resolveDriverName = (mission: Mission, usersById: Map<string, User>): string => {
  const u = mission.driverId ? usersById.get(mission.driverId) : undefined;
  if (u) {
    const full = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    if (full) return full;
    if (u.email) return u.email;
  }
  return mission.driverName || 'Chauffeur inconnu';
};

/** Badge de statut d'un arrêt — couleurs depuis le registre central (types.ts). */
const stopStatusBadge = (status: StopStatus): { cls: string } => {
  const c = STOP_STATUS_COLORS[status];
  return { cls: c ? `${c.bg} ${c.text}` : 'bg-slate-100 text-slate-600' };
};

const StopStatusBadge: React.FC<{ status: StopStatus }> = ({ status }) => (
  <span
    className={`text-xs rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap ${stopStatusBadge(status).cls}`}
  >
    {status}
  </span>
);

const MissionStatusBadge: React.FC<{ status: MissionStatus }> = ({ status }) => {
  const c = MISSION_STATUS_COLORS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2 py-0.5 ${c?.bg || 'bg-slate-100'} ${c?.text || 'text-slate-700'}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${c?.dot || 'bg-slate-400'}`} />
      {status}
    </span>
  );
};

// ---------------------------------------------------------------------------
// COMPOSANT PRINCIPAL
// ---------------------------------------------------------------------------

const ToursOverview: React.FC<ToursOverviewProps> = ({ users }) => {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});

  // Abonnement temps réel (nettoyé au démontage)
  useEffect(() => {
    const unsub = subscribeToMissions(setMissions);
    return () => unsub();
  }, []);

  const usersById = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  // Tournées actives : EN COURS puis DISPATCHÉES, triées et transformées.
  const tours = useMemo<TourVM[]>(() => {
    const active = missions.filter(
      (m) =>
        m.status === MissionStatus.IN_PROGRESS ||
        m.status === MissionStatus.DISPATCHED
    );

    const vms = active.map<TourVM>((mission) => {
      const driverName = resolveDriverName(mission, usersById);

      const deliveryStops = (mission.stops || [])
        .filter((s) => s.type === 'DELIVERY')
        .sort((a, b) => a.sequence - b.sequence);

      const { delivered, total, pct } = getDeliveryStopStats({ stops: deliveryStops });

      const nextStop = deliveryStops.find(
        (s) => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
      );

      return { mission, driverName, deliveryStops, delivered, total, pct, nextStop };
    });

    // Tri : IN_PROGRESS avant DISPATCHED, puis par nom de chauffeur.
    return vms.sort((a, b) => {
      const rank = (s: MissionStatus): number =>
        s === MissionStatus.IN_PROGRESS ? 0 : 1;
      const byStatus = rank(a.mission.status) - rank(b.mission.status);
      if (byStatus !== 0) return byStatus;
      return a.driverName.localeCompare(b.driverName);
    });
  }, [missions, usersById]);

  const inProgressCount = tours.filter(
    (t) => t.mission.status === MissionStatus.IN_PROGRESS
  ).length;
  const dispatchedCount = tours.filter(
    (t) => t.mission.status === MissionStatus.DISPATCHED
  ).length;

  const toggle = (id: string) =>
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">🚚 Suivi des tournées</h1>
          <p className="text-sm text-slate-500">
            Toutes les tournées actives en un coup d'œil — avancement et prochain arrêt de chaque chauffeur.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="font-semibold text-orange-600">{inProgressCount}</span> en cours
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-purple-600">{dispatchedCount}</span> dispatchée
          {dispatchedCount > 1 ? 's' : ''}
        </div>
      </div>

      {/* Contenu */}
      {tours.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <div className="text-3xl mb-2">📭</div>
          <p className="font-medium text-slate-700">Aucune tournée active</p>
          <p className="text-sm text-slate-500">
            Les tournées en cours ou dispatchées apparaîtront ici automatiquement.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tours.map((tour) => (
            <TourCard
              key={tour.mission.id}
              tour={tour}
              open={!!openIds[tour.mission.id]}
              onToggle={() => toggle(tour.mission.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SOUS-COMPOSANTS
// ---------------------------------------------------------------------------

interface TourCardProps {
  tour: TourVM;
  open: boolean;
  onToggle: () => void;
}

const TourCard: React.FC<TourCardProps> = ({ tour, open, onToggle }) => {
  const { mission, driverName, deliveryStops, delivered, total, pct, nextStop } = tour;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Ligne toujours visible (cliquable pour déplier) */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-start gap-3">
          {/* Pastille statut */}
          <span
            className={`mt-1.5 inline-block h-3 w-3 rounded-full flex-shrink-0 ${MISSION_STATUS_COLORS[mission.status]?.dot || 'bg-slate-400'}`}
          />

          <div className="min-w-0 flex-1">
            {/* Ligne 1 : nom + plaque + zone + badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-800 truncate">{driverName}</span>
              {mission.vehiclePlate && (
                <span className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 flex-shrink-0">
                  {mission.vehiclePlate}
                </span>
              )}
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500">Zone {mission.zone}</span>
              <MissionStatusBadge status={mission.status} />
            </div>

            {/* Ligne 2 : progression */}
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 max-w-xs rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                {delivered}/{total} livrés
                {total > 0 && <span className="text-slate-400"> ({pct}%)</span>}
              </span>
            </div>

            {/* Ligne 3 : prochain arrêt */}
            <div className="mt-1.5 text-xs text-slate-500">
              {nextStop ? (
                <span>
                  <span className="font-medium text-amber-700">Prochain :</span>{' '}
                  {nextStop.contactName || 'Destinataire'}
                  {nextStop.city && <span> — {nextStop.city}</span>}
                  {formatEta(nextStop.estimatedArrival) && (
                    <span> · ETA {formatEta(nextStop.estimatedArrival)}</span>
                  )}
                </span>
              ) : total > 0 ? (
                <span className="text-green-700 font-medium">Tous les arrêts sont terminés ✅</span>
              ) : (
                <span>Aucun arrêt de livraison</span>
              )}
            </div>
          </div>

          {/* Chevron */}
          <span
            className={`text-slate-400 text-sm mt-1 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          >
            ▾
          </span>
        </div>
      </button>

      {/* Détail déplié : liste ordonnée de tous les arrêts */}
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {deliveryStops.length === 0 ? (
            <p className="text-sm text-slate-400">Aucun arrêt de livraison dans cette tournée.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {deliveryStops.map((s) => {
                const isNext = nextStop?.id === s.id;
                return (
                  <li
                    key={s.id}
                    className={`flex items-start gap-3 py-2 ${isNext ? 'bg-amber-50 -mx-4 px-4' : ''}`}
                  >
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      {s.sequence}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate">
                          {s.contactName || 'Destinataire'}
                        </span>
                        {isNext && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1 py-0.5 flex-shrink-0">
                            Prochain
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {s.address}
                        {s.city && <span>, {s.city}</span>}
                        {s.postalCode && <span> {s.postalCode}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <StopStatusBadge status={s.status} />
                      {formatEta(s.estimatedArrival) && (
                        <span className="text-[11px] text-slate-400">
                          {formatEta(s.estimatedArrival)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Bas de carte : contexte tournée (lecture seule) */}
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
            <span>Hub {mission.hubName}</span>
            {mission.startedAt && <span>· démarrée {timeAgo(mission.startedAt)}</span>}
            {mission.dispatchedAt && !mission.startedAt && (
              <span>· dispatchée {timeAgo(mission.dispatchedAt)}</span>
            )}
            <span>· maj {timeAgo(mission.updatedAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToursOverview;
