/**
 * SUIVI LIVE — ESPACE CLIENT (EXPÉDITEUR)
 * =======================================
 * Carte temps réel où l'expéditeur voit le(s) livreur(s) qui transportent
 * SES colis et ses propres livraisons restantes.
 *
 * CONFIDENTIALITÉ STRICTE : ce composant n'utilise QUE les colis reçus en
 * props (déjà filtrés = les colis du client connecté). Il ne s'abonne à
 * AUCUNE mission ni donnée d'un autre client — toutes les infos live sont
 * dénormalisées sur chaque colis (`liveDriver`, `remainingBeforeMine`,
 * `estimatedDeliveryAt`).
 *
 * Réutilise le setup Leaflet de FleetMapView : import de la CSS, marqueurs
 * `L.divIcon` colorés (pas d'icône par défaut — évite le bug bundler), un
 * `<MapContainer>` dans un div à hauteur fixe et un sous-composant `useMap()`
 * (react-leaflet v4) pour le fit bounds / recentrage.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  Package as PackageType,
  User,
  PackageStatus,
  PACKAGE_STATUS_COLORS,
} from '../types';

interface ClientLiveTrackingProps {
  packages: PackageType[]; // déjà les colis du client connecté
  currentUser: User;
}

// Défaut : La Réunion
const DEFAULT_CENTER: [number, number] = [-21.11, 55.53];
const DEFAULT_ZOOM = 10;
const FRESH_MS = 5 * 60 * 1000;

// Couleurs des marqueurs
const COLOR_DRIVER = '#16a34a'; // green-600 — livreur en mouvement
const COLOR_DEST = '#4f46e5'; // indigo-600 — point de livraison

// Statuts terminaux : colis dont le parcours est fini (jamais "en cours")
const TERMINAL_STATUSES: PackageStatus[] = [
  PackageStatus.DELIVERED,
  PackageStatus.FAILED,
  PackageStatus.RETURN_REQUESTED,
  PackageStatus.RETURNED,
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

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

/** Formate une heure d'arrivée prévue (ISO) → "HH:MM" (fr-FR). */
const formatEta = (iso?: string): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Un colis est-il « en cours de livraison » (livreur live frais + non terminal) ? */
const isInTransit = (p: PackageType, now: number): boolean => {
  const ld = p.liveDriver;
  if (!ld) return false;
  const t = Date.parse(ld.updatedAt);
  if (Number.isNaN(t)) return false;
  if (now - t >= FRESH_MS) return false;
  if (TERMINAL_STATUSES.includes(p.status)) return false;
  return true;
};

/** Nom d'affichage du colis (numéro). */
const parcelNumber = (p: PackageType): string =>
  p.externalId || p.barcode || p.orderNumber || p.id;

