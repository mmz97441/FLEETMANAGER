/**
 * MISSION IMPORT
 *
 * Handles file import modal, import history display, and review table integration.
 * Extracted from MissionManager.tsx
 */

import React, { useState } from 'react';
import {
  ImportBatch, User, UserRole, Zone,
  ZONE_COLORS
} from '../../types';
import { validateExcelFormat, parseExcelForReview, ReviewResult } from '../../services/importService';
import { notifyImportCompleted } from '../../services/notificationService';
import Modal from '../shared/Modal';
import ImportReviewTable from '../ImportReviewTable';
import {
  Upload, CheckCircle, XCircle, FileSpreadsheet, Loader2
} from 'lucide-react';

interface MissionImportProps {
  currentUser: User;
  users: User[];
  importBatches: ImportBatch[];
  canImport: boolean;
  /** Whether the imports tab is active */
  isActive: boolean;
}

const MissionImport: React.FC<MissionImportProps> = ({
  currentUser,
  users,
  importBatches,
  canImport,
  isActive
}) => {
  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [reviewData, setReviewData] = useState<ReviewResult | null>(null);

  // Clients disponibles pour l'import
  const clients = users.filter(u => u.role === UserRole.CLIENT);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!importFile || !selectedClient) return;

    const client = users.find(u => u.id === selectedClient);
    if (!client) return;

    setIsImporting(true);

    try {
      // Valider le format d'abord
      const validation = await validateExcelFormat(importFile);
      if (!validation.valid) {
        setImportResult({
          success: false,
          errors: validation.errors.map((msg, i) => ({ row: 0, message: msg }))
        });
        setIsImporting(false);
        return;
      }

      // Parser pour revue (NE crée PAS les colis en base)
      const review = await parseExcelForReview(importFile);
      setReviewData(review);
      setShowImportModal(false); // Ferme le modal de sélection fichier
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({
        success: false,
        errors: [{ row: 0, message: 'Erreur lors de la lecture du fichier' }]
      });
    }

    setIsImporting(false);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setSelectedClient('');
    setImportResult(null);
    setReviewData(null);
  };

  if (!isActive) return null;

  // If reviewing data, show the review table
  if (reviewData && selectedClient && users.find(u => u.id === selectedClient)) {
    return (
      <ImportReviewTable
        reviewResult={reviewData}
        client={users.find(u => u.id === selectedClient)!}
        currentUser={currentUser}
        onConfirm={(result) => {
          setImportResult(result);
          setReviewData(null);
          setShowImportModal(true);

          // Notifier les admins si import réussi
          if (result.success && result.successCount > 0) {
            const client = users.find(u => u.id === selectedClient);
            const adminIds = users
              .filter(u => ['admin', 'super_admin', 'Admin', 'Super Admin', 'Directeur', 'Exploitant']
                .some(r => u.role?.toLowerCase() === r.toLowerCase()))
              .map(u => u.id)
              .filter(id => id !== currentUser.id);
            if (adminIds.length > 0) {
              notifyImportCompleted(
                adminIds,
                client?.companyName || client?.firstName || 'Client',
                result.successCount,
                result.batchId || ''
              ).catch(e => console.warn('[Notif] Erreur notif import:', e));
            }
          }
        }}
        onCancel={() => {
          setReviewData(null);
          setImportFile(null);
          setSelectedClient('');
        }}
      />
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Actions */}
        {canImport && (
          <div className="flex justify-end">
            <button
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 transition-colors"
            >
              <Upload size={18} />
              Importer un fichier
            </button>
          </div>
        )}

        {/* Liste des imports */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-bold text-slate-800">Historique des imports</h3>
          </div>

          {importBatches.length === 0 ? (
            <div className="p-8 text-center">
              <FileSpreadsheet size={48} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500">Aucun import pour le moment</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {importBatches.map(batch => (
                <div key={batch.id} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                        <FileSpreadsheet size={20} className="text-slate-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{batch.fileName}</p>
                        <p className="text-sm text-slate-500">
                          {batch.clientName} • {new Date(batch.importedAt).toLocaleString('fr-FR')}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-green-600">
                          {batch.successCount} ✓
                        </span>
                        {batch.errorCount > 0 && (
                          <span className="text-sm font-medium text-red-600">
                            {batch.errorCount} ✗
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {batch.totalRows} lignes
                      </p>
                    </div>
                  </div>

                  {/* Répartition par zone */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {batch.zoneBreakdown.map(zb => {
                      const colors = ZONE_COLORS[zb.zone];
                      return (
                        <span
                          key={zb.zone}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${colors.bg} ${colors.text}`}
                        >
                          {zb.zone}: {zb.count}
                          {zb.dispatched && <CheckCircle size={12} />}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal Import */}
      <Modal
        isOpen={showImportModal}
        onClose={closeImportModal}
        title="Importer un fichier client"
        size="md"
        headerIcon={<Upload size={20} />}
      >
        <div className="space-y-4">
          {/* Sélection client */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">
              Client expéditeur <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value="">Sélectionner un client</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.companyName || `${client.firstName} ${client.lastName}`}
                </option>
              ))}
            </select>
          </div>

          {/* Upload fichier */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">
              Fichier Excel <span className="text-red-500">*</span>
            </label>
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-brand-400 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="excel-upload"
              />
              <label htmlFor="excel-upload" className="cursor-pointer">
                {importFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileSpreadsheet size={32} className="text-green-500" />
                    <div className="text-left">
                      <p className="font-medium text-slate-800">{importFile.name}</p>
                      <p className="text-sm text-slate-500">
                        {(importFile.size / 1024).toFixed(1)} Ko
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="mx-auto text-slate-400 mb-2" />
                    <p className="text-slate-600">Cliquez pour sélectionner un fichier</p>
                    <p className="text-sm text-slate-400">.xlsx ou .xls</p>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Résultat import */}
          {importResult && (
            <div className={`p-4 rounded-xl ${importResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {importResult.success ? (
                <>
                  <p className="font-bold text-green-800 mb-2">
                    ✅ Import réussi !
                  </p>
                  <p className="text-sm text-green-700">
                    {importResult.successCount} colis importés sur {importResult.totalRows} lignes
                  </p>
                  {importResult.zoneBreakdown && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {importResult.zoneBreakdown.map((zb: any) => (
                        <span
                          key={zb.zone}
                          className={`px-2 py-1 rounded-lg text-xs font-medium ${ZONE_COLORS[zb.zone as Zone].bg} ${ZONE_COLORS[zb.zone as Zone].text}`}
                        >
                          {zb.zone}: {zb.count} colis
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="font-bold text-red-800 mb-2">
                    ❌ Erreurs détectées
                  </p>
                  <ul className="text-sm text-red-700 list-disc list-inside">
                    {importResult.errors?.slice(0, 5).map((err: any, i: number) => (
                      <li key={i}>
                        {err.row > 0 ? `Ligne ${err.row}: ` : ''}{err.message}
                      </li>
                    ))}
                    {importResult.errors?.length > 5 && (
                      <li>... et {importResult.errors.length - 5} autres erreurs</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={closeImportModal}
              className="px-4 py-2 text-slate-700 font-medium hover:bg-slate-100 rounded-xl transition-colors"
            >
              {importResult?.success ? 'Fermer' : 'Annuler'}
            </button>
            {!importResult?.success && (
              <button
                onClick={handleImport}
                disabled={!importFile || !selectedClient || isImporting}
                className="flex items-center gap-2 px-6 py-2 bg-brand-500 text-white rounded-xl font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isImporting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Import en cours...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Importer
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
};

export default MissionImport;
