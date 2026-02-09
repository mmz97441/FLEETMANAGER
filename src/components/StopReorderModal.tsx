import React, { useState, useCallback } from 'react';
import { Mission, MissionStop, MissionStatus } from '../types';
import Modal from './shared/Modal';
import { useToast } from './shared/Toast';
import { 
  GripVertical, ArrowUp, ArrowDown, MapPin, Package as PackageIcon, 
  Clock, Save, RotateCcw, AlertTriangle, CheckCircle, Building2,
  Loader2
} from 'lucide-react';

interface StopReorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  mission: Mission;
  onSave: (mission: Mission, newStops: MissionStop[]) => Promise<void>;
}

const StopReorderModal: React.FC<StopReorderModalProps> = ({
  isOpen,
  onClose,
  mission,
  onSave
}) => {
  const { showToast } = useToast();

  // État local des stops pour le drag-and-drop
  const [stops, setStops] = useState<MissionStop[]>(() => 
    [...mission.stops].sort((a, b) => a.sequence - b.sequence)
  );
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Reset quand la mission change
  React.useEffect(() => {
    setStops([...mission.stops].sort((a, b) => a.sequence - b.sequence));
    setHasChanges(false);
  }, [mission.id, mission.stops]);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    // Style de l'élément draggé
    const target = e.target as HTMLElement;
    target.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    target.style.opacity = '1';
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = draggedIndex;
    
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }

    reorderStops(dragIndex, dropIndex);
    setDragOverIndex(null);
  };

  // Réordonnancement
  const reorderStops = useCallback((fromIndex: number, toIndex: number) => {
    setStops(prev => {
      const newStops = [...prev];
      const [removed] = newStops.splice(fromIndex, 1);
      newStops.splice(toIndex, 0, removed);
      
      // Mettre à jour les séquences
      return newStops.map((stop, idx) => ({
        ...stop,
        sequence: idx + 1
      }));
    });
    setHasChanges(true);
  }, []);

  // Boutons monter/descendre
  const moveUp = (index: number) => {
    if (index > 0) {
      reorderStops(index, index - 1);
    }
  };

  const moveDown = (index: number) => {
    if (index < stops.length - 1) {
      reorderStops(index, index + 1);
    }
  };

  // Reset à l'ordre original
  const handleReset = () => {
    setStops([...mission.stops].sort((a, b) => a.sequence - b.sequence));
    setHasChanges(false);
  };

  // Sauvegarder
  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(mission, stops);
      setHasChanges(false);
      onClose();
    } catch (error) {
      console.error('Erreur sauvegarde:', error);
      showToast('Erreur lors de la sauvegarde. Veuillez réessayer.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Vérification si réordonnancement possible
  const canReorder = mission.status === MissionStatus.DISPATCHED || mission.status === MissionStatus.PENDING;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Réordonner les stops — ${mission.driverName || 'Non assigné'}`}
      size="lg"
      headerIcon={<GripVertical size={20} />}
    >
      <div className="space-y-4">
        {/* Warning si mission en cours */}
        {mission.status === MissionStatus.IN_PROGRESS && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-800">Tournée en cours</p>
              <p className="text-sm text-amber-700">
                Le chauffeur est déjà en route. Les modifications seront visibles immédiatement sur son application.
              </p>
            </div>
          </div>
        )}

        {!canReorder && mission.status === MissionStatus.COMPLETED && (
          <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl flex items-start gap-3">
            <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-slate-700">Cette tournée est terminée et ne peut plus être modifiée.</p>
          </div>
        )}

        {/* Instructions */}
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <GripVertical size={16} />
          <span>Glissez-déposez les stops pour changer l'ordre, ou utilisez les flèches ↑↓</span>
        </div>

        {/* Départ Hub */}
        <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600">
            <Building2 size={20} />
          </div>
          <div>
            <p className="text-xs text-blue-600 font-medium uppercase">Point de départ</p>
            <p className="font-bold text-blue-800">{mission.hubName}</p>
          </div>
        </div>

        {/* Liste des stops */}
        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
          {stops.map((stop, index) => {
            const isDragging = draggedIndex === index;
            const isDragOver = dragOverIndex === index;
            const isCompleted = stop.status === 'Terminé';
            const isFailed = stop.status === 'Échec';

            return (
              <div
                key={stop.id}
                draggable={canReorder && !isCompleted && !isFailed}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                className={`
                  p-3 rounded-xl border-2 transition-all
                  ${isDragging ? 'opacity-50 scale-95' : ''}
                  ${isDragOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}
                  ${isCompleted ? 'bg-green-50 border-green-200' : ''}
                  ${isFailed ? 'bg-red-50 border-red-200' : ''}
                  ${canReorder && !isCompleted && !isFailed ? 'cursor-grab active:cursor-grabbing hover:border-slate-300 hover:shadow-sm' : ''}
                `}
              >
                <div className="flex items-center gap-3">
                  {/* Handle drag + numéro */}
                  <div className="flex items-center gap-2">
                    {canReorder && !isCompleted && !isFailed && (
                      <GripVertical size={18} className="text-slate-400" />
                    )}
                    <div className={`
                      flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold
                      ${isCompleted ? 'bg-green-200 text-green-800' : 
                        isFailed ? 'bg-red-200 text-red-800' : 
                        'bg-slate-200 text-slate-700'}
                    `}>
                      {stop.sequence}
                    </div>
                  </div>

                  {/* Infos stop */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 truncate">{stop.contactName}</p>
                    <p className="text-sm text-slate-500 truncate flex items-center gap-1">
                      <MapPin size={12} />
                      {stop.address}, {stop.postalCode} {stop.city}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <PackageIcon size={12} />
                        {stop.packageCount} colis
                      </span>
                      {stop.timeWindowStart && stop.timeWindowEnd && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {stop.timeWindowStart} - {stop.timeWindowEnd}
                        </span>
                      )}
                      {stop.estimatedArrival && (
                        <span className="text-brand-600">
                          ETA: {new Date(stop.estimatedArrival).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status badge */}
                  {(isCompleted || isFailed) && (
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      isCompleted ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {stop.status}
                    </span>
                  )}

                  {/* Boutons monter/descendre */}
                  {canReorder && !isCompleted && !isFailed && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className={`p-1 rounded transition-colors ${
                          index === 0 
                            ? 'text-slate-300 cursor-not-allowed' 
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                        title="Monter"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        onClick={() => moveDown(index)}
                        disabled={index === stops.length - 1}
                        className={`p-1 rounded transition-colors ${
                          index === stops.length - 1 
                            ? 'text-slate-300 cursor-not-allowed' 
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                        title="Descendre"
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <button
            onClick={handleReset}
            disabled={!hasChanges || isSaving}
            className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={18} />
            Réinitialiser
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving || !canReorder}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save size={18} />
                  Enregistrer l'ordre
                </>
              )}
            </button>
          </div>
        </div>

        {hasChanges && (
          <p className="text-center text-sm text-amber-600">
            ⚠️ Vous avez des modifications non enregistrées
          </p>
        )}
      </div>
    </Modal>
  );
};

export default StopReorderModal;
