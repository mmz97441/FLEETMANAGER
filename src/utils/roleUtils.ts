import { UserRole } from '../types';

/**
 * Normalise un rôle utilisateur vers l'enum UserRole.
 * Gère les variations d'accents, de casse et de formulation.
 *
 * Handles:
 *   - admin
 *   - president / président
 *   - directeur / direction / director / exploitation
 *   - secrétariat / secretariat / secret / administra
 *   - chauffeur / driver
 *   - mécanicien / mecanicien / mech / atelier
 *   - client
 *   - stagiaire / intern / stag
 *
 * Unicode is normalized (NFD + strip combining marks) so accented
 * variants like "président" or "mécanicien" are handled transparently.
 *
 * Falls back to UserRole.DRIVER when no pattern matches and the raw
 * value is not already a valid UserRole enum member.
 */
export const normalizeRole = (role: string | UserRole): UserRole => {
  if (!role) return UserRole.DRIVER;

  const r = String(role)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (r.includes('admin')) return UserRole.ADMIN;
  if (r.includes('presiden')) return UserRole.PRESIDENT;
  if (r.includes('direction') || r.includes('directeur') || r.includes('exploitation')) return UserRole.DIRECTOR;
  if (r.includes('secret') || r.includes('administra')) return UserRole.SECRETARY;
  if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
  if (r.includes('mecan') || r.includes('mech') || r.includes('atelier')) return UserRole.MECHANIC;
  if (r.includes('client')) return UserRole.CLIENT;
  if (r.includes('stag') || r.includes('intern')) return UserRole.INTERN;

  // If the value is already a valid UserRole enum member, return it as-is
  if (Object.values(UserRole).includes(role as UserRole)) {
    return role as UserRole;
  }

  return UserRole.DRIVER;
};
