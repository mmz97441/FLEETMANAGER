/**
 * SERVICE GMPRO - Google Route Optimization API
 * 
 * Optimise les tournées de livraison en calculant l'ordre optimal des stops
 */

import { Package, Zone, Hub, MissionStop, StopStatus } from '../types';

// Types pour l'API GMPRO
interface GMPROLocation {
  latLng: {
    latitude: number;
    longitude: number;
  };
}

interface GMPROTimeWindow {
  startTime: string; // Format ISO
  endTime: string;
}

interface GMPROShipment {
  deliveries: Array<{
    arrivalLocation: GMPROLocation;
    duration: string; // Format "300s" pour 5 minutes
    timeWindows?: GMPROTimeWindow[];
  }>;
  label: string;
}

interface GMPROVehicle {
  startLocation: GMPROLocation;
  endLocation: GMPROLocation;
  label: string;
}

interface GMPRORequest {
  model: {
    shipments: GMPROShipment[];
    vehicles: GMPROVehicle[];
    globalStartTime: string;
    globalEndTime: string;
  };
}

interface GMPROVisit {
  shipmentIndex: number;
  startTime: string;
}

interface GMPRORoute {
  vehicleIndex: number;
  visits: GMPROVisit[];
  metrics?: {
    totalDuration: string;
    travelDuration: string;
    travelDistanceMeters: number;
  };
}

interface GMPROResponse {
  routes: GMPRORoute[];
  metrics?: {
    totalCost: number;
  };
}

