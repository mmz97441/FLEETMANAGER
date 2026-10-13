import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// No upstream fix exists for braces 3.0.3. This temporary exception applies
// only to Tailwind's build-time glob parser, fed by versioned local patterns.
// Production dependencies, new advisories and expired exceptions still fail.
const bracesAdvisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const expiresAt = Date.parse('2026-11-13T00:00:00Z');
export function assessAudit(report, lock, now = Date.now()) {
  if (report.error || !report.vulnerabilities || !report.metadata?.vulnerabilities)
    throw new Error('Rapport npm audit invalide ou indisponible.');
  const blocked = [], excepted = [];
  const isBuildOnly = vulnerability => Array.isArray(vulnerability.nodes) && vulnerability.nodes.length > 0 &&
    vulnerability.nodes.every(node => lock.packages?.[node]?.dev === true);
  const permitted = (name, path = new Set()) => {
    const vulnerability = report.vulnerabilities[name];
    if (!vulnerability || path.has(name) || now >= expiresAt || !isBuildOnly(vulnerability) || !vulnerability.via?.length) return false;
    const next = new Set([...path, name]);
    return vulnerability.via.every(via => typeof via === 'string' ? permitted(via, next) :
      name === 'braces' && via.name === 'braces' && via.url === bracesAdvisory && via.range === '<=3.0.3' &&
      vulnerability.nodes.every(node => lock.packages[node].version === '3.0.3'));
  };
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!['moderate', 'high', 'critical'].includes(vulnerability.severity)) continue;
    (permitted(name) ? excepted : blocked).push(name);
  }
  return { blocked, excepted };
}

function run() {
  for (const directory of ['.', 'functions']) {
    const result = spawnSync('npm', ['audit', '--json'], { cwd: resolve(directory), encoding: 'utf8', timeout: 120000 });
    if (result.error || ![0, 1].includes(result.status)) throw new Error(`Audit indisponible (${directory}).`);
    const report = JSON.parse(result.stdout);
    const lock = JSON.parse(readFileSync(resolve(directory, 'package-lock.json'), 'utf8'));
    const { blocked, excepted } = assessAudit(report, lock);
    if (excepted.length) console.warn(`${directory} : exception temporaire jusqu'au 13/11/2026, compilation uniquement (${excepted.join(', ')}). ${bracesAdvisory}`);
    if (blocked.length) { console.error(`${directory} : vulnérabilités à corriger : ${blocked.join(', ')}`); process.exitCode = 1; }
    else console.log(`${directory} : aucune vulnérabilité bloquante ; ${report.metadata.vulnerabilities.total} signalement(s) npm.`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
