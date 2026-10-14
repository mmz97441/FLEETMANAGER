export interface ImportBatchConfirmation { ids: string[]; offset: number }
export class ImportBatchFailure extends Error {
  constructor(public confirmedIds: string[], public offset: number, public count: number, public outcome: 'unknown' | 'rejected' | 'confirmed', public cause: unknown) {
    super(`${confirmedIds.length} ligne(s) enregistrée(s). ${cause instanceof Error ? cause.message : 'La confirmation de l’import a échoué.'} Reprenez les mêmes références pour vérifier sans doublon.`);
    this.name = 'ImportBatchFailure';
  }
  get confirmedCount() { return this.confirmedIds.length; }
}
/** A callable transaction is atomic, but a file spans several transactions. */
export async function writeImportBatches<T>(rows: T[], send: (rows: T[]) => Promise<{ ids: string[] }>, onConfirmed?: (confirmation: ImportBatchConfirmation) => void | Promise<void>): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < rows.length; offset += 75) {
    const batch = rows.slice(offset, offset + 75);
    let received = false;
    try {
      const result = await send(batch);
      if (!Array.isArray(result.ids) || result.ids.length !== batch.length || result.ids.some(id => typeof id !== 'string' || !id)) throw new Error('La confirmation du serveur est incomplète.');
      ids.push(...result.ids); received = true;
      await onConfirmed?.({ ids: result.ids, offset });
    } catch (cause) {
      const code = String((cause as { code?: string })?.code || '').replace(/^functions\//, '');
      const rejected = ['invalid-argument', 'failed-precondition', 'permission-denied', 'unauthenticated', 'already-exists', 'not-found'].includes(code);
      throw new ImportBatchFailure([...ids], offset, batch.length, received ? 'confirmed' : rejected ? 'rejected' : 'unknown', cause);
    }
  }
  return ids;
}
