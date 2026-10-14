if (!/^127\.0\.0\.1:8189$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local Firestore emulator required');
process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const req = createRequire(process.cwd() + '/functions/package.json');
require('../functions/lib/index.js');
const { commitDeliveryOutcomeHandler } = require('../functions/lib/commitStopOutcome.js');
const { publishDeliveryProofHandler } = require('../functions/lib/publishDeliveryProof.js');
const db = req('firebase-admin/firestore').getFirestore();
const prefix = 'evidence-' + randomUUID(), driver = prefix + '-driver';
const paths = [], created = path => { paths.push(path); return db.doc(path); };
const now = '2026-10-15T08:00:00Z', recordedAt = '2026-10-13T20:01:00Z';
const point = { address: '1 rue Fictive', postalCode: '97400', city: 'Saint-Denis', contactName: 'Pharmacie A' };
const deps = { db, now: () => new Date(now), requireActiveCaller: async ctx => ({ id: ctx.auth.uid, role: 'Chauffeur', firstName: 'Test' }) };
const ctx = id => ({ auth: { uid: id || driver } });
let sequence = 0, checks = 0;
async function fixture(count = 2) {
  const missionId = prefix + '-' + (++sequence), ids = Array.from({ length: count }, (_, i) => missionId + '-p' + i);
  await created(`missions/${missionId}`).set({ driverId: driver, date: '2026-10-14', status: 'En cours', stops: [
    { ...point, id: 'stop', type: 'DELIVERY', status: 'Arrivé', packageIds: ids, packageCount: count },
  ] });
  for (const [index, id] of ids.entries()) await created(`packages/${id}`).set({ ...point, clientId: 'sender-' + index,
    status: 'En livraison', missionId, stopId: 'stop', currentDriverId: driver, movements: [] });
  const data = { missionId, stopId: 'stop', recordedAt, stopPatch: { status: 'Terminé', completionTime: recordedAt },
    packageOutcomes: ids.map((id, index) => ({ packageId: id, status: index ? 'Échec' : 'Livré', failureReason: index ? 'Destinataire absent' : undefined,
      movement: { action: index ? 'FAILED' : 'DELIVERED', notes: index ? 'Absent' : 'Remis' } })) };
  paths.push(`proofs_of_delivery/${missionId}_stop`);
  const media = name => `https://firebasestorage.googleapis.com/v0/b/demo-fleet-production-audit.appspot.com/o/${encodeURIComponent(`pod/${missionId}/stop/session/${name}`)}?token=test`;
  const proof = { missionId, stopId: 'stop', driverId: driver, packageIds: [ids[0]], type: 'SUCCESS', timestamp: recordedAt,
    photoUrls: [media('photo.jpg')], signatureUrl: media('signature.png'), recipientName: 'Client', coordinates: { lat: -21, lng: 55 } };
  return { missionId, ids, data, proof, commit: (input = data, who) => commitDeliveryOutcomeHandler(input, ctx(who), deps),
    publish: (input = proof) => publishDeliveryProofHandler(input, ctx(), deps), read: async id => (await db.doc(`packages/${id}`).get()).data() };
}
async function check(name, fn) { await fn(); console.log('PASS', name); checks++; }
(async () => {
  await check('offline midnight visit retains immutable field time and actual server receipt', async () => {
    const f = await fixture(); await f.commit();
    const pkg = await f.read(f.ids[0]);
    assert.equal(pkg.movements[0].timestamp, recordedAt); assert.equal(pkg.movements[0].receivedAt, new Date(now).toISOString());
    assert.equal(pkg.deliveryAttempts[0].recordedAt, recordedAt); assert.equal(pkg.deliveryAttempts[0].receivedAt, new Date(now).toISOString());
    assert.deepEqual(pkg.deliveryAttempts[0].destination, point);
  });
  await check('parallel replays record each parcel and mission counter once', async () => {
    const f = await fixture(); await Promise.all([f.commit(), f.commit()]);
    assert.equal((await f.read(f.ids[0])).deliveryAttempts.length, 1);
    assert.equal((await db.doc(`missions/${f.missionId}`).get()).data().deliveredPackages, 1);
  });
  await check('another offline decision cannot overwrite a completed partial outcome', async () => {
    const f = await fixture(); await f.commit();
    const changed = structuredClone(f.data); changed.packageOutcomes[1].status = 'Livré';
    await assert.rejects(f.commit(changed), e => e.code === 'failed-precondition');
    assert.equal((await f.read(f.ids[1])).status, 'Échec');
  });
  await check('another driver and future field time are rejected', async () => {
    const f = await fixture();
    await assert.rejects(f.commit(f.data, 'other'), e => e.code === 'permission-denied');
    await assert.rejects(f.commit({ ...f.data, recordedAt: '2027-01-01T00:00:00Z' }), e => e.code === 'invalid-argument');
    assert.equal((await f.read(f.ids[0])).movements.length, 0);
  });
  await check('mixed recipients reject the complete transaction', async () => {
    const f = await fixture(); await db.doc(`packages/${f.ids[1]}`).update({ contactName: 'Autre client' });
    await assert.rejects(f.commit(), e => e.code === 'failed-precondition');
    assert.equal((await f.read(f.ids[0])).status, 'En livraison');
  });
  await check('partial proof publishes only local parcel IDs and no signature on failed parcels', async () => {
    const f = await fixture(10); await f.commit(); const result = await f.publish({ ...f.proof, destination: { ...point, address: 'Adresse falsifiée sur le téléphone' } });
    assert.equal(result.proof.timestamp, recordedAt); assert.equal(result.proof.receivedAt, new Date(now).toISOString());
    assert.deepEqual(result.proof.destination, point);
    const success = await f.read(f.ids[0]), failed = await f.read(f.ids[1]);
    assert.equal(success.pod.packageIds, undefined); assert.equal(failed.failurePod.packageIds, undefined);
    assert.equal(failed.failurePod.type, 'FAILURE'); assert.equal(failed.failurePod.signatureUrl, undefined);
    assert.equal(failed.failurePod.recipientName, undefined); assert.equal(failed.failureReason, 'Destinataire absent');
    assert.deepEqual(failed.failurePod.photoUrls, success.pod.photoUrls);
    assert.equal((await db.doc(`missions/${f.missionId}`).get()).data().stops[0].proofSyncPending, false);
    const replay = await f.publish(); assert.deepEqual(replay.proof, result.proof);
  });
  await check('proof cannot change field time or reference media from another visit', async () => {
    const f = await fixture(); await f.commit();
    await assert.rejects(f.publish({ ...f.proof, timestamp: now }), e => e.code === 'failed-precondition');
    await assert.rejects(f.publish({ ...f.proof, photoUrls: ['https://evil.test/photo.jpg'] }), e => e.code === 'failed-precondition');
    assert.equal((await f.read(f.ids[0])).pod, undefined);
  });
  await check('failed upload cannot attach proof after a reassignment or release guard', async () => {
    const f = await fixture(); await f.commit(); await db.doc(`packages/${f.ids[1]}`).update({ missionId: 'other' });
    await assert.rejects(f.publish(), e => e.code === 'failed-precondition');
    assert.equal((await f.read(f.ids[0])).pod, undefined);
    assert.equal((await db.doc(`missions/${f.missionId}`).get()).data().stops[0].proofSyncPending, true);
  });
  await check('redelivery appends to historical attempts without rewriting an earlier failure proof', async () => {
    const f = await fixture(1), historic = { id: 'old_stop', missionId: 'old', stopId: 'stop', driverId: driver, outcome: 'FAILURE', recordedAt: '2026-10-12T08:00:00Z', proof: { type: 'FAILURE' } };
    await db.doc(`packages/${f.ids[0]}`).update({ deliveryAttempts: [historic], failurePod: historic.proof });
    await f.commit(); await f.publish(); const pkg = await f.read(f.ids[0]);
    assert.equal(pkg.deliveryAttempts.length, 2); assert.deepEqual(pkg.deliveryAttempts[0], historic); assert.deepEqual(pkg.failurePod, historic.proof);
  });
  console.log(`${checks} delivery evidence checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(paths.map(path => db.doc(path).delete())); await db.terminate();
});
