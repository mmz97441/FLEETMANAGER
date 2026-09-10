/**
 * IMPORT REVIEW TABLE
 * 
 * Table éditable pour valider/corriger les données importées
 * AVANT de les écrire en base. Intercalée entre le parse Excel
 * et la création des colis.
 * 
 * Fonctionnalités :
 * - Affichage de toutes les lignes importées avec statut (valid/warning/error)
 * - Édition inline (clic sur cellule → input)
 * - Re-validation automatique après édition
 * - Suppression de lignes
 * - Filtres par statut
 * - Stats en temps réel
 * - Bouton "Valider et créer les colis"
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import {
  ReviewRow, ReviewResult, ImportResult, revalidateRow, confirmReviewedImport
} from '../services/importService';
import { User, Zone, ZONE_COLORS } from '../types';
import { logActivity } from '../services/activityLogService';
import { ActivityAction } from '../types';
import {
  CheckCircle, XCircle, AlertTriangle, Trash2, Edit,
  Loader2, Search, Filter, ChevronDown, Package as PackageIcon
} from 'lucide-react';

interface ImportReviewTableProps {
  reviewResult: ReviewResult;
  client: User;
  currentUser: User;
  onConfirm: (result: any) => void;  // Appelé quand l'import est confirmé
  onCancel: () => void;
}

type StatusFilter = 'all' | 'valid' | 'warning' | 'error';
const fieldLabels: Record<string, string> = { externalId: 'numéro de colis', orderNumber: 'commande', contactName: 'destinataire', address: 'adresse', postalCode: 'code postal', city: 'ville', contactPhone: 'téléphone', floor: 'étage' };

const ImportReviewTable: React.FC<ImportReviewTableProps> = ({
  reviewResult,
  client,
  currentUser,
  onConfirm,
  onCancel
}) => {
  const [rows, setRows] = useState<ReviewRow[]>(reviewResult.rows);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [showDeletedRows, setShowDeletedRows] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set()); // par _rowIndex
  const [bulkZone, setBulkZone] = useState<Zone | ''>('');
  const [operationError, setOperationError] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const confirmingRef = useRef(false);
  const resultRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (importResult) resultRef.current?.focus({ preventScroll: true }); }, [importResult]);
  const editingRef = useRef<{ rowIdx: number; field: string } | null>(null);
  const requestCancel = useUnsavedChanges(!importResult && (JSON.stringify(rows) !== JSON.stringify(reviewResult.rows) || Boolean(editingCell)), isConfirming || validating);

  // === Stats dynamiques ===
  const stats = useMemo(() => {
    const active = rows.filter(r => r._status !== 'deleted');
    return {
      total: active.length,
      valid: active.filter(r => r._status === 'valid').length,
      warning: active.filter(r => r._status === 'warning').length,
      error: active.filter(r => r._status === 'error').length,
      deleted: rows.filter(r => r._status === 'deleted').length,
      totalPackages: active.filter(r => r._status !== 'error').length,
      zones: Object.values(Zone).reduce((acc, z) => {
        acc[z] = active.filter(r => r.zone === z && r._status !== 'error').length;
        return acc;
      }, {} as Record<string, number>)
    };
  }, [rows]);

  // === Lignes filtrées ===
  const filteredRows = useMemo(() => {
    let result = rows;

    if (!showDeletedRows) {
      result = result.filter(r => r._status !== 'deleted');
    }

    if (statusFilter !== 'all') {
      result = result.filter(r => r._status === statusFilter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(r =>
        r.contactName.toLowerCase().includes(term) ||
        r.address.toLowerCase().includes(term) ||
        r.city.toLowerCase().includes(term) ||
        r.orderNumber.includes(term) ||
        r.externalId.toLowerCase().includes(term) ||
        r.postalCode.includes(term)
      );
    }

    return result;
  }, [rows, statusFilter, searchTerm, showDeletedRows]);

  // === Édition inline ===
  const startEdit = (rowIdx: number, field: string, currentValue: string | number) => {
    if (isConfirming || validating || importResult || attempted) return;
    editingRef.current = { rowIdx, field };
    setEditingCell({ rowIdx, field });
    setEditValue(String(currentValue));
  };

  const commitEdit = useCallback(async () => {
    if (!editingRef.current) return;
    const { rowIdx, field } = editingRef.current;
    editingRef.current = null;
    setValidating(true); setOperationError('');

    const newRows = [...rows];
    const row = { ...newRows[rowIdx] };

    // Mettre à jour le champ
    switch (field) {
      case 'contactName':
      case 'contactPhone':
      case 'address':
      case 'postalCode':
      case 'city':
      case 'comment':
      case 'timeWindowStart':
      case 'timeWindowEnd':
      case 'externalId':
      case 'orderNumber':
        (row as any)[field] = editValue;
        break;
      case 'floor':
      case 'serviceTime':
        (row as any)[field] = parseInt(editValue) || 0;
        break;
      case 'volume':
      case 'weight':
        (row as any)[field] = parseFloat(editValue) || 0;
        break;
      case 'hasElevator':
        (row as any)[field] = editValue === 'true' || editValue === '1';
        break;
    }

    // Re-valider cette ligne
    try {
      const revalidated = await revalidateRow(row, newRows);
      newRows[rowIdx] = revalidated; setRows(newRows); setEditingCell(null);
    } catch { editingRef.current = { rowIdx, field }; setOperationError('La ligne n’a pas pu être vérifiée. Réessayez la correction.'); }
    finally { setValidating(false); }
  }, [editingCell, editValue, rows]);

  const cancelEdit = () => { editingRef.current = null; setEditingCell(null); };

  // === Suppression ===
  const deleteRow = (rowIdx: number) => {
    if (isConfirming || validating || attempted) return;
    const newRows = [...rows];
    newRows[rowIdx] = { ...newRows[rowIdx], _status: 'deleted' };
    setRows(newRows);
  };

  const restoreRow = async (rowIdx: number) => {
    if (isConfirming || validating || attempted) return;
    const newRows = [...rows];
    const restored = await revalidateRow({ ...newRows[rowIdx], _status: 'valid' }, newRows);
    newRows[rowIdx] = restored;
    setRows(newRows);
  };

  // === Sélection multiple ===
  const toggleRowSelect = (rowIndex: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex);
      return next;
    });
  };

  // Attribuer une zone à toutes les lignes sélectionnées (utile pour les colis
  // dont le code postal n'est pas reconnu → zone "?"). Revalide chaque ligne.
  const applyBulkZone = async () => {
    if (!bulkZone || selectedRows.size === 0 || isConfirming || validating || attempted) return;
    let newRows = [...rows];
    for (let i = 0; i < newRows.length; i++) {
      if (selectedRows.has(newRows[i]._rowIndex) && newRows[i]._status !== 'deleted') {
        const withZone = { ...newRows[i], zone: bulkZone as Zone };
        // Revalider : la zone étant désormais définie, l'erreur "code postal non reconnu" disparaît
        const errors = withZone._errors.filter(e => !/code postal/i.test(e) && !/zone/i.test(e));
        newRows[i] = {
          ...withZone,
          _errors: errors,
          _status: errors.length > 0 ? 'error' : (withZone._warnings.length > 0 ? 'warning' : 'valid')
        };
      }
    }
    setRows(newRows);
    setSelectedRows(new Set());
    setBulkZone('');
  };

  // === Confirmer l'import ===
  const handleConfirm = async () => {
    if (confirmingRef.current || validating || importResult || editingCell) return;
    confirmingRef.current = true; setAttempted(true);
    setIsConfirming(true); setOperationError('');
    try {
      const result = await confirmReviewedImport(
        rows,
        client,
        currentUser,
        reviewResult.fileName
      );

      if (result.success) {
        logActivity(currentUser, ActivityAction.DATA_IMPORTED, {
          targetType: 'package',
          targetId: result.batchId,
          targetName: reviewResult.fileName,
          details: {
            metadata: {
              totalRows: result.totalRows,
              successCount: result.successCount,
              errorCount: result.errorCount,
              deletedByUser: stats.deleted,
              zones: result.zoneBreakdown.map(z => `${z.zone}: ${z.count}`)
            }
          }
        });
      }

      setImportResult(result);
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : 'L’import n’a pas pu être confirmé. Vos corrections sont conservées.');
    }
    confirmingRef.current = false; setIsConfirming(false);
  };

  // === Rendu cellule éditable ===
  const renderEditableCell = ({ rowIdx, field, value, className = '' }: {
    rowIdx: number;
    field: string;
    value: string | number;
    className?: string;
  }) => {
    const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.field === field;

    if (isEditing) {
      return (
        <input
          autoFocus
          aria-label={`Modifier ${fieldLabels[field] || field}, ligne ${rows[rowIdx]._rowIndex}`}
          disabled={validating}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commitEdit(); }
            if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
          }}
          className="w-full px-1.5 py-0.5 border border-blue-400 rounded text-xs bg-blue-50 outline-none focus:ring-1 focus:ring-blue-400"
        />
      );
    }

    return (
      <button
        type="button"
        disabled={isConfirming || validating || Boolean(importResult) || attempted}
        aria-label={`Modifier ${fieldLabels[field] || field}, ligne ${rows[rowIdx]._rowIndex} : ${value || 'vide'}`}
        onClick={() => startEdit(rowIdx, field, value)}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded transition-colors ${className}`}
        title="Modifier cette valeur"
      >
        {value || <span className="text-slate-600 italic">—</span>}
      </button>
    );
  };

  const exportRejected = () => {
    const rejected = importResult ? rows.filter(row => importResult.errors.some(error => error.row === row._rowIndex)) : rows.filter(row => row._status === 'error');
    const worksheet = XLSX.utils.json_to_sheet(rejected.map(row => ({
      Id: row.externalId, Order_Number: row.orderNumber, Contact: row.contactName, Address: `${row.address} ${row.postalCode} ${row.city}`.trim(), Telephone: row.contactPhone,
      Floor: row.floor, Elevator: row.hasElevator ? 1 : 0, Start: row.timeWindowStart, End: row.timeWindowEnd, Service_Time: row.serviceTime, Volume: row.volume, Weight: row.weight, Comment: row.comment,
      'Ligne source': row._rowIndex, Motif: importResult ? importResult.errors.filter(error => error.row === row._rowIndex).map(error => error.message).join(' ; ') : row._errors.join(' ; '),
    })));
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Lignes à corriger'); XLSX.writeFile(workbook, 'import-lignes-a-corriger.xlsx');
  };

  if (importResult) {
    const duplicateLines = new Set(importResult.errors.filter(error => error.row > 0 && /doublon/i.test(error.message)).map(error => error.row));
    return <div className="rounded-xl border bg-white p-5 space-y-4">
      <h3 ref={resultRef} tabIndex={-1} className="text-xl font-bold">Bilan de l’import</h3>
      <p role="status" className="text-sm text-slate-700">{importResult.totalRows} lignes : {importResult.successCount} enregistrées, {importResult.errorCount} rejetées, {duplicateLines.size} doublons ignorés et {stats.deleted} retirées avant import.</p>
      {importResult.errors.length > 0 && <><ul className="max-h-64 overflow-auto list-disc pl-5 text-sm text-slate-700 space-y-1">{importResult.errors.map((error, index) => <li key={index}>{error.row > 0 ? `Ligne ${error.row} : ` : ''}{error.message}</li>)}</ul><button type="button" onClick={exportRejected} className="min-h-11 rounded-xl border px-4 text-sm font-semibold">Exporter les lignes à corriger ou vérifier</button></>}
      <button type="button" onClick={() => onConfirm(importResult)} className="min-h-11 px-4 bg-indigo-700 text-white rounded-xl font-semibold">Terminer et consulter les colis</button>
    </div>;
  }

  // === Status icon ===
  const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
      case 'valid': return <CheckCircle size={14} className="text-green-500" />;
      case 'warning': return <AlertTriangle size={14} className="text-amber-500" />;
      case 'error': return <XCircle size={14} className="text-red-500" />;
      case 'deleted': return <Trash2 size={14} className="text-slate-400" />;
      default: return null;
    }
  };

  // ============================================================================
  // RENDU
  // ============================================================================

  return (
    <div className="space-y-4" aria-busy={isConfirming || validating}>
      {attempted && !isConfirming && <p className="text-sm text-slate-700">Les données de cet import restent figées après une tentative. Relancez les mêmes références pour vérifier les lignes non confirmées sans recréer les colis existants.</p>}
      {operationError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{operationError}</p>}
      {/* === BARRE STATS === */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              Revue de l'import — {reviewResult.fileName}
            </h3>
            <p className="text-xs text-slate-500">
              Client : {client.companyName || `${client.firstName} ${client.lastName}`} •
              {stats.total} lignes actives
            </p>
          </div>
        </div>

        {/* KPI Pills */}
        <div className="flex flex-wrap gap-2">
          <button
            aria-pressed={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              statusFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tout ({stats.total})
          </button>
          <button
            aria-pressed={statusFilter === 'valid'}
            onClick={() => setStatusFilter('valid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              statusFilter === 'valid' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            ✓ Valides ({stats.valid})
          </button>
          <button
            aria-pressed={statusFilter === 'warning'}
            onClick={() => setStatusFilter('warning')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              statusFilter === 'warning' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            ⚠ Avertissements ({stats.warning})
          </button>
          <button
            aria-pressed={statusFilter === 'error'}
            onClick={() => setStatusFilter('error')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              statusFilter === 'error' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            ✗ Erreurs ({stats.error})
          </button>
          {stats.deleted > 0 && (
            <button
              onClick={() => setShowDeletedRows(!showDeletedRows)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-500 hover:bg-slate-100"
            >
              🗑 Supprimés ({stats.deleted}) {showDeletedRows ? '▲' : '▼'}
            </button>
          )}
        </div>

        {stats.error > 0 && <button type="button" onClick={exportRejected} className="mt-3 min-h-11 px-3 border rounded-xl text-sm font-semibold text-slate-700">Exporter les lignes en erreur</button>}
        {/* Zone breakdown */}
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
          {Object.entries(stats.zones).map(([zone, count]) => count > 0 && (
            <span
              key={zone}
              className={`px-2 py-1 rounded-lg text-xs font-medium ${ZONE_COLORS[zone as Zone]?.bg || 'bg-slate-100'} ${ZONE_COLORS[zone as Zone]?.text || 'text-slate-600'}`}
            >
              {zone}: {count} colis
            </span>
          ))}
        </div>
      </div>

      {/* === BARRE RECHERCHE === */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Rechercher dans les lignes de l’import"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Rechercher par contact, adresse, commande..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* === BARRE ACTION GROUPÉE (attribution de zone) === */}
      {selectedRows.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-brand-700">{selectedRows.size} ligne{selectedRows.size > 1 ? 's' : ''} sélectionnée{selectedRows.size > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <span className="text-xs text-slate-500">Attribuer la zone :</span>
            <select aria-label="Zone à attribuer aux lignes sélectionnées"
              value={bulkZone}
              onChange={e => setBulkZone(e.target.value as Zone)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value="">— Choisir —</option>
              {Object.values(Zone).map(z => <option key={z} value={z}>{z}</option>)}
            </select>
            <button
              onClick={applyBulkZone}
              disabled={!bulkZone || isConfirming || validating || attempted}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-bold hover:bg-brand-700 disabled:opacity-40"
            >
              Appliquer
            </button>
            <button
              onClick={() => setSelectedRows(new Set())}
              className="px-3 py-2 text-slate-500 text-sm hover:underline"
            >
              Désélectionner
            </button>
          </div>
        </div>
      )}

      {/* === TABLE === */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-2.5 text-center font-bold text-slate-500 w-8">
                  <input
                    type="checkbox"
                    title="Tout sélectionner (lignes affichées)" aria-label="Sélectionner toutes les lignes affichées"
                    checked={filteredRows.length > 0 && filteredRows.every(r => selectedRows.has(r._rowIndex))}
                    onChange={e => {
                      setSelectedRows(prev => {
                        const next = new Set(prev);
                        filteredRows.forEach(r => e.target.checked ? next.add(r._rowIndex) : next.delete(r._rowIndex));
                        return next;
                      });
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                  />
                </th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-8">#</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-6">St.</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 min-w-[90px]">N° Colis</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 min-w-[100px]">N° Cmd</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 min-w-[130px]">Contact</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 min-w-[200px]">Adresse</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-16">CP</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 min-w-[100px]">Ville</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-14">Zone</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-24">Téléphone</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-20">Créneau</th>
                <th className="px-2 py-2.5 text-left font-bold text-slate-500 w-8">Ét.</th>
                <th className="px-2 py-2.5 text-center font-bold text-slate-500 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, displayIdx) => {
                // Retrouver l'index réel dans le tableau `rows`
                const realIdx = rows.findIndex(r => r._rowIndex === row._rowIndex);
                const isDeleted = row._status === 'deleted';

                const rowBg =
                  isDeleted ? 'bg-slate-50 opacity-50' :
                  row._status === 'error' ? 'bg-red-50/50' :
                  row._status === 'warning' ? 'bg-amber-50/30' :
                  '';

                return (
                  <tr
                    key={row._rowIndex}
                    className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${rowBg} ${selectedRows.has(row._rowIndex) ? 'bg-brand-50/40' : ''}`}
                  >
                    {/* Sélection */}
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner la ligne ${row._rowIndex}`}
                        disabled={isConfirming || validating || isDeleted}
                        checked={selectedRows.has(row._rowIndex)}
                        onChange={() => toggleRowSelect(row._rowIndex)}
                        className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                      />
                    </td>

                    {/* Numéro ligne */}
                    <td className="px-2 py-2 text-slate-400 font-mono">{row._rowIndex}</td>

                    {/* Statut */}
                    <td className="px-2 py-2">
                      <div className="relative group">
                        <StatusIcon status={row._status} />
                        {(row._errors.length > 0 || row._warnings.length > 0) && (
                          <div className="absolute z-20 left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-2 w-60 hidden group-hover:block">
                            {row._errors.map((e, i) => (
                              <p key={`e${i}`} className="text-red-600 text-[10px]">❌ {e}</p>
                            ))}
                            {row._warnings.map((w, i) => (
                              <p key={`w${i}`} className="text-amber-600 text-[10px]">⚠️ {w}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* N° colis (identifiant physique sur le carton, ex: BR0513) */}
                    <td className="px-2 py-2 font-mono">
                      <div className="flex items-center gap-1">
                        {renderEditableCell({ rowIdx: realIdx, field: "externalId", value: row.externalId })}
                        {row._multiColis && (
                          <span
                            className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap"
                            title={`Point de livraison avec ${row._multiColis.total} colis (même adresse — toutes commandes confondues)`}
                          >
                            {row._multiColis.index}/{row._multiColis.total}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* N° commande */}
                    <td className="px-2 py-2 font-mono">
                      {renderEditableCell({ rowIdx: realIdx, field: "orderNumber", value: row.orderNumber })}
                    </td>

                    {/* Contact */}
                    <td className="px-2 py-2 font-medium">
                      {renderEditableCell({ rowIdx: realIdx, field: "contactName", value: row.contactName })}
                    </td>

                    {/* Adresse */}
                    <td className="px-2 py-2">
                      {renderEditableCell({ rowIdx: realIdx, field: "address", value: row.address })}
                    </td>

                    {/* Code postal */}
                    <td className="px-2 py-2 font-mono">
                      {renderEditableCell({ rowIdx: realIdx, field: 'postalCode', value: row.postalCode, className: !row.postalCode ? 'text-red-700 font-bold' : '' })}
                    </td>

                    {/* Ville */}
                    <td className="px-2 py-2">
                      {renderEditableCell({ rowIdx: realIdx, field: "city", value: row.city })}
                    </td>

                    {/* Zone */}
                    <td className="px-2 py-2">
                      {row.zone ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ZONE_COLORS[row.zone as Zone]?.bg || ''} ${ZONE_COLORS[row.zone as Zone]?.text || ''}`}>
                          {row.zone}
                        </span>
                      ) : (
                        <span className="text-red-400 text-[10px] font-bold">?</span>
                      )}
                    </td>

                    {/* Téléphone */}
                    <td className="px-2 py-2">
                      {renderEditableCell({ rowIdx: realIdx, field: "contactPhone", value: row.contactPhone })}
                    </td>

                    {/* Créneau */}
                    <td className="px-2 py-2 text-[10px]">
                      {row.timeWindowStart || row.timeWindowEnd ? (
                        <span>{row.timeWindowStart}-{row.timeWindowEnd}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Étage */}
                    <td className="px-2 py-2 text-center">
                      {renderEditableCell({ rowIdx: realIdx, field: "floor", value: row.floor })}
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2 text-center">
                      {isDeleted ? (
                        <button
                          disabled={isConfirming || validating || attempted}
                          onClick={() => restoreRow(realIdx)}
                          className="text-blue-500 hover:text-blue-700 text-[10px] font-medium"
                          title="Restaurer"
                        >
                          ↩
                        </button>
                      ) : (
                        <button
                          disabled={isConfirming || validating || attempted}
                          onClick={() => deleteRow(realIdx)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                          title="Supprimer cette ligne"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="text-center py-8 text-slate-400">
                    Aucune ligne ne correspond aux filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingCell && <p role="status" className="text-sm text-slate-700">Validez la cellule en cours avec Entrée, ou cliquez en dehors du champ, avant de créer les colis.</p>}
      {/* === FOOTER ACTIONS === */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600">
            <span className="font-bold text-green-600">{stats.valid + stats.warning}</span> colis prêts à créer
            {stats.error > 0 && (
              <span className="ml-2 text-red-500">
                ({stats.error} en erreur seront ignorés)
              </span>
            )}
            {stats.deleted > 0 && (
              <span className="ml-2 text-slate-400">
                ({stats.deleted} supprimés)
              </span>
            )}
          </div>

          <div className="flex gap-3">
            <button
              disabled={isConfirming || validating}
              onClick={() => void requestCancel(onCancel)}
              className="px-4 py-2.5 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleConfirm}
              disabled={isConfirming || validating || Boolean(editingCell) || (stats.valid + stats.warning) === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {isConfirming ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Création en cours...
                </>
              ) : (
                <>
                  <PackageIcon size={16} />
                  {attempted ? 'Reprendre les mêmes références' : `Valider et créer ${stats.valid + stats.warning} colis`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportReviewTable;
