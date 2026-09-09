import { useEffect, useRef } from 'react';
const POLL_MS = 5 * 60 * 1000;
export function useAutoUpdate(): void {
  const notified = useRef(false);
  useEffect(() => {
    const check = async () => {
      if (notified.current) return;
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const latest = (await res.json())?.buildId;
        if (typeof latest === 'string' && latest && latest !== __BUILD_ID__) {
          notified.current = true;
          // Reload is an explicit user action; never interrupt signatures, imports or pending uploads.
          const banner = document.createElement('div');
          banner.setAttribute('role', 'status');
          banner.className =
            'fixed top-2 left-2 right-2 z-[1200] bg-blue-900 text-white p-3 rounded-lg text-sm';
          banner.textContent =
            'Une mise à jour est disponible. Terminez vos saisies et synchronisations avant de recharger. ';
          const button = document.createElement('button');
          button.textContent = 'Recharger';
          button.className = 'underline font-bold';
          button.onclick = () => {
            if (
              window.confirm(
                'Vos saisies sont-elles enregistrées ? Les envois en attente seront conservés sur cet appareil.',
              )
            )
              window.location.reload();
          };
          banner.appendChild(button);
          document.body.appendChild(banner);
        }
      } catch {
        /* Retenter au prochain passage en ligne. */
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') check();
    };
    check();
    const timer = setInterval(check, POLL_MS);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
}
