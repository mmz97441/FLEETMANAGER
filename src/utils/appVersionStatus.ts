import type { User } from '../types';

export const RECENT_APP_SIGNAL_MS = 24 * 60 * 60 * 1000;
export type AppVersionState = 'current' | 'required' | 'unknown';
export type AppSignalAge = 'recent' | 'old' | 'unknown';
export type UserAppVersionState = AppVersionState | 'stale';
export interface AppVersionTarget { latestVersion: string | null; latestBuildId: string | null }
export interface AppDeviceSignal { id: string; label: string; appVersion?: string; buildId?: string; lastSeenAt?: string }
export type AppVersionUser = Pick<User, 'appVersion' | 'appBuildId' | 'lastSeenAt'> & { appDevices?: AppDeviceSignal[] };
const validVersion = (value: unknown): value is string => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
const validBuild = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value);

/** The published deployment is authoritative, including an intentional rollback.
 * Equal version names alone cannot prove that two builds are the same. */
export function reportedAppVersion(signal: Pick<AppDeviceSignal, 'appVersion' | 'buildId'>, target: AppVersionTarget): AppVersionState {
  if (!validVersion(target.latestVersion) || !validBuild(target.latestBuildId) || !validVersion(signal.appVersion)) return 'unknown';
  if (!validBuild(signal.buildId)) return signal.appVersion === target.latestVersion ? 'unknown' : 'required';
  if (signal.buildId !== target.latestBuildId) return 'required';
  return signal.appVersion === target.latestVersion ? 'current' : 'unknown';
}

export function appSignalAge(lastSeenAt: string | undefined, now = Date.now()): AppSignalAge {
  const timestamp = Date.parse(lastSeenAt || '');
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000) return 'unknown';
  return now - timestamp <= RECENT_APP_SIGNAL_MS ? 'recent' : 'old';
}

export function userAppVersionStatus(user: AppVersionUser, target: AppVersionTarget, now = Date.now()) {
  const devices = (Array.isArray(user.appDevices) ? user.appDevices : []).filter(device => device && typeof device.id === 'string')
    .map(device => ({ ...device, state: reportedAppVersion(device, target), age: appSignalAge(device.lastSeenAt, now) }))
    .sort((a, b) => (Date.parse(b.lastSeenAt || '') || 0) - (Date.parse(a.lastSeenAt || '') || 0));
  // Older clients can still publish only an account-level signal. Never assign
  // that version to all known devices, or discard it when it is newer than them.
  const newestDeviceTime = Math.max(0, ...devices.map(device => Date.parse(device.lastSeenAt || '') || 0));
  const legacy = !devices.length || Date.parse(user.lastSeenAt || '') > newestDeviceTime
    ? { appVersion: user.appVersion, buildId: user.appBuildId, lastSeenAt: user.lastSeenAt,
      state: reportedAppVersion({ appVersion: user.appVersion, buildId: user.appBuildId }, target), age: appSignalAge(user.lastSeenAt, now) }
    : null;
  const signals = [...devices, ...(legacy ? [legacy] : [])];
  let state: UserAppVersionState;
  if (signals.some(signal => signal.age === 'recent' && signal.state === 'required')) state = 'required';
  else if (!validVersion(target.latestVersion) || !validBuild(target.latestBuildId) ||
    signals.some(signal => signal.age === 'unknown' || signal.state === 'unknown')) state = 'unknown';
  else if (signals.some(signal => signal.age === 'old')) state = 'stale';
  else state = legacy || !devices.length ? 'unknown' : 'current';
  return { state, devices, legacy };
}
