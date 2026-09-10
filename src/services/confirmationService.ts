export type Confirmation = { title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Request = Confirmation & { resolve: (value: boolean) => void };
const listeners = new Set<(request: Request) => void>();
export function subscribeConfirmations(listener: (request: Request) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function confirmAction(confirmation: Confirmation): Promise<boolean> {
  // Standalone component previews can still protect drafts without an app host.
  if (!listeners.size) return Promise.resolve(window.confirm(`${confirmation.title}\n\n${confirmation.message}`));
  return new Promise(resolve => { for (const listener of listeners) listener({ ...confirmation, resolve }); });
}
