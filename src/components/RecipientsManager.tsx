import { useClientAccess } from './client/ClientAccessContext';
/**
 * MES DESTINATAIRES (client self-service)
 *
 * Écran de gestion du carnet de destinataires (pharmacies / contacts de
 * livraison) : consulter, rechercher, ajouter, modifier et supprimer.
 * Purement présentationnel — toute persistance passe par les props.
 */
import React, { useState, useMemo, useId } from 'react';
import Modal from './shared/Modal';
import PageHeader from './shared/PageHeader';
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
  'w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-500';

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
  const access = useClientAccess();
  const formId = useId();
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
    if (access.readOnly) return;
    setEditingAddress(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (address: SavedAddress) => {
    if (access.readOnly) return;
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
    if (access.readOnly) return;
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
    if (access.readOnly) return;
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
      <PageHeader title="Mes destinataires" description={`${total} destinataire${total > 1 ? 's' : ''}`} actions={<>
        <button type="button" disabled={access.readOnly} onClick={openAdd} className="ui-button ui-button-primary"><Plus size={18} aria-hidden="true" />Ajouter</button>
        <button type="button" disabled={access.readOnly} onClick={onImport} className="ui-button ui-button-secondary"><Upload size={18} aria-hidden="true" />Importer</button>
      </>} />

      {/* Recherche */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          aria-label="Rechercher dans les destinataires"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un nom, une adresse, une ville…"
          className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-xl text-base outline-none focus:ring-2 focus:ring-brand-500 min-h-11"
        />
      </div>

      {/* Liste */}
      {total === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 flex items-center justify-center mb-3">
            <Users className="w-6 h-6 text-brand-500" />
          </div>
          {search.trim() ? (
            <p className="text-sm text-slate-600">
              Aucun destinataire ne correspond à « {search.trim()} ».
            </p>
          ) : (
            <>
              <p className="text-base font-semibold text-slate-900">Aucun destinataire</p>
              <p className="text-sm text-slate-600 mt-1 mb-4">
                Ajoutez-en un ou importez votre liste.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={access.readOnly} onClick={openAdd}
                  className="ui-button ui-button-primary inline-flex items-center gap-1.5 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter
                </button>
                <button
                  type="button"
                  disabled={access.readOnly} onClick={onImport}
                  className="ui-button ui-button-secondary inline-flex items-center gap-1.5 text-sm border"
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
                className="border-b border-slate-200 py-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base text-slate-900 break-words">
                        {a.contactName}
                      </span>
                      {typeof count === 'number' && count > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-50 text-brand-700 text-sm font-semibold">
                          {count} colis
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mt-1 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-600" />
                      <span className="break-words min-w-0">
                        {a.address} · {a.city}
                      </span>
                    </p>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4 mt-1">
                      <span className="text-sm text-slate-600 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                        {a.contactPhone}
                      </span>
                      {a.contactEmail && (
                        <span className="text-sm text-slate-600 flex items-center gap-1.5 min-w-0">
                          <Mail className="w-3.5 h-3.5 shrink-0 text-slate-600" />
                          <span className="break-words min-w-0">{a.contactEmail}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isConfirming ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm text-slate-600">
                          Confirmer la suppression ?
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDelete(a.id)}
                            disabled={isDeleting}
                            className="ui-button ui-button-danger inline-flex items-center gap-1 disabled:opacity-60 text-sm"
                          >
                            {isDeleting && <Loader2 className="w-3 h-3 animate-spin" />}
                            Supprimer
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmingId(null);
                              setDeleteError(null);
                            }}
                            disabled={isDeleting}
                            className="ui-button ui-button-secondary text-sm border"
                          >
                            Conserver
                          </button>
                        </div>
                        {deleteError && (
                          <span className="text-sm text-red-600">{deleteError}</span>
                        )}
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={access.readOnly} onClick={() => openEdit(a)}
                          aria-label={`Modifier ${a.contactName}`}
                          className="ui-button ui-button-ghost "
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" /> Modifier
                        </button>
                        <button
                          type="button"
                          disabled={access.readOnly} onClick={() => {
                            setConfirmingId(a.id);
                            setDeleteError(null);
                          }}
                          aria-label={`Supprimer ${a.contactName}`}
                          className="ui-button ui-button-ghost "
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" /> Supprimer
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

      <Modal mobileFullscreen subtitle={access.contextLabel} isOpen={modalOpen} onClose={() => void requestClose(closeModal)} title={editingAddress ? 'Modifier le destinataire' : 'Ajouter un destinataire'} size="lg" preventClose={saving} footer={<div className="flex gap-3">
            <button type="button" onClick={() => void requestClose(closeModal)} disabled={saving || access.readOnly} className="ui-button ui-button-secondary min-h-11 border">Annuler</button>
            <button form={formId} type="submit" disabled={saving || access.readOnly} className="ui-button ui-button-primary flex-1 min-h-11 disabled:opacity-50">{saving ? 'Enregistrement…' : editingAddress ? 'Enregistrer' : 'Ajouter au carnet'}</button>
          </div>}>
        <form id={formId} onSubmit={event => { event.preventDefault(); void handleSave(); }} noValidate aria-busy={saving} className="space-y-4">
          <p className="text-sm text-slate-600">Les champs marqués * sont obligatoires.</p>
          <fieldset disabled={saving || access.readOnly} className="space-y-3">
            <FormInput id="recipient-contactName" label="Nom du destinataire" required autoComplete="shipping name" value={form.contactName} onChange={event => updateField('contactName', event.target.value)} />
            <FormInput id="recipient-address" label="Adresse : rue et numéro" required autoComplete="shipping address-line1" value={form.address} onChange={event => updateField('address', event.target.value)} />
            <FormInput id="recipient-city" label="Code postal et ville" required autoComplete="shipping address-level2" value={form.city} onChange={event => updateField('city', event.target.value)} placeholder="97400 Saint-Denis" />
            <FormInput id="recipient-contactPhone" label="Téléphone" required type="tel" autoComplete="shipping tel" value={form.contactPhone} onChange={event => updateField('contactPhone', event.target.value)} />
            <FormInput id="recipient-contactEmail" label="Email (facultatif)" type="email" autoComplete="shipping email" value={form.contactEmail} onChange={event => updateField('contactEmail', event.target.value)} />
            <FormTextarea label="Consignes (facultatif)" value={form.notes} onChange={event => updateField('notes', event.target.value)} hint="Digicode, horaires ou instructions utiles au chauffeur." rows={3} />
          </fieldset>
          {error && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</p>}

        </form>
      </Modal>
    </div>
  );
};

export default RecipientsManager;
