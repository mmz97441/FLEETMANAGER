import type { User } from '../types';

export type ProfileIssueKind = 'unavailable' | 'missing' | 'disabled' | 'revoked';
export type ProfileIssue = { kind: ProfileIssueKind; email: string };
export interface ProfileIdentity {
  uid: string;
  email: string | null;
  getIdTokenResult(): Promise<{ claims: { auth_time?: unknown } }>;
  toJSON?: () => object;
}
interface Dependencies {
  read: (uid: string) => Promise<User | null>;
  recover: (uid: string) => Promise<void>;
  subscribe: (uid: string, next: (profile: User | null) => void, error: (error: unknown) => void) => () => void;
  loading: (value: boolean) => void;
  profile: (value: User | null) => void;
  issue: (value: ProfileIssue | null) => void;
  authorized: (profile: User) => void;
  report: (stage: string, error: unknown, uid: string) => void;
}

export function profileIssueKind(profile: User | null, authTime: number): ProfileIssueKind | null {
  if (!profile) return 'missing';
  if (profile.isDisabled) return 'disabled';
  if (profile.sessionsRevokedAt && (!Number.isFinite(authTime) || authTime <= profile.sessionsRevokedAt)) return 'revoked';
  return null;
}

// Firebase's persisted token belongs to this local session, unlike the account's
// global lastSignInTime. Reading its auth_time does not force a network refresh
// when reopening an already authenticated app offline. Server operations still
// require a valid Firebase token and enforce revocation independently.
async function sessionAuthTime(identity: ProfileIdentity): Promise<number> {
  try {
    const stored = identity.toJSON?.() as { stsTokenManager?: { accessToken?: string } } | undefined;
    const payload = stored?.stsTokenManager?.accessToken?.split('.')[1];
    if (payload) {
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
      if (claims.sub === identity.uid && typeof claims.auth_time === 'number' && Number.isFinite(claims.auth_time) && claims.auth_time > 0)
        return claims.auth_time;
    }
  } catch { /* Invalid/missing persisted data must use Firebase's validated result. */ }
  return Number((await identity.getIdTokenResult()).claims.auth_time);
}

/** A late request from a previous identity must never open or close another session. */
export function createProfileSession(deps: Dependencies) {
  let alive = true, generation = 0;
  let identity: ProfileIdentity | null = null;
  let unsubscribe: (() => void) | undefined;
  let lastIssue: ProfileIssueKind | null = null;
  const start = async (next: ProfileIdentity | null) => {
    if (!alive) return;
    identity = next;
    const attempt = ++generation;
    const current = () => alive && generation === attempt;
    unsubscribe?.(); unsubscribe = undefined;
    lastIssue = null; deps.issue(null); deps.profile(null);
    deps.loading(!!next);
    if (!next) return;
    const deny = (kind: ProfileIssueKind) => {
      if (!current()) return;
      lastIssue = kind;
      deps.profile(null); deps.issue({ kind, email: next.email || '' });
    };
    try {
      // Match Firestore/Functions auth_time, not the account's global last-login metadata.
      const authTime = await sessionAuthTime(next);
      if (!current()) return;
      let profile = await deps.read(next.uid);
      if (!current()) return;
      if (!profile) {
        try {
          await deps.recover(next.uid);
        } catch (error) {
          if (!current()) return;
          deps.report('auth.profile.recovery', error, next.uid);
          const code = String((error as { code?: string })?.code || '');
          deny(['functions/permission-denied', 'functions/failed-precondition', 'functions/not-found'].includes(code) ? 'missing' : 'unavailable');
          return;
        }
        if (!current()) return;
        profile = await deps.read(next.uid);
        if (!current()) return;
      }
      const blocked = profileIssueKind(profile, authTime);
      if (blocked) { deny(blocked); return; }
      // The document key remains authoritative even for old imported profile data.
      deps.profile({ ...profile!, id: next.uid });
      deps.authorized({ ...profile!, id: next.uid });
      unsubscribe = deps.subscribe(next.uid, updated => {
        if (!current()) return;
        const blocked = profileIssueKind(updated, authTime);
        if (blocked) { deny(blocked); return; }
        lastIssue = null; deps.issue(null);
        deps.profile({ ...updated!, id: next.uid });
      }, error => {
        if (current()) deps.report('auth.profile.watch', error, next.uid);
      });
    } catch (error) {
      if (!current()) return;
      deps.report('auth.profile.load', error, next.uid);
      const code = String((error as { code?: string })?.code || '');
      deny(code === 'auth/user-disabled' ? 'disabled' :
        ['auth/user-token-expired', 'auth/invalid-user-token', 'functions/unauthenticated'].includes(code) ? 'revoked' : 'unavailable');
    } finally {
      if (current()) deps.loading(false);
    }
  };
  return {
    start,
    retry: () => start(identity),
    retryUnavailable: () => { if (lastIssue === 'unavailable') void start(identity); },
    dispose: () => { alive = false; generation++; unsubscribe?.(); },
  };
}
