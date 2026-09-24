import { expect, it, vi } from 'vitest';
import type { User } from '../types';
import { createProfileSession, profileIssueKind } from './profileSession';

const profile = { id: 'driver', role: 'Chauffeur' } as User;
const identity = (uid = 'driver', authTime = 200) => ({ uid, email: `${uid}@example.invalid`, getIdTokenResult: async () => ({ claims: { auth_time: authTime } }) });
function setup() {
  const deps = { read: vi.fn(async (_uid: string): Promise<User | null> => profile), recover: vi.fn(async () => {}), subscribe: vi.fn((_uid: string, _next: (u: User | null) => void, _error: (e: unknown) => void) => vi.fn()), loading: vi.fn(), profile: vi.fn(), issue: vi.fn(), authorized: vi.fn(), report: vi.fn() };
  return { deps, session: createProfileSession(deps) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }

it('keeps a read failure separate from a missing account and allows retry', async () => {
  const { deps, session } = setup(); deps.read.mockRejectedValueOnce({ code: 'unavailable' });
  await session.start(identity());
  expect(deps.recover).not.toHaveBeenCalled(); expect(deps.authorized).not.toHaveBeenCalled();
  expect(deps.issue).toHaveBeenLastCalledWith({ kind: 'unavailable', email: 'driver@example.invalid' });
  await session.retry(); expect(deps.profile).toHaveBeenLastCalledWith(profile); expect(deps.loading).toHaveBeenLastCalledWith(false);
});
it('recovers only an authoritative missing profile and rereads it', async () => {
  const { deps, session } = setup(); deps.read.mockResolvedValueOnce(null);
  await session.start(identity()); expect(deps.recover).toHaveBeenCalledWith('driver'); expect(deps.authorized).toHaveBeenCalledWith(profile);
});
it('does not grant access when recovery fails or the profile remains absent', async () => {
  for (const code of ['functions/permission-denied', 'functions/unavailable', null]) {
    const { deps, session } = setup(); deps.read.mockResolvedValue(null);
    if (code) deps.recover.mockRejectedValue({ code });
    await session.start(identity()); expect(deps.authorized).not.toHaveBeenCalled();
    expect(deps.issue.mock.lastCall?.[0].kind).toBe(code === 'functions/unavailable' ? 'unavailable' : 'missing');
  }
});
it('uses the session auth_time cutoff, including its exact second and missing claims', () => {
  const revoked = { ...profile, sessionsRevokedAt: 200 };
  expect(profileIssueKind(revoked, 200)).toBe('revoked'); expect(profileIssueKind(revoked, NaN)).toBe('revoked');
  expect(profileIssueKind(revoked, 201)).toBeNull(); expect(profileIssueKind({ ...revoked, isDisabled: true }, 201)).toBe('disabled');
});
it('ignores late reads after logout, account change or disposal', async () => {
  for (const action of ['logout', 'switch', 'dispose']) {
    const { deps, session } = setup(), pending = deferred<User | null>(); deps.read.mockReturnValueOnce(pending.promise);
    const first = session.start(identity()); await Promise.resolve();
    if (action === 'logout') await session.start(null);
    if (action === 'switch') await session.start(identity('second'));
    if (action === 'dispose') session.dispose();
    const calls = deps.profile.mock.calls.length;
    pending.resolve(profile); await first; expect(deps.profile).toHaveBeenCalledTimes(calls);
    expect(deps.authorized.mock.calls.map(([u]) => u.id)).toEqual(action === 'switch' ? ['second'] : []);
  }
});
it('ignores late recovery and old listeners after account change', async () => {
  const { deps, session } = setup(), pending = deferred<void>(); deps.read.mockResolvedValueOnce(null); deps.recover.mockReturnValueOnce(pending.promise);
  const first = session.start(identity()); await Promise.resolve(); await Promise.resolve();
  await session.start(identity('second')); const next = deps.subscribe.mock.calls[0][1];
  pending.resolve(); await first; expect(deps.read).toHaveBeenCalledTimes(2);
  await session.start(null); next({ ...profile, isDisabled: true }); expect(deps.issue).toHaveBeenLastCalledWith(null);
});
it('applies live revocation without confusing a listener network failure with deletion', async () => {
  const { deps, session } = setup(); await session.start(identity());
  const [, next, fail] = deps.subscribe.mock.calls[0]; fail({ code: 'unavailable' });
  expect(deps.profile).toHaveBeenLastCalledWith(profile); expect(deps.issue).toHaveBeenLastCalledWith(null);
  next({ ...profile, sessionsRevokedAt: 200 }); expect(deps.profile).toHaveBeenLastCalledWith(null); expect(deps.issue.mock.lastCall?.[0].kind).toBe('revoked');
});
