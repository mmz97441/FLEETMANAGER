"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addressBookIdentity = void 0;
exports.addressBookFieldErrors = addressBookFieldErrors;
const deliveryAddress_1 = require("./deliveryAddress");
const shipmentContract_1 = require("./shipmentContract");
/** A shared phone or building never identifies a recipient on its own. */
const addressBookIdentity = (address) => JSON.stringify([(0, deliveryAddress_1.normAddr)(address.contactName), (0, deliveryAddress_1.normAddr)(address.address), (0, deliveryAddress_1.normAddr)(address.city)]);
exports.addressBookIdentity = addressBookIdentity;
/** SavedAddress retains its historical combined postal-code/city field. */
function addressBookFieldErrors(address) {
    const city = (address.city || '').trim(), codes = city.match(/\b\d{5}\b/g) || [];
    const errors = (0, shipmentContract_1.shipmentFieldErrors)({ ...address, postalCode: codes.length === 1 ? codes[0] : '', city: city.replace(/\b\d{5}\b/g, '').trim() });
    if (errors.postalCode || errors.city)
        errors.city = 'Indiquez un code postal à 5 chiffres et la ville (ex. 97400 Saint-Denis).';
    delete errors.postalCode;
    return errors;
}
//# sourceMappingURL=addressBookIdentity.js.map