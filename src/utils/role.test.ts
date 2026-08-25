import { describe, it, expect } from 'vitest';
import { roleKey, normalizeRole, isClientRole } from './role';
import { UserRole } from '../types';

describe('roleKey', () => {
  it('minuscules + accents retirés + trim', () => {
    expect(roleKey('  Directeur Exploitation ')).toBe('directeur exploitation');
    expect(roleKey('Sécrétariat')).toBe('secretariat');
    expect(roleKey(undefined)).toBe('');
  });
});

describe('normalizeRole', () => {
  it('mappe les alias vers l’enum', () => {
    expect(normalizeRole('Direction')).toBe(UserRole.DIRECTOR);
    expect(normalizeRole('Directeur Exploitation')).toBe(UserRole.DIRECTOR);
    expect(normalizeRole('exploitation')).toBe(UserRole.DIRECTOR);
    expect(normalizeRole('Atelier')).toBe(UserRole.MECHANIC);
    expect(normalizeRole('mécanicien')).toBe(UserRole.MECHANIC);
    expect(normalizeRole('Stagiaire')).toBe(UserRole.INTERN);
    expect(normalizeRole('Secrétariat')).toBe(UserRole.SECRETARY);
    expect(normalizeRole('Secrétaire')).toBe(UserRole.SECRETARY);
    // NB comportement existant préservé : « Administrateur » contient "admin"
    // → ADMIN (la branche "administra"→SECRETARY est donc inatteignable, dead code).
    expect(normalizeRole('Administrateur')).toBe(UserRole.ADMIN);
    expect(normalizeRole('Chauffeur')).toBe(UserRole.DRIVER);
    expect(normalizeRole('Client')).toBe(UserRole.CLIENT);
  });

  it('DÉFAUT SÛR = DRIVER pour vide / inconnu (jamais un rôle inconnu tel quel)', () => {
    expect(normalizeRole('')).toBe(UserRole.DRIVER);
    expect(normalizeRole(undefined)).toBe(UserRole.DRIVER);
    expect(normalizeRole('RôleInexistant')).toBe(UserRole.DRIVER);
  });

  it('accepte un UserRole déjà valide', () => {
    expect(normalizeRole(UserRole.PRESIDENT)).toBe(UserRole.PRESIDENT);
  });
});

describe('isClientRole', () => {
  it('vrai seulement pour les comptes client', () => {
    expect(isClientRole('Client')).toBe(true);
    expect(isClientRole('client')).toBe(true);
    expect(isClientRole('Chauffeur')).toBe(false);
    expect(isClientRole(undefined)).toBe(false);
  });
});
