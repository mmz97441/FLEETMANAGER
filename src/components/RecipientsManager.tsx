/**
 * MES DESTINATAIRES (client self-service)
 *
 * Écran de gestion du carnet de destinataires (pharmacies / contacts de
 * livraison) : consulter, rechercher, ajouter, modifier et supprimer.
 * Purement présentationnel — toute persistance passe par les props.
 */
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SavedAddress } from '../types';
import {
  Plus,
  Upload,
  Search,
  Pencil,
  Trash2,
  X,
  MapPin,
  Phone,
  Mail,
  Users,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface RecipientFields {
  contactName: string;
  address: string;
  city: string;
  contactPhone: string;
  contactEmail?: string;
  notes?: string;
}

interface RecipientsManagerProps {
  addresses: SavedAddress[];                 // le carnet du client (déjà chargé)
  packageCounts?: Record<string, number>;    // optionnel : nb de colis par contactName (touche premium)
  onCreate: (fields: RecipientFields) => Promise<void>;
  onUpdate: (address: SavedAddress) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: () => void;                       // ouvre l'import Excel/CSV existant
}

const inputClass =
  'w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500';

interface FormState {
  contactName: string;
  address: string;
  city: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
}

const emptyForm: FormState = {
  contactName: '',
  address: '',
  city: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
};

const RecipientsManager: React.FC<RecipientsManagerProps> = ({
  addresses,
  packageCounts,
  onCreate,
  onUpdate,
  onDelete,
  onImport,
}) => {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suppression : confirmation inline + état de chargement
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return addresses
      .filter((a) => a.type === 'delivery' || a.type === 'both')
      .filter((a) => {
        if (!q) return true;
        return (
          a.contactName.toLowerCase().includes(q) ||
          a.address.toLowerCase().includes(q) ||
          a.city.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.contactName.localeCompare(b.contactName, 'fr'));
  }, [addresses, search]);

  const openAdd = () => {
    setEditingAddress(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (address: SavedAddress) => {
    setEditingAddress(address);
    setForm({
      contactName: address.contactName,
      address: address.address,
      city: address.city,
      contactPhone: address.contactPhone,
      contactEmail: address.contactEmail ?? '',
      notes: address.notes ?? '',
    });
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingAddress(null);
    setForm(emptyForm);
    setError(null);
  };

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isValid =
    form.contactName.trim() !== '' &&
    form.address.trim() !== '' &&
    form.city.trim() !== '' &&
    form.contactPhone.trim() !== '';

  const handleSave = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setError(null);

    const fields: RecipientFields = {
      contactName: form.contactName.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      contactPhone: form.contactPhone.trim(),
      contactEmail: form.contactEmail.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };

    try {
      if (editingAddress) {
        await onUpdate({ ...editingAddress, ...fields });
      } else {
        await onCreate(fields);
      }
      setModalOpen(false);
      setEditingAddress(null);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmingId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setDeletingId(null);
    }
  };

  const total = filtered.length;

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            Mes destinataires
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total} destinataire{total > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter
          </button>
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-xl border border-slate-300 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Importer
          </button>
        </div>
      </div>

      {/* Recherche */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un nom, une adresse, une ville…"
          className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Liste */}
      {total === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 flex items-center justify-center mb-3">
            <Users className="w-6 h-6 text-indigo-500" />
          </div>
          {search.trim() ? (
            <p className="text-sm text-slate-500">
              Aucun destinataire ne correspond à « {search.trim()} ».
            </p>
          ) : (
            <>
              <p className="text-base font-semibold text-slate-900">Aucun destinataire</p>
              <p className="text-sm text-slate-500 mt-1 mb-4">
                Ajoutez-en un ou importez votre liste.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openAdd}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter
                </button>
                <button
                  type="button"
                  onClick={onImport}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-xl border border-slate-300 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Importer
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => {
            const count = packageCounts?.[a.contactName];
            const isConfirming = confirmingId === a.id;
            const isDeleting = deletingId === a.id;
            return (
              <div
                key={a.id}
                className="bg-white rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 truncate">
                        {a.contactName}
                      </span>
                      {typeof count === 'number' && count > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                          {count} colis
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mt-1 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                      <span className="truncate">
                        {a.address} · {a.city}
                      </span>
                    </p>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4 mt-1">
                      <span className="text-sm text-slate-600 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        {a.contactPhone}
                      </span>
                      {a.contactEmail && (
                        <span className="text-sm text-slate-600 flex items-center gap-1.5 min-w-0">
                          <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{a.contactEmail}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isConfirming ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-slate-600">
                          Confirmer la suppression ?
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDelete(a.id)}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors"
                          >
                            {isDeleting && <Loader2 className="w-3 h-3 animate-spin" />}
                            Oui
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmingId(null);
                              setDeleteError(null);
                            }}
                            disabled={isDeleting}
                            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 transition-colors"
                          >
                            Non
                          </button>
                        </div>
                        {deleteError && (
                          <span className="text-xs text-red-600">{deleteError}</span>
                        )}
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(a)}
                          aria-label="Modifier"
                          className="p-2.5 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingId(a.id);
                            setDeleteError(null);
                          }}
                          aria-label="Supprimer"
                          className="p-2.5 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Ajouter / Modifier */}
      {modalOpen &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[120]"
            onClick={closeModal}
          >
            <div
              className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-900">
                  {editingAddress ? 'Modifier le destinataire' : 'Ajouter un destinataire'}
                </h2>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  aria-label="Fermer"
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nom du contact <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.contactName}
                    onChange={(e) => updateField('contactName', e.target.value)}
                    placeholder="Ex : Pharmacie du Centre"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Adresse <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => updateField('address', e.target.value)}
                    placeholder="Rue et numéro"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Code postal et ville <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => updateField('city', e.target.value)}
                    placeholder="Ex : 06000 Nice"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Téléphone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => updateField('contactPhone', e.target.value)}
                    placeholder="Ex : 04 93 00 00 00"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email <span className="text-slate-400 font-normal">(optionnel)</span>
                  </label>
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => updateField('contactEmail', e.target.value)}
                    placeholder="Ex : contact@pharmacie.fr"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Notes <span className="text-slate-400 font-normal">(optionnel)</span>
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    placeholder="Digicode, horaires, instructions…"
                    rows={3}
                    className={`${inputClass} resize-none`}
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-xl border border-slate-300 transition-colors disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isValid || saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingAddress ? 'Enregistrer' : 'Ajouter'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default RecipientsManager;
