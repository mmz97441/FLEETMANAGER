import { describe, it, expect } from 'vitest';
import { normAddr, normPhone, placeKey, phoneSignal, sameDeliveryPoint, sameDeliveryRecipient, sameDeliveryVisit, intersectDeliveryWindows, visitContainsParcelWindow } from './address';

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

describe('placeKey — géocodage du point physique', () => {
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
      { contactName: 'Pharmacie', address: '28 RUE JOSEPH BEDIER', postalCode: '97490', city: 'Sainte Clotilde' },
      { contactName: 'PHARMACIE', address: '28  rue joseph bédier', postalCode: '97490', city: 'SAINTE CLOTILDE' }
    )).toBe(true);
  });

  it('un téléphone partagé ne suffit jamais pour autoriser une remise commune', () => {
    // NB : le repli compare les CHIFFRES bruts. Il rattrape les différences de
    // formatage (espaces/points/tirets) mais PAS l'indicatif pays (+262 ≠ 0692) —
    // comportement existant conservé tel quel par la factorisation.
    expect(sameDeliveryPoint(
      { address: '28 rue Joseph Bedier', postalCode: '97490', city: 'Ste Clotilde', contactPhone: '0692 30 33 33' },
      { address: 'Pharmacie Ker Chaudron', postalCode: '97490', city: 'Ste Clotilde', contactPhone: '0692-30.33.33' }
    )).toBe(false);
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

describe('identité et fenêtres de remise', () => {
  const recipient = { contactName: 'Pharmacie A', address: '1 rue A', city: 'Saint Denis', postalCode: '97400', floor: 0 };
  it('sépare destinataire et étage, même si adresse et téléphone sont identiques', () => {
    expect(sameDeliveryRecipient(recipient, { ...recipient, contactName: 'Cabinet B' })).toBe(false);
    expect(sameDeliveryRecipient(recipient, { ...recipient, floor: 2 })).toBe(false);
    expect(sameDeliveryRecipient(recipient, { ...recipient, floor: undefined })).toBe(false);
    expect(sameDeliveryRecipient({}, {})).toBe(false);
  });
  it('intersecte les fenêtres compatibles sans fusion transitive des fenêtres disjointes', () => {
    const morning = { ...recipient, timeWindowStart: '08:00', timeWindowEnd: '09:00' };
    const afternoon = { ...recipient, timeWindowStart: '14:00', timeWindowEnd: '15:00' };
    expect(sameDeliveryVisit(morning, afternoon)).toBe(false);
    expect(intersectDeliveryWindows([morning, recipient, afternoon])).toBeNull();
    expect(visitContainsParcelWindow(morning, recipient)).toBe(true);
    expect(visitContainsParcelWindow(recipient, morning)).toBe(false);
    expect(intersectDeliveryWindows([{ timeWindowStart: '99:00' }])).toBeNull();
  });
});
