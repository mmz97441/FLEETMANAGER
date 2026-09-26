import { expect, it, vi } from 'vitest';
import { isStorageFailure } from './storageRecovery';
it('recognizes cursor and Firestore failures without treating ordinary network errors as damaged storage', () => {
  expect(isStorageFailure(new Error("Attempt to iterate a cursor that doesn't exist"))).toBe(true);
  expect(isStorageFailure('FIRESTORE (12.18.0) INTERNAL ASSERTION FAILED: Unexpected state')).toBe(true);
  expect(isStorageFailure(new Error('functions/deadline-exceeded'))).toBe(false);
});
it('signals one recovery notice for a cascade without clearing any storage', async () => {
  vi.resetModules(); const { subscribeStorageFailure, noteStorageFailure, hasStorageFailure } = await import('./storageRecovery');
  const listener = vi.fn(), stop = subscribeStorageFailure(listener);
  for (let i = 0; i < 40; i++) noteStorageFailure("Attempt to iterate a cursor that doesn't exist");
  expect(listener).toHaveBeenCalledTimes(1); expect(hasStorageFailure()).toBe(true); stop();
});
