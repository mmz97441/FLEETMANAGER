"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameDeliveryVisit = exports.sameDeliveryPoint = exports.sameDeliveryRecipient = exports.recipientKey = exports.phoneSignal = exports.placeKey = exports.normPhone = exports.normAddr = void 0;
exports.intersectDeliveryWindows = intersectDeliveryWindows;
exports.visitContainsParcelWindow = visitContainsParcelWindow;
const normAddr = (s) => (s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
exports.normAddr = normAddr;
const normPhone = (s) => (s || '').replace(/\D/g, '');
exports.normPhone = normPhone;
/** Address-only key is suitable for geocoding, never for recipient grouping. */
const placeKey = (p) => `${(0, exports.normAddr)(p.address)}|${(p.postalCode || '').trim()}|${(0, exports.normAddr)(p.city)}`;
exports.placeKey = placeKey;
const phoneSignal = (p) => { const s = (0, exports.normPhone)(p.contactPhone); return s.length >= 6 ? s : ''; };
exports.phoneSignal = phoneSignal;
const recipientKey = (p) => `${(0, exports.placeKey)(p)}|${(0, exports.normAddr)(p.contactName)}|${String(p.floor ?? '')}`;
exports.recipientKey = recipientKey;
const sameDeliveryRecipient = (a, b) => !!(0, exports.normAddr)(a.address) && !!a.postalCode?.trim() && !!(0, exports.normAddr)(a.city) && !!(0, exports.normAddr)(a.contactName) && (0, exports.recipientKey)(a) === (0, exports.recipientKey)(b);
exports.sameDeliveryRecipient = sameDeliveryRecipient;
/** Legacy callers now use the same strict recipient identity. */
exports.sameDeliveryPoint = exports.sameDeliveryRecipient;
const minute = (value, fallback) => !value ? fallback :
    /^([01]?\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.split(':')[0]) * 60 + Number(value.split(':')[1]) : NaN;
const clock = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
function intersectDeliveryWindows(points) {
    const start = Math.max(0, ...points.map(p => minute(p.timeWindowStart, 0)));
    const end = Math.min(1440, ...points.map(p => minute(p.timeWindowEnd, 1440)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
        return null;
    return { ...(points.some(p => p.timeWindowStart) ? { timeWindowStart: clock(start) } : {}),
        ...(points.some(p => p.timeWindowEnd) ? { timeWindowEnd: clock(end) } : {}) };
}
const sameDeliveryVisit = (a, b) => (0, exports.sameDeliveryRecipient)(a, b) && intersectDeliveryWindows([a, b]) !== null;
exports.sameDeliveryVisit = sameDeliveryVisit;
/** A planned visit must fit inside every parcel's promised window. */
function visitContainsParcelWindow(visit, parcel) {
    const start = minute(visit.timeWindowStart, 0), end = minute(visit.timeWindowEnd, 1440);
    return start < end && start >= minute(parcel.timeWindowStart, 0) && end <= minute(parcel.timeWindowEnd, 1440);
}
//# sourceMappingURL=deliveryAddress.js.map