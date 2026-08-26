import { describe, it, expect } from 'vitest';
import { packageMatchesCode, matchScansToPackages, packageScanCodes } from './barcode';

describe('packageMatchesCode', () => {
  it('matche sur externalId (BR…), y compris via DataMatrix enrichi', () => {
    const p = { externalId: 'BR1352', orderNumber: '13881963' };
    expect(packageMatchesCode(p, 'BR1352')).toBe(true);
    expect(packageMatchesCode(p, 'br1352')).toBe(true);
    expect(packageMatchesCode(p, 'PREFIX-BR1352-002')).toBe(true); // payload 2D + rang
  });
  it('colis sans aucun code → ne matche jamais', () => {
    expect(packageScanCodes({})).toEqual([]);
    expect(packageMatchesCode({}, 'BR1352')).toBe(false);
  });
});

describe('matchScansToPackages (assignation 1:1, anti sur-comptage)', () => {
  it('un colis par scan distinct — codes distincts', () => {
    const pkgs = [
      { id: 'a', externalId: 'BR1', orderNumber: 'CMD9' },
      { id: 'b', externalId: 'BR2', orderNumber: 'CMD9' },
    ];
    const m = matchScansToPackages(pkgs, ['BR1', 'BR2']);
    expect(m.size).toBe(2);
    expect(m.has('a') && m.has('b')).toBe(true);
  });

  it('orderNumber PARTAGÉ scanné une fois → 1 seul colis compté (pas de sur-comptage)', () => {
    const pkgs = [
      { id: 'a', externalId: 'BR1', orderNumber: '13881963' },
      { id: 'b', externalId: 'BR2', orderNumber: '13881963' },
      { id: 'c', externalId: 'BR3', orderNumber: '13881963' },
    ];
    // Le chauffeur scanne le code commande partagé une seule fois
    const m = matchScansToPackages(pkgs, ['13881963']);
    expect(m.size).toBe(1); // AVANT le fix : aurait compté 3
  });

  it('re-scanner le même code n’ajoute pas un 2e colis', () => {
    const pkgs = [
      { id: 'a', externalId: 'BR1' },
      { id: 'b', externalId: 'BR1' }, // 2 colis même code (indistinguables)
    ];
    const m = matchScansToPackages(pkgs, ['BR1', 'BR1']);
    expect(m.size).toBe(1); // scans identiques → 1 seul assigné
  });

  it('colis dont le seul code est orderNumber reste scannable', () => {
    const pkgs = [{ id: 'a', orderNumber: '13950359' }];
    const m = matchScansToPackages(pkgs, ['13950359']);
    expect(m.size).toBe(1);
  });

  it('matching MAXIMUM : ne sous-compte pas un couplage réalisable (bug du glouton)', () => {
    // A a 2 codes {BR1, CMD100}, B n’a que {CMD100}. Scans dans l’ordre défavorable.
    const pkgs = [
      { id: 'a', externalId: 'BR1', orderNumber: 'CMD100' },
      { id: 'b', orderNumber: 'CMD100' },
    ];
    const m = matchScansToPackages(pkgs, ['CMD100', 'BR1']);
    expect(m.size).toBe(2); // glouton donnait 1 ; matching biparti donne 2
    expect(m.has('a') && m.has('b')).toBe(true);
  });
});
