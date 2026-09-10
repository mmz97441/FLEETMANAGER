/**
 * SERVICE D'OPTIMISATION DE TOURNÉES
 * 
 * Utilise Google Route Optimization API (GMPRO) via Cloud Function
 * pour répartir les livraisons sur plusieurs véhicules de façon optimale.
 * 
 * Flow: Frontend → Cloud Function (OAuth2) → GMPRO → Routes optimisées
 */

import { Package, Hub, User, Vehicle, MissionStop, StopStatus } from '../types';
import { optimizeToursCF, GMPROModel, GMPROResult } from './cloudFunctions';
// Source de vérité UNIQUE du regroupement par point de livraison (cf. address.ts).
import { placeKey } from '../utils/address';
// Source de vérité UNIQUE des distances (cf. geo.ts).
import { haversineKm } from '../utils/geo';

// ============================================================================
// TYPES
// ============================================================================

export interface TourResult {
  vehicleIndex: number;
  driverId: string;
  driverName: string;
  vehicleId?: string;
  vehiclePlate?: string;
  stops: MissionStop[];
  totalDistance: number;      // km
  estimatedDuration: number;  // minutes
  packageCount: number;
}

export interface OptimizationResult {
  success: boolean;
  tours: TourResult[];
  totalDistance: number;
  totalDuration: number;
  totalPackages: number;
  skippedShipments: number;
  skippedStopNames?: string[];  // Noms des stops non routés
  error?: string;
  method: 'gmpro' | 'fallback';
}

export interface DriverVehicle {
  driver: User;
  vehicle?: Vehicle;
}

// ============================================================================
// GÉOCODAGE
// ============================================================================

export const geocodeAddress = async (
  address: string,
  city: string,
  postalCode: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> => {
  try {
    const fullAddress = `${address}, ${postalCode} ${city}, La Réunion, France`;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

// Géocoder les packages qui n'ont pas de coordonnées
const geocodePackages = async (
  packages: Package[],
  apiKey: string
): Promise<Map<string, { lat: number; lng: number }>> => {
  const results = new Map<string, { lat: number; lng: number }>();
  
  const needsGeocoding = packages.filter(p => !hasValidCoordinates(p.coordinates));
  if (needsGeocoding.length === 0) return results;
  
  // Dédupliquer par adresse
  const uniqueAddresses = new Map<string, Package>();
  for (const pkg of needsGeocoding) {
    const key = placeKey(pkg);
    if (!uniqueAddresses.has(key)) {
      uniqueAddresses.set(key, pkg);
    }
  }
  
  for (const [key, pkg] of uniqueAddresses) {
    const coords = await geocodeAddress(pkg.address, pkg.city, pkg.postalCode, apiKey);
    if (hasValidCoordinates(coords)) {
      results.set(key, coords);
    }
  }
  
  return results;
};

// ============================================================================
// GROUPEMENT DES COLIS PAR STOP
// ============================================================================

interface StopGroup {
  key: string;
  packages: Package[];
  coords?: { lat: number; lng: number };
  contactName: string;
}

const groupPackagesByStop = (
  packages: Package[],
  geocodedAddresses: Map<string, { lat: number; lng: number }>
): StopGroup[] => {
  const groups = new Map<string, Package[]>();

  for (const pkg of packages) {
    const key = placeKey(pkg);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)?.push(pkg);
  }

  const stopGroups: StopGroup[] = [];

  for (const [key, pkgs] of groups) {
    const firstPkg = pkgs[0];
    const coords = geocodedAddresses.get(key) || pkgs.find(pkg => hasValidCoordinates(pkg.coordinates))?.coordinates;
    
    stopGroups.push({
      key,
      packages: pkgs,
      coords,
      contactName: firstPkg.contactName
    });
  }
  
  return stopGroups;
};

// ============================================================================
// CONVERSION HORAIRE
// ============================================================================

const timeToISO = (time: string, date: string): string => `${date}T${time.padStart(5, '0')}:00+04:00`;

const timeToMinutes = (time: string): number => {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`Horaire invalide « ${time} ». Utilisez le format HH:MM.`);
  }
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const hasValidCoordinates = (
  coords: { lat: number; lng: number } | null | undefined,
): coords is { lat: number; lng: number } => !!coords &&
  Number.isFinite(coords.lat) && Number.isFinite(coords.lng) &&
  Math.abs(coords.lat) <= 90 && Math.abs(coords.lng) <= 180;

const durationSeconds = (duration: string | undefined): number | undefined => {
  if (!duration || !/^\d+(?:\.\d+)?s$/.test(duration)) return undefined;
  const seconds = Number(duration.slice(0, -1));
  return Number.isFinite(seconds) ? seconds : undefined;
};

const describeStop = (stop: StopGroup): string =>
  `${stop.contactName || 'Destinataire'} — ${stop.packages[0].address}, ${stop.packages[0].city} (${stop.packages.length} colis)`;

/** A grouped visit must satisfy every parcel's arrival window. */
const getStopWindow = (
  stop: StopGroup, globalStart: number, globalEnd: number,
): { start: number; end: number } | undefined => {
  let start = globalStart;
  let end = globalEnd;
  let constrained = false;
  for (const pkg of stop.packages) {
    if (pkg.timeWindowStart) {
      start = Math.max(start, timeToMinutes(pkg.timeWindowStart));
      constrained = true;
    }
    if (pkg.timeWindowEnd) {
      end = Math.min(end, timeToMinutes(pkg.timeWindowEnd));
      constrained = true;
    }
  }
  if (constrained && end <= start) {
    throw new Error(`Créneaux incompatibles pour ${describeStop(stop)} avec le départ et la fermeture du hub. Corrigez les horaires ou préparez des tournées séparées pour ces colis.`);
  }
  return constrained ? { start, end } : undefined;
};

type Route = NonNullable<GMPROResult['routes']>[number];

/** Exclude idle waiting: the departure recalculation applies the window anew. */
const transitionMinutes = (
  route: Route, index: number, serviceMinutesBefore: number, plannedStart: string,
): number | undefined => {
  const transition = route.transitions?.[index];
  if (transition) {
    const travel = durationSeconds(transition.travelDuration);
    if (travel !== undefined) {
      return (travel + (durationSeconds(transition.delayDuration) ?? 0) +
        (durationSeconds(transition.breakDuration) ?? 0)) / 60;
    }
    const total = durationSeconds(transition.totalDuration);
    if (total !== undefined) return Math.max(0, total - (durationSeconds(transition.waitDuration) ?? 0)) / 60;
  }
  const visitStart = route.visits?.[index]?.startTime;
  const previousStart = index === 0
    ? route.vehicleStartTime || plannedStart
    : route.visits?.[index - 1]?.startTime;
  if (visitStart && previousStart) {
    const previousEnd = Date.parse(previousStart) + (index === 0 ? 0 : serviceMinutesBefore * 60_000);
    const elapsed = Date.parse(visitStart) - previousEnd;
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      return Math.max(0, elapsed / 1000 - (durationSeconds(transition?.waitDuration) ?? 0)) / 60;
    }
  }
  // Protobuf omits zero-valued durations. An existing transition with no
  // duration is a zero-duration leg; an absent transition is unknown.
  return transition ? 0 : undefined;
};

