import { describe, it, expect } from 'vitest';
import { createStopForm, validateStopForm, stopFormPayload } from './missionStopForm';

const valid = () => ({ ...createStopForm(), contactName: 'Destinataire', address: '12 rue Test', postalCode: '97400', city: 'Saint-Denis' });
describe('stop editing validation', () => {
  it('rejects blank required values, including spaces, without restoring prior data', () => {
    expect(validateStopForm({ ...valid(), address: '   ', contactName: '' })).toMatchObject({ address: expect.any(String), contactName: expect.any(String) });
  });
  it.each(['', '0', '-1', '1.5', '5minutes', '481'])('rejects invalid duration %s', serviceTime => {
    expect(validateStopForm({ ...valid(), serviceTime }).serviceTime).toBeTruthy();
  });
  it.each([['10:00', '09:00'], ['10:00', '10:00'], ['10:00', ''], ['', '12:00'], ['25:00', '26:00']])('rejects invalid or partial window %s–%s', (timeWindowStart, timeWindowEnd) => {
    expect(Object.keys(validateStopForm({ ...valid(), timeWindowStart, timeWindowEnd })).length).toBeGreaterThan(0);
  });
  it('allows a full valid window and explicit removal of optional values', () => {
    const form = { ...valid(), address: ' 12 rue Test ', timeWindowStart: '08:00', timeWindowEnd: '10:00', serviceTime: '12' };
    expect(validateStopForm(form)).toEqual({});
    expect(stopFormPayload(form)).toMatchObject({ address: '12 rue Test', contactPhone: null, notes: null, serviceTime: 12 });
  });
  it('does not replace an existing zero with a hidden default', () => {
    expect(createStopForm({ serviceTime: 0 }).serviceTime).toBe('0');
    expect(validateStopForm({ ...valid(), serviceTime: '0' }).serviceTime).toBeTruthy();
  });
});
