import { describe, expect, it } from 'vitest';
import { earliestRequestedTime, requestedDateTimeLabel } from './requestedDateTime';

describe('requested date inputs use Réunion time', () => {
  it('bases the minimum on local operating hours, including the day rollover', () => {
    expect(earliestRequestedTime(new Date('2026-10-14T10:30:00Z'), 2)).toBe('2026-10-14T16:30');
    expect(earliestRequestedTime(new Date('2026-10-14T11:30:00Z'), 2)).toBe('2026-10-15T08:00');
    expect(earliestRequestedTime('2026-10-14T14:30', 3)).toBe('2026-10-15T08:00');
  });
  it('confirms the exact requested calendar day and hour', () => {
    expect(requestedDateTimeLabel('2026-10-14T20:30:00Z')).toBe('15/10/2026 à 00:30 (La Réunion)');
    expect(requestedDateTimeLabel('2026-10-15T00:30')).toBe('15/10/2026 à 00:30 (La Réunion)');
  });
});
