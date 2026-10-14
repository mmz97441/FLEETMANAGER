// Characterization of audit findings, not regression expectations for corrected behavior.
// Run only inside firebase emulators:exec with the demo project (see audit report).
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8189') throw Error('Local Firestore emulator required.');
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== 'demo-fleet-production-audit') throw Error('Demo project required.');
process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const { scanPackageHandler } = require('../functions/lib/scanPackage.js');
const { prepareDeliveryStopHandler } = require('../functions/lib/prepareDeliveryStop.js');
const db = req('firebase-admin/firestore').getFirestore();
const prefix = 'logistics-audit-' + randomUUID();
const driver = prefix + '-driver', admin = prefix + '-admin', hub = prefix + '-hub';
const now = '2026-10-14T05:00:00Z', day = '2026-10-14';
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
const deps = { db, now: () => new Date(now), isAdminCaller: role => role === 'Admin', requireActiveCaller: async ctx => ({ ...(await db.collection('users').doc(ctx.auth.uid).get()).data(), id: ctx.auth.uid }) };
const findings = [];
const record = (id, observation) => { findings.push({ id, observation }); console.log('REPRODUCED', id, JSON.stringify(observation)); };
const parcel = async (suffix, extra = {}) => {
  const id = prefix + '-' + suffix;
  await db.collection('packages').doc(id).set({ externalId: id, barcode: id, clientId: 'synthetic-client', clientName: 'Expéditeur fictif', status: 'En attente', address: '1 rue Fictive', city: 'Saint-Denis', postalCode: '97400', contactName: 'Pharmacie A', zone: 'Nord', movements: [], ...extra });
  return id;
};
const scan = (code, overrides = {}) => scanPackageHandler({ code, driverId: driver, source: 'driver-claim', requestId: randomUUID(), ...overrides }, context(driver), deps);
const dispatch = (id, suffix, extra = {}) => service.dispatchMissions.run({ requestId: prefix + '-' + suffix, missions: [{
  date: day, zone: 'Nord', hubId: hub, driverId: driver, plannedDepartureTime: '08:00',
  stops: [{ id: 'delivery', type: 'DELIVERY', address: '1 rue Fictive', city: 'Saint-Denis', postalCode: '97400', contactName: 'Pharmacie A', packageIds: [id] }], ...extra,
}] }, context(admin));

(async () => {
  await Promise.all([
    db.collection('users').doc(driver).set({ role: 'Chauffeur', firstName: 'Fictif', lastName: 'Audit' }),
    db.collection('users').doc(admin).set({ role: 'Admin' }),
    db.collection('hubs').doc(hub).set({ name: 'Hub fictif A', isActive: true }),
  ]);
  // Claim -> arrival -> delivery verification: the initial grouping bypasses
  // the stricter recipient check, which only applies to incoming parcels.
  const a = await parcel('recipient-a', { floor: 0, timeWindowStart: '08:00', timeWindowEnd: '09:00' });
  const b = await parcel('recipient-b', { contactName: 'Cabinet B', floor: 2, timeWindowStart: '14:00', timeWindowEnd: '15:00' });
  const first = await scan(a), second = await scan(b);
  assert.equal(first.stopId, second.stopId);
  const prepared = await prepareDeliveryStopHandler({ missionId: first.missionId, stopId: first.stopId, arrive: true }, context(driver), deps);
  const verification = await scan(b, { source: 'driver-delivery', targetMissionId: first.missionId, stopId: first.stopId });
  assert.equal(verification.accepted, true);
  record('LOG-02', { recipients: ['Pharmacie A', 'Cabinet B'], stopCount: prepared.mission.stops.length, displayedRecipient: prepared.mission.stops[0].contactName, secondParcelVerified: verification.accepted, retainedWindow: [prepared.mission.stops[0].timeWindowStart, prepared.mission.stops[0].timeWindowEnd] });

  const c = await parcel('added-after-arrival');
  const late = await scan(c);
  assert.equal(late.stopId, first.stopId);
  record('LOG-02-arrived', { parcelAddedToAlreadyArrivedStop: true });

  const distant = await parcel('other-hub', { status: 'Au hub', currentHubId: prefix + '-hub-b', requestedDeliveryDate: '2026-10-16' });
  const dispatched = await dispatch(distant, 'wrong-hub');
  assert.equal(dispatched.packageCount, 1);
  record('LOG-03', { parcelHub: 'B', departureHub: 'A', desiredDate: '2026-10-16', dispatchedDate: day, accepted: true });

  const orphanMission = prefix + '-removed-stop';
  await db.collection('missions').doc(orphanMission).set({ driverId: driver, status: 'En cours', date: day, stops: [] });
  const returning = await parcel('return-orphan', { status: 'À retourner', missionId: orphanMission, stopId: 'removed', currentDriverId: driver });
  await service.finishMission.run({ missionId: orphanMission }, context(driver));
  assert.equal((await db.collection('packages').doc(returning).get()).data().status, 'À retourner');
  assert.equal((await db.collection('missions').doc(orphanMission).get()).data().status, 'Terminé');
  record('LOG-06', { missionClosedWithOutstandingReturnOutsideStops: true });

  await service.returnPackage.run({ packageId: returning, extra: { returnProof: { photoUrls: ['https://example.invalid/synthetic-photo'] } } }, context(driver));
  const returnedScan = await scan(returning);
  assert.equal(returnedScan.outcome, 'terminal');
  await assert.rejects(service.receivePackagesAtHub.run({ hubId: hub, packageIds: [returning] }, context(admin)), e => e.code === 'failed-precondition');
  await assert.rejects(dispatch(returning, 'returned-again'), e => e.code === 'failed-precondition');
  record('LOG-05', { returnedParcel: 'Retourné', scan: returnedScan.outcome, hubReception: 'refused', redispatch: 'refused' });

  // An import stores identifiers as entered, whereas lookup only queries the
  // scanned spelling and its uppercase equivalent.
  const lower = await parcel('lowercase', { externalId: 'br-audit-lowercase', barcode: 'gfl-audit-lowercase' });
  const upperScan = await scan('BR-AUDIT-LOWERCASE');
  const literalScan = await scan('br-audit-lowercase');
  assert.equal(upperScan.outcome, 'not_found'); assert.equal(literalScan.accepted, true);
  record('LOG-08', { stored: 'br-audit-lowercase', uppercaseScan: upperScan.outcome, exactCaseScan: literalScan.outcome });

  const pickupMission = prefix + '-partial-pickup', missing = await parcel('missing', { missionId: pickupMission, stopId: 'pickup', currentDriverId: driver });
  await db.collection('missions').doc(pickupMission).set({ driverId: driver, date: day, type: 'Collecte', status: 'En cours', stops: [{ id: 'pickup', type: 'PICKUP', status: 'Terminé', packageIds: [missing], packageCount: 1 }] });
  await db.collection('pickups').doc(pickupMission + '_pickup').set({ missionId: pickupMission, stopId: 'pickup', driverId: driver, scannedPackageIds: [], missingPackageIds: [missing] });
  await assert.rejects(service.receivePackagesAtHub.run({ hubId: hub, packageIds: [missing] }, context(admin)), e => e.code === 'failed-precondition');
  await service.finishMission.run({ missionId: pickupMission }, context(driver));
  assert.equal((await db.collection('packages').doc(missing).get()).data().missionId, pickupMission);
  record('LOG-11', { missingPickupRemainsAssignedToClosedMission: true, hubReception: 'refused' });

  writeFileSync('/private/tmp/fleet-logistics-server-findings.json', JSON.stringify({ demoProject: process.env.GCLOUD_PROJECT, findings }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
