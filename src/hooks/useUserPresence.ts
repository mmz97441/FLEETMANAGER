import { useEffect } from 'react';
import { recordUserPresence } from '../services/presenceService';
import { reportError } from '../services/logService';
import { createPresencePublisher } from '../utils/presence';

export function useUserPresence(uid?: string) {
  useEffect(() => {
    if (!uid) return;
    const publisher = createPresencePublisher({
      send: login => recordUserPresence(uid, login),
      visible: () => navigator.onLine && document.visibilityState === 'visible',
      report: error => reportError('auth.presence', error, { silent: true, extra: { profileUid: uid } }),
    });
    const push = () => { void publisher.tick(); };
    push();
    const timer = window.setInterval(push, 60000);
    window.addEventListener('online', push);
    document.addEventListener('visibilitychange', push);
    return () => {
      publisher.stop();
      window.clearInterval(timer);
      window.removeEventListener('online', push);
      document.removeEventListener('visibilitychange', push);
    };
  }, [uid]);
}
