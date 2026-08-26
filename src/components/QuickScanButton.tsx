/**
 * BOUTON FLOTTANT DE SCAN RAPIDE
 *
 * Raccourci disponible sur tous les écrans (usage interne) : ouvre la caméra,
 * scanne un colis (étiquette client BR…/2D, tracking GFL… ou N° commande) et
 * affiche instantanément sa fiche — statut, destinataire et suivi complet.
 * Lecture seule : aucun risque de modifier une donnée.
 */
import React, { useState, useRef, lazy, Suspense } from 'react';
import { ScanLine, X, Loader2, MapPin, Package as PackageIcon, Search, PackageCheck, CheckCircle, Plus } from 'lucide-react';
import { Package, PackageStatus, PACKAGE_STATUS_COLORS, User, UserRole } from '../types';
import { normalizeRole } from '../utils/role';
import { todayISO } from '../utils/date';
import { findPackageByCode, claimPackagesForDelivery, createAndClaimPackage, getPendingPackagesForClient } from '../services/missionService';
import { reportError } from '../services/logService';
import { packageDisplayCode, packageScanCodes, packageMatchesCode } from '../utils/barcode';
import { getCurrentPosition } from '../utils/geo';
import PackageTimeline from './PackageTimeline';

interface QuickScanButtonProps {
  currentUser: User;
  clients?: User[];
}

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

const statusEmoji = (s: PackageStatus): string => {
  if (s === PackageStatus.DELIVERED) return '✅';
  if (s === PackageStatus.FAILED) return '❌';
  if (s === PackageStatus.PENDING) return '⏳';
  if (s === PackageStatus.COLLECTED) return '📦';
  if (s === PackageStatus.RETURNED || s === PackageStatus.RETURN_REQUESTED) return '↩️';
  return '🚚';
};

