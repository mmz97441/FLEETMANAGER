import { it, expect } from 'vitest';
import { officeViewParams, readOfficeSavedViews } from './officeSavedViews';

it('never retains a query, dated context, entity ID or bulk selection in an office bookmark', () => {
  expect(officeViewParams({ tab: 'packages', sort: 'contactName', dir: 'asc', q: 'Personne privée', date: '2020-01-01', package: 'P1', mission: 'M1', selected: ['P1'], url: 'https://example.invalid' })).toEqual({ tab: 'packages', sort: 'contactName', dir: 'asc' });
});
it('rejects corrupted values and unknown filters without breaking the current page', () => {
  expect(readOfficeSavedViews('{bad')).toEqual([]);
  expect(readOfficeSavedViews('[{"id":"1","label":"Vue","params":{"tab":"admin","sort":"unknown"}}]')).toEqual([]);
  expect(officeViewParams({ tab: 'missions', status: '<script>', zone: { value: 'NORD' } })).toEqual({ tab: 'missions' });
});
