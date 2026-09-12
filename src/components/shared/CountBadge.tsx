/** Navigation counts indicate workload, not incident severity. */
export default function CountBadge({ count, active = false, dark = false, compact = false }: { count: number; active?: boolean; dark?: boolean; compact?: boolean }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const exact = count.toLocaleString('fr-FR');
  return <span className={`ui-count ${active ? 'ui-count-active' : dark ? 'ui-count-dark' : 'ui-count-neutral'}`} aria-label={`${exact} élément${count > 1 ? 's' : ''} à traiter`} title={`${exact} élément${count > 1 ? 's' : ''} à traiter`}>
    {compact && count > 99 ? '99+' : exact}
  </span>;
}
