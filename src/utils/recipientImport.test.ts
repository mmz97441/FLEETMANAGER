import { describe, expect, it } from 'vitest';
import { parseRecipientImport, addressBookIdentity, addressBookFieldErrors } from './recipientImport';
import type { SavedAddress } from '../types';
const row = { Nom:'Pharmacie A', Adresse:'1 rue Test', 'Code postal':'97400', Ville:'Saint-Denis', Téléphone:'0262000000', Consignes:'Portail au fond' };
const saved = { contactName:'Pharmacie A', address:'1 rue Test', city:'97400 Saint-Denis', contactPhone:'0262000000', type:'delivery' } as SavedAddress;
describe('recipient import shares the authoritative address identity', () => {
  it('keeps different recipients with a common switchboard and identical names in different towns', () => {
    const rows = parseRecipientImport([row,{...row,Nom:'Pharmacie B'},{...row,Ville:'Saint-Paul','Code postal':'97460'}],[]);
    expect(rows.map(row=>row._status)).toEqual(['ok','ok','ok']);
    expect(rows[0].notes).toBe('Portail au fond');
  });
  it('extends pickup usage instead of rejecting an existing pickup-only address', () => {
    expect(parseRecipientImport([row],[{...saved,type:'pickup'}])[0]._status).toBe('ok');
    expect(parseRecipientImport([row],[saved])[0]._status).toBe('duplicate');
  });
  it('normalizes punctuation, accents and space identically on server and import', () => {
    const same = {...saved,contactName:' PHARMACIE À ', address:'1, rue TEST',city:'97400 Saint Denis'};
    expect(addressBookIdentity(same)).toBe(addressBookIdentity(saved));
    expect(parseRecipientImport([row,{...row,Nom:'PHARMACIE À'}],[])[1]._status).toBe('duplicate');
  });
  it('requires a complete municipality and code without imposing a Reunion-only range', () => {
    expect(parseRecipientImport([{...row,Ville:'Paris','Code postal':'75001'}],[])[0]._status).toBe('ok');
    expect(parseRecipientImport([{...row,Ville:'','Code postal':'97400'}],[])[0]._status).toBe('invalid');
    expect(addressBookFieldErrors({...saved,city:'Saint-Denis'})).toHaveProperty('city');
  });
  it('retains optional instructions and source line numbers for corrections and replay', () => {
    const {Consignes,...without}=row;
    expect(parseRecipientImport([{...without,Instructions:'Entrée B',__rowNum__:9}],[])[0]).toMatchObject({notes:'Entrée B',line:10});
  });
});
