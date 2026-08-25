/**
 * DRIVER TOUR VIEW — Feuille de route chauffeur
 * 
 * Vue mobile-first pour le chauffeur en tournée :
 * - Sa mission du jour (liste ordonnée des stops)
 * - ETA par stop (calculé par GMPRO)
 * - Bouton Naviguer → Google Maps / Waze
 * - Compteur live : livrés / échecs / restants
 * - Statut par stop : fait / en cours / à faire
 * - Résumé fin de journée
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Navigation, MapPin, Phone, Package as PackageIcon, CheckCircle, XCircle,
  Clock, Truck, ChevronDown, ChevronUp, AlertTriangle, Flag,
  Play, Timer, Route, ArrowRight, Building2, User as UserIcon,
  Layers, ExternalLink
} from 'lucide-react';
import {
  Mission, MissionStatus, MissionStop, StopStatus, Package, PackageStatus,
  Zone, ZONE_COLORS, User, UserRole, Vehicle
} from '../types';
import { todayISO } from '../utils/date';
import {
  subscribeToMissions,
  subscribeToPackages,
  updatePackageStatus
} from '../services/missionService';

// ============================================================================
// TYPES
// ============================================================================

interface DriverTourViewProps {
  currentUser: User;
  vehicles: Vehicle[];
}

// ============================================================================
// HELPERS
// ============================================================================

const formatETA = (isoTime?: string): string => {
  if (!isoTime) return '--:--';
  try {
    const d = new Date(isoTime);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
};

const formatDuration = (minutes?: number): string => {
  if (!minutes) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h${m > 0 ? m.toString().padStart(2, '0') : ''}`;
};

const formatDistance = (km?: number): string => {
  if (!km) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
};

const getNavigationUrl = (stop: MissionStop): string => {
  // Essayer coordonnées d'abord, sinon adresse
  if (stop.coordinates?.lat && stop.coordinates?.lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${stop.coordinates.lat},${stop.coordinates.lng}`;
  }
  const addr = encodeURIComponent(`${stop.address}, ${stop.postalCode} ${stop.city}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${addr}`;
};

const getWazeUrl = (stop: MissionStop): string => {
  if (stop.coordinates?.lat && stop.coordinates?.lng) {
    return `https://waze.com/ul?ll=${stop.coordinates.lat},${stop.coordinates.lng}&navigate=yes`;
  }
  const addr = encodeURIComponent(`${stop.address}, ${stop.postalCode} ${stop.city}`);
  return `https://waze.com/ul?q=${addr}&navigate=yes`;
};

const stopStatusConfig = {
  [StopStatus.PENDING]: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', dot: 'bg-slate-300', label: 'À faire' },
  [StopStatus.ARRIVED]: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Sur place' },
  [StopStatus.COMPLETED]: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500', label: 'Terminé' },
  [StopStatus.SKIPPED]: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Passé' },
  [StopStatus.FAILED]: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500', label: 'Échec' },
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const DriverTourView: React.FC<DriverTourViewProps> = ({ currentUser, vehicles }) => {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);
  const [showNavOptions, setShowNavOptions] = useState<string | null>(null);

  const today = todayISO();

  // ============================================================================
  // SUBSCRIPTIONS
  // ============================================================================

  useEffect(() => {
    const unsub1 = subscribeToMissions(setMissions, { date: today, driverId: currentUser.id });
    const unsub2 = subscribeToPackages(setPackages);
    return () => { unsub1(); unsub2(); };
  }, [today, currentUser.id]);

  // ============================================================================
  // DATA
  // ============================================================================

  // Mission active du jour (la plus récente non-terminée, ou la terminée si c'est la seule)
  const mission = useMemo(() => {
    const active = missions.find(m => 
      m.driverId === currentUser.id && 
      (m.status === MissionStatus.IN_PROGRESS || m.status === MissionStatus.DISPATCHED)
    );
    if (active) return active;
    
    // Si pas d'active, prendre la dernière terminée du jour
    return missions.find(m => 
      m.driverId === currentUser.id && m.status === MissionStatus.COMPLETED
    ) || null;
  }, [missions, currentUser.id]);

  // Véhicule
  const vehicle = useMemo(() => {
    if (!mission?.vehicleId) return null;
    return vehicles.find(v => v.id === mission.vehicleId) || null;
  }, [mission, vehicles]);

  // Stops triés par séquence
  const orderedStops = useMemo(() => 
    mission ? [...mission.stops].sort((a, b) => a.sequence - b.sequence) : [],
    [mission]
  );

  // Prochain stop à faire
  const nextStop = useMemo(() => 
    orderedStops.find(s => s.status === StopStatus.PENDING || s.status === StopStatus.ARRIVED),
    [orderedStops]
  );

  // Compteurs
  const counters = useMemo(() => {
    if (!mission) return { delivered: 0, failed: 0, remaining: 0, total: 0, progress: 0 };
    
    const delivered = mission.deliveredPackages || 0;
    const failed = mission.failedPackages || 0;
    const total = mission.totalPackages || 0;
    const remaining = total - delivered - failed;
    const progress = total > 0 ? Math.round(((delivered + failed) / total) * 100) : 0;
    
    return { delivered, failed, remaining, total, progress };
  }, [mission]);

  // Packages du stop (pour afficher le détail)
  const getStopPackages = (stop: MissionStop) => 
    packages.filter(p => stop.packageIds.includes(p.id));

  // Fin de journée ?
  const isComplete = mission?.status === MissionStatus.COMPLETED;
  const allStopsDone = orderedStops.length > 0 && orderedStops.every(s => 
    s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  // === PAS DE MISSION ===
  if (!mission) {
    return (
      <div className="space-y-6">
        <div className="text-center py-16">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Route size={36} className="text-slate-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-700">Pas de mission aujourd'hui</h2>
          <p className="text-sm text-slate-500 mt-2">
            Votre tournée apparaîtra ici une fois dispatchée par le responsable.
          </p>
          <p className="text-xs text-slate-400 mt-4">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>
    );
  }

  // === RÉSUMÉ FIN DE JOURNÉE ===
  if (isComplete || allStopsDone) {
    const deliveryRate = counters.total > 0 
      ? Math.round((counters.delivered / counters.total) * 100) 
      : 0;
    
    return (
      <div className="space-y-6">
        {/* Header fin de journée */}
        <div className={`rounded-3xl p-8 text-center ${
          deliveryRate >= 95 ? 'bg-gradient-to-br from-green-500 to-emerald-600' :
          deliveryRate >= 80 ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
          'bg-gradient-to-br from-red-500 to-rose-600'
        } text-white shadow-xl`}>
          <Flag size={48} className="mx-auto mb-3 opacity-90" />
          <h2 className="text-2xl font-black">Tournée terminée !</h2>
          <p className="text-white/80 mt-1">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* Score */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <p className={`text-6xl font-black ${
            deliveryRate >= 95 ? 'text-green-600' : deliveryRate >= 80 ? 'text-amber-600' : 'text-red-600'
          }`}>
            {deliveryRate}%
          </p>
          <p className="text-sm text-slate-500 mt-1">Taux de livraison</p>
        </div>

        {/* Détails */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <CheckCircle size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-black text-green-700">{counters.delivered}</p>
            <p className="text-[10px] text-green-600 font-bold uppercase">Livrés</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 text-center">
            <XCircle size={24} className="mx-auto text-red-600 mb-1" />
            <p className="text-2xl font-black text-red-700">{counters.failed}</p>
            <p className="text-[10px] text-red-600 font-bold uppercase">Échecs</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 text-center">
            <PackageIcon size={24} className="mx-auto text-slate-600 mb-1" />
            <p className="text-2xl font-black text-slate-700">{counters.total}</p>
            <p className="text-[10px] text-slate-600 font-bold uppercase">Total</p>
          </div>
        </div>

        {/* Métriques */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Distance</p>
            <p className="text-lg font-bold text-slate-800">{formatDistance(mission.totalDistance)}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Durée</p>
            <p className="text-lg font-bold text-slate-800">{formatDuration(mission.estimatedDuration)}</p>
          </div>
        </div>

        {/* Zone */}
        <div className="text-center">
          <span className={`inline-block px-4 py-2 rounded-xl text-sm font-bold ${ZONE_COLORS[mission.zone]?.bg || 'bg-slate-100'} ${ZONE_COLORS[mission.zone]?.text || 'text-slate-600'}`}>
            Mission {mission.zone} • {vehicle?.plate || 'Véhicule'}
          </span>
        </div>
      </div>
    );
  }

  // === MISSION EN COURS ===
  return (
    <div className="space-y-4">
      {/* Header mission */}
      <div className={`rounded-2xl p-5 ${ZONE_COLORS[mission.zone]?.bg || 'bg-indigo-50'} border ${ZONE_COLORS[mission.zone]?.border || 'border-indigo-200'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-black ${ZONE_COLORS[mission.zone]?.text || 'text-indigo-700'}`}>
              Ma tournée — {mission.zone}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {vehicle?.plate || 'Véhicule'} • {orderedStops.length} stops • {formatDistance(mission.totalDistance)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
            {mission.estimatedDuration && (
              <p className="text-xs text-slate-500 flex items-center gap-1 justify-end mt-0.5">
                <Timer size={10} />
                {formatDuration(mission.estimatedDuration)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Compteur live */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle size={14} className="text-green-600" />
              <span className="text-sm font-bold text-green-700">{counters.delivered}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle size={14} className="text-red-600" />
              <span className="text-sm font-bold text-red-700">{counters.failed}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={14} className="text-slate-400" />
              <span className="text-sm font-bold text-slate-600">{counters.remaining}</span>
            </div>
          </div>
          <span className="text-sm font-bold text-slate-800">
            {counters.delivered + counters.failed}/{counters.total}
          </span>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full flex">
            <div 
              className="bg-green-500 transition-all duration-500"
              style={{ width: `${counters.total > 0 ? (counters.delivered / counters.total) * 100 : 0}%` }}
            />
            <div 
              className="bg-red-500 transition-all duration-500"
              style={{ width: `${counters.total > 0 ? (counters.failed / counters.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Prochain stop (highlight) */}
      {nextStop && (
        <div className="bg-indigo-600 rounded-2xl p-5 text-white shadow-lg shadow-indigo-200">
          <p className="text-[10px] text-indigo-200 uppercase font-bold tracking-wider mb-1">Prochain arrêt</p>
          <h3 className="text-lg font-black">{nextStop.contactName}</h3>
          <p className="text-sm text-indigo-100 mt-0.5">{nextStop.address}</p>
          <p className="text-xs text-indigo-200">{nextStop.postalCode} {nextStop.city}</p>
          
          <div className="flex items-center gap-4 mt-3">
            {nextStop.estimatedArrival && (
              <span className="text-sm text-indigo-100 flex items-center gap-1">
                <Clock size={12} /> ETA {formatETA(nextStop.estimatedArrival)}
              </span>
            )}
            {nextStop.packageCount > 0 && (
              <span className="text-sm text-indigo-100 flex items-center gap-1">
                <PackageIcon size={12} /> {nextStop.packageCount} colis
              </span>
            )}
            {nextStop.durationFromPrevious && (
              <span className="text-sm text-indigo-100 flex items-center gap-1">
                <Navigation size={12} /> {formatDuration(nextStop.durationFromPrevious)}
              </span>
            )}
          </div>
          
          <div className="flex gap-2 mt-4">
            <a
              href={getNavigationUrl(nextStop)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-white text-indigo-700 rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              <Navigation size={16} />
              Google Maps
            </a>
            <a
              href={getWazeUrl(nextStop)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-500 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              <ExternalLink size={16} />
              Waze
            </a>
            {nextStop.contactPhone && (
              <a
                href={`tel:${nextStop.contactPhone}`}
                className="w-14 flex items-center justify-center bg-indigo-500 text-white rounded-xl active:scale-95 transition-transform"
              >
                <Phone size={18} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Liste des stops */}
      <div className="space-y-2">
        {orderedStops.map((stop, index) => {
          const config = stopStatusConfig[stop.status] || stopStatusConfig[StopStatus.PENDING];
          const isExpanded = expandedStopId === stop.id;
          const isNext = nextStop?.id === stop.id;
          const isDone = stop.status === StopStatus.COMPLETED || stop.status === StopStatus.FAILED || stop.status === StopStatus.SKIPPED;
          const stopPackages = getStopPackages(stop);
          const showNavMenu = showNavOptions === stop.id;

          return (
            <div
              key={stop.id}
              className={`rounded-xl border transition-all ${isNext ? 'ring-2 ring-indigo-400' : ''} ${config.bg} ${config.border} ${isDone ? 'opacity-70' : ''}`}
            >
              {/* En-tête stop */}
              <div
                className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                onClick={() => setExpandedStopId(isExpanded ? null : stop.id)}
              >
                {/* Numéro de séquence */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${
                  isDone ? `${config.dot} text-white` : 'bg-white border-2 border-slate-300 text-slate-700'
                }`}>
                  {isDone ? (
                    stop.status === StopStatus.COMPLETED ? '✓' :
                    stop.status === StopStatus.FAILED ? '✗' : '−'
                  ) : (
                    stop.sequence
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${isDone ? 'line-through opacity-60' : 'text-slate-800'}`}>
                    {stop.contactName}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {stop.address} • {stop.city}
                  </p>
                </div>

                {/* Métadonnées */}
                <div className="text-right flex-shrink-0">
                  {stop.estimatedArrival && !isDone && (
                    <p className="text-xs font-bold text-slate-700">{formatETA(stop.estimatedArrival)}</p>
                  )}
                  <div className="flex items-center gap-1 justify-end">
                    {stop.packageCount > 0 && (
                      <span className="text-[10px] text-slate-500">{stop.packageCount} colis</span>
                    )}
                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                  </div>
                </div>
              </div>

              {/* Détails (expanded) */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100/60 space-y-3">
                  {/* Infos */}
                  <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                    {stop.contactPhone && (
                      <a href={`tel:${stop.contactPhone}`} className="flex items-center gap-1 text-blue-600 font-medium">
                        <Phone size={12} /> {stop.contactPhone}
                      </a>
                    )}
                    {stop.floor !== undefined && (
                      <span className="flex items-center gap-1">
                        <Building2 size={12} /> Étage {stop.floor} {stop.hasElevator ? '(ascenseur)' : '(sans ascenseur)'}
                      </span>
                    )}
                    {stop.timeWindowStart && stop.timeWindowEnd && (
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {stop.timeWindowStart} — {stop.timeWindowEnd}
                      </span>
                    )}
                    {stop.durationFromPrevious && (
                      <span className="flex items-center gap-1">
                        <Navigation size={12} /> {formatDistance(stop.distanceFromPrevious)} • {formatDuration(stop.durationFromPrevious)}
                      </span>
                    )}
                  </div>

                  {/* Notes */}
                  {stop.notes && (
                    <div className="bg-amber-50 rounded-lg p-2 text-xs text-amber-700">
                      📝 {stop.notes}
                    </div>
                  )}

                  {/* Colis du stop */}
                  {stopPackages.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">Colis</p>
                      {stopPackages.map(pkg => (
                        <div key={pkg.id} className="flex items-center gap-2 text-xs bg-white/60 rounded-lg px-2 py-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            pkg.status === PackageStatus.DELIVERED ? 'bg-green-500' :
                            pkg.status === PackageStatus.FAILED ? 'bg-red-500' :
                            'bg-slate-300'
                          }`} />
                          <span className="font-mono text-slate-500">{pkg.barcode || pkg.orderNumber}</span>
                          <span className="text-slate-700 font-medium truncate">{pkg.contactName}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Navigation (si pas terminé) */}
                  {!isDone && (
                    <div className="flex gap-2">
                      <a
                        href={getNavigationUrl(stop)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-800 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform"
                      >
                        <Navigation size={14} />
                        Google Maps
                      </a>
                      <a
                        href={getWazeUrl(stop)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-xs active:scale-95 transition-transform"
                      >
                        <ExternalLink size={14} />
                        Waze
                      </a>
                      {stop.contactPhone && (
                        <a
                          href={`tel:${stop.contactPhone}`}
                          className="w-12 flex items-center justify-center bg-green-600 text-white rounded-xl active:scale-95 transition-transform"
                        >
                          <Phone size={16} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Légende */}
      <div className="flex items-center justify-center gap-4 py-2">
        {[
          { dot: 'bg-slate-300', label: 'À faire' },
          { dot: 'bg-blue-500', label: 'Sur place' },
          { dot: 'bg-green-500', label: 'Terminé' },
          { dot: 'bg-red-500', label: 'Échec' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${l.dot}`} />
            <span className="text-[10px] text-slate-500">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DriverTourView;
