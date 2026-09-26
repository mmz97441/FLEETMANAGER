export const PRESENCE_TTL_MS = 3 * 60 * 1000;
export function connectionStatus(user: { lastSeenAt?: string; isDisabled?: boolean }, now = Date.now()) {
  if (user.isDisabled) return 'disabled';
  const lastSeen = Date.parse(user.lastSeenAt || '');
  if (!Number.isFinite(lastSeen) || lastSeen > now + 60000) return 'unknown';
  return now - lastSeen < PRESENCE_TTL_MS ? 'online' : 'offline';
}

/** No GPS dependency and no logout write: another tab/device may still be open. */
export function createPresencePublisher(deps: {
  send: (login: boolean) => Promise<void>;
  visible: () => boolean;
  report: (error: unknown) => void;
}) {
  let stopped = false, sending = false, login = true, lastSuccess = 0, reported = false;
  let generation = 0, startedAt = 0;
  return {
    async tick(now = Date.now()) {
      if (!deps.visible()) { generation++; sending = false; return; }
      if (sending && now - startedAt >= 20000) { generation++; sending = false; }
      if (stopped || sending || !deps.visible() || now - lastSuccess < 45000) return;
      sending = true;
      startedAt = now;
      const attempt = ++generation;
      try {
        await deps.send(login);
        if (!stopped && attempt === generation) { login = false; lastSuccess = now; reported = false; }
      } catch (error) {
        if (!stopped && attempt === generation && !reported) { reported = true; deps.report(error); }
      } finally { if (attempt === generation) sending = false; }
    },
    stop() { stopped = true; generation++; },
  };
}
