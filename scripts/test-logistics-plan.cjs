if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8189') throw new Error('Local emulator required');
process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const db = req('firebase-admin/firestore').getFirestore();
const run = 'plan-' + crypto.randomUUID();
const actor = run + '-office', driver = run + '-driver', hub = run + '-hub';
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
const call = (name, data, uid = actor) => service[name].run(data, context(uid));
const read = async path => (await db.doc(path).get()).data();
const point = { contactName: 'Pharmacie A', address: '1 rue Test', city: 'Saint-Denis', postalCode: '97400', timeWindowStart: '08:00', timeWindowEnd: '12:00', floor: 0, serviceTime: 10 };
let passed = 0;
const check = async (label, test) => { await test(); passed++; console.log('PASS', label); };
async function seed(label, count = 2) {
  const missionId = run + '-' + label, ids = Array.from({ length: count }, (_, index) => missionId + '-p' + index);
  await Promise.all(ids.map(id => db.doc('packages/' + id).set({ ...point, externalId: id, status: 'Trié', currentHubId: hub, currentDriverId: driver, missionId, stopId: 's', movements: [{ action: 'IMPORTED' }], estimatedDeliveryAt: 'old' })));
  await db.doc('missions/' + missionId).set({ status: 'Dispatché', driverId: driver, hubId: hub, date: '2026-10-14', totalDistance: 20, estimatedDuration: 70, totalPackages: count, deliveredPackages: 1, stops: [
    { ...point, id: 's', type: 'DELIVERY', status: 'En attente', sequence: 1, packageIds: ids, packageCount: count, serviceTime: count * 10, estimatedArrival: 'old', coordinates: { lat: -20.9, lng: 55.5 } },
    { ...point, id: 'done', type: 'DELIVERY', status: 'Terminé', sequence: 2, packageIds: [], packageCount: 0, proofSyncPending: true, completionTime: 'historical', estimatedArrival: 'historical' },
  ] });
  return { missionId, ids };
}
(async () => {
  await Promise.all([db.doc('users/' + actor).set({ role: 'Admin', status: 'active' }), db.doc('users/' + driver).set({ role: 'Chauffeur', status: 'active' }), db.doc('hubs/' + hub).set({ name: 'Hub fictif', isActive: true })]);
  await check('stop correction atomically propagates address, splits visit duration and notifies driver', async () => {
    const { missionId, ids } = await seed('stop');
    await call('correctDeliveryPlan', { mode: 'STOP', missionId, stopId: 's', fields: { address: '2 rue Corrigée', serviceTime: 30 } });
    const mission = await read('missions/' + missionId);
    for (const id of ids) { const p = await read('packages/' + id); assert.equal(p.address, '2 rue Corrigée'); assert.equal(p.serviceTime, 15); assert.equal(p.coordinates, null); assert.equal(p.estimatedDeliveryAt, null); assert.equal(p.movements.length, 2); }
    assert.equal(mission.stops[0].address, '2 rue Corrigée'); assert.equal(mission.stops[0].coordinates, undefined); assert.equal(mission.stops[0].estimatedArrival, undefined);
    assert.equal(mission.stops[1].completionTime, 'historical'); assert.equal(mission.stops[1].proofSyncPending, true); assert.equal(mission.deliveredPackages, 1); assert.equal(mission.totalDistance, null);
    assert.ok((await db.collection('notifications').where('recipientId', '==', driver).get()).docs.some(d => d.data().metadata.missionId === missionId));
  });
  await check('one corrected parcel becomes a separate stop without redirecting neighbours', async () => {
    const { missionId, ids } = await seed('split');
    await call('correctDeliveryPlan', { packageId: ids[0], fields: { address: '3 rue Individuelle', contactName: 'Cabinet B' } });
    const mission = await read('missions/' + missionId), p = await read('packages/' + ids[0]), neighbour = await read('packages/' + ids[1]);
    assert.equal(mission.stops.length, 3); assert.equal(mission.stops.find(s => s.id === p.stopId).address, p.address);
    assert.equal(neighbour.address, point.address); assert.equal(neighbour.stopId, 's'); assert.deepEqual(mission.stops[0].packageIds, [ids[1]]);
  });
  await check('single-parcel correction updates its stop and compatible windows remain one visit', async () => {
    const { missionId, ids } = await seed('compatible');
    await call('correctDeliveryPlan', { packageId: ids[0], fields: { timeWindowStart: '09:00', timeWindowEnd: '11:00' } });
    assert.equal((await read('missions/' + missionId)).stops[0].timeWindowStart, '09:00');
    await call('correctDeliveryPlan', { packageId: ids[0], fields: { timeWindowStart: '14:00', timeWindowEnd: '15:00' } });
    assert.equal((await read('missions/' + missionId)).stops.length, 3);
    const single = await seed('single', 1);
    await call('correctDeliveryPlan', { packageId: single.ids[0], fields: { address: '4 rue Seule' } });
    assert.equal((await read('missions/' + single.missionId)).stops[0].address, '4 rue Seule');
  });
  await check('started, arrived, stale, malformed and terminal corrections are refused atomically', async () => {
    const { missionId, ids } = await seed('guards');
    for (const fields of [{ status: 'Livré' }, { externalId: 'changed' }, { timeWindowEnd: '07:00' }, { address: '' }, { requestedDeliveryDate: '2026-02-30' }]) await assert.rejects(call('correctDeliveryPlan', { packageId: ids[0], fields }));
    await assert.rejects(call('correctDeliveryPlan', { packageId: ids[0], fields: { address: 'wrong' } }, driver), e => e.code === 'permission-denied');
    await db.doc('missions/' + missionId).update({ status: 'En cours' });
    await assert.rejects(call('correctDeliveryPlan', { packageId: ids[0], fields: { address: 'wrong' } }));
    await db.doc('missions/' + missionId).update({ status: 'Dispatché' });
    await db.doc('packages/' + ids[1]).update({ missionId: 'transferred' });
    await assert.rejects(call('correctDeliveryPlan', { packageId: ids[0], fields: { address: 'wrong' } }));
    assert.equal((await read('packages/' + ids[0])).address, point.address);
  });
  await check('a collective edit cannot hide an existing mixed-recipient stop', async () => {
    const { missionId, ids } = await seed('mixed');
    await db.doc('packages/' + ids[1]).update({ contactName: 'Autre pharmacie' });
    await assert.rejects(call('correctDeliveryPlan', { mode: 'STOP', missionId, stopId: 's', fields: { contactName: 'Pharmacie A', address: '2 rue Corrigée' } }));
    assert.equal((await read('packages/' + ids[0])).address, point.address);
    assert.equal((await read('packages/' + ids[1])).contactName, 'Autre pharmacie');
  });
  await check('a valid one-sided window remains editable without imposing a second bound', async () => {
    const { missionId, ids } = await seed('one-sided', 1);
    await db.doc('packages/' + ids[0]).update({ timeWindowEnd: null });
    await call('correctDeliveryPlan', { packageId: ids[0], fields: { address: '5 rue Horaire' } });
    assert.equal((await read('packages/' + ids[0])).timeWindowStart, '08:00');
    assert.equal((await read('missions/' + missionId)).stops[0].address, '5 rue Horaire');
  });
  await check('manual sorting cannot invent a pickup, delivery, return or detach assignments', async () => {
    const id = run + '-sorting';
    await db.doc('packages/' + id).set({ ...point, status: 'Au hub', currentHubId: hub, movements: [] });
    await call('setParcelSorting', { packageId: id, status: 'Trié' });
    assert.equal((await read('packages/' + id)).status, 'Trié');
    for (const status of ['En attente', 'Collecté', 'Livré', 'Échec', 'Retourné']) await assert.rejects(call('setParcelSorting', { packageId: id, status }));
    await db.doc('packages/' + id).update({ missionId: 'assigned' });
    await assert.rejects(call('setParcelSorting', { packageId: id, status: 'Au hub' }));
  });
  console.log(`${passed} logistics planning scenarios passed`);
  await req('firebase-admin/app').deleteApp(req('firebase-admin/app').getApp());
})().catch(error => { console.error(error); process.exit(1); });
