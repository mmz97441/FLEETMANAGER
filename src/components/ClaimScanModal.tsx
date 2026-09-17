/**
 * PRISE EN CHARGE PAR SCAN (côté chauffeur)
 *
 * Le chauffeur scanne des colis (importés non affectés, ou déjà à un autre
 * chauffeur) → ils rejoignent SA tournée de livraison du jour. Modèle métier :
 * "scan = prise en charge en livraison".
 */
import React, { useState, useRef, lazy, Suspense } from 'react';
import { X, Camera, Loader2, CheckCircle, AlertTriangle, PackageCheck, Plus } from 'lucide-react';
import { User, ActivityAction } from '../types';
import { todayISO } from '../utils/date';
import { createAndClaimPackage } from '../services/missionService';
import { logActivity } from '../services/activityLogService';
import { scanPackage, scanReceiptLabel, type ScanReceipt, type ScanSource } from '../services/scanService';
import { getCurrentPosition } from '../utils/geo';

import BarcodeScanner from './Scanner';

interface ClaimScanModalProps {
  currentUser: User;
  onClose: () => void;
  onDone: (count: number, missionId?: string) => void;
  source?: ScanSource;
  confirmLabel?: string; // ex. "Commencer ma tournée" (démarrage) vs "Ajouter à ma tournée"
  // Mission active à alimenter (récupération pendant une tournée en cours). Sans
  // elle, les colis rejoignent la tournée de récupération du jour (DLV-…).
  targetMissionId?: string;
  // Clients expéditeurs — pour créer un colis hors-import (code introuvable).
  clients?: User[];
}

const clientLabel = (c: User) => c.companyName || `${c.firstName} ${c.lastName}`.trim() || 'Client';

