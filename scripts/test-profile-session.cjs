process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js');
const db = req('firebase-admin/firestore').getFirestore();
const context = uid => ({ auth: { uid, token: { auth_time: 200, email_verified: true, email: `${uid}@example.invalid` } } });
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const denied = (operation, code) => assert.rejects(operation, error => error.code === code);
(async () => {
  const uid = 'profile-session-driver', ref = db.collection('users').doc(uid), ctx = context(uid);
  await ref.set({ id: 'legacy-id', role: 'Chauffeur', firstName: 'Test', lastLoginAt: '2026-01-01T00:00:00.000Z' });
  await check('bootstrap requires authentication and reads only caller UID', async () => {
    await denied(service.getOwnProfile.run({ uid }, {}), 'unauthenticated');
    await denied(service.getOwnProfile.run({ uid: 'server-admin' }, ctx), 'permission-denied');
    assert.equal((await service.getOwnProfile.run({ uid }, ctx)).profile.id, uid);
  });
  await check('missing bootstrap profile never creates an account or invents a role', async () => {
    const missing = 'profile-session-missing'; await db.collection('users').doc(missing).delete();
    assert.equal((await service.getOwnProfile.run({ uid: missing }, context(missing))).profile, null);
    assert.equal((await db.collection('users').doc(missing).get()).exists, false);
    await denied(service.recordUserPresence.run({ uid: missing, login: true }, context(missing)), 'permission-denied');
    assert.equal((await db.collection('users').doc(missing).get()).exists, false);
  });
  await check('bootstrap can explain disabled/revoked own profile without granting operations', async () => {
    await ref.update({ isDisabled: true, sessionsRevokedAt: 200 });
    const result = await service.getOwnProfile.run({ uid }, ctx); assert.equal(result.profile.isDisabled, true);
    await denied(service.recordUserPresence.run({ uid, login: true }, ctx), 'permission-denied');
    await ref.update({ isDisabled: false });
    await denied(service.recordUserPresence.run({ uid, login: true }, ctx), 'permission-denied');
    await denied(service.recordUserPresence.run({ uid, login: true }, { auth: { uid, token: {} } }), 'permission-denied');
    await ref.update({ sessionsRevokedAt: 0 });
  });
  await check('presence cannot target another account or accept a malformed opening flag', async () => {
    await denied(service.recordUserPresence.run({ uid, login: true }, {}), 'unauthenticated');
    await denied(service.recordUserPresence.run({ uid: 'server-admin', login: true }, ctx), 'invalid-argument');
    await denied(service.recordUserPresence.run({ uid, login: 'true' }, ctx), 'invalid-argument');
  });
  await check('opening is timestamped by the server, without accepting client clock or privileges', async () => {
    const before = Date.now();
    await service.recordUserPresence.run({ uid, login: true, lastSeenAt: '2099-01-01', role: 'Admin' }, ctx);
    const user = (await ref.get()).data();
    assert.equal(user.role, 'Chauffeur'); assert.equal(user.lastLoginAt, user.lastSeenAt);
    assert.ok(Date.parse(user.lastSeenAt) >= before && Date.parse(user.lastSeenAt) <= Date.now());
  });
  await check('heartbeat retains opening date, throttles writes and works without any GPS', async () => {
    const previous = (await ref.get()).data();
    await Promise.all([service.recordUserPresence.run({ uid, login: false }, ctx), service.recordUserPresence.run({ uid, login: false }, ctx)]);
    assert.deepEqual((await ref.get()).data(), previous);
    await ref.update({ lastSeenAt: '2026-01-01T00:00:00.000Z' });
    await service.recordUserPresence.run({ uid, login: false }, ctx);
    const updated = (await ref.get()).data(); assert.equal(updated.lastLoginAt, previous.lastLoginAt);
    assert.ok(Date.parse(updated.lastSeenAt) >= Date.parse(previous.lastSeenAt));
    assert.equal((await db.collection('driverLocations').doc(uid).get()).exists, false);
  });
  await check('directory retains operational connection dates without exposing profile secrets', async () => {
    await ref.update({ socialSecurityNumber: 'synthetic-private' });
    const { users } = await service.getTeamDirectory.run({}, ctx), user = users.find(u => u.id === uid);
    assert.equal(user.lastLoginAt, (await ref.get()).data().lastLoginAt); assert.ok(user.lastSeenAt);
    assert.equal(user.socialSecurityNumber, undefined);
  });
  await check('profile recovery rejects a stale request for another identity', async () => {
    await denied(service.linkAuthToProfile.run({ uid: 'other-account' }, ctx), 'permission-denied');
    assert.equal((await ref.get()).data().role, 'Chauffeur');
    assert.equal((await service.linkAuthToProfile.run({}, ctx)).success, true); // compatibility with installed versions
  });
  console.log(`${passed} profile/session server tests passed`);
  await req('firebase-admin/app').deleteApp(req('firebase-admin/app').getApp());
})().catch(error => { console.error(error); process.exit(1); });
