import { describe, expect, it } from 'vitest';
import { StopStatus, type MissionStop } from '../types';
import { recalculateStopEtas } from './routeTiming';

const stop = (fields: Partial<MissionStop> = {}): MissionStop => ({
  id: 's', sequence: 1, type: 'DELIVERY', status: StopStatus.PENDING,
  address: 'Rue', postalCode: '97400', city: 'Saint-Denis', contactName: 'Client',
  packageIds: ['p'], packageCount: 1, serviceTime: 5, ...fields,
});
const at = (time: string) => `2026-09-10T${time}:00+04:00`;
const iso = (time: string) => new Date(at(time)).toISOString();

describe('recalculateStopEtas', () => {
  it('arrives after travel and serves the previous stop before the next leg', () => {
    const result = recalculateStopEtas([
      stop({ durationFromPrevious: 30 }),
      stop({ durationFromPrevious: 20, serviceTime: 10 }),
    ], at('08:00'));
    expect(result[0]).toMatchObject({ estimatedArrival: iso('08:30'), estimatedDeparture: iso('08:35') });
    expect(result[1]).toMatchObject({ estimatedArrival: iso('08:55'), estimatedDeparture: iso('09:05') });
  });

  it('waits until a customer window opens and carries that waiting into subsequent ETAs', () => {
    const result = recalculateStopEtas([
      stop({ durationFromPrevious: 30, timeWindowStart: '09:00' }),
      stop({ durationFromPrevious: 20 }),
    ], at('08:15'));
    expect(result[0].estimatedArrival).toBe(iso('09:00'));
    expect(result[1].estimatedArrival).toBe(iso('09:25'));
  });

  it('does not preserve idle waiting after a late departure', () => {
    const [result] = recalculateStopEtas([stop({ durationFromPrevious: 30, timeWindowStart: '09:00' })], at('09:30'));
    expect(result.estimatedArrival).toBe(iso('10:00'));
  });

  it('preserves legacy travel by shifting an existing schedule when leg durations are absent', () => {
    const [result] = recalculateStopEtas([stop({ estimatedArrival: at('08:30') })], at('09:00'), at('08:00'));
    expect(result.estimatedArrival).toBe(iso('09:30'));
  });

  it('does not publish an invented immediate ETA when travel and its baseline are unknown', () => {
    const result = recalculateStopEtas([
      stop({ estimatedArrival: at('08:30'), estimatedDeparture: at('08:35') }),
      stop({ durationFromPrevious: 20 }),
    ], at('09:00'));
    for (const item of result) {
      expect(item).not.toHaveProperty('estimatedArrival');
      expect(item).not.toHaveProperty('estimatedDeparture');
    }
  });

  it('honors zero travel and zero service without replacing them with defaults', () => {
    const result = recalculateStopEtas([stop({ durationFromPrevious: 0, serviceTime: 0 }), stop({ durationFromPrevious: 0 })], at('08:00'));
    expect(result[0].estimatedDeparture).toBe(iso('08:00'));
    expect(result[1].estimatedArrival).toBe(iso('08:00'));
  });

  it('uses the Réunion calendar day for windows even when the UTC date is different', () => {
    const [result] = recalculateStopEtas([stop({ durationFromPrevious: 30, timeWindowStart: '03:00' })], '2026-09-09T21:30:00Z');
    expect(result.estimatedArrival).toBe(iso('03:00'));
  });

  it('leaves input stops untouched', () => {
    const original = stop({ durationFromPrevious: 30, estimatedArrival: at('08:30') });
    const before = structuredClone(original);
    recalculateStopEtas([original], at('09:00'), at('08:00'));
    expect(original).toEqual(before);
  });
});
