const assert = require('node:assert/strict');

module.exports = async ({ service, db, context, check }) => {
  const run = 'dispatch-test-' + Date.now();
  const driverA = run + '-driver-a', driverB = run + '-driver-b', hubId = run + '-hub';
  await Promise.all([
    db.collection('users').doc(driverA).set({ role: 'Chauffeur', status: 'active', firstName: 'A' }),
    db.collection('users').doc(driverB).set({ role: 'Chauffeur', status: 'active', firstName: 'B' }),
    db.collection('hubs').doc(hubId).set({ name: 'Hub Test', isActive: true }),
  ]);
  const parcel = async (name, extra = {}) => {
    const id = run + '-' + name;
    await db.collection('packages').doc(id).set({
      status: 'Trié', address: '28 RUE JOSEPH BÉDIER', postalCode: '97400', city: 'Saint-Denis', movements: [], ...extra,
    });
    return id;
  };
  const mission = (ids, driverId = driverA, extra = {}) => ({
    date: '2026-09-12', zone: 'Nord', hubId, plannedDepartureTime: '08:00', driverId,
    stops: [{ id: 's-' + driverId, type: 'DELIVERY', status: 'En attente',
      address: '28 rue Joseph Bedier', postalCode: '97400', city: 'SAINT DENIS',
      packageIds: ids, serviceTime: ids.length * 5, estimatedArrival: '2026-09-12T04:30:00Z', durationFromPrevious: 30 }],
    totalDistance: 10, estimatedDuration: 60, ...extra,
  });
  const request = (name, missions) => ({ requestId: run + '-' + name, missions });
  const call = data => service.dispatchMissions.run(data, context('server-admin'));
  const reject = (data, code = 'failed-precondition') => assert.rejects(call(data), error => error.code === code);
  await check('dispatch callable rejects clients and drivers', async () => {
    for (const user of ['server-client', driverA])
      await assert.rejects(service.dispatchMissions.run(request('denied', []), context(user)), error => error.code === 'permission-denied');
  });
  await check('already sorted parcel is atomically assigned and driver is notified once on retry', async () => {
    const id = await parcel('sorted');
    const data = request('sorted', [mission([id])]);
    const results = await Promise.all([call(data), call(data)]);
    assert.deepEqual(results[0].missionIds, results[1].missionIds);
    assert.equal(results.filter(result => result.replayed).length, 1);
    const mId = results[0].missionIds[0];
    const saved = (await db.collection('packages').doc(id).get()).data();
    assert.equal(saved.missionId, mId); assert.equal(saved.currentDriverId, driverA);
    assert.equal(saved.status, 'Trié'); assert.equal(saved.movements.length, 1);
    const savedMission = (await db.collection('missions').doc(mId).get()).data();
    assert.equal(savedMission.totalPackages, 1); assert.equal(savedMission.stops[0].durationFromPrevious, 30);
    assert.equal(savedMission.hubId, hubId); assert.equal(savedMission.status, 'Dispatché');
    assert.equal((await db.collection('notifications').doc('dispatch-' + mId).get()).exists, true);
    await reject({ ...data, missions: [mission([id], driverA, { plannedDepartureTime: '09:00' })] }, 'invalid-argument');
  });
  await check('one stale parcel rejects every mission without partial writes', async () => {
    const fresh = await parcel('fresh'), stale = await parcel('stale', { missionId: 'already-assigned' });
    const before = (await db.collection('missions').where('driverId', '==', driverB).get()).size;
    await reject(request('atomic', [mission([fresh], driverB), mission([stale], driverA)]));
    const pkg = (await db.collection('packages').doc(fresh).get()).data();
    assert.equal(pkg.missionId, undefined); assert.equal(pkg.movements.length, 0);
    assert.equal((await db.collection('missions').where('driverId', '==', driverB).get()).size, before);
  });
  await check('concurrent dispatches of the same parcel create exactly one mission', async () => {
    const id = await parcel('race');
    const results = await Promise.allSettled([
      call(request('race-a', [mission([id], driverA)])),
      call(request('race-b', [mission([id], driverB)])),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'failed-precondition');
    const saved = (await db.collection('packages').doc(id).get()).data();
    const m = (await db.collection('missions').doc(saved.missionId).get()).data();
    assert.equal(m.driverId, saved.currentDriverId); assert.deepEqual(m.stops[0].packageIds, [id]);
    assert.equal(saved.movements.length, 1);
  });
  await check('dispatch rejects delivered parcels and duplicate package entries', async () => {
    const delivered = await parcel('delivered', { status: 'Livré' });
    await reject(request('final', [mission([delivered])]));
    const fresh = await parcel('duplicate');
    await reject(request('duplicate', [mission([fresh, fresh])]), 'invalid-argument');
    assert.equal((await db.collection('packages').doc(delivered).get()).data().status, 'Livré');
  });
  await check('dispatch validates driver, optional vehicle, hub and current address', async () => {
    const id = await parcel('validation');
    await db.collection('users').doc(driverB).update({ isDisabled: true });
    await reject(request('disabled', [mission([id], driverB)]));
    await db.collection('users').doc(driverB).update({ isDisabled: false });
    const absenceRef = db.collection('absences').doc(run + '-absence');
    await absenceRef.set({ userId: driverA, status: 'Validé', startDate: '2026-09-12', endDate: '2026-09-12' });
    await reject(request('absence', [mission([id])]));
    await absenceRef.delete();
    await db.collection('hubs').doc(hubId).update({ isActive: false });
    await reject(request('hub', [mission([id])]));
    await db.collection('hubs').doc(hubId).update({ isActive: true });
    const vehicleId = run + '-vehicle';
    await db.collection('vehicles').doc(vehicleId).set({ status: 'En Service', driverId: driverB, licensePlate: 'TEST-974' });
    await reject(request('vehicle', [mission([id], driverA, { vehicleId })]));
    const wrong = mission([id]); wrong.stops[0].address = '99 autre adresse';
    await reject(request('address', [wrong]));
    await db.collection('vehicles').doc(vehicleId).update({ driverId: driverA });
    await call(request('valid-vehicle', [mission([id], driverA, { vehicleId })]));
    const assigned = (await db.collection('packages').doc(id).get()).data();
    assert.equal(assigned.currentVehicleId, vehicleId);
    assert.equal((await db.collection('missions').doc(assigned.missionId).get()).data().vehiclePlate, 'TEST-974');
  });
  await check('dispatch bounds writes before touching package documents', async () => {
    await reject(request('oversized', [mission(Array.from({ length: 451 }, (_, i) => run + '-missing-' + i))]), 'invalid-argument');
  });
  await check('transfer shares accent, punctuation and spacing normalization with dispatch', async () => {
    const id = await parcel('normalization', { status: 'En attente' });
    const target = run + '-target';
    await db.collection('missions').doc(target).set({ driverId: driverA, status: 'En cours', stops: [{
      id: 'existing', type: 'DELIVERY', status: 'En attente', sequence: 1,
      address: '  28, RUE   JOSEPH BEDIER ', postalCode: '97400 ', city: 'Saint Denis', packageIds: ['already-there'], packageCount: 1,
    }] });
    await service.transferPackages.run({ packageIds: [id], missionId: target, claimMode: true }, context(driverA));
    const m = (await db.collection('missions').doc(target).get()).data();
    assert.equal(m.stops.length, 1); assert.deepEqual(m.stops[0].packageIds, ['already-there', id]);
    assert.equal((await db.collection('packages').doc(id).get()).data().stopId, 'existing');
  });
  await check('transfer and return wait for unsynchronized proof and preserve failure history', async () => {
    const source = run + '-proof-source', target = run + '-proof-target';
    const id = await parcel('proof', { status: 'Échec', currentDriverId: driverA, missionId: source, stopId: 'failed' });
    await db.collection('missions').doc(source).set({ driverId: driverA, status: 'En cours', deliveredPackages: 0, failedPackages: 1, stops: [{
      id: 'failed', type: 'DELIVERY', status: 'Échec', proofSyncPending: true, sequence: 1, packageIds: [id], packageCount: 1,
    }] });
    await db.collection('missions').doc(target).set({ driverId: driverB, status: 'En cours', stops: [] });
    const transfer = () => service.transferPackages.run({ packageIds: [id], missionId: target, claimMode: true }, context(driverB));
    await assert.rejects(transfer(), error => error.code === 'failed-precondition');
    await assert.rejects(service.returnPackage.run({ packageId: id, extra: { returnProof: { photoUrls: ['https://example.invalid/proof'] } } }, context(driverA)), error => error.code === 'failed-precondition');
    await db.collection('missions').doc(source).update({ stops: [{ id: 'failed', type: 'DELIVERY', status: 'Échec', proofSyncPending: false, sequence: 1, packageIds: [id], packageCount: 1 }] });
    await transfer();
    const origin = (await db.collection('missions').doc(source).get()).data();
    assert.equal(origin.stops.length, 1); assert.deepEqual(origin.stops[0].packageIds, []);
    assert.equal(origin.stops[0].status, 'Échec'); assert.equal(origin.failedStops, 1);
    assert.equal(origin.failedPackages, 1); assert.equal(origin.totalPackages, 1);
  });
};
