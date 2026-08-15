/**
 * CRÉER UNE EXPÉDITION (client self-service)
 *
 * Le client crée un envoi (choisi dans son carnet ou saisi), le système crée
 * le(s) colis (statut « à collecter », zone auto, code de suivi CL-…), puis
 * ouvre l'impression des étiquettes au format choisi (A4/A5/A6). Multi-colis
 * → étiquettes 1/N…N/N.
 */
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { User, SavedAddress, Package, Zone } from '../types';
import { createClientShipment } from '../services/missionService';
import { estimateZoneFromAddress } from '../services/deliveryService';
import { generateBatchLabelsHTML, LabelFormat } from '../services/pickupService';
import { X, Search, Package as PackageIcon, Printer, MapPin, AlertTriangle } from 'lucide-react';

interface CreateShipmentModalProps {
  currentUser: User;
  savedAddresses: SavedAddress[];
  onClose: () => void;
  onCreated: (packages: Package[]) => void;
}

const splitCity = (city: string): { postalCode: string; cityName: string } => {
  const m = (city || '').match(/(97\d{3}|\d{5})/);
  const postalCode = m ? m[1] : '';
  const cityName = (city || '').replace(postalCode, '').trim().replace(/^,\s*/, '');
  return { postalCode, cityName };
};

const CreateShipmentModal: React.FC<CreateShipmentModalProps> = ({ currentUser, savedAddresses, onClose, onCreated }) => {
  const [contactName, setContactName] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [packageCount, setPackageCount] = useState(1);
  const [weight, setWeight] = useState('');
  const [comment, setComment] = useState('');
  const [clientReference, setClientReference] = useState('');
  const [format, setFormat] = useState<LabelFormat>('A6');

  const [addrSearch, setAddrSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoneWarn, setZoneWarn] = useState(false);

  const filteredAddresses = useMemo(() => {
    const q = addrSearch.trim().toLowerCase();
    const list = savedAddresses.filter(a => a.type === 'delivery' || a.type === 'both');
    if (!q) return list.slice(0, 30);
    return list.filter(a =>
      (a.contactName || '').toLowerCase().includes(q) ||
      (a.address || '').toLowerCase().includes(q) ||
      (a.city || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [savedAddresses, addrSearch]);

  const pickAddress = (a: SavedAddress) => {
    const { postalCode: cp, cityName } = splitCity(a.city);
    setContactName(a.contactName || a.label || '');
    setAddress(a.address || '');
    setPostalCode(cp);
    setCity(cityName || a.city || '');
    setContactPhone(a.contactPhone || '');
    setContactEmail(a.contactEmail || '');
    setShowPicker(false);
    setAddrSearch('');
  };

  const canSubmit = contactName.trim() && address.trim() && (postalCode.trim() || city.trim()) && contactPhone.trim();

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const fullAddr = `${address}, ${postalCode} ${city}`.trim();
      let zone: Zone = Zone.NORD;
      let cp = postalCode.trim();
      const est = await estimateZoneFromAddress(fullAddr);
      if (est) { zone = est.zone; cp = est.postalCode || cp; setZoneWarn(false); }
      else { setZoneWarn(true); }

      const packages = await createClientShipment({
        client: { id: currentUser.id, companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}` },
        recipient: {
          contactName: contactName.trim(),
          address: address.trim(),
          city: city.trim(),
          postalCode: cp,
          contactPhone: contactPhone.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
        },
        zone,
        packageCount,
        weight: weight ? Number(weight) : undefined,
        comment: comment.trim() || undefined,
        clientReference: clientReference.trim() || undefined,
      });

      // Impression immédiate au format choisi
      const html = generateBatchLabelsHTML(
        packages,
        currentUser.companyName || 'Expéditeur',
        format
      );
      const win = window.open('', '_blank');
      if (win) { win.document.write(html); win.document.close(); }

      onCreated(packages);
      onClose();
    } catch (e) {
      setError("Erreur lors de la création. Réessaie.");
      setBusy(false);
    }
  };

  const inputCls = 'w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500';

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><PackageIcon size={18} className="text-indigo-600" /> Créer une expédition</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Choisir depuis le carnet */}
        <div className="relative mb-3">
          <button
            onClick={() => setShowPicker(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold"
          >
            <Search size={16} /> Choisir un destinataire dans mon carnet
          </button>
          {showPicker && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              <div className="p-2 sticky top-0 bg-white border-b border-slate-100">
                <input value={addrSearch} onChange={e => setAddrSearch(e.target.value)} placeholder="Rechercher…" className={inputCls} autoFocus />
              </div>
              {filteredAddresses.map(a => (
                <button key={a.id} onClick={() => pickAddress(a)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                  <div className="font-semibold text-slate-800 truncate">{a.contactName || a.label}</div>
                  <div className="text-xs text-slate-500 truncate">{a.address} · {a.city}</div>
                </button>
              ))}
              {filteredAddresses.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Aucun destinataire — saisis-le ci-dessous, il sera dans ta liste.</p>}
            </div>
          )}
        </div>

        {/* Formulaire destinataire */}
        <div className="space-y-2">
          <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Nom du destinataire *" className={inputCls} />
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Adresse (rue et numéro) *" className={inputCls} />
          <div className="grid grid-cols-3 gap-2">
            <input value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="Code postal" className={inputCls} />
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="Ville" className={`${inputCls} col-span-2`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="Téléphone *" className={inputCls} />
            <input value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="Email (copie du BL)" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 font-medium">Nombre de colis</label>
              <input type="number" min={1} max={50} value={packageCount} onChange={e => setPackageCount(Math.max(1, Number(e.target.value) || 1))} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 font-medium">Poids (kg)</label>
              <input type="number" min={0} step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="—" className={inputCls} />
            </div>
          </div>
          <input value={clientReference} onChange={e => setClientReference(e.target.value)} placeholder="Votre référence (optionnel)" className={inputCls} />
          <input value={comment} onChange={e => setComment(e.target.value)} placeholder="Consignes / remarque (optionnel)" className={inputCls} />
        </div>

        {/* Format d'étiquette */}
        <div className="mt-3">
          <label className="text-[11px] text-slate-500 font-medium">Format d'étiquette</label>
          <div className="flex gap-2 mt-1">
            {(['A4', 'A5', 'A6'] as LabelFormat[]).map(f => (
              <button key={f} onClick={() => setFormat(f)}
                className={`flex-1 py-2 rounded-xl text-sm font-bold border ${format === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                {f}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">A6 = 1 étiquette/page (entrepôt) · A4 = 4/page</p>
        </div>

        {zoneWarn && (
          <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <MapPin size={14} /> Zone non reconnue depuis l'adresse — l'expédition est créée, le transporteur ajustera la zone.
          </div>
        )}
        {error && <div className="mt-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy}
          className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm disabled:opacity-40"
        >
          <Printer size={16} /> {busy ? 'Création…' : `Créer ${packageCount > 1 ? packageCount + ' colis' : "l'expédition"} + imprimer`}
        </button>
      </div>
    </div>,
    document.body
  );
};

export default CreateShipmentModal;
