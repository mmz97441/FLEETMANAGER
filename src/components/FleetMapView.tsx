/**
 * CARTE DES CHAUFFEURS (dispatch)
 * ==============================
 * Vue interne temps réel : tous les chauffeurs de la flotte sur une carte
 * Leaflet + un panneau latéral. Le dispatch voit d'un coup d'œil qui est en
 * tournée, qui est disponible (sans tournée), et l'avancement de chaque
 * livraison.
 *
 * Le composant possède ses propres abonnements temps réel (positions +
 * missions) ; il suffit de lui passer la liste des utilisateurs.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  User,
  Mission,
  MissionStatus,
  MissionStop,
  StopStatus,
  STOP_STATUS_COLORS,
  DriverLocation,
} from '../types';
import { subscribeToDriverLocations } from '../services/driverLocationService';
import { subscribeToMissions } from '../services/missionService';
import { getDeliveryStopStats } from '../utils/missionProgress';

interface FleetMapViewProps {
  users: User[];
}

// Bucket de statut d'un chauffeur
// - ON_TOUR   : en tournée, position fraîche
// - AVAILABLE : disponible (sans tournée), position fraîche
// - STALE     : a une position mais périmée (>= 3 min) — marqueur gris sur la carte
// - NEVER     : aucune entrée driverLocations — jamais connecté, absent de la carte
type DriverBucket = 'ON_TOUR' | 'AVAILABLE' | 'STALE' | 'NEVER';

interface ParsedDriver {
  user: User;
  name: string;
  plate?: string;
  location?: DriverLocation;
  activeMission?: Mission;
  bucket: DriverBucket;
  isFresh: boolean; // position fraîche (< 3 min) ?
  // Progression livraison (arrêts de type DELIVERY)
  deliveredStops: number;
  totalDeliveryStops: number;
}

// Défaut : La Réunion
const DEFAULT_CENTER: [number, number] = [-21.11, 55.53];
const DEFAULT_ZOOM = 10;
const FRESH_MS = 3 * 60 * 1000;

// Couleurs des pastilles
const COLOR_ON_TOUR = '#16a34a'; // green-600
const COLOR_AVAILABLE = '#f59e0b'; // amber-500
const COLOR_STALE = '#9ca3af'; // gray-400

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const isDriver = (u: User): boolean => {
  const r = String(u.role || '').toLowerCase();
  return r.includes('chauff') || r.includes('driver');
};

/** "à l'instant" / "il y a N min" / "il y a N h". */
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

/** Couleur d'une pastille selon le statut. */
const bucketColor = (d: ParsedDriver): string => {
  if (!d.isFresh) return COLOR_STALE;
  if (d.bucket === 'ON_TOUR') return COLOR_ON_TOUR;
  return COLOR_AVAILABLE;
};

