import { expect, it } from 'vitest';
import { trendClasses, trendLabel, trendTone } from './uiTrend';

it('does not imply better performance for a volume increase or decrease without a declared goal', () => {
  expect(trendTone(25)).toBe('neutral');
  expect(trendTone(-25)).toBe('neutral');
  expect(trendTone(0, 'higher-is-better')).toBe('neutral');
  expect(trendTone(NaN, 'lower-is-better')).toBe('neutral');
  expect(trendLabel(-25)).toBe('Baisse de 25 %');
  expect(trendLabel(0)).toBe('Stable');
});

it('colours an explicitly meaningful comparison while retaining its actual direction', () => {
  expect(trendTone(-15, 'lower-is-better')).toBe('positive');
  expect(trendTone(15, 'lower-is-better')).toBe('negative');
  expect(trendTone(15, 'higher-is-better')).toBe('positive');
  expect(trendClasses[trendTone(15, 'neutral')]).toBe('text-slate-600');
});
