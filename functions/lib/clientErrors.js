"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordClientErrorsHandler = recordClientErrorsHandler;
const functions = __importStar(require("firebase-functions/v1"));
const crypto_1 = require("crypto");
/** Idempotent diagnostic ingestion independent of the browser Firestore cache. */
async function recordClientErrorsHandler(data, context, deps) {
    const { id: uid } = await deps.requireActiveCaller(context);
    const { db } = deps;
    if (!Array.isArray(data?.entries) || !data.entries.length || data.entries.length > 20)
        throw new functions.https.HttpsError('invalid-argument', 'Lot de diagnostics invalide.');
    const entries = data.entries.map((entry) => {
        if (!entry || typeof entry.referenceId !== 'string' || !/^[\w-]{1,100}$/.test(entry.referenceId) || (entry.userId && entry.userId !== uid))
            throw new functions.https.HttpsError('invalid-argument', 'Référence de diagnostic invalide.');
        const clean = {};
        for (const [key, max] of Object.entries({ referenceId: 100, context: 100, message: 4000, stack: 12000, url: 600, userAgent: 600, appVersion: 50, createdAt: 40, userName: 150, userRole: 80 }))
            clean[key] = typeof entry[key] === 'string' ? entry[key].slice(0, max) : null;
        clean.level = entry.level === 'warning' ? 'warning' : 'error';
        clean.userId = uid;
        clean.extra = entry.extra && typeof entry.extra === 'object' && JSON.stringify(entry.extra).length <= 24000 ? entry.extra : null;
        clean.receivedAt = new Date().toISOString();
        if (!Number.isFinite(Date.parse(String(clean.createdAt))))
            clean.createdAt = clean.receivedAt;
        return { clean, ref: db.collection('error_logs').doc((0, crypto_1.createHash)('sha256').update(`${uid}/${entry.referenceId}`).digest('hex')) };
    });
    await db.runTransaction(async (tx) => {
        const existing = await tx.getAll(...entries.map((e) => e.ref));
        const written = new Set();
        entries.forEach((e, i) => {
            if (!existing[i].exists && !written.has(e.ref.id)) {
                tx.create(e.ref, e.clean);
                written.add(e.ref.id);
            }
        });
    });
    return { acknowledged: entries.map((e) => e.clean.referenceId) };
}
//# sourceMappingURL=clientErrors.js.map