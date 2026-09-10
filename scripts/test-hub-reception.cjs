const assert = require('node:assert/strict');
module.exports = async ({ service, db, context, check }) => {
  const prefix = 'hub-reception-' + Date.now();
  const manager = prefix + '-manager', driver = prefix + '-driver', outsider = prefix + '-other', hubId = prefix + '-hub';
  await Promise.all([
    db.collection('users').doc(manager).set({ role: 'Admin', firstName: 'Bureau' }),
    db.collection('users').doc(driver).set({ role: 'Chauffeur', status: 'active', firstName: 'Chauffeur' }),
    db.collection('users').doc(outsider).set({ role: 'Chauffeur', status: 'active' }),
    db.collection('hubs').doc(hubId).set({ name: 'Hub Test', isActive: true }),
  ]);
  const receive = (ids, uid = manager, targetHub = hubId) => service.receivePackagesAtHub.run({ hubId: targetHub, packageIds: ids }, context(uid));
  const seed = async (name, status = 'Collecté', stopStatus = 'Terminé') => {
    const id = prefix + '-' + name, missionId = id + '-pickup', stopId = 'pickup-stop';
    const pkg = { status, address: '1 rue Test', city: 'Saint Denis', postalCode: '97400', zone: 'Nord',
      missionId, stopId, currentDriverId: driver, currentVehicleId: 'van', movements: [] };
    await db.collection('packages').doc(id).set(pkg);
    await db.collection('missions').doc(missionId).set({ driverId: driver, status: 'En cours', totalPackages: 1,
      collectedPackages: 1, completedStops: 1, stops: [{ id: stopId, type: 'PICKUP', status: stopStatus, packageIds: [id], packageCount: 1 }] });
    await db.collection('pickups').doc(missionId + '_' + stopId).set({ missionId, stopId, driverId: driver, scannedPackageIds: [id], missingPackageIds: [] });
    return { id, missionId, stopId };
  };
  await check('pickup to hub to dispatch releases assignment atomically and retry adds no movement', async () => {
    const { id, missionId, stopId } = await seed('chain');
    const results = await Promise.all([receive([id], driver), receive([id], driver)]);
    assert.equal(results.reduce((sum, result) => sum + result.receivedCount, 0), 1);
    assert.equal(results.reduce((sum, result) => sum + result.alreadyReceivedCount, 0), 1);
    const pkg = (await db.collection('packages').doc(id).get()).data();
    assert.equal(pkg.status, 'Au hub'); assert.equal(pkg.currentHubId, hubId);
    for (const field of ['missionId', 'stopId', 'currentDriverId', 'currentVehicleId']) assert.equal(pkg[field], null);
    assert.equal(pkg.movements.length, 1); assert.equal(pkg.movements[0].action, 'HUB_ARRIVAL');
    const origin = (await db.collection('missions').doc(missionId).get()).data();
    assert.deepEqual(origin.stops[0].packageIds, []); assert.equal(origin.stops[0].status, 'Terminé');
    assert.equal(origin.collectedPackages, 1); assert.equal(origin.totalPackages, 1); assert.equal(origin.completedStops, 1);
    assert.deepEqual((await db.collection('pickups').doc(missionId + '_' + stopId).get()).data().scannedPackageIds, [id]);
    await service.finishMission.run({ missionId }, context(driver));
    const dispatch = await service.dispatchMissions.run({ requestId: prefix + '-dispatch-chain', missions: [{
      date: '2026-09-12', zone: 'Nord', hubId, driverId: driver, plannedDepartureTime: '08:00', stops: [{
        id: 'delivery', type: 'DELIVERY', address: pkg.address, city: pkg.city, postalCode: pkg.postalCode, packageIds: [id], serviceTime: 5,
      }], totalDistance: 10, estimatedDuration: 30,
    }] }, context(manager));
    const dispatched = (await db.collection('packages').doc(id).get()).data();
    assert.equal(dispatched.status, 'Trié'); assert.equal(dispatched.missionId, dispatch.missionIds[0]);
    assert.equal(dispatched.currentDriverId, driver); assert.equal(dispatched.movements.length, 2);
    assert.equal((await db.collection('missions').doc(missionId).get()).data().status, 'Terminé');
  });
  await check('legacy at-hub parcel with pickup references becomes dispatchable', async () => {
    const { id, missionId } = await seed('legacy', 'Au hub');
    const result = await receive([id]); assert.equal(result.receivedCount, 1);
    const pkg = (await db.collection('packages').doc(id).get()).data();
    assert.equal(pkg.missionId, null); assert.equal(pkg.currentDriverId, null); assert.equal(pkg.currentHubId, hubId);
    assert.deepEqual((await db.collection('missions').doc(missionId).get()).data().stops[0].packageIds, []);
  });
  await check('hub reception refuses unfinished pickup, missing manifest and pending proof', async () => {
    for (const mode of ['unfinished', 'manifest', 'proof']) {
      const { id, missionId, stopId } = await seed(mode, 'Collecté', mode === 'unfinished' ? 'Arrivé' : 'Terminé');
      if (mode === 'manifest') await db.collection('pickups').doc(missionId + '_' + stopId).delete();
      if (mode === 'proof') await db.collection('missions').doc(missionId).update({ stops: [{ id: stopId, type: 'PICKUP', status: 'Terminé', proofSyncPending: true, packageIds: [id], packageCount: 1 }] });
      await assert.rejects(receive([id]), error => error.code === 'failed-precondition');
      const pkg = (await db.collection('packages').doc(id).get()).data();
      assert.equal(pkg.status, 'Collecté'); assert.equal(pkg.missionId, missionId); assert.equal(pkg.movements.length, 0);
    }
  });
  await check('driver cannot receive another driver parcel or unassigned pending parcel', async () => {
    const { id } = await seed('ownership');
    await assert.rejects(receive([id], outsider), error => error.code === 'permission-denied');
    const pending = prefix + '-pending'; await db.collection('packages').doc(pending).set({ status: 'En attente', movements: [] });
    await assert.rejects(receive([pending], driver), error => error.code === 'permission-denied');
    const result = await receive([pending, pending]); assert.equal(result.receivedCount, 1);
    assert.equal((await receive([pending])).alreadyReceivedCount, 1);
    assert.equal((await db.collection('packages').doc(pending).get()).data().movements.length, 1);
  });
  await check('one unavailable parcel rejects entire reception batch without partial changes', async () => {
    const { id } = await seed('atomic'); const finalId = prefix + '-delivered';
    await db.collection('packages').doc(finalId).set({ status: 'Livré', movements: [] });
    await assert.rejects(receive([id, finalId]), error => error.code === 'failed-precondition');
    assert.equal((await db.collection('packages').doc(id).get()).data().status, 'Collecté');
    assert.equal((await db.collection('packages').doc(finalId).get()).data().status, 'Livré');
  });
  await check('hub reception never replaces a delivery failure or return with at-hub status', async () => {
    for (const status of ['Échec', 'Retourné', 'À retourner', 'En livraison', 'Trié']) {
      const id = prefix + '-protected-' + status; await db.collection('packages').doc(id).set({ status, movements: [] });
      await assert.rejects(receive([id]), error => error.code === 'failed-precondition');
      assert.equal((await db.collection('packages').doc(id).get()).data().status, status);
    }
  });
  await check('hub reception requires active hub and bounds batches before writes', async () => {
    const { id } = await seed('bounds');
    await db.collection('hubs').doc(hubId).update({ isActive: false });
    await assert.rejects(receive([id]), error => error.code === 'failed-precondition');
    await db.collection('hubs').doc(hubId).update({ isActive: true });
    await assert.rejects(receive(Array.from({ length: 151 }, (_, i) => prefix + '-large-' + i)), error => error.code === 'invalid-argument');
    assert.equal((await db.collection('packages').doc(id).get()).data().status, 'Collecté');
  });
};
