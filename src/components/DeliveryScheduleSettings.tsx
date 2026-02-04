/**
 * DELIVERY SCHEDULE SETTINGS
 * 
 * Paramétrage des créneaux de livraison par zone, horaires,
 * cut-off, jours ouvrés, jours fériés.
 * 
 * Accessible depuis les paramètres (Admin/Direction).
 */

import React, { useState, useEffect } from 'react';
import {
  DeliveryTimeSlot, DeliveryScheduleConfig, Zone, ZONE_COLORS, User
} from '../types';
import {
  getDeliveryScheduleConfig,
  saveDeliveryScheduleConfig,
  DEFAULT_DELIVERY_SLOTS
} from '../services/deliveryService';
import {
  Clock, Plus, Trash2, Save, RotateCcw, CheckCircle, AlertTriangle,
  Loader2, Calendar, MapPin, Settings, Zap
} from 'lucide-react';

interface DeliveryScheduleSettingsProps {
  currentUser: User;
}

const DeliveryScheduleSettings: React.FC<DeliveryScheduleSettingsProps> = ({ currentUser }) => {
  const [config, setConfig] = useState<DeliveryScheduleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [newHoliday, setNewHoliday] = useState('');

  // Charger la config
  useEffect(() => {
    const load = async () => {
      const cfg = await getDeliveryScheduleConfig();
      setConfig(cfg);
      setLoading(false);
    };
    load();
  }, []);

  const showNotif = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // Sauvegarder
  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await saveDeliveryScheduleConfig(config, currentUser.id);
      showNotif('✅ Configuration sauvegardée');
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
      showNotif('❌ Erreur de sauvegarde');
    }
    setSaving(false);
  };

  // Reset aux valeurs par défaut
  const handleReset = () => {
    if (!config) return;
    setConfig({
      ...config,
      slots: DEFAULT_DELIVERY_SLOTS,
      cutoffHours: 2,
      sameDayEnabled: true,
      sameDayCutoff: '10:00',
      weekendEnabled: false,
      holidays: []
    });
    showNotif('🔄 Configuration réinitialisée (non sauvegardée)');
  };

  // === Gestion des créneaux ===
  const addSlot = () => {
    if (!config) return;
    const newSlot: DeliveryTimeSlot = {
      id: `slot-${Date.now()}`,
      label: 'Nouveau créneau',
      start: '08:00',
      end: '12:00',
      zones: [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST],
      isActive: true,
      sortOrder: config.slots.length + 1
    };
    setConfig({ ...config, slots: [...config.slots, newSlot] });
    setEditingSlotId(newSlot.id);
  };

  const updateSlot = (slotId: string, updates: Partial<DeliveryTimeSlot>) => {
    if (!config) return;
    setConfig({
      ...config,
      slots: config.slots.map(s => s.id === slotId ? { ...s, ...updates } : s)
    });
  };

  const deleteSlot = (slotId: string) => {
    if (!config) return;
    setConfig({
      ...config,
      slots: config.slots.filter(s => s.id !== slotId)
    });
  };

  const toggleZone = (slotId: string, zone: Zone) => {
    if (!config) return;
    const slot = config.slots.find(s => s.id === slotId);
    if (!slot) return;
    const zones = slot.zones.includes(zone)
      ? slot.zones.filter(z => z !== zone)
      : [...slot.zones, zone];
    updateSlot(slotId, { zones });
  };

  // === Gestion jours fériés ===
  const addHoliday = () => {
    if (!config || !newHoliday) return;
    if (config.holidays.includes(newHoliday)) return;
    setConfig({ ...config, holidays: [...config.holidays, newHoliday].sort() });
    setNewHoliday('');
  };

  const removeHoliday = (date: string) => {
    if (!config) return;
    setConfig({ ...config, holidays: config.holidays.filter(h => h !== date) });
  };

  // ============================================================================
  // RENDU
  // ============================================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-sm font-medium animate-fade-in">
          {notification}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Clock size={22} className="text-blue-500" />
            Horaires de livraison
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Configurez les créneaux proposés aux clients et les contraintes de planning
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
          >
            <RotateCcw size={14} />
            Réinitialiser
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </div>
      </div>

      {/* === CRÉNEAUX DE LIVRAISON === */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Créneaux de livraison</h3>
          <button
            onClick={addSlot}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
          >
            <Plus size={14} />
            Ajouter un créneau
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {config.slots
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(slot => {
              const isEditing = editingSlotId === slot.id;

              return (
                <div
                  key={slot.id}
                  className={`p-4 ${!slot.isActive ? 'bg-slate-50 opacity-60' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      {/* Toggle actif */}
                      <button
                        onClick={() => updateSlot(slot.id, { isActive: !slot.isActive })}
                        className={`w-10 h-5 rounded-full transition-colors relative ${
                          slot.isActive ? 'bg-green-500' : 'bg-slate-300'
                        }`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          slot.isActive ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>

                      {/* Label éditable */}
                      {isEditing ? (
                        <input
                          autoFocus
                          value={slot.label}
                          onChange={(e) => updateSlot(slot.id, { label: e.target.value })}
                          onBlur={() => setEditingSlotId(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditingSlotId(null)}
                          className="text-sm font-bold border border-blue-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-400"
                        />
                      ) : (
                        <span
                          onClick={() => setEditingSlotId(slot.id)}
                          className="text-sm font-bold text-slate-800 cursor-pointer hover:text-blue-600"
                        >
                          {slot.label}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => deleteSlot(slot.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Horaires */}
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="time"
                      value={slot.start}
                      onChange={(e) => updateSlot(slot.id, { start: e.target.value })}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-sm"
                    />
                    <span className="text-slate-400 text-sm">→</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={(e) => updateSlot(slot.id, { end: e.target.value })}
                      className="px-2 py-1 border border-slate-200 rounded-lg text-sm"
                    />
                    <div className="ml-4 flex items-center gap-1">
                      <span className="text-xs text-slate-500">Max:</span>
                      <input
                        type="number"
                        min={0}
                        value={slot.maxCapacity || ''}
                        onChange={(e) => updateSlot(slot.id, { maxCapacity: parseInt(e.target.value) || undefined })}
                        placeholder="∞"
                        className="w-14 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center"
                      />
                    </div>
                  </div>

                  {/* Zones */}
                  <div className="flex flex-wrap gap-1.5">
                    {Object.values(Zone).map(zone => {
                      const active = slot.zones.includes(zone);
                      return (
                        <button
                          key={zone}
                          onClick={() => toggleZone(slot.id, zone)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                            active
                              ? `${ZONE_COLORS[zone]?.bg || 'bg-blue-100'} ${ZONE_COLORS[zone]?.text || 'text-blue-800'}`
                              : 'bg-slate-100 text-slate-400 line-through'
                          }`}
                        >
                          {zone}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {config.slots.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">
              Aucun créneau configuré. Cliquez sur "Ajouter" pour commencer.
            </div>
          )}
        </div>
      </div>

      {/* === RÈGLES GÉNÉRALES === */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <Settings size={16} className="text-slate-400" />
          Règles de planning
        </h3>

        {/* Cut-off */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Délai de réservation (cut-off)</p>
            <p className="text-xs text-slate-500">Combien d'heures avant le créneau faut-il commander ?</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={48}
              value={config.cutoffHours}
              onChange={(e) => setConfig({ ...config, cutoffHours: parseInt(e.target.value) || 0 })}
              className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center"
            />
            <span className="text-sm text-slate-500">heures</span>
          </div>
        </div>

        {/* Jour même */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <Zap size={14} className="text-amber-500" />
              Livraison le jour même
            </p>
            <p className="text-xs text-slate-500">Autorise les clients à demander une course pour aujourd'hui</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setConfig({ ...config, sameDayEnabled: !config.sameDayEnabled })}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                config.sameDayEnabled ? 'bg-green-500' : 'bg-slate-300'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                config.sameDayEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
            {config.sameDayEnabled && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500">avant</span>
                <input
                  type="time"
                  value={config.sameDayCutoff || '10:00'}
                  onChange={(e) => setConfig({ ...config, sameDayCutoff: e.target.value })}
                  className="px-2 py-1 border border-slate-200 rounded-lg text-sm"
                />
              </div>
            )}
          </div>
        </div>

        {/* Week-end */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-700">Livraison le week-end</p>
            <p className="text-xs text-slate-500">Samedi et dimanche</p>
          </div>
          <button
            onClick={() => setConfig({ ...config, weekendEnabled: !config.weekendEnabled })}
            className={`w-10 h-5 rounded-full transition-colors relative ${
              config.weekendEnabled ? 'bg-green-500' : 'bg-slate-300'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              config.weekendEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      </div>

      {/* === JOURS FÉRIÉS === */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <Calendar size={16} className="text-red-400" />
          Jours fériés / fermés
        </h3>

        <div className="flex gap-2">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm flex-1"
          />
          <button
            onClick={addHoliday}
            disabled={!newHoliday}
            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            Ajouter
          </button>
        </div>

        {config.holidays.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {config.holidays.map(date => (
              <span
                key={date}
                className="flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded-lg text-xs font-medium"
              >
                {new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                <button onClick={() => removeHoliday(date)} className="text-red-400 hover:text-red-600 ml-1">
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Aucun jour férié configuré</p>
        )}
      </div>
    </div>
  );
};

export default DeliveryScheduleSettings;
