/**
 * Temps écoulé en français : "à l'instant", "il y a 5 min", "il y a 3 h",
 * "il y a 2 jours"… À partir d'une date ISO, relatif à maintenant.
 */
export const timeAgo = (iso?: string): string => {
  if (!iso) return 'Jamais connecté';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '—';
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 0) return "à l'instant";
  if (sec < 60) return "à l'instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j < 30) return `il y a ${j} jour${j > 1 ? 's' : ''}`;
  const mois = Math.floor(j / 30);
  if (mois < 12) return `il y a ${mois} mois`;
  const ans = Math.floor(mois / 12);
  return `il y a ${ans} an${ans > 1 ? 's' : ''}`;
};

/** Date + heure absolue en français (pour le title/tooltip). */
export const formatDateTimeFr = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
