import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFile, writeFile } from 'node:fs/promises';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
const projectId = 'demo-fleet-production-audit';
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: '127.0.0.1',
    port: 8189,
    rules: await readFile('firestore.rules', 'utf8'),
  },
});
await env.clearFirestore();
const results = [];
const profiles = {
  clientA: {
    id: 'clientA',
    role: 'Client',
    companyName: 'Société A',
    email: 'a@example.invalid',
    leaveBalance: 0,
  },
  clientB: {
    id: 'clientB',
    role: 'Client',
    companyName: 'Société B',
    email: 'b@example.invalid',
    leaveBalance: 0,
  },
  driverA: {
    id: 'driverA',
    role: 'Chauffeur',
    companyName: 'Interne',
    leaveBalance: 20,
  },
  driverB: {
    id: 'driverB',
    role: 'Chauffeur',
    companyName: 'Interne',
    leaveBalance: 20,
  },
  admin: { id: 'admin', role: 'Admin', companyName: 'Interne' },
};
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, p] of Object.entries(profiles))
    await setDoc(doc(db, 'users', id), p);
  for (const [path, data] of Object.entries({
    'packages/pB': {
      clientId: 'clientB',
      clientName: 'Société B',
      currentDriverId: 'driverB',
      status: 'En livraison',
    },
    'missions/mB': { driverId: 'driverB', status: 'En cours' },
    'proofs_of_delivery/pB': {
      clientId: 'clientB',
      driverId: 'driverB',
      recipientName: 'Fictif',
    },
    'absences/aA': {
      userId: 'driverA',
      type: 'Congés Payés',
      status: 'pending',
    },
    'invitations/iA': {
      invitedBy: 'clientA',
      email: 'future@example.invalid',
      used: false,
      role: 'Client',
    },
    'invitations/iB': {
      invitedBy: 'clientB',
      email: 'future@example.invalid',
      used: false,
      role: 'Client',
    },
  }))
    await setDoc(doc(db, path), data);
});
const db = (id) => env.authenticatedContext(id).firestore();
async function check(name, expected, operation) {
  let outcome = 'allowed',
    code;
  try {
    await operation();
  } catch (e) {
    outcome = e.code === 'permission-denied' ? 'denied' : 'error';
    code = e.code || e.message;
  }
  const result = {
    name,
    expected,
    outcome,
    pass: outcome === expected,
    ...(code ? { code } : {}),
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await check('Self-create privileged profile', 'denied', () =>
  setDoc(doc(db('unprofiled'), 'users', 'unprofiled'), {
    id: 'unprofiled',
    role: 'Admin',
  }),
);
await check('Driver cannot forge server presence timestamp', 'denied', () =>
  updateDoc(doc(db('driverA'), 'users', 'driverA'), { lastSeenAt: '2099-01-01T00:00:00.000Z' }),
);
await check('Legacy client can still record its own opening date', 'allowed', () =>
  updateDoc(doc(db('driverA'), 'users', 'driverA'), { lastLoginAt: '2026-09-24T00:00:00.000Z' }),
);
await check('Client creates privileged invitation', 'denied', () =>
  setDoc(doc(db('clientA'), 'invitations', 'privileged'), {
    invitedBy: 'clientA',
    role: 'Admin',
    userId: 'admin',
    email: 'test@example.invalid',
    used: false,
    token: 'synthetic-audit-token',
  }),
);
await check(
  'Client reads other company package before mutation',
  'denied',
  () => getDoc(doc(db('clientA'), 'packages', 'pB')),
);
await check('Client mutates company security boundary', 'denied', () =>
  updateDoc(doc(db('clientA'), 'users', 'clientA'), {
    companyName: 'Société B',
  }),
);
await check('Client reads other company package after mutation', 'denied', () =>
  getDoc(doc(db('clientA'), 'packages', 'pB')),
);
await check('Client reads unrelated employee profile', 'denied', () =>
  getDoc(doc(db('clientA'), 'users', 'driverB')),
);
await check('Client reads unrelated proof of delivery', 'denied', () =>
  getDoc(doc(db('clientA'), 'proofs_of_delivery', 'pB')),
);
await check('Employee signs acknowledgement for another', 'denied', () =>
  setDoc(doc(db('driverA'), 'documentAcknowledgments', 'fake'), {
    userId: 'driverB',
    documentId: 'internal',
    status: 'SIGNED',
  }),
);
await check('Employee approves own absence', 'denied', () =>
  updateDoc(doc(db('driverA'), 'absences', 'aA'), {
    status: 'approved',
    validatedBy: 'admin',
  }),
);
await check('Employee changes own leave balance', 'denied', () =>
  updateDoc(doc(db('driverA'), 'users', 'driverA'), { leaveBalance: 999 }),
);
await check('Driver overwrites another mission', 'denied', () =>
  updateDoc(doc(db('driverA'), 'missions', 'mB'), { status: 'Terminée' }),
);
await check('Driver overwrites another package', 'denied', () =>
  updateDoc(doc(db('driverA'), 'packages', 'pB'), {
    status: 'Livré',
    currentDriverId: 'driverA',
  }),
);
await check('Client sends arbitrary email through mail queue', 'denied', () =>
  setDoc(doc(db('clientA'), 'mail', 'arbitrary'), {
    to: 'unrelated@example.invalid',
    message: { subject: 'Audit fictif', text: 'No email sent: emulator only' },
  }),
);
await check('Client can read its own invitation list', 'allowed', () =>
  getDocs(
    query(
      collection(db('clientA'), 'invitations'),
      where('invitedBy', '==', 'clientA'),
    ),
  ),
);
await check('Control: driver role update denied', 'denied', () =>
  updateDoc(doc(db('driverA'), 'users', 'driverA'), { role: 'Admin' }),
);
await check('Control: admin legitimate mission update allowed', 'allowed', () =>
  updateDoc(doc(db('admin'), 'missions', 'mB'), { status: 'En cours' }),
);
await check('Driver cannot bypass server closure checks with a direct write', 'denied', () =>
  updateDoc(doc(db('driverB'), 'missions', 'mB'), { status: 'Terminé' }),
);
await check('Office cannot bypass server closure checks with a direct write', 'denied', () =>
  updateDoc(doc(db('admin'), 'missions', 'mB'), { status: 'Terminé' }),
);
await check('Driver cannot create a tour already completed without verification', 'denied', () =>
  setDoc(doc(db('driverB'), 'missions', 'closed-without-proof'), { driverId: 'driverB', status: 'Terminé', stops: [] }),
);
await check(
  'Driver cannot read another employee private profile',
  'denied',
  () => getDoc(doc(db('driverA'), 'users', 'driverB')),
);
await check('Driver can read own profile', 'allowed', () =>
  getDoc(doc(db('driverA'), 'users', 'driverA')),
);
await check('Driver can read own absence', 'allowed', () =>
  getDoc(doc(db('driverA'), 'absences', 'aA')),
);
await check('Driver can acknowledge own document', 'allowed', () =>
  setDoc(doc(db('driverA'), 'documentAcknowledgments', 'real'), {
    userId: 'driverA',
    documentId: 'internal',
    status: 'SIGNED',
  }),
);
await check('Assigned driver can update own package', 'allowed', () =>
  updateDoc(doc(db('driverB'), 'packages', 'pB'), { status: 'Livré' }),
);
await check('Driver cannot alter package customer', 'denied', () =>
  updateDoc(doc(db('driverB'), 'packages', 'pB'), { clientId: 'clientA' }),
);
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'missions', 'pickup'), {
    driverId: 'driverA',
    status: 'En cours',
  });
  await setDoc(doc(ctx.firestore(), 'packages', 'pickup'), {
    missionId: 'pickup',
    currentDriverId: null,
    clientId: 'clientA',
    status: 'En attente',
  });
  await setDoc(doc(ctx.firestore(), 'users', 'disabled'), {
    id: 'disabled',
    role: 'Admin',
    isDisabled: true,
  });
});
await check(
  'Assigned pickup driver can collect unowned package',
  'allowed',
  () =>
    updateDoc(doc(db('driverA'), 'packages', 'pickup'), {
      currentDriverId: 'driverA',
      status: 'Collecté',
    }),
);
await check('Disabled admin cannot update mission', 'denied', () =>
  updateDoc(doc(db('disabled'), 'missions', 'mB'), { status: 'Terminé' }),
);
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'client_tracking', 'a'), {
    clientId: 'clientA',
    clientName: 'Société A',
    missionId: 'mB',
    driverId: 'driverB',
    ranks: { a: 1 },
    liveDriver: { lat: 1, lng: 1 },
  });
  await setDoc(doc(ctx.firestore(), 'quotes', 'offer'), {
    clientId: 'clientA',
    status: 'Offre envoyée',
    priceOffer: 20,
  });
});
await check('Client can read own live tracking', 'allowed', () =>
  getDocs(
    query(
      collection(db('clientA'), 'client_tracking'),
      where('clientId', '==', 'clientA'),
    ),
  ),
);
await check('Client cannot read unrelated tracking', 'denied', () =>
  getDoc(doc(db('clientB'), 'client_tracking', 'a')),
);
await check(
  'Client cannot accept quote without server conversion',
  'denied',
  () =>
    updateDoc(doc(db('clientA'), 'quotes', 'offer'), {
      status: 'Accepté (Commande)',
    }),
);
await check('Client can reject its own offer', 'allowed', () =>
  updateDoc(doc(db('clientA'), 'quotes', 'offer'), { status: 'Refusé' }),
);
await check('Driver cannot forge confirmed scan timestamp', 'denied', () =>
  updateDoc(doc(db('driverB'), 'packages', 'pB'), { lastScannedAt: '2026-09-17T05:00:00Z' }));
await check('Driver cannot forge server scan audit', 'denied', () =>
  setDoc(doc(db('driverA'), 'activity_logs', 'fake-scan'), { userId: 'driverA', action: 'PACKAGE_SCANNED' }));
await check('Client cannot forge scan receipt for replay', 'denied', () =>
  setDoc(doc(db('driverA'), 'scan_requests', 'fake-receipt'), { result: { accepted: true } }));
await check('Driver can still record ordinary field activity', 'allowed', () =>
  setDoc(doc(db('driverA'), 'activity_logs', 'ordinary-field-event'), { userId: 'driverA', action: 'PACKAGE_PICKED_UP' }));
if (process.env.TEST_RESULTS_PATH)
  await writeFile(
    process.env.TEST_RESULTS_PATH,
    JSON.stringify({ projectId, results }, null, 2),
  );
await env.cleanup();
console.log(
  'TOTAL',
  results.length,
  'FAILURES',
  results.filter((r) => !r.pass).length,
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