/** Construit une pastille colorée (divIcon) — l'icône par défaut casse avec Vite. */
const buildPinIcon = (color: string, selected: boolean): L.DivIcon => {
  const size = selected ? 26 : 20;
  const border = selected ? 3 : 2;
  const ring = selected
    ? 'box-shadow:0 0 0 4px rgba(37,99,235,0.35), 0 2px 6px rgba(0,0,0,0.4);'
    : 'box-shadow:0 2px 6px rgba(0,0,0,0.4);';
  return L.divIcon({
    className: '',
    html: `<div style="
        width:${size}px;height:${size}px;border-radius:9999px;
        background:${color};border:${border}px solid #ffffff;${ring}
      "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
};

/** Numéro de plaque du chauffeur (mission active ou position publiée). */
const resolvePlate = (mission?: Mission, location?: DriverLocation): string | undefined =>
  mission?.vehiclePlate || location?.vehiclePlate || undefined;

// ---------------------------------------------------------------------------
// SOUS-COMPOSANT : recadrage / fit bounds (pattern react-leaflet v4)
// ---------------------------------------------------------------------------

interface MapControllerProps {
  markers: ParsedDriver[];
  selected?: ParsedDriver;
}

const MapController: React.FC<MapControllerProps> = ({ markers, selected }) => {
  const map = useMap();

  // Recadrage sur le chauffeur sélectionné
  useEffect(() => {
    if (selected?.location) {
      map.setView([selected.location.lat, selected.location.lng], 14, { animate: true });
    }
  }, [selected, map]);

  // Fit bounds sur tous les marqueurs (au chargement / changement du set)
  useEffect(() => {
    if (selected) return; // ne pas écraser un recadrage manuel
    const withLoc = markers.filter((m) => m.location);
    if (withLoc.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    if (withLoc.length === 1) {
      const loc = withLoc[0].location!;
      map.setView([loc.lat, loc.lng], 13);
      return;
    }
    const bounds = L.latLngBounds(withLoc.map((m) => [m.location!.lat, m.location!.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers.length, map]);

  return null;
};

// ---------------------------------------------------------------------------
// COMPOSANT PRINCIPAL
// ---------------------------------------------------------------------------

const FleetMapView: React.FC<FleetMapViewProps> = ({ users }) => {
  const [locations, setLocations] = useState<DriverLocation[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<DriverBucket, boolean>>({
    ON_TOUR: true,
    AVAILABLE: true,
    STALE: false,
    NEVER: false,
  });

  // Abonnements temps réel (nettoyés au démontage)
  useEffect(() => {
    const unsubLoc = subscribeToDriverLocations(setLocations);
    const unsubMis = subscribeToMissions(setMissions);
    return () => {
      unsubLoc();
      unsubMis();
    };
  }, []);

  // Construction du view-model des chauffeurs
  const parsedDrivers = useMemo<ParsedDriver[]>(() => {
    const locByDriver = new Map<string, DriverLocation>();
    for (const loc of locations) locByDriver.set(loc.driverId, loc);

    const activeMissionByDriver = new Map<string, Mission>();
    for (const m of missions) {
      if (!m.driverId) continue;
      const isActive =
        m.status === MissionStatus.IN_PROGRESS ||
        m.status === MissionStatus.DISPATCHED;
      if (!isActive) continue;
      // Priorité à une tournée réellement démarrée (IN_PROGRESS)
      const existing = activeMissionByDriver.get(m.driverId);
      if (
        !existing ||
        (existing.status !== MissionStatus.IN_PROGRESS &&
          m.status === MissionStatus.IN_PROGRESS)
      ) {
        activeMissionByDriver.set(m.driverId, m);
      }
    }

    const now = Date.now();

    return users
      .filter(isDriver)
      .map<ParsedDriver>((u) => {
        const location = locByDriver.get(u.id);
        const activeMission = activeMissionByDriver.get(u.id);
        const isOnTour = activeMission?.status === MissionStatus.IN_PROGRESS;

        const isFresh = location
          ? now - Date.parse(location.updatedAt) < FRESH_MS
          : false;

        let bucket: DriverBucket;
        if (!location) bucket = 'NEVER'; // aucune position publiée
        else if (!isFresh) bucket = 'STALE'; // position présente mais périmée
        else if (isOnTour) bucket = 'ON_TOUR';
        else bucket = 'AVAILABLE';

        const deliveryStops = (activeMission?.stops || []).filter(
          (s) => s.type === 'DELIVERY'
        );
        const deliveredStops = deliveryStops.filter(
          (s) => s.status === StopStatus.COMPLETED
        ).length;

        return {
          user: u,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.id,
          plate: resolvePlate(activeMission, location),
          location,
          activeMission,
          bucket,
          isFresh,
          deliveredStops,
          totalDeliveryStops: deliveryStops.length,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, locations, missions]);

  const groups = useMemo(() => {
    return {
      ON_TOUR: parsedDrivers.filter((d) => d.bucket === 'ON_TOUR'),
      AVAILABLE: parsedDrivers.filter((d) => d.bucket === 'AVAILABLE'),
      STALE: parsedDrivers.filter((d) => d.bucket === 'STALE'),
      NEVER: parsedDrivers.filter((d) => d.bucket === 'NEVER'),
    };
  }, [parsedDrivers]);

  // Marqueurs = chauffeurs ayant une position
  const mapMarkers = useMemo(
    () => parsedDrivers.filter((d) => d.location),
    [parsedDrivers]
  );

  const selected = useMemo(
    () => parsedDrivers.find((d) => d.user.id === selectedId),
    [parsedDrivers, selectedId]
  );

  const toggleGroup = (bucket: DriverBucket) =>
    setOpenGroups((prev) => ({ ...prev, [bucket]: !prev[bucket] }));

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">🚚 Carte des chauffeurs</h1>
          <p className="text-sm text-slate-500">
            Suivi temps réel de la flotte — position, tournée, avancement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <LegendDot color={COLOR_ON_TOUR} label="En tournée" />
          <LegendDot color={COLOR_AVAILABLE} label="Disponible" />
          <LegendDot color={COLOR_STALE} label="Position ancienne" />
          <LegendDot color={COLOR_STALE} label="Jamais connecté" hollow />
          <div className="flex flex-wrap items-center gap-2 text-slate-600">
            <span className="font-semibold text-green-600">{groups.ON_TOUR.length}</span> en tournée
            <span className="text-slate-300">·</span>
            <span className="font-semibold text-amber-600">{groups.AVAILABLE.length}</span> disponibles
            <span className="text-slate-300">·</span>
            <span className="font-semibold text-slate-500">{groups.STALE.length}</span> position ancienne
            <span className="text-slate-300">·</span>
            <span className="font-semibold text-slate-400">{groups.NEVER.length}</span> jamais connectés
          </div>
        </div>
      </div>

      {/* Deux colonnes (lg) / empilé (mobile) */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* PANNEAU LATÉRAL */}
        <div className="w-full lg:w-[360px] lg:flex-shrink-0 flex flex-col gap-3">
          <SidePanelGroup
            title="En tournée"
            color={COLOR_ON_TOUR}
            drivers={groups.ON_TOUR}
            open={openGroups.ON_TOUR}
            onToggle={() => toggleGroup('ON_TOUR')}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <SidePanelGroup
            title="Disponible / sans tournée"
            color={COLOR_AVAILABLE}
            drivers={groups.AVAILABLE}
            open={openGroups.AVAILABLE}
            onToggle={() => toggleGroup('AVAILABLE')}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <SidePanelGroup
            title="Position ancienne"
            color={COLOR_STALE}
            drivers={groups.STALE}
            open={openGroups.STALE}
            onToggle={() => toggleGroup('STALE')}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <SidePanelGroup
            title="Jamais connecté"
            color={COLOR_STALE}
            hollow
            drivers={groups.NEVER}
            open={openGroups.NEVER}
            onToggle={() => toggleGroup('NEVER')}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          {selected && <DriverDetail driver={selected} />}
        </div>

        {/* CARTE */}
        <div className="flex-1 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
          <div className="h-[70vh] min-h-[420px] w-full">
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={DEFAULT_ZOOM}
              scrollWheelZoom
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap"
              />
              <MapController markers={mapMarkers} selected={selected} />
              {mapMarkers.map((d) => (
                <Marker
                  key={d.user.id}
                  position={[d.location!.lat, d.location!.lng]}
                  icon={buildPinIcon(bucketColor(d), d.user.id === selectedId)}
                  eventHandlers={{ click: () => setSelectedId(d.user.id) }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold text-slate-800">{d.name}</div>
                      {d.plate && <div className="text-slate-500">{d.plate}</div>}
                      <div className="mt-1">{bucketLabel(d)}</div>
                      <div className="text-slate-500">maj {timeAgo(d.location!.updatedAt)}</div>
                      {d.bucket === 'ON_TOUR' && (
                        <div className="mt-1 font-medium text-green-700">
                          {d.deliveredStops}/{d.totalDeliveryStops} livrés
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SOUS-COMPOSANTS UI
// ---------------------------------------------------------------------------

const LegendDot: React.FC<{ color: string; label: string; hollow?: boolean }> = ({
  color,
  label,
  hollow,
}) => (
  <div className="flex items-center gap-1.5 text-slate-600">
    <span
      className="inline-block h-3 w-3 rounded-full"
      style={
        hollow
          ? { background: 'transparent', border: `2px solid ${color}` }
          : { background: color, border: '1px solid #ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }
      }
    />
    {label}
  </div>
);

const bucketLabel = (d: ParsedDriver): string => {
  if (d.bucket === 'ON_TOUR') return '🟢 En tournée';
  if (d.bucket === 'AVAILABLE') return '🟡 Disponible';
  if (d.bucket === 'STALE') return '⚪ Position ancienne';
  return '⚫ Jamais connecté';
};

interface SidePanelGroupProps {
  title: string;
  color: string;
  hollow?: boolean;
  drivers: ParsedDriver[];
  open: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SidePanelGroup: React.FC<SidePanelGroupProps> = ({
  title,
  color,
  hollow,
  drivers,
  open,
  onToggle,
  selectedId,
  onSelect,
}) => (
  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50"
    >
      <span className="flex items-center gap-2 font-semibold text-slate-700">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={
            hollow
              ? { background: 'transparent', border: `2px solid ${color}` }
              : { background: color }
          }
        />
        {title}
        <span className="text-slate-400 font-normal">({drivers.length})</span>
      </span>
      <span className="text-slate-400 text-lg leading-none">{open ? '−' : '+'}</span>
    </button>
    {open && (
      <div className="divide-y divide-slate-100">
        {drivers.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-400">Aucun chauffeur</div>
        ) : (
          drivers.map((d) => (
            <DriverRow
              key={d.user.id}
              driver={d}
              selected={d.user.id === selectedId}
              onSelect={() => onSelect(d.user.id)}
            />
          ))
        )}
      </div>
    )}
  </div>
);

interface DriverRowProps {
  driver: ParsedDriver;
  selected: boolean;
  onSelect: () => void;
}

const DriverRow: React.FC<DriverRowProps> = ({ driver, selected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
      selected ? 'bg-blue-50' : 'hover:bg-slate-50'
    }`}
  >
    <span
      className="mt-1 inline-block h-3 w-3 rounded-full flex-shrink-0"
      style={
        driver.bucket === 'NEVER'
          ? { background: 'transparent', border: `2px solid ${COLOR_STALE}` }
          : { background: bucketColor(driver), border: '1px solid #ffffff', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }
      }
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-800 truncate">{driver.name}</span>
        {driver.plate && (
          <span className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 flex-shrink-0">
            {driver.plate}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {driver.bucket === 'ON_TOUR' && (
          <span className="font-medium text-green-700">
            {driver.deliveredStops}/{driver.totalDeliveryStops} livrés
          </span>
        )}
        {driver.bucket === 'ON_TOUR' && driver.location && (
          <span> · maj {timeAgo(driver.location.updatedAt)}</span>
        )}
        {driver.bucket === 'AVAILABLE' && driver.location && (
          <span>maj {timeAgo(driver.location.updatedAt)}</span>
        )}
        {driver.bucket === 'STALE' && driver.location && (
          <span className="text-slate-400">position ancienne · maj {timeAgo(driver.location.updatedAt)}</span>
        )}
        {driver.bucket === 'NEVER' && <span className="text-slate-400">Jamais connecté</span>}
      </div>
    </div>
  </button>
);

// ---- Bloc détail (chauffeur sélectionné) ----

const DriverDetail: React.FC<{ driver: ParsedDriver }> = ({ driver }) => {
  const { activeMission } = driver;
  const [showTour, setShowTour] = useState(false);

  // Arrêts de livraison, triés par séquence
  const deliveryStops = useMemo<MissionStop[]>(
    () =>
      (activeMission?.stops || [])
        .filter((s) => s.type === 'DELIVERY')
        .sort((a, b) => a.sequence - b.sequence),
    [activeMission]
  );

  const remainingStops = deliveryStops.filter(
    (s) => s.status !== StopStatus.COMPLETED
  );
  const nextStop = remainingStops.find(
    (s) => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
  ) || remainingStops[0];

  const total = driver.totalDeliveryStops;
  const delivered = driver.deliveredStops;
  const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;

  return (
    <>
    <div className="rounded-xl border border-blue-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800">{driver.name}</span>
          <span className="text-xs">{bucketLabel(driver)}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {driver.plate ? `Véhicule ${driver.plate}` : 'Aucun véhicule'}
          {' · '}
          {driver.location
            ? `dernière position ${timeAgo(driver.location.updatedAt)}`
            : 'aucune position'}
          {driver.location && !driver.isFresh && (
            <span className="text-slate-400"> (ancienne)</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {!activeMission ? (
          <p className="text-sm text-slate-500">Sans tournée attribuée</p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Barre de progression */}
            <div>
              <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                <span>Progression livraisons</span>
                <span className="font-medium">
                  {delivered}/{total}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Voir la tournée (lecture seule) */}
            <button
              type="button"
              onClick={() => setShowTour(true)}
              className="w-full rounded-2xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 active:bg-indigo-800 transition-colors"
            >
              🗺️ Voir la tournée
            </button>

            {/* Prochain arrêt */}
            {nextStop ? (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  Prochain arrêt
                </div>
                <div className="text-sm font-medium text-slate-800">
                  {nextStop.contactName || 'Destinataire'}
                </div>
                <div className="text-xs text-slate-500">
                  {nextStop.city}
                  {nextStop.estimatedArrival && (
                    <span> · ETA {formatEta(nextStop.estimatedArrival)}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm text-green-700 font-medium">
                Tous les arrêts sont terminés ✅
              </div>
            )}

            {/* Arrêts restants */}
            {remainingStops.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Arrêts restants ({remainingStops.length})
                </div>
                <ul className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                  {remainingStops.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between text-sm gap-2"
                    >
                      <span className="text-slate-700 truncate min-w-0 flex-1">
                        <span className="text-slate-400">{s.sequence}.</span>{' '}
                        {s.contactName || 'Destinataire'}
                        <span className="text-slate-400"> — {s.city}</span>
                      </span>
                      <StopStatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {showTour && activeMission && (
      <DriverTourModal driver={driver} onClose={() => setShowTour(false)} />
    )}
    </>
  );
};

/** Formate un ETA (ISO ou "HH:MM") en horaire court. */
const formatEta = (eta: string): string => {
  const t = Date.parse(eta);
  if (!Number.isNaN(t)) {
    return new Date(t).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return eta;
};

// ---- Modale « Voir la tournée » (supervision, lecture seule) ----

const DriverTourModal: React.FC<{ driver: ParsedDriver; onClose: () => void }> = ({
  driver,
  onClose,
}) => {
  const { activeMission } = driver;

  // Fermeture au clavier (Échap)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // TOUS les arrêts de livraison, triés par séquence
  const deliveryStops = useMemo<MissionStop[]>(
    () =>
      (activeMission?.stops || [])
        .filter((s) => s.type === 'DELIVERY')
        .sort((a, b) => a.sequence - b.sequence),
    [activeMission]
  );

  const { delivered, total, pct } = getDeliveryStopStats({ stops: deliveryStops });

  // Prochain arrêt = 1er PENDING/ARRIVED dans l'ordre
  const nextStopId = deliveryStops.find(
    (s) => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED
  )?.id;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-w-lg w-full max-h-[85vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="sticky top-0 z-10 px-5 py-4 bg-indigo-600 text-white rounded-t-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-bold truncate">{driver.name}</div>
              <div className="mt-0.5 text-xs text-indigo-100">
                {driver.plate ? `Véhicule ${driver.plate}` : 'Aucun véhicule'}
                {activeMission?.zone && <span> · Zone {activeMission.zone}</span>}
              </div>
              <div className="mt-0.5 text-xs text-indigo-100">
                {driver.location
                  ? `Position maj ${timeAgo(driver.location.updatedAt)}`
                  : 'Aucune position'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="flex-shrink-0 h-8 w-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Barre de progression */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-indigo-100 mb-1">
              <span>Livraisons</span>
              <span className="font-semibold text-white">
                {delivered}/{total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/25 overflow-hidden">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Liste ordonnée de TOUS les arrêts de livraison */}
        <div className="px-4 py-4">
          {deliveryStops.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun arrêt de livraison sur cette tournée.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {deliveryStops.map((s, idx) => {
                const isNext = s.id === nextStopId;
                return (
                  <li
                    key={s.id}
                    className={`rounded-2xl border px-3 py-2.5 ${
                      isNext
                        ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex-shrink-0 h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-800 truncate">
                            {s.contactName || 'Destinataire'}
                          </span>
                          <StopStatusBadge status={s.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 truncate">
                          {s.address}
                          {s.city && <span> — {s.city}</span>}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          {isNext && (
                            <span className="font-semibold text-amber-700 uppercase tracking-wide">
                              Prochain arrêt
                            </span>
                          )}
                          {s.estimatedArrival && (
                            <span className="text-slate-500">
                              Prévu {formatEta(s.estimatedArrival)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

const StopStatusBadge: React.FC<{ status: StopStatus }> = ({ status }) => {
  const c = STOP_STATUS_COLORS[status];
  return (
    <span
      className={`text-xs rounded px-1.5 py-0.5 flex-shrink-0 ${c ? `${c.bg} ${c.text}` : 'bg-slate-100 text-slate-600'}`}
    >
      {status}
    </span>
  );
};

export default FleetMapView;
