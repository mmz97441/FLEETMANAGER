#!/usr/bin/env node
/** Default read-only inventory. Apply only proven date derivations on unassigned,
 * nonterminal quote parcels; never invent/change addresses or historical proofs.
 * node scripts/migrate-shipment-contract.cjs --project PROJECT --report /tmp/report.json
 * Add --apply --confirm-project PROJECT after reviewing that inventory. */
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
const req = createRequire(process.cwd() + '/functions/package.json');
const { initializeApp, deleteApp } = req('firebase-admin/app');
const { getFirestore, FieldPath } = req('firebase-admin/firestore');
const { shipmentMigrationPlan } = require('../functions/lib/shipmentMigration');
const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const projectId = arg('--project'), apply = args.includes('--apply'), reportPath = arg('--report');
if (!projectId || !reportPath) throw new Error('Specify --project and --report. Default mode is dry-run.');
if (apply && arg('--confirm-project') !== projectId) throw new Error('Apply requires --confirm-project matching --project.');
const app = initializeApp({ projectId }), db = getFirestore(app);
if (args.includes('--gcloud')) {
  const { execFileSync } = require('node:child_process');
  const { OAuth2Client } = req('google-auth-library');
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), expiry_date: Date.now() + 45 * 60 * 1000 });
  const headers = authClient.getRequestHeaders.bind(authClient);
  authClient.getRequestHeaders = async (...values) => new Headers(await headers(...values));
  db.settings({ authClient });
}
const report = { projectId, mode: apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(), packages: 0, candidates: [], addressReview: [], dateReview: [], applied: [], skippedConcurrent: [] };
(async () => {
  let cursor;
  for (;;) {
    let query = db.collection('packages').orderBy(FieldPath.documentId()).limit(300);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); if (page.empty) break;
    for (const doc of page.docs) {
      report.packages++;
      const parcel = doc.data();
      const quoteId = typeof parcel.importBatchId === 'string' && parcel.importBatchId.startsWith('QUOTE-') ? parcel.importBatchId.slice(6) : null;
      const quoteRef = quoteId && !quoteId.includes('/') ? db.collection('quotes').doc(quoteId) : null;
      const quote = quoteRef ? await quoteRef.get() : null;
      const plan = shipmentMigrationPlan(doc.id, parcel, quote?.data());
      if (Object.keys(plan.addressIssues).length) report.addressReview.push({ packageId: doc.id, fields: Object.keys(plan.addressIssues), status: parcel.status || null });
      if (plan.reason) report.dateReview.push({ packageId: doc.id, reason: plan.reason });
      if (!plan.patch) continue;
      report.candidates.push({ packageId: doc.id, patch: plan.patch });
      if (apply) {
        const changed = await db.runTransaction(async tx => {
          const current = await tx.get(doc.ref), currentQuote = quoteRef ? await tx.get(quoteRef) : null;
          if (!current.exists || !current.updateTime.isEqual(doc.updateTime)) return false;
          const checked = shipmentMigrationPlan(doc.id, current.data(), currentQuote?.data());
          if (!checked.patch || JSON.stringify(checked.patch) !== JSON.stringify(plan.patch)) return false;
          tx.update(doc.ref, { ...checked.patch, updatedAt: new Date().toISOString() }); return true;
        });
        (changed ? report.applied : report.skippedConcurrent).push(doc.id);
      }
    }
    cursor = page.docs.at(-1);
    console.log(JSON.stringify({ scanned: report.packages, candidates: report.candidates.length, applied: report.applied.length }));
  }
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: report.mode, packages: report.packages, candidates: report.candidates.length, addressReview: report.addressReview.length, dateReview: report.dateReview.length, applied: report.applied.length, skippedConcurrent: report.skippedConcurrent.length }));
  if (report.skippedConcurrent.length) process.exitCode = 2;
})().catch(error => { writeFileSync(reportPath, JSON.stringify({ ...report, failure: error.message }, null, 2)); console.error(error.message); process.exitCode = 1; }).finally(() => deleteApp(app));