const QuickScanButton: React.FC<QuickScanButtonProps> = ({ currentUser, clients = [] }) => {
  const [showScanner, setShowScanner] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<{ pkg: Package | null; scannedCode: string } | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Création à la volée (carton hors import)
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ clientId: '', contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });

  // === MODE MANIFESTE D'ENLÈVEMENT — scan = PRISE EN CHARGE IMMÉDIATE ===
  // Au 1er scan d'un colis d'un client à fichier, on affiche tous ses colis
  // « En attente » (attendus). CHAQUE scan prend le colis en charge DIRECTEMENT
  // (aucun bouton « valider » : s'il a scanné, il a pris le colis). En rafale
  // continue, avec en direct : X pris / N attendus + lesquels manquent.
  const [manifest, setManifest] = useState<Package[] | null>(null);
  const [manifestClient, setManifestClient] = useState('');
  const [manifestScanning, setManifestScanning] = useState(false);
  const [manifestScannedCodes, setManifestScannedCodes] = useState<string[]>([]);
  const [manifestClaimedIds, setManifestClaimedIds] = useState<Set<string>>(new Set());
  const claimingRef = useRef<Set<string>>(new Set());

  const manifestMissing = manifest ? manifest.filter(p => !manifestClaimedIds.has(p.id)) : [];

  // Prise en charge d'UN colis (idempotent + garde anti-double via claimingRef).
  const claimOne = async (pkg: Package) => {
    if (claimingRef.current.has(pkg.id)) return;
    claimingRef.current.add(pkg.id);
    try {
      let location: { lat: number; lng: number } | undefined;
      try { location = await getCurrentPosition({ timeout: 5000 }); } catch { /* optionnel */ }
      await claimPackagesForDelivery({
        packages: [pkg],
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: todayISO(),
        location,
      });
      setManifestClaimedIds(prev => new Set(prev).add(pkg.id));
      setClaimError(null); // succès → on efface une éventuelle erreur précédente
    } catch (e) {
      setClaimError(`Colis ${packageDisplayCode(pkg)} NON pris (réseau ?) — rescanne-le`);
    } finally {
      claimingRef.current.delete(pkg.id);
    }
  };

  // Rafale : chaque scan prend en charge le colis correspondant NON encore pris.
  // On NE ferme PAS le scanner → le chauffeur scanne tous ses cartons d'affilée.
  const handleManifestScan = (code: string) => {
    setManifestScannedCodes(prev => (prev.includes(code) ? prev : [...prev, code]));
    setManifestClaimedIds(claimed => {
      const hit = (manifest || []).find(p =>
        !claimed.has(p.id) && !claimingRef.current.has(p.id) && packageMatchesCode(p, code)
      );
      if (hit) void claimOne(hit);
      return claimed; // l'ajout réel se fait dans claimOne après succès
    });
  };

  const handleCreate = async () => {
    if (!result) return;
    if (!createForm.clientId) { setClaimError('Choisissez le client expéditeur'); return; }
    if (!createForm.address.trim() || !createForm.city.trim()) { setClaimError('Adresse et ville obligatoires'); return; }
    setCreating(true); setClaimError(null);
    try {
      let location: { lat: number; lng: number } | undefined;
      try {
        location = await getCurrentPosition({ timeout: 5000 });
      } catch { /* optionnel */ }
      const client = clients.find(c => c.id === createForm.clientId);
      await createAndClaimPackage({
        code: result.scannedCode,
        clientId: createForm.clientId,
        clientName: client?.companyName || (client ? `${client.firstName} ${client.lastName}` : 'Client'),
        contactName: createForm.contactName,
        address: createForm.address,
        postalCode: createForm.postalCode,
        city: createForm.city,
        contactPhone: createForm.contactPhone,
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: todayISO(),
        location
      });
      setShowCreate(false);
      setClaimed(true);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Échec de la création');
    }
    setCreating(false);
  };

  // Un colis est "prenable en charge" s'il n'est pas déjà livré/retourné,
  // et pas déjà dans la tournée de la personne qui scanne.
  const canClaim = (pkg: Package): boolean =>
    pkg.status !== PackageStatus.DELIVERED &&
    pkg.status !== PackageStatus.RETURNED &&
    !(pkg.currentDriverId === currentUser.id && !!pkg.missionId);

  const handleClaim = async () => {
    if (!result?.pkg || isClaiming) return;
    setIsClaiming(true);
    try {
      let location: { lat: number; lng: number } | undefined;
      try {
        location = await getCurrentPosition({ timeout: 5000 });
      } catch { /* géoloc optionnelle */ }
      await claimPackagesForDelivery({
        packages: [result.pkg],
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: todayISO(),
        location
      });
      setClaimed(true);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Échec de la prise en charge — réessayez');
    }
    setIsClaiming(false);
  };

  const handleScan = async (code: string) => {
    setShowScanner(false);
    setIsSearching(true);
    setResult(null);
    setClaimError(null);
    try {
      const pkg = await findPackageByCode(code);
      // Enlèvement d'un client à fichier : si le colis scanné appartient à un
      // client qui a PLUSIEURS colis « En attente », on passe en mode MANIFESTE
      // (liste attendue + complétude) au lieu de la fiche 1 colis.
      if (pkg && pkg.clientId && pkg.status === PackageStatus.PENDING) {
        try {
          const pending = await getPendingPackagesForClient(pkg.clientId);
          if (pending.length >= 2) {
            setManifest(pending);
            setManifestClient(pkg.clientName || 'ce client');
            setManifestScannedCodes([code]);
            setManifestClaimedIds(new Set());
            setIsSearching(false);
            void claimOne(pkg);        // 1er colis pris en charge immédiatement
            setManifestScanning(true); // et on enchaîne la rafale (scanner reste ouvert)
            return;
          }
        } catch { /* si le manifeste échoue, on retombe sur la fiche 1 colis */ }
      }
      // pkg === null => vraiment introuvable ; sinon on affiche la fiche.
      setResult({ pkg, scannedCode: code });
    } catch (e) {
      // NE PAS faire croire à un "introuvable" alors que c'est une erreur réseau
      // ou de droits : on trace, on affiche l'erreur, et on n'invite pas à
      // créer un doublon.
      reportError('quickscan.search', e, {
        userMessage: 'Recherche impossible (réseau ou droits). Vérifiez votre connexion et rescannez.',
        extra: { code }
      });
      setClaimError('Recherche impossible — vérifiez votre connexion et rescannez.');
    }
    setIsSearching(false);
  };

  const reset = () => {
    setResult(null);
    setIsSearching(false);
    setClaimed(false);
    setIsClaiming(false);
    setClaimError(null);
    setShowCreate(false);
    setCreating(false);
    setCreateForm({ clientId: '', contactName: '', address: '', postalCode: '', city: '', contactPhone: '' });
    setManifest(null);
    setManifestClient('');
    setManifestScannedCodes([]);
    setManifestScanning(false);
    setManifestClaimedIds(new Set());
    claimingRef.current = new Set();
  };

  const handleClaimClick = () => { setClaimError(null); handleClaim(); };

  return (
    <>
      {/* Bouton flottant — au-dessus de la barre de nav mobile */}
      <button
        onClick={() => { reset(); setShowScanner(true); }}
        title="Scanner un colis"
        aria-label="Scanner un colis"
        className="fixed z-40 bottom-20 right-4 lg:bottom-6 lg:right-6 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-lg shadow-brand-600/30 flex items-center justify-center active:scale-90 transition-transform"
      >
        <ScanLine size={24} />
      </button>

      {/* Scanner plein écran */}
      {showScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white" />
          </div>
        }>
          <BarcodeScanner
            onScan={handleScan}
            onClose={() => setShowScanner(false)}
            expectedBarcodes={[]}
            alreadyScanned={[]}
            title="Scan rapide — rechercher un colis"
          />
        </Suspense>
      )}

      {/* Scanner RAFALE du manifeste d'enlèvement */}
      {manifestScanning && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white" />
          </div>
        }>
          <BarcodeScanner
            onScan={handleManifestScan}
            onClose={() => setManifestScanning(false)}
            expectedBarcodes={(manifest || []).flatMap(p => packageScanCodes(p))}
            alreadyScanned={manifestScannedCodes}
            isMatch={(code) => (manifest || []).some(p => packageMatchesCode(p, code))}
            title={`Enlèvement ${manifestClient} — scanne tous les cartons`}
            hint="Chaque scan prend le colis en charge automatiquement"
            progress={{ done: manifestClaimedIds.size, total: manifest?.length || 0 }}
          />
        </Suspense>
      )}

      {/* Erreur de prise en charge VISIBLE au-dessus du scanner (z > scanner) :
          si un claim échoue en rafale, le chauffeur le voit tout de suite au lieu
          d'un faux « pris ». Le compteur X/N n'avance QUE sur claim réussi. */}
      {manifestScanning && claimError && (
        <div className="fixed top-28 left-4 right-4 z-[60] px-4 py-3 rounded-xl bg-red-600 text-white text-sm font-bold text-center shadow-lg">
          ⚠️ {claimError}
        </div>
      )}

      {/* Recherche en cours */}
      {isSearching && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-6 py-5 flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-brand-600" />
            <span className="text-sm font-medium text-slate-700">Recherche du colis…</span>
          </div>
        </div>
      )}

      {/* MANIFESTE D'ENLÈVEMENT — complétude vs colis attendus du client */}
      {manifest && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={reset}>
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
            {/* En-tête */}
            <div className="p-4 border-b border-slate-200 flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Enlèvement</p>
                <p className="font-bold text-lg text-slate-800 truncate">{manifestClient}</p>
              </div>
              <button onClick={reset} className="p-2 rounded-full hover:bg-slate-100 shrink-0"><X size={20} className="text-slate-400" /></button>
            </div>

            <div className="p-4 space-y-3">
              {/* Compteur — se met à jour à CHAQUE scan (prise en charge auto) */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">Pris en charge</span>
                <span className={`text-2xl font-black tabular-nums ${manifestMissing.length === 0 ? 'text-green-600' : 'text-slate-800'}`}>{manifestClaimedIds.size} / {manifest.length}</span>
              </div>
              {manifestMissing.length === 0 ? (
                <div className="rounded-xl border border-green-300 bg-green-50 p-3 text-sm font-semibold text-green-800">✅ Tu as bien <b>tous</b> les colis de {manifestClient} ({manifest.length}/{manifest.length}).</div>
              ) : (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-bold">⚠️ Il te manque {manifestMissing.length} colis sur {manifest.length}.</p>
                  <p className="text-xs mt-1">À scanner : {manifestMissing.map(packageDisplayCode).join(', ')}</p>
                </div>
              )}

              {/* Liste des colis attendus (✅ = pris en charge au scan) */}
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[38vh] overflow-y-auto">
                {manifest.map(p => {
                  const ok = manifestClaimedIds.has(p.id);
                  return (
                    <div key={p.id} className={`px-3 py-2 flex items-center gap-2.5 ${ok ? 'bg-green-50' : 'bg-white'}`}>
                      {ok ? <CheckCircle size={16} className="text-green-600 shrink-0" /> : <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className={`font-mono text-xs font-bold ${ok ? 'text-green-700' : 'text-slate-800'}`}>{packageDisplayCode(p)}</p>
                        <p className="text-[11px] text-slate-500 truncate">→ {p.contactName} • {p.city}</p>
                      </div>
                      {ok && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-green-100 text-green-700 rounded">PRIS</span>}
                    </div>
                  );
                })}
              </div>

              {claimError && <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg p-2">⚠️ {claimError}</p>}

              {/* Scan = prise en charge auto (aucune validation manuelle) */}
              <button onClick={() => setManifestScanning(true)} className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform">
                <ScanLine size={18} /> {manifestClaimedIds.size === 0 ? 'Scanner les colis' : 'Scanner un autre colis'}
              </button>
              <button onClick={reset} className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm">Terminer</button>
            </div>
          </div>
        </div>
      )}

      {/* Fiche résultat */}
      {result && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4" onClick={reset}>
          <div
            className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            {result.pkg ? (
              <>
                {/* En-tête fiche colis */}
                <div className="p-4 border-b border-slate-200 flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-lg font-bold text-slate-800">{packageDisplayCode(result.pkg)}</p>
                    <p className="text-xs text-slate-500">Commande {result.pkg.orderNumber}</p>
                  </div>
                  <button onClick={reset} className="p-2 rounded-full hover:bg-slate-100 shrink-0">
                    <X size={20} className="text-slate-400" />
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  {/* Statut */}
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${
                      (PACKAGE_STATUS_COLORS[result.pkg.status] || { bg: 'bg-slate-100', text: 'text-slate-700' }).bg
                    } ${(PACKAGE_STATUS_COLORS[result.pkg.status] || { text: 'text-slate-700' }).text}`}>
                      {statusEmoji(result.pkg.status)} {result.pkg.status}
                    </span>
                  </div>

                  {/* Changement de main : colis déjà dans la tournée d'un collègue.
                      Le receveur voit clairement qu'il le RÉCUPÈRE (transfert tracé). */}
                  {result.pkg.currentDriverId && result.pkg.currentDriverId !== currentUser.id && !!result.pkg.missionId && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                      🔁 <b>Ce colis est actuellement porté par {[...(result.pkg.movements || [])].reverse().find(m => m.driverName)?.driverName || 'un autre chauffeur'}.</b> En le prenant en charge, il basculera dans <b>ta tournée</b> (le transfert est tracé : de lui → à toi).
                    </div>
                  )}

                  {/* Destinataire */}
                  <div className="flex items-start gap-2 text-sm">
                    <PackageIcon size={16} className="text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-800">{result.pkg.contactName}</p>
                      <p className="text-slate-500 flex items-center gap-1 text-xs">
                        <MapPin size={12} /> {result.pkg.address}, {result.pkg.postalCode} {result.pkg.city}
                      </p>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="border-t border-slate-100 pt-2">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Suivi du colis</p>
                    {/* Détail complet (chauffeur+véhicule à chaque étape + preuve)
                        pour tous SAUF le chauffeur (vue chauffeur volontairement sobre). */}
                    <PackageTimeline
                      movements={result.pkg.movements || []}
                      showActors={normalizeRole(currentUser.role) !== UserRole.DRIVER}
                      showInternalDetails
                      pod={normalizeRole(currentUser.role) === UserRole.DRIVER ? undefined : result.pkg.pod}
                    />
                  </div>
                </div>
              </>
            ) : (
              /* Colis introuvable */
              !showCreate ? (
              <div className="p-6 text-center">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <Search size={24} className="text-amber-600" />
                </div>
                <p className="font-bold text-slate-800">Colis introuvable</p>
                <p className="text-sm text-slate-500 mt-1">
                  Aucun colis ne correspond au code scanné :
                </p>
                <p className="font-mono text-sm font-bold text-slate-700 mt-1 break-all">{result.scannedCode}</p>
                <p className="text-xs text-slate-400 mt-2">
                  Ce carton n'a pas été importé. Vous pouvez le créer et le prendre en charge maintenant.
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-4 w-full flex items-center justify-center gap-2 py-3 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
                >
                  <Plus size={18} /> Créer et prendre en charge
                </button>
              </div>
              ) : (
              /* Formulaire de création à la volée */
              <div className="p-4 space-y-3">
                <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <span>⚠️</span>
                  <p className="text-[11px] text-amber-800">Colis <b>hors import</b>. Il sera pris en charge dans votre tournée et signalé au bureau pour réconciliation avec le fichier client.</p>
                </div>
                <p className="text-xs text-slate-500">N° colis : <b className="font-mono">{result.scannedCode}</b></p>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Client expéditeur *</label>
                  <select value={createForm.clientId} onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-green-500 outline-none">
                    <option value="">— Choisir —</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.companyName || `${c.firstName} ${c.lastName}`}</option>)}
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
              </div>
              )
            )}

            {/* Actions */}
            {/* Prise en charge : bouton principal quand le colis est disponible */}
            {claimError && (
              <div className="px-4 pt-1">
                <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg p-2">⚠️ {claimError}</p>
              </div>
            )}
            {result.pkg && !claimed && canClaim(result.pkg) && (
              <div className="px-4 pt-1">
                <button
                  onClick={handleClaimClick}
                  disabled={isClaiming}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                >
                  {isClaiming ? <><Loader2 size={18} className="animate-spin" /> Prise en charge…</> : <><PackageCheck size={18} /> Prendre en charge dans ma tournée</>}
                </button>
              </div>
            )}
            {claimed && (
              <div className="px-4 pt-1">
                <div className="w-full flex items-center justify-center gap-2 py-3 bg-green-50 border border-green-200 text-green-700 rounded-xl font-bold text-sm">
                  <CheckCircle size={18} /> Pris en charge dans votre tournée
                </div>
              </div>
            )}
            {showCreate && !claimed && (
              <div className="px-4 pt-1">
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform disabled:opacity-50"
                >
                  {creating ? <><Loader2 size={18} className="animate-spin" /> Création…</> : <><Plus size={18} /> Créer et prendre en charge</>}
                </button>
              </div>
            )}

            <div className="p-4 border-t border-slate-200 flex gap-2">
              <button
                onClick={() => { reset(); setShowScanner(true); }}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
              >
                <ScanLine size={18} /> Scanner un autre
              </button>
              <button
                onClick={reset}
                className="px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium text-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default QuickScanButton;
