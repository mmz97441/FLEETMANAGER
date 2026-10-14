export type ClientMutationPhase = 'requested' | 'confirmed' | 'unconfirmed' | 'cancelled';
export type ClientMutationAudit = ((action: string, phase: ClientMutationPhase) => Promise<void>) & {
  assertActive?: () => void;
  beginOperation?: () => { dispatched: () => void; finish: () => void };
};

/** Audit intent before dispatch. A failed result log must never turn a confirmed write into a retry. */
export async function runClientMutation<T>(options: { readOnly: boolean; audit?: ClientMutationAudit; onAuditFailure?: () => void }, action: string, operation: () => Promise<T>): Promise<T> {
  if (options.readOnly) throw new Error('Consultation en lecture seule. Activez « Intervenir pour ce client » avant toute modification.');
  options.audit?.assertActive?.();
  const tracked = options.audit?.beginOperation?.();
  try {
    if (options.audit) {
      try { await options.audit(action, 'requested'); }
      catch { throw new Error('Le journal de l’intervention est indisponible. Aucune modification n’a été lancée ; réessayez.'); }
      try { options.audit.assertActive?.(); }
      catch (error) {
        try { await options.audit(action, 'cancelled'); } catch { options.onAuditFailure?.(); }
        throw error;
      }
    }
    tracked?.dispatched();
    let result: T;
    try { result = await operation(); }
    catch (error) {
      try { await options.audit?.(action, 'unconfirmed'); } catch { options.onAuditFailure?.(); }
      throw error;
    }
    try { await options.audit?.(action, 'confirmed'); } catch { options.onAuditFailure?.(); }
    return result;
  } finally {
    tracked?.finish();
  }
}

/** Synchronous revocation prevents a waiting intent from starting a mutation.
 * An operation already dispatched remains tracked until its result is audited. */
export function createInterventionScope(identityCurrent: () => boolean) {
  let active = true;
  const operations = new Map<symbol, boolean>();
  const listeners = new Set<() => void>();
  let snapshot = { active, waiting: 0, dispatched: 0 };
  const publish = () => {
    snapshot = { active, waiting: [...operations.values()].filter(value => !value).length, dispatched: [...operations.values()].filter(Boolean).length };
    listeners.forEach(listener => listener());
  };
  const assertActive = () => {
    if (!active || !identityCurrent()) throw new Error('L’intervention est terminée ou la session a changé. Aucune modification n’a été lancée.');
  };
  return {
    assertActive,
    stop: () => { active = false; publish(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    beginOperation: () => {
      assertActive();
      const key = Symbol(); operations.set(key, false); publish();
      return { dispatched: () => { assertActive(); operations.set(key, true); publish(); }, finish: () => { operations.delete(key); publish(); } };
    },
  };
}
