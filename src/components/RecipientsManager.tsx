/**
 * MES DESTINATAIRES (client self-service)
 *
 * Écran de gestion du carnet de destinataires (pharmacies / contacts de
 * livraison) : consulter, rechercher, ajouter, modifier et supprimer.
 * Purement présentationnel — toute persistance passe par les props.
 */
import React, { useState, useMemo } from 'react';
import Modal from './shared/Modal';
import { FormInput, FormTextarea } from './shared/FormInput';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
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

  const baseline: FormState = editingAddress ? { contactName: editingAddress.contactName, address: editingAddress.address, city: editingAddress.city, contactPhone: editingAddress.contactPhone, contactEmail: editingAddress.contactEmail || '', notes: editingAddress.notes || '' } : emptyForm;
  const requestClose = useUnsavedChanges(modalOpen && JSON.stringify(form) !== JSON.stringify(baseline), saving);

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
    if (saving) return;
    if (!isValid) {
      setError('Complétez le nom, l’adresse, la ville et le téléphone du destinataire.');
      const missing = (['contactName', 'address', 'city', 'contactPhone'] as const).find(key => !form[key].trim());
      if (missing) document.getElementById(`recipient-${missing}`)?.focus();
      return;
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) { setError('Corrigez l’adresse email ou laissez le champ vide.'); document.getElementById('recipient-contactEmail')?.focus(); return; }
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
          type="search"
          aria-label="Rechercher dans les destinataires"
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

      <Modal isOpen={modalOpen} onClose={() => void requestClose(closeModal)} title={editingAddress ? 'Modifier le destinataire' : 'Ajouter un destinataire'} size="lg" preventClose={saving}>
        <form onSubmit={event => { event.preventDefault(); void handleSave(); }} noValidate aria-busy={saving} className="space-y-4">
          <p className="text-sm text-slate-600">Les champs marqués * sont obligatoires.</p>
          <fieldset disabled={saving} className="space-y-3">
            <FormInput id="recipient-contactName" label="Nom du destinataire" required autoComplete="shipping name" value={form.contactName} onChange={event => updateField('contactName', event.target.value)} />
            <FormInput id="recipient-address" label="Adresse : rue et numéro" required autoComplete="shipping address-line1" value={form.address} onChange={event => updateField('address', event.target.value)} />
            <FormInput id="recipient-city" label="Code postal et ville" required autoComplete="shipping address-level2" value={form.city} onChange={event => updateField('city', event.target.value)} placeholder="97400 Saint-Denis" />
            <FormInput id="recipient-contactPhone" label="Téléphone" required type="tel" autoComplete="shipping tel" value={form.contactPhone} onChange={event => updateField('contactPhone', event.target.value)} />
            <FormInput id="recipient-contactEmail" label="Email (facultatif)" type="email" autoComplete="shipping email" value={form.contactEmail} onChange={event => updateField('contactEmail', event.target.value)} />
            <FormTextarea label="Consignes (facultatif)" value={form.notes} onChange={event => updateField('notes', event.target.value)} hint="Digicode, horaires ou instructions utiles au chauffeur." rows={3} />
          </fieldset>
          {error && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => void requestClose(closeModal)} disabled={saving} className="min-h-11 px-4 rounded-xl border text-slate-700">Annuler</button>
            <button type="submit" disabled={saving} className="flex-1 min-h-11 bg-indigo-700 text-white rounded-xl font-semibold disabled:opacity-50">{saving ? 'Enregistrement…' : editingAddress ? 'Enregistrer' : 'Ajouter au carnet'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default RecipientsManager;
