/**
 * RÔLES — source de vérité UNIQUE
 *
 * Deux besoins distincts, souvent confondus et recopiés dans toute l'app :
 *  1) `roleKey(s)`      → une CLÉ normalisée (minuscules + accents retirés + trim)
 *                         pour comparer un libellé de rôle « à l'œil » (recherche,
 *                         `.includes(...)`). Ne mappe PAS vers l'enum.
 *  2) `normalizeRole(s)`→ le MAPPING canonique vers l'enum `UserRole` (gère les
 *                         alias : « Direction/Exploitation » → DIRECTOR,
 *                         « Atelier » → MECHANIC, « Stagiaire » → INTERN, etc.),
 *                         avec un DÉFAUT SÛR = DRIVER (jamais un rôle inconnu tel quel).
 *
 * ⚠️ Ne JAMAIS réécrire une variante locale : la classification de rôle est de
 * l'AUTORISATION. Une copie qui laisse passer un rôle inconnu, ou qui oublie
 * « stagiaire », crée une incohérence de droits d'un écran à l'autre.
 * Importer depuis ici, point.
 */

import { UserRole } from '../types';

/** Clé de comparaison souple d'un libellé de rôle (minuscules, sans accents). */
export const roleKey = (role?: string | UserRole): string =>
  String(role || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();

/**
 * Mappe un libellé de rôle brut vers l'enum `UserRole`.
 * Défaut sécurisé = DRIVER (le rôle le moins privilégié parmi les internes).
 */
export const normalizeRole = (role?: string | UserRole): UserRole => {
  if (!role) return UserRole.DRIVER;
  const r = roleKey(role);

  if (r.includes('admin')) return UserRole.ADMIN;
  if (r.includes('presiden')) return UserRole.PRESIDENT;
  if (r.includes('direction') || r.includes('directeur') || r.includes('exploitation')) return UserRole.DIRECTOR;
  if (r.includes('secret') || r.includes('administra')) return UserRole.SECRETARY;
  if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
  if (r.includes('mecan') || r.includes('mech') || r.includes('atelier')) return UserRole.MECHANIC;
  if (r.includes('client')) return UserRole.CLIENT;
  if (r.includes('stag') || r.includes('intern')) return UserRole.INTERN;

  // Déjà un UserRole valide ?
  if (Object.values(UserRole).includes(role as UserRole)) return role as UserRole;

  return UserRole.DRIVER; // défaut sécurisé
};

/** Le rôle est-il un compte CLIENT (expéditeur) ? */
export const isClientRole = (role?: string | UserRole): boolean =>
  normalizeRole(role) === UserRole.CLIENT;
