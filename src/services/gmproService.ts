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
    
    console.warn(`Geocoding échoué pour: ${fullAddress}`, data.status);
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
  
  const needsGeocoding = packages.filter(p => !p.coordinates);
  if (needsGeocoding.length === 0) return results;
  
  // Dédupliquer par adresse
  const uniqueAddresses = new Map<string, Package>();
  for (const pkg of needsGeocoding) {
    const key = `${pkg.address.toLowerCase().trim()}|${pkg.postalCode}|${pkg.city.toLowerCase().trim()}`;
    if (!uniqueAddresses.has(key)) {
      uniqueAddresses.set(key, pkg);
    }
  }
  
  for (const [key, pkg] of uniqueAddresses) {
    const coords = await geocodeAddress(pkg.address, pkg.city, pkg.postalCode, apiKey);
    if (coords) {
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
    const key = `${pkg.address}|${pkg.postalCode}|${pkg.city}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pkg);
  }
  
  const stopGroups: StopGroup[] = [];
  
  for (const [key, pkgs] of groups) {
    const firstPkg = pkgs[0];
    const addressKey = `${firstPkg.address.toLowerCase().trim()}|${firstPkg.postalCode}|${firstPkg.city.toLowerCase().trim()}`;
    const coords = geocodedAddresses.get(addressKey) || firstPkg.coordinates;
    
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

const timeToISO = (time: string, date: string): string => {
  return `${date}T${time}:00+04:00`;
};

const timeToMinutes = (time: string): number => {
  const parts = time.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || '0');
};

const minutesToTime = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// ============================================================================
// OPTIMISATION MULTI-VÉHICULES (GMPRO via Cloud Function)
// ============================================================================

/**
 * Optimise les tournées pour N chauffeurs avec M colis
 */
export const optimizeMultiVehicle = async (
  packages: Package[],
  driversVehicles: DriverVehicle[],
  hub: Hub,
  date: string,
  apiKey: string,
  departureTime: string = '08:00'  // Heure de départ prévue (du formulaire)
): Promise<OptimizationResult> => {
  try {
    // 1. Géocoder les adresses
    const geocodedAddresses = await geocodePackages(packages, apiKey);
    
    // 2. Regrouper par stop
    const stopGroups = groupPackagesByStop(packages, geocodedAddresses);
    
    // 3. Coordonnées du hub
    let hubCoords = hub.coordinates;
    if (!hubCoords) {
      hubCoords = await geocodeAddress(hub.address, hub.city, hub.postalCode, apiKey);
      if (!hubCoords) {
        console.warn('Hub non géocodé, fallback');
        return createFallbackOptimization(stopGroups, driversVehicles, null);
      }
    }
    
    // 4. Filtrer les stops sans coordonnées
    const validStops = stopGroups.filter(sg => sg.coords);
    const skippedStops = stopGroups.filter(sg => !sg.coords);
    
    if (skippedStops.length > 0) {
      console.warn(`⚠️ ${skippedStops.length} stops sans coordonnées:`, skippedStops.map(s => s.key));
      // Si tous les stops n'ont pas de coords, utiliser le fallback avec tous les stops
      // (le fallback peut fonctionner sans coords en répartissant simplement)
      if (validStops.length === 0) {
        console.warn('🔄 Tous les stops sans coordonnées — utilisation du fallback géographique');
        return createFallbackOptimization(stopGroups, driversVehicles, hubCoords);
      }
    }
    
    if (validStops.length === 0) {
      return {
        success: false, tours: [], totalDistance: 0, totalDuration: 0,
        totalPackages: 0, skippedShipments: 0,
        error: 'Aucun stop avec coordonnées valides', method: 'fallback'
      };
    }
    
    // 5. Construire la requête GMPRO
    // Utiliser l'heure de départ du formulaire dispatch
    const globalStartMinutes = timeToMinutes(departureTime);
    const globalEndMinutes = timeToMinutes(hub.closingTime || '20:00');
    
    console.log(`🕐 Plage horaire GMPRO: ${departureTime} → ${hub.closingTime || '20:00'}`);
    
    const shipments = validStops.map((sg, idx) => {
      const serviceTime = Math.max(5, sg.packages.length * 5);
      const firstPkg = sg.packages[0];
      
      const shipment: GMPROModel['shipments'][0] = {
        deliveries: [{
          arrivalLocation: {
            latitude: sg.coords!.lat, longitude: sg.coords!.lng
          },
          duration: `${serviceTime * 60}s`
        }],
        label: `Stop ${idx + 1}: ${sg.contactName} (${sg.packages.length} colis)`
      };
      
      // Gérer les time windows - AJUSTER au lieu d'ignorer
      if (firstPkg.timeWindowStart && firstPkg.timeWindowEnd) {
        let twStart = timeToMinutes(firstPkg.timeWindowStart);
        let twEnd = timeToMinutes(firstPkg.timeWindowEnd);
        
        // Ajuster le créneau pour qu'il soit dans la plage globale
        // Si le début est avant le départ, on décale au départ
        if (twStart < globalStartMinutes) {
          console.log(`📌 Créneau ${firstPkg.timeWindowStart}-${firstPkg.timeWindowEnd}: début ajusté → ${minutesToTime(globalStartMinutes)} pour ${sg.contactName}`);
          twStart = globalStartMinutes;
        }
        // Si la fin est après la fermeture, on limite à la fermeture
        if (twEnd > globalEndMinutes) {
          console.log(`📌 Créneau ${firstPkg.timeWindowStart}-${firstPkg.timeWindowEnd}: fin ajustée → ${minutesToTime(globalEndMinutes)} pour ${sg.contactName}`);
          twEnd = globalEndMinutes;
        }
        
        // Vérifier que le créneau ajusté est encore valide (au moins 15 min)
        if (twEnd > twStart + 15) {
          shipment.deliveries[0].timeWindows = [{
            startTime: timeToISO(minutesToTime(twStart), date),
            endTime: timeToISO(minutesToTime(twEnd), date)
          }];
        } else {
          // Créneau trop court après ajustement → pas de contrainte horaire
          console.warn(`⚠️ Créneau ${firstPkg.timeWindowStart}-${firstPkg.timeWindowEnd} impossible (fin avant départ) pour ${sg.contactName} — livraison sans contrainte`);
        }
      }
      
      return shipment;
    });
    
    const vehicles = driversVehicles.map((dv) => ({
      startLocation: {
        latitude: hubCoords!.lat, longitude: hubCoords!.lng
      },
      endLocation: {
        latitude: hubCoords!.lat, longitude: hubCoords!.lng
      },
      label: `${dv.driver.firstName} ${dv.driver.lastName}${dv.vehicle ? ` (${dv.vehicle.plate})` : ''}`
    }));
    
    const model: GMPROModel = {
      shipments,
      vehicles,
      globalStartTime: timeToISO(departureTime, date),
      globalEndTime: timeToISO(hub.closingTime || '20:00', date)
    };
    
    // 6. Appeler GMPRO via Cloud Function
    console.log(`📡 GMPRO REQUEST:`);
    console.log(`   - ${shipments.length} shipments (stops)`);
    console.log(`   - ${vehicles.length} véhicules`);
    console.log(`   - Plage horaire: ${model.globalStartTime} → ${model.globalEndTime}`);
    console.log(`   - Shipments:`, JSON.stringify(shipments, null, 2));
    console.log(`   - Vehicles:`, JSON.stringify(vehicles, null, 2));
    
    let gmproResult: GMPROResult;
    try {
      gmproResult = await optimizeToursCF(model);
      console.log('📡 GMPRO RESPONSE COMPLÈTE:', JSON.stringify(gmproResult, null, 2));
      
      // Debug détaillé
      if (gmproResult.routes) {
        for (let i = 0; i < gmproResult.routes.length; i++) {
          const route = gmproResult.routes[i];
          console.log(`   Route ${i}: vehicleIndex=${route.vehicleIndex}, visits=${route.visits?.length || 0}, distance=${route.metrics?.travelDistanceMeters || 0}m`);
        }
      }
      if (gmproResult.metrics?.skippedMandatoryShipmentCount) {
        console.warn(`⚠️ GMPRO a skippé ${gmproResult.metrics.skippedMandatoryShipmentCount} shipments!`);
      }
    } catch (err: any) {
      console.error('❌ GMPRO erreur:', err.message);
      // Ne pas utiliser le fallback automatiquement - remonter l'erreur
      throw err;
    }
    
    // 7. Parser les résultats
    if (!gmproResult.routes || gmproResult.routes.length === 0) {
      console.error('❌ GMPRO: aucune route retournée');
      return {
        success: false, tours: [], totalDistance: 0, totalDuration: 0,
        totalPackages: 0, skippedShipments: validStops.length,
        error: 'GMPRO n\'a retourné aucune route. Vérifiez les logs console (F12).', 
        method: 'gmpro'
      };
    }
    
    const tours: TourResult[] = [];
    
    for (const route of gmproResult.routes) {
      const vehicleIdx = route.vehicleIndex || 0;
      const dv = driversVehicles[vehicleIdx];
      
      // Log si route sans visits
      if (!route.visits || route.visits.length === 0) {
        console.warn(`GMPRO: Route ${vehicleIdx} sans visits (${dv?.driver?.firstName || 'N/A'})`);
        continue;
      }
      
      if (!dv) continue;
      
      const stops: MissionStop[] = [];
      let tourPackageCount = 0;
      
      for (let i = 0; i < route.visits.length; i++) {
        const visit = route.visits[i];
        const sg = validStops[visit.shipmentIndex];
        if (!sg) continue;
        
        const firstPkg = sg.packages[0];
        
        stops.push({
          id: `stop-${Date.now()}-${vehicleIdx}-${i}`,
          sequence: i + 1,
          type: 'DELIVERY',
          address: firstPkg.address,
          city: firstPkg.city,
          postalCode: firstPkg.postalCode,
          coordinates: sg.coords,
          floor: firstPkg.floor,
          hasElevator: firstPkg.hasElevator,
          contactName: firstPkg.contactName,
          contactPhone: firstPkg.contactPhone,
          packageIds: sg.packages.map(p => p.id),
          packageCount: sg.packages.length,
          timeWindowStart: firstPkg.timeWindowStart,
          timeWindowEnd: firstPkg.timeWindowEnd,
          serviceTime: Math.max(5, sg.packages.length * 5),
          status: StopStatus.PENDING,
          estimatedArrival: visit.startTime
        });
        
        tourPackageCount += sg.packages.length;
      }
      
      const distanceKm = route.metrics?.travelDistanceMeters
        ? route.metrics.travelDistanceMeters / 1000
        : estimateDistanceForStops(stops, hubCoords!);
      
      const durationMin = route.metrics?.travelDuration
        ? parseInt(route.metrics.travelDuration.replace('s', '')) / 60
        : estimateDurationForStops(stops, hubCoords!);
      
      tours.push({
        vehicleIndex: vehicleIdx,
        driverId: dv.driver.id,
        driverName: `${dv.driver.firstName} ${dv.driver.lastName}`,
        vehicleId: dv.vehicle?.id,
        vehiclePlate: dv.vehicle?.plate,
        stops,
        totalDistance: Math.round(distanceKm * 10) / 10,
        estimatedDuration: Math.round(durationMin),
        packageCount: tourPackageCount
      });
    }
    
    const skippedCount = gmproResult.metrics?.skippedMandatoryShipmentCount || 0;
    
    // Vérifier si des stops ont été routés
    const totalRoutedPackages = tours.reduce((s, t) => s + t.packageCount, 0);
    if (totalRoutedPackages === 0 && validStops.length > 0) {
      console.error(`❌ GMPRO a skippé tous les ${validStops.length} shipments!`);
      console.error('   Vérifiez: time windows, coordonnées, plage horaire globale');
      return {
        success: false, tours: [], totalDistance: 0, totalDuration: 0,
        totalPackages: 0, skippedShipments: validStops.length,
        error: `GMPRO a skippé tous les ${validStops.length} stops. Vérifiez les contraintes horaires ou les coordonnées dans la console (F12).`, 
        method: 'gmpro'
      };
    }
    
    return {
      success: true,
      tours,
      totalDistance: Math.round(tours.reduce((s, t) => s + t.totalDistance, 0) * 10) / 10,
      totalDuration: Math.round(tours.reduce((s, t) => s + t.estimatedDuration, 0)),
      totalPackages: tours.reduce((s, t) => s + t.packageCount, 0),
      skippedShipments: skippedCount,
      method: 'gmpro',
      error: skippedCount > 0 ? `${skippedCount} livraison(s) non assignée(s)` : undefined
    };
    
  } catch (error) {
    console.error('Erreur optimisation:', error);
    return {
      success: false, tours: [], totalDistance: 0, totalDuration: 0,
      totalPackages: 0, skippedShipments: 0,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
      method: 'fallback'
    };
  }
};

// ============================================================================
// FALLBACK: RÉPARTITION GÉOGRAPHIQUE
// ============================================================================

const createFallbackOptimization = (
  stopGroups: StopGroup[],
  driversVehicles: DriverVehicle[],
  hubCoords: { lat: number; lng: number } | null
): OptimizationResult => {
  const n = driversVehicles.length;
  
  if (n === 0 || stopGroups.length === 0) {
    return {
      success: false, tours: [], totalDistance: 0, totalDuration: 0,
      totalPackages: 0, skippedShipments: 0,
      error: 'Aucun chauffeur ou colis', method: 'fallback'
    };
  }
  
  // Trier par latitude (nord→sud)
  const sorted = [...stopGroups].sort((a, b) => {
    if (a.coords && b.coords) return b.coords.lat - a.coords.lat;
    return 0;
  });
  
  const stopsPerDriver = Math.ceil(sorted.length / n);
  const tours: TourResult[] = [];
  
  for (let i = 0; i < n; i++) {
    const dv = driversVehicles[i];
    const driverStops = sorted.slice(i * stopsPerDriver, (i + 1) * stopsPerDriver);
    if (driverStops.length === 0) continue;
    
    const stops: MissionStop[] = driverStops.map((sg, idx) => {
      const firstPkg = sg.packages[0];
      return {
        id: `stop-${Date.now()}-${i}-${idx}`,
        sequence: idx + 1,
        type: 'DELIVERY' as const,
        address: firstPkg.address,
        city: firstPkg.city,
        postalCode: firstPkg.postalCode,
        coordinates: sg.coords,
        floor: firstPkg.floor,
        hasElevator: firstPkg.hasElevator,
        contactName: firstPkg.contactName,
        contactPhone: firstPkg.contactPhone,
        packageIds: sg.packages.map(p => p.id),
        packageCount: sg.packages.length,
        timeWindowStart: firstPkg.timeWindowStart,
        timeWindowEnd: firstPkg.timeWindowEnd,
        serviceTime: Math.max(5, sg.packages.length * 5),
        status: StopStatus.PENDING
      };
    });
    
    tours.push({
      vehicleIndex: i,
      driverId: dv.driver.id,
      driverName: `${dv.driver.firstName} ${dv.driver.lastName}`,
      vehicleId: dv.vehicle?.id,
      vehiclePlate: dv.vehicle?.plate,
      stops,
      totalDistance: estimateDistanceForStops(stops, hubCoords || { lat: 0, lng: 0 }),
      estimatedDuration: estimateDurationForStops(stops, hubCoords || { lat: 0, lng: 0 }),
      packageCount: stops.reduce((s, st) => s + st.packageCount, 0)
    });
  }
  
  return {
    success: true,
    tours,
    totalDistance: Math.round(tours.reduce((s, t) => s + t.totalDistance, 0) * 10) / 10,
    totalDuration: Math.round(tours.reduce((s, t) => s + t.estimatedDuration, 0)),
    totalPackages: tours.reduce((s, t) => s + t.packageCount, 0),
    skippedShipments: 0,
    error: 'Répartition géographique (GMPRO non disponible)',
    method: 'fallback'
  };
};

// ============================================================================
// UTILITAIRES
// ============================================================================

const haversineDistance = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number => {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const estimateDistanceForStops = (
  stops: MissionStop[],
  hubCoords: { lat: number; lng: number }
): number => {
  if (stops.length === 0) return 0;
  const points: { lat: number; lng: number }[] = [];
  if (hubCoords.lat !== 0) points.push(hubCoords);
  for (const stop of stops) {
    if (stop.coordinates) points.push(stop.coordinates);
  }
  if (hubCoords.lat !== 0) points.push(hubCoords);
  
  if (points.length >= 2) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += haversineDistance(points[i - 1], points[i]);
    }
    return Math.round(total * 1.4 * 10) / 10;
  }
  return stops.length * 5;
};

const estimateDurationForStops = (
  stops: MissionStop[],
  hubCoords: { lat: number; lng: number }
): number => {
  const distKm = estimateDistanceForStops(stops, hubCoords);
  const travelMin = (distKm / 30) * 60;
  const serviceMin = stops.reduce((s, st) => s + st.serviceTime, 0);
  return Math.round(travelMin + serviceMin);
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