/** Construit un marqueur coloré (divIcon) — l'icône par défaut casse avec Vite. */
const buildDriverIcon = (selected: boolean): L.DivIcon => {
  const size = selected ? 28 : 22;
  const ring = selected
    ? 'box-shadow:0 0 0 5px rgba(22,163,74,0.30), 0 2px 6px rgba(0,0,0,0.4);'
    : 'box-shadow:0 0 0 4px rgba(22,163,74,0.20), 0 2px 6px rgba(0,0,0,0.4);';
  return L.divIcon({
    className: '',
    html: `<div style="
        width:${size}px;height:${size}px;border-radius:9999px;
        background:${COLOR_DRIVER};border:3px solid #ffffff;${ring}
      "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
};

/** Marqueur « pin » indigo pour un point de livraison. */
const buildDestIcon = (): L.DivIcon => {
  const size = 16;
  return L.divIcon({
    className: '',
    html: `<div style="
        width:${size}px;height:${size}px;border-radius:9999px;
        background:${COLOR_DEST};border:2px solid #ffffff;
        box-shadow:0 2px 5px rgba(0,0,0,0.35);
      "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
};

// ---------------------------------------------------------------------------
// VIEW-MODELS
// ---------------------------------------------------------------------------

interface DriverGroup {
  key: string;
  driverName: string;
  lat: number;
  lng: number;
  updatedAt: string;
  parcels: PackageType[];
}

interface DestMarker {
  key: string;
  lat: number;
  lng: number;
  label: string;
}

/** Regroupe les colis en transit par livreur (nom, sinon position arrondie). */
const groupByDriver = (parcels: PackageType[]): DriverGroup[] => {
  const groups = new Map<string, DriverGroup>();
  for (const p of parcels) {
    const ld = p.liveDriver;
    if (!ld) continue;
    const name = ld.driverName?.trim();
    const key = name || `${ld.lat.toFixed(4)},${ld.lng.toFixed(4)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.parcels.push(p);
      // On garde la position la plus récente du groupe
      if (Date.parse(ld.updatedAt) > Date.parse(existing.updatedAt)) {
        existing.lat = ld.lat;
        existing.lng = ld.lng;
        existing.updatedAt = ld.updatedAt;
      }
    } else {
      groups.set(key, {
        key,
        driverName: name || 'Votre livreur',
        lat: ld.lat,
        lng: ld.lng,
        updatedAt: ld.updatedAt,
        parcels: [p],
      });
    }
  }
  return Array.from(groups.values());
};

// ---------------------------------------------------------------------------
// SOUS-COMPOSANT : recadrage / fit bounds (pattern react-leaflet v4)
// ---------------------------------------------------------------------------

interface MapControllerProps {
  points: Array<[number, number]>;
  recenter?: [number, number];
}

const MapController: React.FC<MapControllerProps> = ({ points, recenter }) => {
  const map = useMap();

  // Recentrage manuel (clic sur une ligne de la liste)
  useEffect(() => {
    if (recenter) {
      map.setView(recenter, 14, { animate: true });
    }
  }, [recenter, map]);

  // Fit bounds sur l'ensemble des points
  useEffect(() => {
    if (recenter) return; // ne pas écraser un recentrage manuel
    if (points.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length, map]);

  return null;
};

// ---------------------------------------------------------------------------
// COMPOSANT PRINCIPAL
// ---------------------------------------------------------------------------

const ClientLiveTracking: React.FC<ClientLiveTrackingProps> = ({ packages }) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [recenter, setRecenter] = useState<[number, number] | undefined>();

  // Horloge : rafraîchit "il y a N min" et purge les positions périmées.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Colis actuellement en tournée (livreur live frais + non terminal)
  const inTransit = useMemo(
    () => packages.filter((p) => isInTransit(p, now)),
    [packages, now]
  );

  // Tri par imminence : le plus proche de la livraison d'abord
  const sortedParcels = useMemo(() => {
    const rank = (p: PackageType): number =>
      typeof p.remainingBeforeMine === 'number'
        ? p.remainingBeforeMine
        : Number.POSITIVE_INFINITY;
    return [...inTransit].sort((a, b) => rank(a) - rank(b));
  }, [inTransit]);

  // Groupes de livreurs (marqueurs verts)
  const driverGroups = useMemo(() => groupByDriver(inTransit), [inTransit]);

  // Points de livraison en transit (marqueurs indigo)
  const destMarkers = useMemo<DestMarker[]>(() => {
    const seen = new Set<string>();
    const out: DestMarker[] = [];
    for (const p of inTransit) {
      const c = p.coordinates;
      if (!c) continue;
      const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = [p.contactName, p.city].filter(Boolean).join(' — ') || 'Livraison';
      out.push({ key, lat: c.lat, lng: c.lng, label });
    }
    return out;
  }, [inTransit]);

  // Tous les points pour le fit bounds (livreurs + destinations)
  const allPoints = useMemo<Array<[number, number]>>(() => {
    const pts: Array<[number, number]> = [];
    for (const g of driverGroups) pts.push([g.lat, g.lng]);
    for (const d of destMarkers) pts.push([d.lat, d.lng]);
    return pts;
  }, [driverGroups, destMarkers]);

  // Nombre de colis en attente (pas encore partis)
  const pendingCount = useMemo(
    () =>
      packages.filter(
        (p) => !isInTransit(p, now) && !TERMINAL_STATUSES.includes(p.status)
      ).length,
    [packages, now]
  );

  const recenterOnParcel = (p: PackageType) => {
    const ld = p.liveDriver;
    if (!ld) return;
    const name = ld.driverName?.trim();
    const key = name || `${ld.lat.toFixed(4)},${ld.lng.toFixed(4)}`;
    setSelectedKey(key);
    setRecenter([ld.lat, ld.lng]);
  };

  // -------------------------------------------------------------------------
  // RENDER — état vide
  // -------------------------------------------------------------------------

  if (inTransit.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Header />
        <div className="rounded-2xl border border-indigo-100 bg-white px-6 py-10 text-center shadow-sm">
          <div className="text-4xl">🛰️</div>
          <h2 className="mt-3 text-lg font-semibold text-slate-800">
            Aucune livraison en cours
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Vos colis apparaîtront ici dès qu'ils partent en tournée. Vous pourrez
            alors suivre votre livreur en temps réel sur la carte.
          </p>
          {pendingCount > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
              📦 {pendingCount} colis en préparation
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER — carte + liste
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      <Header
        subtitle={`${inTransit.length} colis en cours de livraison${
          driverGroups.length > 1 ? ` · ${driverGroups.length} livreurs` : ''
        }`}
      />

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* CARTE */}
        <div className="order-1 flex-1 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
          <div className="h-[55vh] min-h-[360px] w-full">
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
              <MapController points={allPoints} recenter={recenter} />

              {/* Points de livraison */}
              {destMarkers.map((d) => (
                <Marker key={`dest-${d.key}`} position={[d.lat, d.lng]} icon={buildDestIcon()}>
                  <Popup>
                    <div className="text-sm font-medium text-slate-800">{d.label}</div>
                  </Popup>
                </Marker>
              ))}

              {/* Livreurs */}
              {driverGroups.map((g) => (
                <Marker
                  key={`drv-${g.key}`}
                  position={[g.lat, g.lng]}
                  icon={buildDriverIcon(g.key === selectedKey)}
                  eventHandlers={{
                    click: () => {
                      setSelectedKey(g.key);
                      setRecenter([g.lat, g.lng]);
                    },
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-semibold text-slate-800">Votre livreur</div>
                      <div className="text-slate-500">position {timeAgo(g.updatedAt)}</div>
                      <div className="mt-1 font-medium text-green-700">
                        {g.parcels.length} de vos colis à bord
                      </div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* LISTE */}
        <div className="order-2 flex w-full flex-col gap-3 lg:w-[380px] lg:flex-shrink-0">
          {sortedParcels.map((p) => (
            <ParcelRow
              key={p.id}
              parcel={p}
              onClick={() => recenterOnParcel(p)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SOUS-COMPOSANTS UI
// ---------------------------------------------------------------------------

const Header: React.FC<{ subtitle?: string }> = ({ subtitle }) => (
  <div>
    <h1 className="text-xl font-bold text-slate-800">🚚 Suivi live de mes livraisons</h1>
    <p className="mt-0.5 text-sm text-slate-500">
      {subtitle || 'Suivez en temps réel les livreurs qui transportent vos colis.'}
    </p>
  </div>
);

interface ParcelRowProps {
  parcel: PackageType;
  onClick: () => void;
}

const ParcelRow: React.FC<ParcelRowProps> = ({ parcel, onClick }) => {
  const colors = PACKAGE_STATUS_COLORS[parcel.status] || {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
  };
  const eta = formatEta(parcel.estimatedDeliveryAt);
  const remaining = parcel.remainingBeforeMine;
  const driverName = parcel.liveDriver?.driverName?.trim() || 'Votre livreur';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-indigo-300"
    >
      {/* Ligne principale : destinataire + ville */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold text-slate-800">
          {parcel.contactName || 'Destinataire'}
          {parcel.city && <span className="text-slate-500"> · {parcel.city}</span>}
        </span>
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
        >
          {parcel.status}
        </span>
      </div>

      {/* Numéro de colis */}
      <div className="mt-0.5 text-xs text-slate-400">Colis {parcelNumber(parcel)}</div>

      {/* Position dans la file */}
      {typeof remaining === 'number' && remaining >= 0 && (
        <div className="mt-2">
          {remaining === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1 text-sm font-semibold text-green-700">
              🎯 Vous êtes le prochain !
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-700">
              ⏳ {remaining} colis avant le vôtre
            </span>
          )}
        </div>
      )}

      {/* ETA */}
      {eta && (
        <div className="mt-2 text-sm font-medium text-indigo-700">
          Arrivée prévue vers {eta}
        </div>
      )}

      {/* Livreur */}
      <div className="mt-1 text-xs text-slate-500">
        Livreur : {driverName} · position {timeAgo(parcel.liveDriver?.updatedAt)}
      </div>
    </button>
  );
};

export default ClientLiveTracking;
