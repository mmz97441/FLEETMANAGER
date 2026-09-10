import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContextualSupportDraft, captureSupportContext, contextualSupportMailto, recordSupportErrorReference } from './supportContext';
import { buildDeviceDiagnosticReport, initialFieldResults } from './deviceDiagnostic';

afterEach(() => vi.unstubAllGlobals());
describe('voluntary support and field reports', () => {
  it('captures only a known screen, excluding query data and user identity', () => {
    vi.stubGlobal('window', { location: { pathname: '/missions', search: '?package=PRIVATE&email=private@example.invalid' } });
    const context = captureSupportContext(false);
    expect(context.screen).toBe('Tournées et colis');
    expect(JSON.stringify(context)).not.toContain('PRIVATE');
    expect(JSON.stringify(context)).not.toContain('private@example');
  });
  it('keeps the error origin when help is later opened', () => {
    vi.stubGlobal('window', { location: { pathname: '/driver-tour' } });
    recordSupportErrorReference('error-12345678');
    vi.stubGlobal('window', { location: { pathname: '/help' } });
    expect(captureSupportContext()).toMatchObject({ screen: 'Ma tournée', errorReference: 'error-12345678' });
    recordSupportErrorReference('https://example.invalid/private?email=secret');
    expect(captureSupportContext().errorReference).toBe('error-12345678');
  });
  it('excludes context when opted out and escapes the email draft', () => {
    expect(buildContextualSupportDraft('  Mon problème  ')).toBe('Mon problème');
    const mail = contextualSupportMailto('Essai & test', 'Ligne 1\nLigne 2');
    expect(mail).toContain('subject=Essai%20%26%20test');
    expect(mail).toContain('body=Ligne%201%0ALigne%202');
  });
  it('does not turn a capability check into a completed field scenario', () => {
    const report = buildDeviceDiagnosticReport('Appareil fictif', 'chauffeur', { camera: 'Flux obtenu' }, initialFieldResults());
    expect(report.scenarios).toHaveLength(8);
    expect(report.scenarios.every(result => result.outcome === 'non_testé' && result.seconds === null && result.errors === null)).toBe(true);
  });
});
