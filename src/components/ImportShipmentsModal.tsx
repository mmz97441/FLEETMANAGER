import { useClientAccess } from './client/ClientAccessContext';
/**
 * IMPORT EN MASSE D'EXPÉDITIONS (client expéditeur)
 *
 * Le client importe un fichier (Excel/CSV) : une ligne = un colis identifié par
 * son numéro (ex. BR-…). Un CONTRÔLE QUALITÉ vérifie chaque ligne et affiche
 * TOUTES les erreurs AVANT l'import (numéro manquant/invalide, doublons, adresse
 * incomplète…). Seules les lignes valides sont importées, puis les étiquettes
 * sont imprimées au format choisi (A4/A5/A6).
 */
import React, { useState, useRef, useMemo, useEffect } from 'react';
import Modal from './shared/Modal';
import { shipmentImportCounts } from '../utils/clientShipmentForm';
import * as XLSX from 'xlsx';
import { decodeClientCsv } from '../utils/clientImportFile';
import { createClientShipmentsBatch, getPackagesByIds } from '../services/missionService';
import { estimateZoneFromAddress } from '../services/deliveryService';
import { generateBatchLabelsHTML, LabelFormat } from '../services/pickupService';
import { User, Package, Zone } from '../types';
import { Upload, FileSpreadsheet, X, AlertTriangle, CheckCircle, Download, Printer, CalendarDays } from 'lucide-react';

// Date locale YYYY-MM-DD (évite le décalage UTC de toISOString).
const localISO = (d: Date) => {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
// Prochain jour ouvré (demain, en sautant le dimanche) — défaut de livraison.
const nextWorkingDayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1); // dimanche → lundi
  return localISO(d);
};

interface ImportShipmentsModalProps {
  currentUser: User;
  onClose: () => void;
  onImported: (count: number) => void;
  onViewPackages?: () => void;
}

interface ParsedRow {
  line: number;               // numéro de ligne dans le fichier (1 = entêtes)
  colisNumber: string;
  carrierBarcode: string;
  contactName: string;
  address: string;
  postalCode: string;
  city: string;
  contactPhone: string;
  contactEmail: string;
  weight: string;
  clientReference: string;
  comment: string;
  errors: string[];
}

// Normalisation d'entête : minuscule + suppression des accents.
// IMPORTANT : plage unicode de combinaison (accents) via échappement, jamais de
// caractère combinant collé littéralement.
const normalize = (s: string): string =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Alias d'entêtes acceptés (déjà normalisés). Couvre le modèle DELIVREX ET les
// exports courants (ex. fichier tournée : « Numéro colis », « Contact », « Adress »,
// « Order Number », « Comment », « Weight »…).
const HEADER_ALIASES: Record<keyof Omit<ParsedRow, 'line' | 'errors'>, string[]> = {
  carrierBarcode: ['code boiron', 'code transporteur', 'carrierbarcode', 'carrier barcode', 'barcode boiron'],
  colisNumber: ['numero de colis', 'numero colis', 'n° colis', 'n colis', 'colis', 'code colis', 'br', 'barcode', 'code barre'],
  contactName: ['nom du destinataire', 'destinataire', 'nom', 'pharmacie', 'contact', 'client', 'raison sociale'],
  address: ['adresse', 'adress', 'address'],
  postalCode: ['code postal', 'cp', 'postal code', 'zip'],
  city: ['ville', 'city', 'commune'],
  contactPhone: ['telephone', 'tel', 'phone', 'gsm', 'mobile', 'portable'],
  contactEmail: ['email', 'e-mail', 'mail', 'courriel'],
  weight: ['poids (kg)', 'poids', 'weight'],
  clientReference: ['reference', 'ref', 'order number', 'numero de commande', 'n° commande', 'commande', 'order'],
  comment: ['remarque', 'consignes', 'note', 'comment', 'commentaire', 'instructions'],
};

