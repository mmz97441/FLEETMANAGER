// Synthetic data only; this script never connects to production.
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local Firestore emulator required.');
process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const { scanBusinessDay } = require('../functions/lib/scanPackage.js');
const db = req('firebase-admin/firestore').getFirestore();
const prefix = 'app-update-' + randomUUID(), paths = new Set(), actors = new Set();
const hash = value => createHash('sha256').update(value).digest('hex');
const ref = path => { paths.add(path); return db.doc(path); };
const context = uid => ({ auth: { uid, token: { auth_time: 1000 } } });
const point = { contactName: 'Pharmacie fictive', address: '1 rue Fictive', postalCode: '97400', city: 'Saint-Denis', floor: 0 };
const updateRequired = error => error.code === 'failed-precondition' && error.details?.reason === 'app-update-required' && error.details.minimumVersion === '4.37.0';
let sequence = 0, checks = 0;
async function user(id, role) { actors.add(id); await ref('users/' + id).set({ role, firstName: 'Fictif', lastName: 'Test', companyName: 'Expéditeur fictif' }); }
async function fixture(role = 'Chauffeur') {
  const id = prefix + '-' + (++sequence), driver = id + '-driver', client = id + '-client', office = id + '-office';
  const missionId = id + '-mission', packageId = id + '-parcel', code = id.toUpperCase();
  await user(driver, role); await user(client, 'Client'); await user(office, 'Admin');
  const packageRef = ref('packages/' + packageId), missionRef = ref('missions/' + missionId);
  await packageRef.set({ ...point, externalId: code, status: 'En livraison', clientId: client, missionId, stopId: 'stop', currentDriverId: driver, movements: [] });
  await missionRef.set({ date: scanBusinessDay(new Date()), driverId: driver, status: 'En cours', type: 'Livraison', totalPackages: 1,
    stops: [{ ...point, id: 'stop', sequence: 1, type: 'DELIVERY', status: 'En attente', packageIds: [packageId], packageCount: 1, serviceTime: 5 }] });
  const adhocCode = 'MANUAL-' + code, adhocId = 'adhoc-' + hash(`adhoc/${client}/${adhocCode}`);
  const adhocRef = ref('packages/' + adhocId), referenceRef = ref('parcel_reference_index/' + hash(adhocCode));
  return { id, driver, office, client, missionId, packageId, packageRef, missionRef, adhocRef, referenceRef,
    inputs: {
      scanPackage: { driverId: driver, source: 'driver-delivery', code, targetMissionId: missionId, stopId: 'stop' },
      prepareDeliveryStop: { missionId, stopId: 'stop', arrive: true },
      createAdHocPackage: { ...point, clientId: client, code: adhocCode, verifiedMissing: true },
    },
  };
}
function payload(fixture, endpoint, version) {
  const requestId = randomUUID();
  ref('scan_requests/' + hash(`${fixture.driver}/${requestId}`));
  return { ...fixture.inputs[endpoint], requestId, ...(version === undefined ? {} : { clientVersion: version }) };
}
const endpoints = ['scanPackage', 'prepareDeliveryStop', 'createAdHocPackage'];
async function snapshot(fixture) {
  const docs = await Promise.all([fixture.packageRef, fixture.missionRef, fixture.adhocRef, fixture.referenceRef, db.doc('users/' + fixture.driver)].map(ref => ref.get()));
  const audit = await db.collection('activity_logs').where('userId', '==', fixture.driver).get();
  return { docs: docs.map(doc => doc.data()), audit: audit.size };
}
async function check(name, task) { await task(); checks++; console.log('PASS', name); }

