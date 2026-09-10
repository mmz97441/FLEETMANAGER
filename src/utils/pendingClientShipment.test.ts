import { describe, expect, it } from 'vitest';
import { clearPendingClientShipment, pendingShipmentKey, readPendingClientShipment, reservePendingClientShipment, type PendingShipmentRequest, type ShipmentJournalStorage } from './pendingClientShipment';
import { Zone } from '../types';
function memory(): ShipmentJournalStorage { const values = new Map<string, string>(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }; }
const request: PendingShipmentRequest = { requestId: '12345678-1234-1234-1234-123456789abc', client: { id: 'ux-client', companyName: 'UX' }, recipient: { contactName: 'Test', address: '12 rue test', postalCode: '97400', city: 'Saint-Denis' }, zone: Zone.NORD, packageCount: 2 };
describe('pending shipment journal', () => {
  it('restores the same payload and UUID after reload, retaining the original timestamp on retry', async () => {
    const storage = memory(); const saved = await reservePendingClientShipment(storage, 'ux-client', request);
    const reloaded = readPendingClientShipment(storage, 'ux-client');
    expect(reloaded).toEqual(saved);
    expect(await reservePendingClientShipment(storage, 'ux-client', reloaded!.request)).toEqual(saved);
  });
  it('rejects a conflicting tab without overwriting the pending request', async () => {
    const storage = memory(); await reservePendingClientShipment(storage, 'ux-client', request);
    await expect(reservePendingClientShipment(storage, 'ux-client', { ...request, requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })).rejects.toThrow('autre demande');
    expect(readPendingClientShipment(storage, 'ux-client')?.request).toEqual(request);
  });
  it('rejects edited data under the same request UUID', async () => {
    const storage = memory(); await reservePendingClientShipment(storage, 'ux-client', request);
    await expect(reservePendingClientShipment(storage, 'ux-client', { ...request, packageCount: 3 })).rejects.toThrow('contenu');
  });
  it('fails before a send can proceed if local persistence fails', async () => {
    const storage = memory(); storage.setItem = () => { throw new Error('QuotaExceededError'); };
    let sent = false;
    await expect((async () => { await reservePendingClientShipment(storage, 'ux-client', request); sent = true; })()).rejects.toThrow('QuotaExceededError');
    expect(sent).toBe(false);
  });
  it('clears only a matching confirmed request', async () => {
    const storage = memory(); await reservePendingClientShipment(storage, 'ux-client', request);
    expect(await clearPendingClientShipment(storage, 'ux-client', 'another-request')).toBe(false);
    expect(readPendingClientShipment(storage, 'ux-client')).not.toBeNull();
    expect(await clearPendingClientShipment(storage, 'ux-client', request.requestId)).toBe(true);
    expect(readPendingClientShipment(storage, 'ux-client')).toBeNull();
  });
  it('does not reserve a payload belonging to another account', async () => {
    const storage = memory();
    await expect(reservePendingClientShipment(storage, 'other-client', request)).rejects.toThrow('autre compte');
    expect(storage.getItem(pendingShipmentKey('other-client'))).toBeNull();
  });
  it('keeps requests isolated between accounts and refuses malformed records', async () => {
    const storage = memory(); await reservePendingClientShipment(storage, 'ux-client', request);
    expect(readPendingClientShipment(storage, 'other-client')).toBeNull();
    storage.setItem(pendingShipmentKey('other-client'), '{oops');
    expect(() => readPendingClientShipment(storage, 'other-client')).toThrow('illisible');
  });
});
