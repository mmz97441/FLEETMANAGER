/**
 * VehicleDetail - Modal de détail véhicule utilisant Modal partagé
 */

import React, { useState, useMemo } from 'react';
import { Vehicle, VehicleStatus, FuelLog, MaintenanceLog } from '../types';
import { todayISO } from '../utils/date';
import { formatEuro } from '../utils/format';
import { Truck, Calendar, Gauge, AlertTriangle, ChevronLeft, Wrench, Droplet, ArrowRight, Download, Info } from 'lucide-react';
import Modal from './shared/Modal';

interface VehicleDetailProps {
  vehicle: Vehicle | null;
  logs?: FuelLog[]; 
  maintenanceLogs?: MaintenanceLog[]; 
  onClose: () => void;
}

const VehicleDetail: React.FC<VehicleDetailProps> = ({ vehicle, logs = [], maintenanceLogs = [], onClose }) => {
  const [showHistory, setShowHistory] = useState(false);

  // --- MERGE & SORT HISTORY ---
  const history = useMemo(() => {
    if (!vehicle) return [];
    
    const fuelEvents = logs
      .filter(l => l.vehicleId === vehicle.id)
      .map(l => ({
        id: l.id, date: l.date, type: 'Carburant', label: 'Plein Carburant',
        cost: l.cost + (l.adBlueCost || 0), mileage: l.mileage,
        detail: `${l.volume.toFixed(1)}L ${l.adBlueVolume ? `+ ${l.adBlueVolume}L AdBlue` : ''}`
      }));

    const maintEvents = maintenanceLogs
      .filter(m => m.vehicleId === vehicle.id)
      .map(m => ({
        id: m.id, date: m.date, type: 'Maintenance', label: m.type,
        cost: m.cost, mileage: m.mileageAtService, detail: m.description
      }));

    return [...fuelEvents, ...maintEvents].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [vehicle, logs, maintenanceLogs]);

  // --- EXPORT CSV ---
  const downloadCSV = () => {
    if (!vehicle || history.length === 0) return;
    const headers = ["Date", "Catégorie", "Type", "Description", "Kilométrage", "Coût (€)"];
    const rows = history.map(row => [
      new Date(row.date).toLocaleDateString('fr-FR'), row.type, row.label,
      `"${row.detail.replace(/"/g, '""')}"`, row.mileage, row.cost.toFixed(2).replace('.', ',')
    ]);
    const csvContent = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Historique_${vehicle.plate}_${todayISO()}.csv`;
    link.click();
  };

  if (!vehicle) return null;

  // Header personnalisé avec bouton retour et export
  const customHeader = (
    <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
      <div className="flex items-center gap-4">
        {showHistory ? (
          <button onClick={() => setShowHistory(false)} className="bg-white p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-200 transition-colors">
            <ChevronLeft size={24} />
          </button>
        ) : (
          <div className="bg-brand-100 p-3 rounded-xl text-brand-600">
            <Truck size={28} />
          </div>
        )}
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">{vehicle.plate}</h2>
          <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
            <span>{vehicle.model}</span>
            {vehicle.year && <span className="bg-slate-200 text-slate-700 px-1.5 rounded text-xs">{vehicle.year}</span>}
          </div>
        </div>
      </div>
      
      {showHistory && history.length > 0 && (
        <button onClick={downloadCSV} title="Télécharger CSV" className="p-2 hover:bg-slate-200 text-brand-600 hover:text-brand-700 rounded-full transition-colors">
          <Download size={24} />
        </button>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="2xl"
      showCloseButton={true}
      headerClassName="hidden" // On utilise notre header custom
      bodyClassName="p-0"
    >
      {/* Custom Header */}
      {customHeader}
      
      {/* Content */}
      <div className="p-0 bg-white">
        {showHistory ? (
          // --- VIEW: HISTORY ---
          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
            {history.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Calendar size={48} className="mx-auto mb-2 opacity-50"/>
                <p>Aucun historique disponible pour ce véhicule.</p>
              </div>
            ) : (
              history.map((event) => (
                <div key={event.id} className="flex items-start gap-4 p-4 rounded-xl border border-slate-100 hover:border-brand-200 hover:bg-slate-50 transition-colors">
                  <div className={`mt-1 p-2 rounded-full flex-shrink-0 ${event.type === 'Carburant' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>
                    {event.type === 'Carburant' ? <Droplet size={18} /> : <Wrench size={18} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-slate-800 text-sm">{event.label}</h4>
                      <span className="text-xs font-bold text-slate-500">{new Date(event.date).toLocaleDateString('fr-FR')}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-1">{event.detail}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs font-medium bg-white px-2 py-1 rounded border border-slate-200 text-slate-600 flex items-center gap-1">
                        <Gauge size={12} /> {event.mileage.toLocaleString()} km
                      </span>
                      <span className="text-xs font-bold text-slate-800">{formatEuro(event.cost)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          // --- VIEW: DASHBOARD ---
          <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            {/* Infos Générales */}
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Informations</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-xs text-slate-500 block">Acquisition</span>
                    <span className="text-sm font-bold text-slate-800">{vehicle.acquisitionType || 'N/A'}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <span className="text-xs text-slate-500 block">Type</span>
                    <span className="text-sm font-bold text-slate-800">{vehicle.type || 'N/A'}</span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 col-span-2 flex justify-between items-center">
                    <div>
                      <span className="text-xs text-slate-500 block">Statut</span>
                      <span className={`text-sm font-bold ${vehicle.status === VehicleStatus.ACTIVE ? 'text-green-600' : 'text-orange-600'}`}>
                        {vehicle.status}
                      </span>
                    </div>
                    {vehicle.status === VehicleStatus.ISSUE && <AlertTriangle className="text-red-500" />}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Métriques</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="flex items-center gap-2 text-slate-600"><Gauge size={16}/> Kilométrage</span>
                    <span className="font-bold text-slate-800">{vehicle.currentMileage.toLocaleString()} km</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="flex items-center gap-2 text-slate-600"><Info size={16}/> Coût Mensuel</span>
                    <span className="font-bold text-slate-800">{formatEuro(vehicle.monthlyCost || 0)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Maintenance Section */}
            <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 h-fit">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Calendar size={20} className="text-brand-600"/> Maintenance
              </h3>
              
              <div className="space-y-4">
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-500">Intervalle</span>
                  <span className="font-medium text-slate-800">{vehicle.maintenanceInterval?.toLocaleString()} km</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-sm text-slate-500">Dernière Maint.</span>
                  <span className="font-medium text-slate-800">{vehicle.lastMaintenanceMileage?.toLocaleString()} km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Contrôle Tech.</span>
                  <span className={`font-medium ${!vehicle.technicalControlDate ? 'text-slate-400' : 'text-slate-800'}`}>
                    {vehicle.technicalControlDate ? new Date(vehicle.technicalControlDate).toLocaleDateString() : 'Non renseigné'}
                  </span>
                </div>
              </div>

              <button 
                onClick={() => setShowHistory(true)}
                className="w-full mt-6 bg-white border border-slate-300 text-slate-700 py-3 rounded-xl text-sm font-bold hover:bg-slate-100 hover:text-brand-700 hover:border-brand-300 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                Voir Historique Complet <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default VehicleDetail;
