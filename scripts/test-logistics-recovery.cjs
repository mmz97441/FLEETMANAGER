process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const db = req('firebase-admin/firestore').getFirestore();
const { replanPickupHandler } = require('../functions/lib/finalizePickup.js');
const { receiveTransferredPackageAtHubHandler } = require('../functions/lib/hubReception.js');
const prefix = 'logistics-recovery-' + Date.now();
const driver = prefix + '-driver', other = prefix + '-other', manager = prefix + '-manager', hub = prefix + '-hub', hub2 = prefix + '-hub2';
const proofUrl = id => 'https://firebasestorage.googleapis.com/v0/b/demo-fleet-production-audit.appspot.com/o/' + encodeURIComponent(`pod/returns/${id}/photo.jpg`) + '?alt=media';
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
const deps = { db, requireActiveCaller: async c => ({ ...(await db.collection('users').doc(c.auth.uid).get()).data(), id: c.auth.uid }), isAdminCaller: role => role === 'Admin' };
let passed = 0, seq = 0;
const check = async (name, run) => { await run(); passed++; console.log('PASS', name); };
const parcel = id => db.collection('packages').doc(id);
const missionRef = id => db.collection('missions').doc(id);
async function seed(status = 'Échec') {
  const id = `${prefix}-p${++seq}`, missionId = `${id}-mission`;
  await parcel(id).set({ status, missionId, stopId: 'stop', currentDriverId: driver, externalId: id.toUpperCase(),
    movements: [{ action: 'FAILED', timestamp: '2026-10-01T08:00:00Z' }], failureReason: 'Destinataire absent',
    deliveryAttempts: [{ id: 'old-attempt', outcome: 'FAILURE' }], failurePod: { photoUrls: ['https://example.invalid/failure'] } });
  await missionRef(missionId).set({ driverId: driver, date: '2026-10-01', status: 'En cours', failedPackages: 1, totalPackages: 1,
    stops: [{ id: 'stop', type: 'DELIVERY', status: 'Échec', packageIds: [id], packageCount: 1 }] });
  return { id, missionId };
}
function returnData(p, extra = {}) { return { packageId: p.id, expectedMissionId: p.missionId, requestId: `${p.id}-return`,
  extra: { returnProof: { hubId: hub, timestamp: '2026-10-01T09:00:00Z', photoUrls: [proofUrl(p.id)], coordinates: null } }, ...extra }; }
