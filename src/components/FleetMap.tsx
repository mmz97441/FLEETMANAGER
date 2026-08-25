import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Vehicle, VehicleStatus, VEHICLE_STATUS_COLORS } from '../types';

interface FleetMapProps {
  vehicles: Vehicle[];
  onVehicleSelect: (vehicleId: string) => void;
}

const FleetMap: React.FC<FleetMapProps> = ({ vehicles, onVehicleSelect }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (mapContainer.current && !mapInstance.current) {
      // Initialize map centered on France
      mapInstance.current = L.map(mapContainer.current).setView([46.603354, 1.888334], 6);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapInstance.current);
    }

    if (mapInstance.current) {
      // Clear existing markers (naive approach, for production use a LayerGroup)
      mapInstance.current.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
          mapInstance.current?.removeLayer(layer);
        }
      });

      // Add markers
      vehicles.forEach(vehicle => {
        // Fallback location if missing (simulating GPS for demo)
        const lat = vehicle.location?.lat || 46.603354 + (Math.random() - 0.5) * 5;
        const lng = vehicle.location?.lng || 1.888334 + (Math.random() - 0.5) * 5;

        // Couleur depuis le registre central (les 5 statuts, cf. types.ts) —
        // avant, seuls 3 étaient gérés (IDLE/IMMOBILIZED tombaient en gris).
        const getColor = (status: VehicleStatus) =>
            VEHICLE_STATUS_COLORS[status]?.hex ?? '#64748b';

        const markerHtml = `
            <div style="
                background-color: ${getColor(vehicle.status)};
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            "></div>
        `;

        const icon = L.divIcon({
            html: markerHtml,
            className: 'custom-div-icon',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        const marker = L.marker([lat, lng], { icon })
            .addTo(mapInstance.current!)
            .bindPopup(`
                <div class="font-sans">
                    <h3 class="font-bold text-slate-800">${vehicle.plate}</h3>
                    <p class="text-xs text-slate-500">${vehicle.model}</p>
                    <p class="text-xs font-semibold mt-1">${vehicle.status}</p>
                    <button id="btn-${vehicle.id}" class="mt-2 text-xs bg-sky-500 text-white px-2 py-1 rounded w-full">Détails</button>
                </div>
            `);
        
        marker.on('popupopen', () => {
            const btn = document.getElementById(`btn-${vehicle.id}`);
            if (btn) {
                btn.onclick = () => onVehicleSelect(vehicle.id);
            }
        });
      });
    }
  }, [vehicles, onVehicleSelect]);

  return (
    <div className="h-full w-full rounded-2xl overflow-hidden shadow-sm border border-slate-100 relative z-0">
        <div ref={mapContainer} className="h-full w-full bg-slate-100" />
        
        <div className="absolute top-4 right-4 bg-white p-4 rounded-xl shadow-lg z-[400] max-w-xs">
            <h3 className="font-bold text-slate-800 mb-2">Légende</h3>
            <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-500"></span>
                    <span>En Service</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                    <span>Maintenance</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500"></span>
                    <span>Problème / Alerte</span>
                </div>
            </div>
        </div>
    </div>
  );
};

export default FleetMap;
