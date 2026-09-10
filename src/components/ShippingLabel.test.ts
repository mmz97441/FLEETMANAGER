import { expect, it } from 'vitest';
import JsBarcode from 'jsbarcode';
import { buildShippingLabelPrintHtml, shippingBarcodeOptions } from './ShippingLabel';
import { trackingCodeForRequest } from '../utils/shipmentRequest';

it('encodes the complete shipment identity with ten-module quiet zones and separate text', () => {
  const code = trackingCodeForRequest('ffffffff-ffff-4fff-bfff-ffffffffffff', 50);
  const output: { encodings?: { text: string; data: string; options: typeof shippingBarcodeOptions }[] } = {};
  JsBarcode(output, code, shippingBarcodeOptions);
  expect(code).toHaveLength(45);
  expect(output.encodings?.map(encoding => encoding.text).join('')).toBe(code);
  const encoding = output.encodings![0];
  expect(encoding.options.marginLeft / encoding.options.width).toBeGreaterThanOrEqual(10);
  expect(encoding.options.marginRight / encoding.options.width).toBeGreaterThanOrEqual(10);
  expect(encoding.options.displayValue).toBe(false);
  expect(encoding.data.length).toBeLessThan(400); // Numeric payload uses compact Code 128 encoding.
});

it('keeps the complete SVG in the 100 by 150 mm print template and escapes its title', () => {
  const svg = '<svg viewBox="0 0 660 80" preserveAspectRatio="none"><rect width="4" height="80" /></svg>';
  const html = buildShippingLabelPrintHtml(`<div class="label-container">${svg}</div>`, '<unsafe>&');
  expect(html).toContain('size: 100mm 150mm');
  expect(html).toContain('height: 22mm');
  expect(html).toContain('width: 100%');
  expect(html).toContain(svg);
  expect(html).toContain('Étiquette - &lt;unsafe&gt;&amp;');
  expect(html).not.toContain('<unsafe>');
});
