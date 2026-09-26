import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { createHash } from 'crypto';

/** Idempotent diagnostic ingestion independent of the browser Firestore cache. */
export async function recordClientErrorsHandler(data: any, context: functions.https.CallableContext, db: Firestore) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Connexion requise.');
  const uid = context.auth.uid;
  if (!Array.isArray(data?.entries) || !data.entries.length || data.entries.length > 20)
    throw new functions.https.HttpsError('invalid-argument', 'Lot de diagnostics invalide.');
  const entries = data.entries.map((entry: any) => {
    if (!entry || typeof entry.referenceId !== 'string' || !/^[\w-]{1,100}$/.test(entry.referenceId) || (entry.userId && entry.userId !== uid))
      throw new functions.https.HttpsError('invalid-argument', 'Référence de diagnostic invalide.');
    const clean: Record<string, unknown> = {};
    for (const [key, max] of Object.entries({ referenceId: 100, context: 100, message: 4000, stack: 12000, url: 600, userAgent: 600, appVersion: 50, createdAt: 40, userName: 150, userRole: 80 }))
      clean[key] = typeof entry[key] === 'string' ? entry[key].slice(0, max) : null;
    clean.level = entry.level === 'warning' ? 'warning' : 'error';
    clean.userId = uid;
    clean.extra = entry.extra && typeof entry.extra === 'object' && JSON.stringify(entry.extra).length <= 24000 ? entry.extra : null;
    clean.receivedAt = new Date().toISOString();
    if (!Number.isFinite(Date.parse(String(clean.createdAt)))) clean.createdAt = clean.receivedAt;
    return { clean, ref: db.collection('error_logs').doc(createHash('sha256').update(`${uid}/${entry.referenceId}`).digest('hex')) };
  });
  await db.runTransaction(async tx => {
    const existing = await tx.getAll(...entries.map((e: any) => e.ref));
    const written = new Set<string>();
    entries.forEach((e: any, i: number) => {
      if (!existing[i].exists && !written.has(e.ref.id)) { tx.create(e.ref, e.clean); written.add(e.ref.id); }
    });
  });
  return { acknowledged: entries.map((e: any) => e.clean.referenceId) };
}
