import { describe, it, expect } from 'vitest';
import { formatNumberFr, formatEuro, formatWeight, formatDistance, formatDuration } from './format';

// NB : Intl utilise un espace insécable (U+00A0 / U+202F) comme séparateur ;
// on normalise les espaces pour des assertions stables.
const norm = (s: string) => s.replace(/ | /g, ' ');

describe('formatNumberFr', () => {
  it('sépare les milliers', () => {
    expect(norm(formatNumberFr(12345))).toBe('12 345');
    expect(formatNumberFr(NaN)).toBe('0');
  });
});

describe('formatEuro', () => {
  it('2 décimales + symbole €', () => {
    expect(norm(formatEuro(12345.6))).toBe('12 345,60 €');
    expect(norm(formatEuro(0))).toBe('0,00 €');
  });
  it('robuste au non-fini', () => {
    expect(norm(formatEuro(NaN))).toBe('0,00 €');
  });
});

describe('formatWeight / formatDistance', () => {
  it('1 décimale + unité, vide si absent', () => {
    expect(norm(formatWeight(12.5))).toBe('12,5 kg');
    expect(formatWeight(null)).toBe('');
    expect(formatWeight(undefined)).toBe('');
    expect(norm(formatDistance(12.34))).toBe('12,3 km');
  });
});

describe('formatDuration', () => {
  it('min / h / h mm', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(90)).toBe('1 h 30');
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(null)).toBe('');
  });
});
