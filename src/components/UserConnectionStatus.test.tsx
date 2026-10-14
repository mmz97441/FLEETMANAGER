import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const manifest = vi.hoisted(() => ({ value: {
  available: true, latestVersion: '4.37.0', latestBuildId: '200', checking: false,
  error: null as string | null, lastCheckedAt: null as number | null, checkNow: vi.fn(),
} }));
vi.mock('../hooks/useAutoUpdate', () => ({ useAutoUpdate: () => manifest.value }));
import UserConnectionStatus from './UserConnectionStatus';
import { UserRole, type User } from '../types';
import type { AppDeviceSignal } from '../utils/appVersionStatus';

const now = '2026-10-14T12:00:00Z';
const baseUser: User = { id: 'driver', firstName: 'Test', lastName: 'Chauffeur', email: 'test@example.invalid', role: UserRole.DRIVER, leaveBalance: 0 };
const render = (patch: Partial<User> & { appDevices?: AppDeviceSignal[] }) => renderToStaticMarkup(<UserConnectionStatus user={{ ...baseUser, ...patch }} />);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  manifest.value.latestVersion = '4.37.0'; manifest.value.latestBuildId = '200';
  manifest.value.error = null; manifest.value.lastCheckedAt = Date.now();
});
afterEach(() => vi.useRealTimers());

it('displays the server deployment target and its required-update badge', () => {
  const html = render({ appDevices: [{ id: 'phone', label: 'Android', appVersion: '4.36.0', buildId: '100', lastSeenAt: now }] });
  expect(html).toContain('Mise à jour requise');
  expect(html).toContain('Version publiée : 4.37.0');
  expect(html).toContain('Appareils identifiés (1)');
});

it('does not present an old signal as a currently outdated or currently up-to-date phone', () => {
  const html = render({ appDevices: [{ id: 'phone', label: 'Android', appVersion: '4.36.0', buildId: '100', lastSeenAt: '2026-10-10T12:00:00Z' }] });
  expect(html).toContain('Signal ancien à vérifier');
  expect(html).toContain('Ancienne version signalée');
  expect(html).not.toContain('Appareils récemment signalés à jour');
});

it('labels legacy account versions without assigning them to identified devices', () => {
  const html = render({ appVersion: '4.36.0', appBuildId: '100', lastSeenAt: now });
  expect(html).toContain('Dernier signal du compte : 4.36.0 — appareil non identifié.');
  expect(html).toContain('Cette version ne décrit pas tous ses appareils.');
  expect(html).not.toContain('Appareils identifiés');
});

it('keeps a known update requirement while showing the date of the last successful manifest check', () => {
  manifest.value.error = 'offline';
  const html = render({ appVersion: '4.36.0', appBuildId: '100', lastSeenAt: now });
  expect(html).toContain('Mise à jour requise');
  expect(html).toContain('Comparaison avec le déploiement vérifié le');
  expect(html).toContain('Nouvelle vérification en attente de connexion');
});
