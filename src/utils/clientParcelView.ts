import { Package, PackageStatus } from '../types';
import { recipientKey } from './address';
import { logisticsDay } from '../services/logisticsMetrics';
import { packageStatusLabel } from './operationalLabels';

export type ClientParcelFilter = 'all' | 'attention' | 'pending' | 'transit' | 'delivered' | 'failed';
export type ClientParcelTone = 'success' | 'warning' | 'neutral' | 'info';
export const clientParcelTone: Record<ClientParcelTone, string> = {
  success: 'bg-green-100 text-green-800', warning: 'bg-amber-100 text-amber-950',
  neutral: 'bg-slate-100 text-slate-800', info: 'bg-blue-100 text-blue-900',
};
const transit = [PackageStatus.COLLECTED, PackageStatus.AT_HUB, PackageStatus.SORTED,
  PackageStatus.IN_TRANSIT, PackageStatus.LOADED, PackageStatus.IN_DELIVERY];
const failures = [PackageStatus.FAILED, PackageStatus.RETURN_REQUESTED, PackageStatus.RETURNED];

/** These are operational exceptions, independent of GPS and proof publication. */
export function clientParcelNeedsAttention(parcel: Package): boolean {
  if (parcel.status === PackageStatus.DELIVERED || parcel.returnDisposition === 'SENDER_RETURNED') return false;
  return Boolean(parcel.pickupMissing || parcel.returnDisposition === 'AWAITING_DECISION'
    || (parcel.returnDisposition === 'REDELIVERY_READY' && !parcel.missionId)
    || failures.includes(parcel.status)
    || !parcel.contactName?.trim() || !parcel.address?.trim() || !parcel.city?.trim() || !parcel.postalCode?.trim());
}

export function clientParcelStatus(parcel: Package): { label: string; detail: string; tone: ClientParcelTone } {
  if (parcel.returnDisposition === 'SENDER_RETURNED') return { label: 'Remis à l’expéditeur', detail: 'Le retour a été remis à l’expéditeur.', tone: 'neutral' };
  if (parcel.pickupMissing) return { label: parcel.missionId ? 'Collecte replanifiée — colis à présenter' : 'Absent à l’enlèvement', detail: 'Le colis n’a pas été remis lors de la collecte. Indiquez à l’exploitation quand il sera disponible.', tone: 'warning' };
  if (parcel.returnDisposition === 'AWAITING_DECISION') return { label: 'Retour au dépôt — décision attendue', detail: 'Le colis est au dépôt. Une relivraison ou un retour expéditeur doit être décidé.', tone: 'warning' };
  if (parcel.returnDisposition === 'REDELIVERY_READY' && !parcel.missionId) return { label: 'Relivraison à planifier', detail: 'La relivraison est autorisée ; son affectation à une tournée est attendue.', tone: 'warning' };
  if (parcel.status === PackageStatus.RETURNED) return { label: 'Retour à vérifier', detail: 'Cet ancien retour nécessite une vérification par l’exploitation.', tone: 'warning' };
  if (parcel.status === PackageStatus.RETURN_REQUESTED) return { label: 'Retour vers le dépôt', detail: 'Le retour physique au dépôt reste à confirmer.', tone: 'warning' };
  if (parcel.status === PackageStatus.FAILED) return { label: 'Livraison en difficulté', detail: parcel.failureReason || 'Consultez la tentative et contactez l’exploitation pour la suite.', tone: 'warning' };
  if (parcel.status === PackageStatus.DELIVERED) return { label: 'Livré', detail: 'Livraison enregistrée. Consultez le suivi pour connaître la disponibilité de la preuve.', tone: 'success' };
  if (clientParcelNeedsAttention(parcel)) return { label: 'Adresse à compléter', detail: 'Le destinataire, la rue, le code postal et la ville doivent être complets avant la planification.', tone: 'warning' };
  return { label: packageStatusLabel(parcel.status), detail: parcel.status === PackageStatus.PENDING ? 'Colis enregistré, en attente de collecte.' : 'Le colis poursuit son acheminement.', tone: transit.includes(parcel.status) ? 'info' : 'neutral' };
}

const normalizeSearch = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').trim();
export function matchesClientParcel(parcel: Package, filter: ClientParcelFilter, search = ''): boolean {
  if (filter === 'attention' && !clientParcelNeedsAttention(parcel)) return false;
  if (filter === 'pending' && parcel.status !== PackageStatus.PENDING) return false;
  if (filter === 'transit' && !transit.includes(parcel.status)) return false;
  if (filter === 'delivered' && parcel.status !== PackageStatus.DELIVERED) return false;
  if (filter === 'failed' && !failures.includes(parcel.status) && !parcel.returnDisposition) return false;
  const term = normalizeSearch(search);
  return !term || [parcel.externalId, parcel.barcode, parcel.carrierBarcode, parcel.orderNumber, parcel.clientReference,
    parcel.contactName, parcel.address, parcel.city, parcel.postalCode].some(value => normalizeSearch(value).includes(term));
}

export interface ClientParcelGroup { id: string; day: string; packages: Package[]; matches: number }
/** A detail never hides sibling cartons. A search selects recipient/day groups,
 * whose complete contents remain visible and whose totals remain meaningful. */
export function clientParcelGroups(parcels: Package[], filter: ClientParcelFilter, search = '', expandedId = ''): ClientParcelGroup[] {
  const groups = new Map<string, ClientParcelGroup>();
  const sorted = [...parcels].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
  for (const parcel of sorted) {
    const day = logisticsDay(parcel.createdAt || '');
    // Incomplete historical identities stay separate until a verified correction.
    const complete = parcel.contactName?.trim() && parcel.address?.trim() && parcel.city?.trim() && parcel.postalCode?.trim();
    const id = `${day}|${complete ? recipientKey(parcel) : `parcel:${parcel.id}`}`;
    const group = groups.get(id) || { id, day, packages: [], matches: 0 };
    group.packages.push(parcel);
    if (matchesClientParcel(parcel, filter, search)) group.matches++;
    groups.set(id, group);
  }
  return [...groups.values()].filter(group => group.matches > 0 || group.packages.some(parcel => parcel.id === expandedId));
}

export function clientGroupSummary(parcels: Package[]): { label: string; detail: string; tone: ClientParcelTone } {
  if (parcels.length === 1) return clientParcelStatus(parcels[0]);
  const delivered = parcels.filter(parcel => parcel.status === PackageStatus.DELIVERED).length;
  const returned = parcels.filter(parcel => parcel.returnDisposition === 'SENDER_RETURNED').length;
  const attention = parcels.filter(clientParcelNeedsAttention).length;
  const remaining = parcels.length - delivered - returned - attention;
  const label = [delivered && `${delivered} livrés`, attention && `${attention} à traiter`, remaining && `${remaining} en cours`, returned && `${returned} remis à l’expéditeur`].filter(Boolean).join(' · ');
  return { label: delivered === parcels.length ? 'Tous livrés' : label || 'Aucun colis',
    detail: `${delivered} colis livré${delivered > 1 ? 's' : ''} sur ${parcels.length}.`,
    tone: attention ? 'warning' : delivered === parcels.length && parcels.length > 0 ? 'success' : remaining ? 'info' : 'neutral' };
}

export function clientShipmentDayLabel(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00+04:00`).toLocaleDateString('fr-FR', {
    timeZone: 'Indian/Reunion', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }) : 'Date d’envoi non renseignée';
}
