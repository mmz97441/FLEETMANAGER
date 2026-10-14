if (!process.env.FIRESTORE_EMULATOR_HOST || !/^127\.0\.0\.1:|^localhost:/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Local Firestore emulator required.');
process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index');
const { parcelScanCodes } = require('../functions/lib/scanCode');
const { scanBusinessDay } = require('../functions/lib/scanPackage');
const db = req('firebase-admin/firestore').getFirestore();
const prefix = 'identities-' + randomUUID(), driver = prefix + '-driver', clientA = prefix + '-a', clientB = prefix + '-b', office = prefix + '-office';
const context = uid => ({ auth: { uid, token: { auth_time: 200 } } });
const point = { address: '1 rue Fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Pharmacie A', floor: 0 };
const parcel = (code, clientId = clientA, changes = {}) => ({ ...point, clientId, externalId: code, barcode: `GFL-${code}`, orderNumber: `ORDER-${code}`, status: 'En attente', serviceTime: 5, ...changes });
const imports = (packages, uid = clientA) => service.importPackages.run({ packages }, context(uid));
let checks = 0, seq = 0;
const check = async (name, task) => { await task(); console.log('PASS', name); checks++; };
const read = async (col, id) => (await db.collection(col).doc(id).get()).data();
const scan = (code, options = {}) => service.scanPackage.run({ clientVersion: '4.37.0', requestId: randomUUID(), source: 'driver-claim', code, ...options }, context(driver));
async function seed(changes = {}, extra = []) {
  const id = prefix + '-mission-' + (++seq), p = id + '-p';
  const pkg = parcel(id + '-code', clientA, { ...changes, missionId: id, stopId: 'stop', currentDriverId: driver, status: 'En livraison' });
  await db.collection('packages').doc(p).set({ ...pkg, scanCodes: parcelScanCodes(pkg) });
  const stop = { ...point, ...changes, id: 'stop', type: 'DELIVERY', status: 'En attente', sequence: 1, packageIds: [p, ...extra], packageCount: 1 + extra.length, serviceTime: 5 };
  await db.collection('missions').doc(id).set({ driverId: driver, date: scanBusinessDay(new Date()), type: 'Livraison', status: 'En cours', stops: [stop], totalPackages: 1 + extra.length });
  return { id, p, pkg, stop };
}
(async () => {
  for (const [id, role] of [[driver, 'Chauffeur'], [clientA, 'Client'], [clientB, 'Client'], [office, 'President']]) await db.collection('users').doc(id).set({ role, firstName: 'Fictif', companyName: 'Expéditeur fictif' });
  await check('generic labels retain their original text and scan identically in upper case', async () => {
    const code = prefix + '-exp-a/00042';
    const created = await imports([parcel(code, clientA, { carrierBarcode: '0000' + prefix })]);
    const saved = await read('packages', created.ids[0]);
    assert.equal(saved.externalId, code); assert.ok(saved.scanCodes.includes(code.toUpperCase()));
    const found = await scan(code.toUpperCase()); assert.equal(found.accepted, true); assert.equal(found.packageId, created.ids[0]);
  });
  await check('simultaneous different senders cannot reserve the same individual code with different case', async () => {
    const code = prefix + '-concurrent';
    const results = await Promise.allSettled([imports([parcel(code)]), imports([parcel(code.toUpperCase(), clientB)], clientB)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'already-exists').length, 1, JSON.stringify(results.map(r => r.status === 'rejected' ? { code: r.reason.code, message: r.reason.message } : r.status)));
    assert.equal((await db.collection('packages').where('scanCodes', 'array-contains', code.toUpperCase()).get()).size, 1);
  });
  await check('different identifier fields cannot bypass the global collision check', async () => {
    const code = prefix + '-cross-field'; await imports([parcel(code)]);
    await assert.rejects(imports([parcel(prefix + '-different', clientB, { carrierBarcode: code.toUpperCase() })], clientB), e => e.code === 'already-exists');
  });
  await check('generic carrier association races safely with another sender import', async () => {
    const code = prefix + '-association-race', target = prefix + '-association-target';
    await db.collection('packages').doc(target).set(parcel(prefix + '-target'));
    const results = await Promise.allSettled([
      service.associateCarrierBarcode.run({ packageId: target, code, verified: true }, context(office)),
      imports([parcel(code, clientB)], clientB),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'already-exists').length, 1, JSON.stringify(results.map(r => r.status === 'rejected' ? { code: r.reason.code, message: r.reason.message } : r.status)));
  });
  await check('a shared order reference remains ambiguous and cannot identify one carton', async () => {
    const code = prefix + '-shared-order';
    const created = await imports([parcel(prefix + '-order-a', clientA, { orderNumber: code }), parcel(prefix + '-order-b', clientA, { orderNumber: code })]);
    const result = await scan(code.toUpperCase(), { packageId: created.ids[0] });
    assert.equal(result.outcome, 'ambiguous'); assert.equal(result.accepted, false);
  });
  await check('the explicit Boiron format refuses a mismatching order while generic mode accepts free codes', async () => {
    await assert.rejects(imports([parcel(prefix + '-boiron', clientA, { carrierBarcode: '0014085834301322930101', carrierBarcodeFormat: 'boiron', clientReference: '14085835' })]), e => e.code === 'invalid-argument');
  });
  await check('historical canonical collisions refuse scans even with an explicit parcel id', async () => {
    const code = prefix + '-historical';
    for (const [id, raw] of [['one', code], ['two', code.toUpperCase()]]) {
      const pkg = parcel(raw); await db.collection('packages').doc(prefix + id).set({ ...pkg, scanCodes: parcelScanCodes(pkg) });
    }
    const result = await scan(code.toUpperCase(), { packageId: prefix + 'one' });
    assert.equal(result.outcome, 'ambiguous'); assert.equal(result.packageId, null);
  });
  await check('prepare and delivery scan block a different recipient already inside the stop', async () => {
    const otherId = prefix + '-wrong', t = await seed({}, [otherId]);
    const wrong = parcel(prefix + '-wrong-code', clientB, { contactName: 'Cabinet B', missionId: t.id, stopId: 'stop', currentDriverId: driver, status: 'En livraison' });
    await db.collection('packages').doc(otherId).set({ ...wrong, scanCodes: parcelScanCodes(wrong) });
    const before = await read('missions', t.id);
    await assert.rejects(service.prepareDeliveryStop.run({ clientVersion: '4.37.0', missionId: t.id, stopId: 'stop', arrive: true }, context(driver)), e => e.code === 'failed-precondition');
    for (const code of [t.pkg.externalId, wrong.externalId]) assert.equal((await scan(code, { source: 'driver-delivery', targetMissionId: t.id, stopId: 'stop' })).outcome, 'wrong_stop');
    assert.deepEqual(await read('missions', t.id), before);
  });
  await check('floor and disjoint windows create separate visits during claim', async () => {
    const t = await seed({ timeWindowStart: '08:00', timeWindowEnd: '09:00' });
    for (const [suffix, changes] of [['floor', { floor: 2 }], ['window', { timeWindowStart: '14:00', timeWindowEnd: '15:00' }]]) {
      const pkg = parcel(prefix + suffix, clientA, changes); await db.collection('packages').doc(prefix + suffix).set({ ...pkg, scanCodes: parcelScanCodes(pkg) });
      assert.equal((await scan(pkg.externalId, { targetMissionId: t.id })).accepted, true);
    }
    assert.equal((await read('missions', t.id)).stops.length, 3);
  });
  await check('claim never adds a parcel to an arrived stop', async () => {
    const t = await seed(); t.stop.status = 'Arrivé'; await db.collection('missions').doc(t.id).update({ stops: [t.stop] });
    const pkg = parcel(prefix + '-new-arrived'); await db.collection('packages').doc(prefix + '-new-arrived').set({ ...pkg, scanCodes: parcelScanCodes(pkg) });
    const result = await scan(pkg.externalId, { targetMissionId: t.id }); assert.equal(result.accepted, true); assert.notEqual(result.stopId, 'stop');
    const stops = (await read('missions', t.id)).stops; assert.deepEqual(stops[0].packageIds, [t.p]); assert.equal(stops.length, 2);
    await assert.rejects(service.prepareDeliveryStop.run({ clientVersion: '4.37.0', missionId: t.id, stopId: 'stop', packageIds: [prefix + '-new-arrived'] }, context(driver)), e => e.code === 'failed-precondition');
  });
  await check('a planned window wider than the parcel window is rejected even on the original stop', async () => {
    const t = await seed(); await db.collection('packages').doc(t.p).update({ timeWindowStart: '14:00', timeWindowEnd: '15:00' });
    await assert.rejects(service.prepareDeliveryStop.run({ clientVersion: '4.37.0', missionId: t.id, stopId: 'stop' }, context(driver)), e => e.code === 'failed-precondition');
  });
  await check('ten parcels from mixed senders remain eligible for one common delivery', async () => {
    const t = await seed();
    for (let i = 1; i < 10; i++) {
      const pkg = parcel(prefix + '-ten-' + i, i % 2 ? clientA : clientB);
      await db.collection('packages').doc(prefix + '-ten-' + i).set({ ...pkg, scanCodes: parcelScanCodes(pkg) });
      assert.equal((await scan(pkg.externalId, { targetMissionId: t.id })).accepted, true);
    }
    const result = await service.prepareDeliveryStop.run({ clientVersion: '4.37.0', missionId: t.id, stopId: 'stop', arrive: true }, context(driver));
    assert.equal(result.mission.stops.length, 1); assert.equal(result.mission.stops[0].packageCount, 10);
  });
  await check('returns awaiting a decision and final sender returns cannot be reclaimed', async () => {
    for (const returnDisposition of ['AWAITING_DECISION', 'SENDER_RETURNED']) {
      const t = await seed(); await db.collection('packages').doc(t.p).update({ returnDisposition });
      assert.equal((await scan(t.pkg.externalId, { targetMissionId: t.id })).accepted, false);
      await assert.rejects(service.prepareDeliveryStop.run({ clientVersion: '4.37.0', missionId: t.id, stopId: 'stop' }, context(driver)), e => e.code === 'failed-precondition');
    }
  });
  await check('historical lowercase imports replay by canonical identity without changing original references', async () => {
    const code = prefix + '-legacy-replay', originalId = prefix + '-legacy-id', pkg = parcel(code);
    await db.collection('packages').doc(originalId).set({ ...pkg, scanCodes: parcelScanCodes(pkg) });
    const result = await imports([parcel(code.toUpperCase())]); assert.deepEqual(result.ids, [originalId]);
    assert.equal((await read('packages', originalId)).externalId, code);
  });
  await check('imports validate real dates, windows and service durations but preserve existing retries', async () => {
    for (const change of [{ requestedDeliveryDate: '2026-02-30' }, { timeWindowStart: '14:00', timeWindowEnd: '09:00' }, { timeWindowEnd: '99:00' }, { serviceTime: 0 }])
      await assert.rejects(imports([parcel(prefix + '-invalid-' + randomUUID(), clientA, change)]), e => e.code === 'invalid-argument');
    const historical = await imports([parcel(prefix + '-historical-date', clientA, { requestedDeliveryDate: '2000-01-01' })]);
    assert.equal((await read('packages', historical.ids[0])).requestedDeliveryDate, '2000-01-01');
    const code = prefix + '-date-retry'; const first = await imports([parcel(code)]);
    const retry = await imports([parcel(code, clientA, { requestedDeliveryDate: '2000-01-01' })]);
    assert.deepEqual(retry.ids, first.ids); assert.equal((await read('packages', first.ids[0])).requestedDeliveryDate, undefined);
  });
  await check('transfer refuses a historically mixed destination before moving any package', async () => {
    const t = await seed(); await db.collection('packages').doc(t.p).update({ contactName: 'Autre destinataire' });
    const id = prefix + '-transfer-candidate'; await db.collection('packages').doc(id).set(parcel(id));
    await assert.rejects(service.transferPackages.run({ packageIds: [id], missionId: t.id, claimMode: true }, context(driver)), e => e.code === 'failed-precondition');
    assert.equal((await read('packages', id)).missionId, undefined);
  });
  await check('within-file cross-field collisions and order-only concurrent labels cannot bypass reservations', async () => {
    const code = prefix + '-within-file';
    await assert.rejects(imports([parcel(code), parcel(prefix + '-within-file-other', clientA, { orderNumber: code })]), e => e.code === 'already-exists');
    const sole = prefix + '-order-only';
    const results = await Promise.allSettled([imports([parcel('', clientA, { barcode: '', orderNumber: sole })]), imports([parcel('', clientB, { barcode: '', orderNumber: sole.toUpperCase() })], clientB)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'already-exists').length, 1);
  });
  await check('a concurrent shared-order alias cannot steal another carton individual label', async () => {
    const code = prefix + '-order-alias-race';
    const results = await Promise.allSettled([
      imports([parcel(code)]),
      imports([parcel(prefix + '-other-order-alias', clientB, { orderNumber: code })], clientB),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'already-exists').length, 1);
    const shared = prefix + '-concurrent-shared-order';
    const sharedResults = await Promise.allSettled([
      imports([parcel(prefix + '-shared-order-one', clientA, { orderNumber: shared })]),
      imports([parcel(prefix + '-shared-order-two', clientB, { orderNumber: shared })], clientB),
    ]);
    assert.equal(sharedResults.filter(r => r.status === 'fulfilled').length, 2);
    assert.equal((await scan(shared)).outcome, 'ambiguous');
  });
  console.log(`${checks} logistics identity checks passed`);
  await db.terminate();
})().catch(error => { console.error(error); process.exitCode = 1; });
