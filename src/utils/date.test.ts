import { describe, it, expect } from 'vitest';
import { localDatePart, todayISO, formatDate, formatDateTime } from './date';

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
