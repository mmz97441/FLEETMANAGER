process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const { scanBusinessDay } = require('../functions/lib/scanPackage.js');
const db = req('firebase-admin/firestore').getFirestore();
const prefix = 'delivery-group-' + randomUUID(), driver = prefix + '-driver';
const ctx = uid => ({ auth: { uid, token: { auth_time: 200 } } });
const point = { address: '28 rue Joseph Bédier', city: 'Saint-Denis', postalCode: '97400', contactName: 'Pharmacie fictive' };
const read = async (col, id) => (await db.collection(col).doc(id).get()).data();
let count = 0, sequence = 0;
const check = async (name, task) => { await task(); console.log('PASS', name); count++; };
async function seed(parcelCount = 3) {
  const missionId = prefix + '-' + (++sequence), ids = Array.from({ length: parcelCount }, (_, n) => missionId + '-p' + n);
  const stops = ids.map((id, i) => ({ ...point, id: 's' + i, type: 'DELIVERY', status: 'En attente', sequence: i + 1, packageIds: [id], packageCount: 1, serviceTime: 5 }));
  await db.collection('missions').doc(missionId).set({ driverId: driver, date: scanBusinessDay(new Date()), status: 'En cours', type: 'Livraison', stops, totalPackages: parcelCount });
  await Promise.all(ids.map((id, i) => db.collection('packages').doc(id).set({ ...point, externalId: 'BR' + sequence + i, orderNumber: 'ORDER' + i,
    status: 'En livraison', currentDriverId: driver, missionId, stopId: 's' + i, movements: [] })));
  const prepare = (options = {}, who = driver) => service.prepareDeliveryStop.run({ clientVersion: '4.37.0', missionId, stopId: 's0', ...options }, ctx(who));
  return { missionId, ids, stops, prepare };
}
(async () => {
  await db.collection('users').doc(driver).set({ role: 'Chauffeur', firstName: 'Test', lastName: 'Fictif' });
  await db.collection('users').doc(prefix + '-other').set({ role: 'Chauffeur' });
  await db.collection('users').doc(prefix + '-client').set({ role: 'Client' });
  await check('three BR parcels become one arrived stop with stable selection and no delivery recorded', async () => {
    const { prepare, ids, missionId } = await seed();
    const result = await prepare({ stopId: 's1', arrive: true });
    assert.equal(result.mission.stops.length, 1); assert.equal(result.mission.stops[0].id, 's1');
    assert.equal(result.mission.stops[0].status, 'Arrivé'); assert.deepEqual(new Set(result.mission.stops[0].packageIds), new Set(ids));
    assert.equal(result.mission.totalPackages, 3);
    for (const id of ids) { const p = await read('packages', id); assert.equal(p.stopId, 's1'); assert.equal(p.status, 'En livraison'); assert.equal(p.pod, undefined); }
    const retry = await prepare({ stopId: 's1', arrive: true }); assert.equal(retry.addedCount, 0);
    assert.equal((await db.collection('activity_logs').where('targetId', '==', missionId).get()).size, 1);
    for (const id of ids) {
      const receipt = await service.scanPackage.run({ clientVersion: '4.37.0', requestId: randomUUID(), source: 'driver-delivery', packageId: id, targetMissionId: missionId, stopId: 's1' }, ctx(driver));
      assert.equal(receipt.accepted, true);
    }
  });
  await check('parallel preparation keeps one stop and one audit record', async () => {
    const { prepare, missionId } = await seed();
    await Promise.all([prepare({ arrive: true }), prepare({ arrive: true })]);
    assert.equal((await read('missions', missionId)).stops.length, 1);
    assert.equal((await db.collection('activity_logs').where('targetId', '==', missionId).get()).size, 1);
  });
  await check('different senders and reference formats share the same recipient stop', async () => {
    const { prepare, ids, missionId } = await seed();
    const codes = ['BR-MIXED-SENDER', 'EXP-MIXED/0042', '000012349876543210'];
    for (let i = 0; i < ids.length; i++) await db.collection('packages').doc(ids[i]).update({ clientId: 'sender-' + i, clientName: 'Expéditeur ' + i, externalId: codes[i] });
    const { mission } = await prepare({ arrive: true });
    assert.equal(mission.stops.length, 1); assert.equal(mission.stops[0].packageCount, 3);
    for (let i = 0; i < ids.length; i++) {
      const receipt = await service.scanPackage.run({ clientVersion: '4.37.0', requestId: randomUUID(), source: 'driver-delivery', code: codes[i], packageId: ids[i], targetMissionId: missionId, stopId: 's0' }, ctx(driver));
      assert.equal(receipt.accepted, true); assert.equal(receipt.packageId, ids[i]);
    }
  });
  for (const parcelCount of [1, 10]) await check(`${parcelCount} parcels for one recipient are prepared and individually verified`, async () => {
    const { prepare, ids, missionId } = await seed(parcelCount);
    const { mission } = await prepare({ arrive: true });
    assert.equal(mission.stops.length, 1);
    assert.equal(mission.stops[0].packageCount, parcelCount);
    assert.deepEqual(mission.stops[0].packageIds, ids);
    for (const packageId of ids) {
      const receipt = await service.scanPackage.run({ clientVersion: '4.37.0', requestId: randomUUID(), source: 'driver-delivery', packageId, targetMissionId: missionId, stopId: 's0' }, ctx(driver));
      assert.equal(receipt.accepted, true);
    }
  });
  await check('a duplicate parcel left in two pending stops is counted only once and has one owner', async () => {
    const { prepare, missionId, ids, stops } = await seed();
    stops[0].packageIds.push(ids[1]); stops[0].packageCount = 2;
    await db.collection('missions').doc(missionId).update({ stops, totalPackages: 4 });
    const result = await prepare(); assert.equal(result.mission.totalPackages, 3);
    assert.equal((await read('packages', ids[1])).stopId, 's0');
  });
  await check('a different recipient at the same address is not grouped', async () => {
    const { prepare, missionId, ids, stops } = await seed();
    stops[2].contactName = 'Autre pharmacie'; await db.collection('missions').doc(missionId).update({ stops });
    await db.collection('packages').doc(ids[2]).update({ contactName: 'Autre pharmacie' });
    const result = await prepare(); assert.equal(result.mission.stops.length, 2);
    assert.deepEqual(result.mission.stops.find(s => s.id === 's0').packageIds, ids.slice(0, 2));
  });
  await check('an already started delivery stays separate', async () => {
    const { prepare, missionId, stops } = await seed(); stops[2].status = 'Arrivé';
    await db.collection('missions').doc(missionId).update({ stops });
    assert.equal((await prepare()).mission.stops.length, 2);
  });
  await check('planned stop windows can be narrower than individual parcel windows', async () => {
    const { prepare, missionId, stops, ids } = await seed();
    for (const stop of stops) { stop.timeWindowStart = '09:00'; stop.timeWindowEnd = '12:00'; }
    await db.collection('missions').doc(missionId).update({ stops });
    await db.collection('packages').doc(ids[1]).update({ timeWindowStart: '08:00', timeWindowEnd: '17:00' });
    assert.equal((await prepare()).mission.stops.length, 1);
  });
  await check('different scheduled visits remain separate even during explicit attachment', async () => {
    const { prepare, missionId, stops, ids } = await seed();
    stops[2].timeWindowStart = '16:00'; stops[2].timeWindowEnd = '17:00';
    await db.collection('missions').doc(missionId).update({ stops });
    assert.equal((await prepare()).mission.stops.length, 2);
    await assert.rejects(prepare({ packageIds: [ids[2]] }), e => e.code === 'failed-precondition');
  });
  await check('proof or changed package assignment prevents every write atomically', async () => {
    for (const scenario of ['proof', 'driver', 'delivered', 'address']) {
      const { prepare, missionId, ids } = await seed(); const before = await read('missions', missionId);
      if (scenario === 'proof') await db.collection('proofs_of_delivery').doc(missionId + '_s1').set({ type: 'SUCCESS', packageIds: [ids[1]] });
      else await db.collection('packages').doc(ids[1]).update(scenario === 'driver' ? { currentDriverId: prefix + '-other' } : scenario === 'delivered' ? { status: 'Livré' } : { address: 'Autre adresse' });
      await assert.rejects(prepare(), e => e.code === 'failed-precondition');
      assert.deepEqual(await read('missions', missionId), before);
    }
  });
  await check('other drivers, clients and old tours cannot prepare this delivery', async () => {
    const { prepare, missionId } = await seed();
    await assert.rejects(prepare({}, prefix + '-other'), e => e.code === 'permission-denied');
    await assert.rejects(prepare({}, prefix + '-client'), e => e.code === 'permission-denied');
    await db.collection('missions').doc(missionId).update({ date: '2000-01-01' });
    await assert.rejects(prepare(), e => e.code === 'failed-precondition');
  });
  await check('explicit attachment rejects a started source and cannot reopen a proof awaiting sync', async () => {
    const { prepare, missionId, stops, ids } = await seed(); stops[1].status = 'Arrivé';
    await db.collection('missions').doc(missionId).update({ stops });
    await assert.rejects(prepare({ packageIds: [ids[1]] }), e => e.code === 'failed-precondition');
    stops[0].proofSyncPending = true; await db.collection('missions').doc(missionId).update({ stops });
    await assert.rejects(prepare(), e => e.code === 'failed-precondition');
  });
  console.log(`${count} grouped delivery checks passed`); await db.terminate();
})().catch(error => { console.error(error); process.exitCode = 1; });
