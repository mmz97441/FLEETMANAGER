process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const db = req('firebase-admin/firestore').getFirestore();
const ctx = uid => ({ auth: { uid, token: { auth_time: 200 } } });
const prefix = 'reliability-' + randomUUID(), manager = prefix + '-office', driver = prefix + '-driver', client = prefix + '-client';
const order = '99887766', code = '00' + order + '300123450101', otherCode = '00' + order + '300123450202';
const p1 = prefix + '-one', p2 = prefix + '-two';
let passed = 0;
const check = async (name, f) => { await f(); passed++; console.log('PASS', name); };
const denied = (p, code) => assert.rejects(p, e => e.code === code);
const associate = (packageId, value = code, who = manager) => service.associateCarrierBarcode.run({ packageId, code: value, verified: true }, ctx(who));
(async () => {
  await db.collection('users').doc(manager).set({ role: 'Secrétaire', firstName: 'Test' });
  await db.collection('users').doc(driver).set({ role: 'Chauffeur', firstName: 'Test' });
  await db.collection('users').doc(client).set({ role: 'Client', companyName: 'Fictif' });
  for (const [id, br] of [[p1, 'BR-TEST-A'], [p2, 'BR-TEST-B']]) await db.collection('packages').doc(id).set({ externalId: br + prefix, barcode: br + prefix, clientId: client, clientReference: order, contactName: 'Fictif', address: 'Adresse fictive', status: 'En attente', movements: [] });
  await check('only office can associate labels and both labels must be physically verified', async () => {
    await denied(associate(p1, code, driver), 'permission-denied');
    await denied(service.associateCarrierBarcode.run({ packageId: p1, code }, ctx(manager)), 'invalid-argument');
    await denied(associate(p1, '0011111111300123450101'), 'invalid-argument');
    await denied(associate(p1, Number(code)), 'invalid-argument');
  });
  await check('association is idempotent, audited, and does not move or deliver the parcel', async () => {
    await associate(p1); assert.equal((await associate(p1)).replayed, true);
    const pkg = (await db.collection('packages').doc(p1).get()).data();
    assert.equal(pkg.carrierBarcode, code); assert.equal(pkg.status, 'En attente'); assert.equal(pkg.missionId, undefined);
    assert.equal((await db.collection('activity_logs').where('targetId', '==', p1).get()).size, 1);
    await denied(associate(p2), 'already-exists'); await denied(associate(p1, otherCode), 'already-exists');
  });
  await check('native code is recognized across every scan entry point without duplicate parcel assignment', async () => {
    for (const source of ['driver-claim', 'driver-delivery', 'driver-pickup', 'hub-loading', 'quick-scan', 'transfer']) {
      const result = await service.scanPackage.run({ requestId: randomUUID(), driverId: driver, source, code }, ctx(driver));
      assert.equal(result.accepted, true); assert.equal(result.packageId, p1);
    }
    assert.equal((await db.collection('packages').doc(p2).get()).data().missionId, undefined);
  });
  await check('concurrent associations cannot attach a second native code to two cartons', async () => {
    const p3 = prefix + '-three'; await db.collection('packages').doc(p3).set({ clientId: client, clientReference: order, status: 'En attente' });
    const outcomes = await Promise.allSettled([associate(p2, otherCode), associate(p3, otherCode)]);
    assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(x => x.status === 'rejected' && x.reason.code === 'already-exists').length, 1);
  });
  const importedCode = '0099887765300123450101';
  const row = n => ({ clientId: client, externalId: prefix + '-import-' + n, orderNumber: prefix + '-import-' + n, barcode: prefix + '-import-' + n, contactName: 'Fictif', address: 'Adresse fictive', status: 'En attente', packageIndex: 1, clientReference: '99887765', carrierBarcode: importedCode });
  await check('import keeps a native label as text and replay preserves the same association', async () => {
    const one = await service.importPackages.run({ packages: [row(1)] }, ctx(client));
    const two = await service.importPackages.run({ packages: [row(1)] }, ctx(client));
    assert.deepEqual(one.ids, two.ids); assert.equal((await db.collection('packages').doc(one.ids[0]).get()).data().carrierBarcode, importedCode);
    await denied(service.importPackages.run({ packages: [row(2)] }, ctx(client)), 'already-exists');
    await denied(service.importPackages.run({ packages: [{ ...row(3), carrierBarcode: 12345 }] }, ctx(client)), 'invalid-argument');
  });
  await check('duplicate labels in one import are rejected atomically', async () => {
    const code = '0099887764300123450101';
    await denied(service.importPackages.run({ packages: [4, 5].map(n => ({ ...row(n), carrierBarcode: code, clientReference: '99887764' })) }, ctx(client)), 'already-exists');
    assert.equal((await db.collection('packages').where('carrierBarcode', '==', code).get()).size, 0);
  });
  await check('diagnostics are authenticated, idempotent and cannot impersonate another account', async () => {
    const entry = { referenceId: prefix + '-error', userId: driver, createdAt: new Date().toISOString(), message: 'Synthetic network error', context: 'test.reliability', appVersion: '4.32.0' };
    await denied(service.recordClientErrors.run({ entries: [entry] }, {}), 'unauthenticated');
    await denied(service.recordClientErrors.run({ entries: [{ ...entry, userId: manager }] }, ctx(driver)), 'invalid-argument');
    await Promise.all([service.recordClientErrors.run({ entries: [entry, entry] }, ctx(driver)), service.recordClientErrors.run({ entries: [entry] }, ctx(driver))]);
    assert.equal((await db.collection('error_logs').where('referenceId', '==', entry.referenceId).get()).size, 1);
  });
  await check('presence records only a valid build and does not accept a supplied timestamp or role', async () => {
    await service.recordUserPresence.run({ uid: driver, login: true, appVersion: '4.32.0', buildId: '123456', lastSeenAt: '2099-01-01', role: 'Admin' }, ctx(driver));
    const user = (await db.collection('users').doc(driver).get()).data();
    assert.equal(user.appVersion, '4.32.0'); assert.equal(user.appBuildId, '123456'); assert.equal(user.role, 'Chauffeur'); assert.notEqual(user.lastSeenAt, '2099-01-01');
  });
  console.log(`${passed} production reliability server tests passed`);
  await req('firebase-admin/app').deleteApp(req('firebase-admin/app').getApp());
})().catch(error => { console.error(error); process.exit(1); });
