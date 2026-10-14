import { useEffect, useMemo, useState } from 'react';
import app from '../firebaseConfig';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Mission, Package, PackageStatus, User, UserRole, Hub, IssueStatus } from '../types';
import { subscribeToMissions, subscribeToHubs } from '../services/missionService';
import { addIssueToFirestore, subscribeToUsers } from '../services/firestore';
import { uploadProofPhoto } from '../services/podService';
import { useOperationalDay } from '../hooks/useOperationalDay';
import { packageDisplayCode } from '../utils/barcode';
import Modal from './shared/Modal';
import BarcodeScanner from './Scanner';
import { subscribeToRecoveryPackages } from '../services/recoveryService';

export interface RecoveryPanelProps {
  currentUser: User;
  onResume?: () => void;
  onReturn?: (pkg: Package) => void;
  onInspect?: (missionId: string, packageId?: string) => void;
  onReplanify?: (pkg: Package) => void;
}
/** Exception inventory has no date horizon: old active parcels remain visible.
 * Reassignment still goes through the physical scan / dispatch workflows. */
export default function RecoveryPanel({ currentUser, onResume, onReturn, onInspect, onReplanify }: RecoveryPanelProps) {
  const office = [UserRole.ADMIN, UserRole.PRESIDENT, UserRole.DIRECTOR, UserRole.SECRETARY].includes(currentUser.role);
  const today = useOperationalDay();
  const [missions, setMissions] = useState<Mission[]>([]), [packages, setPackages] = useState<Package[]>([]);
  const [error, setError] = useState(''), [open, setOpen] = useState(false), [target, setTarget] = useState<Package | null>(null);
  const [hubs, setHubs] = useState<Hub[]>([]), [hubId, setHubId] = useState(''), [notes, setNotes] = useState('');
  const [code, setCode] = useState(''), [scanner, setScanner] = useState(false), [physical, setPhysical] = useState(false), [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false), [decision, setDecision] = useState<'REDELIVER' | 'SENDER_RETURNED'>('REDELIVER'), [date, setDate] = useState('');
  const [incident, setIncident] = useState<Package | null>(null), [incidentNotes, setIncidentNotes] = useState('');
  const [requestId, setRequestId] = useState('');
  const [recollect, setRecollect] = useState<Package | null>(null), [drivers, setDrivers] = useState<User[]>([]), [driverId, setDriverId] = useState('');
  useEffect(() => subscribeToMissions(setMissions, office ? undefined : { driverId: currentUser.id }, e => setError(e.message)), [office, currentUser.id]);
  useEffect(() => {
    return subscribeToRecoveryPackages(currentUser, setPackages, e => setError(e.message));
  }, [office, currentUser.id]);
  useEffect(() => { if (office) return subscribeToHubs(rows => setHubs(rows.filter(h => h.isActive)), e => setError(e.message)); }, [office]);
  useEffect(() => { if (office) return subscribeToUsers(currentUser, rows => setDrivers(rows.filter(user => user.role === UserRole.DRIVER && !user.isDisabled))); }, [office, currentUser.id]);
  const missionById = useMemo(() => new Map(missions.map(m => [m.id, m])), [missions]);
  const proofs = missions.flatMap(m => m.stops.filter(s => s.proofSyncPending).map(s => ({ mission: m, stop: s })));
  const unresolved = packages.filter(p => {
    if (p.status === PackageStatus.DELIVERED || p.returnDisposition === 'SENDER_RETURNED') return false;
    if (p.returnDisposition === 'AWAITING_DECISION' || (p.returnDisposition === 'REDELIVERY_READY' && !p.missionId) || p.status === PackageStatus.RETURN_REQUESTED || p.status === PackageStatus.FAILED ||
      (p.status === PackageStatus.RETURNED && !p.returnDisposition) || (p.pickupMissing && !p.missionId)) return true;
    const day = p.missionDate || missionById.get(p.missionId || '')?.date;
    return !!p.missionId && (!day || day < today);
  });
  const decide = async () => {
    if (!target || busy) return; setBusy(true); setError('');
    try {
      const proof = decision === 'SENDER_RETURNED' ? { photoUrls: [await uploadProofPhoto(photo, target.id, 'return')] } : undefined;
      await httpsCallable(getFunctions(app, 'europe-west1'), 'resolveReturnedPackage')({
        packageId: target.id, requestId, decision, notes, hubId, code,
        confirmedPhysicalPresence: physical, confirmedPhysicalHandover: physical,
        requestedDeliveryDate: date || null, ...(proof ? { proof } : {}),
      });
      setTarget(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Décision non enregistrée.'); }
    finally { setBusy(false); }
  };
  const reportIncident = async () => {
    if (!incident || busy || !incidentNotes.trim()) return; setBusy(true); setError('');
    try {
      const now = new Date().toISOString();
      await addIssueToFirestore({ id: '', vehicleId: incident.currentVehicleId || '', reportedByUserId: currentUser.id,
        reportedBy: `${currentUser.firstName} ${currentUser.lastName}`, description: `[Reprise colis ${packageDisplayCode(incident)} — ${incident.id}] ${incidentNotes.trim()}`,
        date: now, priority: 'High', status: IssueStatus.NEW, logs: [] });
      setIncident(null); setIncidentNotes('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Incident non enregistré.'); }
    finally { setBusy(false); }
  };
  const replan = async () => {
    if (!recollect || busy) return; setBusy(true); setError('');
    try {
      await httpsCallable(getFunctions(app, 'europe-west1'), 'replanPickup')({ packageIds: [recollect.id], driverId, hubId, date, requestId });
      setRecollect(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Collecte non planifiée.'); }
    finally { setBusy(false); }
  };
  if (!unresolved.length && !proofs.length && !error) return null;
  return <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-left" aria-label="Colis et preuves à reprendre">
    <button className="w-full text-left font-semibold min-h-11" onClick={() => setOpen(v => !v)}>{unresolved.length} colis à résoudre · {proofs.length} preuve(s) à synchroniser {open ? '▴' : '▾'}</button>
    {error && <p role="alert" className="text-red-800 break-words">{error}</p>}
    {open && <div className="space-y-3">
      <p className="text-sm">Vérifiez les anciennes tentatives avant toute nouvelle livraison. Une preuve manquante se récupère sur l’appareil d’origine.</p>
      {proofs.map(({ mission, stop }) => <div className="bg-white rounded-lg p-3" key={`${mission.id}/${stop.id}`}>
        <p className="font-semibold">Preuve en attente · {mission.date} · {stop.contactName}</p>
        <button className="ui-button ui-button-secondary mt-2" onClick={() => window.dispatchEvent(new CustomEvent('fleet-show-pending-sync', { detail: { missionId: mission.id } }))}>Vérifier les preuves sur cet appareil</button>
        {onInspect && <button className="ui-button ui-button-ghost" onClick={() => onInspect(mission.id)}>Ouvrir la tournée</button>}
      </div>)}
      {unresolved.map(pkg => {
        const mission = missionById.get(pkg.missionId || '');
        const pendingProof = mission?.stops.some(s => s.proofSyncPending && (s.id === pkg.stopId || s.packageIds.includes(pkg.id)));
        const canDecide = office && (pkg.returnDisposition === 'AWAITING_DECISION' || (pkg.status === PackageStatus.RETURNED && !pkg.returnDisposition));
        return <div className="bg-white rounded-lg p-3 space-y-2" key={pkg.id}>
          <p className="font-semibold break-words">{packageDisplayCode(pkg)} · {pkg.contactName}</p>
          <p className="text-sm">{pkg.status} · {mission?.date || pkg.missionDate || 'Sans tournée active'}{pkg.pickupMissing && !pkg.missionId ? ' · Collecte manquante à replanifier' : ''}</p>
          {pkg.failureReason && <p className="text-sm">Dernière tentative : {pkg.failureReason}</p>}
          {pendingProof && <p className="text-sm text-amber-900">Preuve à synchroniser avant de déplacer ce colis.</p>}
          <div className="flex flex-wrap gap-2">
            {onInspect && pkg.missionId && <button className="ui-button ui-button-secondary" onClick={() => onInspect(pkg.missionId!, pkg.id)}>Voir la tournée</button>}
            {office && !pendingProof && pkg.pickupMissing && !pkg.missionId && <button className="ui-button ui-button-secondary" onClick={() => { setRecollect(pkg); setDriverId(''); setHubId(''); setDate(today); setRequestId(crypto.randomUUID()); }}>Replanifier la collecte</button>}
            {onReplanify && office && !pendingProof && pkg.returnDisposition === 'REDELIVERY_READY' && <button className="ui-button ui-button-secondary" onClick={() => onReplanify(pkg)}>Planifier la relivraison</button>}
            {onResume && !pendingProof && ![PackageStatus.RETURNED, PackageStatus.FAILED, PackageStatus.RETURN_REQUESTED].includes(pkg.status) && <button className="ui-button ui-button-secondary" onClick={onResume}>Reprendre par scan physique</button>}
            {onReturn && !pendingProof && [PackageStatus.FAILED, PackageStatus.RETURN_REQUESTED].includes(pkg.status) && <button className="ui-button ui-button-secondary" onClick={() => onReturn(pkg)}>Remettre au dépôt</button>}
            {canDecide && <button className="ui-button ui-button-primary" onClick={() => { setTarget(pkg); setNotes(''); setHubId(pkg.currentHubId || ''); setCode(''); setPhysical(false); setPhoto(''); setDate(''); setDecision('REDELIVER'); setRequestId(crypto.randomUUID()); }}>Décider de la suite</button>}
            <button className="ui-button ui-button-ghost" onClick={() => { setIncident(pkg); setIncidentNotes(''); }}>Signaler un incident</button>
          </div>
        </div>;
      })}
    </div>}
    <Modal isOpen={!!target} onClose={() => setTarget(null)} preventClose={busy} title="Décision après retour" size="lg" mobileFullscreen>
      <div className="space-y-3">
        <p>{target && packageDisplayCode(target)} · {target?.contactName}</p>
        <label className="block">Suite à donner<select className="ui-input w-full" value={decision} onChange={e => { setDecision(e.target.value as typeof decision); setPhysical(false); }}><option value="REDELIVER">Autoriser une nouvelle livraison</option><option value="SENDER_RETURNED">Confirmer la remise définitive à l’expéditeur</option></select></label>
        {target?.status === PackageStatus.RETURNED && !target.returnDisposition && <>
          <p className="ui-notice ui-notice-warning">Ancien retour à qualifier. Contrôlez physiquement le carton avant de le rendre disponible.</p>
          <label className="block">Dépôt physique<select className="ui-input w-full" value={hubId} onChange={e => setHubId(e.target.value)}><option value="">Choisir</option>{hubs.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
          <button className="ui-button ui-button-secondary" onClick={() => setScanner(true)}>Scanner le carton</button>
          <label className="block">Code scanné ou saisi<input className="ui-input w-full" value={code} onChange={e => setCode(e.target.value)} /></label>
        </>}
        {decision === 'REDELIVER' && <label className="block">Jour souhaité<input className="ui-input w-full" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} /></label>}
        {decision === 'SENDER_RETURNED' && <label className="block">Photo de remise à l’expéditeur<input className="block max-w-full" type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file); }} /></label>}
        <label className="block">Motif / instructions<textarea className="ui-input w-full" value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {(decision === 'SENDER_RETURNED' || target?.status === PackageStatus.RETURNED) && <label className="flex gap-2"><input type="checkbox" checked={physical} onChange={e => setPhysical(e.target.checked)} />{decision === 'SENDER_RETURNED' ? 'Le colis a réellement été remis à l’expéditeur' : 'J’ai vérifié le carton présent au dépôt choisi'}</label>}
        {error && <p role="alert" className="text-red-800">{error}</p>}
        <button className="ui-button ui-button-primary" disabled={busy || !notes.trim() || (decision === 'SENDER_RETURNED' && (!photo || !physical)) || (target?.status === PackageStatus.RETURNED && (!code || !physical || !hubId))} onClick={() => void decide()}>{busy ? 'Enregistrement…' : 'Enregistrer la décision'}</button>
      </div>
    </Modal>
    {scanner && <BarcodeScanner onScan={value => { setCode(value); setScanner(false); }} onClose={() => setScanner(false)} title="Vérifier le carton retourné" />}
    <Modal isOpen={!!incident} onClose={() => setIncident(null)} preventClose={busy} title="Signaler un incident colis"><label className="block">Situation constatée<textarea className="ui-input w-full" value={incidentNotes} onChange={e => setIncidentNotes(e.target.value)} /></label><button disabled={busy || !incidentNotes.trim()} className="ui-button ui-button-primary mt-3" onClick={() => void reportIncident()}>Enregistrer pour le bureau</button></Modal>
    <Modal isOpen={!!recollect} onClose={() => setRecollect(null)} preventClose={busy} title="Replanifier l’enlèvement">
      <div className="space-y-3"><p>Le chauffeur reviendra au lieu d’enlèvement initial. Le colis restera « En attente » jusqu’à son scan.</p>
        <label className="block">Chauffeur<select className="ui-input w-full" value={driverId} onChange={e => setDriverId(e.target.value)}><option value="">Choisir</option>{drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName}</option>)}</select></label>
        <label className="block">Dépôt de rattachement<select className="ui-input w-full" value={hubId} onChange={e => setHubId(e.target.value)}><option value="">Choisir</option>{hubs.map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
        <label className="block">Date<input type="date" className="ui-input w-full" min={today} value={date} onChange={e => setDate(e.target.value)} /></label>
        {error && <p role="alert" className="text-red-800">{error}</p>}
        <button className="ui-button ui-button-primary" disabled={busy || !date || !driverId || !hubId} onClick={() => void replan()}>{busy ? 'Planification…' : 'Créer la nouvelle collecte'}</button>
      </div>
    </Modal>
  </section>;
}
