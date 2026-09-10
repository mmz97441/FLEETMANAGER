/**
 * IMPORT DU CARNET DE DESTINATAIRES (client)
 *
 * Le client importe sa liste de destinataires (Excel/CSV) pour ne pas tout
 * retaper : Nom, Adresse, Code postal, Ville, Téléphone, Email (optionnel).
 * Colonnes tolérantes (accents/casse). Aperçu + dédoublonnage avant création
 * dans le carnet d'adresses (SavedAddress, type 'delivery').
 */
import React, { useState, useRef, useEffect } from 'react';
import Modal from './shared/Modal';
import * as XLSX from 'xlsx';
import { decodeClientCsv } from '../utils/clientImportFile';
import { User, SavedAddress } from '../types';
import { addSavedAddress } from '../services/firestore';
import { X, Upload, CheckCircle, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';

interface ImportRecipientsModalProps {
  currentUser: User;
  existingAddresses: SavedAddress[];
  onClose: () => void;
  onDone: (count: number) => void;
  onViewRecipients?: () => void;
}

interface ParsedRow {
  line: number;
  contactName: string;
  address: string;
  city: string;         // "CP Ville"
  contactPhone: string;
  contactEmail?: string;
  _status: 'ok' | 'duplicate' | 'invalid' | 'confirmed' | 'unconfirmed';
  _reason?: string;
}

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const digits = (s: string) => String(s || '').replace(/\D+/g, '');

// Trouve la colonne dont l'entête matche un des alias.
// Passe 1 = match EXACT (sinon l'alias 'nom' attrape 'prénom' par sous-chaîne et le
// prénom se retrouve dans contactName). Passe 2 = repli sous-chaîne.
const pick = (row: Record<string, any>, aliases: string[]): string => {
  const keys = Object.keys(row);
  const val = (key: string): string | null => {
    const v = row[key];
    return v != null && String(v).trim() !== '' ? String(v).trim() : null;
  };
  for (const key of keys) {
    if (aliases.includes(norm(key))) { const v = val(key); if (v !== null) return v; }
  }
  for (const key of keys) {
    const k = norm(key);
    if (aliases.some(a => k.includes(a))) { const v = val(key); if (v !== null) return v; }
  }
  return '';
};

const ImportRecipientsModal: React.FC<ImportRecipientsModalProps> = ({ currentUser, existingAddresses, onClose, onDone, onViewRecipients }) => {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(100);
  const importingRef = useRef(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (complete) resultRef.current?.focus({ preventScroll: true }); }, [complete]);
  const inputRef = useRef<HTMLInputElement>(null);

  const existKey = new Set(
    existingAddresses.map(a => `${norm(a.contactName)}|${norm(a.address)}`)
  );
  const existPhones = new Set(existingAddresses.map(a => digits(a.contactPhone)).filter(Boolean));

  const handleFile = async (file: File) => {
    if (importing || complete) return;
    setError('');
    setRows(null);
    if (file.size > 5 * 1024 * 1024) { setError('Fichier trop volumineux : 5 Mo maximum.'); return; }
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = /\.csv$/i.test(file.name)
        ? XLSX.read(decodeClientCsv(buf), { type: 'string', raw: true, sheetRows: 10002 })
        : XLSX.read(buf, { type: 'array', sheetRows: 10002 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });

      if (raw.length > 10000) { setError('Limite de 10 000 lignes par fichier.'); return; }
      const seen = new Set<string>();
      const parsed: ParsedRow[] = raw.map((r, index) => {
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
        } else if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
          _status = 'invalid'; _reason = 'Email invalide';
        } else {
          const key = `${norm(contactName)}|${norm(address)}`;
          const phoneKey = digits(contactPhone);
          if (existKey.has(key) || (phoneKey && existPhones.has(phoneKey)) || seen.has(key)) {
            _status = 'duplicate';
            _reason = seen.has(key) ? 'Doublon dans le fichier' : 'Déjà dans le carnet (même contact/adresse ou téléphone)';
          } else {
            seen.add(key);
          }
        }
        return { line: Number.isInteger(r.__rowNum__) ? r.__rowNum__ + 1 : index + 2, contactName, address, city, contactPhone, contactEmail: contactEmail || undefined, _status, _reason };
      });

      if (parsed.length === 0) { setError('Aucune ligne trouvée dans le fichier.'); return; }
      setRows(parsed);
    } catch (e) {
      setError("Impossible de lire le fichier. Vérifiez que c'est bien un .xlsx ou .csv.");
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

  const confirmedRows = (rows || []).filter(row => row._status === 'confirmed');
  const unconfirmedRows = (rows || []).filter(row => row._status === 'unconfirmed');
  const visibleRows = (rows || []).filter(row => !onlyErrors || ['invalid', 'unconfirmed', 'duplicate'].includes(row._status));
  const exportRejected = () => {
    const rejected = (rows || []).filter(row => ['invalid', 'unconfirmed', 'duplicate'].includes(row._status));
    const sheet = XLSX.utils.json_to_sheet(rejected.map(row => ({ Nom: row.contactName, Adresse: row.address, Ville: row.city, Téléphone: row.contactPhone, Email: row.contactEmail || '', 'Ligne source': row.line, Motif: row._reason })));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Destinataires à vérifier'); XLSX.writeFile(workbook, 'destinataires-a-corriger.xlsx');
  };

  const handleImport = async () => {
    if (!okRows.length || importingRef.current || complete) return;
    importingRef.current = true; setImporting(true); setError('');
    const updated = [...(rows || [])];
    let confirmedCount = 0;
    // Bounded concurrency, with a result per source line instead of silently discarding failures.
    for (let offset = 0; offset < okRows.length; offset += 10) {
      await Promise.all(okRows.slice(offset, offset + 10).map(async row => {
        const index = updated.findIndex(item => item.line === row.line);
        try {
          await addSavedAddress({ companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`, createdBy: currentUser.id, label: row.contactName, type: 'delivery', address: row.address, city: row.city, contactName: row.contactName, contactPhone: row.contactPhone, contactEmail: row.contactEmail, createdAt: '', updatedAt: '' });
          updated[index] = { ...row, _status: 'confirmed', _reason: 'Enregistrement confirmé' };
          confirmedCount++;
        } catch {
          updated[index] = { ...row, _status: 'unconfirmed', _reason: 'Enregistrement non confirmé. Vérifiez le carnet avant de réimporter cette ligne.' };
        }
      }));
      setRows([...updated]);
    }
    setComplete(true); setImporting(false); importingRef.current = false;
    onDone(confirmedCount);
  };

  return (
    <Modal isOpen onClose={onClose} title={complete ? 'Bilan de l’import du carnet' : 'Importer mes destinataires'} headerIcon={<FileSpreadsheet size={22} />} size="2xl" preventClose={importing} dirty={Boolean(rows) && !complete}>
        {!rows && (
          <>
            <p className="text-sm text-slate-600 mb-3">
              Importez votre liste (Excel/CSV). Colonnes reconnues : <b>Nom</b>, <b>Adresse</b>, <b>Code postal</b>, <b>Ville</b>, <b>Téléphone</b>, <b>Email</b> (facultatif, pour la copie du bon de livraison).
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
            <p className="text-[11px] text-slate-400 text-center mt-1">Remplissez le modèle avec vos destinataires, puis importez-le.</p>
          </>
        )}

        {error && <div role="alert" className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}

        {rows && (
          <>
            <p className="text-xs text-slate-500 mb-2">{fileName}</p>
            <div role="status" className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border bg-indigo-50 p-2 text-center text-indigo-900"><div className="text-xl font-bold">{confirmedRows.length}</div><div className="text-sm">Confirmés</div></div>
              {unconfirmedRows.length > 0 && <div className="rounded-lg border bg-red-50 p-2 text-center text-red-900"><div className="text-xl font-bold">{unconfirmedRows.length}</div><div className="text-sm">À vérifier dans le carnet</div></div>}
              <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center"><div className="text-xl font-extrabold text-green-700">{okRows.length}</div><div className="text-[11px] text-green-700">À importer</div></div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center"><div className="text-xl font-extrabold text-amber-700">{dupRows.length}</div><div className="text-[11px] text-amber-700">Doublons</div></div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center"><div className="text-xl font-extrabold text-red-700">{badRows.length}</div><div className="text-[11px] text-red-700">Rejetés</div></div>
            </div>
            <div className="mb-3 flex flex-wrap gap-3 items-center">
              <label className="min-h-11 flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyErrors} onChange={event => { setOnlyErrors(event.target.checked); setDisplayLimit(100); }} /> Erreurs et doublons uniquement</label>
              {(badRows.length + dupRows.length + unconfirmedRows.length) > 0 && <button type="button" onClick={exportRejected} className="min-h-11 rounded-xl border px-3 text-sm font-semibold">Exporter les lignes à corriger ou vérifier</button>}
            </div>
            {complete && <p ref={resultRef} tabIndex={-1} role="status" className="mb-3 text-sm text-slate-700">Import terminé : {rows.length} lignes traitées. {confirmedRows.length} enregistrements confirmés, {badRows.length} rejetés, {dupRows.length} doublons et {unconfirmedRows.length} à vérifier. Les lignes non confirmées doivent être contrôlées dans le carnet avant une nouvelle tentative.</p>}
            <div className="max-h-72 overflow-y-auto flex-1 border border-slate-100 rounded-lg divide-y divide-slate-100 mb-3">
              {visibleRows.slice(0, displayLimit).map((r, i) => (
                <div key={i} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-1 px-3 py-3 text-sm">
                  {['ok', 'confirmed'].includes(r._status) && <CheckCircle size={14} className="text-green-500 shrink-0" />}
                  {r._status === 'duplicate' && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                  {['invalid', 'unconfirmed'].includes(r._status) && <X size={14} className="text-red-500 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 break-words">Ligne {r.line} · {r.contactName || <span className="text-red-400">Nom manquant</span>}</div>
                    <div className="text-slate-500 truncate">{r.address} {r.city} · {r.contactPhone}{r.contactEmail ? ` · ${r.contactEmail}` : ''}</div>
                  </div>
                  {r._reason && <span className="col-start-2 text-sm text-slate-600 break-words">{r._reason}</span>}
                </div>
              ))}
            </div>
            {visibleRows.length > displayLimit && <button type="button" onClick={() => setDisplayLimit(limit => limit + 100)} className="w-full min-h-11 text-indigo-800 text-sm font-semibold">Afficher 100 lignes supplémentaires ({Math.min(displayLimit, visibleRows.length)}/{visibleRows.length})</button>}
            {complete ? <button type="button" onClick={() => { onClose(); onViewRecipients?.(); }} className="w-full min-h-11 rounded-xl bg-indigo-700 text-white font-semibold">{onViewRecipients ? 'Consulter mon carnet' : 'Terminer'}</button> : <div className="flex gap-2">
              <button disabled={importing} onClick={() => { setRows(null); setFileName(''); }} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm">Changer de fichier</button>
              <button
                onClick={handleImport}
                disabled={okRows.length === 0 || importing}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm disabled:opacity-40"
              >
                {importing ? 'Import en cours…' : `Importer ${okRows.length} destinataire(s)`}
              </button>
            </div>}
          </>
        )}
    </Modal>
  );
};

export default ImportRecipientsModal;
