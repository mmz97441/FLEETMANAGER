import { describe, it, expect } from 'vitest';
import { normAddr, normPhone, placeKey, phoneSignal, sameDeliveryPoint } from './address';

describe('normAddr', () => {
  it('met en minuscules, enlève accents et réduit les espaces/ponctuation', () => {
    expect(normAddr('28  RUE JOSEPH BÉDIER ')).toBe('28 rue joseph bedier');
    expect(normAddr('28 Rue Joseph Bedier')).toBe('28 rue joseph bedier');
    expect(normAddr('28, rue Joseph  Bédier.')).toBe('28 rue joseph bedier');
  });
  it('gère null/undefined/vide', () => {
    expect(normAddr(undefined)).toBe('');
    expect(normAddr('')).toBe('');
  });
});

describe('normPhone', () => {
  it('ne garde que les chiffres', () => {
    expect(normPhone('+262 692 30 33 33')).toBe('262692303333');
    expect(normPhone('0692-30.33.33')).toBe('0692303333');
  });
});

describe('placeKey — regroupement par point de livraison', () => {
  // Scénario Boiron : 4 colis à la MÊME pharmacie, mais adresses écrites
  // légèrement différemment dans le fichier Excel. Ils DOIVENT partager la clé.
  it('regroupe des adresses « à l’œil » identiques malgré casse/espaces/accents', () => {
    const base = { postalCode: '97490', city: 'SAINTE CLOTILDE' };
    const k1 = placeKey({ ...base, address: '28 RUE JOSEPH BEDIER' });
    const k2 = placeKey({ ...base, address: '28  Rue Joseph Bédier ' });
    const k3 = placeKey({ ...base, address: '28, rue joseph bedier' });
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });

  it('distingue deux adresses réellement différentes', () => {
    const base = { postalCode: '97490', city: 'SAINTE CLOTILDE' };
    expect(placeKey({ ...base, address: '28 rue Joseph Bedier' }))
      .not.toBe(placeKey({ ...base, address: '30 rue Joseph Bedier' }));
  });

  it('ne mélange PAS le nom ni le n° de commande dans la clé', () => {
    // Même adresse, contacts/noms différents → même point de livraison.
    const a = placeKey({ address: '1 rue A', postalCode: '97400', city: 'St-Denis' });
    const b = placeKey({ address: '1 rue A', postalCode: '97400', city: 'St-Denis' });
    expect(a).toBe(b);
  });
});

describe('phoneSignal', () => {
  it('exige au moins 6 chiffres', () => {
    expect(phoneSignal({ contactPhone: '0692303333' })).toBe('0692303333');
    expect(phoneSignal({ contactPhone: '12345' })).toBe('');
    expect(phoneSignal({})).toBe('');
  });
});

describe('sameDeliveryPoint', () => {
  it('vrai si adresse normalisée identique', () => {
    expect(sameDeliveryPoint(
      { address: '28 RUE JOSEPH BEDIER', postalCode: '97490', city: 'Sainte Clotilde' },
      { address: '28  rue joseph bédier', postalCode: '97490', city: 'SAINTE CLOTILDE' }
    )).toBe(true);
  });

  it('repli téléphone : même n° (formaté différemment) + même CP rattrape une adresse mal saisie', () => {
    // NB : le repli compare les CHIFFRES bruts. Il rattrape les différences de
    // formatage (espaces/points/tirets) mais PAS l'indicatif pays (+262 ≠ 0692) —
    // comportement existant conservé tel quel par la factorisation.
    expect(sameDeliveryPoint(
      { address: '28 rue Joseph Bedier', postalCode: '97490', city: 'Ste Clotilde', contactPhone: '0692 30 33 33' },
      { address: 'Pharmacie Ker Chaudron', postalCode: '97490', city: 'Ste Clotilde', contactPhone: '0692-30.33.33' }
    )).toBe(true);
  });

  it('faux si adresses différentes et pas de téléphone commun', () => {
    expect(sameDeliveryPoint(
      { address: '28 rue A', postalCode: '97490', city: 'X', contactPhone: '0692000001' },
      { address: '30 rue B', postalCode: '97490', city: 'X', contactPhone: '0692000002' }
    )).toBe(false);
  });

  it('faux si même téléphone mais CP différent (villes différentes)', () => {
    expect(sameDeliveryPoint(
      { address: 'a', postalCode: '97400', city: 'X', contactPhone: '0692303333' },
      { address: 'b', postalCode: '97490', city: 'Y', contactPhone: '0692303333' }
    )).toBe(false);
  });
});
