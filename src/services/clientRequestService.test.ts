import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: { currentUser: { uid: 'actor-a' } as { uid: string } | null }, call: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {}, auth: mock.auth }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => mock.call }));
import { allowedClientRequestKinds, readClientRequestDraft, reserveClientRequestDraft, submitClientRequest, ClientRequestDraft } from './clientRequestService';

const draft: ClientRequestDraft = { requestId: 'same-intent', clientId: 'client-a', packageId: 'package-a', kind: 'MISSING', message: 'Ce colis est introuvable.' };
describe('durable and scoped client requests', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) || null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
    mock.auth.currentUser = { uid: 'actor-a' }; mock.call.mockReset().mockResolvedValue({ data: { id: 'receipt', reference: 'DC-ABC' } });
  });
  it('keeps the same intent after an uncertain network result and clears only after receipt', async () => {
    mock.call.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
    await expect(submitClientRequest(draft)).rejects.toThrow('offline');
    expect(readClientRequestDraft('client-a', 'package-a')).toEqual(draft);
    await submitClientRequest(readClientRequestDraft('client-a', 'package-a')!);
    expect(mock.call.mock.calls[0][0]).toEqual(mock.call.mock.calls[1][0]);
    expect(readClientRequestDraft('client-a', 'package-a')).toBeNull();
  });
  it('isolates the actor and the previewed client when restoring a pending intent', () => {
    reserveClientRequestDraft(draft);
    expect(readClientRequestDraft('client-b', 'package-a')).toBeNull();
    mock.auth.currentUser = { uid: 'actor-b' };
    expect(readClientRequestDraft('client-a', 'package-a')).toBeNull();
  });
  it('never sends a different intent over an unresolved one', async () => {
    reserveClientRequestDraft(draft);
    await expect(submitClientRequest({ ...draft, message: 'Une autre demande différente.' })).rejects.toThrow('précédente');
    expect(mock.call).not.toHaveBeenCalled();
  });
  it('unlocks rejected inputs but retains the intent after the actor changes during dispatch', async () => {
    mock.call.mockRejectedValueOnce(Object.assign(new Error('invalid'), { code: 'functions/invalid-argument' }));
    await expect(submitClientRequest(draft)).rejects.toThrow('invalid'); expect(readClientRequestDraft('client-a', 'package-a')).toBeNull();
    mock.call.mockImplementationOnce(async () => { mock.auth.currentUser = { uid: 'actor-b' }; return { data: { id: 'r', reference: 'DC' } }; });
    await expect(submitClientRequest(draft)).rejects.toThrow('session');
    mock.auth.currentUser = { uid: 'actor-a' }; expect(readClientRequestDraft('client-a', 'package-a')).toEqual(draft);
  });
  it('allows a dispute but no logistical reopening of a delivered or definitively returned parcel', () => {
    expect(allowedClientRequestKinds({ status: 'Livré' })).toEqual(['MISSING']);
    expect(allowedClientRequestKinds({ status: 'Retourné', returnDisposition: 'SENDER_RETURNED' })).toEqual(['MISSING']);
    expect(allowedClientRequestKinds({ status: 'Au hub', returnDisposition: 'AWAITING_DECISION' })).toContain('REDELIVERY');
  });
});
