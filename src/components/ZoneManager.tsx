/**
 * GESTION DES ZONES (correspondances code postal → zone)
 *
 * Écran d'administration : la répartition des colis par zone (Nord/Sud/Est/Ouest)
 * repose sur le code postal. Cet écran permet d'ajouter / modifier / supprimer
 * ces correspondances sans passer par le code, et de corriger immédiatement un
 * code postal non reconnu (colis en zone "?").
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, Trash2, Search, Loader2, Save, X, Download, AlertTriangle } from 'lucide-react';
import { PostalCodeMapping, Zone, ZONE_COLORS } from '../types';
import {
  getPostalCodeMappingsFresh, savePostalCodeMapping, deletePostalCodeMapping, seedDefaultPostalCodeMappings
} from '../services/missionService';

const ZONES: Zone[] = [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST];

const ZoneManager: React.FC = () => {
  const [mappings, setMappings] = useState<PostalCodeMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Formulaire d'ajout / édition
  const [form, setForm] = useState<{ postalCode: string; city: string; zone: Zone }>({ postalCode: '', city: '', zone: Zone.OUEST });
  const [editing, setEditing] = useState<string | null>(null); // postalCode en cours d'édition

  const notify = (type: 'ok' | 'err', msg: string) => { setNotice({ type, msg }); setTimeout(() => setNotice(null), 4000); };

  const load = async () => {
    setLoading(true);
    try {
      const data = await getPostalCodeMappingsFresh();
      setMappings([...data].sort((a, b) => a.postalCode.localeCompare(b.postalCode)));
    } catch {
      notify('err', 'Erreur de chargement des zones');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return mappings;
    return mappings.filter(m =>
      m.postalCode.includes(t) || (m.city || '').toLowerCase().includes(t) || String(m.zone).toLowerCase().includes(t)
    );
  }, [mappings, search]);

  const resetForm = () => { setForm({ postalCode: '', city: '', zone: Zone.OUEST }); setEditing(null); };

  const handleSave = async () => {
    const code = form.postalCode.trim();
    if (!/^974\d{2}$/.test(code)) { notify('err', 'Code postal invalide (format 974xx)'); return; }
    setSaving(true);
    try {
      await savePostalCodeMapping({ postalCode: code, city: form.city, zone: form.zone });
      await load();
      resetForm();
      notify('ok', `${code} → ${form.zone} enregistré`);
    } catch {
      notify('err', "Échec de l'enregistrement");
    }
    setSaving(false);
  };

  const handleEdit = (m: PostalCodeMapping) => {
    setForm({ postalCode: m.postalCode, city: m.city || '', zone: m.zone });
    setEditing(m.postalCode);
  };

  const handleDelete = async (postalCode: string) => {
    if (!window.confirm(`Supprimer la correspondance ${postalCode} ?`)) return;
    try {
      await deletePostalCodeMapping(postalCode);
      await load();
      notify('ok', `${postalCode} supprimé`);
    } catch {
      notify('err', 'Échec de la suppression');
    }
  };

  const handleSeed = async () => {
    if (!window.confirm('Charger la liste par défaut des codes postaux de La Réunion ? Les codes existants seront conservés/écrasés.')) return;
    setSaving(true);
    try {
      const n = await seedDefaultPostalCodeMappings();
      await load();
      notify('ok', `${n} codes postaux par défaut chargés`);
    } catch {
      notify('err', 'Échec du chargement par défaut');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-3xl p-6 text-white shadow-xl">
        <h2 className="text-2xl font-bold flex items-center gap-3"><MapPin size={26} /> Gestion des zones</h2>
        <p className="text-slate-300 mt-1 text-sm">
          Correspondance code postal → zone (Nord / Sud / Est / Ouest). Utilisée pour répartir automatiquement les colis à l'import et au dispatch.
        </p>
      </div>

      {notice && (
        <div className={`p-3 rounded-xl text-sm font-medium ${notice.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {notice.msg}
        </div>
      )}

      {/* Formulaire ajout / édition */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 mb-3">{editing ? `Modifier ${editing}` : 'Ajouter une correspondance'}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Code postal *</label>
            <input
              type="text" inputMode="numeric" placeholder="97420" value={form.postalCode}
              onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))}
              disabled={!!editing}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-brand-500 outline-none disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Commune</label>
            <input
              type="text" placeholder="Le Port" value={form.city}
              onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Zone *</label>
            <select
              value={form.zone}
              onChange={e => setForm(f => ({ ...f, zone: e.target.value as Zone }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleSave} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-xl font-bold text-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : editing ? <Save size={16} /> : <Plus size={16} />}
              {editing ? 'Enregistrer' : 'Ajouter'}
            </button>
            {editing && (
              <button onClick={resetForm} className="px-3 py-2.5 bg-slate-100 text-slate-600 rounded-xl" title="Annuler"><X size={16} /></button>
            )}
          </div>
        </div>
      </div>

      {/* Recherche + seed */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Rechercher un code postal, une commune, une zone…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
        <button
          onClick={handleSeed} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 disabled:opacity-50"
          title="Charger la liste par défaut de La Réunion"
        >
          <Download size={16} /> Charger les valeurs par défaut
        </button>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" /> Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <AlertTriangle size={28} className="mx-auto mb-2 text-amber-400" />
            {mappings.length === 0 ? 'Aucune correspondance. Cliquez sur « Charger les valeurs par défaut ».' : 'Aucun résultat.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left">
                <th className="px-4 py-3 font-bold text-slate-500">Code postal</th>
                <th className="px-4 py-3 font-bold text-slate-500">Commune</th>
                <th className="px-4 py-3 font-bold text-slate-500">Zone</th>
                <th className="px-4 py-3 font-bold text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(m => {
                const c = ZONE_COLORS[m.zone] || { bg: 'bg-slate-100', text: 'text-slate-700' };
                return (
                  <tr key={m.postalCode} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{m.postalCode}</td>
                    <td className="px-4 py-2.5 text-slate-600">{m.city || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-1 rounded-lg text-xs font-bold ${c.bg} ${c.text}`}>{m.zone}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(m)} className="px-2.5 py-1.5 text-xs font-bold text-brand-600 hover:bg-brand-50 rounded-lg">Modifier</button>
                        <button onClick={() => handleDelete(m.postalCode)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg" title="Supprimer"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            {filtered.length} correspondance{filtered.length > 1 ? 's' : ''}{search ? ` (sur ${mappings.length})` : ''}
          </div>
        )}
      </div>
    </div>
  );
};

export default ZoneManager;
