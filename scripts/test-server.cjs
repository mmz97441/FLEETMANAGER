process.env.GCLOUD_PROJECT = 'demo-fleet-production-audit';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/functions/package.json');
const service = require('../functions/lib/index.js'),
  admin = req('firebase-admin');
const db = req('firebase-admin/firestore').getFirestore(),
  auth = req('firebase-admin/auth').getAuth();
const context = (uid) => ({
  auth: {
    uid,
    token: { email_verified: true, email: uid + '@example.invalid' },
  },
});
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log('PASS', name);
};
(async () => {
  await db
    .collection('users')
    .doc('server-admin')
    .set({ id: 'server-admin', role: 'Admin' });
  await db
    .collection('users')
    .doc('server-client')
    .set({ id: 'server-client', role: 'Client', companyName: 'A' });
  await db.collection('users').doc('pending-profile').set({
    id: 'pending-profile',
    role: 'Chauffeur',
    email: 'pending@example.invalid',
    firstName: 'Fictif',
    lastName: 'Audit',
    leaveBalance: 20,
  });
  const created = [],
    deleted = [];
  auth.createUser = async (data) => {
    created.push(data);
    return { uid: data.uid };
  };
  auth.deleteUser = async (uid) => {
    deleted.push(uid);
  };
  await check('client cannot invite an unrelated employee', async () => {
    await assert.rejects(
      service.createInvitation.run(
        { email: 'pending@example.invalid', userId: 'pending-profile' },
        context('server-client'),
      ),
      (e) => e.code === 'permission-denied',
    );
  });
  await check('unsealed legacy invitation cannot grant a role', async () => {
    await db.collection('invitations').doc('malicious').set({
      token: 'unsafe',
      role: 'Admin',
      userId: 'server-admin',
      used: false,
      expiresAt: '2099-01-01',
    });
    await assert.rejects(
      service.activateAccount.run(
        { token: 'unsafe', password: 'test-password' },
        {},
      ),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(created.length, 0);
  });
  await check(
    'legitimate activation preserves profile and assignment identifiers',
    async () => {
      await db
        .collection('vehicles')
        .doc('assigned')
        .set({ driverId: 'pending-profile' });
      const invitation = await service.createInvitation.run(
        { email: 'pending@example.invalid', userId: 'pending-profile' },
        context('server-admin'),
      );
      const result = await service.activateAccount.run(
        { token: invitation.token, password: 'test-password' },
        {},
      );
      assert.equal(result.success, true);
      assert.equal(created[0].uid, 'pending-profile');
      assert.equal(
        (await db.collection('vehicles').doc('assigned').get()).data().driverId,
        'pending-profile',
      );
      assert.equal(
        (await db.collection('users').doc('pending-profile').get()).data()
          .status,
        'active',
      );
    },
  );
  await check(
    'existing Auth user is never deleted by activation rollback',
    async () => {
      await db
        .collection('users')
        .doc('pending-second')
        .set({ role: 'Chauffeur', email: 'second@example.invalid' });
      const invitation = await service.createInvitation.run(
        { email: 'second@example.invalid', userId: 'pending-second' },
        context('server-admin'),
      );
      auth.createUser = async () => {
        const e = new Error('exists');
        e.code = 'auth/email-already-exists';
        throw e;
      };
      await assert.rejects(
        service.activateAccount.run(
          { token: invitation.token, password: 'test-password' },
          {},
        ),
        (e) => e.code === 'already-exists',
      );
      assert.equal(deleted.length, 0);
    },
  );
  await db
    .collection('users')
    .doc('employee')
    .set({ id: 'employee', role: 'Chauffeur', leaveBalance: 20 });
  const absence = (id) => ({
    id,
    userId: 'employee',
    type: 'Congés Payés',
    status: 'En attente',
    startDate: '2026-09-14',
    endDate: '2026-09-15',
  });
  await check(
    'employee cannot approve own absence through callable',
    async () => {
      await assert.rejects(
        service.saveAbsence.run(
          { absence: { ...absence('leave-unauthorized'), status: 'Validé' } },
          context('employee'),
        ),
        (e) => e.code === 'permission-denied',
      );
    },
  );
  await check(
    'concurrent approvals debit both requests exactly once',
    async () => {
      await Promise.all(
        ['leave-a', 'leave-b'].map((id) =>
          service.saveAbsence.run(
            { absence: absence(id) },
            context('employee'),
          ),
        ),
      );
      await Promise.all(
        ['leave-a', 'leave-b'].map((id) =>
          service.saveAbsence.run(
            { absence: { ...absence(id), status: 'Validé' } },
            context('server-admin'),
          ),
        ),
      );
      assert.equal(
        (await db.collection('users').doc('employee').get()).data()
          .leaveBalance,
        16,
      );
      await service.saveAbsence.run(
        { absence: { ...absence('leave-a'), status: 'Validé' } },
        context('server-admin'),
      );
      assert.equal(
        (await db.collection('users').doc('employee').get()).data()
          .leaveBalance,
        16,
      );
    },
  );
  await check('rejection refunds the previous debit once', async () => {
    await service.saveAbsence.run(
      { absence: { ...absence('leave-a'), status: 'Refusé' } },
      context('server-admin'),
    );
    assert.equal(
      (await db.collection('users').doc('employee').get()).data().leaveBalance,
      18,
    );
  });
  await check(
    'concurrent vehicle assignments leave one consistent relationship',
    async () => {
      await db
        .collection('users')
        .doc('assignment-driver')
        .set({ role: 'Chauffeur' });
      await Promise.all(
        ['vehicle-a', 'vehicle-b'].map((id) =>
          db.collection('vehicles').doc(id).set({ driverId: null }),
        ),
      );
      await Promise.all(
        ['vehicle-a', 'vehicle-b'].map((vehicleId) =>
          service.assignVehicle.run(
            { vehicleId, driverId: 'assignment-driver' },
            context('server-admin'),
          ),
        ),
      );
      const assigned = await db
        .collection('vehicles')
        .where('driverId', '==', 'assignment-driver')
        .get();
      assert.equal(assigned.size, 1);
      assert.equal(
        (await db.collection('users').doc('assignment-driver').get()).data()
          .assignedVehicleId,
        assigned.docs[0].id,
      );
    },
  );
  await check(
    'client import is idempotent and cannot set proof or driver',
    async () => {
      const packages = [
        {
          externalId: 'IMPORT-TEST',
          address: '1 rue fictive',
          contactName: 'Fictif',
          missionId: 'forged',
          pod: { fake: true },
          currentDriverId: 'employee',
          status: 'Livré',
        },
      ];
      const a = await service.importPackages.run(
        { packages },
        context('server-client'),
      );
      const b = await service.importPackages.run(
        { packages },
        context('server-client'),
      );
      assert.deepEqual(a.ids, b.ids);
      const p = (await db.collection('packages').doc(a.ids[0]).get()).data();
      assert.equal(p.clientId, 'server-client');
      assert.equal(p.status, 'En attente');
      assert.equal(p.pod, undefined);
      assert.equal(p.currentDriverId, undefined);
    },
  );
  await check('deleting approved absence refunds exactly once', async () => {
    await service.deleteAbsence.run({ id: 'leave-b' }, context('server-admin'));
    await service.deleteAbsence.run({ id: 'leave-b' }, context('server-admin'));
    assert.equal(
      (await db.collection('users').doc('employee').get()).data().leaveBalance,
      20,
    );
  });
  await check('nonexistent calendar date is rejected', async () => {
    await assert.rejects(
      service.saveAbsence.run(
        {
          absence: {
            ...absence('invalid-date'),
            startDate: '2026-02-30',
            endDate: '2026-03-03',
          },
        },
        context('employee'),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });
  await check(
    'employee can reject a manager proposal without altering dates',
    async () => {
      await service.saveAbsence.run(
        {
          absence: {
            ...absence('proposal'),
            status: 'Modification proposée',
            modificationProposal: {
              proposedStartDate: '2026-09-21',
              proposedEndDate: '2026-09-22',
            },
          },
        },
        context('server-admin'),
      );
      await service.saveAbsence.run(
        {
          absence: {
            ...absence('proposal'),
            startDate: '2026-01-01',
            status: 'En attente',
          },
        },
        context('employee'),
      );
      const result = (
        await db.collection('absences').doc('proposal').get()
      ).data();
      assert.equal(result.startDate, '2026-09-14');
      assert.equal(result.modificationProposal, null);
    },
  );
  await check(
    'return records proof and detaches package atomically and idempotently',
    async () => {
      await db
        .collection('missions')
        .doc('return-tour')
        .set({
          driverId: 'employee',
          status: 'En cours',
          stops: [
            {
              id: 's',
              status: 'En attente',
              packageIds: ['returned-package'],
              packageCount: 1,
            },
          ],
        });
      await db.collection('packages').doc('returned-package').set({
        missionId: 'return-tour',
        currentDriverId: 'employee',
        status: 'À retourner',
        movements: [],
      });
      const input = {
        packageId: 'returned-package',
        extra: {
          returnProof: {
            photoUrls: ['https://example.invalid/synthetic-photo'],
            driverId: 'forged',
          },
        },
      };
      await service.returnPackage.run(input, context('employee'));
      await service.returnPackage.run(input, context('employee'));
      const p = (
        await db.collection('packages').doc('returned-package').get()
      ).data();
      assert.equal(p.status, 'Retourné');
      assert.equal(p.missionId, null);
      assert.equal(p.returnProof.driverId, 'employee');
      assert.equal(p.movements.length, 1);
      assert.deepEqual(
        (await db.collection('missions').doc('return-tour').get()).data().stops,
        [],
      );
    },
  );
  await check(
    'private HR data never appears in operational directory',
    async () => {
      await db.collection('users').doc('private-person').set({
        role: 'Chauffeur',
        firstName: 'Test',
        leaveBalance: 500,
        socialSecurityNumber: 'synthetic',
      });
      const { users } = await service.getTeamDirectory.run(
        {},
        context('employee'),
      );
      const person = users.find((u) => u.id === 'private-person');
      assert.equal(person.firstName, 'Test');
      assert.equal(person.leaveBalance, undefined);
      assert.equal(person.socialSecurityNumber, undefined);
    },
  );
  await check(
    'concurrent quote acceptance creates one package and an accepted quote',
    async () => {
      await db.collection('quotes').doc('quote-race').set({
        clientId: 'server-client',
        clientName: 'A',
        status: 'Offre envoyée',
        destinationAddress: '1 rue fictive, 97400 Saint-Denis',
      });
      const results = await Promise.all([
        service.acceptQuote.run(
          { quoteId: 'quote-race' },
          context('server-client'),
        ),
        service.acceptQuote.run(
          { quoteId: 'quote-race' },
          context('server-client'),
        ),
      ]);
      assert.equal(results[0].packageId, results[1].packageId);
      const quote = (
        await db.collection('quotes').doc('quote-race').get()
      ).data();
      assert.equal(quote.status, 'Accepté (Commande)');
      assert.equal(quote.convertedToPackageId, results[0].packageId);
      assert.equal(
        (
          await db
            .collection('packages')
            .where('externalId', '==', 'quote-race')
            .get()
        ).size,
        1,
      );
    },
  );
  await check(
    'invalid destination never accepts a quote without its package',
    async () => {
      await db.collection('quotes').doc('quote-invalid').set({
        clientId: 'server-client',
        status: 'Offre envoyée',
        destinationAddress: 'Adresse incomplète',
      });
      await assert.rejects(
        service.acceptQuote.run(
          { quoteId: 'quote-invalid' },
          context('server-client'),
        ),
        (e) => e.code === 'failed-precondition',
      );
      assert.equal(
        (await db.collection('quotes').doc('quote-invalid').get()).data()
          .status,
        'Offre envoyée',
      );
    },
  );
  await check(
    'package status notifications survive trigger replay without duplication',
    async () => {
      const change = {
        before: { data: () => ({ status: 'En livraison' }) },
        after: {
          data: () => ({
            status: 'Échec',
            clientId: 'server-client',
            orderNumber: 'TEST',
          }),
        },
      };
      const ctx = {
        eventId: 'synthetic-notification-event',
        params: { packageId: 'synthetic-notification-package' },
      };
      await service.notifyPackageStatus.run(change, ctx);
      await service.notifyPackageStatus.run(change, ctx);
      const rows = await db
        .collection('notifications')
        .where('metadata.packageId', '==', 'synthetic-notification-package')
        .get();
      assert.equal(
        rows.docs.filter((d) => d.data().recipientId === 'server-client')
          .length,
        1,
      );
      assert.equal(
        rows.docs.filter((d) => d.data().recipientId === 'server-admin').length,
        1,
      );
    },
  );
  await check(
    'an import interrupted after 450 of 900 rows resumes without duplicates',
    async () => {
      const rows = Array.from({ length: 900 }, (_, i) => ({
        externalId: `BULK-${i}`,
        orderNumber: `BULK-${i}`,
        importBatchId: 'bulk-900',
        address: '1 rue fictive',
        contactName: 'Test',
      }));
      for (let offset = 0; offset < 450; offset += 150)
        await service.importPackages.run(
          { packages: rows.slice(offset, offset + 150) },
          context('server-client'),
        );
      for (let offset = 0; offset < 900; offset += 150)
        await service.importPackages.run(
          { packages: rows.slice(offset, offset + 150) },
          context('server-client'),
        );
      assert.equal(
        (
          await db
            .collection('packages')
            .where('importBatchId', '==', 'bulk-900')
            .get()
        ).size,
        900,
      );
    },
  );
  await check(
    'concurrent parcel claims leave the parcel on exactly one mission',
    async () => {
      for (const driver of ['claim-a', 'claim-b']) {
        await db.collection('users').doc(driver).set({ role: 'Chauffeur' });
        await db.collection('missions').doc(driver).set({
          driverId: driver,
          vehicleId: 'v',
          status: 'En cours',
          stops: [],
        });
      }
      await db.collection('packages').doc('claim-race').set({
        status: 'En attente',
        address: '1 rue fictive',
        postalCode: '97400',
        city: 'Test',
        movements: [],
      });
      await Promise.all(
        ['claim-a', 'claim-b'].map((driver) =>
          service.transferPackages.run(
            { packageIds: ['claim-race'], missionId: driver, claimMode: true },
            context(driver),
          ),
        ),
      );
      const pkg = (
        await db.collection('packages').doc('claim-race').get()
      ).data();
      let count = 0;
      for (const id of ['claim-a', 'claim-b']) {
        const mission = (await db.collection('missions').doc(id).get()).data();
        if (mission.stops.some((s) => s.packageIds.includes('claim-race'))) {
          count++;
          assert.equal(pkg.missionId, id);
          assert.equal(pkg.currentDriverId, id);
        }
      }
      assert.equal(count, 1);
    },
  );
  await check(
    'revoking sessions blocks old callable tokens immediately',
    async () => {
      const revoked = [];
      auth.revokeRefreshTokens = async (uid) => {
        revoked.push(uid);
      };
      await service.revokeOwnSessions.run({}, context('employee'));
      assert.deepEqual(revoked, ['employee']);
      await assert.rejects(
        service.getTeamDirectory.run({}, context('employee')),
        (e) => e.code === 'permission-denied',
      );
    },
  );
  await check('analytics callable denies operational accounts', async () => {
    await assert.rejects(
      service.interpretAnalytics.run(
        { question: 'Combien ?' },
        context('claim-a'),
      ),
      (e) => e.code === 'permission-denied',
    );
  });
  await check(
    'analytics uses a server template and returns no computed business data',
    async () => {
      const previousFetch = global.fetch,
        previousKey = process.env.GEMINI_API_KEY,
        previousModel = process.env.GEMINI_MODEL;
      process.env.GEMINI_API_KEY = 'synthetic-test-key';
      process.env.GEMINI_MODEL = 'synthetic-test-model';
      let body;
      global.fetch = async (url, options) => {
        body = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"metric":"volume","dimension":"none","period":"all","chart":"kpi"}',
                    },
                  ],
                },
              },
            ],
          }),
        };
      };
      try {
        const result = await service.interpretAnalytics.run(
          {
            question: 'Combien de colis ?',
            systemInstruction: 'UNTRUSTED_OVERRIDE',
            context: { pharmacies: ['Test'], zones: ['Nord'] },
          },
          context('server-client'),
        );
        assert.equal(JSON.parse(result.text).metric, 'volume');
        assert.equal(
          body.generationConfig.responseMimeType,
          'application/json',
        );
        assert.ok(body.systemInstruction.parts[0].text.includes('Grammaire'));
        assert.ok(!JSON.stringify(body).includes('UNTRUSTED_OVERRIDE'));
      } finally {
        global.fetch = previousFetch;
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
        if (previousModel === undefined) delete process.env.GEMINI_MODEL;
        else process.env.GEMINI_MODEL = previousModel;
      }
    },
  );
  console.log('SERVER TESTS PASSED', passed);
  await req('firebase-admin/app').deleteApp(req('firebase-admin/app').getApp());
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  req('firebase-admin/app').deleteApp(req('firebase-admin/app').getApp());
});
