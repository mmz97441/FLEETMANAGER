"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validLogisticsProofMedia = validLogisticsProofMedia;
/** Storage rules authorize uploads; this binds a submitted URL to that exact
 * parcel/stop's immutable media directory and this Firebase project. */
function validLogisticsProofMedia(value, prefix) {
    if (typeof value !== 'string' || value.length > 4000)
        return false;
    try {
        const url = new URL(value);
        const emulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST && ['127.0.0.1', 'localhost'].includes(url.hostname);
        if (!emulator && (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'))
            return false;
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
        const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
        if (!match || !project || ![`${project}.appspot.com`, `${project}.firebasestorage.app`].includes(match[1]))
            return false;
        const path = decodeURIComponent(match[2]);
        return path.startsWith(prefix) && path.length > prefix.length && !path.split('/').includes('..');
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=logisticsProofMedia.js.map