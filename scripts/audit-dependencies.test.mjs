import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAudit } from './audit-dependencies.mjs';
const now = Date.parse('2026-10-13T00:00:00Z');
const fixture = () => ({
  report: { metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
    braces: { severity: 'high', nodes: ['node_modules/braces'], via: [{ name: 'braces', range: '<=3.0.3', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }] },
    tailwindcss: { severity: 'high', nodes: ['node_modules/tailwindcss'], via: ['braces'] },
  } },
  lock: { packages: { 'node_modules/braces': { dev: true, version: '3.0.3' }, 'node_modules/tailwindcss': { dev: true } } },
});
test('only known build-time braces advisory and its dependency effects are excepted', () => {
  const { report, lock } = fixture();
  assert.deepEqual(assessAudit(report, lock, now), { blocked: [], excepted: ['braces', 'tailwindcss'] });
});
test('production dependency cannot use the exception', () => {
  const { report, lock } = fixture(); lock.packages['node_modules/braces'].dev = false;
  assert.deepEqual(assessAudit(report, lock, now).blocked, ['braces', 'tailwindcss']);
});
test('a new advisory on the same package still fails', () => {
  const { report, lock } = fixture(); report.vulnerabilities.braces.via.push({ name: 'braces', url: 'new-advisory' });
  assert.equal(assessAudit(report, lock, now).blocked.length, 2);
});
test('the exception expires and unknown package versions are refused', () => {
  const { report, lock } = fixture();
  assert.equal(assessAudit(report, lock, Date.parse('2026-11-13T00:00:00Z')).blocked.length, 2);
  lock.packages['node_modules/braces'].version = '3.0.4';
  assert.equal(assessAudit(report, lock, now).blocked.length, 2);
});
test('broken or incomplete audit reports cannot pass', () => {
  const { report, lock } = fixture();
  assert.throws(() => assessAudit({ error: { message: 'offline' } }, lock, now));
  report.vulnerabilities.tailwindcss.via = ['unknown'];
  assert.deepEqual(assessAudit(report, lock, now).blocked, ['tailwindcss']);
});
