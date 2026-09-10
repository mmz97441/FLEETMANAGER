import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getMetadata } from 'firebase/storage';
const env = await initializeTestEnvironment({
  projectId: 'demo-fleet-production-audit',
  firestore: { host: '127.0.0.1', port: 8189 },
  storage: {
    host: '127.0.0.1',
    port: 9199,
    rules: await readFile('storage.rules', 'utf8'),
  },
});
let passed = 0;
try {
  // rules-unit-testing clearStorage() deletes root items only; nested proofs
  // survive and correctly fail the next run's immutable-create rule.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const removeTree = async (directory) => {
      const { items, prefixes } = await directory.listAll();
      await Promise.all(prefixes.map(removeTree));
      await Promise.all(items.map((item) => item.delete()));
    };
    await removeTree(ctx.storage().ref());
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [id, role] of [
      ['storage-driver', 'Chauffeur'],
      ['storage-other', 'Chauffeur'],
      ['storage-client', 'Client'],
      ['storage-director', 'Directeur Exploitation'],
    ])
      await setDoc(doc(ctx.firestore(), 'users', id), { id, role });
    await setDoc(doc(ctx.firestore(), 'users', 'storage-disabled'), {
      role: 'Admin',
      isDisabled: true,
    });
    await setDoc(doc(ctx.firestore(), 'missions', 'storage-mission'), {
      driverId: 'storage-driver',
    });
    await setDoc(doc(ctx.firestore(), 'absences', 'storage-absence'), {
      userId: 'storage-driver',
    });
  });
  const storage = (id) => env.authenticatedContext(id).storage();
  const put = (id, path, type = 'image/png') =>
    uploadBytes(ref(storage(id), path), new Uint8Array([1, 2, 3]), {
      contentType: type,
    });
  const check = async (name, expectation, operation) => {
    await expectation(operation());
    passed++;
    console.log('PASS', name);
  };
  await check('assigned driver can upload delivery proof', assertSucceeds, () =>
    put('storage-driver', 'pod/storage-mission/stop/proof.png'),
  );
  await check('proof files cannot be overwritten', assertFails, () =>
    put('storage-driver', 'pod/storage-mission/stop/proof.png'),
  );
  await check(
    'another driver cannot upload proof on this mission',
    assertFails,
    () => put('storage-other', 'pod/storage-mission/stop/other.png'),
  );
  await check('another driver cannot read proof', assertFails, () =>
    getMetadata(
      ref(storage('storage-other'), 'pod/storage-mission/stop/proof.png'),
    ),
  );
  await check('client cannot list an unrelated proof', assertFails, () =>
    getMetadata(
      ref(storage('storage-client'), 'pod/storage-mission/stop/proof.png'),
    ),
  );
  await check(
    'Director Exploitation can upload invoice PDF',
    assertSucceeds,
    () =>
      put(
        'storage-director',
        'invoices/vehicle/invoice.pdf',
        'application/pdf',
      ),
  );
  await check('HTML upload is refused', assertFails, () =>
    put('storage-director', 'invoices/vehicle/invoice.html', 'text/html'),
  );
  await check(
    'employee can upload own absence attachment',
    assertSucceeds,
    () =>
      put(
        'storage-driver',
        'absences/storage-absence/attachment.pdf',
        'application/pdf',
      ),
  );
  await check('colleague cannot read medical attachment', assertFails, () =>
    getMetadata(
      ref(storage('storage-other'), 'absences/storage-absence/attachment.pdf'),
    ),
  );
  await check('disabled administrator cannot upload files', assertFails, () =>
    put('storage-disabled', 'invoices/vehicle/disabled.png'),
  );
  console.log('STORAGE TESTS PASSED', passed);
} finally {
  await env.cleanup();
}
