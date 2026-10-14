import { describe, expect, it } from 'vitest';
import { appSignalAge, reportedAppVersion, userAppVersionStatus, type AppDeviceSignal } from './appVersionStatus';

const now = Date.parse('2026-10-14T12:00:00Z');
const latest = { latestVersion: '4.37.0', latestBuildId: '99999999999999999999' };
const recent = '2026-10-14T11:59:00Z', old = '2026-10-12T12:00:00Z';
const device = (patch: Partial<AppDeviceSignal> = {}): AppDeviceSignal => ({
  id: 'one', label: 'Android', appVersion: latest.latestVersion, buildId: latest.latestBuildId, lastSeenAt: recent, ...patch,
});

describe('published deployment comparison', () => {
  it('requires the exact published version and build, without lossy numeric build comparison', () => {
    expect(reportedAppVersion(device(), latest)).toBe('current');
    expect(reportedAppVersion(device({ buildId: '99999999999999999998' }), latest)).toBe('required');
  });
  it('uses the published target even when that target is an intentional rollback', () => {
    expect(reportedAppVersion(device({ appVersion: '5.0.0', buildId: '10000000000000000000' }), latest)).toBe('required');
  });
  it('never treats absent, inconsistent or incomplete version data as current', () => {
    expect(reportedAppVersion(device({ appVersion: undefined }), latest)).toBe('unknown');
    expect(reportedAppVersion(device({ buildId: undefined }), latest)).toBe('unknown');
    expect(reportedAppVersion(device({ appVersion: '4.36.0' }), latest)).toBe('unknown');
    expect(reportedAppVersion(device(), { latestVersion: null, latestBuildId: null })).toBe('unknown');
  });
  it('can identify a differing legacy version without inventing its build', () => {
    expect(reportedAppVersion({ appVersion: '4.30.0' }, latest)).toBe('required');
  });
});

describe('account and device signal scope', () => {
  it('flags a recently used old device even when another device is current', () => {
    const result = userAppVersionStatus({ appDevices: [device(), device({ id: 'two', appVersion: '4.36.0', buildId: '123' })] }, latest, now);
    expect(result.state).toBe('required');
  });
  it('separates an old device signal from a recent one and never promises all devices are current', () => {
    const result = userAppVersionStatus({ appDevices: [device({ id: 'old', buildId: '123', lastSeenAt: old }), device()] }, latest, now);
    expect(result.state).toBe('stale');
    expect(result.devices.map(row => row.id)).toEqual(['one', 'old']);
    expect(result.devices[1].age).toBe('old');
  });
  it('never gives a green device verdict for an unidentified legacy account signal', () => {
    const result = userAppVersionStatus({ appVersion: latest.latestVersion, appBuildId: latest.latestBuildId, lastSeenAt: recent }, latest, now);
    expect(result.state).toBe('unknown');
    expect(result.legacy?.state).toBe('current');
    expect(result.devices).toHaveLength(0);
  });
  it('retains a newer unidentified old-client report alongside identified devices', () => {
    const result = userAppVersionStatus({ appDevices: [device({ lastSeenAt: '2026-10-14T10:00:00Z' })],
      appVersion: '4.32.0', appBuildId: '123', lastSeenAt: recent }, latest, now);
    expect(result.state).toBe('required');
    expect(result.legacy?.appVersion).toBe('4.32.0');
    expect(result.devices[0].state).toBe('current');
  });
  it('does not duplicate a modern account signal as an unidentified device', () => {
    const result = userAppVersionStatus({ appDevices: [device()], appVersion: latest.latestVersion, appBuildId: latest.latestBuildId, lastSeenAt: recent }, latest, now);
    expect(result.state).toBe('current');
    expect(result.legacy).toBeNull();
  });
  it('treats missing and future dates as unknown and expires the 24-hour signal', () => {
    expect(appSignalAge(undefined, now)).toBe('unknown');
    expect(appSignalAge('2026-10-15T12:00:00Z', now)).toBe('unknown');
    expect(appSignalAge('2026-10-13T12:00:00Z', now)).toBe('recent');
    expect(appSignalAge('2026-10-13T11:59:59Z', now)).toBe('old');
    expect(userAppVersionStatus({ appDevices: [device({ lastSeenAt: undefined })] }, latest, now).state).toBe('unknown');
  });
});
