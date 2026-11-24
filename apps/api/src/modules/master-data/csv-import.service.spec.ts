import { describe, expect, it } from 'vitest';
import { CsvImportService } from './csv-import.service';
import { toJson } from './serialize';

describe('CsvImportService (preview only — nothing persisted)', () => {
  const svc = new CsvImportService();

  it('previews valid contact rows', () => {
    const csv = [
      'legalName,displayName,type,email,taxNumber,creditLimitMinor,paymentTermsDays',
      'Al-Noor Retail,Al-Noor,CUSTOMER,sales@alnoor.sa,300100000000001,5000000,30',
      'Cash Supplier,Cash,SUPPLIER,,,0,0',
    ].join('\n');
    const res = svc.previewContacts(csv);
    expect(res.rows).toBe(2);
    expect(res.valid).toBe(2);
    expect(res.errors).toHaveLength(0);
    expect(res.preview[0]).toMatchObject({ legalName: 'Al-Noor Retail', creditLimitMinor: 5000000 });
  });

  it('reports per-row errors without dropping valid rows', () => {
    const csv = [
      'legalName,displayName,type,email,taxNumber',
      'Good Co,Good,CUSTOMER,good@co.sa,',
      'Bad Co,Bad,CUSTOMER,not-an-email,123',
      ',NoName,CUSTOMER,,',
    ].join('\n');
    const res = svc.previewContacts(csv);
    expect(res.rows).toBe(3);
    expect(res.valid).toBe(1);
    expect(res.errors).toHaveLength(2);
    expect(res.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it('previews valid item rows and rejects bad money', () => {
    const csv = [
      'sku,name,defaultUomId,salesPriceMinor,purchasePriceMinor,costingMethod',
      'RICE-5KG,Basmati Rice,uom-1,3499,2800,FIFO',
      'BAD-1,Bad Item,uom-1,10.5,100,FIFO',
      'BAD-2,Bad Method,uom-1,100,100,LIFO',
    ].join('\n');
    const res = svc.previewItems(csv);
    expect(res.rows).toBe(3);
    expect(res.valid).toBe(1);
    expect(res.errors).toHaveLength(2);
    expect(res.preview[0]).toMatchObject({ sku: 'RICE-5KG', salesPriceMinor: 3499 });
  });

  it('throws on unparseable CSV', () => {
    expect(() => svc.previewContacts('"unterminated')).toThrow(/CSV parse error/);
  });
});

describe('toJson (BigInt serialisation)', () => {
  it('converts BigInt fields to numbers, recursively', () => {
    expect(toJson({ priceMinor: 3499n, nested: { qty: 2n }, list: [1n, 2n] })).toEqual({
      priceMinor: 3499, nested: { qty: 2 }, list: [1, 2],
    });
    expect(toJson(5n)).toBe(5);
    expect(toJson('plain')).toBe('plain');
  });
});
