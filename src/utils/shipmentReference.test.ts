import { describe, expect, it, vi } from 'vitest';
import { copyShipmentReference, displayShipmentReference } from './shipmentReference';

describe('stable shipment references', () => {
  const reference = 'CL-123456789012345678901234567890123456789012';
  it('groups the full numeric identity for reading without truncating it', () => {
    const displayed = displayShipmentReference(reference);
    expect(displayed).toContain('123 456 789');
    expect(displayed.replace(/ /g, '')).toBe(reference);
  });
  it('copies the exact original identity, without its visual grouping', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await copyShipmentReference(reference, clipboard);
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(reference);
  });
  it('leaves legacy and customer references unchanged', () => {
    for (const value of ['BR1234', 'CMD-12-3', 'CL-123', 'colis 123']) expect(displayShipmentReference(value)).toBe(value);
  });
  it('reports clipboard rejection rather than announcing a successful copy', async () => {
    await expect(copyShipmentReference(reference, { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).rejects.toThrow('denied');
  });
});
