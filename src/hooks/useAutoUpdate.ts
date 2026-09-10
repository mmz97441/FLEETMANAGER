import { useEffect, useState } from 'react';
const POLL_MS = 5 * 60 * 1000;
/** Announce in the app layout. Never reload or cover an active form automatically. */
export function useAutoUpdate(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const latest = (await response.json())?.buildId;
        if (active && typeof latest === 'string' && latest && latest !== __BUILD_ID__) setAvailable(true);
      } catch { /* A later check retries when the device is online. */ }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    const timer = window.setInterval(check, POLL_MS);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return available;
}
