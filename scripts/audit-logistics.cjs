// Regression checks for the corrected audit findings; original observations remain in docs/validation.
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
const record = (id, observation) => { findings.push({ id, observation }); console.log('PASS', id, JSON.stringify(observation)); };
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
  // Claim, arrival and verification share strict recipient identity.
  const a = await parcel('recipient-a', { floor: 0, timeWindowStart: '08:00', timeWindowEnd: '09:00' });
  const b = await parcel('recipient-b', { contactName: 'Cabinet B', floor: 2, timeWindowStart: '14:00', timeWindowEnd: '15:00' });
  const first = await scan(a), second = await scan(b);
  assert.notEqual(first.stopId, second.stopId);
  const prepared = await prepareDeliveryStopHandler({ missionId: first.missionId, stopId: first.stopId, arrive: true }, context(driver), deps);
  const verification = await scan(b, { source: 'driver-delivery', targetMissionId: first.missionId, stopId: first.stopId });
  assert.equal(verification.accepted, false);
  record('LOG-02', { recipients: ['Pharmacie A', 'Cabinet B'], stopCount: prepared.mission.stops.length, displayedRecipient: prepared.mission.stops[0].contactName, secondParcelVerified: verification.accepted, retainedWindow: [prepared.mission.stops[0].timeWindowStart, prepared.mission.stops[0].timeWindowEnd] });

  const c = await parcel('added-after-arrival', { floor: 0, timeWindowStart: '08:00', timeWindowEnd: '09:00' });
  const late = await scan(c);
  assert.notEqual(late.stopId, first.stopId);
  record('LOG-02-arrived', { parcelAddedToAlreadyArrivedStop: false });

  const distant = await parcel('other-hub', { status: 'Au hub', currentHubId: prefix + '-hub-b', requestedDeliveryDate: '2026-10-16' });
  await assert.rejects(dispatch(distant, 'wrong-hub'), e => e.code === 'failed-precondition');
  record('LOG-03', { parcelHub: 'B', departureHub: 'A', desiredDate: '2026-10-16', dispatchedDate: day, accepted: false });

  const orphanMission = prefix + '-removed-stop';
  await db.collection('missions').doc(orphanMission).set({ driverId: driver, status: 'En cours', date: day, stops: [] });
  const returning = await parcel('return-orphan', { status: 'À retourner', missionId: orphanMission, stopId: 'removed', currentDriverId: driver });
  await assert.rejects(service.finishMission.run({ missionId: orphanMission }, context(driver)), e => e.code === 'failed-precondition');
  assert.equal((await db.collection('packages').doc(returning).get()).data().status, 'À retourner');
  assert.equal((await db.collection('missions').doc(orphanMission).get()).data().status, 'En cours');
  record('LOG-06', { missionClosedWithOutstandingReturnOutsideStops: false });

  await service.returnPackage.run({ packageId: returning, requestId: randomUUID(), expectedMissionId: orphanMission, extra: { returnProof: { hubId: hub, photoUrls: ['https://firebasestorage.googleapis.com/v0/b/demo-fleet-production-audit.appspot.com/o/' + encodeURIComponent(`pod/returns/${returning}/photo.jpg`) + '?alt=media'] } } }, context(driver));
  const returnedScan = await scan(returning);
  assert.equal(returnedScan.outcome, 'blocked');
  await service.receivePackagesAtHub.run({ hubId: hub, packageIds: [returning] }, context(admin));
  assert.equal((await db.collection('packages').doc(returning).get()).data().returnDisposition, 'AWAITING_DECISION');
  await assert.rejects(dispatch(returning, 'returned-again'), e => e.code === 'failed-precondition');
  record('LOG-05', { returnedParcel: 'Au hub / décision attendue', scan: returnedScan.outcome, hubReception: 'already-at-hub / still awaiting decision', redispatch: 'refused' });

  // Original spelling is retained while the derived index recognizes uppercase scans.
  const lowerReference = 'br-' + prefix, barcode = 'gfl-' + prefix;
  await parcel('lowercase', { externalId: lowerReference, barcode, scanCodes: [lowerReference.toUpperCase(), barcode.toUpperCase()] });
  const upperScan = await scan(lowerReference.toUpperCase());
  const literalScan = await scan(lowerReference);
  assert.equal(upperScan.accepted, true); assert.equal(literalScan.accepted, true);
  record('LOG-08', { stored: 'br-audit-lowercase', uppercaseScan: upperScan.outcome, exactCaseScan: literalScan.outcome });

  const pickupMission = prefix + '-partial-pickup', missing = await parcel('missing', { missionId: pickupMission, stopId: 'pickup', currentDriverId: driver });
  await db.collection('missions').doc(pickupMission).set({ driverId: driver, date: day, type: 'Collecte', status: 'En cours', stops: [{ id: 'pickup', type: 'PICKUP', status: 'En attente', packageIds: [missing], packageCount: 1 }] });
  await service.finalizePickup.run({ missionId: pickupMission, stopId: 'pickup', driverId: driver, expectedPackageIds: [missing], scannedPackageIds: [], missingPackageIds: [missing] }, context(driver));
  await assert.rejects(service.receivePackagesAtHub.run({ hubId: hub, packageIds: [missing] }, context(admin)), e => e.code === 'failed-precondition');
  await service.finishMission.run({ missionId: pickupMission }, context(driver));
  assert.equal((await db.collection('packages').doc(missing).get()).data().missionId, null);
  record('LOG-11', { missingPickupRemainsAssignedToClosedMission: false, hubReception: 'refused' });

  writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'fleet-logistics-server-regressions.json'), JSON.stringify({ demoProject: process.env.GCLOUD_PROJECT, findings }, null, 2));
  await db.terminate();
})().catch(error => { console.error(error); process.exitCode = 1; });
