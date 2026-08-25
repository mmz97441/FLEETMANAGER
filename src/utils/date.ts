/**
 * DATES — source de vérité UNIQUE
 *
 * Bug historique : ~30 sites faisaient `new Date().toISOString().split('T')[0]`
 * pour « aujourd'hui ». `toISOString()` renvoie l'UTC ; à La Réunion (UTC+4)
 * l'UTC est EN RETARD de 4h → de 00h à 04h locales, le « jour » calculé était
 * encore celui de la VEILLE (UTC). Les tournées/colis « du jour » pouvaient donc
 * être cherchés sur la mauvaise date. Ici on calcule le jour LOCAL de l'appareil.
 *
 * ⚠️ Ne JAMAIS réécrire une variante locale : importer todayISO/localDatePart.
 */

/** Partie date (AAAA-MM-JJ) d'un instant, dans le fuseau LOCAL de l'appareil. */
export const localDatePart = (d: Date | string | number): string => {
  // Chaîne DÉJÀ date-only (AAAA-MM-JJ) : c'est une date calendaire sans heure ni
  // fuseau → on la renvoie telle quelle (sinon `new Date('2026-08-25')` la parse
  // en UTC minuit et un fuseau Ouest la décalerait d'un jour).
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  // On retranche l'offset pour que .toISOString() (UTC) rende le jour LOCAL.
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

/** Date du jour (AAAA-MM-JJ) dans le fuseau LOCAL. Remplace toISOString().split('T')[0]. */
export const todayISO = (): string => localDatePart(new Date());

/** Formate une date en jj/mm/aaaa (fr-FR). Garde-fou : '—' si invalide/absent. */
export const formatDate = (value?: string | number | Date | null): string => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

/** Formate en « jj/mm/aaaa à hh:mm » (fr-FR). Garde-fou : '—' si invalide/absent. */
export const formatDateTime = (value?: string | number | Date | null): string => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
