process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const db = req('firebase-admin/firestore').getFirestore();
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
const missionId = 'lifecycle-tour';
const ref = db.collection('missions').doc(missionId);
const parcelRef = db.collection('packages').doc('lifecycle-p');
const proofRef = db.collection('proofs_of_delivery').doc(`${missionId}_stop`);
let passed = 0;
const check = async (name, run) => { await seed(); await run(); passed++; console.log('PASS', name); };
async function seed() {
  await db.collection('users').doc('lifecycle-driver').set({ id: 'lifecycle-driver', role: 'Chauffeur' });
  await db.collection('users').doc('lifecycle-other').set({ id: 'lifecycle-other', role: 'Chauffeur' });
  await db.collection('users').doc('lifecycle-admin').set({ id: 'lifecycle-admin', role: 'Admin' });
  await ref.set({ driverId: 'lifecycle-driver', status: 'En cours', totalPackages: 1,
    stops: [{ id: 'stop', type: 'DELIVERY', status: 'Terminé', packageIds: ['lifecycle-p'], proofSyncPending: false }] });
  await parcelRef.set({ status: 'Livré', missionId, currentDriverId: 'lifecycle-driver' });
  await proofRef.set({ missionId, stopId: 'stop', driverId: 'lifecycle-driver', type: 'SUCCESS',
    packageIds: ['lifecycle-p'], photoUrls: ['https://example.invalid/photo'], signatureUrl: 'https://example.invalid/signature',
    recipientName: 'Destinataire fictif', coordinates: { lat: -20.9, lng: 55.5 } });
}
const close = uid => service.finishMission.run({ missionId }, context(uid || 'lifecycle-driver'));
const refused = async () => {
  await assert.rejects(close(), e => e.code === 'failed-precondition');
  assert.equal((await ref.get()).data().status, 'En cours');
};
(async () => {
  await check('completed delivery closes once and replay preserves completion timestamp', async () => {
    await close(); const before = (await ref.get()).data();
    assert.equal(before.status, 'Terminé');
    assert.equal((await close()).alreadyCompleted, true);
    assert.equal((await ref.get()).data().completedAt, before.completedAt);
  });
  await check('another driver cannot close the tour', async () => {
    await assert.rejects(close('lifecycle-other'), e => e.code === 'permission-denied');
  });
  await check('pending stop prevents driver and office closure without changing parcels', async () => {
    const m = (await ref.get()).data(); m.stops[0].status = 'Arrivé'; await ref.set(m);
    await refused(); await assert.rejects(close('lifecycle-admin'), e => e.code === 'failed-precondition');
    assert.equal((await parcelRef.get()).data().status, 'Livré');
  });
  await check('proof upload on another device prevents closure', async () => {
    const m = (await ref.get()).data(); m.stops[0].proofSyncPending = true; await ref.set(m); await refused();
  });
  await check('legacy completed stop without a proof cannot masquerade as synchronized', async () => {
    await proofRef.delete(); await refused();
  });
  await check('terminal stop cannot hide an in-delivery parcel', async () => {
    await parcelRef.update({ status: 'En livraison' }); await refused();
  });
  await check('unknown stop type cannot bypass parcel and proof checks', async () => {
    const m = (await ref.get()).data(); m.stops[0].type = 'UNRECOGNIZED'; await ref.set(m);
    await parcelRef.update({ status: 'En livraison' }); await refused();
  });
  await check('duplicate stop identifiers cannot share an unrelated proof', async () => {
    const m = (await ref.get()).data(); m.stops.push({...m.stops[0]}); await ref.set(m); await refused();
  });
  await check('a string cannot masquerade as the proof package list', async () => {
    await proofRef.update({ packageIds: 'prefix-lifecycle-p-suffix' }); await refused();
  });
  await check('a pending hub return must be completed before closing', async () => {
    const m = (await ref.get()).data(); m.stops[0].status = 'Échec'; await ref.set(m);
    await parcelRef.update({status: 'À retourner'});
    await proofRef.update({type: 'FAILURE'}); await refused();
  });
  await check('failure with photo and explicitly unavailable GPS can close', async () => {
    const m = (await ref.get()).data(); m.stops[0].status = 'Échec'; await ref.set(m);
    await parcelRef.update({ status: 'Échec' });
    await proofRef.set({ missionId, stopId: 'stop', driverId: 'lifecycle-driver', type: 'FAILURE',
      packageIds: ['lifecycle-p'], photoUrls: ['https://example.invalid/failure'], coordinates: null, locationStatus: 'unavailable' });
    await close(); assert.equal((await ref.get()).data().status, 'Terminé');
  });
  await check('partial delivery closes without converting the failed parcel into delivered', async () => {
    const m = (await ref.get()).data(); m.stops[0].packageIds.push('lifecycle-missing'); await ref.set(m);
    const missing = db.collection('packages').doc('lifecycle-missing');
    await missing.set({ status: 'Échec', missionId, currentDriverId: 'lifecycle-driver' });
    await close(); assert.equal((await missing.get()).data().status, 'Échec');
  });
  await check('missing pickup parcels remain missing after valid manifest and closure', async () => {
    const m = (await ref.get()).data(); m.stops[0].type = 'PICKUP'; await ref.set(m);
    await parcelRef.update({ status: 'En attente' });
    await db.collection('pickups').doc(`${missionId}_stop`).set({ missionId, stopId: 'stop', driverId: 'lifecycle-driver',
      scannedPackageIds: [], missingPackageIds: ['lifecycle-p'] });
    await close(); assert.equal((await parcelRef.get()).data().status, 'En attente');
  });
  console.log(`${passed} mission lifecycle checks passed`);
  await db.terminate();
})().catch(e => { console.error(e); process.exitCode = 1; });
