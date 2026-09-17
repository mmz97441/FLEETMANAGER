import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginDiagnosticOperation, captureRuntimeDiagnostics, diagnosticResource, recordDiagnosticAction, resetRuntimeDiagnostics } from './runtimeDiagnostics';
beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://test.invalid', pathname: '/documents', search: '?token=secret' });
  vi.stubGlobal('document', { visibilityState: 'visible' }); vi.stubGlobal('navigator', { onLine: true }); resetRuntimeDiagnostics();
});
afterEach(() => vi.unstubAllGlobals());
it('keeps only a bounded history of fixed actions and never accepts free text', () => {
  recordDiagnosticAction('address-private-text'); for (let i = 0; i < 30; i++) recordDiagnosticAction('ui.button');
  const snapshot = captureRuntimeDiagnostics(); expect(snapshot.breadcrumbs).toHaveLength(20);
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|address-private-text/); expect(snapshot.page).toBe('documents');
  snapshot.breadcrumbs.length = 0; expect(captureRuntimeDiagnostics().breadcrumbs).toHaveLength(20);
});
it('tracks pending operations and their result without any business payload', () => {
  const scan = beginDiagnosticOperation('scan.confirm'); const directory = beginDiagnosticOperation('directory.load');
  expect(captureRuntimeDiagnostics().pendingOperations).toHaveLength(2); scan.finish('refused'); directory.finish('success'); scan.finish('failure');
  expect(captureRuntimeDiagnostics().pendingOperations).toHaveLength(0);
  expect(captureRuntimeDiagnostics().breadcrumbs.filter(b => b.operationId === scan.id).map(b => b.phase)).toEqual(['start', 'refused']);
});
it('clears the previous account and ignores late completions from its session', () => {
  const old = beginDiagnosticOperation('scan.confirm'); const previous = captureRuntimeDiagnostics().sessionId;
  resetRuntimeDiagnostics(); old.finish('failure'); const snapshot = captureRuntimeDiagnostics();
  expect(snapshot.sessionId).not.toBe(previous); expect(snapshot.pendingOperations).toEqual([]);
  expect(snapshot.breadcrumbs.map(b => b.action)).toEqual(['session.start']);
});
it('removes access tokens and private resource paths from captured resource failures', () => {
  expect(diagnosticResource('https://test.invalid/assets/app-abc.js?token=secret#value')).toBe('https://test.invalid/assets/app-abc.js');
  expect(diagnosticResource('https://files.invalid/private/customer.pdf?signature=secret')).toBe('https://files.invalid');
  expect(diagnosticResource('data:text/plain,secret')).toBe('resource');
});
