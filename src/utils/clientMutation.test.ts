import { describe, expect, it, vi } from 'vitest';
import { createInterventionScope, runClientMutation, type ClientMutationAudit } from './clientMutation';

describe('client consultation and intervention', () => {
  it('blocks every operation and audit in read-only consultation', async () => {
    const write = vi.fn(), audit = vi.fn();
    await expect(runClientMutation({ readOnly: true, audit }, 'import', write)).rejects.toThrow('lecture seule');
    expect(write).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  });
  it('keeps the normal client workflow operational without an intervention audit', async () => {
    const write = vi.fn().mockResolvedValue({ id: 'existing-reference' });
    expect(await runClientMutation({ readOnly: false }, 'create', write)).toEqual({ id: 'existing-reference' });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('awaits the persisted intent before dispatching a real write', async () => {
    const sequence: string[] = [];
    await runClientMutation({ readOnly: false, audit: async (_, phase) => { sequence.push(phase); } }, 'update', async () => { sequence.push('write'); });
    expect(sequence).toEqual(['requested', 'write', 'confirmed']);
  });
  it('does not dispatch when the audit of intent is refused', async () => {
    const write = vi.fn();
    await expect(runClientMutation({ readOnly: false, audit: vi.fn().mockRejectedValue(new Error('permission-denied')) }, 'update', write)).rejects.toThrow('Aucune modification');
    expect(write).not.toHaveBeenCalled();
  });
  it('preserves confirmed business success if the result log fails, avoiding a duplicate retry', async () => {
    const audit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const warning = vi.fn();
    expect(await runClientMutation({ readOnly: false, audit, onAuditFailure: warning }, 'create', async () => 'same-reference')).toBe('same-reference');
    expect(warning).toHaveBeenCalledOnce();
  });
  it('keeps an uncertain service failure uncertain and preserves the original error', async () => {
    const error = new Error('response lost'); const audit = vi.fn().mockResolvedValue(undefined);
    await expect(runClientMutation({ readOnly: false, audit }, 'create', async () => { throw error; })).rejects.toBe(error);
    expect(audit.mock.calls).toEqual([['create', 'requested'], ['create', 'unconfirmed']]);
  });
  it('cancels an intent awaiting its audit when the intervention is stopped', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const scope = createInterventionScope(() => true), phases: string[] = [], write = vi.fn();
    const audit: ClientMutationAudit = Object.assign(async (_: string, phase: string) => { phases.push(phase); if (phase === 'requested') await gate; }, scope);
    const pending = runClientMutation({ readOnly: false, audit }, 'update', write);
    expect(scope.getSnapshot()).toEqual({ active: true, waiting: 1, dispatched: 0 });
    scope.stop(); release();
    await expect(pending).rejects.toThrow('terminée');
    expect(write).not.toHaveBeenCalled(); expect(phases).toEqual(['requested', 'cancelled']);
    expect(scope.getSnapshot()).toEqual({ active: false, waiting: 0, dispatched: 0 });
  });
  it('rechecks authenticated identity after the audit instead of dispatching in a new session', async () => {
    let current = true;
    const scope = createInterventionScope(() => current), write = vi.fn();
    const audit: ClientMutationAudit = Object.assign(async (_: string, phase: string) => { if (phase === 'requested') current = false; }, scope);
    await expect(runClientMutation({ readOnly: false, audit }, 'update', write)).rejects.toThrow('session');
    expect(write).not.toHaveBeenCalled();
  });
  it('keeps a dispatched operation observable through stopping and its confirmed result', async () => {
    let release!: () => void;
    const gate = new Promise<string>(resolve => { release = () => resolve('saved'); });
    const scope = createInterventionScope(() => true), phases: string[] = [];
    const audit: ClientMutationAudit = Object.assign(async (_: string, phase: string) => { phases.push(phase); }, scope);
    const pending = runClientMutation({ readOnly: false, audit }, 'update', () => gate);
    await Promise.resolve();
    expect(scope.getSnapshot().dispatched).toBe(1);
    scope.stop(); expect(scope.getSnapshot().dispatched).toBe(1);
    release(); expect(await pending).toBe('saved');
    expect(phases).toEqual(['requested', 'confirmed']); expect(scope.getSnapshot().dispatched).toBe(0);
  });
});
