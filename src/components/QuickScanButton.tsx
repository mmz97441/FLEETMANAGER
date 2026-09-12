/**
 * BOUTON FLOTTANT DE SCAN RAPIDE
 *
 * Raccourci disponible sur tous les écrans (usage interne) : ouvre la caméra,
 * scanne un colis (étiquette client BR…/2D, tracking GFL… ou N° commande) et
 * affiche instantanément sa fiche — statut, destinataire et suivi complet.
 * La prise en charge est une opération réelle, confirmée après réponse serveur.
 */
import React, { useState, useRef, lazy, Suspense } from 'react';
import {
  ScanLine,
  Loader2,
  MapPin,
  Package as PackageIcon,
  Search,
  PackageCheck,
  CheckCircle,
  Plus,
  AlertTriangle,
  ArrowUpDown,
  Clock,
  Truck,
  Undo2,
  XCircle,
} from 'lucide-react';
import { Package, PackageStatus, PACKAGE_STATUS_COLORS, User, UserRole } from '../types';
import { normalizeRole } from '../utils/role';
import { todayISO } from '../utils/date';
import { findPackageByCode, claimPackagesForDelivery, createAndClaimPackage, getPendingPackagesForClient } from '../services/missionService';
import { reportError } from '../services/logService';
import { packageDisplayCode, packageScanCodes, packageMatchesCode } from '../utils/barcode';
import { getCurrentPosition } from '../utils/geo';
import Modal from './shared/Modal';
import { FormInput, FormSelect } from './shared/FormInput';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { packageStatusLabel } from '../utils/operationalLabels';
import PackageTimeline from './PackageTimeline';

interface QuickScanButtonProps {
  currentUser: User;
  clients?: User[];
}

const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