const routeDurationMinutes = (route: Route, stops: MissionStop[], hubCoords: { lat: number; lng: number }): number => {
  const total = durationSeconds(route.metrics?.totalDuration);
  if (total !== undefined) return total / 60;
  if (route.vehicleStartTime && route.vehicleEndTime) {
    const elapsed = Date.parse(route.vehicleEndTime) - Date.parse(route.vehicleStartTime);
    if (Number.isFinite(elapsed) && elapsed >= 0) return elapsed / 60_000;
  }
  const service = durationSeconds(route.metrics?.visitDuration) ?? stops.reduce((sum, stop) => sum + stop.serviceTime * 60, 0);
  if (route.transitions?.length === stops.length + 1) {
    const transitionTotal = route.transitions.reduce((sum, transition) => sum +
      (durationSeconds(transition.totalDuration) ?? (
        (durationSeconds(transition.travelDuration) ?? 0) +
        (durationSeconds(transition.waitDuration) ?? 0) +
        (durationSeconds(transition.delayDuration) ?? 0) +
        (durationSeconds(transition.breakDuration) ?? 0)
      )), 0);
    return (transitionTotal + service) / 60;
  }
  const travel = durationSeconds(route.metrics?.travelDuration);
  if (travel !== undefined) {
    return (travel + service + (durationSeconds(route.metrics?.waitDuration) ?? 0) +
      (durationSeconds(route.metrics?.delayDuration) ?? 0) +
      (durationSeconds(route.metrics?.breakDuration) ?? 0)) / 60;
  }
  // Last-resort estimate, only when all locations are known. Includes service
  // and the return to the hub; never substitutes travel-only for total duration.
  return estimateDistanceForStops(stops, hubCoords) * 2 + service / 60;
};

