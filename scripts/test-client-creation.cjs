if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local Firestore emulator required.');
process.env.GCLOUD_PROJECT ||= 'demo-fleet-production-audit';
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index');
const { quoteOfferSnapshot } = require('../functions/lib/quoteOffer');
const { getFirestore } = req('firebase-admin/firestore');
const { initializeApp, deleteApp, getApp } = req('firebase-admin/app');
const db = getFirestore(), prefix = 'client-contract-' + randomUUID();
const client = prefix + '-client', other = prefix + '-other', office = prefix + '-office', driver = prefix + '-driver', hub = prefix + '-hub';
const context = uid => ({ auth: { uid, token: { email_verified: true } } });
const call = (name, data, uid = client) => service[name].run(data, context(uid));
const refs = new Map(), track = ref => { refs.set(ref.path, ref); return ref; };
const write = (collection, id, data) => track(db.collection(collection).doc(id)).set(data);
const read = async (collection, id) => (await db.collection(collection).doc(id).get()).data();
const point = { contactName: 'Pharmacie synthétique', address: '10 rue Test', city: 'Saint-Denis', postalCode: '97400' };
const parcel = code => ({ ...point, clientId: client, externalId: prefix + code, barcode: prefix + code, zone: 'Nord', status: 'En attente', serviceTime: 5 });
const quote = { clientId: client, clientName: 'Client synthétique', status: 'Offre envoyée', priceOffer: 50, adminNotes: 'Frais inclus', origin: '97410 Saint-Pierre', destination: '97400 Saint-Denis', destinationAddress: point.address, destinationContact: { name: point.contactName, phone: '0262000000' }, goodsDescription: 'Carton synthétique', deliveryDate: '2026-10-20T10:30', deliveryTimeWindow: { start: '08:00', end: '12:00', label: 'Matin' } };
const denied = (promise, code) => assert.rejects(promise, error => error.code === code);
let checks = 0;
const check = async (name, task) => { await task(); checks++; console.log('PASS', name); };
(async () => {
  for (const [uid, role] of [[client, 'Client'], [other, 'Client'], [office, 'Admin'], [driver, 'Chauffeur']]) await write('users', uid, { role, companyName: 'Synthétique', status: 'active' });
  await write('hubs', hub, { isActive: true, name: 'Hub synthétique' });
  await check('new incomplete addresses reject the complete transaction with per-row field details', async () => {
    for (const missing of ['city', 'postalCode']) {
      const rows = [parcel('-good-' + missing), { ...parcel('-bad-' + missing), [missing]: '' }];
      await assert.rejects(call('importPackages', { packages: rows }), error => error.code === 'invalid-argument' && error.details.rows[0].index === 1 && !!error.details.rows[0].fields[missing]);
      assert.equal((await db.collection('packages').where('externalId', '==', rows[0].externalId).get()).size, 0);
    }
  });
  await check('replaying an existing legacy partial address reads it without rewriting or creating it again', async () => {
    const original = { ...parcel('-legacy'), city: '', movements: [{ action: 'IMPORTED', notes: 'Historical' }] }, id = prefix + '-legacy-id';
    await write('packages', id, original);
    assert.deepEqual((await call('importPackages', { packages: [original] })).ids, [id]);
    assert.deepEqual(await read('packages', id), original);
  });
  await check('new imports preserve distinct dates, constraints and zero floor', async () => {
    const packages = [{ ...parcel('-morning'), requestedDeliveryDate: '2026-10-20', timeWindowStart: '08:00', timeWindowEnd: '09:00', serviceTime: 20, floor: 0 }, { ...parcel('-afternoon'), requestedDeliveryDate: '2026-10-21', timeWindowStart: '14:00', timeWindowEnd: '15:00', serviceTime: 15, floor: 2 }];
    const result = await call('importPackages', { packages });
    for (let i = 0; i < 2; i++) {
      const saved = await read('packages', result.ids[i]);
      for (const key of ['requestedDeliveryDate', 'timeWindowStart', 'timeWindowEnd', 'serviceTime', 'floor']) assert.equal(saved[key], packages[i][key]);
    }
  });
  await check('quote acceptance rejects missing consent, changed price, terms and route without any parcel', async () => {
    for (const [label, change] of [['price', { priceOffer: 150 }], ['terms', { adminNotes: 'Frais exclus' }], ['route', { destination: '97410 Saint-Pierre' }]]) {
      const id = prefix + '-offer-' + label; await write('quotes', id, { ...quote, ...change });
      await denied(call('acceptQuote', { quoteId: id, expectedOffer: quoteOfferSnapshot(quote) }), 'failed-precondition');
      assert.equal((await read('quotes', id)).status, 'Offre envoyée');
      assert.equal((await db.collection('packages').where('externalId', '==', id).get()).size, 0);
    }
    const id = prefix + '-no-consent'; await write('quotes', id, quote);
    await denied(call('acceptQuote', { quoteId: id }), 'failed-precondition');
    await denied(call('acceptQuote', { quoteId: id, expectedOffer: quoteOfferSnapshot(quote) }, other), 'permission-denied');
    await denied(service.acceptQuote.run({ quoteId: id, expectedOffer: quoteOfferSnapshot(quote) }, {}), 'unauthenticated');
  });
  let converted;
  await check('concurrent reviewed quote acceptance creates one parcel and stores exact accepted terms', async () => {
    const id = prefix + '-accepted'; await write('quotes', id, quote);
    const input = { quoteId: id, expectedOffer: quoteOfferSnapshot(quote) };
    const results = await Promise.all([call('acceptQuote', input), call('acceptQuote', input)]);
    assert.equal(results[0].packageId, results[1].packageId); converted = results[0].packageId;
    const saved = await read('quotes', id);
    assert.deepEqual(saved.acceptedOffer, input.expectedOffer); assert.equal(saved.acceptedBy, client);
    const p = await read('packages', converted);
    assert.equal(p.requestedDeliveryDate, '2026-10-20'); assert.equal(p.requestedDeliveryTime, '10:30');
    assert.equal(p.city, 'Saint-Denis'); assert.equal(p.timeWindowStart, '08:00'); assert.equal(p.timeWindowEnd, '12:00');
    assert.match(p.comment, /10:30/);
    assert.equal((await db.collection('packages').where('externalId', '==', id).get()).size, 1);
    assert.equal((await call('acceptQuote', input)).packageId, converted);
  });
  await check('the converted parcel dispatches on the requested calendar day without a date override', async () => {
    await db.collection('packages').doc(converted).update({ status: 'Au hub', currentHubId: hub });
    const requestId = randomUUID();
    const result = await call('dispatchMissions', { requestId, missions: [{ driverId: driver, hubId: hub, zone: 'Nord', date: '2026-10-20', plannedDepartureTime: '07:00', stops: [{ ...point, id: 's', type: 'DELIVERY', packageIds: [converted], serviceTime: 10, timeWindowStart: '08:00', timeWindowEnd: '12:00' }] }] }, office);
    assert.equal(result.packageCount, 1); for (const id of result.missionIds) track(db.collection('missions').doc(id));
    track(db.collection('dispatch_requests').doc(createHash('sha256').update(office + ':' + requestId).digest('hex')));
    assert.equal((await read('packages', converted)).missionId, result.missionIds[0]);
  });
  await check('invalid quote destination or date cannot be accepted even with matching price consent', async () => {
    for (const [label, change] of [['city', { destination: '97400' }], ['date', { deliveryDate: '2026-02-30T10:30' }]]) {
      const id = prefix + '-invalid-' + label, invalid = { ...quote, ...change }; await write('quotes', id, invalid);
      await denied(call('acceptQuote', { quoteId: id, expectedOffer: quoteOfferSnapshot(invalid) }), 'failed-precondition');
      assert.equal((await read('quotes', id)).status, 'Offre envoyée');
    }
  });
  await check('migration dry-run/apply/replay leaves addresses, assigned plans and history untouched', async () => {
    const projectId = 'demo-client-migration-' + Date.now(), app = initializeApp({ projectId }, projectId), isolated = getFirestore(app);
    const directory = mkdtempSync(path.join(tmpdir(), 'client-contract-')), reportPath = path.join(directory, 'report.json');
    const p = { ...point, status: 'En attente', importBatchId: 'QUOTE-q', requestedDeliveryDate: quote.deliveryDate, comment: 'Fragile' };
    try {
      await isolated.doc('packages/p').set(p); await isolated.doc('quotes/q').set({ ...quote, convertedToPackageId: 'p' });
      await isolated.doc('packages/incomplete').set({ ...p, city: '', requestedDeliveryDate: '2026-10-20' });
      await isolated.doc('packages/delivered').set({ ...p, status: 'Livré', pod: { proof: 'unchanged' } });
      await isolated.doc('packages/assigned').set({ ...p, missionId: 'm' });
      const run = apply => {
        const result = spawnSync(process.execPath, ['scripts/migrate-shipment-contract.cjs', '--project', projectId, '--report', reportPath, ...(apply ? ['--apply', '--confirm-project', projectId] : [])], { env: process.env, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr); return JSON.parse(readFileSync(reportPath, 'utf8'));
      };
      const dry = run(false); assert.equal(dry.candidates.length, 1); assert.equal(dry.addressReview.length, 1);
      assert.deepEqual((await isolated.doc('packages/p').get()).data(), p);
      assert.equal(run(true).applied.length, 1);
      assert.equal((await isolated.doc('packages/p').get()).data().requestedDeliveryDate, '2026-10-20');
      assert.equal((await isolated.doc('packages/incomplete').get()).data().city, '');
      assert.equal((await isolated.doc('packages/delivered').get()).data().requestedDeliveryDate, quote.deliveryDate);
      assert.equal((await isolated.doc('packages/assigned').get()).data().requestedDeliveryDate, quote.deliveryDate);
      assert.equal(run(true).candidates.length, 0);
    } finally {
      for (const collection of ['packages', 'quotes']) for (const doc of (await isolated.collection(collection).get()).docs) await doc.ref.delete();
      rmSync(directory, { recursive: true, force: true }); await deleteApp(app);
    }
  });
  console.log(`${checks} client creation server scenarios passed`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  const parcels = await db.collection('packages').where('clientId', '==', client).get();
  for (const doc of parcels.docs) {
    track(doc.ref);
    for (const index of (await db.collection('parcel_reference_index').where('packageIds', 'array-contains', doc.id).get()).docs) track(index.ref);
  }
  for (const doc of (await db.collection('import_runs').where('clientId', '==', client).get()).docs) track(doc.ref);
  for (const uid of [client, driver, office]) for (const doc of (await db.collection('notifications').where('recipientId', '==', uid).get()).docs) track(doc.ref);
  for (const ref of refs.values()) await ref.delete();
  await deleteApp(getApp());
});