// Géocodage avec l'API Google Geocoding
export const geocodeAddress = async (
  address: string,
  city: string,
  postalCode: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> => {
  try {
    const fullAddress = `${address}, ${postalCode} ${city}, La Réunion, France`;
    const encodedAddress = encodeURIComponent(fullAddress);
    
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`
    );
    
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }
    
    console.warn(`Geocoding failed for: ${fullAddress}`, data.status);
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

// Géocoder plusieurs adresses en batch
export const geocodePackages = async (
  packages: Package[],
  apiKey: string
): Promise<Map<string, { lat: number; lng: number }>> => {
  const results = new Map<string, { lat: number; lng: number }>();
  
  // Éviter les doublons d'adresses
  const uniqueAddresses = new Map<string, Package>();
  for (const pkg of packages) {
    const key = `${pkg.address}|${pkg.postalCode}|${pkg.city}`;
    if (!uniqueAddresses.has(key)) {
      uniqueAddresses.set(key, pkg);
    }
  }
  
  // Géocoder chaque adresse unique (avec délai pour éviter rate limiting)
  for (const [key, pkg] of uniqueAddresses) {
    // Si le package a déjà des coordonnées, les utiliser
    if (pkg.coordinates) {
      results.set(key, pkg.coordinates);
      continue;
    }
    
    const coords = await geocodeAddress(pkg.address, pkg.city, pkg.postalCode, apiKey);
    if (coords) {
      results.set(key, coords);
    }
    
    // Petit délai pour éviter le rate limiting (100ms)
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
};

// Regrouper les packages par adresse (plusieurs colis = 1 stop)
export const groupPackagesByStop = (
  packages: Package[]
): Map<string, Package[]> => {
  const groups = new Map<string, Package[]>();
  
  for (const pkg of packages) {
    const key = `${pkg.address.toLowerCase().trim()}|${pkg.postalCode}|${pkg.city.toLowerCase().trim()}`;
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pkg);
  }
  
  return groups;
};

// Convertir l'heure locale en ISO pour GMPRO
const timeToISO = (time: string, date: string): string => {
  // time format: "08:00", date format: "2026-01-31"
  return `${date}T${time}:00Z`;
};

// Parser la durée GMPRO ("3600s") en minutes
const parseDuration = (duration: string): number => {
  const seconds = parseInt(duration.replace('s', ''));
  return Math.round(seconds / 60);
};

// Appeler l'API Route Optimization
export const optimizeRoute = async (
  packages: Package[],
  hub: Hub,
  date: string,
  apiKey: string
): Promise<{
  success: boolean;
  stops: MissionStop[];
  totalDistance: number;
  estimatedDuration: number;
  error?: string;
}> => {
  try {
    // 1. Géocoder les adresses si nécessaire
    const geocodedAddresses = await geocodePackages(packages, apiKey);
    
    // 2. Regrouper par stop
    const stopGroups = groupPackagesByStop(packages);
    
    // 3. Coordonnées du hub (point de départ et d'arrivée)
    let hubCoords = hub.coordinates;
    if (!hubCoords) {
      const geocoded = await geocodeAddress(hub.address, hub.city, hub.postalCode, apiKey);
      if (!geocoded) {
        // Fallback: créer la route sans optimisation géographique
        const stopMapping: Array<{ key: string; packages: Package[] }> = [];
        for (const [key, pkgs] of stopGroups) {
          stopMapping.push({ key, packages: pkgs });
        }
        const fallback = createFallbackRoute(stopMapping, { lat: 0, lng: 0 });
        return {
          ...fallback,
          error: 'Adresse du hub non géocodée — tournée non optimisée (ordre par défaut)'
        };
      }
      hubCoords = geocoded;
    }
    
    // 4. Construire les shipments
    const shipments: GMPROShipment[] = [];
    const stopMapping: Array<{ key: string; packages: Package[] }> = [];
    
    for (const [key, pkgs] of stopGroups) {
      const firstPkg = pkgs[0];
      const addressKey = `${firstPkg.address.toLowerCase().trim()}|${firstPkg.postalCode}|${firstPkg.city.toLowerCase().trim()}`;
      const coords = geocodedAddresses.get(addressKey) || firstPkg.coordinates;
      
      if (!coords) {
        console.warn(`Skipping stop without coordinates: ${firstPkg.address}`);
        continue;
      }
      
      // Calculer le temps de service (5 min par colis, min 5 min)
      const serviceTime = Math.max(5, pkgs.length * 5);
      
      const shipment: GMPROShipment = {
        deliveries: [{
          arrivalLocation: {
            latLng: {
              latitude: coords.lat,
              longitude: coords.lng
            }
          },
          duration: `${serviceTime * 60}s`
        }],
        label: `Stop ${shipments.length + 1}: ${firstPkg.contactName} (${pkgs.length} colis)`
      };
      
      // Ajouter les fenêtres horaires si définies
      if (firstPkg.timeWindowStart && firstPkg.timeWindowEnd) {
        shipment.deliveries[0].timeWindows = [{
          startTime: timeToISO(firstPkg.timeWindowStart, date),
          endTime: timeToISO(firstPkg.timeWindowEnd, date)
        }];
      }
      
      shipments.push(shipment);
      stopMapping.push({ key, packages: pkgs });
    }
    
    if (shipments.length === 0) {
      return {
        success: false,
        stops: [],
        totalDistance: 0,
        estimatedDuration: 0,
        error: 'Aucun stop valide à optimiser'
      };
    }
    
    // 5. Construire la requête GMPRO
    const request: GMPRORequest = {
      model: {
        shipments,
        vehicles: [{
          startLocation: {
            latLng: {
              latitude: hubCoords.lat,
              longitude: hubCoords.lng
            }
          },
          endLocation: {
            latLng: {
              latitude: hubCoords.lat,
              longitude: hubCoords.lng
            }
          },
          label: `Véhicule ${hub.zone}`
        }],
        globalStartTime: timeToISO(hub.openingTime || '07:00', date),
        globalEndTime: timeToISO(hub.closingTime || '20:00', date)
      }
    };
    
    // 6. Appeler l'API
    const response = await fetch(
      `https://routeoptimization.googleapis.com/v1/projects/${getProjectId()}:optimizeTours`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-Goog-Api-Key': apiKey
        },
        body: JSON.stringify(request)
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('GMPRO API error:', errorData);
      
      // Fallback: retourner les stops dans l'ordre d'origine
      return createFallbackRoute(stopMapping, hubCoords);
    }
    
    const data: GMPROResponse = await response.json();
    
    // 7. Parser la réponse et créer les MissionStops
    if (!data.routes || data.routes.length === 0 || !data.routes[0].visits) {
      return createFallbackRoute(stopMapping, hubCoords);
    }
    
    const route = data.routes[0];
    const stops: MissionStop[] = [];
    
    for (let i = 0; i < route.visits.length; i++) {
      const visit = route.visits[i];
      const mapping = stopMapping[visit.shipmentIndex];
      const firstPkg = mapping.packages[0];
      const addressKey = `${firstPkg.address.toLowerCase().trim()}|${firstPkg.postalCode}|${firstPkg.city.toLowerCase().trim()}`;
      const coords = geocodedAddresses.get(addressKey) || firstPkg.coordinates;
      
      const stop: MissionStop = {
        id: `stop-${Date.now()}-${i}`,
        sequence: i + 1,
        type: 'DELIVERY',
        address: firstPkg.address,
        city: firstPkg.city,
        postalCode: firstPkg.postalCode,
        coordinates: coords,
        floor: firstPkg.floor,
        hasElevator: firstPkg.hasElevator,
        contactName: firstPkg.contactName,
        contactPhone: firstPkg.contactPhone,
        packageIds: mapping.packages.map(p => p.id),
        packageCount: mapping.packages.length,
        timeWindowStart: firstPkg.timeWindowStart,
        timeWindowEnd: firstPkg.timeWindowEnd,
        serviceTime: Math.max(5, mapping.packages.length * 5),
        status: StopStatus.PENDING,
        estimatedArrival: visit.startTime
      };
      
      stops.push(stop);
    }
    
    // Calculer les métriques
    const totalDistance = route.metrics?.travelDistanceMeters 
      ? route.metrics.travelDistanceMeters / 1000 
      : estimateDistance(stops);
    const estimatedDuration = route.metrics?.totalDuration 
      ? parseDuration(route.metrics.totalDuration)
      : estimateDuration(stops);
    
    return {
      success: true,
      stops,
      totalDistance,
      estimatedDuration
    };
    
  } catch (error) {
    console.error('Route optimization error:', error);
    return {
      success: false,
      stops: [],
      totalDistance: 0,
      estimatedDuration: 0,
      error: error instanceof Error ? error.message : 'Erreur inconnue'
    };
  }
};

