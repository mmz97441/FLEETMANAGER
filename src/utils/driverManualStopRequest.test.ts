import { describe, expect, it } from 'vitest';
import { makeDriverManualStopRequest } from './driverManualStopRequest';
import { createStopForm, stopFormPayload } from './missionStopForm';
import { stopStatusLabel } from './operationalLabels';
import { StopStatus } from '../types';

const form = { contactName: ' Client fictif ', address: ' Rue fictive ', postalCode: '97400', city: ' Saint-Denis ', contactPhone: '' };

describe('driver manual-stop recovery adapter', () => {
  it('uses the complete office journal shape with a stable normalized payload', () => {
    const request = makeDriverManualStopRequest({ id: 'tour', date: '2026-09-10' }, form, 'request-12345678');
    expect(request.requestId).toBe('request-12345678');
    expect(Object.keys(request.form).sort()).toEqual(Object.keys(createStopForm()).sort());
    expect(stopFormPayload(request.form)).toMatchObject({ contactName: 'Client fictif', address: 'Rue fictive', city: 'Saint-Denis', serviceTime: 5 });
    expect(stopFormPayload(JSON.parse(JSON.stringify(request)).form)).toEqual(stopFormPayload(request.form));
  });
  it('does not promise a new schedule for a skipped stop', () => {
    expect(stopStatusLabel(StopStatus.SKIPPED)).toBe('Non effectué');
  });
});
