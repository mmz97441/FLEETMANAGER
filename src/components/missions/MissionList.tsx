/**
 * MISSION LIST
 *
 * Displays the list of missions with expandable stop details,
 * stop editing/deletion/reordering, and add-stop functionality.
 * Extracted from MissionManager.tsx
 */

import React, { useState } from 'react';
import {
  Mission, MissionStatus, MissionStop, StopStatus, Package, PackageStatus,
  Zone, User, ZONE_COLORS, MISSION_STATUS_COLORS
} from '../../types';
import { updateMissionFields, updatePackageStatus, updatePackageFields } from '../../services/missionService';
import { logActivity } from '../../services/activityLogService';
import { ActivityAction } from '../../types';
import StopReorderModal from '../StopReorderModal';
import PODViewer from '../PODViewer';
import {
  Package as PackageIcon, MapPin, Clock,
  ChevronRight, ChevronDown,
  XCircle, Search, Edit, Trash2, Plus,
  Route, Loader2, Building2, Navigation,
  Printer, ArrowUp, ArrowDown, GripVertical, Phone,
  Truck, CheckCircle
} from 'lucide-react';

interface MissionListProps {
  missions: Mission[];
  packages: Package[];
  todayPackages: Package[];
  currentUser: User;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedZone: Zone | 'all';
  setSelectedZone: (zone: Zone | 'all') => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}

