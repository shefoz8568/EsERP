import { describe, expect, it } from 'vitest';
import { contactDto, itemDto, itemCategoryDto, priceListDto, priceListItemDto } from './schemas.js';
import { expandPermissions, ROLE_PERMISSION_MATRIX } from './types.js';

describe('Phase 1 master-data DTOs', () => {
  it('accepts a valid Saudi customer contact', () => {
    const parsed = contactDto.parse({
      type: 'CUSTOMER', legalName: 'Al-Noor Retail', displayName: 'Al-Noor',
      taxNumber: '300100000000001', email: 'a@b.sa', creditLimitMinor: 5000000, paymentTermsDays: 30,
    });
    expect(parsed.type).toBe('CUSTOMER');
    expect(parsed.country).toBe('SA');
    expect(parsed.creditLimitCurrency).toBe('SAR');
    expect(parsed.status).toBe('ACTIVE');
  });

  it('rejects a non-15-digit VAT number and a bad email', () => {
    expect(() => contactDto.parse({ legalName: 'X', displayName: 'X', taxNumber: '123' })).toThrow();
    expect(() => contactDto.parse({ legalName: 'X', displayName: 'X', email: 'not-an-email' })).toThrow();
  });

  it('allows a contact with no tax number or email (nullable uniques)', () => {
    const parsed = contactDto.parse({ type: 'SUPPLIER', legalName: 'Cash Supplier', displayName: 'Cash' });
    expect(parsed.taxNumber).toBeUndefined();
    expect(parsed.email).toBeUndefined();
  });

  it('accepts a valid item with money in minor units', () => {
    const parsed = itemDto.parse({
      sku: 'RICE-5KG', name: 'Basmati Rice', defaultUomId: 'uom-1',
      salesPriceMinor: 3499, purchasePriceMinor: 2800, costingMethod: 'FIFO',
    });
    expect(parsed.costingMethod).toBe('FIFO');
    expect(parsed.trackStock).toBe(true);
    expect(parsed.salesPriceCurrency).toBe('SAR');
  });

  it('rejects fractional money and unknown costing methods', () => {
    expect(() => itemDto.parse({ sku: 'X', name: 'X', defaultUomId: 'u1', salesPriceMinor: 10.5 })).toThrow();
    expect(() => itemDto.parse({ sku: 'X', name: 'X', defaultUomId: 'u1', costingMethod: 'LIFO' })).toThrow();
    expect(() => itemDto.parse({ sku: 'X', name: 'X', defaultUomId: 'u1', status: 'ARCHIVED' })).toThrow();
  });

  it('validates item categories and price lists', () => {
    expect(itemCategoryDto.parse({ code: 'FOOD', name: 'Foodstuffs' }).code).toBe('FOOD');
    expect(() => itemCategoryDto.parse({ code: 'bad code!', name: 'X' })).toThrow();
    const pl = priceListDto.parse({ name: 'Standard Retail', currency: 'SAR', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' });
    expect(pl.isDefault).toBe(false);
    expect(priceListItemDto.parse({ itemId: 'i1', priceMinor: 100 }).minQuantity).toBe(1);
    expect(() => priceListItemDto.parse({ itemId: 'i1', priceMinor: -5 })).toThrow();
    expect(() => priceListItemDto.parse({ itemId: 'i1', priceMinor: 100, minQuantity: 0 })).toThrow();
  });
});

describe('Phase 1 permission matrix', () => {
  it('grants the new modules to the right roles', () => {
    const sales = expandPermissions(ROLE_PERMISSION_MATRIX.SALES);
    expect(sales).toContain('contacts:manage');
    expect(sales).toContain('items:read');
    expect(sales).not.toContain('items:manage');
    expect(sales).toContain('pricelists:read');

    const purchasing = expandPermissions(ROLE_PERMISSION_MATRIX.PURCHASING);
    expect(purchasing).toContain('contacts:manage');
    expect(purchasing).toContain('items:manage');

    const warehouse = expandPermissions(ROLE_PERMISSION_MATRIX.WAREHOUSE);
    expect(warehouse).toContain('items:read');
    expect(warehouse).not.toContain('items:manage');
    expect(warehouse).not.toContain('contacts:manage');

    const viewer = expandPermissions(ROLE_PERMISSION_MATRIX.VIEWER);
    expect(viewer).toContain('contacts:read');
    expect(viewer).toContain('items:read');
    expect(viewer).toContain('pricelists:read');
    expect(viewer).not.toContain('contacts:manage');

    const accountant = expandPermissions(ROLE_PERMISSION_MATRIX.ACCOUNTANT);
    expect(accountant).toContain('contacts:read');
    expect(accountant).not.toContain('contacts:manage');

    expect(expandPermissions(ROLE_PERMISSION_MATRIX.OWNER)).toContain('pricelists:manage');
    expect(expandPermissions(ROLE_PERMISSION_MATRIX.OWNER)).toContain('items:manage');
  });
});
