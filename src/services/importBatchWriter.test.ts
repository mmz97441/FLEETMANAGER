import { describe, expect, it, vi } from 'vitest';
import { ImportBatchFailure, writeImportBatches } from './importBatchWriter';
const rows = Array.from({ length: 151 }, (_, id) => ({ id: String(id) }));
describe('progressive import receipts', () => {
  it('publishes each receipt before sending the next batch', async () => {
    const sequence: string[] = [];
    const ids = await writeImportBatches(rows, async batch => { sequence.push(`send${batch[0].id}`); return { ids: batch.map(p => p.id) }; }, ({ ids, offset }) => { sequence.push(`confirmed${offset}:${ids.length}`); });
    expect(ids).toHaveLength(151);
    expect(sequence).toEqual(['send0', 'confirmed0:75', 'send75', 'confirmed75:75', 'send150', 'confirmed150:1']);
  });
  it('retains 75 receipts and marks only the failed batch unknown after a lost response', async () => {
    const onConfirmed = vi.fn(); let calls = 0;
    const error = await writeImportBatches(rows, async batch => { if (++calls === 2) throw new Error('Network lost'); return { ids: batch.map(p => p.id) }; }, onConfirmed).catch(error => error);
    expect(error).toBeInstanceOf(ImportBatchFailure);
    expect(error).toMatchObject({ confirmedCount: 75, offset: 75, count: 75, outcome: 'unknown' });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(error.confirmedIds).toEqual(rows.slice(0, 75).map(p => p.id));
  });
  it('distinguishes a server rejection from an uncertain result', async () => {
    const error = await writeImportBatches(rows, async () => { throw Object.assign(new Error('Ville requise'), { code: 'functions/invalid-argument' }); }).catch(error => error);
    expect(error).toMatchObject({ confirmedCount: 0, count: 75, outcome: 'rejected' });
  });
  it('preserves acknowledged writes when loading labels fails', async () => {
    const error = await writeImportBatches(rows, async batch => ({ ids: batch.map(p => p.id) }), async () => { throw new Error('Read unavailable'); }).catch(error => error);
    expect(error).toMatchObject({ confirmedCount: 75, outcome: 'confirmed', offset: 0 });
  });
  it('does not certify an incomplete reply', async () => {
    const callback = vi.fn();
    const error = await writeImportBatches(rows, async () => ({ ids: ['only-one'] }), callback).catch(error => error);
    expect(error.outcome).toBe('unknown'); expect(callback).not.toHaveBeenCalled();
  });
});
