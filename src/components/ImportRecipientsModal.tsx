/**
 * IMPORT DU CARNET DE DESTINATAIRES (client)
 *
 * Le client importe sa liste de destinataires (Excel/CSV) pour ne pas tout
 * retaper : Nom, Adresse, Code postal, Ville, Téléphone, Email (optionnel).
 * Colonnes tolérantes (accents/casse). Aperçu + dédoublonnage avant création
 * dans le carnet d'adresses (SavedAddress, type 'delivery').
 */
import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { User, SavedAddress } from '../types';
import { addSavedAddressesBatch } from '../services/firestore';
import { X, Upload, CheckCircle, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';

interface ImportRecipientsModalProps {
  currentUser: User;
  existingAddresses: SavedAddress[];
  onClose: () => void;
  onDone: (count: number) => void;
}

interface ParsedRow {
  contactName: string;
  address: string;
  city: string;         // "CP Ville"
  contactPhone: string;
  contactEmail?: string;
  _status: 'ok' | 'duplicate' | 'invalid';
  _reason?: string;
}

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const digits = (s: string) => String(s || '').replace(/\D+/g, '');

// Trouve la 1re colonne dont l'entête matche un des alias
const pick = (row: Record<string, any>, aliases: string[]): string => {
  for (const key of Object.keys(row)) {
    const k = norm(key);
    if (aliases.some(a => k === a || k.includes(a))) {
      const v = row[key];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
};

const ImportRecipientsModal: React.FC<ImportRecipientsModalProps> = ({ currentUser, existingAddresses, onClose, onDone }) => {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const existKey = new Set(
    existingAddresses.map(a => `${norm(a.contactName)}|${norm(a.address)}`)
  );
  const existPhones = new Set(existingAddresses.map(a => digits(a.contactPhone)).filter(Boolean));

  const handleFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

      const seen = new Set<string>();
      const parsed: ParsedRow[] = raw.map(r => {
        const contactName = pick(r, ['nom', 'destinataire', 'client', 'pharmacie', 'name', 'raison sociale']);
        const address = pick(r, ['adresse', 'rue', 'address']);
        const cp = pick(r, ['code postal', 'cp', 'postal', 'zip']);
        let city = pick(r, ['ville', 'commune', 'city']);
        if (cp && !norm(city).startsWith(norm(cp))) city = `${cp} ${city}`.trim();
        const contactPhone = pick(r, ['telephone', 'tel', 'phone', 'portable', 'mobile', 'gsm']);
        const contactEmail = pick(r, ['email', 'mail', 'courriel', 'e-mail']);

        let _status: ParsedRow['_status'] = 'ok';
        let _reason = '';
        if (!contactName || !address || !contactPhone) {
          _status = 'invalid';
          _reason = 'Nom, adresse et téléphone obligatoires';
        } else {
          const key = `${norm(contactName)}|${norm(address)}`;
          const phoneKey = digits(contactPhone);
          if (existKey.has(key) || (phoneKey && existPhones.has(phoneKey)) || seen.has(key)) {
            _status = 'duplicate';
            _reason = 'Déjà dans le carnet';
          } else {
            seen.add(key);
          }
        }
        return { contactName, address, city, contactPhone, contactEmail: contactEmail || undefined, _status, _reason };
      });

      if (parsed.length === 0) { setError('Aucune ligne trouvée dans le fichier.'); return; }
      setRows(parsed);
    } catch (e) {
      setError("Impossible de lire le fichier. Vérifie que c'est bien un .xlsx ou .csv.");
    }
  };

  const downloadTemplate = () => {
    const example = [
      { Nom: 'Pharmacie du Centre', Adresse: '12 rue des Lilas', 'Code postal': '97400', Ville: 'Saint-Denis', 'Téléphone': '0692 12 34 56', Email: 'contact@pharmacie-centre.re' },
      { Nom: 'Pharmacie du Port', Adresse: '5 avenue de la Mer', 'Code postal': '97420', Ville: 'Le Port', 'Téléphone': '0262 00 00 00', Email: '' },
    ];
    const ws = XLSX.utils.json_to_sheet(example);
    ws['!cols'] = [{ wch: 24 }, { wch: 26 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 28 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Destinataires');
    XLSX.writeFile(wb, 'modele-destinataires.xlsx');
  };

  const okRows = (rows || []).filter(r => r._status === 'ok');
  const dupRows = (rows || []).filter(r => r._status === 'duplicate');
  const badRows = (rows || []).filter(r => r._status === 'invalid');

  const handleImport = async () => {
    if (okRows.length === 0) return;
    setImporting(true);
    try {
      const toCreate: Omit<SavedAddress, 'id'>[] = okRows.map(r => ({
        companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`,
        createdBy: currentUser.id,
        label: r.contactName,
        type: 'delivery',
        address: r.address,
        city: r.city,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        contactEmail: r.contactEmail,
        createdAt: '',
        updatedAt: '',
      })) as any;
      const created = await addSavedAddressesBatch(toCreate);
      onDone(created);
    } catch (e) {
      setError("Erreur pendant l'import. Réessaie.");
      setImporting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><FileSpreadsheet size={18} className="text-indigo-600" /> Importer mes destinataires</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {!rows && (
          <>
            <p className="text-sm text-slate-600 mb-3">
              Importe ta liste (Excel/CSV). Colonnes reconnues : <b>Nom</b>, <b>Adresse</b>, <b>Code postal</b>, <b>Ville</b>, <b>Téléphone</b>, <b>Email</b> (optionnel — pour la copie du BL).
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed border-indigo-300 rounded-xl text-indigo-600 hover:bg-indigo-50"
            >
              <Upload size={28} />
              <span className="font-bold text-sm">Choisir un fichier .xlsx / .csv</span>
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button
              onClick={downloadTemplate}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold"
            >
              <Download size={16} /> Télécharger un fichier d'exemple
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-1">Remplis le modèle avec tes destinataires, puis importe-le.</p>
          </>
        )}

        {error && <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

        {rows && (
          <>
            <p className="text-xs text-slate-500 mb-2">{fileName}</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center"><div className="text-xl font-extrabold text-green-700">{okRows.length}</div><div className="text-[11px] text-green-700">À importer</div></div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center"><div className="text-xl font-extrabold text-amber-700">{dupRows.length}</div><div className="text-[11px] text-amber-700">Doublons</div></div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center"><div className="text-xl font-extrabold text-red-700">{badRows.length}</div><div className="text-[11px] text-red-700">Ignorés</div></div>
            </div>
            <div className="overflow-y-auto flex-1 border border-slate-100 rounded-lg divide-y divide-slate-100 mb-3">
              {(rows).slice(0, 100).map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                  {r._status === 'ok' && <CheckCircle size={14} className="text-green-500 shrink-0" />}
                  {r._status === 'duplicate' && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                  {r._status === 'invalid' && <X size={14} className="text-red-500 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 truncate">{r.contactName || <span className="text-red-400">Nom manquant</span>}</div>
                    <div className="text-slate-500 truncate">{r.address} {r.city} · {r.contactPhone}{r.contactEmail ? ` · ${r.contactEmail}` : ''}</div>
                  </div>
                  {r._reason && <span className="text-[10px] text-slate-400 whitespace-nowrap">{r._reason}</span>}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setRows(null); setFileName(''); }} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm">Changer de fichier</button>
              <button
                onClick={handleImport}
                disabled={okRows.length === 0 || importing}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm disabled:opacity-40"
              >
                {importing ? 'Import en cours…' : `Importer ${okRows.length} destinataire(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ImportRecipientsModal;
