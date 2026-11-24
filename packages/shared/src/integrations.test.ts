import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  buildUblXml,
  decodeZatcaQr,
  encodeZatcaQr,
  maskSensitive,
  minorToDecimal,
  utf8Encode,
} from './integrations';

describe('ZATCA TLV QR', () => {
  const input = {
    sellerName: 'شركة الصفاء للتجارة',
    vatNumber: '300000000000003',
    timestamp: '2026-11-24T10:00:00Z',
    totalInclVat: '115.00',
    vatAmount: '15.00',
  };

  it('encodes and decodes the five TLV fields round-trip', () => {
    const qr = encodeZatcaQr(input);
    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(0);
    expect(decodeZatcaQr(qr)).toEqual(input);
  });

  it('is deterministic for the same input', () => {
    expect(encodeZatcaQr(input)).toBe(encodeZatcaQr(input));
  });

  it('rejects a value over 255 bytes', () => {
    expect(() => encodeZatcaQr({ ...input, sellerName: 'x'.repeat(256) })).toThrow(/255 bytes/);
  });

  it('base64 helpers round-trip arbitrary bytes', () => {
    const bytes = utf8Encode('hello مرحبا');
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });
});

describe('UBL 2.1 XML', () => {
  it('builds standards-shaped XML from real invoice data', () => {
    const xml = buildUblXml({
      invoiceNumber: 'INV-2026-00001',
      uuid: '019a0000-0000-7000-8000-000000000001',
      issueDate: '2026-11-24',
      issueTime: '10:00:00',
      type: 'SIMPLIFIED',
      sellerName: 'شركة الصفاء للتجارة',
      sellerVatNumber: '300000000000003',
      sellerCity: 'Riyadh',
      buyerName: 'Al-Noor Retail',
      buyerVatNumber: '300100000000001',
      currency: 'SAR',
      subtotalMinor: 1000000,
      taxMinor: 150000,
      totalMinor: 1150000,
      lines: [
        { id: 'l1', description: 'Basmati Rice 5kg', quantity: 10n, unitPriceMinor: 100000, lineTotalMinor: 1000000, lineTaxMinor: 150000, taxRateBps: 1500 },
      ],
    });
    expect(xml).toContain('<cbc:ID>INV-2026-00001</cbc:ID>');
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    expect(xml).toContain('300000000000003');
    expect(xml).toContain('10000.00'); // subtotal 1,000,000 halalas = SAR 10,000.00
    expect(xml).toContain('11500.00');
    expect(xml).toContain('Basmati Rice 5kg');
    expect(xml).toContain('<cbc:Percent>15.00</cbc:Percent>');
  });

  it('escapes XML special characters in names', () => {
    const xml = buildUblXml({
      invoiceNumber: 'INV-1', uuid: 'u', issueDate: '2026-11-24', issueTime: '10:00:00',
      type: 'STANDARD', sellerName: 'A & B <Trading>', sellerVatNumber: '300000000000003',
      buyerName: 'Buyer "X"', currency: 'SAR', subtotalMinor: 0, taxMinor: 0, totalMinor: 0, lines: [],
    });
    expect(xml).toContain('A &amp; B &lt;Trading&gt;');
    expect(xml).toContain('Buyer &quot;X&quot;');
  });
});

describe('minorToDecimal / maskSensitive', () => {
  it('formats minor units with two decimals', () => {
    expect(minorToDecimal(1150000)).toBe('11500.00');
    expect(minorToDecimal(15000n)).toBe('150.00');
    expect(minorToDecimal(-500)).toBe('-5.00');
    expect(minorToDecimal(0)).toBe('0.00');
  });

  it('masks sensitive values keeping the last 4 chars', () => {
    expect(maskSensitive('1012345678')).toBe('****5678');
    expect(maskSensitive('SA0380000000608012345678')).toBe('****5678');
    expect(maskSensitive(null)).toBeNull();
    expect(maskSensitive('')).toBeNull();
    expect(maskSensitive('123')).toBe('****');
  });
});
