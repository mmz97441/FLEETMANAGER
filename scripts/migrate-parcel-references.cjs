#!/usr/bin/env node
/** Derived-data backfill only. Default dry run; never alters labels, status or ownership.
 * node scripts/migrate-parcel-references.cjs --project PROJECT [--apply] [--report /tmp/report.json]
 * Authenticate through ADC or run against FIRESTORE_EMULATOR_HOST. */
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const { initializeApp, deleteApp } = req('firebase-admin/app');
const { getFirestore, FieldPath } = req('firebase-admin/firestore');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { parcelScanCodes, parcelIndividualCodes, normalizeScanCode } = require('../functions/lib/scanCode');
const argv = process.argv.slice(2), arg = name => argv[argv.indexOf(name) + 1];
const projectId = argv.includes('--project') ? arg('--project') : process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error('Specify --project explicitly. Dry run is the default.');
if (argv.includes('--apply') && !argv.includes('--report')) throw new Error('--apply requires --report to retain the migration result.');
const app = initializeApp({ projectId });
const db = getFirestore(app);
// Optional existing gcloud session. The bearer token remains in memory and is
// never written to the report, arguments or console.
if (argv.includes('--gcloud')) {
  const { execFileSync } = require('node:child_process');
  const { OAuth2Client } = req('google-auth-library');
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), expiry_date: Date.now() + 45 * 60 * 1000 });
  const requestHeaders = authClient.getRequestHeaders.bind(authClient);
  authClient.getRequestHeaders = async (...args) => new Headers(await requestHeaders(...args));
  db.settings({ authClient });
}
const refId = code => createHash('sha256').update(normalizeScanCode(code)).digest('hex');
(async () => {
  const parcels = [], codes = new Map(), individualCodes = new Set(); let cursor;
  for (;;) {
    let query = db.collection('packages').orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); if (page.empty) break;
    for (const doc of page.docs) {
      const parcel = doc.data(), canonical = parcelScanCodes(parcel);
      for (const code of parcelIndividualCodes(parcel)) individualCodes.add(code);
      parcels.push({ doc, canonical, needsUpdate: JSON.stringify(parcel.scanCodes) !== JSON.stringify(canonical) });
      for (const code of canonical) { if (!codes.has(code)) codes.set(code, []); codes.get(code).push(doc.id); }
    }
    cursor = page.docs.at(-1);
  }
  const report = { projectId, mode: argv.includes('--apply') ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(),
    packages: parcels.length, needingIndex: parcels.filter(p => p.needsUpdate).length, distinctCodes: codes.size,
    collisions: [...codes].filter(([, ids]) => ids.length > 1).map(([code, packageIds]) => ({ referenceHash: refId(code), packageIds,
      kind: individualCodes.has(code) ? 'individual-collision' : 'shared-order' })),
    updatedPackages: 0, updatedReservations: 0, skippedConcurrent: [] };
  report.individualCollisions = report.collisions.filter(item => item.kind === 'individual-collision').length;
  report.sharedOrderReferences = report.collisions.filter(item => item.kind === 'shared-order').length;
  if (argv.includes('--apply')) {
    for (const { doc, canonical, needsUpdate } of parcels) {
      if (!needsUpdate) continue;
      try { await doc.ref.update({ scanCodes: canonical }, { lastUpdateTime: doc.updateTime }); report.updatedPackages++; }
      catch (error) { if ([5, 9].includes(error.code)) report.skippedConcurrent.push(doc.id); else throw error; }
    }
    if (!report.skippedConcurrent.length) {
      for (const code of codes.keys()) {
        await db.runTransaction(async tx => {
          const reservation = db.collection('parcel_reference_index').doc(refId(code));
          await tx.get(reservation); // serialize against imports and association writes
          const found = await tx.get(db.collection('packages').where('scanCodes', 'array-contains', code));
          const packageIds = found.docs.map(doc => doc.id).slice(0, 2);
          const individual = found.docs.some(doc => parcelIndividualCodes(doc.data()).includes(code));
          tx.set(reservation, { code, packageIds, packageId: packageIds.length === 1 ? packageIds[0] : null,
            referenceKind: individual ? (found.size > 1 ? 'collision' : 'individual') : 'order',
            ambiguous: packageIds.length > 1, updatedAt: new Date().toISOString(), updatedBy: 'reference-index-migration' });
        });
        report.updatedReservations++;
      }
    }
  }
  if (argv.includes('--report')) fs.writeFileSync(arg('--report'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, collisions: report.collisions.length, skippedConcurrent: report.skippedConcurrent.length }, null, 2));
  if (report.skippedConcurrent.length) { console.error('Concurrent edits were preserved. Rerun the migration before considering the index complete.'); process.exitCode = 2; }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => deleteApp(app));
