import { expect, it } from 'vitest';
import { trendClasses, trendLabel, trendPercent, trendTone } from './uiTrend';

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

it('does not report stability or performance without a usable comparison baseline', () => {
  for (const [current, previous] of [[270, 0], [0, 0], [NaN, 180], [270, Infinity]]) {
    const value = trendPercent(current, previous);
    expect(trendLabel(value)).toBe('Comparaison indisponible');
    expect(trendTone(value, 'lower-is-better')).toBe('neutral');
  }
  expect(trendLabel(trendPercent(180, 180))).toBe('Stable');
  expect(trendPercent(270, 180)).toBe(50);
  expect(trendPercent(0, 180)).toBe(-100);
});
