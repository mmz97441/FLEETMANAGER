/**
 * COMPOSANT IMPORT EXCEL MULTI-FEUILLES — DONNÉES FINANCIÈRES
 *
 * Flux :
 *  1. Upload du classeur Excel
 *  2. Détection automatique des feuilles (identification + répartition produits)
 *  3. Aperçu combiné avec onglets
 *  4. Confirmation → sauvegarde Firestore
 *  5. Historique des imports précédents
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle, AlertTriangle, X, Building2,
  TrendingUp, PieChart, Eye, Trash2, Download, ChevronRight, Info,
  ArrowUpRight, ArrowDownRight, Minus, RefreshCw, FileText
} from 'lucide-react';
import { User, ClientFinancialData, FinancialIndicator } from '../types';
import {
  parseFinancialExcel,
  FinancialImportPreview,
  ParsedIdentification,
  ParsedProductBreakdown,
  buildClientFinancialData
} from '../services/financialImportService';
import {
  addClientFinancialData,
  subscribeToClientFinancials,
  deleteClientFinancialData
} from '../services/firestore';
import Modal from './shared/Modal';
import ConfirmModal from './ConfirmModal';

interface FinancialImportProps {
  currentUser: User;
  users: User[];
}

// ============================================================================
// HELPERS
// ============================================================================

const formatCurrency = (value: number): string => {
  if (value === 0) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
};

const formatPercent = (value: number): string => {
  if (value === 0) return '—';
  return `${value.toFixed(1)} %`;
};

const VariationBadge: React.FC<{ yearN: number; yearN1: number }> = ({ yearN, yearN1 }) => {
  if (yearN1 === 0) return <span className="text-xs text-slate-400">—</span>;
  const variation = ((yearN - yearN1) / Math.abs(yearN1)) * 100;
  if (Math.abs(variation) < 0.5) {
    return <span className="inline-flex items-center gap-0.5 text-xs text-slate-500"><Minus size={12} /> 0 %</span>;
  }
  if (variation > 0) {
    return <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 font-medium"><ArrowUpRight size={12} /> +{variation.toFixed(1)} %</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-xs text-red-600 font-medium"><ArrowDownRight size={12} /> {variation.toFixed(1)} %</span>;
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const FinancialImport: React.FC<FinancialImportProps> = ({ currentUser, users }) => {
  // --- State ---
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [preview, setPreview] = useState<FinancialImportPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'identification' | 'products'>('identification');

  // Historique
  const [history, setHistory] = useState<ClientFinancialData[]>([]);
  const [viewingItem, setViewingItem] = useState<ClientFinancialData | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Édition inline de l'aperçu
  const [editedIdentification, setEditedIdentification] = useState<ParsedIdentification | null>(null);
  const [editedProducts, setEditedProducts] = useState<ParsedProductBreakdown | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- Charger l'historique ---
  useEffect(() => {
    const unsub = subscribeToClientFinancials(setHistory);
    return () => unsub();
  }, []);

  // --- Drag & Drop ---
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      handleFileSelected(droppedFile);
    }
  }, []);

  // --- Sélection du fichier ---
  const handleFileSelected = async (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setPreview(null);
    setSaveSuccess(false);
    setIsParsing(true);

    try {
      const result = await parseFinancialExcel(selectedFile);
      setPreview(result);
      setEditedIdentification(result.identification);
      setEditedProducts(result.productBreakdown);

      // Défaut : ouvrir l'onglet qui a du contenu
      if (result.hasIdentification) {
        setActiveTab('identification');
      } else if (result.hasProductBreakdown) {
        setActiveTab('products');
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erreur de lecture du fichier');
    } finally {
      setIsParsing(false);
    }
  };

  // --- Sauvegarde ---
  const handleSave = async () => {
    if (!preview) return;

    setIsSaving(true);
    try {
      // Reconstruire le preview avec les données éditées
      const editedPreview: FinancialImportPreview = {
        ...preview,
        identification: editedIdentification,
        productBreakdown: editedProducts
      };

      const data = buildClientFinancialData(editedPreview, currentUser);
      await addClientFinancialData(data);
      setSaveSuccess(true);

      // Reset après 2s
      setTimeout(() => {
        setFile(null);
        setPreview(null);
        setEditedIdentification(null);
        setEditedProducts(null);
        setSaveSuccess(false);
      }, 2000);
    } catch (err) {
      setParseError('Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Reset ---
  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setEditedIdentification(null);
    setEditedProducts(null);
    setParseError(null);
    setSaveSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Suppression ---
  const handleDelete = async () => {
    if (!deletingId) return;
    await deleteClientFinancialData(deletingId);
    setDeletingId(null);
    if (viewingItem?.id === deletingId) setViewingItem(null);
  };

  // --- Mise à jour d'un indicateur édité ---
  const updateIndicator = (field: keyof ParsedIdentification, key: 'yearN' | 'yearN1', value: string) => {
    if (!editedIdentification) return;
    const numVal = parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
    setEditedIdentification({
      ...editedIdentification,
      [field]: {
        ...(editedIdentification[field] as FinancialIndicator),
        [key]: numVal
      }
    });
  };

  // --- Mise à jour d'un produit édité ---
  const updateProduct = (index: number, field: 'product' | 'caHT' | 'percentage', value: string) => {
    if (!editedProducts) return;
    const updated = [...editedProducts.products];
    if (field === 'product') {
      updated[index] = { ...updated[index], product: value };
    } else {
      updated[index] = { ...updated[index], [field]: parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0 };
    }
    setEditedProducts({ ...editedProducts, products: updated });
  };

  // ==========================================================================
  // RENDU
  // ==========================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Imports / Exports</h1>
          <p className="text-sm text-slate-500 mt-1">
            Importez les données financières de vos clients depuis un classeur Excel multi-feuilles
          </p>
        </div>
      </div>

      {/* Zone d'upload */}
      {!preview && !isParsing && (
        <div
          ref={dragRef}
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer
            ${isDragging
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
            }
          `}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
            }}
          />

          <div className="mx-auto w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4">
            <FileSpreadsheet size={32} className="text-indigo-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            Glissez votre classeur Excel ici
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            ou cliquez pour parcourir vos fichiers (.xlsx, .xls)
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-xl text-xs text-slate-600">
            <Info size={14} />
            <span>Feuilles détectées automatiquement : "Identification Entreprise" + "Répartition du CA par Produit"</span>
          </div>
        </div>
      )}

      {/* Parsing en cours */}
      {isParsing && (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <RefreshCw size={32} className="mx-auto text-indigo-500 animate-spin mb-4" />
          <p className="text-slate-600 font-medium">Analyse du classeur en cours...</p>
          <p className="text-sm text-slate-400 mt-1">{file?.name}</p>
        </div>
      )}

      {/* Erreur de parsing */}
      {parseError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-700">{parseError}</p>
            <button onClick={handleReset} className="text-sm text-red-600 underline mt-2">
              Réessayer avec un autre fichier
            </button>
          </div>
        </div>
      )}

      {/* Succès de sauvegarde */}
      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex items-center gap-3">
          <CheckCircle size={20} className="text-emerald-500" />
          <p className="font-medium text-emerald-700">Données financières importées avec succès !</p>
        </div>
      )}

      {/* Aperçu du parsing */}
      {preview && !saveSuccess && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {/* Barre d'info */}
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={20} className="text-indigo-500" />
              <div>
                <span className="font-semibold text-slate-700">{preview.fileName}</span>
                <span className="text-sm text-slate-500 ml-3">
                  {preview.detectedSheetCount} feuille{preview.detectedSheetCount > 1 ? 's' : ''} reconnue{preview.detectedSheetCount > 1 ? 's' : ''}
                  {preview.unknownSheets.length > 0 && (
                    <span className="text-amber-600 ml-2">
                      ({preview.unknownSheets.length} non reconnue{preview.unknownSheets.length > 1 ? 's' : ''})
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || (!preview.hasIdentification && !preview.hasProductBreakdown)}
                className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSaving ? (
                  <><RefreshCw size={14} className="animate-spin" /> Enregistrement...</>
                ) : (
                  <><CheckCircle size={14} /> Importer les données</>
                )}
              </button>
            </div>
          </div>

          {/* Onglets */}
          <div className="flex border-b border-slate-100">
            {preview.hasIdentification && (
              <button
                onClick={() => setActiveTab('identification')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'identification'
                    ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Building2 size={16} />
                Identification & Finances
              </button>
            )}
            {preview.hasProductBreakdown && (
              <button
                onClick={() => setActiveTab('products')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'products'
                    ? 'border-indigo-500 text-indigo-600 bg-indigo-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <PieChart size={16} />
                Répartition CA par Produit
                {editedProducts && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full">
                    {editedProducts.products.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Contenu de l'onglet */}
          <div className="p-6">
            {activeTab === 'identification' && editedIdentification && (
              <IdentificationPreview
                data={editedIdentification}
                onUpdateIndicator={updateIndicator}
                onUpdateText={(field, value) =>
                  setEditedIdentification({ ...editedIdentification, [field]: value })
                }
              />
            )}

            {activeTab === 'products' && editedProducts && (
              <ProductBreakdownPreview
                data={editedProducts}
                onUpdate={updateProduct}
              />
            )}
          </div>
        </div>
      )}

      {/* Historique des imports */}
      {history.length > 0 && !preview && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800">Historique des imports financiers</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {history.map(item => (
              <div key={item.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                    <FileText size={18} className="text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">{item.companyName}</p>
                    <p className="text-xs text-slate-500">
                      {item.fileName} — importé le {new Date(item.importedAt).toLocaleDateString('fr-FR')} par {item.importedByName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-600">
                    CA : {formatCurrency((item.caHT as FinancialIndicator)?.yearN || 0)}
                  </span>
                  {item.productBreakdown?.length > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                      {item.productBreakdown.length} produits
                    </span>
                  )}
                  <button
                    onClick={() => setViewingItem(item)}
                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Voir le détail"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    onClick={() => setDeletingId(item.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal détail */}
      {viewingItem && (
        <Modal
          isOpen={!!viewingItem}
          onClose={() => setViewingItem(null)}
          title={viewingItem.companyName}
          subtitle={`Importé le ${new Date(viewingItem.importedAt).toLocaleDateString('fr-FR')}`}
          size="3xl"
          headerIcon={<Building2 size={20} />}
        >
          <div className="space-y-6">
            <IdentificationReadOnly data={viewingItem} />
            {viewingItem.productBreakdown?.length > 0 && (
              <ProductBreakdownReadOnly products={viewingItem.productBreakdown} />
            )}
          </div>
        </Modal>
      )}

      {/* Modal confirmation suppression */}
      {deletingId && (
        <ConfirmModal
          isOpen={!!deletingId}
          onClose={() => setDeletingId(null)}
          onConfirm={handleDelete}
          title="Supprimer cet import ?"
          message="Cette action supprimera définitivement les données financières importées."
          confirmLabel="Supprimer"
          type="danger"
        />
      )}
    </div>
  );
};

// ============================================================================
// SOUS-COMPOSANT : Aperçu Identification (éditable)
// ============================================================================

const IdentificationPreview: React.FC<{
  data: ParsedIdentification;
  onUpdateIndicator: (field: keyof ParsedIdentification, key: 'yearN' | 'yearN1', value: string) => void;
  onUpdateText: (field: keyof ParsedIdentification, value: string) => void;
}> = ({ data, onUpdateIndicator, onUpdateText }) => {
  const indicators: { key: keyof ParsedIdentification; label: string }[] = [
    { key: 'caHT', label: 'CA HT' },
    { key: 'margeCommerciale', label: 'Marge commerciale' },
    { key: 'valeurAjoutee', label: 'Valeur ajoutée' },
    { key: 'ebe', label: 'EBE' },
    { key: 'resultatExploitation', label: "Résultat d'exploitation" },
    { key: 'resultatNet', label: 'Résultat net' },
    { key: 'bfr', label: 'BFR' },
    { key: 'tresorerie', label: 'Trésorerie' },
  ];

  return (
    <div className="space-y-6">
      {/* Identification */}
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Identification de l'entreprise
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Raison sociale</label>
            <input
              type="text"
              value={data.companyName}
              onChange={(e) => onUpdateText('companyName', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">SIRET</label>
            <input
              type="text"
              value={data.siret}
              onChange={(e) => onUpdateText('siret', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Code NAF</label>
            <input
              type="text"
              value={data.naf}
              onChange={(e) => onUpdateText('naf', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Activité</label>
            <input
              type="text"
              value={data.activity}
              onChange={(e) => onUpdateText('activity', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Indicateurs financiers */}
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Analyse financière
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-4 py-2.5 font-semibold text-slate-600 rounded-tl-lg">Indicateur</th>
                <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Année N</th>
                <th className="text-right px-4 py-2.5 font-semibold text-slate-600">Année N-1</th>
                <th className="text-right px-4 py-2.5 font-semibold text-slate-600 rounded-tr-lg">Variation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {indicators.map(({ key, label }) => {
                const val = data[key] as FinancialIndicator;
                return (
                  <tr key={key} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{label}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="text"
                        value={val.yearN || ''}
                        onChange={(e) => onUpdateIndicator(key, 'yearN', e.target.value)}
                        className="w-28 text-right px-2 py-1 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="text"
                        value={val.yearN1 || ''}
                        onChange={(e) => onUpdateIndicator(key, 'yearN1', e.target.value)}
                        className="w-28 text-right px-2 py-1 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <VariationBadge yearN={val.yearN} yearN1={val.yearN1} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SOUS-COMPOSANT : Aperçu Répartition Produits (éditable)
// ============================================================================

const ProductBreakdownPreview: React.FC<{
  data: ParsedProductBreakdown;
  onUpdate: (index: number, field: 'product' | 'caHT' | 'percentage', value: string) => void;
}> = ({ data, onUpdate }) => {
  // Couleurs pour les barres de progression
  const colors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-violet-500', 'bg-orange-500', 'bg-teal-500'];
  const maxCA = Math.max(...data.products.map(p => p.caHT), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
          Répartition du CA par produit
        </h3>
        <span className="text-sm font-medium text-slate-600">
          Total : {formatCurrency(data.totalCA)}
        </span>
      </div>

      <div className="space-y-3">
        {data.products.map((product, i) => (
          <div key={i} className="flex items-center gap-3">
            {/* Nom produit */}
            <input
              type="text"
              value={product.product}
              onChange={(e) => onUpdate(i, 'product', e.target.value)}
              className="w-40 px-2 py-1.5 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
            />

            {/* Barre de progression */}
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 bg-slate-100 rounded-full h-6 relative overflow-hidden">
                <div
                  className={`h-full rounded-full ${colors[i % colors.length]} transition-all`}
                  style={{ width: `${Math.max((product.caHT / maxCA) * 100, 2)}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-700">
                  {formatPercent(product.percentage)}
                </span>
              </div>
            </div>

            {/* CA HT */}
            <input
              type="text"
              value={product.caHT || ''}
              onChange={(e) => onUpdate(i, 'caHT', e.target.value)}
              className="w-28 text-right px-2 py-1.5 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-indigo-500 outline-none"
              placeholder="0"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// SOUS-COMPOSANT : Identification en lecture seule (modal historique)
// ============================================================================

const IdentificationReadOnly: React.FC<{ data: ClientFinancialData }> = ({ data }) => {
  const indicators: { label: string; value: FinancialIndicator }[] = [
    { label: 'CA HT', value: data.caHT },
    { label: 'Marge commerciale', value: data.margeCommerciale },
    { label: 'Valeur ajoutée', value: data.valeurAjoutee },
    { label: 'EBE', value: data.ebe },
    { label: "Résultat d'exploitation", value: data.resultatExploitation },
    { label: 'Résultat net', value: data.resultatNet },
    { label: 'BFR', value: data.bfr },
    { label: 'Trésorerie', value: data.tresorerie },
  ];

  return (
    <div className="space-y-4">
      {/* Info entreprise */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {data.siret && (
          <div><span className="text-slate-500">SIRET :</span> <span className="font-medium">{data.siret}</span></div>
        )}
        {data.naf && (
          <div><span className="text-slate-500">NAF :</span> <span className="font-medium">{data.naf}</span></div>
        )}
        {data.activity && (
          <div className="col-span-2"><span className="text-slate-500">Activité :</span> <span className="font-medium">{data.activity}</span></div>
        )}
      </div>

      {/* Tableau financier */}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="text-left px-4 py-2 font-semibold text-slate-600">Indicateur</th>
            <th className="text-right px-4 py-2 font-semibold text-slate-600">Année N</th>
            <th className="text-right px-4 py-2 font-semibold text-slate-600">Année N-1</th>
            <th className="text-right px-4 py-2 font-semibold text-slate-600">Variation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {indicators.map(({ label, value }) => (
            <tr key={label} className="hover:bg-slate-50/50">
              <td className="px-4 py-2 font-medium text-slate-700">{label}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-800">{formatCurrency(value?.yearN || 0)}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-600">{formatCurrency(value?.yearN1 || 0)}</td>
              <td className="px-4 py-2 text-right"><VariationBadge yearN={value?.yearN || 0} yearN1={value?.yearN1 || 0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================================================
// SOUS-COMPOSANT : Produits en lecture seule (modal historique)
// ============================================================================

const ProductBreakdownReadOnly: React.FC<{ products: ClientFinancialData['productBreakdown'] }> = ({ products }) => {
  const colors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-violet-500', 'bg-orange-500', 'bg-teal-500'];
  const maxCA = Math.max(...products.map(p => p.caHT), 1);

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Répartition du CA par produit
      </h3>
      <div className="space-y-2">
        {products.map((p, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-32 text-sm font-medium text-slate-700 truncate">{p.product}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
              <div
                className={`h-full rounded-full ${colors[i % colors.length]}`}
                style={{ width: `${Math.max((p.caHT / maxCA) * 100, 2)}%` }}
              />
            </div>
            <span className="text-sm font-mono text-slate-700 w-24 text-right">{formatCurrency(p.caHT)}</span>
            <span className="text-xs text-slate-500 w-12 text-right">{formatPercent(p.percentage)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FinancialImport;
