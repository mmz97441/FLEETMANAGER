import { describe, it, expect, vi } from 'vitest';
import { localDatePart, todayISO, daysUntilCalendarDate, isPastLocalDate, formatDate, formatDateTime } from './date';

const pad = (n: number) => String(n).padStart(2, '0');

describe('localDatePart', () => {
  it('renvoie le jour LOCAL (pas UTC) d’un instant', () => {
    const d = new Date();
    const expectedLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(localDatePart(d)).toBe(expectedLocal);
  });

  it('accepte une chaîne ISO et un timestamp', () => {
    const iso = '2026-08-25T10:00:00.000Z';
    const d = new Date(iso);
    const expectedLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(localDatePart(iso)).toBe(expectedLocal);
    expect(localDatePart(d.getTime())).toBe(expectedLocal);
  });

  it('renvoie une chaîne date-only telle quelle (tous fuseaux, pas de décalage)', () => {
    expect(localDatePart('2026-08-25')).toBe('2026-08-25');
    expect(localDatePart('2026-01-01')).toBe('2026-01-01');
  });

  it('renvoie "" pour une date invalide', () => {
    expect(localDatePart('pas une date')).toBe('');
    expect(localDatePart('')).toBe('');
  });
});

describe('todayISO', () => {
  it('est au format AAAA-MM-JJ et = jour local courant', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const d = new Date();
    expect(todayISO()).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  });
});

describe('isPastLocalDate', () => {
  it.each([
    ['hier au début du jour', '2026-09-11', 0, 1, true],
    ['aujourd’hui au début du jour', '2026-09-12', 0, 1, false],
    ['demain au début du jour', '2026-09-13', 0, 1, false],
    ['hier à la fin du jour', '2026-09-11', 23, 59, true],
    ['aujourd’hui à la fin du jour', '2026-09-12', 23, 59, false],
    ['demain à la fin du jour', '2026-09-13', 23, 59, false],
  ] as const)('%s', (_label, dueDate, hour, minute, expected) => {
    expect(isPastLocalDate(dueDate, new Date(2026, 8, 12, hour, minute, 59, 999))).toBe(expected);
  });

  it('passe en retard au début du jour local suivant, y compris au changement d’année', () => {
    expect(isPastLocalDate('2026-12-31', new Date(2026, 11, 31, 23, 59, 59, 999))).toBe(false);
    expect(isPastLocalDate('2026-12-31', new Date(2027, 0, 1, 0, 0))).toBe(true);
  });

  it('utilise par défaut le jour local de l’appareil', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 12, 23, 59));
      expect(isPastLocalDate('2026-09-12')).toBe(false);
      expect(isPastLocalDate('2026-09-11')).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('ne signale pas une échéance absente ou une date invalide comme dépassée', () => {
    for (const value of [null, undefined, '', 'invalide', new Date('invalide')]) {
      expect(isPastLocalDate(value)).toBe(false);
    }
    expect(isPastLocalDate('2026-09-11', new Date('invalide'))).toBe(false);
  });
});

describe('daysUntilCalendarDate', () => {
  it.each([0, 23])('renvoie −1/0/+1 à %s h locales', hour => {
    const reference = new Date(2026, 8, 12, hour, 59);
    expect(daysUntilCalendarDate('2026-09-11', reference)).toBe(-1);
    expect(daysUntilCalendarDate('2026-09-12', reference)).toBe(0);
    expect(daysUntilCalendarDate('2026-09-13', reference)).toBe(1);
  });

  it.each([[2026, 2, 8, '2026-03-09'], [2026, 10, 1, '2026-11-02']] as const)('compte le lendemain calendaire indépendamment de la durée du jour local', (year, month, day, nextDay) => {
    expect(daysUntilCalendarDate(nextDay, new Date(year, month, day, 0, 1))).toBe(1);
    expect(daysUntilCalendarDate(nextDay, new Date(year, month, day, 23, 59))).toBe(1);
  });

  it('distingue explicitement une échéance inconnue de zéro jour restant', () => {
    for (const value of [null, undefined, '', 'invalide', '2026-02-30', '2026-13-01', new Date('invalide')]) {
      expect(daysUntilCalendarDate(value)).toBeNull();
      expect(isPastLocalDate(value)).toBe(false);
    }
    expect(daysUntilCalendarDate('2026-09-11', new Date('invalide'))).toBeNull();
  });
});

describe('formatDate / formatDateTime', () => {
  it('garde-fou : "—" si absent ou invalide', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('pas une date')).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('nope')).toBe('—');
  });

  it('formate une date valide en fr-FR', () => {
    // 25/08/2026 (on vérifie la présence des composantes, indépendamment du fuseau)
    const out = formatDate('2026-08-25T10:00:00.000Z');
    expect(out).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    const dt = formatDateTime('2026-08-25T10:00:00.000Z');
    expect(dt).toMatch(/\d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/);
  });
});
