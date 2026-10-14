export const CLIENT_REQUEST_LABELS = {
  MISSING: 'Signaler un colis manquant',
  ADDRESS: 'Demander une correction d’adresse',
  REDELIVERY: 'Demander une nouvelle livraison',
  CANCELLATION: 'Demander une annulation',
} as const;
export type ClientRequestKind = keyof typeof CLIENT_REQUEST_LABELS;
export type ClientRequestStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
export const CLIENT_REQUEST_STATUS_LABELS: Record<ClientRequestStatus, string> = {
  OPEN: 'Demande reçue', IN_PROGRESS: 'Prise en charge', RESOLVED: 'Réponse apportée', REJECTED: 'Demande refusée',
};
export function allowedClientRequestKinds(parcel: { status?: string; returnDisposition?: string }): ClientRequestKind[] {
  const choices: ClientRequestKind[] = ['MISSING'];
  if (!['Livré', 'Retourné'].includes(parcel.status || '') && parcel.returnDisposition !== 'SENDER_RETURNED') choices.push('ADDRESS', 'CANCELLATION');
  if (parcel.returnDisposition !== 'SENDER_RETURNED' && !['Livré', 'Retourné'].includes(parcel.status || '') &&
    (['Échec', 'À retourner'].includes(parcel.status || '') || ['AWAITING_DECISION', 'REDELIVERY_READY'].includes(parcel.returnDisposition || ''))) choices.push('REDELIVERY');
  return choices;
}
export interface RequestedAddress { contactName: string; address: string; postalCode: string; city: string; contactPhone: string }
export interface ClientRequest {
  id: string; reference: string; clientId: string; companyName: string; actorId: string;
  packageId: string; packageReference: string; packageStatus: string; recipientName: string;
  kind: ClientRequestKind; message: string; requestedAddress?: RequestedAddress | null; requestedDate?: string | null;
  status: ClientRequestStatus; response: string; version: number; createdAt: string; updatedAt: string;
  history: { status: ClientRequestStatus; timestamp: string; actorName: string; response: string }[];
}
