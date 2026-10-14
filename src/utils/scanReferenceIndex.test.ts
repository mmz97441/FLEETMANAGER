import { describe, expect, it } from 'vitest';
import { carrierBarcodeValidationError, individualReferenceError, parcelScanCodes } from '../../functions/src/scanCode';
describe('canonical parcel references', () => {
  it('indexes case-insensitively without changing original labels or removing zeroes', () => {
    const parcel = { externalId: ' exp-a/00042 ', carrierBarcode: '000012345678', barcode: 'Exp-A/00042', orderNumber: 'cmd-X' };
    expect(parcelScanCodes(parcel)).toEqual(['000012345678', 'CMD-X', 'EXP-A/00042']);
    expect(parcel.externalId).toBe(' exp-a/00042 ');
    expect(individualReferenceError('000012345678')).toBeNull();
    expect(individualReferenceError(12345678)).toMatch(/cellule texte/);
    expect(individualReferenceError('x\nabc')).toBeTruthy();
  });
  it('applies Boiron constraints only for the explicitly selected format', () => {
    expect(carrierBarcodeValidationError('exp-a/00042', '')).toBeNull();
    expect(carrierBarcodeValidationError('000012345678', '')).toBeNull();
    expect(carrierBarcodeValidationError('exp-a/00042', '', 'boiron')).toMatch(/22 chiffres/);
    expect(carrierBarcodeValidationError('0014085834301322930101', '14085834', 'boiron')).toBeNull();
    expect(carrierBarcodeValidationError('0014085834301322930101', '14085835', 'boiron')).toMatch(/commande/);
  });
});