function decision(p, extra = {}) { return { packageId: p.id, requestId: `${p.id}-decision`, decision: 'REDELIVER', notes: 'Destinataire disponible demain', ...extra }; }
const ret = (p, payload = {}, uid = driver) => service.returnPackage.run(returnData(p, payload), context(uid));
const resolve = (p, payload = {}, uid = manager) => service.resolveReturnedPackage.run(decision(p, payload), context(uid));
async function pickupSeed() {
  const a = await seed('En attente'), b = await seed('En attente');
  await parcel(b.id).update({ missionId: a.missionId });
  await missionRef(a.missionId).set({ driverId: driver, status: 'En cours', clientId: 'sender', date: '2026-10-01',
    stops: [{ id: 'stop', type: 'PICKUP', status: 'Arrivé', packageIds: [a.id, b.id], packageCount: 2,
      contactName: 'Expéditeur fictif', address: '1 rue Collecte', postalCode: '97400', city: 'Saint Denis' }] });
  return { ...a, missing: b.id, data: { missionId: a.missionId, stopId: 'stop', driverId: driver,
    expectedPackageIds: [a.id, b.id], scannedPackageIds: [a.id], missingPackageIds: [b.id], recordedAt: '2026-10-01T07:00:00Z' } };
}
(async () => {
  await Promise.all([db.collection('users').doc(driver).set({ role: 'Chauffeur', status: 'active' }), db.collection('users').doc(other).set({ role: 'Chauffeur' }),
    db.collection('users').doc(manager).set({ role: 'Admin' }), db.collection('hubs').doc(hub).set({ isActive: true, name: 'Dépôt A', zone: 'Nord' }),
    db.collection('hubs').doc(hub2).set({ isActive: true, name: 'Dépôt B', zone: 'Sud' })]);
  await check('physical return retains attempt and proof, clears assignment and waits for office decision', async () => {
    const p = await seed(); await ret(p); const saved = (await parcel(p.id).get()).data();
    assert.equal(saved.status, 'Au hub'); assert.equal(saved.returnDisposition, 'AWAITING_DECISION'); assert.equal(saved.currentHubId, hub);
    for (const key of ['missionId', 'stopId', 'currentDriverId', 'currentVehicleId', 'liveDriver', 'estimatedDeliveryAt']) assert.equal(saved[key], null);
    assert.equal(saved.deliveryAttempts.length, 1); assert.ok(saved.failurePod); assert.equal(saved.returnProofs.length, 1);
    assert.equal(saved.returnProof.timestamp, '2026-10-01T09:00:00Z'); assert.ok(saved.returnProof.receivedAt);
    assert.deepEqual((await missionRef(p.missionId).get()).data().stops[0].packageIds, []);
    assert.equal((await missionRef(p.missionId).get()).data().failedPackages, 1);
  });
  await check('lost acknowledgement retry is idempotent after operational assignment was cleared', async () => {
    const p = await seed(); const results = await Promise.all([ret(p), ret(p)]); assert.equal(results.filter(r => r.alreadyReceived).length, 1);
    assert.equal((await parcel(p.id).get()).data().returnProofs.length, 1);
    await resolve(p); await ret(p); assert.equal((await parcel(p.id).get()).data().returnDisposition, 'REDELIVERY_READY');
  });
  await check('another driver cannot return a parcel or replay its receipt', async () => {
    const p = await seed(); await assert.rejects(ret(p, {}, other), e => e.code === 'permission-denied');
    await ret(p); await assert.rejects(ret(p, {}, other), e => e.code === 'permission-denied');
  });
  await check('missing hub and inactive hub are rejected without parcel mutation', async () => {
    const p = await seed(); await assert.rejects(ret(p, { extra: { returnProof: { photoUrls: [proofUrl(p.id)] } } }), e => e.code === 'invalid-argument');
    await assert.rejects(ret(p, { extra: { returnProof: { hubId: 'absent-hub', photoUrls: [proofUrl(p.id)] } } }), e => e.code === 'failed-precondition');
    assert.equal((await parcel(p.id).get()).data().status, 'Échec');
  });
  await check('proof pending on original stop blocks return and preserves assignment', async () => {
    const p = await seed(), m = (await missionRef(p.missionId).get()).data(); m.stops[0].proofSyncPending = true; await missionRef(p.missionId).set(m);
    await assert.rejects(ret(p), e => e.code === 'failed-precondition'); assert.equal((await parcel(p.id).get()).data().missionId, p.missionId);
  });
  await check('late return cannot move a parcel transferred to a newer tour', async () => {
    const p = await seed(); await parcel(p.id).update({ missionId: 'new-tour' }); await assert.rejects(ret(p), e => e.code === 'failed-precondition');
  });
  await check('delivered and final returned parcels cannot be reopened by a physical return', async () => {
    for (const status of ['Livré', 'Retourné']) { const p = await seed(status); await assert.rejects(ret(p), e => e.code === 'failed-precondition'); }
  });
  await check('only office can authorize redelivery, preserving all previous outcomes', async () => {
    const p = await seed(); await ret(p); await assert.rejects(resolve(p, {}, driver), e => e.code === 'permission-denied');
    await resolve(p); const saved = (await parcel(p.id).get()).data(); assert.equal(saved.status, 'Au hub'); assert.equal(saved.returnDisposition, 'REDELIVERY_READY'); assert.equal(saved.deliveryAttempts.length, 1);
    assert.equal((await resolve(p)).alreadyResolved, true);
  });
  await check('definitive sender return requires actual handover confirmation plus photo and remains terminal', async () => {
    const p = await seed(); await ret(p);
    await assert.rejects(resolve(p, { decision: 'SENDER_RETURNED' }), e => e.code === 'invalid-argument');
    await assert.rejects(resolve(p, { decision: 'SENDER_RETURNED', proof: { photoUrls: [proofUrl(p.id)] } }), e => e.code === 'failed-precondition');
    await resolve(p, { decision: 'SENDER_RETURNED', confirmedPhysicalHandover: true, proof: { photoUrls: [proofUrl(p.id)] } });
    assert.equal((await parcel(p.id).get()).data().returnDisposition, 'SENDER_RETURNED');
    await assert.rejects(resolve(p, { requestId: `${p.id}-later` }), e => e.code === 'failed-precondition');
  });
  await check('legacy returned parcel requires explicit office scan and active physical hub', async () => {
    const p = await seed('Retourné'); await parcel(p.id).update({ missionId: null, stopId: null, currentDriverId: null });
    await assert.rejects(resolve(p), e => e.code === 'failed-precondition');
    await assert.rejects(resolve(p, { hubId: hub, code: 'WRONG', confirmedPhysicalPresence: true }), e => e.code === 'failed-precondition');
    await resolve(p, { hubId: hub, code: p.id.toUpperCase(), confirmedPhysicalPresence: true });
    assert.equal((await parcel(p.id).get()).data().status, 'Au hub');
  });
  await check('partial pickup records complete immutable partition and releases missing parcel only', async () => {
    const p = await pickupSeed(); await service.finalizePickup.run(p.data, context(driver));
    const present = (await parcel(p.id).get()).data(), missing = (await parcel(p.missing).get()).data();
    assert.equal(present.status, 'Collecté'); assert.equal(present.missionId, p.missionId);
    assert.equal(missing.status, 'En attente'); assert.equal(missing.missionId, null); assert.equal(missing.stopId, null); assert.equal(missing.currentDriverId, null);
    assert.equal(missing.pickupMissing.missionId, p.missionId);
    const manifest = (await db.collection('pickups').doc(`${p.missionId}_stop`).get()).data();
    assert.deepEqual(manifest.expectedPackageIds, [p.id, p.missing]); assert.deepEqual(manifest.missingPackageIds, [p.missing]);
    assert.equal(manifest.timestamp, '2026-10-01T07:00:00Z');
    assert.equal((await missionRef(p.missionId).get()).data().collectedPackages, 1);
  });
  await check('pickup replay never doubles counters and conflicting partition is rejected', async () => {
    const p = await pickupSeed(); await Promise.all([service.finalizePickup.run(p.data, context(driver)), service.finalizePickup.run(p.data, context(driver))]);
    assert.equal((await missionRef(p.missionId).get()).data().collectedPackages, 1);
    await assert.rejects(service.finalizePickup.run({ ...p.data, scannedPackageIds: [], missingPackageIds: [p.id, p.missing] }, context(driver)), e => e.code === 'failed-precondition');
  });
  await check('pickup missing partition holes, duplicates and another driver are rejected', async () => {
    const p = await pickupSeed();
    await assert.rejects(service.finalizePickup.run({ ...p.data, missingPackageIds: [] }, context(driver)), e => e.code === 'invalid-argument');
    await assert.rejects(service.finalizePickup.run({ ...p.data, scannedPackageIds: [p.id, p.id] }, context(driver)), e => e.code === 'invalid-argument');
    await assert.rejects(service.finalizePickup.run(p.data, context(other)), e => e.code === 'permission-denied');
  });
  await check('stale pickup after assignment changed causes no partial update', async () => {
    const p = await pickupSeed(); await parcel(p.missing).update({ currentDriverId: other });
    await assert.rejects(service.finalizePickup.run(p.data, context(driver)), e => e.code === 'failed-precondition'); assert.equal((await parcel(p.id).get()).data().status, 'En attente');
  });
  await check('missing pickup parcel cannot bypass a new physical collection through hub reception', async () => {
    const p = await pickupSeed(); await service.finalizePickup.run(p.data, context(driver));
    await assert.rejects(service.receivePackagesAtHub.run({ hubId: hub, packageIds: [p.missing] }, context(manager)), e => e.code === 'failed-precondition');
  });
  await check('new collection uses sender address and leaves historical manifest untouched; retry is idempotent', async () => {
    const p = await pickupSeed(); await service.finalizePickup.run(p.data, context(driver));
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Reunion', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const data = { requestId: `${p.id}-replan`, packageIds: [p.missing], driverId: driver, hubId: hub, date };
    const result = await replanPickupHandler(data, context(manager), deps);
    assert.equal((await replanPickupHandler(data, context(manager), deps)).replayed, true);
    assert.equal((await missionRef(result.missionId).get()).data().stops[0].address, '1 rue Collecte');
    assert.equal((await parcel(p.missing).get()).data().status, 'En attente');
    await service.finalizePickup.run({ ...p.data, missionId: result.missionId, stopId: 'pickup', expectedPackageIds: [p.missing], scannedPackageIds: [p.missing], missingPackageIds: [] }, context(driver));
    await service.receivePackagesAtHub.run({ hubId: hub, packageIds: [p.id, p.missing] }, context(driver));
    await service.finishMission.run({ missionId: p.missionId }, context(driver));
    assert.equal((await parcel(p.missing).get()).data().pickupMissing, null);
    assert.deepEqual((await db.collection('pickups').doc(`${p.missionId}_stop`).get()).data().missingPackageIds, [p.missing]);
  });
  await check('recollect refuses foreign drivers and an already reassigned missing parcel', async () => {
    const p = await pickupSeed(); await service.finalizePickup.run(p.data, context(driver));
    const data = { requestId: `${p.id}-replan`, packageIds: [p.missing], driverId: driver, hubId: hub, date: '2099-01-01' };
    await assert.rejects(replanPickupHandler(data, context(driver), deps), e => e.code === 'permission-denied');
    await parcel(p.missing).update({ missionId: 'new-mission' }); await assert.rejects(replanPickupHandler(data, context(manager), deps), e => e.code === 'failed-precondition');
  });
  await check('physical interhub receipt checks code and origin then preserves movement; replay is harmless', async () => {
    const p = await seed('Au hub'); await parcel(p.id).update({ missionId: null, stopId: null, currentDriverId: null, currentHubId: hub });
    const data = { packageId: p.id, hubId: hub2, code: p.id.toUpperCase(), confirmedPhysicalReception: true, reason: 'Navette réceptionnée' };
    await assert.rejects(receiveTransferredPackageAtHubHandler({ ...data, code: 'OTHER' }, context(manager), deps), e => e.code === 'failed-precondition');
    await assert.rejects(receiveTransferredPackageAtHubHandler(data, context(driver), deps), e => e.code === 'permission-denied');
    await receiveTransferredPackageAtHubHandler(data, context(manager), deps);
    assert.equal((await parcel(p.id).get()).data().currentHubId, hub2);
    assert.equal((await receiveTransferredPackageAtHubHandler(data, context(manager), deps)).alreadyReceived, true);
  });
  await check('legacy hub/sorted without known location can be physically received by office, known other hub still refused', async () => {
    for (const status of ['Au hub', 'Trié']) {
      const p = await seed(status); await parcel(p.id).update({ missionId: null, stopId: null, currentDriverId: null });
      await service.receivePackagesAtHub.run({ hubId: hub, packageIds: [p.id] }, context(manager));
      const saved = (await parcel(p.id).get()).data(); assert.equal(saved.currentHubId, hub); assert.match(saved.movements.at(-1).notes, /ancien emplacement inconnu/);
      await assert.rejects(service.receivePackagesAtHub.run({ hubId: hub2, packageIds: [p.id] }, context(manager)), e => e.code === 'failed-precondition');
    }
  });
  await check('return proof must belong to exact parcel storage directory', async () => {
    const p = await seed(); const data = returnData(p); data.extra.returnProof.photoUrls = [proofUrl('another-parcel')];
    await assert.rejects(service.returnPackage.run(data, context(driver)), e => e.code === 'invalid-argument');
  });
  await check('a caller without field timestamp replays the original server-received time', async () => {
    const p = await seed(); const data = returnData(p); delete data.extra.returnProof.timestamp;
    await service.returnPackage.run(data, context(driver)); const first = (await parcel(p.id).get()).data().returnProof.timestamp;
    assert.equal((await service.returnPackage.run(data, context(driver))).alreadyReceived, true);
    assert.equal((await parcel(p.id).get()).data().returnProof.timestamp, first);
  });
  await check('a receipt cannot silently confirm a later return attempt using the same requestId', async () => {
    const p = await seed(); await ret(p);
    await assert.rejects(ret(p, { expectedMissionId: 'new-attempt' }), e => e.code === 'permission-denied');
    const data = returnData(p); data.extra.returnProof.timestamp = '2026-10-02T09:00:00Z';
    await assert.rejects(service.returnPackage.run(data, context(driver)), e => e.code === 'permission-denied');
  });
  console.log(`${passed} logistics recovery checks passed`); await db.terminate();
})().catch(error => { console.error(error); process.exitCode = 1; });