const ClaimScanModal: React.FC<ClaimScanModalProps> = ({ currentUser, onClose, onDone, confirmLabel = 'Ouvrir ma tournée', targetMissionId, clients = [], source = 'driver-claim' }) => {
  const [scannedPkgs, setScannedPkgs] = useState<ScanReceipt[]>([]);
  const [showScanner, setShowScanner] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const isClaiming = isSearching;
  const resolvedMission = useRef<string>();
  const [retryCodes, setRetryCodes] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn'; message: string } | null>(null);

  // Colis HORS-IMPORT : codes scannés introuvables en base. On ne les perd plus
  // (avant : simple toast « introuvable » de 4 s) → ils s'accumulent ici et le
  // chauffeur peut les CRÉER (client + destinataire) pour les intégrer à sa tournée.
  const [unknownCodes, setUnknownCodes] = useState<string[]>([]);
  const unknownSeenRef = useRef<Set<string>>(new Set());
  const [createFor, setCreateFor] = useState<string | null>(null); // code en cours de création
  const [creating, setCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [createForm, setCreateForm] = useState({ clientId: '', contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });

  // File d'attente : en scan rafale, les codes sont traités en série SANS être
  // perdus (contrairement à un simple "ignore si occupé" qui droppait des colis).
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  const notify = (type: 'ok' | 'warn', message: string) => {
    setFeedback({ type, message });

  };

  const lookupCode = (code: string) => {
    const cleaned = code.trim();
    if (!cleaned) return;
    notify('warn', `${cleaned} — confirmation en cours…`);
    queueRef.current.push(cleaned);
    void drainQueue();
  };

  const drainQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsSearching(true);
    try {
      while (queueRef.current.length > 0) {
        const cleaned = queueRef.current.shift()!;
        try {
          notify('warn', `${cleaned} — confirmation en cours…`);
          const receipt = await scanPackage({ code: cleaned, driverId: currentUser.id, targetMissionId, source });
          if (receipt.accepted) {
            resolvedMission.current = receipt.missionId || undefined;
            setScannedPkgs(prev => [...prev.filter(p => p.packageId !== receipt.packageId), receipt]);
            setUnknownCodes(prev => prev.filter(c => c !== cleaned));
          } else if (receipt.outcome === 'not_found' && !unknownSeenRef.current.has(cleaned)) {
            unknownSeenRef.current.add(cleaned);
            setUnknownCodes(prev => [...prev, cleaned]);
          }
          setRetryCodes(prev => prev.filter(c => c !== cleaned));
          notify(receipt.accepted && receipt.outcome !== 'already_scanned' ? 'ok' : 'warn', scanReceiptLabel(receipt));
        } catch {
          setRetryCodes(prev => [...new Set([...prev, cleaned])]);
          notify('warn', `${cleaned} — confirmation non reçue. Vérifiez la connexion puis réessayez ce scan.`);
        }
      }
    } finally {
      processingRef.current = false;
      setIsSearching(false);
    }
  };

  const handleConfirm = () => {
    if (processingRef.current || creating) return;
    onDone(scannedPkgs.length + createdCount, resolvedMission.current);
  };

  // Ouvre le formulaire de création pour un code hors-import.
  const startCreate = (code: string) => {
    setCreateFor(code);
    setCreateForm({ clientId: '', contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });
  };

  // Crée le colis hors-import et le prend en charge dans la tournée (active si fournie).
  const handleCreate = async () => {
    if (!createFor || creating) return;
    if (!createForm.clientId) { notify('warn', 'Choisis le client expéditeur'); return; }
    if (!createForm.address.trim() || !createForm.city.trim()) { notify('warn', 'Adresse et ville obligatoires'); return; }
    setCreating(true);
    try {
      let location: { lat: number; lng: number } | undefined;
      try { location = await getCurrentPosition({ timeout: 5000 }); } catch { /* optionnel */ }
      const client = clients.find(c => c.id === createForm.clientId);
      const created = await createAndClaimPackage({
        code: createFor,
        clientId: createForm.clientId,
        clientName: client ? clientLabel(client) : 'Client',
        contactName: createForm.contactName,
        address: createForm.address,
        postalCode: createForm.postalCode,
        city: createForm.city,
        contactPhone: createForm.contactPhone,
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: todayISO(),
        location,
        targetMissionId
      });
      resolvedMission.current = created.missionId;
      // JOURNAL — création hors import (à réconcilier par le bureau).
      void logActivity(currentUser, ActivityAction.PACKAGE_CREATED_ADHOC, {
        targetType: 'package', targetName: createFor,
        description: `${currentUser.firstName} ${currentUser.lastName} a créé le colis hors import ${createFor} (${client ? clientLabel(client) : 'client'})`,
        details: { metadata: { code: createFor, client: client ? clientLabel(client) : undefined, ville: createForm.city } }
      });
      // Retirer le code de la liste « à créer » + compter.
      setUnknownCodes(prev => prev.filter(c => c !== createFor));
      setCreatedCount(n => n + 1);
      setCreateFor(null);
      notify('ok', `${createFor} — colis créé et pris en charge ✓`);
    } catch (e) {
      notify('warn', e instanceof Error ? e.message : 'Échec de la création');
    }
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-200 bg-green-50 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <PackageCheck size={18} className="text-green-600" />
                Récupérer des colis
              </h3>
              <p className="text-sm text-green-700 mt-0.5">
                Chaque scan confirmé rattache le colis à votre tournée du jour. Un colis provenant d’une autre tournée est transféré avec son historique.
              </p>
            </div>
            <button onClick={handleConfirm} aria-label="Fermer" className="min-h-11 min-w-11 p-2 rounded-full hover:bg-green-100" disabled={isClaiming || creating}>
              <X size={20} className="text-slate-400" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {feedback && (
            <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-bold ${
              feedback.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              {feedback.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              {feedback.message}
            </div>
          )}

          <button
            onClick={() => setShowScanner(true)}
            disabled={isClaiming || creating}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
          >
            <Camera size={18} /> Scanner un colis
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { lookupCode(manualCode); setManualCode(''); } }}
              placeholder="Ou saisir le N° colis (ex: BR0513)"
              className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-green-500 outline-none"
            />
            <button
              onClick={() => { lookupCode(manualCode); setManualCode(''); }}
              disabled={!manualCode.trim() || isSearching || isClaiming}
              className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 disabled:opacity-40"
            >
              {isSearching ? <Loader2 size={16} className="animate-spin" /> : 'OK'}
            </button>
          </div>

          {retryCodes.length > 0 && <div role="alert" className="rounded-xl border border-amber-300 p-3 text-sm text-amber-900">
            <p>{retryCodes.length} scan(s) sans confirmation :</p>
            {retryCodes.map(code => <button key={code} disabled={isSearching} className="ui-button ui-button-secondary m-1" onClick={() => lookupCode(code)}>Réessayer {code}</button>)}
          </div>}
          {scannedPkgs.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-slate-700">{scannedPkgs.length} colis confirmés dans votre tournée :</p>
              {scannedPkgs.map(pkg => (
                <div key={pkg.packageId!} className="flex flex-col gap-1 p-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold text-green-800">{pkg.packageCode}</p>
                    <p className="text-sm text-slate-600 break-words">{pkg.contactName} • {scanReceiptLabel(pkg)}</p>
                  </div>
                  <span className="text-sm text-green-800 break-all">Tournée {pkg.missionId}</span>
                </div>
              ))}
            </div>
          )}

          {createdCount > 0 && (
            <div className="rounded-xl border border-green-300 bg-green-50 p-2.5 text-sm font-bold text-green-800">
              ✅ {createdCount} colis hors-import créé{createdCount > 1 ? 's' : ''} et pris en charge
            </div>
          )}

          {/* COLIS HORS-IMPORT : codes scannés introuvables → à créer (rien n'est perdu) */}
          {unknownCodes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-amber-700 flex items-center gap-1">
                <AlertTriangle size={14} /> {unknownCodes.length} colis hors import — à créer
              </p>
              {unknownCodes.map(code => (
                <div key={code} className="flex items-center justify-between gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <p className="font-mono text-sm font-bold text-amber-800 truncate min-w-0">{code}</p>
                  <button
                    onClick={() => startCreate(code)}
                    disabled={isClaiming || creating}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-bold active:scale-95 transition-transform disabled:opacity-40"
                  >
                    <Plus size={14} /> Créer
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={isClaiming || creating}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-40"
          >
            {isClaiming ? (<><Loader2 size={18} className="animate-spin" /> Chargement…</>) : (<><PackageCheck size={18} /> {confirmLabel}{(scannedPkgs.length + createdCount) > 0 ? ` (${scannedPkgs.length + createdCount})` : ''}</>)}
          </button>
        </div>
      </div>

      {showScanner && (
        <Suspense fallback={<div className="fixed inset-0 z-[60] bg-black flex items-center justify-center"><Loader2 size={32} className="animate-spin text-white" /></div>}>
          <BarcodeScanner
            onScan={(code: string) => lookupCode(code)}
            onClose={() => setShowScanner(false)}
            expectedBarcodes={[]}
            // Codes déjà pris → re-scan affiche « ⚠️ déjà scanné » (clair).
            alreadyScanned={scannedPkgs.map(p => p.packageCode)}
            forwardDuplicates
            busy={isSearching}
            // PAS de isMatch={()=>true} : sinon un colis introuvable flashait VERT à tort.
            // Le vrai résultat (pris / introuvable / passation) est poussé via flashMessage.
            flashMessage={feedback ? { type: feedback.type, text: feedback.message } : null}
            // Compteur permanent visible PAR-DESSUS la caméra (le vrai feedback terrain).
            countLabel={scannedPkgs.length > 0 ? `${scannedPkgs.length} colis pris en charge` : undefined}
            title="Scan — récupération"
          />
        </Suspense>
      )}

      {/* FORMULAIRE DE CRÉATION — colis hors import (au-dessus de tout) */}
      {createFor && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !creating && setCreateFor(null)}>
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Plus size={18} className="text-amber-600" /> Créer un colis hors import
              </h3>
              <button onClick={() => !creating && setCreateFor(null)} aria-label="Fermer" className="min-h-11 min-w-11 p-2 rounded-full hover:bg-slate-100" disabled={creating}>
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <span>⚠️</span>
                <p className="text-sm text-amber-800">Colis <b>hors import</b>. Il rejoint ta tournée et sera signalé au bureau pour réconciliation avec le fichier client.</p>
              </div>
              <p className="text-sm text-slate-500">N° colis : <b className="font-mono">{createFor}</b></p>

              <div>
                <label className="text-sm font-bold text-slate-500 block mb-1">Client expéditeur *</label>
                <select
                  value={createForm.clientId}
                  onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none"
                >
                  <option value="">— Choisir —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{clientLabel(c)}</option>)}
                </select>
              </div>

              <input type="text" placeholder="Destinataire" value={createForm.contactName}
                onChange={e => setCreateForm(f => ({ ...f, contactName: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none" />
              <input type="text" placeholder="Adresse *" value={createForm.address}
                onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none" />
              <div className="flex gap-2">
                <input type="text" inputMode="numeric" placeholder="Code postal" value={createForm.postalCode}
                  onChange={e => setCreateForm(f => ({ ...f, postalCode: e.target.value }))}
                  className="w-1/3 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none" />
                <input type="text" placeholder="Ville *" value={createForm.city}
                  onChange={e => setCreateForm(f => ({ ...f, city: e.target.value }))}
                  className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none" />
              </div>
              <input type="tel" placeholder="Téléphone (optionnel)" value={createForm.contactPhone}
                onChange={e => setCreateForm(f => ({ ...f, contactPhone: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none" />

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
              >
                {creating ? <><Loader2 size={18} className="animate-spin" /> Création…</> : <><Plus size={18} /> Créer et prendre en charge</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClaimScanModal;
