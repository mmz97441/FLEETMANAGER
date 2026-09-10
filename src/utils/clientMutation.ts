export type ClientMutationAudit = (action: string, phase: 'requested' | 'confirmed' | 'unconfirmed') => Promise<void>;

/** Audit intent before dispatch. A failed result log must never turn a confirmed write into a retry. */
export async function runClientMutation<T>(options: { readOnly: boolean; audit?: ClientMutationAudit; onAuditFailure?: () => void }, action: string, operation: () => Promise<T>): Promise<T> {
  if (options.readOnly) throw new Error('Consultation en lecture seule. Activez « Intervenir pour ce client » avant toute modification.');
  if (options.audit) {
    try { await options.audit(action, 'requested'); }
    catch { throw new Error('Le journal de l’intervention est indisponible. Aucune modification n’a été lancée ; réessayez.'); }
  }
  let result: T;
  try { result = await operation(); }
  catch (error) {
    try { await options.audit?.(action, 'unconfirmed'); } catch { options.onAuditFailure?.(); }
    throw error;
  }
  try { await options.audit?.(action, 'confirmed'); } catch { options.onAuditFailure?.(); }
  return result;
}
