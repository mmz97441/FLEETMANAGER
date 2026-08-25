import { describe, it, expect } from 'vitest';
import { cleanUndefined } from './firestore';

describe('cleanUndefined', () => {
  it('retire les undefined de premier niveau', () => {
    expect(cleanUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('conserve null (accepté par Firestore)', () => {
    expect(cleanUndefined({ a: null, b: undefined })).toEqual({ a: null });
  });

  it('retire les undefined IMBRIQUÉS dans un tableau d’objets (cas stops[])', () => {
    const input = { stops: [{ id: '1', phone: undefined, name: 'A' }, { id: '2', name: 'B' }] };
    expect(cleanUndefined(input)).toEqual({ stops: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] });
  });

  it('récursif en profondeur', () => {
    const input = { a: { b: { c: undefined, d: 2 } } };
    expect(cleanUndefined(input)).toEqual({ a: { b: { d: 2 } } });
  });

  it('laisse les primitives intactes', () => {
    expect(cleanUndefined(5)).toBe(5);
    expect(cleanUndefined('x')).toBe('x');
    expect(cleanUndefined(true)).toBe(true);
  });
});
