import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getDocs } = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock('../firebaseConfig', () => ({ default: {}, db: {} }));
vi.mock('./scanService', () => ({ scanPackage: vi.fn() }));
vi.mock('./gmproService', () => ({ geocodeAddress: vi.fn(), getGoogleMapsApiKey: vi.fn() }));
vi.mock('./logService', () => ({ reportError: vi.fn() }));
vi.mock('firebase/firestore', async () => ({
  ...await vi.importActual('firebase/firestore'), getDocs,
  collection: vi.fn(), where: (field: string, op: string, value: string) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }), query: (...parts: unknown[]) => parts,
}));
import { findPackageByCode, findDispatchedPackageByCode } from './missionService';
const snapshot = (packages: Record<string, unknown>[]) => ({ empty: packages.length === 0, size: packages.length,
  docs: packages.map((pkg, index) => ({ id: `parcel-${index}`, data: () => pkg })) });
beforeEach(() => { getDocs.mockReset(); });
describe.each([findPackageByCode, findDispatchedPackageByCode])('parcel lookup %s', lookup => {
  it('recognizes the numeric order without offering a random carton', async () => {
    getDocs.mockImplementation(async (parts: { field?: string; value?: string }[]) => snapshot(
      parts.some(p => p?.field === 'clientReference' && p.value === '12345678') ? [{ externalId: 'BR9010' }] : []));
    await expect(lookup('0012345678300123450101')).rejects.toThrow('Commande 12345678 retrouvée');
    await expect(lookup('0012345678300123450101')).rejects.toMatchObject({ name: 'ScanIdentificationError' });
  });
  it('refuses ambiguous shared references rather than selecting the newest or active carton', async () => {
    getDocs.mockResolvedValue(snapshot([{ externalId: 'BR9010', status: 'Livré' }, { externalId: 'BR9011', missionId: 'active' }]));
    await expect(lookup('shared')).rejects.toThrow('plusieurs colis');
  });
  it('returns an exact individual label before an order fallback', async () => {
    getDocs.mockResolvedValue(snapshot([{ externalId: 'BR9010' }]));
    await expect(lookup('BR9010')).resolves.toMatchObject({ externalId: 'BR9010' });
    expect(getDocs).toHaveBeenCalledTimes(1);
  });
  it('does not invent a parcel for an unknown label', async () => {
    getDocs.mockResolvedValue(snapshot([]));
    await expect(lookup('0012345678300123450101')).resolves.toBeNull();
  });
});