(async () => {
  for (const role of ['Chauffeur', '  ChAuFfEuSe  ']) {
    const fixtureData = await fixture(role);
    for (const endpoint of endpoints) await check(`${role.trim()}: ${endpoint} refuses absent, malformed and old versions without writes`, async () => {
      const before = await snapshot(fixtureData);
      for (const version of [undefined, null, '', 4.37, '4.37', '4.37.0-beta', '04.37.0', '4.9.99', '4.36.99', '3.100.0', '99999999999999999.0.0']) {
        const input = payload(fixtureData, endpoint, version);
        await assert.rejects(service[endpoint].run(input, context(fixtureData.driver)), updateRequired);
        assert.equal((await db.doc('scan_requests/' + hash(`${fixtureData.driver}/${input.requestId}`)).get()).exists, false);
      }
      assert.deepEqual(await snapshot(fixtureData), before);
    });
  }

  await check('authentication and disabled profiles are rejected before the app version gate', async () => {
    const f = await fixture();
    for (const endpoint of endpoints) {
      const input = payload(f, endpoint);
      await assert.rejects(service[endpoint].run(input, {}), error => error.code === 'unauthenticated' && !error.details?.reason);
    }
    await db.doc('users/' + f.driver).update({ isDisabled: true });
    for (const endpoint of endpoints)
      await assert.rejects(service[endpoint].run(payload(f, endpoint), context(f.driver)), error => error.code === 'permission-denied' && !error.details?.reason);
  });

  for (const role of ['Chauffeur', 'Chauffeuse']) await check(`${role}: minimum and future versions reach the real business operations`, async () => {
    for (const version of ['4.37.0', '4.100.0', '5.0.0']) {
      const f = await fixture(role);
      const scanned = await service.scanPackage.run(payload(f, 'scanPackage', version), context(f.driver));
      assert.equal(scanned.accepted, true); assert.equal(scanned.outcome, 'verified');
      assert.equal((await f.packageRef.get()).data().lastVerifiedBy, f.driver);
      const prepared = await service.prepareDeliveryStop.run(payload(f, 'prepareDeliveryStop', version), context(f.driver));
      assert.equal(prepared.mission.stops[0].status, 'Arrivé');
      const created = await service.createAdHocPackage.run(payload(f, 'createAdHocPackage', version), context(f.driver));
      assert.equal(created.package.id, f.adhocRef.id); assert.equal((await f.adhocRef.get()).exists, true);
      assert.equal((await f.referenceRef.get()).data().packageId, f.adhocRef.id);
    }
  });

  await check('office calls are not blocked by the driver version floor and retain their existing permissions', async () => {
    const f = await fixture(), input = payload(f, 'scanPackage');
    ref('scan_requests/' + hash(`${f.office}/${input.requestId}`));
    assert.equal((await service.scanPackage.run(input, context(f.office))).accepted, true);
    for (const endpoint of ['prepareDeliveryStop', 'createAdHocPackage'])
      await assert.rejects(service[endpoint].run(payload(f, endpoint), context(f.office)), error => error.code === 'permission-denied' && error.details?.reason !== 'app-update-required');
  });

  await check('already captured delivery outcome and proof publish without clientVersion and replay once', async () => {
    const f = await fixture('Chauffeuse'), recordedAt = new Date().toISOString();
    const outcome = { missionId: f.missionId, stopId: 'stop', recordedAt, stopPatch: { status: 'Terminé', completionTime: recordedAt },
      packageOutcomes: [{ packageId: f.packageId, status: 'Livré', movement: { action: 'DELIVERED', notes: 'Preuve déjà capturée hors ligne' } }] };
    assert.equal((await service.commitDeliveryOutcome.run(outcome, context(f.driver))).allDone, true);
    const media = name => `https://firebasestorage.googleapis.com/v0/b/${process.env.GCLOUD_PROJECT}.appspot.com/o/` + encodeURIComponent(`pod/${f.missionId}/stop/${name}`) + '?alt=media';
    const proof = { missionId: f.missionId, stopId: 'stop', packageIds: [f.packageId], type: 'SUCCESS', timestamp: recordedAt,
      photoUrls: [media('photo.jpg')], signatureUrl: media('signature.png'), recipientName: 'Destinataire fictif', coordinates: { lat: -20.9, lng: 55.5 } };
    const proofRef = ref(`proofs_of_delivery/${f.missionId}_stop`);
    const first = await service.publishDeliveryProof.run(proof, context(f.driver));
    const replay = await service.publishDeliveryProof.run(proof, context(f.driver));
    assert.deepEqual(replay.proof, first.proof); assert.equal((await proofRef.get()).exists, true);
    assert.equal((await f.packageRef.get()).data().deliveryAttempts.length, 1);
    assert.equal((await f.packageRef.get()).data().pod.timestamp, recordedAt);
    assert.equal((await f.missionRef.get()).data().stops[0].proofSyncPending, false);
  });
  console.log(`${checks} mandatory app update checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try {
    for (const actor of actors) {
      const audit = await db.collection('activity_logs').where('userId', '==', actor).get();
      for (const doc of audit.docs) paths.add(doc.ref.path);
    }
    const remaining = [...paths];
    for (let offset = 0; offset < remaining.length; offset += 400) {
      const batch = db.batch(); remaining.slice(offset, offset + 400).forEach(path => batch.delete(db.doc(path))); await batch.commit();
    }
  } finally { await db.terminate(); }
});
