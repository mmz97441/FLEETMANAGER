import { ImportBatchFailure } from '../services/importBatchWriter';
import { parseClientShipmentWorkbook, type ParsedClientShipmentRow as ParsedRow } from '../utils/clientShipmentImport';
import { importReference } from '../utils/importManifest';
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

const ImportShipmentsModal: React.FC<ImportShipmentsModalProps> = ({ currentUser, onClose, onImported, onViewPackages }) => {
  const access = useClientAccess();
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [ignoredColumns, setIgnoredColumns] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<LabelFormat>('A6');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(100);
  const [confirmed, setConfirmed] = useState<Map<number, Package>>(new Map());
  const confirmedRef = useRef<Map<number, Package>>(new Map());
  const registeredRef = useRef<Map<number, string>>(new Map());
  const [registered, setRegistered] = useState<Map<number, string>>(new Map());
  const [uncertain, setUncertain] = useState<Set<number>>(new Set());
  const [serverRejected, setServerRejected] = useState<Map<number, string>>(new Map());
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
    setFileName(''); setIgnoredColumns([]);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    if (busy || attempted) return;
    setRows(null);
    setDisplayLimit(100);
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('Fichier trop volumineux (5 Mo maximum).'); return; }
    setFileName(file.name); setIgnoredColumns([]);
    try {
      const result = parseClientShipmentWorkbook(await file.arrayBuffer(), file.name);
      setRows(result.rows); setIgnoredColumns(result.ignoredColumns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de lire le fichier. Vérifiez son format.");
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
        'Code transporteur': '',
        'Date de livraison': '', Start: '08:00', End: '12:00', Service_Time: 5, Étage: '',
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

  const outcomes = shipmentImportCounts(rows || [], new Set(registered.keys()));
  const orderedRows = onlyErrors ? invalidRows : [...invalidRows, ...validRows];
  const visibleRows = orderedRows.slice(0, displayLimit);

  const exportRejected = () => {
    const rejected = (rows || []).filter(row => row.errors.length || (attempted && !confirmed.has(row.line)));
    const worksheet = XLSX.utils.json_to_sheet(rejected.map(row => ({
      'Numéro de colis': row.colisNumber, Destinataire: row.contactName, Adresse: row.address,
      'Code postal': row.postalCode, Ville: row.city, Téléphone: row.contactPhone, Email: row.contactEmail,
      'Poids (kg)': row.weight, Référence: row.clientReference, 'Code transporteur': row.carrierBarcode, 'Format transporteur': row.carrierBarcodeFormat, Remarque: row.comment, 'Date de livraison': row.requestedDeliveryDate, Start: row.timeWindowStart, End: row.timeWindowEnd, Service_Time: row.serviceTime, Étage: row.floor,
      'Ligne source': row.line, Motif: row.errors.join(' ; ') || serverRejected.get(row.line) || (registered.has(row.line) ? 'Enregistré : étiquette à relire' : 'Import non confirmé : reprendre la même référence pour vérifier sans doublon'),
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
    if (!deliveryDate && validRows.some(row => !row.requestedDeliveryDate)) { setError('Choisissez une date pour les lignes qui n’en ont pas.'); return; }
    if (!attempted && deliveryDate < todayISOLocal && validRows.some(row => !row.requestedDeliveryDate)) {
      setError('La date par défaut ne peut pas être dans le passé. Les dates propres au fichier restent conservées.'); return;
    }
    importingRef.current = true; setBusy(true); setAttempted(true); setError('');
    let remaining: ParsedRow[] = [];
    const confirmStored = async (pairs: Array<[number, string]>) => {
      if (!pairs.length) return;
      const stored = new Map((await getPackagesByIds(pairs.map(([, id]) => id))).map(parcel => [parcel.id, parcel]));
      for (const [line, id] of pairs) if (stored.has(id)) confirmedRef.current.set(line, stored.get(id)!);
      setConfirmed(new Map(confirmedRef.current));
      if (pairs.some(([line]) => !confirmedRef.current.has(line))) throw new Error('Enregistrement confirmé, mais certaines étiquettes ne sont pas encore disponibles. Reprenez pour relire ces colis.');
    };
    try {
      // A failed reread must not erase a receipt already returned by the server.
      await confirmStored([...registeredRef.current].filter(([line]) => !confirmedRef.current.has(line)));
      remaining = validRows.filter(row => !registeredRef.current.has(row.line));
      const prepared: Array<Omit<ParsedRow, 'weight' | 'serviceTime' | 'floor'> & { weight?: number; serviceTime?: number; floor?: number; zone?: Zone }> = [];
      for (const row of remaining) {
        let zone: Zone | undefined;
        try { zone = (await estimateZoneFromAddress(`${row.address}, ${row.postalCode} ${row.city}`))?.zone; } catch { /* transporteur ajuste */ }
        prepared.push({ ...row, zone, weight: row.weight ? Number(row.weight.replace(',', '.')) : undefined,
          serviceTime: row.serviceTime ? Number(row.serviceTime.replace(',', '.')) : undefined,
          floor: row.floor === '' ? undefined : Number(row.floor) });
      }
      await access.runMutation('Importer des expéditions', () => createClientShipmentsBatch({
        client: { id: currentUser.id, companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}` },
        deliveryDate, rows: prepared,
        manifest: { clientId: currentUser.id, references: validRows.map(row => importReference({ externalId: row.colisNumber, packageIndex: 1 })), rejectedRows: invalidRows.length },
        onConfirmed: async (packages, offset) => {
          const pairs: Array<[number, string]> = packages.map((parcel, index) => [remaining[offset + index].line, parcel.id]);
          for (const [line, id] of pairs) registeredRef.current.set(line, id);
          setRegistered(new Map(registeredRef.current));
          setUncertain(previous => new Set([...previous].filter(line => !registeredRef.current.has(line))));
          setServerRejected(previous => new Map([...previous].filter(([line]) => !registeredRef.current.has(line))));
          await confirmStored(pairs);
        },
      }));
      setComplete(true); onImported(registeredRef.current.size);
    } catch (cause) {
      if (cause instanceof ImportBatchFailure && cause.outcome !== 'confirmed') {
        const affected = remaining.slice(cause.offset, cause.offset + cause.count);
        if (cause.outcome === 'unknown') {
          setUncertain(previous => new Set([...previous, ...affected.map(row => row.line)]));
          setServerRejected(previous => new Map([...previous].filter(([line]) => !affected.some(row => row.line === line))));
        }
        else {
          setUncertain(previous => new Set([...previous].filter(line => !affected.some(row => row.line === line))));
          setServerRejected(previous => new Map([...previous, ...affected.map(row => [row.line, cause.cause instanceof Error ? cause.cause.message : 'Lot refusé par le serveur.'] as [number, string])]));
        }
      }
      const detail = cause instanceof ImportBatchFailure ? cause.cause : cause;
      setError(`${registeredRef.current.size} ligne(s) enregistrée(s). ${detail instanceof Error ? detail.message : 'La connexion a été interrompue.'} Reprenez les mêmes références pour vérifier les autres lignes sans doublon.`);
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
                  : attempted && outcomes.pending === 0 ? 'Relire les étiquettes enregistrées' : attempted ? `Reprendre ${outcomes.pending} ligne${outcomes.pending > 1 ? 's' : ''} non confirmée${outcomes.pending > 1 ? 's' : ''}` : `Importer ${validCount} expédition${validCount > 1 ? 's' : ''} valide${validCount > 1 ? 's' : ''}`}
              </button>
            </div>) : undefined}>
        {attempted && <div ref={resultRef} tabIndex={-1} role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 mb-4 text-sm text-brand-900">
          <p className="font-bold">{complete ? (outcomes.invalid || outcomes.duplicates ? 'Import partiel — lignes à vérifier' : 'Import terminé et confirmé') : busy ? 'Import en cours…' : 'Import interrompu'}</p>
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
              <b>détectées automatiquement</b> : numéro individuel du colis, destinataire, adresse
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
              Remplissez le modèle avec vos expéditions, puis importez-le. Chaque carton doit avoir un numéro individuel unique, conservé dans une cellule texte (ex. BR1148, EXP-A/0042 ou 000012345678).
              Pour Boiron, ajoutez le code de chaque carton dans la colonne « Code Boiron », au format texte pour conserver les 22 chiffres.
            </p>
          </>
        )}

        {ignoredColumns.length > 0 && <p role="alert" className="ui-notice ui-notice-warning mt-3">Colonnes non importées : {ignoredColumns.join(', ')}. Vérifiez que ces informations ne sont pas nécessaires à la livraison avant de continuer.</p>}
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

            {attempted && <div role="status" className="ui-notice ui-notice-info mb-3">
              <p>{registered.size} enregistré(s) · {uncertain.size} résultat(s) inconnu(s) · {serverRejected.size + errorCount} rejeté(s)</p>
            </div>}
            {/* DATE DE LIVRAISON SOUHAITÉE — chaque colis est daté pour CE jour
                (et non le jour du dépôt) → la tournée sera planifiée le bon jour. */}
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 mb-3">
              <label htmlFor="import-delivery-date" className="flex items-center gap-2 text-sm font-bold text-brand-800 mb-1">
                <CalendarDays size={16} /> Date de livraison par défaut
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
              <p className="text-sm text-slate-600 mt-1">Utilisée uniquement pour les lignes sans date propre. Les dates et créneaux du fichier sont conservés, puis confirmés par le transporteur.</p>
              {validRows.some(row => row.requestedDeliveryDate && row.requestedDeliveryDate < todayISOLocal) && <p role="status" className="text-sm text-amber-800 mt-1">Le fichier contient des dates antérieures. Elles sont conservées pour les reprises ou envois en retard ; le transporteur confirmera leur planification.</p>}
            </div>

            <div className="flex flex-wrap gap-3 mb-3 items-center">
              <label className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" checked={onlyErrors} onChange={event => { setOnlyErrors(event.target.checked); setDisplayLimit(100); }} /> Erreurs uniquement ({errorCount})</label>
              {(errorCount > 0 || (attempted && outcomes.pending > 0)) && <button type="button" disabled={busy} onClick={exportRejected} className="ui-button ui-button-secondary min-h-11 border text-sm flex items-center gap-2"><Download size={16} /> Exporter les lignes à corriger ou vérifier</button>}
            </div>
            <div className="sm:max-h-72 sm:overflow-y-auto border-t border-slate-200 divide-y mb-3">
              {visibleRows.map(row => <div key={row.line} className={`p-3 text-sm ${row.errors.length ? 'bg-red-50 text-red-900' : 'text-slate-700'}`}>
                <p className="font-semibold break-words">Ligne {row.line} · {row.colisNumber || '(sans numéro)'} · {row.contactName || '(sans destinataire)'}</p>
                {row.carrierBarcode && <p className="break-all">Code transporteur : {row.carrierBarcode} · Commande : {row.clientReference}</p>}
                {row.errors.length ? <ul className="mt-1 list-disc pl-5">{row.errors.map(message => <li key={message}>{message}</li>)}</ul> : <><p>{registered.has(row.line) ? confirmed.has(row.line) ? 'Enregistré · étiquette disponible' : 'Enregistré · étiquette à relire' : uncertain.has(row.line) ? 'Résultat inconnu · reprendre la même référence' : serverRejected.has(row.line) ? `Refusé : ${serverRejected.get(row.line)}` : attempted ? 'Pas encore envoyé' : 'Prêt à importer'} · {row.city}</p><p>Livraison : {row.requestedDeliveryDate || deliveryDate || 'date à préciser'} · {row.timeWindowStart || 'début libre'} – {row.timeWindowEnd || 'fin libre'} · {row.serviceTime || '5'} min{row.floor ? ` · étage ${row.floor}` : ''}</p></>}
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
