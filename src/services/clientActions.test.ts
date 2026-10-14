import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ updateDoc: vi.fn(), call: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {}, storage: {} }));
vi.mock('firebase/firestore', async original => ({ ...await original<any>(), doc: (_: unknown, collection: string, id: string) => `${collection}/${id}`, updateDoc: mock.updateDoc }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: (_: unknown, name: string) => (data: unknown) => mock.call(name, data) }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
vi.mock('./teamDirectoryService', () => ({ subscribeToTeamDirectory: vi.fn() }));
import { addSavedAddress, updateSavedAddress, updateUserProfile } from './firestore';
import { SavedAddress, User } from '../types';

const address = { companyName: 'Demo', createdBy: 'client', label: 'Pharmacie', type: 'delivery', address: '1 rue Test', city: '97400 Saint-Denis', contactName: 'Pharmacie', contactPhone: '0692000000', createdAt: '', updatedAt: '' } as Omit<SavedAddress, 'id'>;
describe('client mutation persistence boundaries', () => {
  beforeEach(() => { mock.updateDoc.mockReset(); mock.call.mockReset().mockResolvedValue({ data: { id: 'recipient', outcome: 'created' } }); });
  it('propagates denied profile writes so company/team success cannot be fabricated', async () => {
    const error = new Error('permission-denied'); mock.updateDoc.mockRejectedValue(error);
    await expect(updateUserProfile({ id: 'client', firstName: 'Nom' } as User)).rejects.toBe(error);
  });
  it.each([[undefined, undefined], ['email@example.invalid', undefined], [undefined, 'Code portail'], ['email@example.invalid', 'Code portail']])('cleans every optional-field combination before sending to the address transaction', async (contactEmail, notes) => {
    expect(await addSavedAddress({ ...address, contactEmail, notes })).toBe('recipient');
    const payload = mock.call.mock.calls[0][1].address;
    expect(Object.values(payload)).not.toContain(undefined);
    expect(mock.call.mock.calls[0][0]).toBe('saveClientAddress');
  });
  it('sends explicit optional-field erasure and excludes stale ownership/favorites/counters', async () => {
    await updateSavedAddress({ ...address, id: 'recipient', contactEmail: undefined, notes: undefined, usageCount: 9, isFavorite: false });
    expect(mock.call).toHaveBeenCalledWith('updateClientAddress', { id: 'recipient', fields: { address: '1 rue Test', city: '97400 Saint-Denis', contactName: 'Pharmacie', contactPhone: '0692000000', contactEmail: '', notes: '' } });
  });
});
