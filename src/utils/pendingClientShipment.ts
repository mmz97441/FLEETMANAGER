import type { createClientShipment } from '../services/missionService';

export type PendingShipmentRequest = Parameters<typeof createClientShipment>[0] & { requestId: string };
export interface PendingClientShipment { version: 1; createdAt: string; request: PendingShipmentRequest }
export type ShipmentJournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const pendingShipmentKey = (userId: string) => `fleet-client-shipment-pending:v1:${encodeURIComponent(userId)}`;

export function readPendingClientShipment(storage: ShipmentJournalStorage, userId: string): PendingClientShipment | null {
  const raw = storage.getItem(pendingShipmentKey(userId));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as PendingClientShipment;
    const request = saved.request;
    if (saved.version !== 1 || request?.client?.id !== userId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.requestId) || !Number.isInteger(request.packageCount) || request.packageCount < 1 || request.packageCount > 50 || !request.recipient || !['contactName', 'address', 'city', 'postalCode'].every(key => typeof request.recipient[key as keyof typeof request.recipient] === 'string')) {
      throw new Error('invalid journal');
    }
    return saved;
  } catch {
    throw new Error('La demande locale en attente est illisible. Vérifiez Mes colis et contactez votre responsable avant de créer un nouvel envoi.');
  }
}

async function withJournalLock<T>(userId: string, operation: () => T): Promise<T> {
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(pendingShipmentKey(userId), async () => operation());
  }
  // The read/check/write sequence is synchronous; supported browsers additionally serialize tabs with Web Locks.
  return operation();
}

/** Reserve before sending anything. Never overwrite another outstanding request. */
export async function reservePendingClientShipment(storage: ShipmentJournalStorage, userId: string, request: PendingShipmentRequest): Promise<PendingClientShipment> {
  return withJournalLock(userId, () => {
    if (request.client.id !== userId) throw new Error('Cette demande appartient à un autre compte. Fermez puis rouvrez le formulaire.');
    const existing = readPendingClientShipment(storage, userId);
    if (existing && existing.request.requestId !== request.requestId) {
      throw new Error('Une autre demande non confirmée est déjà conservée sur cet appareil. Fermez puis rouvrez le formulaire pour reprendre cette demande avant d’en créer une autre.');
    }
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) {
      throw new Error('Le contenu de la demande en attente a changé. Fermez puis rouvrez le formulaire pour reprendre les informations enregistrées.');
    }
    const record: PendingClientShipment = existing || { version: 1, createdAt: new Date().toISOString(), request };
    storage.setItem(pendingShipmentKey(userId), JSON.stringify(record));
    if (storage.getItem(pendingShipmentKey(userId)) !== JSON.stringify(record)) throw new Error('La demande n’a pas pu être conservée sur cet appareil. Aucun envoi supplémentaire n’a été lancé.');
    return record;
  });
}

/** Confirmation or explicit abandonment may clear only the request the user actually reviewed. */
export async function clearPendingClientShipment(storage: ShipmentJournalStorage, userId: string, requestId: string): Promise<boolean> {
  return withJournalLock(userId, () => {
    const current = readPendingClientShipment(storage, userId);
    if (!current) return true;
    if (current.request.requestId !== requestId) return false;
    storage.removeItem(pendingShipmentKey(userId));
    return true;
  });
}