// ============================================================================
// OPTIMISATION MULTI-VÉHICULES (GMPRO via Cloud Function)
// ============================================================================

export const optimizeMultiVehicle = async (
  packages: Package[],
  driversVehicles: DriverVehicle[],
  hub: Hub,
  date: string,
  apiKey: string,
  departureTime: string = '08:00',
): Promise<OptimizationResult> => {
  let stopGroups: StopGroup[] = [];
  const failed = (error: string, names = stopGroups.map(describeStop)): OptimizationResult => ({
    success: false, tours: [], totalDistance: 0, totalDuration: 0,
    totalPackages: 0, skippedShipments: stopGroups.length,
    skippedStopNames: names.length ? names : undefined, error, method: 'gmpro',
  });
  try {
    if (!packages.length || !driversVehicles.length) return failed('Sélectionnez au moins un colis et un chauffeur.');
    const globalStart = timeToMinutes(departureTime);
    const closingTime = hub.closingTime || '20:00';
    const globalEnd = timeToMinutes(closingTime);
    if (globalEnd <= globalStart) return failed('Le départ doit précéder la fermeture du hub. Corrigez les horaires.');
    const globalStartTime = timeToISO(departureTime, date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(globalStartTime))) {
      return failed('Date de tournée invalide.');
    }

    const geocodedAddresses = await geocodePackages(packages, apiKey);
    stopGroups = groupPackagesByStop(packages, geocodedAddresses);
    const windows = new Map(stopGroups.map(stop => [stop.key, getStopWindow(stop, globalStart, globalEnd)]));
    let hubCoords = hasValidCoordinates(hub.coordinates) ? hub.coordinates : undefined;
    if (!hubCoords) hubCoords = (await geocodeAddress(hub.address, hub.city, hub.postalCode, apiKey)) ?? undefined;
    if (!hasValidCoordinates(hubCoords)) {
      return failed('Le hub ne peut pas être localisé. Corrigez son adresse ou ses coordonnées avant de calculer les tournées.');
    }
    const validStops = stopGroups.filter(stop => hasValidCoordinates(stop.coords));
    const ungeocodedStops = stopGroups.filter(stop => !hasValidCoordinates(stop.coords));
    if (!validStops.length) {
      return failed('Aucune adresse de livraison ne peut être localisée. Corrigez les adresses ou leurs coordonnées avant de calculer les tournées.',
        ungeocodedStops.map(stop => `${describeStop(stop)} — adresse non localisée`));
    }

    const model: GMPROModel = {
      shipments: validStops.map((stop, index) => {
        const window = windows.get(stop.key);
        return {
          deliveries: [{
            arrivalLocation: { latitude: stop.coords!.lat, longitude: stop.coords!.lng },
            duration: `${Math.max(5, stop.packages.length * 5) * 60}s`,
            ...(window ? { timeWindows: [{
              startTime: timeToISO(minutesToTime(window.start), date),
              endTime: timeToISO(minutesToTime(window.end), date),
            }] } : {}),
          }],
          label: `Stop ${index + 1}: ${stop.contactName} (${stop.packages.length} colis)`,
          penaltyCost: 10000,
        };
      }),
      vehicles: driversVehicles.map(dv => ({
        startLocation: { latitude: hubCoords.lat, longitude: hubCoords.lng },
        endLocation: { latitude: hubCoords.lat, longitude: hubCoords.lng },
        label: `${dv.driver.firstName} ${dv.driver.lastName}${dv.vehicle ? ` (${dv.vehicle.plate})` : ''}`,
      })),
      globalStartTime,
      globalEndTime: timeToISO(closingTime, date),
      searchMode: 2,
    };
    const result = await optimizeToursCF(model);
    const tours: TourResult[] = [];
    const routed = new Set<number>();
    const routedVehicles = new Set<number>();
    for (const route of result.routes || []) {
      if (!route.visits?.length) continue;
      const vehicleIndex = route.vehicleIndex ?? 0;
      const dv = driversVehicles[vehicleIndex];
      if (!dv || routedVehicles.has(vehicleIndex)) throw new Error('Le calcul a retourné une affectation de chauffeur incohérente. Relancez l’optimisation.');
      routedVehicles.add(vehicleIndex);
      const stops: MissionStop[] = [];
      for (let index = 0; index < route.visits.length; index++) {
        const visit = route.visits[index];
        const shipmentIndex = visit.shipmentIndex ?? 0;
        const group = validStops[shipmentIndex];
        if (!group || routed.has(shipmentIndex)) throw new Error('Le calcul a retourné des colis inconnus ou affectés plusieurs fois. Relancez l’optimisation.');
        routed.add(shipmentIndex);
        const first = group.packages[0];
        const window = windows.get(group.key);
        const durationFromPrevious = transitionMinutes(route, index, stops[index - 1]?.serviceTime ?? 0, globalStartTime);
        const distance = route.transitions?.[index]?.travelDistanceMeters;
        const serviceTime = Math.max(5, group.packages.length * 5);
        const arrival = visit.startTime && Number.isFinite(Date.parse(visit.startTime)) ? visit.startTime : undefined;
        stops.push({
          id: `stop-${Date.now()}-${vehicleIndex}-${index}`,
          sequence: index + 1,
          type: 'DELIVERY',
          address: first.address, city: first.city, postalCode: first.postalCode,
          coordinates: group.coords, floor: first.floor, hasElevator: first.hasElevator,
          contactName: first.contactName, contactPhone: first.contactPhone,
          packageIds: group.packages.map(pkg => pkg.id), packageCount: group.packages.length,
          timeWindowStart: window ? minutesToTime(window.start) : undefined,
          timeWindowEnd: window ? minutesToTime(window.end) : undefined,
          serviceTime, status: StopStatus.PENDING,
          estimatedArrival: arrival,
          estimatedDeparture: arrival ? new Date(Date.parse(arrival) + serviceTime * 60_000).toISOString() : undefined,
          ...(durationFromPrevious !== undefined ? { durationFromPrevious } : {}),
          ...(distance !== undefined ? { distanceFromPrevious: distance / 1000 } : {}),
        });
      }
      const distance = route.metrics?.travelDistanceMeters;
      tours.push({
        vehicleIndex, driverId: dv.driver.id, driverName: `${dv.driver.firstName} ${dv.driver.lastName}`,
        vehicleId: dv.vehicle?.id, vehiclePlate: dv.vehicle?.plate, stops,
        totalDistance: Math.round((distance !== undefined ? distance / 1000 : estimateDistanceForStops(stops, hubCoords)) * 10) / 10,
        estimatedDuration: Math.round(routeDurationMinutes(route, stops, hubCoords)),
        packageCount: stops.reduce((sum, stop) => sum + stop.packageCount, 0),
      });
    }
    // Reconcile actual assignments with ALL input stops. Google's mandatory
    // counter omits optional shipments with penaltyCost and geocoding failures.
    const skippedStopNames = [
      ...ungeocodedStops.map(stop => `${describeStop(stop)} — adresse non localisée`),
      ...validStops.filter((_, index) => !routed.has(index)).map(stop => `${describeStop(stop)} — non affecté par l’optimisation`),
    ];
    if (!tours.length) return failed('Aucun arrêt n’a pu être affecté. Vérifiez les adresses, les créneaux et les chauffeurs disponibles.', skippedStopNames);
    return {
      success: true, tours,
      totalDistance: Math.round(tours.reduce((sum, tour) => sum + tour.totalDistance, 0) * 10) / 10,
      totalDuration: Math.round(tours.reduce((sum, tour) => sum + tour.estimatedDuration, 0)),
      totalPackages: tours.reduce((sum, tour) => sum + tour.packageCount, 0),
      skippedShipments: skippedStopNames.length,
      skippedStopNames: skippedStopNames.length ? skippedStopNames : undefined,
      error: skippedStopNames.length ? `${skippedStopNames.length} arrêt(s) non affecté(s) : ${skippedStopNames.join('; ')}` : undefined,
      method: 'gmpro',
    };
  } catch (error) {
    console.error('Erreur optimisation:', error);
    return failed(error instanceof Error ? error.message : 'Erreur inconnue lors du calcul des tournées.');
  }
};

const estimateDistanceForStops = (stops: MissionStop[], hubCoords: { lat: number; lng: number }): number => {
  const points = [hubCoords, ...stops.flatMap(stop => stop.coordinates ? [stop.coordinates] : []), hubCoords];
  const distance = points.slice(1).reduce((sum, point, index) => sum + haversineKm(points[index], point), 0);
  return Math.round(distance * 1.4 * 10) / 10;
};

// ============================================================================
// EXPORTS COMPATIBILITÉ (pour ApiDiagnostic, etc.)
// ============================================================================

export const getGoogleMapsApiKey = (): string => {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
};

export const isGMPROConfigured = (): boolean => {
  return !!getGoogleMapsApiKey();
};
