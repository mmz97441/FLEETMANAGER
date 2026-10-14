process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const { scanPackageHandler } = require('../functions/lib/scanPackage.js');
const db = req('firebase-admin/firestore').getFirestore();
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
const driver = 'reliability-driver', client = 'reliability-client', office = 'reliability-office';
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('PASS', name); };
const parcel = code => ({ externalId: code, barcode: code, clientId: client, clientName: 'Boiron fictif', status: 'En attente', address: 'Adresse fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Test', zone: 'Nord' });
const imports = (packages, manifest) => service.importPackages.run({ packages, manifest }, context(client));
const read = async (collection, id) => (await db.collection(collection).doc(id).get()).data();
(async () => {
  await Promise.all([[driver, 'Chauffeur'], [client, 'Client'], [office, 'President']].map(([id, role]) => db.collection('users').doc(id).set({ role, firstName: 'Fictif', lastName: id, companyName: 'Boiron fictif' })));
  await check('interrupted import remains incomplete; replay and final chunk confirm exactly the expected parcels', async () => {
    const rows = ['BR-RELIAB-A', 'BR-RELIAB-B', 'BR-RELIAB-C'].map(parcel);
    const manifest = { clientId: client, references: rows.map(p => p.externalId + '\t'), fileName: 'synthetic.xlsx' };
    const first = await imports(rows.slice(0, 2), manifest);
    let run = await read('import_runs', first.importRunId);
    assert.equal(run.status, 'Incomplet'); assert.equal(run.confirmedCount, 2); assert.deepEqual(run.pendingReferences, ['BR-RELIAB-C\t']);
    const retry = await imports(rows.slice(0, 2), manifest); assert.deepEqual(retry.ids, first.ids);
    await imports(rows.slice(2), manifest); run = await read('import_runs', first.importRunId);
    assert.equal(run.status, 'Terminé'); assert.equal(run.confirmedCount, 3); assert.deepEqual(run.pendingReferences, []);
    for (const id of first.ids) assert.ok(await read('packages', id));
    await assert.rejects(imports([parcel('BR-UNEXPECTED')], manifest), e => e.code === 'invalid-argument');
    await assert.rejects(imports([rows[0]], { ...manifest, clientId: office }), e => e.code === 'invalid-argument');
  });
  await check('rejected file rows keep an otherwise committed import visibly incomplete', async () => {
    const rows = [parcel('BR-REJECTED-ROW')];
    const r = await imports(rows, { clientId: client, references: ['BR-REJECTED-ROW\t'], rejectedRows: 1 });
    assert.equal((await read('import_runs', r.importRunId)).status, 'Incomplet');
  });
  const missionId = 'reliability-tour', otherId = 'reliability-other-tour', packageId = 'reliability-parcel';
  const stop = { address: 'Adresse fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Test', id: 'stop-a', type: 'DELIVERY', status: 'En attente', packageIds: [packageId] };
  await db.collection('missions').doc(missionId).set({ driverId: driver, date: '2026-10-13', status: 'En cours', type: 'Livraison', stops: [stop, { ...stop, id: 'stop-b', packageIds: [] }], totalPackages: 1 });
  await db.collection('missions').doc(otherId).set({ driverId: driver, date: '2026-10-13', status: 'En cours', type: 'Livraison', stops: [{ ...stop, id: 'other-stop' }] });
  await db.collection('packages').doc(packageId).set({ ...parcel('BR-CONTROL'), missionId, missionDate: '2026-10-13', stopId: 'stop-a', currentDriverId: driver, status: 'En livraison', movements: [], lastScannedMissionId: missionId });
  const deps = { db, now: () => new Date('2026-10-13T10:00:00Z'), requireActiveCaller: async () => ({ id: driver, role: 'Chauffeur', firstName: 'Fictif' }), isAdminCaller: () => false };
  const scan = options => scanPackageHandler({ driverId: driver, code: 'BR-CONTROL', source: 'driver-delivery', targetMissionId: missionId, stopId: 'stop-a', requestId: randomUUID(), ...options }, context(driver), deps);
  await check('delivery verification accepts repeat control without claiming, moving or duplicating parcel', async () => {
    const before = await read('missions', missionId); const requestId = randomUUID();
    const a = await scan({ requestId }), replay = await scan({ requestId }), repeated = await scan({});
    assert.equal(a.outcome, 'verified'); assert.equal(a.accepted, true); assert.equal(replay.replayed, true); assert.equal(repeated.outcome, 'verified');
    assert.deepEqual(await read('missions', missionId), before);
    const p = await read('packages', packageId); assert.equal(p.status, 'En livraison'); assert.deepEqual(p.movements, []); assert.equal(p.lastVerifiedStopId, 'stop-a');
  });
  await check('wrong stop or tour is refused without changing any package assignment', async () => {
    const before = await read('packages', packageId);
    assert.equal((await scan({ stopId: 'stop-b' })).outcome, 'wrong_stop');
    assert.equal((await scan({ targetMissionId: otherId, stopId: 'other-stop' })).outcome, 'wrong_stop');
    assert.equal((await scan({ targetMissionId: undefined, stopId: undefined })).outcome, 'blocked');
    assert.deepEqual(await read('packages', packageId), before);
  });
  await check('yesterday and completed tours cannot be used to verify a delivery', async () => {
    await db.collection('missions').doc(missionId).update({ date: '2026-10-12' }); assert.equal((await scan({})).accepted, false);
    await db.collection('missions').doc(missionId).update({ date: '2026-10-13', status: 'Terminé' }); assert.equal((await scan({})).accepted, false);
    await db.collection('missions').doc(missionId).update({ status: 'En cours' });
  });
  await check('a delivered parcel explains its recorded delivery and does not reopen', async () => {
    await db.collection('packages').doc(packageId).update({ status: 'Livré', movements: [{ action: 'DELIVERED', driverName: 'Autre chauffeur fictif', timestamp: '2026-10-13T07:20:00Z' }] });
    const r = await scan({}); assert.equal(r.accepted, false); assert.match(r.message, /Autre chauffeur fictif/); assert.match(r.message, /11:20/);
    assert.equal((await read('packages', packageId)).status, 'Livré');
  });
  const adhoc = { clientVersion: '4.37.0', code: 'BR-MANUAL-TEST', clientId: client, contactName: 'Fictif', address: 'Adresse fictive', city: 'Saint-Denis', postalCode: '97400', verifiedMissing: true };
  await check('exceptional creation requires declared office verification, and cannot use an order label', async () => {
    await assert.rejects(service.createAdHocPackage.run({ ...adhoc, verifiedMissing: false }, context(driver)), e => e.code === 'invalid-argument');
    await assert.rejects(service.createAdHocPackage.run({ ...adhoc, code: '0012345678300123450101' }, context(driver)), e => e.code === 'failed-precondition');
    await assert.rejects(service.createAdHocPackage.run({ ...adhoc, code: '5763877' }, context(driver)), e => e.code === 'invalid-argument');
    await assert.rejects(service.createAdHocPackage.run(adhoc, context(client)), e => e.code === 'permission-denied');
  });
  await check('simultaneous exceptional creations and retries create one parcel and one audit entry', async () => {
    const receipts = await Promise.all([service.createAdHocPackage.run(adhoc, context(driver)), service.createAdHocPackage.run(adhoc, context(driver))]);
    assert.equal(receipts[0].package.id, receipts[1].package.id);
    assert.equal(receipts[0].package.reconciliationRequired, true);
    assert.equal((await db.collection('activity_logs').where('targetId', '==', receipts[0].package.id).get()).size, 1);
  });
  await check('exceptional creation cannot duplicate an imported physical code', async () => {
    await imports([parcel('BR-EXISTING')]);
    await assert.rejects(service.createAdHocPackage.run({ ...adhoc, code: 'BR-EXISTING' }, context(driver)), e => e.code === 'already-exists');
  });
  await check('an import racing an exceptional creation cannot duplicate the carton', async () => {
    const code = 'BR-CONCURRENT-IMPORT';
    const results = await Promise.allSettled([imports([parcel(code)]), service.createAdHocPackage.run({ ...adhoc, code }, context(driver))]);
    assert.ok(results.some(result => result.status === 'fulfilled'));
    assert.equal((await db.collection('packages').where('externalId', '==', code).get()).size, 1);
  });
  console.log(`${checks} scan/import reliability checks passed`); await db.terminate();
})().catch(e => { console.error(e); process.exitCode = 1; });