const StatusIcon = ({ status }: { status: PackageStatus }) => {
  const Icon =
    status === PackageStatus.DELIVERED
      ? CheckCircle
      : status === PackageStatus.FAILED
        ? XCircle
        : status === PackageStatus.PENDING
          ? Clock
          : status === PackageStatus.COLLECTED
            ? PackageIcon
            : status === PackageStatus.RETURNED ||
                status === PackageStatus.RETURN_REQUESTED
              ? Undo2
              : Truck;
  return <Icon size={16} aria-hidden="true" />;
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
  const [manifestErrors, setManifestErrors] = useState<Record<string, string>>({});
  const [pendingClaims, setPendingClaims] = useState(0);
  const [manifestClaimedIds, setManifestClaimedIds] = useState<Set<string>>(new Set());
  const claimingRef = useRef<Set<string>>(new Set());

  const busy = isSearching || isClaiming || creating || pendingClaims > 0;
  const dirty = showCreate && !claimed && Object.values(createForm).some(value => value.trim());
  const requestClose = useUnsavedChanges(dirty, busy);
  const close = () => { void requestClose(reset); };
  const scanAnother = () => { void requestClose(() => { reset(); setShowScanner(true); }); };
  const manifestMissing = manifest ? manifest.filter(p => !manifestClaimedIds.has(p.id)) : [];

  // Prise en charge d'UN colis (idempotent + garde anti-double via claimingRef).
  const claimOne = async (pkg: Package) => {
    if (claimingRef.current.has(pkg.id)) return;
    claimingRef.current.add(pkg.id);
    setPendingClaims(previous => previous + 1);
    try {
      let location: { lat: number; lng: number } | undefined;
      try {
        location = await getCurrentPosition({ timeout: 5000 });
      } catch { /* géoloc optionnelle */ }
      await claimPackagesForDelivery({
        packages: [pkg],
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: todayISO(),
        location,
      });
      setManifestClaimedIds(prev => new Set(prev).add(pkg.id));
      setManifestErrors(previous => { const next = { ...previous }; delete next[pkg.id]; return next; });
    } catch (e) {
      reportError('quickscan.manifest.claim', e, { silent: true });
      setManifestErrors(previous => ({ ...previous, [pkg.id]: `Colis ${packageDisplayCode(pkg)} : prise en charge non confirmée. Vérifiez le réseau et scannez-le à nouveau.` }));
    } finally {
      claimingRef.current.delete(pkg.id);
      setPendingClaims(previous => Math.max(0, previous - 1));
    }
  };

  // Rafale : chaque scan prend en charge le colis correspondant NON encore pris.
  // On NE ferme PAS le scanner → le chauffeur scanne tous ses cartons d'affilée.
  const handleManifestScan = (code: string) => {
    const hit = (manifest || []).find(pkg =>
      !manifestClaimedIds.has(pkg.id) && !claimingRef.current.has(pkg.id) && packageMatchesCode(pkg, code)
    );
    if (hit) void claimOne(hit);
  };

  const handleCreate = async () => {
    if (!result || creating) return;
    if (!createForm.clientId) { setClaimError('Choisissez le client expéditeur'); return; }
    if (!createForm.address.trim() || !createForm.city.trim()) { setClaimError('Adresse et ville obligatoires'); return; }
    setCreating(true); setClaimError(null);
    try {
      let location: { lat: number; lng: number } | undefined;
      try {
        location = await getCurrentPosition({ timeout: 5000 });
      } catch { /* géoloc optionnelle */ }
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
      reportError('quickscan.create', e, { silent: true });
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
      } catch { /* si le manifeste échoue, on retombe sur la fiche 1 colis */ }
      await claimPackagesForDelivery({
        packages: [result.pkg],
        driver: { id: currentUser.id, name: `${currentUser.firstName} ${currentUser.lastName}` },
        date: todayISO(),
        location
      });
      setClaimed(true);
    } catch (e) {
      reportError('quickscan.claim', e, { silent: true });
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
          // Scopé au LOT d'import du colis scanné → le manifeste reflète l'enlèvement
          // du jour, sans colis fantômes d'anciens lots jamais enlevés.
          const pending = await getPendingPackagesForClient(pkg.clientId, pkg.importBatchId);
          if (pending.length >= 2) {
            setManifest(pending);
            setManifestClient(pkg.clientName || 'ce client');
            setManifestErrors({});
            setManifestClaimedIds(new Set());
            setIsSearching(false);
            void claimOne(pkg);        // 1er colis pris en charge immédiatement
            setManifestScanning(true); // et on enchaîne la rafale (scanner reste ouvert)
            return;
          }
        } catch {}
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
    if (busy) return;
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
    setManifestErrors({});
    setManifestScanning(false);
    setManifestClaimedIds(new Set());
    claimingRef.current = new Set();
  };

  const handleClaimClick = () => { setClaimError(null); handleClaim(); };

  return (
    <>
      {/* Prise en charge : bouton principal quand le colis est disponible */}
      <button
        onClick={scanAnother}
        disabled={busy}
        title="Scanner un colis"
        aria-label="Scanner un colis"
        className="ui-button ui-button-primary fixed z-40 bottom-20 right-4 lg:bottom-6 lg:right-6 w-14 h-14"
      >
        <ScanLine size={24} />
      </button>

      {/* Prise en charge : bouton principal quand le colis est disponible */}
      {showScanner && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-white" />
            </div>
          }
        >
          <BarcodeScanner
            onScan={handleScan}
            onClose={() => setShowScanner(false)}
            expectedBarcodes={[]}
            alreadyScanned={[]}
            title="Scan rapide — rechercher un colis"
          />
        </Suspense>
      )}

      {/* Prise en charge : bouton principal quand le colis est disponible */}
      {manifestScanning && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
              <Loader2 size={32} className="animate-spin text-white" />
            </div>
          }
        >
          <BarcodeScanner
            onScan={handleManifestScan}
            onClose={() => setManifestScanning(false)}
            expectedBarcodes={(manifest || []).flatMap(p => packageScanCodes(p))}
            alreadyScanned={(manifest || []).filter(pkg => manifestClaimedIds.has(pkg.id)).flatMap(packageScanCodes)}
            flashMessage={
              Object.keys(manifestErrors).length > 0
                ? { type: 'warn', text: Object.values(manifestErrors).join(' ') }
                : pendingClaims > 0
                  ? {
                      type: 'warn',
                      text: `${pendingClaims} prise${pendingClaims > 1 ? "s" : ''} en charge en cours de confirmation…`,
                    }
                  : null
            }
            isMatch={(code) => (manifest || []).some(p => packageMatchesCode(p, code))}
            title={`Enlèvement — ${manifestClient}`}
            progress={{ done: manifestClaimedIds.size, total: manifest?.length || 0 }}
          />
        </Suspense>
      )}

      <Modal isOpen={isSearching} onClose={() => {}} title="Recherche du colis" preventClose size="sm">
        <p role="status" className="flex items-center gap-3 text-slate-700">
          <Loader2 size={20} className="animate-spin" />
          Recherche en cours…
        </p>
      </Modal>
      <Modal isOpen={!isSearching && !result && !manifest && !!claimError} onClose={close} title="Recherche impossible" size="sm">
        <p role="alert" className="text-red-800">
          {claimError}
        </p>
        <button
          type="button"
          onClick={scanAnother}
          className="ui-button ui-button-primary mt-4 w-full"
        >
          Scanner à nouveau
        </button>
      </Modal>

      {/* Prise en charge : bouton principal quand le colis est disponible */}
      {manifest && !manifestScanning && (
        <Modal
          isOpen
          onClose={close}
          title={`Enlèvement — ${manifestClient}`}
          preventClose={busy}
          size="lg"
          mobileFullscreen
          bodyClassName="!p-0"
          footer={
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setManifestScanning(true)}
                className="ui-button ui-button-primary flex-1"
              >
                <ScanLine size={18} />
                {manifestClaimedIds.size === 0 ? 'Scanner les colis' : 'Scanner un autre colis'}
              </button>
              <button
                onClick={close}
                disabled={busy}
                className="ui-button ui-button-secondary"
              >
                Fermer le manifeste
              </button>
            </div>
          }
        >
          <div className="p-4 space-y-3">
            {/* Prise en charge : bouton principal quand le colis est disponible */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">
                Pris en charge
              </span>
              <span className="text-xl font-bold tabular-nums text-slate-900">
                {manifestClaimedIds.size} / {manifest.length}
              </span>
            </div>
            {manifestMissing.length === 0 ? (
              <p className="ui-notice ui-notice-success flex items-start gap-2">
                <CheckCircle size={18} className="shrink-0" />
                <span>
                  Tous les colis de {manifestClient} sont pris en charge.
                </span>
              </p>
            ) : (
              <p className="ui-notice ui-notice-warning flex items-start gap-2">
                <AlertTriangle size={18} className="shrink-0" />
                <span>
                  Il reste {manifestMissing.length} colis à prendre en charge.
                  Retrouvez leurs références ci-dessous.
                </span>
              </p>
            )}

            {/* Prise en charge : bouton principal quand le colis est disponible */}
            <div className="divide-y divide-slate-200">
              {manifest.map((p) => {
                const ok = manifestClaimedIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={`py-3 flex items-start gap-2.5 ${ok ? 'bg-green-50' : 'bg-white'}`}
                  >
                    {ok ? (
                      <CheckCircle
                        size={16}
                        className="text-green-700 shrink-0"
                      />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-mono text-sm font-semibold break-all ${ok ? 'text-green-700' : 'text-slate-800'}`}
                      >
                        {packageDisplayCode(p)}
                      </p>
                      <p className="text-sm text-slate-600 break-words">
                        {p.contactName} · {p.city}
                      </p>
                    </div>
                    {ok && (
                      <span className="text-sm font-semibold text-green-800">
                        Pris
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {pendingClaims > 0 && (
              <p role="status" className="ui-notice ui-notice-info">
                {pendingClaims} prise{pendingClaims > 1 ? "s" : ''} en charge en
                cours de confirmation. Attendez avant de terminer.
              </p>
            )}
            {Object.values(manifestErrors).map((message) => (
              <p
                key={message}
                role="alert"
                className="ui-notice ui-notice-danger"
              >
                {message}
              </p>
            ))}
          </div>
        </Modal>
      )}

      {/* Prise en charge : bouton principal quand le colis est disponible */}
      {result && (
        <Modal
          isOpen
          onClose={close}
          title={showCreate ? 'Créer un colis hors import' : 'Résultat du scan'}
          preventClose={busy}
          size="lg"
          mobileFullscreen={showCreate}
          bodyClassName="!p-0"
          footer={
            <div className="space-y-2">
              {result.pkg && !claimed && canClaim(result.pkg) && (
                <button
                  onClick={handleClaimClick}
                  disabled={isClaiming}
                  className="ui-button ui-button-primary w-full"
                >
                  {isClaiming ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Prise en charge…
                    </>
                  ) : (
                    <>
                      <PackageCheck size={18} />
                      Prendre en charge dans ma tournée
                    </>
                  )}
                </button>
              )}
              {showCreate && !claimed && (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="ui-button ui-button-primary w-full"
                >
                  {creating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Création…
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      Créer et prendre en charge
                    </>
                  )}
                </button>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={scanAnother}
                  disabled={busy}
                  className={`ui-button ${claimed || (result.pkg && !canClaim(result.pkg)) ? "ui-button-primary" : "ui-button-secondary"} flex-1`}
                >
                  <ScanLine size={18} />
                  Scanner un autre
                </button>
                <button
                  onClick={close}
                  disabled={busy}
                  className="ui-button ui-button-secondary"
                >
                  Fermer
                </button>
              </div>
            </div>
          }
        >
          {result.pkg ? (
            <>
              <div className="p-4 pb-0 space-y-2">
                <p className="text-lg font-bold text-slate-900 break-words">
                  {result.pkg.contactName}
                </p>
                <p className="flex items-start gap-2 text-base text-slate-700">
                  <MapPin size={18} className="mt-0.5 shrink-0" />
                  <span>
                    {result.pkg.address}, {result.pkg.postalCode}{' '}
                    {result.pkg.city}
                  </span>
                </p>
                <p className="font-mono text-sm text-slate-700 break-all">
                  {packageDisplayCode(result.pkg)}
                </p>
                {result.pkg.orderNumber && (
                  <p className="text-sm text-slate-600 break-words">
                    Commande {result.pkg.orderNumber}
                  </p>
                )}
              </div>

              <div className="p-4 space-y-3">
                {/* Prise en charge : bouton principal quand le colis est disponible */}
                {!claimed && (
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${
                      (PACKAGE_STATUS_COLORS[result.pkg.status] || { bg: 'bg-slate-100', text: 'text-slate-700' }).bg
                    } ${(PACKAGE_STATUS_COLORS[result.pkg.status] || { text: 'text-slate-700' }).text}`}>
                      <StatusIcon status={result.pkg.status} />
                      {packageStatusLabel(result.pkg.status)}
                    </span>
                  </div>
                )}

                {/* Prise en charge : bouton principal quand le colis est disponible */}
                {!claimed &&
                  result.pkg.currentDriverId &&
                  result.pkg.currentDriverId !== currentUser.id &&
                  !!result.pkg.missionId && (
                    <div className="ui-notice ui-notice-warning">
                      <ArrowUpDown
                        size={18}
                        className="inline mr-1"
                        aria-hidden="true"
                      />
                      <b>
                        Ce colis est actuellement porté par{' '}
                        {[...(result.pkg.movements || [])].reverse().find(m => m.driverName)?.driverName || 'un autre chauffeur'}
                        .
                      </b>{' '}
                      En le prenant en charge, il basculera dans{' '}
                      <b>votre tournée</b> ; le transfert entre chauffeurs est
                      enregistré.
                    </div>
                  )}

                {/* Prise en charge : bouton principal quand le colis est disponible */}
                <div className="border-t border-slate-100 pt-2">
                  <p className="text-sm font-semibold text-slate-700 mb-1">
                    Suivi du colis
                  </p>
                  {/* Prise en charge : bouton principal quand le colis est disponible */}
                  <PackageTimeline
                      movements={result.pkg.movements || []}
                      showActors={normalizeRole(currentUser.role) !== UserRole.DRIVER}
                      showInternalDetails
                      pod={normalizeRole(currentUser.role) === UserRole.DRIVER ? undefined : result.pkg.pod}
                    />
                </div>
              </div>
            </>
          ) : claimed ? null : /* Colis introuvable */
          !showCreate ? (
            <div className="p-4">
              <p className="font-bold text-slate-800">Colis introuvable</p>
              <p className="text-sm text-slate-500 mt-1">
                Aucun colis ne correspond au code scanné :
              </p>
              <p className="font-mono text-sm font-bold text-slate-700 mt-1 break-all">
                {result.scannedCode}
              </p>
              <p className="text-sm text-slate-600 mt-2">
                Ce carton n'a pas été importé. Vous pouvez le créer et le
                prendre en charge maintenant.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="ui-button ui-button-primary mt-4 w-full gap-2"
              >
                <Plus size={18} /> Créer et prendre en charge
              </button>
            </div>
          ) : (
            /* Formulaire de création à la volée */
            <div className="p-4 space-y-3">
              <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle
                  size={18}
                  className="shrink-0 text-amber-900"
                  aria-hidden="true"
                />
                <p className="text-sm text-amber-800">
                  Colis <b>hors import</b>. Il sera pris en charge dans votre
                  tournée et signalé au bureau pour réconciliation avec le
                  fichier client.
                </p>
              </div>
              <p className="text-sm text-slate-600">
                N° colis :{' '}
                <b className="font-mono break-all">{result.scannedCode}</b>
              </p>
              <fieldset disabled={busy} className="space-y-3">
                <FormSelect label="Client expéditeur" required value={createForm.clientId} onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))} options={[{ value: '', label: 'Choisir un client' }, ...clients.map(client => ({ value: client.id, label: client.companyName || `${client.firstName} ${client.lastName}` }))]} />
                <FormInput label="Destinataire" value={createForm.contactName} onChange={e => setCreateForm(f => ({ ...f, contactName: e.target.value }))} />
                <FormInput label="Adresse" required autoComplete="street-address" value={createForm.address} onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormInput label="Code postal" inputMode="numeric" autoComplete="postal-code" value={createForm.postalCode} onChange={e => setCreateForm(f => ({ ...f, postalCode: e.target.value }))} />
                  <FormInput label="Ville" required autoComplete="address-level2" value={createForm.city} onChange={e => setCreateForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <FormInput label="Téléphone" hint="Optionnel" type="tel" autoComplete="tel" value={createForm.contactPhone} onChange={e => setCreateForm(f => ({ ...f, contactPhone: e.target.value }))} />
              </fieldset>
            </div>
          )}

          {claimError && (
            <div className="px-4 pb-4">
              <p role="alert" className="ui-notice ui-notice-danger">
                {claimError}
              </p>
            </div>
          )}
          {claimed && (
            <div className="px-4 pb-4">
              <p
                role="status"
                className="ui-notice ui-notice-success flex items-start gap-2"
              >
                <CheckCircle size={18} className="shrink-0" />
                <span>
                  {result.pkg
                    ? "Pris en charge dans votre tournée"
                    : "Colis créé et pris en charge dans votre tournée"}
                </span>
              </p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
};

export default QuickScanButton;
