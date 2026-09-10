"use strict";
/**
 * POINT DE LIVRAISON — source de vérité UNIQUE
 *
 * « Deux colis vont-ils au même endroit ? » est une règle métier critique
 * (elle sécurise le nombre exact de colis à déposer chez le client). Elle doit
 * être définie ICI, une seule fois, et importée partout : dispatch (gmproService),
 * transfert en route (missionService), import client (importService) et filet de
 * sécurité chauffeur (DriverMissionView).
 *
 * ⚠️ Ne JAMAIS réécrire une variante locale de ces fonctions. Toute duplication
 * finit par diverger (cf. bug Boiron v4.2.1 : une copie non normalisée du
 * dispatch splittait 4 colis d'une même adresse en 4 arrêts). Si la règle doit
 * changer, elle change ICI et nulle part ailleurs.
 *
 * Règle : on regroupe par ADRESSE + CP + VILLE (normalisés), avec un renfort
 * TÉLÉPHONE (même tél + même CP = même client, rattrape les fautes de frappe).
 * JAMAIS par n° de commande ni par nom de contact (trop variables entre imports).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameDeliveryPoint = exports.phoneSignal = exports.placeKey = exports.normPhone = exports.normAddr = void 0;
/**
 * Normalise un libellé d'adresse pour comparer deux écritures « à l'œil »
 * identiques : minuscules, accents retirés, ponctuation/espaces multiples
 * réduits à un seul espace. Ex. "28  RUE JOSEPH BÉDIER " → "28 rue joseph bedier".
 */
const normAddr = (s) => (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[^a-z0-9]+/g, ' ') // ponctuation → espace
    .trim();
exports.normAddr = normAddr;
/** Téléphone → chiffres uniquement (retire espaces, +, points, tirets…). */
const normPhone = (s) => (s || '').replace(/\D/g, '');
exports.normPhone = normPhone;
/**
 * Clé de regroupement d'un point de livraison : adresse + CP + ville normalisés.
 * Deux colis avec la même clé = même arrêt. JAMAIS le nom ni le n° de commande.
 */
const placeKey = (p) => `${(0, exports.normAddr)(p.address)}|${(p.postalCode || '').trim()}|${(0, exports.normAddr)(p.city)}`;
exports.placeKey = placeKey;
/** Téléphone exploitable comme signal de regroupement (≥ 6 chiffres), sinon ''. */
const phoneSignal = (p) => {
    const s = (0, exports.normPhone)(p.contactPhone);
    return s.length >= 6 ? s : '';
};
exports.phoneSignal = phoneSignal;
/**
 * Deux points = même livraison ? Adresse identique OU (même téléphone + même CP).
 * Le repli téléphone rattrape les adresses mal saisies pour un même client.
 */
const sameDeliveryPoint = (a, b) => {
    if ((0, exports.placeKey)(a) === (0, exports.placeKey)(b))
        return true;
    const pa = (0, exports.phoneSignal)(a), pb = (0, exports.phoneSignal)(b);
    return !!pa && pa === pb && (a.postalCode || '').trim() === (b.postalCode || '').trim();
};
exports.sameDeliveryPoint = sameDeliveryPoint;
//# sourceMappingURL=deliveryAddress.js.map