// Créer une route fallback (sans optimisation)
const createFallbackRoute = (
  stopMapping: Array<{ key: string; packages: Package[] }>,
  hubCoords: { lat: number; lng: number }
): {
  success: boolean;
  stops: MissionStop[];
  totalDistance: number;
  estimatedDuration: number;
  error?: string;
} => {
  const stops: MissionStop[] = stopMapping.map((mapping, i) => {
    const firstPkg = mapping.packages[0];
    return {
      id: `stop-${Date.now()}-${i}`,
      sequence: i + 1,
      type: 'DELIVERY' as const,
      address: firstPkg.address,
      city: firstPkg.city,
      postalCode: firstPkg.postalCode,
      coordinates: firstPkg.coordinates,
      floor: firstPkg.floor,
      hasElevator: firstPkg.hasElevator,
      contactName: firstPkg.contactName,
      contactPhone: firstPkg.contactPhone,
      packageIds: mapping.packages.map(p => p.id),
      packageCount: mapping.packages.length,
      timeWindowStart: firstPkg.timeWindowStart,
      timeWindowEnd: firstPkg.timeWindowEnd,
      serviceTime: Math.max(5, mapping.packages.length * 5),
      status: StopStatus.PENDING
    };
  });
  
  return {
    success: true,
    stops,
    totalDistance: estimateDistance(stops),
    estimatedDuration: estimateDuration(stops),
    error: 'Route non optimisée (fallback)'
  };
};

// Estimer la distance (fallback si GMPRO échoue)
const estimateDistance = (stops: MissionStop[]): number => {
  // Estimation grossière: 5km entre chaque stop
  return stops.length * 5;
};

// Estimer la durée (fallback si GMPRO échoue)
const estimateDuration = (stops: MissionStop[]): number => {
  // Estimation: 10 min de trajet + temps de service par stop
  const travelTime = stops.length * 10;
  const serviceTime = stops.reduce((acc, s) => acc + s.serviceTime, 0);
  return travelTime + serviceTime;
};

// Récupérer l'ID du projet Google Cloud
const getProjectId = (): string => {
  // À configurer via variable d'environnement
  return import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_ID || 'fleetgenius-app';
};

// Obtenir la clé API
export const getGoogleMapsApiKey = (): string => {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
};

// Vérifier si l'API est configurée
export const isGMPROConfigured = (): boolean => {
  return !!getGoogleMapsApiKey();
};
