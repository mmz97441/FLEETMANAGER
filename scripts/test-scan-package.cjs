process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const { scanPackageHandler, scanBusinessDay } = require('../functions/lib/scanPackage.js');
const db = req('firebase-admin/firestore').getFirestore();
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
let number = 0;
async function check(name, test) {
  const id = `scan-test-${++number}`;
  const driverId = `${id}-driver`, parcelId = `${id}-parcel`, oldId = `${id}-yesterday`;
  await db.collection('users').doc(driverId).set({ role: 'Chauffeur', firstName: 'Fictif', lastName: 'Test' });
  const pkgRef = db.collection('packages').doc(parcelId), oldRef = db.collection('missions').doc(oldId);
  await pkgRef.set({ externalId: id, barcode: `label-${id}`, status: 'En livraison', missionId: oldId, stopId: 'old-stop',
    currentDriverId: driverId, address: '1 rue Fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Destinataire fictif', movements: [] });
  await oldRef.set({ driverId, date: '2026-09-16', type: 'Livraison', status: 'En cours', totalPackages: 1,
    stops: [{ id: 'old-stop', type: 'DELIVERY', status: 'En attente', packageIds: [parcelId], packageCount: 1 }] });
  let instant = '2026-09-17T05:00:00Z';
  const deps = { db, now: () => new Date(instant), isAdminCaller: r => r === 'Admin',
    requireActiveCaller: async c => ({ ...(await db.collection('users').doc(c.auth.uid).get()).data(), id: c.auth.uid }) };
  const scan = (overrides = {}, uid = driverId) => scanPackageHandler({ code: id, driverId, source: 'driver-claim', requestId: randomUUID(), ...overrides }, context(uid), deps);
  const state = async () => (await pkgRef.get()).data();
  await test({ id, driverId, parcelId, pkgRef, oldId, oldRef, scan, state, clock: v => { instant = v; } });
  console.log('PASS', name);
}
(async () => {
  assert.equal(scanBusinessDay(new Date('2026-09-16T20:00:00Z')), '2026-09-17');
  await check('yesterday parcel moves atomically into today tour and keeps both tour dates', async t => {
    const r = await t.scan(); assert.equal(r.outcome, 'reassigned'); assert.equal(r.missionDate, '2026-09-17');
    assert.equal(r.previousMissionDate, '2026-09-16');
    const pkg = await t.state(); assert.equal(pkg.missionId, r.missionId); assert.equal(pkg.stopId, r.stopId);
    const tour = (await db.collection('missions').doc(r.missionId).get()).data();
    assert.deepEqual(tour.stops[0].packageIds, [t.parcelId]); assert.equal(tour.totalPackages, 1);
    assert.deepEqual((await t.oldRef.get()).data().stops[0].packageIds, []);
    assert.equal(pkg.movements[0].fromMissionId, t.oldId); assert.equal(pkg.lastScannedAt, r.scannedAt);
  });
  await check('second physical scan is audited without another stop or parcel', async t => {
    const first = await t.scan(), second = await t.scan(); assert.equal(second.outcome, 'already_scanned');
    assert.equal(first.missionId, second.missionId); assert.equal((await t.state()).movements.length, 2);
    const tour = (await db.collection('missions').doc(first.missionId).get()).data(); assert.equal(tour.stops.length, 1); assert.equal(tour.totalPackages, 1);
  });
  await check('network replay returns original receipt with exactly one audit event', async t => {
    const requestId = randomUUID(); const a = await t.scan({ requestId }); t.clock('2026-09-17T06:00:00Z');
    const b = await t.scan({ requestId }); assert.equal(b.replayed, true); assert.equal(b.scannedAt, a.scannedAt);
    assert.equal((await t.state()).movements.length, 1);
    assert.equal((await db.collection('activity_logs').where('targetId', '==', t.parcelId).get()).size, 1);
    await assert.rejects(t.scan({ requestId, source: 'transfer' }), e => e.code === 'invalid-argument');
  });
  await check('rescan tomorrow ignores cached yesterday tour', async t => {
    const first = await t.scan(); t.clock('2026-09-18T03:00:00Z');
    const next = await t.scan({ targetMissionId: first.missionId });
    assert.equal(next.missionDate, '2026-09-18'); assert.notEqual(next.missionId, first.missionId); assert.equal(next.outcome, 'reassigned');
  });
  await check('current dispatched tour is used instead of creating a parallel tour', async t => {
    await db.collection('missions').doc(`${t.id}-current`).set({ driverId: t.driverId, date: '2026-09-17', status: 'Dispatché', type: 'Livraison', stops: [] });
    const r = await t.scan(); assert.equal(r.missionId, `${t.id}-current`); assert.equal((await t.state()).status, 'Chargé');
  });
  await check('closed yesterday tour and failed parcel can be rescanned without reopening history', async t => {
    await t.oldRef.update({ status: 'Terminé' }); await t.pkgRef.update({ status: 'Échec' });
    assert.equal((await t.scan()).accepted, true); assert.equal((await t.oldRef.get()).data().status, 'Terminé');
  });
  await check('closed today tour is never reused', async t => {
    const first = await t.scan(); await db.collection('missions').doc(first.missionId).update({ status: 'Terminé' });
    const next = await t.scan({ targetMissionId: first.missionId }); assert.notEqual(next.missionId, first.missionId);
  });
  await check('concurrent scans of same parcel create one tour and one stop', async t => {
    const receipts = await Promise.all([t.scan(), t.scan()]); assert.equal(receipts[0].missionId, receipts[1].missionId);
    assert.deepEqual(receipts.map(r => r.outcome).sort(), ['already_scanned', 'reassigned']);
    const m = (await db.collection('missions').doc(receipts[0].missionId).get()).data(); assert.equal(m.stops.length, 1); assert.equal(m.totalPackages, 1);
  });
  await check('concurrent different parcels share one tour and preserve both attachments', async t => {
    const second = `${t.parcelId}-other`; await db.collection('packages').doc(second).set({ ...(await t.state()), externalId: `${t.id}-second`, barcode: `${t.id}-second-label`, missionId: null, stopId: null });
    const r = await Promise.all([t.scan(), t.scan({ packageId: second, code: `${t.id}-second` })]); assert.equal(r[0].missionId, r[1].missionId);
    const m = (await db.collection('missions').doc(r[0].missionId).get()).data(); assert.equal(m.totalPackages, 2);
    assert.deepEqual(m.stops.flatMap(s => s.packageIds).sort(), [t.parcelId, second].sort());
  });
  await check('delivered parcel cannot be taken again', async t => {
    await t.pkgRef.update({ status: 'Livré' }); assert.equal((await t.scan()).outcome, 'terminal'); assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('successful delivery proof prevents reclaim even with stale package status', async t => {
    await db.collection('proofs_of_delivery').doc(`${t.oldId}_old-stop`).set({ type: 'SUCCESS', packageIds: [t.parcelId] });
    assert.equal((await t.scan()).outcome, 'terminal'); assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('pending proof sync prevents reclaim', async t => {
    const old = (await t.oldRef.get()).data(); old.stops[0].proofSyncPending = true; await t.oldRef.set(old);
    assert.equal((await t.scan()).outcome, 'blocked'); assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('ambiguous shared reference never chooses an arbitrary parcel', async t => {
    await t.pkgRef.update({ clientReference: `${t.id}-shared` });
    await db.collection('packages').doc(`${t.parcelId}-duplicate`).set({ clientReference: `${t.id}-shared`, status: 'En attente' });
    assert.equal((await t.scan({ code: `${t.id}-shared` })).outcome, 'ambiguous'); assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('numeric order label is recognized without choosing a carton or changing its tour', async t => {
    const reference = '12345678', code = `00${reference}300123450101`;
    await t.pkgRef.update({ clientReference: reference });
    const other = db.collection('packages').doc(`${t.parcelId}-other`);
    await other.set({ clientReference: reference, status: 'Livré' });
    for (const source of ['driver-claim', 'driver-delivery', 'driver-pickup', 'hub-loading', 'quick-scan', 'transfer']) {
      const r = await t.scan({ code, source });
      assert.equal(r.outcome, 'ambiguous'); assert.equal(r.accepted, false);
      assert.equal(r.matchedOrderReference, reference); assert.equal(r.packageId, null);
      assert.match(r.message, /numéro BR/); assert.equal((await t.state()).missionId, t.oldId);
    }
    assert.equal((await t.state()).movements.length, 0);
    assert.equal((await other.get()).data().status, 'Livré');
  });
  await check('a single imported carton does not turn an order hint into a physical identification', async t => {
    await t.pkgRef.update({ clientReference: '12345679' });
    const r = await t.scan({ code: ']d20012345679300123450101' });
    assert.equal(r.outcome, 'ambiguous'); assert.equal(r.matchedOrderReference, '12345679');
    assert.equal((await t.state()).missionId, t.oldId);
    await assert.rejects(t.scan({ packageId: t.parcelId, code: '0012345679300123450101' }), e => e.code === 'invalid-argument');
  });
  await check('exact numeric barcode wins over a coincidental embedded order reference', async t => {
    const code = '0012345680300123450101';
    await t.pkgRef.update({ barcode: code });
    await db.collection('packages').doc(`${t.parcelId}-unrelated`).set({ clientReference: '12345680', status: 'En attente' });
    const r = await t.scan({ code }); assert.equal(r.accepted, true); assert.equal(r.packageId, t.parcelId);
  });
  await check('unknown numeric label stays unknown without inventing a parcel', async t => {
    const r = await t.scan({ code: '0087654321300123450101' });
    assert.equal(r.outcome, 'not_found'); assert.equal(r.packageId, null);
    assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('full individual code remains usable after an order-label refusal and detects duplicates', async t => {
    await t.pkgRef.update({ clientReference: '12345681', barcode: 'BR9010', externalId: 'BR9010' });
    assert.equal((await t.scan({ code: '0012345681300123450101' })).accepted, false);
    assert.equal((await t.scan({ code: ']d2BR9010' })).accepted, true);
    assert.equal((await t.scan({ code: 'BR9010' })).outcome, 'already_scanned');
  });
  await check('explicit package id cannot validate a longer carton number sharing its prefix', async t => {
    await t.pkgRef.update({ externalId: 'BR905', barcode: 'BR905' });
    await assert.rejects(t.scan({ packageId: t.parcelId, code: 'BR9051' }), e => e.code === 'invalid-argument');
    assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('explicit active tour wins when driver has several tours', async t => {
    for (const suffix of ['a', 'b']) await db.collection('missions').doc(`${t.id}-${suffix}`).set({ driverId: t.driverId, date: '2026-09-17', type: 'Livraison', status: 'En cours', stops: [] });
    assert.equal((await t.scan({ targetMissionId: `${t.id}-b` })).missionId, `${t.id}-b`);
  });
  await check('all operational entry points apply the same attachment and audit policy', async t => {
    let missionId;
    for (const source of ['driver-claim', 'driver-delivery', 'hub-loading', 'quick-scan', 'transfer', 'manual-create']) {
      const r = await t.scan({ source }); missionId ||= r.missionId; assert.equal(r.missionId, missionId); assert.equal(r.accepted, true);
    }
    assert.equal((await t.state()).movements.length, 6);
  });
  await check('pickup verification is audited without falsely marking parcel collected', async t => {
    await t.oldRef.update({ date: '2026-09-17', type: 'Collecte', stops: [{ id: 'old-stop', type: 'PICKUP', status: 'En attente', packageIds: [t.parcelId] }] });
    await t.pkgRef.update({ status: 'En attente' }); const r = await t.scan({ source: 'driver-pickup', targetMissionId: t.oldId });
    assert.equal(r.accepted, true); assert.equal((await t.state()).status, 'En attente'); assert.equal(r.stopId, 'old-stop');
  });
  await check('pickup with legacy missing driver assignment stays on its pickup stop', async t => {
    await t.oldRef.update({ date: '2026-09-17', type: 'Collecte', stops: [{ id: 'old-stop', type: 'PICKUP', status: 'En attente', packageIds: [t.parcelId] }] });
    await t.pkgRef.update({ status: 'En attente', currentDriverId: null });
    const r = await t.scan({ source: 'driver-pickup', stopId: 'old-stop', targetMissionId: t.oldId });
    assert.equal(r.stopId, 'old-stop'); assert.equal((await t.state()).status, 'En attente');
    assert.equal((await t.oldRef.get()).data().stops.length, 1); assert.equal((await t.state()).currentDriverId, t.driverId);
  });
  await check('first verified scan of a preloaded parcel is confirmed, not falsely called a duplicate', async t => {
    await t.oldRef.update({ date: '2026-09-17' });
    assert.equal((await t.scan()).outcome, 'confirmed');
    assert.equal((await t.scan()).outcome, 'already_scanned');
  });
  await check('driver cannot scan on behalf of another driver or target someone else tour', async t => {
    await assert.rejects(t.scan({ driverId: 'another-driver' }), e => e.code === 'permission-denied');
    await db.collection('missions').doc(`${t.id}-foreign`).set({ driverId: 'someone-else', date: '2026-09-17' });
    await assert.rejects(t.scan({ targetMissionId: `${t.id}-foreign` }), e => e.code === 'permission-denied');
  });
  await check('hub and quick scan reuse the last tour confirmed by the driver on another device', async t => {
    for (const suffix of ['a', 'b']) await db.collection('missions').doc(`${t.id}-${suffix}`).set({ driverId: t.driverId, date: '2026-09-17', type: 'Livraison', status: 'En cours', stops: [] });
    await t.scan({ targetMissionId: `${t.id}-b` });
    assert.equal((await t.scan({ source: 'hub-loading' })).missionId, `${t.id}-b`);
    assert.equal((await t.scan({ source: 'quick-scan' })).missionId, `${t.id}-b`);
  });
  await check('known package ID cannot make an unrelated physical code valid', async t => {
    await assert.rejects(t.scan({ packageId: t.parcelId, code: 'wrong-label' }), e => e.code === 'invalid-argument');
    assert.equal((await t.state()).missionId, t.oldId);
  });
  await check('deployed callable enforces authentication and disabled profiles', async t => {
    await assert.rejects(service.scanPackage.run({}, {}), e => e.code === 'unauthenticated');
    await db.collection('users').doc(t.driverId).update({ isDisabled: true });
    await assert.rejects(service.scanPackage.run({ driverId: t.driverId, packageId: t.parcelId, requestId: randomUUID(), source: 'driver-claim' }, context(t.driverId)), e => e.code === 'permission-denied');
  });
  console.log(`${number} scan business checks passed`);
  await db.terminate();
})().catch(e => { console.error(e); process.exitCode = 1; });
