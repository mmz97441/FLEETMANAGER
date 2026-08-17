/**
 * IMPORT EN MASSE D'EXPÉDITIONS (client expéditeur)
 *
 * Le client importe un fichier (Excel/CSV) : une ligne = un colis identifié par
 * son numéro (ex. BR-…). Un CONTRÔLE QUALITÉ vérifie chaque ligne et affiche
 * TOUTES les erreurs AVANT l'import (numéro manquant/invalide, doublons, adresse
 * incomplète…). Seules les lignes valides sont importées, puis les étiquettes
 * sont imprimées au format choisi (A4/A5/A6).
 */
import React, { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { createClientShipmentsBatch } from '../services/missionService';
import { estimateZoneFromAddress } from '../services/deliveryService';
import { generateBatchLabelsHTML, LabelFormat } from '../services/pickupService';
import { User, Package, Zone } from '../types';
import { Upload, FileSpreadsheet, X, AlertTriangle, CheckCircle, Download, Printer } from 'lucide-react';

interface ImportShipmentsModalProps {
  currentUser: User;
  onClose: () => void;
  onImported: (count: number) => void;
}

interface ParsedRow {
  line: number;               // numéro de ligne dans le fichier (1 = entêtes)
  colisNumber: string;
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

const ImportShipmentsModal: React.FC<ImportShipmentsModalProps> = ({ currentUser, onClose, onImported }) => {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<LabelFormat>('A6');
  const [printLabels, setPrintLabels] = useState(true); // impression dissociée de l'import
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');       // erreur de lecture / d'import
  const inputRef = useRef<HTMLInputElement>(null);

  const resetFile = () => {
    setRows(null);
    setFileName('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

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
          line: i + 2,               // ligne 1 = entêtes
          colisNumber: getField(r, 'colisNumber'),
          contactName: getField(r, 'contactName'),
          address: street,
          postalCode,
          city,
          contactPhone: getField(r, 'contactPhone'),
          contactEmail: getField(r, 'contactEmail'),
          weight: getField(r, 'weight'),
          clientReference: getField(r, 'clientReference'),
          comment: getField(r, 'comment'),
          errors: [],
        };
      });

      // Comptage des numéros de colis (pour repérer les doublons dans le fichier)
      const counts = new Map<string, number>();
      for (const p of parsed) {
        const key = p.colisNumber.trim().toUpperCase();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }

      // 2e passage : contrôle qualité, une liste d'erreurs par ligne
      for (const p of parsed) {
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
      }

      setRows(parsed);
    } catch (e) {
      setError("Impossible de lire le fichier. Vérifie que c'est bien un .xlsx, .xls ou .csv.");
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

  const handleImport = async () => {
    if (validCount === 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      // Estimation de la zone depuis l'adresse (best-effort, non bloquant)
      const rowsWithZone = await Promise.all(
        validRows.map(async (r) => {
          let zone: Zone | undefined;
          try {
            const est = await estimateZoneFromAddress(`${r.address}, ${r.postalCode} ${r.city}`);
            zone = est?.zone;
          } catch { /* zone laissée indéfinie → transporteur ajustera */ }
          const weight = r.weight ? Number(String(r.weight).replace(',', '.')) : undefined;
          return {
            colisNumber: r.colisNumber.trim(),
            contactName: r.contactName.trim(),
            address: r.address.trim(),
            postalCode: r.postalCode.trim(),
            city: r.city.trim(),
            contactPhone: r.contactPhone.trim() || undefined,
            contactEmail: r.contactEmail.trim() || undefined,
            weight: weight != null && !Number.isNaN(weight) ? weight : undefined,
            clientReference: r.clientReference.trim() || undefined,
            comment: r.comment.trim() || undefined,
            zone,
          };
        })
      );

      const packages: Package[] = await createClientShipmentsBatch({
        client: {
          id: currentUser.id,
          companyName: currentUser.companyName || `${currentUser.firstName} ${currentUser.lastName}`,
        },
        rows: rowsWithZone,
      });

      // Impression des étiquettes UNIQUEMENT si demandé (sinon : plus tard depuis « Mes Colis »)
      if (printLabels) {
        const html = generateBatchLabelsHTML(packages, currentUser.companyName || 'Expéditeur', format);
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
      }

      onImported(packages.length);
      onClose();
    } catch (e) {
      setError('Erreur lors de l\'import. Réessayez.');
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-indigo-600" /> Importer mes expéditions
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

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
              className="w-full flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed border-indigo-300 rounded-xl text-indigo-600 hover:bg-indigo-50"
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
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold"
            >
              <Download size={16} /> Télécharger le fichier modèle
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-1">
              Remplissez le modèle avec vos expéditions, puis importez-le. Chaque numéro de colis doit commencer par BR.
            </p>
          </>
        )}

        {error && (
          <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Étape 2 : rapport de contrôle qualité */}
        {rows && (
          <>
            <p className="text-xs text-slate-500 mb-2">{fileName}</p>

            {/* Bandeau de synthèse */}
            <div
              className={`rounded-xl px-4 py-3 mb-3 flex items-center gap-2 text-sm font-semibold border ${
                errorCount === 0
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              {errorCount === 0 ? <CheckCircle size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
              <span>{totalCount} ligne(s) lue(s) · {validCount} valide(s) · {errorCount} avec erreur(s)</span>
            </div>

            {/* Liste détaillée : erreurs d'abord, puis lignes valides */}
            <div className="max-h-72 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100 mb-3">
              {invalidRows.map((r) => (
                <div key={`err-${r.line}`} className="bg-red-50/60 px-3 py-2">
                  <div className="flex items-start gap-2 text-sm font-semibold text-red-800">
                    <X size={14} className="text-red-500 shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">
                      Ligne {r.line} — {r.colisNumber || '(sans numéro)'} · {r.contactName || '—'}
                    </span>
                  </div>
                  <ul className="mt-1 ml-6 space-y-0.5">
                    {r.errors.map((msg, i) => (
                      <li key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                        <span className="mt-1 w-1 h-1 rounded-full bg-red-400 shrink-0" /> {msg}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {validRows.map((r) => (
                <div key={`ok-${r.line}`} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600">
                  <CheckCircle size={14} className="text-green-500 shrink-0" />
                  <span className="min-w-0 truncate">
                    Ligne {r.line} — <span className="font-semibold text-slate-800">{r.colisNumber}</span> · {r.contactName} · {r.city}
                  </span>
                </div>
              ))}
            </div>

            {/* Impression des étiquettes : dissociée de l'import */}
            <label className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={printLabels}
                onChange={e => setPrintLabels(e.target.checked)}
                className="w-4 h-4 accent-indigo-600"
              />
              Imprimer les étiquettes tout de suite
              <span className="text-slate-400">(sinon, à tout moment depuis « Mes Colis »)</span>
            </label>

            {/* Format d'étiquette (uniquement si on imprime maintenant) */}
            {printLabels && (
              <div className="mb-3">
                <label className="text-[11px] text-slate-500 font-medium">Format d'étiquette</label>
                <div className="flex gap-2 mt-1">
                  {(['A4', 'A5', 'A6'] as LabelFormat[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold border ${
                        format === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">A6 = 1 étiquette/page (entrepôt) · A4 = 4/page</p>
              </div>
            )}

            {/* Note : les lignes en erreur ne sont pas importées */}
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3">
              Les lignes en erreur ne sont pas importées. Corrigez votre fichier et réimportez-les.
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={resetFile}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm"
              >
                Changer de fichier
              </button>
              <button
                onClick={handleImport}
                disabled={validCount === 0 || busy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm disabled:opacity-40"
              >
                {printLabels ? <Printer size={16} /> : <CheckCircle size={16} />}
                {busy
                  ? 'Import en cours…'
                  : `Importer les ${validCount} expédition(s) valide(s)${printLabels ? ' + imprimer' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ImportShipmentsModal;
