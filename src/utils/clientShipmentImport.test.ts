import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseClientShipmentWorkbook } from './clientShipmentImport';
import { sameDeliveryVisit } from './address';
const row = { 'Numéro de colis': 'GEN-0001', Destinataire: 'Pharmacie A', Adresse: '10 rue Test', 'Code postal': '97400', Ville: 'Saint-Denis', Téléphone: '0262000000' };
function parse(rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Colis');
  return parseClientShipmentWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), 'colis.xlsx');
}
describe('client import contract', () => {
  it.each(['Ville', 'Code postal'])('identifies a missing %s on its source row', field => {
    const result = parse([{ ...row, [field]: '' }]);
    expect(result.rows[0].line).toBe(2); expect(result.rows[0].errors).not.toHaveLength(0);
  });
  it('preserves incompatible windows, durations, dates and floor from the file', () => {
    const { rows } = parse([{ ...row, Start: '08:00', End: '09:00', Service_Time: 20, 'Date de livraison': '2026-10-20', Étage: 0 }, { ...row, 'Numéro de colis': 'GEN-0002', Start: '14:00', End: '15:00', Service_Time: 15, 'Date de livraison': '2026-10-21', Étage: 2 }]);
    expect(rows.every(row => !row.errors.length)).toBe(true);
    expect(rows[0]).toMatchObject({ requestedDeliveryDate: '2026-10-20', timeWindowStart: '08:00', timeWindowEnd: '09:00', serviceTime: '20', floor: '0' });
    expect(rows[1]).toMatchObject({ requestedDeliveryDate: '2026-10-21', serviceTime: '15', floor: '2' });
    expect(sameDeliveryVisit({ ...rows[0], floor: undefined }, { ...rows[1], floor: undefined })).toBe(false);
  });
  it('recognizes Excel date/time cells and French written dates', () => {
    const { rows } = parse([{ ...row, 'Date de livraison': 46315, Start: 0.375, End: 0.5 }, { ...row, 'Numéro de colis': 'GEN-0002', 'Date de livraison': '21/10/2026', Start: '9:00', End: '12:00' }]);
    expect(rows[0]).toMatchObject({ requestedDeliveryDate: '2026-10-20', timeWindowStart: '09:00', timeWindowEnd: '12:00' });
    expect(rows[1]).toMatchObject({ requestedDeliveryDate: '2026-10-21', timeWindowStart: '09:00' });
  });
  it('reports unsupported columns instead of silently implying they were imported', () => {
    expect(parse([{ ...row, 'Température obligatoire': '2 °C' }]).ignoredColumns).toEqual(['Température obligatoire']);
  });
  it('keeps generic leading zeros and rejects ambiguous numeric references', () => {
    expect(parse([{ ...row, 'Numéro de colis': '0000123', 'Code transporteur': '000987' }]).rows[0]).toMatchObject({ colisNumber: '0000123', carrierBarcode: '000987', errors: [] });
    expect(parse([{ ...row, 'Numéro de colis': 123 }]).rows[0].errors.join(' ')).toMatch(/numérique/);
  });
  it('reports invalid date, window and service on the same line', () => {
    const errors = parse([{ ...row, 'Date de livraison': '2026-02-30', Start: '14:00', End: '08:00', Service_Time: 0 }]).rows[0].errors;
    expect(errors).toHaveLength(3);
  });
});