// Éclate une adresse « tout-en-un » (rue + CP + ville) en trois morceaux.
// Ex. « 19 RUE ADRIEN LAGOURGUE  97424 PITON SAINT LEU »
//   → { street: '19 RUE ADRIEN LAGOURGUE', postalCode: '97424', city: 'PITON SAINT LEU' }
const splitAddress = (full: string): { street: string; postalCode: string; city: string } => {
  const s = String(full || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/(97\d{3}|98\d{3}|\d{5})/); // Réunion/Outre-mer 97xxx/98xxx, sinon 5 chiffres
  if (!m) return { street: s, postalCode: '', city: '' };
  const cp = m[1];
  const idx = s.indexOf(cp);
  const street = s.slice(0, idx).trim().replace(/[,;]+$/, '').trim();
  const city = s.slice(idx + cp.length).trim().replace(/^[,;]+/, '').trim();
  return { street: street || s, postalCode: cp, city };
};

// Récupère la valeur d'une colonne en cherchant l'entête par égalité normalisée.
const getField = (row: Record<string, any>, field: keyof typeof HEADER_ALIASES): string => {
  const aliases = HEADER_ALIASES[field];
  for (const key of Object.keys(row)) {
    if (aliases.includes(normalize(key))) {
      const v = row[key];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
};

const ImportShipmentsModal: React.FC<ImportShipmentsModalProps> = ({ currentUser, onClose, onImported, onViewPackages }) => {
  const access = useClientAccess();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<LabelFormat>('A6');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(100);
  const [confirmed, setConfirmed] = useState<Map<number, Package>>(new Map());
  const confirmedRef = useRef<Map<number, Package>>(new Map());
  const importingRef = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [printError, setPrintError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (complete) resultRef.current?.focus({ preventScroll: true }); }, [complete]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');       // erreur de lecture / d'import
  const [deliveryDate, setDeliveryDate] = useState<string>(nextWorkingDayISO()); // jour de livraison souhaité
  const inputRef = useRef<HTMLInputElement>(null);
  const todayISOLocal = localISO(new Date());

  const resetFile = () => {
    if (busy || attempted) return;
    setRows(null);
    setOnlyErrors(false);
    setDisplayLimit(100);
    setFileName('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    if (busy || attempted) return;
    setRows(null);
    setDisplayLimit(100);
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('Fichier trop volumineux (5 Mo maximum).'); return; }
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = /\.csv$/i.test(file.name)
        ? XLSX.read(decodeClientCsv(buf), { type: 'string', raw: true, sheetRows: 10002 })
        : XLSX.read(buf, { type: 'array', sheetRows: 10002 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });
      const originalCells = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: true });

      if (raw.length > 10000) { setError('Limite de 10 000 lignes par fichier.'); setRows(null); return; }
      if (raw.length === 0) { setError('Aucune ligne trouvée dans le fichier.'); setRows(null); return; }

      // 1er passage : lecture + mapping des colonnes
      const parsed: ParsedRow[] = raw.map((r, i) => {
        const addressRaw = getField(r, 'address');
        let street = addressRaw;
        let postalCode = getField(r, 'postalCode');
        let city = getField(r, 'city');
        // Adresse « tout-en-un » : si CP/ville absents, on les extrait de l'adresse.
        if (!postalCode || !city) {
          const sp = splitAddress(addressRaw);
          if (sp.postalCode) {
            if (!postalCode) postalCode = sp.postalCode;
            if (!city) city = sp.city;
            street = sp.street; // on ne garde que la rue dans l'adresse
          }
        }
        return {
          line: Number.isInteger(r.__rowNum__) ? r.__rowNum__ + 1 : i + 2,               // ligne 1 = entêtes
          colisNumber: getField(r, 'colisNumber'),
          carrierBarcode: getField(r, 'carrierBarcode'),
          contactName: getField(r, 'contactName'),
          address: street,
          postalCode,
          city,
          contactPhone: getField(r, 'contactPhone'),
          contactEmail: getField(r, 'contactEmail'),
          weight: getField(r, 'weight'),
          clientReference: getField(r, 'clientReference'),
          comment: getField(r, 'comment'),
          errors: Object.entries(originalCells[i] || {}).some(([key, value]) => HEADER_ALIASES.carrierBarcode.includes(normalize(key)) && typeof value === 'number')
            ? ['Code Boiron numérique : reformatez la cellule en texte et recopiez les 22 chiffres depuis l’étiquette.'] : [],
        };
      });

      // Comptage des numéros de colis (pour repérer les doublons dans le fichier)
      const counts = new Map<string, number>();
      const carrierCounts = new Map<string, number>();
      for (const p of parsed) {
        const key = p.colisNumber.trim().toUpperCase();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
        if (p.carrierBarcode) carrierCounts.set(p.carrierBarcode, (carrierCounts.get(p.carrierBarcode) || 0) + 1);
      }

      // 2e passage : contrôle qualité, une liste d'erreurs par ligne
      for (const p of parsed) {
        if (p.carrierBarcode && (!/^00\d{20}$/.test(p.carrierBarcode) || p.carrierBarcode.slice(2, 10) !== p.clientReference.trim())) p.errors.push('Code Boiron invalide ou différent de la référence de commande');
        if (p.carrierBarcode && (carrierCounts.get(p.carrierBarcode) || 0) > 1) p.errors.push('Code Boiron attribué à plusieurs lignes');
        const num = p.colisNumber.trim();
        if (!num) {
          p.errors.push('Numéro de colis manquant');
        } else {
          if (!num.toUpperCase().startsWith('BR')) {
            p.errors.push('Numéro de colis invalide (doit commencer par BR)');
          }
          if ((counts.get(num.toUpperCase()) || 0) > 1) {
            p.errors.push('Numéro de colis en double dans le fichier');
          }
        }
        if (!p.contactName.trim()) p.errors.push('Nom du destinataire manquant');
        if (!p.address.trim()) p.errors.push('Adresse manquante');
        if (!p.city.trim() && !p.postalCode.trim()) p.errors.push('Ville et code postal manquants');
        if (!p.contactPhone.trim()) p.errors.push('Téléphone manquant');
        if (p.postalCode && !/^\d{5}$/.test(p.postalCode)) p.errors.push('Code postal invalide (5 chiffres attendus)');
        if (p.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.contactEmail)) p.errors.push('Email invalide');
        if (p.weight && (!Number.isFinite(Number(p.weight.replace(',', '.'))) || Number(p.weight.replace(',', '.')) < 0)) p.errors.push('Poids invalide (kilogrammes positifs ou nuls)');
      }

      setRows(parsed);
    } catch (e) {
      setError("Impossible de lire le fichier. Vérifiez que c'est bien un .xlsx, .xls ou .csv.");
      setRows(null);
    }
  };

  const downloadTemplate = () => {
    // Modèle aligné sur les exports de tournée habituels : l'adresse contient la
    // rue + le code postal + la ville dans une seule colonne (séparés à l'import).
    const example = [
      {
        'Numéro de colis': 'BR1148',
        'Destinataire': 'SARL PHCIE DU PITON',
        'Adresse': '19 RUE ADRIEN LAGOURGUE 97424 PITON SAINT LEU',
        'Téléphone': '0262343377',
        'Référence': '13953047',
        'Code Boiron': '',
        'Remarque': '',
      },
      {
        'Numéro de colis': 'BR1156',
        'Destinataire': 'PHCIE LA RAVINE',
        'Adresse': '2 CHEMIN MOULIN A CAFE 97432 RAVINE DES CABRIS',
        'Téléphone': '0262495044',
        'Référence': '13953057',
        'Remarque': 'Livrer avant 12h',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(example);
    ws['!cols'] = [
      { wch: 16 }, { wch: 26 }, { wch: 46 }, { wch: 16 }, { wch: 14 }, { wch: 24 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expéditions');
    XLSX.writeFile(wb, 'modele-expeditions.xlsx');
  };

  const invalidRows = useMemo(() => (rows || []).filter(r => r.errors.length > 0), [rows]);
  const validRows = useMemo(() => (rows || []).filter(r => r.errors.length === 0), [rows]);
  const totalCount = rows?.length || 0;
  const validCount = validRows.length;
  const errorCount = invalidRows.length;

  const outcomes = shipmentImportCounts(rows || [], new Set(confirmed.keys()));
  const orderedRows = onlyErrors ? invalidRows : [...invalidRows, ...validRows];
  const visibleRows = orderedRows.slice(0, displayLimit);

  const exportRejected = () => {
    const rejected = (rows || []).filter(row => row.errors.length || (attempted && !confirmed.has(row.line)));
    const worksheet = XLSX.utils.json_to_sheet(rejected.map(row => ({
      'Numéro de colis': row.colisNumber, Destinataire: row.contactName, Adresse: row.address,
      'Code postal': row.postalCode, Ville: row.city, Téléphone: row.contactPhone, Email: row.contactEmail,
      'Poids (kg)': row.weight, Référence: row.clientReference, 'Code Boiron': row.carrierBarcode, Remarque: row.comment,
      'Ligne source': row.line, Motif: row.errors.join(' ; ') || 'Import non confirmé : reprendre la même référence pour vérifier sans doublon',
    })));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Lignes à vérifier');
    XLSX.writeFile(workbook, 'expeditions-a-corriger.xlsx');
  };

  const printConfirmed = () => {
    setPrintError('');
    try {
      const win = window.open('', '_blank');
      if (!win) { setPrintError('Fenêtre d’impression bloquée. Autorisez les fenêtres de ce site puis réessayez. Les colis sont enregistrés.'); return; }
      win.opener = null;
      win.document.write(generateBatchLabelsHTML([...confirmed.values()], currentUser.companyName || 'Expéditeur', format));
      win.document.close();
    } catch { setPrintError('Impression indisponible. Vous pouvez réimprimer les colis depuis Mes colis.'); }
  };

  const handleImport = async () => {
    if (access.readOnly || validCount === 0 || importingRef.current || complete) return;
    if (!deliveryDate) { setError('Choisissez la date de livraison souhaitée.'); return; }
    if (!attempted && deliveryDate < todayISOLocal) { setError('La date de livraison ne peut pas être dans le passé.'); return; }
    importingRef.current = true; setBusy(true); setAttempted(true); setError('');
    try {
      const remaining = validRows.filter(row => !confirmedRef.current.has(row.line));
      for (let offset = 0; offset < remaining.length; offset += 150) {
        const batch = remaining.slice(offset, offset + 150);
        const rowsWithZone: Array<Omit<ParsedRow, 'weight'> & { weight?: number; zone?: Zone }> = [];
        // Address estimation is local and may fall back to the transporter's zone review.
        for (const row of batch) {
          let zone: Zone | undefined;
          try { zone = (await estimateZoneFromAddress(`${row.address}, ${row.postalCode} ${row.city}`))?.zone; } catch { /* transporteur ajuste */ }
          rowsWithZone.push({ ...row, weight: row.weight ? Number(row.weight.replace(',', '.')) : undefined, zone });
        }
        const packages = await access.runMutation('Importer des expéditions', () => createClientShipmentsBatch({
          client: { id: currentUser.id, companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}` },
          deliveryDate, rows: rowsWithZone,
        }));
        const stored = new Map((await getPackagesByIds(packages.map(parcel => parcel.id))).map(parcel => [parcel.id, parcel]));
        if (stored.size !== new Set(packages.map(parcel => parcel.id)).size) throw new Error('Certains colis enregistrés n’ont pas pu être relus.');
        packages.forEach((parcel, index) => confirmedRef.current.set(batch[index].line, stored.get(parcel.id)!));
        setConfirmed(new Map(confirmedRef.current));
      }
      setComplete(true);
      onImported(confirmedRef.current.size);
    } catch (cause) {
      setError(`${confirmedRef.current.size} ligne${confirmedRef.current.size > 1 ? 's' : ''} confirmée${confirmedRef.current.size > 1 ? 's' : ''}. Les autres restent à vérifier. ${cause instanceof Error ? cause.message : 'La connexion a été interrompue.'} Reprendre vérifie les mêmes références sans recréer les colis existants.`);
    } finally { importingRef.current = false; setBusy(false); }
  };

  return (
    <Modal mobileFullscreen subtitle={access.contextLabel} isOpen onClose={onClose} title={complete ? 'Bilan de l’import' : 'Importer mes expéditions'} headerIcon={<FileSpreadsheet size={22} />} size="2xl" preventClose={busy} dirty={Boolean(rows) && !complete} footer={rows ? (!complete && <div className="flex flex-col sm:flex-row gap-2">
              <button
                disabled={busy || attempted}
                onClick={resetFile}
                className="ui-button ui-button-secondary text-sm"
              >
                Changer de fichier
              </button>
              <button
                onClick={handleImport}
                disabled={validCount === 0 || busy}
                className="ui-button ui-button-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-40"
              >
                <CheckCircle size={16} />
                {busy
                  ? 'Import en cours…'
                  : attempted ? `Reprendre ${outcomes.pending} ligne${outcomes.pending > 1 ? 's' : ''} non confirmée${outcomes.pending > 1 ? 's' : ''}` : `Importer ${validCount} expédition${validCount > 1 ? 's' : ''} valide${validCount > 1 ? 's' : ''}`}
              </button>
            </div>) : undefined}>
        {attempted && <div ref={resultRef} tabIndex={-1} role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 mb-4 text-sm text-brand-900">
          <p className="font-bold">{complete ? 'Import terminé' : busy ? 'Import en cours…' : 'Import interrompu'}</p>
          <p className="mt-1">{outcomes.total} ligne{outcomes.total > 1 ? 's' : ''} : {outcomes.confirmed} confirmée{outcomes.confirmed > 1 ? 's' : ''} · {outcomes.invalid} rejetée{outcomes.invalid > 1 ? 's' : ''} · {outcomes.duplicates} doublon{outcomes.duplicates > 1 ? 's' : ''} dans le fichier · {outcomes.pending} non confirmée{outcomes.pending > 1 ? 's' : ''}.</p>
          <p className="mt-1">Une référence confirmée est enregistrée, créée maintenant ou déjà présente. Les références existantes ne sont pas recréées.</p>
        </div>}
        {confirmed.size > 0 && <div className="space-y-3 mb-4">
          <details><summary className="cursor-pointer text-sm font-semibold text-slate-700 min-h-11">Référence{confirmed.size > 1 ? 's' : ''} confirmée{confirmed.size > 1 ? 's' : ''} ({confirmed.size})</summary><ul className="max-h-40 overflow-auto text-sm font-mono break-all">{[...confirmed].map(([line, parcel]) => <li key={line}>Ligne {line} : {parcel.externalId || parcel.barcode || parcel.orderNumber}</li>)}</ul></details>
          <label htmlFor="import-label-format" className="block text-sm font-semibold">Format d’étiquette</label>
          <select id="import-label-format" value={format} onChange={event => setFormat(event.target.value as LabelFormat)} className="w-full min-h-11 border rounded-xl px-3">{['A4', 'A5', 'A6'].map(value => <option key={value}>{value}</option>)}</select>
          <button type="button" disabled={busy} onClick={printConfirmed} className="ui-button ui-button-secondary w-full min-h-11 border flex items-center justify-center gap-2"><Printer size={18} /> Imprimer les colis confirmés</button>
          {printError && <p role="alert" className="text-sm text-red-800">{printError}</p>}
          {complete && <button type="button" onClick={() => { onClose(); onViewPackages?.(); }} className="ui-button ui-button-primary w-full min-h-11">{onViewPackages ? 'Voir mes colis' : 'Terminer'}</button>}
        </div>}
        {/* Étape 1 : choisir un fichier */}
        {!rows && (
          <>
            <p className="text-sm text-slate-600 mb-3">
              Importez votre fichier (Excel/CSV). Une ligne = un colis. Les colonnes sont{' '}
              <b>détectées automatiquement</b> : numéro de colis (BR…), destinataire, adresse
              (le code postal et la ville sont reconnus même s'ils sont dans la même case),
              téléphone, et si présents e-mail, poids, référence, remarque. Pas besoin de reformater
              votre fichier habituel.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="ui-button ui-button-primary w-full flex flex-col items-center justify-center gap-2"
            >
              <Upload size={28} />
              <span className="font-bold text-sm">Choisir un fichier .xlsx / .xls / .csv</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <button
              onClick={downloadTemplate}
              className="ui-button ui-button-secondary mt-3 w-full flex items-center justify-center gap-2 text-sm"
            >
              <Download size={16} /> Télécharger le fichier modèle
            </button>
            <p className="text-sm text-slate-600 text-center mt-1">
              Remplissez le modèle avec vos expéditions, puis importez-le. Chaque numéro de colis doit commencer par BR.
              Pour Boiron, ajoutez le code de chaque carton dans la colonne « Code Boiron », au format texte pour conserver les 22 chiffres.
            </p>
          </>
        )}

        {error && (
          <div role="alert" className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Étape 2 : rapport de contrôle qualité */}
        {rows && (
          <>
            <p className="text-sm text-slate-600 mb-2">{fileName}</p>

            {/* Bandeau de synthèse */}
            <div
              className={`rounded-xl px-4 py-3 mb-3 flex items-center gap-2 text-sm font-semibold border ${
                errorCount === 0
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              {errorCount === 0 ? <CheckCircle size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
              <span>{totalCount} ligne{totalCount > 1 ? 's' : ''} lue{totalCount > 1 ? 's' : ''} · {validCount} valide{validCount > 1 ? 's' : ''} · {errorCount} avec erreur</span>
            </div>

            {/* DATE DE LIVRAISON SOUHAITÉE — chaque colis est daté pour CE jour
                (et non le jour du dépôt) → la tournée sera planifiée le bon jour. */}
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 mb-3">
              <label htmlFor="import-delivery-date" className="flex items-center gap-2 text-sm font-bold text-brand-800 mb-1">
                <CalendarDays size={16} /> Date de livraison souhaitée
              </label>
              <input
                id="import-delivery-date"
                disabled={busy || attempted}
                type="date"
                value={deliveryDate}
                min={todayISOLocal}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-base focus:ring-2 focus:ring-brand-500 outline-none min-h-11"
              />
              <p className="text-sm text-slate-600 mt-1">Date demandée pour préparer la tournée ; elle sera confirmée par le transporteur.</p>
            </div>

            <div className="flex flex-wrap gap-3 mb-3 items-center">
              <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" checked={onlyErrors} onChange={event => { setOnlyErrors(event.target.checked); setDisplayLimit(100); }} /> Erreurs uniquement ({errorCount})</label>
              {(errorCount > 0 || (attempted && outcomes.pending > 0)) && <button type="button" disabled={busy} onClick={exportRejected} className="ui-button ui-button-secondary min-h-11 border text-sm flex items-center gap-2"><Download size={16} /> Exporter les lignes à corriger ou vérifier</button>}
            </div>
            <div className="sm:max-h-72 sm:overflow-y-auto border-t border-slate-200 divide-y mb-3">
              {visibleRows.map(row => <div key={row.line} className={`p-3 text-sm ${row.errors.length ? 'bg-red-50 text-red-900' : 'text-slate-700'}`}>
                <p className="font-semibold break-words">Ligne {row.line} · {row.colisNumber || '(sans numéro)'} · {row.contactName || '(sans destinataire)'}</p>
                {row.carrierBarcode && <p className="break-all">Code Boiron : {row.carrierBarcode} · Commande : {row.clientReference}</p>}
                {row.errors.length ? <ul className="mt-1 list-disc pl-5">{row.errors.map(message => <li key={message}>{message}</li>)}</ul> : <p>{confirmed.has(row.line) ? 'Confirmé : enregistré' : attempted ? 'Non confirmé' : 'Prêt à importer'} · {row.city}</p>}
              </div>)}
              {visibleRows.length === 0 && <p className="p-3 text-sm text-slate-600">Aucune ligne en erreur.</p>}
              {orderedRows.length > displayLimit && <button type="button" onClick={() => setDisplayLimit(limit => limit + 100)} className="ui-button ui-button-ghost w-full min-h-11 text-sm">Afficher 100 lignes supplémentaires ({visibleRows.length}/{orderedRows.length})</button>}
            </div>
            {/* Note : les lignes en erreur ne sont pas importées */}
            <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
              Les lignes rejetées et les doublons du fichier ne sont pas importés. Exportez-les pour corriger uniquement ces lignes ; conservez leurs références.
            </p>


          </>
        )}
    </Modal>
  );
};

export default ImportShipmentsModal;
