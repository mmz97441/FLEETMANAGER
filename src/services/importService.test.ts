import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { PackageStatus, Zone, type User } from '../types';
const { save, batch, read } = vi.hoisted(() => ({ save: vi.fn(), batch: vi.fn(), read: vi.fn() }));
vi.mock('./missionService', () => ({
  getZoneFromPostalCode: async () => 'Nord', extractPostalCodeFromAddress: () => '97400',
  getHubByZone: async () => null, addPackagesBatch: save, addImportBatch: batch, getPackagesByIds: read,
}));
import { parseExcelForReview, confirmReviewedImport, type ReviewRow } from './importService';
const file = (carrier: string | number) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Id: 'BR9010', Address: '1 RUE FICTIVE,97400,SAINT DENIS', Order_Number: 'BR9010', Contact: 'Fictif', Référence: '14085834', 'Code Boiron': carrier }]), 'Colis');
  return { name: 'test.xlsx', data: XLSX.write(workbook, { type: 'binary', bookType: 'xlsx' }) } as unknown as File;
};
beforeEach(() => {
  save.mockReset(); batch.mockReset(); read.mockReset();
  vi.stubGlobal('FileReader', class {
    onload?: (event: unknown) => void;
    readAsBinaryString(file: { data: string }) { this.onload?.({ target: { result: file.data } }); }
  });
});
afterEach(() => vi.unstubAllGlobals());
it('the office Excel path preserves native carton codes and rejects numeric rounded cells', async () => {
  const good = await parseExcelForReview(file('0014085834301322930101'));
  expect(good.rows[0].carrierBarcode).toBe('0014085834301322930101'); expect(good.rows[0].clientReference).toBe('14085834');
  expect(good.errorCount).toBe(0);
  const damaged = await parseExcelForReview(file(14085834301322930101));
  expect(damaged.errorCount).toBe(1); expect(damaged.rows[0]._errors.join(' ')).toMatch(/numérique/);
});
it('a partial office import records the missing rows and does not redispatch an existing delivered parcel', async () => {
  const { rows } = await parseExcelForReview(file('0014085834301322930101'));
  rows.push({ ...rows[0], _rowIndex: 3, externalId: 'BR9011', _status: 'error', _errors: ['Adresse manquante'] });
  save.mockResolvedValue(['existing']); batch.mockResolvedValue('batch');
  read.mockResolvedValue([{ ...rows[0], id: 'existing', clientId: 'c', status: PackageStatus.DELIVERED, zone: Zone.NORD, missionId: 'finished-tour', barcode: 'original-label' }]);
  const result = await confirmReviewedImport(rows, { id: 'c', companyName: 'Fictif' } as User, { id: 'office' } as User, 'test.xlsx');
  expect(save.mock.calls[0][1].rejectedRows).toBe(1);
  expect(batch.mock.calls[0][0].status).toBe('Incomplet'); expect(result.successCount).toBe(1);
  expect(result.zoneBreakdown.flatMap(zone => zone.packageIds)).toEqual([]);
  expect(result.packages[0].barcode).toBe('original-label');
});
it('office import cannot report success when a returned parcel cannot be read back', async () => {
  const { rows } = await parseExcelForReview(file('0014085834301322930101'));
  save.mockResolvedValue(['missing']); read.mockResolvedValue([]);
  await expect(confirmReviewedImport(rows, { id: 'c' } as User, { id: 'office' } as User, 'test.xlsx')).rejects.toThrow('relus');
  expect(batch).not.toHaveBeenCalled();
});
