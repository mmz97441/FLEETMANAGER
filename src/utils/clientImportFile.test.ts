import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { decodeClientCsv } from './clientImportFile';

describe('client CSV reading', () => {
  it('preserves accented UTF-8 headers without a BOM and telephone leading zero', () => {
    const csv = 'Numéro de colis,Téléphone,Destinataire\nBR0001,0262123456,Pharmacie Réunion';
    const workbook = XLSX.read(decodeClientCsv(new TextEncoder().encode(csv).buffer), { type: 'string', raw: true });
    expect(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])).toEqual([{ 'Numéro de colis': 'BR0001', Téléphone: '0262123456', Destinataire: 'Pharmacie Réunion' }]);
  });
  it('supports UTF-8 BOM', () => {
    expect(decodeClientCsv(new TextEncoder().encode('\ufeffTéléphone').buffer)).toBe('Téléphone');
  });
  it('supports legacy Windows-1252 when the bytes are not valid UTF-8', () => {
    expect(decodeClientCsv(new Uint8Array([84, 233, 108, 233, 112, 104, 111, 110, 101]).buffer)).toBe('Téléphone');
  });
});