const MissionList: React.FC<MissionListProps> = ({
  missions,
  packages,
  todayPackages,
  currentUser,
  searchTerm,
  setSearchTerm,
  selectedZone,
  setSelectedZone,
  selectedDate,
  setSelectedDate
}) => {
  const [expandedMissionId, setExpandedMissionId] = useState<string | null>(null);
  const [isSavingPkg, setIsSavingPkg] = useState(false);

  // Stop edit/delete/add state
  const [editingStop, setEditingStop] = useState<{ mission: Mission; stop: MissionStop } | null>(null);
  const [editStopForm, setEditStopForm] = useState<Record<string, any>>({});
  const [deletingStop, setDeletingStop] = useState<{ mission: Mission; stop: MissionStop } | null>(null);
  const [addingStopToMission, setAddingStopToMission] = useState<Mission | null>(null);
  const [newStopForm, setNewStopForm] = useState<Record<string, any>>({});

  // Reorder
  const [reorderingMission, setReorderingMission] = useState<Mission | null>(null);

  // POD Viewer
  const [viewingPOD, setViewingPOD] = useState<{ pod: any; pkg: Package } | null>(null);

  // Filter missions
  const filteredMissions = React.useMemo(() => {
    let result = missions;
    if (selectedZone !== 'all') {
      result = result.filter(m => m.zone === selectedZone);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(m =>
        m.driverName?.toLowerCase().includes(term) ||
        m.vehiclePlate?.toLowerCase().includes(term) ||
        m.hubName.toLowerCase().includes(term)
      );
    }
    return result;
  }, [missions, selectedZone, searchTerm]);

  // === PRINT ===
  const handlePrintMission = (mission: Mission) => {
    const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const stopsHtml = sortedStops.map((stop, i) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${stop.sequence}</td>
        <td style="padding:8px;border:1px solid #ddd;">
          <strong>${stop.contactName || '-'}</strong><br/>
          <span style="color:#555;">${stop.address}, ${stop.postalCode} ${stop.city}</span>
          ${stop.floor != null ? `<br/><small>Étage ${stop.floor}${stop.hasElevator ? ' (ascenseur)' : ' (sans asc.)'}</small>` : ''}
        </td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${stop.contactPhone || '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${stop.packageCount}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${stop.timeWindowStart && stop.timeWindowEnd ? `${stop.timeWindowStart} - ${stop.timeWindowEnd}` : '-'}</td>
        <td style="padding:8px;border:1px solid #ddd;font-size:11px;">${stop.notes || ''}</td>
        <td style="padding:8px;border:1px solid #ddd;width:60px;"></td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tournée - ${mission.driverName} - ${mission.date}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 3px solid #333; padding-bottom: 12px; }
          .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px; }
          .meta-item { background: #f5f5f5; padding: 8px 12px; border-radius: 4px; }
          .meta-label { font-size: 10px; text-transform: uppercase; color: #888; }
          .meta-value { font-size: 14px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th { background: #333; color: white; padding: 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
          tr:nth-child(even) { background: #f9f9f9; }
          .hub-row { background: #e8f0fe !important; font-weight: bold; }
          .signature-block { margin-top: 30px; display: flex; justify-content: space-between; }
          .signature-box { border: 1px solid #ccc; padding: 12px; width: 45%; text-align: center; }
          .signature-label { font-size: 11px; color: #888; margin-bottom: 40px; }
          .footer { margin-top: 20px; text-align: center; font-size: 10px; color: #aaa; }
          @media print {
            body { padding: 10px; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>🚛 Feuille de Route</h1>
            <p style="color:#666;">Tournée ${mission.zone} — ${new Date(mission.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <div style="text-align:right;">
            <p style="font-size:12px;color:#888;">Imprimé le ${new Date().toLocaleString('fr-FR')}</p>
            <button class="no-print" onclick="window.print()" style="margin-top:8px;padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">
              🖨️ Imprimer
            </button>
          </div>
        </div>

        <div class="meta">
          <div class="meta-item">
            <div class="meta-label">Chauffeur</div>
            <div class="meta-value">${mission.driverName || 'Non assigné'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Véhicule</div>
            <div class="meta-value">${mission.vehiclePlate || '-'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Hub de départ</div>
            <div class="meta-value">${mission.hubName || '-'}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Nombre de stops</div>
            <div class="meta-value">${sortedStops.length}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Total colis</div>
            <div class="meta-value">${mission.totalPackages}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Distance / Durée estimée</div>
            <div class="meta-value">${mission.totalDistance ? Math.round(mission.totalDistance) + ' km' : '-'} / ${mission.estimatedDuration ? Math.round(mission.estimatedDuration) + ' min' : '-'}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:40px;">N°</th>
              <th>Adresse / Contact</th>
              <th style="width:110px;">Téléphone</th>
              <th style="width:50px;">Colis</th>
              <th style="width:110px;">Créneau</th>
              <th>Notes</th>
              <th style="width:60px;">Signat.</th>
            </tr>
          </thead>
          <tbody>
            <tr class="hub-row">
              <td style="padding:8px;border:1px solid #ddd;text-align:center;">🏁</td>
              <td colspan="6" style="padding:8px;border:1px solid #ddd;">DÉPART — ${mission.hubName}</td>
            </tr>
            ${stopsHtml}
            <tr class="hub-row">
              <td style="padding:8px;border:1px solid #ddd;text-align:center;">🏁</td>
              <td colspan="6" style="padding:8px;border:1px solid #ddd;">RETOUR — ${mission.hubName}</td>
            </tr>
          </tbody>
        </table>

        <div class="signature-block">
          <div class="signature-box">
            <div class="signature-label">Signature Chauffeur (départ)</div>
            <div style="border-bottom:1px solid #ccc;margin-bottom:8px;height:40px;"></div>
            <small>Heure de départ : ___________</small>
          </div>
          <div class="signature-box">
            <div class="signature-label">Signature Chauffeur (retour)</div>
            <div style="border-bottom:1px solid #ccc;margin-bottom:8px;height:40px;"></div>
            <small>Heure de retour : ___________</small>
          </div>
        </div>

        <div class="footer">
          FleetGenius — Feuille de route générée automatiquement
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  // === STOP REORDER SAVE ===
  const handleSaveReorderedStops = async (mission: Mission, newStops: MissionStop[]) => {
    try {
      await updateMissionFields(mission.id, { stops: newStops });
      await logActivity({
        userId: currentUser.id,
        userEmail: currentUser.email,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        action: ActivityAction.MISSION_UPDATED,
        targetType: 'mission',
        targetId: mission.id,
        targetName: `Tournée ${mission.driverName || 'Non assigné'}`,
        details: `Ordre des stops modifié manuellement (${newStops.length} stops)`
      });
      console.log('✅ Ordre des stops sauvegardé');
    } catch (error) {
      console.error('❌ Erreur sauvegarde ordre:', error);
      throw error;
    }
  };

  // === STOP MOVEMENT ===
  const handleMoveStopUp = async (mission: Mission, stop: MissionStop) => {
    const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
    const currentIndex = sortedStops.findIndex(s => s.id === stop.id);
    if (currentIndex <= 0) return;

    setIsSavingPkg(true);
    try {
      const prevStop = sortedStops[currentIndex - 1];
      const updatedStops = mission.stops.map(s => {
        if (s.id === stop.id) return { ...s, sequence: prevStop.sequence };
        if (s.id === prevStop.id) return { ...s, sequence: stop.sequence };
        return s;
      });

      await updateMissionFields(mission.id, { stops: updatedStops });
      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} déplacé vers le haut`] }
      });
    } catch (err) {
      console.error('Erreur déplacement stop:', err);
    }
    setIsSavingPkg(false);
  };

  const handleMoveStopDown = async (mission: Mission, stop: MissionStop) => {
    const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);
    const currentIndex = sortedStops.findIndex(s => s.id === stop.id);
    if (currentIndex >= sortedStops.length - 1) return;

    setIsSavingPkg(true);
    try {
      const nextStop = sortedStops[currentIndex + 1];
      const updatedStops = mission.stops.map(s => {
        if (s.id === stop.id) return { ...s, sequence: nextStop.sequence };
        if (s.id === nextStop.id) return { ...s, sequence: stop.sequence };
        return s;
      });

      await updateMissionFields(mission.id, { stops: updatedStops });
      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} déplacé vers le bas`] }
      });
    } catch (err) {
      console.error('Erreur déplacement stop:', err);
    }
    setIsSavingPkg(false);
  };

  // === DELETE STOP ===
  const handleDeleteStop = async () => {
    if (!deletingStop) return;
    const { mission, stop } = deletingStop;

    setIsSavingPkg(true);
    try {
      const updatedStops = mission.stops
        .filter(s => s.id !== stop.id)
        .map((s, idx) => ({ ...s, sequence: idx + 1 }));

      const totalPackages = updatedStops.reduce((sum, s) => sum + s.packageCount, 0);

      await updateMissionFields(mission.id, {
        stops: updatedStops,
        totalPackages
      });

      for (const pkgId of stop.packageIds) {
        try {
          const pkg = packages.find(p => p.id === pkgId);
          if (pkg && (pkg.status === PackageStatus.SORTED || pkg.status === PackageStatus.LOADED || pkg.status === PackageStatus.IN_DELIVERY)) {
            await updatePackageStatus(pkgId, PackageStatus.RETURN_REQUESTED, {
              action: 'STOP_DELETED',
              driverId: currentUser.id,
              driverName: `${currentUser.firstName} ${currentUser.lastName}`,
              notes: `Stop supprimé par ${currentUser.firstName} — À retourner au hub ${mission.hubName}`
            });
            await updatePackageFields(pkgId, {
              returnReason: `Stop supprimé de la tournée ${mission.zone} — Retourner au hub ${mission.hubName}`
            });
          }
        } catch (e) { console.warn('Erreur marquage retour colis:', pkgId, e); }
      }

      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} supprimé (${stop.packageCount} colis à retourner)`] }
      });

      setDeletingStop(null);
    } catch (err) {
      console.error('Erreur suppression stop:', err);
    }
    setIsSavingPkg(false);
  };

  // === EDIT STOP ===
  const handleSaveEditStop = async () => {
    if (!editingStop) return;
    const { mission, stop } = editingStop;

    setIsSavingPkg(true);
    try {
      const updatedStops = mission.stops.map(s => {
        if (s.id !== stop.id) return s;
        return {
          ...s,
          contactName: editStopForm.contactName || s.contactName,
          contactPhone: editStopForm.contactPhone || null,
          address: editStopForm.address || s.address,
          city: editStopForm.city || s.city,
          postalCode: editStopForm.postalCode || s.postalCode,
          timeWindowStart: editStopForm.timeWindowStart || null,
          timeWindowEnd: editStopForm.timeWindowEnd || null,
          notes: editStopForm.notes || null,
          serviceTime: parseInt(editStopForm.serviceTime) || s.serviceTime
        };
      });

      await updateMissionFields(mission.id, { stops: updatedStops });

      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Stop ${stop.contactName} modifié`] }
      });

      setEditingStop(null);
    } catch (err) {
      console.error('Erreur modification stop:', err);
    }
    setIsSavingPkg(false);
  };

  // === ADD NEW STOP ===
  const handleAddNewStop = async () => {
    if (!addingStopToMission) return;
    const mission = addingStopToMission;

    if (!newStopForm.contactName || !newStopForm.address || !newStopForm.city || !newStopForm.postalCode) {
      alert('Veuillez remplir au minimum : destinataire, adresse, ville et code postal');
      return;
    }

    setIsSavingPkg(true);
    try {
      const newStopId = `stop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const maxSequence = Math.max(...mission.stops.map(s => s.sequence), 0);

      const newStop: MissionStop = {
        id: newStopId,
        sequence: maxSequence + 1,
        type: 'DELIVERY',
        address: newStopForm.address,
        city: newStopForm.city,
        postalCode: newStopForm.postalCode,
        contactName: newStopForm.contactName,
        contactPhone: newStopForm.contactPhone || undefined,
        packageIds: [],
        packageCount: 0,
        timeWindowStart: newStopForm.timeWindowStart || undefined,
        timeWindowEnd: newStopForm.timeWindowEnd || undefined,
        serviceTime: parseInt(newStopForm.serviceTime) || 5,
        notes: newStopForm.notes || undefined,
        status: StopStatus.PENDING
      };

      const updatedStops = [...mission.stops, newStop];

      await updateMissionFields(mission.id, { stops: updatedStops });

      await logActivity({
        type: 'MISSION_UPDATED',
        userId: currentUser.id,
        userName: `${currentUser.firstName} ${currentUser.lastName}`,
        target: `Mission ${mission.zone}`,
        details: { changes: [`Nouveau stop ajouté: ${newStopForm.contactName}`] }
      });

      setAddingStopToMission(null);
      setNewStopForm({});
    } catch (err) {
      console.error('Erreur ajout stop:', err);
    }
    setIsSavingPkg(false);
  };

  return (
    <>
      <div className="space-y-6">
        {/* Filtres */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par chauffeur, véhicule..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>

          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value as Zone | 'all')}
            className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none bg-white font-medium"
          >
            <option value="all">Toutes les zones</option>
            {Object.values(Zone).map(zone => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>

        {/* Liste des missions */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {filteredMissions.length === 0 ? (
            <div className="p-8 text-center">
              <Route size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500">Aucune mission pour cette date</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredMissions.map(mission => {
                const zoneColors = ZONE_COLORS[mission.zone];
                const statusColors = MISSION_STATUS_COLORS[mission.status];
                const progress = mission.totalPackages > 0
                  ? Math.round(((mission.deliveredPackages || 0) / mission.totalPackages) * 100)
                  : 0;
                const isExpanded = expandedMissionId === mission.id;
                const sortedStops = [...mission.stops].sort((a, b) => a.sequence - b.sequence);

                return (
                  <div key={mission.id}>
                    {/* En-tête mission (cliquable) */}
                    <div
                      className="p-4 hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => setExpandedMissionId(isExpanded ? null : mission.id)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="flex items-center gap-2 mt-1">
                            {isExpanded
                              ? <ChevronDown size={18} className="text-brand-500" />
                              : <ChevronRight size={18} className="text-slate-400" />
                            }
                            <div className={`w-3 h-3 rounded-full ${zoneColors.dot}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-bold text-slate-800">
                                {mission.driverName || 'Non assigné'}
                              </p>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors.bg} ${statusColors.text}`}>
                                {mission.status}
                              </span>
                            </div>
                            <p className="text-sm text-slate-500">
                              {mission.vehiclePlate || 'Pas de véhicule'} • {mission.hubName}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-sm">
                              <span className="flex items-center gap-1 text-slate-600">
                                <MapPin size={14} />
                                {mission.stops.length} stops
                              </span>
                              <span className="flex items-center gap-1 text-slate-600">
                                <PackageIcon size={14} />
                                {mission.totalPackages} colis
                              </span>
                              {mission.totalDistance != null && (
                                <span className="flex items-center gap-1 text-slate-600">
                                  <Navigation size={14} />
                                  {Math.round(mission.totalDistance)} km
                                </span>
                              )}
                              {mission.estimatedDuration != null && (
                                <span className="flex items-center gap-1 text-slate-600">
                                  <Clock size={14} />
                                  {Math.round(mission.estimatedDuration)} min
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right flex flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePrintMission(mission); }}
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                              title="Imprimer la feuille de route"
                            >
                              <Printer size={16} />
                            </button>
                            <p className="text-2xl font-bold text-slate-800">{progress}%</p>
                          </div>
                          <p className="text-xs text-slate-500">
                            {mission.deliveredPackages || 0} livrés
                          </p>
                          {mission.failedPackages > 0 && (
                            <p className="text-xs text-red-500">
                              {mission.failedPackages} échecs
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Barre de progression */}
                      <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Détail de la tournée (expandable) */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-200">
                        {/* Résumé de la tournée */}
                        <div className="px-4 py-3 bg-slate-100 border-b border-slate-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-6 text-sm">
                              <span className="font-semibold text-slate-700">
                                Itinéraire de la tournée
                              </span>
                              {mission.dispatchedAt && (
                                <span className="text-slate-500">
                                  Dispatché le {new Date(mission.dispatchedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                  {mission.dispatchedByName ? ` par ${mission.dispatchedByName}` : ''}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                              {mission.status === MissionStatus.DISPATCHED && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setNewStopForm({});
                                    setAddingStopToMission(mission);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-green-700 hover:bg-green-100 hover:border-green-300 transition-colors text-xs font-medium"
                                  title="Ajouter un nouveau stop"
                                >
                                  <Plus size={14} />
                                  Ajouter stop
                                </button>
                              )}
                              {(mission.status === MissionStatus.DISPATCHED || mission.status === MissionStatus.IN_PROGRESS) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReorderingMission(mission);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-100 hover:border-amber-300 transition-colors text-xs font-medium"
                                  title="Réordonner les stops"
                                >
                                  <GripVertical size={14} />
                                  Réordonner
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handlePrintMission(mission); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 hover:border-blue-300 transition-colors text-xs font-medium"
                                title="Imprimer la feuille de route"
                              >
                                <Printer size={14} />
                                Imprimer
                              </button>
                              <span>{sortedStops.filter(s => s.status === 'Terminé').length}/{sortedStops.length} stops terminés</span>
                            </div>
                          </div>
                        </div>

                        {/* Départ Hub */}
                        <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-200">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">
                            <Building2 size={16} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-blue-700">🏁 Départ — {mission.hubName}</p>
                          </div>
                        </div>

                        {/* Liste des stops */}
                        {sortedStops.map((stop, index) => {
                          const stopStatusIcon =
                            stop.status === 'Terminé' ? <CheckCircle size={16} className="text-green-500" /> :
                            stop.status === 'Échec' ? <XCircle size={16} className="text-red-500" /> :
                            stop.status === 'Passé' ? <XCircle size={16} className="text-amber-500" /> :
                            stop.status === 'Arrivé' ? <Truck size={16} className="text-blue-500" /> :
                            <div className="w-4 h-4 rounded-full border-2 border-slate-300" />;

                          const stopBg =
                            stop.status === 'Terminé' ? 'bg-green-50' :
                            stop.status === 'Échec' ? 'bg-red-50' :
                            stop.status === 'Passé' ? 'bg-amber-50' :
                            stop.status === 'Arrivé' ? 'bg-blue-50' :
                            '';

                          return (
                            <div key={stop.id} className={`px-4 py-3 border-b border-slate-200 ${stopBg}`}>
                              <div className="flex items-start gap-3">
                                {/* Numéro du stop */}
                                <div className="flex flex-col items-center">
                                  <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                                    stop.status === 'Terminé' ? 'bg-green-100 text-green-700' :
                                    stop.status === 'Échec' ? 'bg-red-100 text-red-700' :
                                    'bg-slate-200 text-slate-600'
                                  }`}>
                                    {stop.sequence}
                                  </div>
                                  {index < sortedStops.length - 1 && (
                                    <div className="w-0.5 h-6 bg-slate-300 mt-1" />
                                  )}
                                </div>

                                {/* Détails du stop */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    {stopStatusIcon}
                                    <p className="font-semibold text-slate-800 truncate">
                                      {stop.contactName}
                                    </p>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      stop.status === 'Terminé' ? 'bg-green-100 text-green-700' :
                                      stop.status === 'Échec' ? 'bg-red-100 text-red-700' :
                                      stop.status === 'Passé' ? 'bg-amber-100 text-amber-700' :
                                      stop.status === 'Arrivé' ? 'bg-blue-100 text-blue-700' :
                                      'bg-slate-100 text-slate-600'
                                    }`}>
                                      {stop.status}
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-600">
                                    <MapPin size={12} className="inline mr-1" />
                                    {stop.address}, {stop.postalCode} {stop.city}
                                  </p>
                                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                                    <span className="flex items-center gap-1">
                                      <PackageIcon size={11} />
                                      {stop.packageCount} colis
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <Clock size={11} />
                                      ~{stop.serviceTime} min sur place
                                    </span>
                                    {stop.contactPhone && (
                                      <span className="flex items-center gap-1">
                                        <Phone size={11} />
                                        {stop.contactPhone}
                                      </span>
                                    )}
                                    {stop.floor != null && (
                                      <span>
                                        Étage {stop.floor}{stop.hasElevator ? ' (asc.)' : ''}
                                      </span>
                                    )}
                                  </div>
                                  {stop.timeWindowStart && stop.timeWindowEnd && (
                                    <p className="text-xs text-blue-600 mt-1">
                                      🕐 Créneau: {stop.timeWindowStart} - {stop.timeWindowEnd}
                                    </p>
                                  )}
                                  {stop.notes && (
                                    <p className="text-xs text-amber-600 mt-1 italic">
                                      📝 {stop.notes}
                                    </p>
                                  )}
                                  {stop.distanceFromPrevious != null && stop.distanceFromPrevious > 0 && (
                                    <p className="text-xs text-slate-400 mt-1">
                                      ↳ {stop.distanceFromPrevious.toFixed(1)} km depuis le stop précédent
                                      {stop.durationFromPrevious ? ` (~${Math.round(stop.durationFromPrevious)} min)` : ''}
                                    </p>
                                  )}

                                  {/* POD Status */}
                                  {stop.status === 'Terminé' && (() => {
                                    const stopPkg = todayPackages.find(p =>
                                      stop.packageIds?.includes(p.id) && p.pod
                                    );
                                    return stopPkg?.pod ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setViewingPOD({ pod: stopPkg.pod!, pkg: stopPkg }); }}
                                        className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold hover:bg-emerald-200 transition-colors cursor-pointer"
                                      >
                                        {stopPkg.pod?.signatureUrl ? '✍️' : '📷'}
                                        {stopPkg.pod?.signatureUrl ? 'Signé' : 'Photo'} — Voir la preuve
                                      </button>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-amber-50 text-amber-600 rounded text-[10px] font-medium">
                                        ⚠️ POD manquante
                                      </span>
                                    );
                                  })()}
                                  {stop.status === 'Échec' && (() => {
                                    const hasFailurePhotos = todayPackages.some(p =>
                                      stop.packageIds?.includes(p.id)
                                    );
                                    return (
                                      <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-medium">
                                        ❌ {stop.completionTime ? new Date(stop.completionTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Échec'}
                                      </span>
                                    );
                                  })()}
                                </div>

                                {/* Action buttons (admin) */}
                                {mission.status === MissionStatus.DISPATCHED && (
                                  <div className="flex flex-col gap-1 ml-2">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleMoveStopUp(mission, stop); }}
                                      disabled={isSavingPkg || index === 0}
                                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Monter"
                                    >
                                      <ArrowUp size={14} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleMoveStopDown(mission, stop); }}
                                      disabled={isSavingPkg || index === sortedStops.length - 1}
                                      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Descendre"
                                    >
                                      <ArrowDown size={14} />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditStopForm({
                                          contactName: stop.contactName,
                                          contactPhone: stop.contactPhone || '',
                                          address: stop.address,
                                          city: stop.city,
                                          postalCode: stop.postalCode,
                                          timeWindowStart: stop.timeWindowStart || '',
                                          timeWindowEnd: stop.timeWindowEnd || '',
                                          notes: stop.notes || '',
                                          serviceTime: stop.serviceTime || 5
                                        });
                                        setEditingStop({ mission, stop });
                                      }}
                                      className="p-1 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600"
                                      title="Modifier"
                                    >
                                      <Edit size={14} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setDeletingStop({ mission, stop }); }}
                                      className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600"
                                      title="Supprimer"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {/* Retour Hub */}
                        <div className="px-4 py-2.5 flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">
                            <Building2 size={16} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-blue-700">🏁 Retour — {mission.hubName}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* === MODAL ÉDITION STOP === */}
      {editingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingStop(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Modifier le stop</h3>
                <p className="text-xs text-slate-500">Stop #{editingStop.stop.sequence} — {editingStop.mission.zone}</p>
              </div>
              <button onClick={() => setEditingStop(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Destinataire *</label>
                  <input type="text" value={editStopForm.contactName || ''} onChange={e => setEditStopForm(f => ({...f, contactName: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Téléphone</label>
                  <input type="text" value={editStopForm.contactPhone || ''} onChange={e => setEditStopForm(f => ({...f, contactPhone: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Adresse *</label>
                <input type="text" value={editStopForm.address || ''} onChange={e => setEditStopForm(f => ({...f, address: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Code postal *</label>
                  <input type="text" value={editStopForm.postalCode || ''} onChange={e => setEditStopForm(f => ({...f, postalCode: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Ville *</label>
                  <input type="text" value={editStopForm.city || ''} onChange={e => setEditStopForm(f => ({...f, city: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau début</label>
                  <input type="time" value={editStopForm.timeWindowStart || ''} onChange={e => setEditStopForm(f => ({...f, timeWindowStart: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau fin</label>
                  <input type="time" value={editStopForm.timeWindowEnd || ''} onChange={e => setEditStopForm(f => ({...f, timeWindowEnd: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Temps sur place</label>
                  <input type="number" value={editStopForm.serviceTime || 5} onChange={e => setEditStopForm(f => ({...f, serviceTime: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Notes / Instructions</label>
                <textarea value={editStopForm.notes || ''} onChange={e => setEditStopForm(f => ({...f, notes: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-200 outline-none resize-none h-16" />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setEditingStop(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={handleSaveEditStop}
                className="flex-1 py-2.5 bg-brand-500 text-white rounded-xl text-sm font-bold hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL SUPPRESSION STOP === */}
      {deletingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeletingStop(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="p-5 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Trash2 size={24} className="text-red-600" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-1">Supprimer ce stop ?</h3>
              <p className="text-sm text-slate-600 mb-1">
                <span className="font-bold">{deletingStop.stop.contactName}</span>
              </p>
              <p className="text-xs text-slate-500 mb-2">
                {deletingStop.stop.address}, {deletingStop.stop.postalCode} {deletingStop.stop.city}
              </p>
              {deletingStop.stop.packageCount > 0 && (
                <p className="text-xs text-amber-600 font-medium bg-amber-50 rounded-lg p-2">
                  ⚠️ {deletingStop.stop.packageCount} colis seront marqués "À retourner" — Le chauffeur devra les ramener au hub
                </p>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setDeletingStop(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg}
                onClick={handleDeleteStop}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Suppression...' : '🗑 Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === MODAL AJOUT STOP === */}
      {addingStopToMission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAddingStopToMission(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-green-50">
              <div>
                <h3 className="font-bold text-green-800">Ajouter un stop</h3>
                <p className="text-xs text-green-600">Mission {addingStopToMission.zone} — {addingStopToMission.driverName}</p>
              </div>
              <button onClick={() => setAddingStopToMission(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-white">
                <XCircle size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Destinataire *</label>
                  <input type="text" value={newStopForm.contactName || ''} onChange={e => setNewStopForm(f => ({...f, contactName: e.target.value}))}
                    placeholder="Nom du destinataire"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Téléphone</label>
                  <input type="text" value={newStopForm.contactPhone || ''} onChange={e => setNewStopForm(f => ({...f, contactPhone: e.target.value}))}
                    placeholder="0692..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Adresse *</label>
                <input type="text" value={newStopForm.address || ''} onChange={e => setNewStopForm(f => ({...f, address: e.target.value}))}
                  placeholder="123 rue Example"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Code postal *</label>
                  <input type="text" value={newStopForm.postalCode || ''} onChange={e => setNewStopForm(f => ({...f, postalCode: e.target.value}))}
                    placeholder="97400"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Ville *</label>
                  <input type="text" value={newStopForm.city || ''} onChange={e => setNewStopForm(f => ({...f, city: e.target.value}))}
                    placeholder="Saint-Denis"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau début</label>
                  <input type="time" value={newStopForm.timeWindowStart || ''} onChange={e => setNewStopForm(f => ({...f, timeWindowStart: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Créneau fin</label>
                  <input type="time" value={newStopForm.timeWindowEnd || ''} onChange={e => setNewStopForm(f => ({...f, timeWindowEnd: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">Temps (min)</label>
                  <input type="number" value={newStopForm.serviceTime || 5} onChange={e => setNewStopForm(f => ({...f, serviceTime: e.target.value}))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 block mb-1">Notes / Instructions</label>
                <textarea value={newStopForm.notes || ''} onChange={e => setNewStopForm(f => ({...f, notes: e.target.value}))}
                  placeholder="Instructions particulières..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-green-200 outline-none resize-none h-16" />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                <p className="text-xs text-amber-700">
                  💡 Ce stop sera ajouté à la fin de la tournée. Utilisez les flèches ↑↓ pour le repositionner ensuite.
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setAddingStopToMission(null)} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600">
                Annuler
              </button>
              <button
                disabled={isSavingPkg || !newStopForm.contactName || !newStopForm.address || !newStopForm.city || !newStopForm.postalCode}
                onClick={handleAddNewStop}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {isSavingPkg ? '⏳ Ajout...' : '+ Ajouter le stop'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POD VIEWER */}
      {viewingPOD && (
        <PODViewer
          pod={viewingPOD.pod}
          onClose={() => setViewingPOD(null)}
          packageInfo={{
            orderNumber: viewingPOD.pkg.orderNumber,
            contactName: viewingPOD.pkg.contactName,
            address: viewingPOD.pkg.address,
            city: `${viewingPOD.pkg.postalCode} ${viewingPOD.pkg.city}`
          }}
          showDriverInfo={true}
        />
      )}

      {/* Modal Réordonnancement des stops */}
      {reorderingMission && (
        <StopReorderModal
          isOpen={!!reorderingMission}
          onClose={() => setReorderingMission(null)}
          mission={reorderingMission}
          onSave={handleSaveReorderedStops}
        />
      )}
    </>
  );
};

export default MissionList;
