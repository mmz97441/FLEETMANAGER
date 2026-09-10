import { describe, expect, it } from 'vitest';
import { createStopForm, stopFormPayload, validateStopForm } from './missionStopForm';
import { clearPendingManualStop, pendingManualStopKey, readPendingManualStop, reservePendingManualStop, PendingManualStop } from './pendingManualStop';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; };
const request: PendingManualStop = { missionId: 'M1', date: '2026-09-10', requestId: 'request-abcdefgh', form: { ...createStopForm(), contactName: 'Test', address: '12 rue Test', postalCode: '97400', city: 'Saint-Denis' } };
describe('manual stop recovery journal', () => {
  it('preserves a driver request without a postal code even though new office entries require one', async () => {
    const storage = memory();
    const driverRequest = { ...request, form: { ...request.form, postalCode: '' } };
    expect(validateStopForm(driverRequest.form).postalCode).toBeTruthy();
    await reservePendingManualStop(storage, 'office', driverRequest);
    const reloaded = readPendingManualStop(storage, 'office')!;
    expect(await reservePendingManualStop(storage, 'office', reloaded)).toEqual(driverRequest);
    expect(stopFormPayload(reloaded.form)).toEqual(stopFormPayload(driverRequest.form));
    expect(stopFormPayload(reloaded.form).postalCode).toBe('');
  });
  it('restores exactly the same identity and fields after reload', async () => {
    const storage = memory(); await reservePendingManualStop(storage, 'office', request);
    expect(readPendingManualStop(storage, 'office')).toEqual(request);
    expect(await reservePendingManualStop(storage, 'office', readPendingManualStop(storage, 'office')!)).toEqual(request);
  });
  it('refuses a competing tab without overwriting the pending stop', async () => {
    const storage = memory(); await reservePendingManualStop(storage, 'office', request);
    await expect(reservePendingManualStop(storage, 'office', { ...request, requestId: 'request-other' })).rejects.toThrow('autre demande');
    expect(readPendingManualStop(storage, 'office')).toEqual(request);
  });
  it('rejects changed fields under the same request ID', async () => {
    const storage = memory(); await reservePendingManualStop(storage, 'office', request);
    await expect(reservePendingManualStop(storage, 'office', { ...request, form: { ...request.form, address: 'Autre adresse' } })).rejects.toThrow('contenu');
  });
  it('clears only the request that was confirmed, leaving another tab intact', async () => {
    const storage = memory(); await reservePendingManualStop(storage, 'office', request);
    expect(await clearPendingManualStop(storage, 'office', 'wrong-request')).toBe(false);
    expect(readPendingManualStop(storage, 'office')).toEqual(request);
    expect(await clearPendingManualStop(storage, 'office', request.requestId)).toBe(true);
    expect(readPendingManualStop(storage, 'office')).toBeNull();
  });
  it('stops before a service call if storage fails or the write cannot be read back', async () => {
    const storage = memory(); storage.setItem = () => {}; let called = false;
    await expect((async () => { await reservePendingManualStop(storage, 'office', request); called = true; })()).rejects.toThrow('conservée');
    expect(called).toBe(false);
  });
  it('isolates accounts and keeps malformed records for investigation', async () => {
    const storage = memory(); await reservePendingManualStop(storage, 'office', request);
    expect(readPendingManualStop(storage, 'other')).toBeNull();
    storage.setItem(pendingManualStopKey('other'), '{broken');
    expect(() => readPendingManualStop(storage, 'other')).toThrow('illisible');
    await expect(reservePendingManualStop(storage, 'other', request)).rejects.toThrow('illisible');
    expect(storage.getItem(pendingManualStopKey('other'))).toBe('{broken');
  });
});
