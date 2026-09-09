import { describe, it, expect } from 'vitest';
import { escapeHtml, safeImageUrl } from './html';
describe('printable document content', () => {
  it('escapes scripts and attribute delimiters', () => {
    expect(escapeHtml('<script>"&\'</script>')).toBe(
      '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
    );
  });
  it('rejects active image URL schemes', () => {
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('data:text/html,test')).toBe('');
  });
  it('escapes quote injection in an HTTPS image attribute', () => {
    expect(
      safeImageUrl('https://example.invalid/a" onerror="test'),
    ).not.toContain('"');
  });
});
