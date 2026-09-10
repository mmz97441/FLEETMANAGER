import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'ACTOR' } as { uid: string } | null }, addDoc: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ auth: mocks.auth, db: {} }));
vi.mock('firebase/firestore', () => ({ collection: (_: unknown, name: string) => name, addDoc: mocks.addDoc }));
import { recordClientIntervention } from './clientInterventionService';
import { User, UserRole } from '../types';

const actor = { id: 'ACTOR', firstName: 'Alex', lastName: 'Agent', role: UserRole.ADMIN } as User;
const client = { id: 'CLIENT', firstName: 'Camille', lastName: 'Client', companyName: 'Société fictive', role: UserRole.CLIENT } as User;
describe('intervention audit identity and availability', () => {
  beforeEach(() => { mocks.auth.currentUser = { uid: 'ACTOR' }; mocks.addDoc.mockReset().mockResolvedValue({ id: 'AUDIT' }); });
  afterEach(() => vi.useRealTimers());
  it('binds the audit author to Firebase auth and keeps the client a separate target', async () => {
    await recordClientIntervention(actor, client, 'SESSION', 'Ajouter un destinataire', 'requested');
    expect(mocks.addDoc).toHaveBeenCalledWith('activity_logs', expect.objectContaining({ userId: 'ACTOR', targetId: 'CLIENT', outcome: 'neutral', details: { metadata: { interventionSessionId: 'SESSION', actorId: 'ACTOR', clientId: 'CLIENT', action: 'Ajouter un destinataire', phase: 'requested' } } }));
  });
  it('rejects an expired session without attributing the client as the actor', async () => {
    mocks.auth.currentUser = { uid: 'OTHER' };
    await expect(recordClientIntervention(actor, client, 'SESSION', 'Créer', 'requested')).rejects.toThrow('identité');
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
  it('rejects missing authentication without sending an audit record', async () => {
    mocks.auth.currentUser = null;
    await expect(recordClientIntervention(actor, client, 'SESSION', 'Créer', 'requested')).rejects.toThrow('identité');
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
  it('propagates a refused intent so the caller can block the business operation', async () => {
    mocks.addDoc.mockRejectedValue(new Error('permission-denied'));
    await expect(recordClientIntervention(actor, client, 'SESSION', 'Créer', 'requested')).rejects.toThrow('permission-denied');
  });
  it('releases the interface when an offline audit remains pending', async () => {
    vi.useFakeTimers(); mocks.addDoc.mockReturnValue(new Promise(() => {}));
    const result = expect(recordClientIntervention(actor, client, 'SESSION', 'Créer', 'requested')).rejects.toThrow('ne répond pas');
    await vi.advanceTimersByTimeAsync(10_000); await result;
  });
});
