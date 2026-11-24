import { describe, expect, it, vi } from 'vitest';
import { ItemsService } from './items.service';

function makeService() {
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as any;
  const outbox = { publish: vi.fn().mockResolvedValue(undefined) } as any;
  const db = {
    categories: [{ id: 'cat-1', tenantId: 't1', code: 'FOOD', name: 'Foodstuffs', parentId: null as string | null, _count: { items: 0, children: 0 } }],
    uoms: [{ id: 'uom-1', tenantId: 't1', code: 'piece' }],
    taxes: [{ id: 'tax-1', tenantId: 't1', name: 'VAT 15%', rateBps: 1500 }],
    items: [] as any[],
  };
  const prismaClient = {
    itemCategory: {
      findMany: vi.fn(async () => db.categories),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = db.categories.find((c) => c.id === where.id) ?? null;
        if (!row) return null;
        return include?._count ? { ...row, _count: { items: db.items.filter((i) => i.categoryId === row.id).length, children: db.categories.filter((c) => c.parentId === row.id).length } } : row;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `cat-${db.categories.length + 1}`, ...data };
        db.categories.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = db.categories.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const i = db.categories.findIndex((c) => c.id === where.id);
        return db.categories.splice(i, 1)[0];
      }),
    },
    unitOfMeasure: { findUnique: vi.fn(async ({ where }: any) => db.uoms.find((u) => u.id === where.id) ?? null) },
    taxRate: { findUnique: vi.fn(async ({ where }: any) => db.taxes.find((t) => t.id === where.id) ?? null) },
    item: {
      count: vi.fn(async () => db.items.length),
      findMany: vi.fn(async () => db.items),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = db.items.find((i) => i.id === where.id) ?? null;
        if (!row) return null;
        return include?._count ? { ...row, _count: { priceListItems: 0 } } : row;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `item-${db.items.length + 1}`, ...data };
        db.items.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = db.items.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const i = db.items.findIndex((x) => x.id === where.id);
        return db.items.splice(i, 1)[0];
      }),
    },
  };
  const prisma = { withTenant: async (_tid: string, fn: (tx: any) => Promise<unknown>) => fn(prismaClient) } as any;
  return { svc: new ItemsService(prisma, audit, outbox), audit, outbox, db };
}

const validItem = {
  sku: 'RICE-5KG', name: 'Basmati Rice', categoryId: 'cat-1', defaultUomId: 'uom-1', taxRateId: 'tax-1',
  costingMethod: 'FIFO', standardCostMinor: 2800, standardCostCurrency: 'SAR',
  salesPriceMinor: 3499, salesPriceCurrency: 'SAR', purchasePriceMinor: 2600, purchasePriceCurrency: 'SAR',
  status: 'ACTIVE', trackStock: true, reorderPoint: 10, minStock: 0,
} as any;

describe('ItemsService', () => {
  it('creates an item storing money as BigInt, with audit + outbox', async () => {
    const { svc, audit, outbox, db } = makeService();
    const created = await svc.createItem('t1', 'u1', validItem);
    expect(created.sku).toBe('RICE-5KG');
    // Stored as BigInt in the DB row, serialised to a JSON-safe number on return.
    expect(db.items[0].salesPriceMinor).toBe(3499n);
    expect(db.items[0].standardCostMinor).toBe(2800n);
    expect(created.salesPriceMinor).toBe(3499);
    expect(created.standardCostMinor).toBe(2800);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'create:Item' }), expect.anything());
    expect(outbox.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'item.created' }));
  });

  it('rejects an item whose UoM belongs to another tenant', async () => {
    const { svc } = makeService();
    await expect(svc.createItem('t1', 'u1', { ...validItem, defaultUomId: 'uom-other' })).rejects.toThrow('Unit of measure not found');
  });

  it('rejects a category as its own parent and blocks deleting a non-empty category', async () => {
    const { svc } = makeService();
    await expect(svc.updateCategory('t1', 'u1', 'cat-1', { parentId: 'cat-1' })).rejects.toThrow('cannot be its own parent');
    // Create an item in the category, then deletion must be blocked.
    await svc.createItem('t1', 'u1', validItem);
    await expect(svc.deleteCategory('t1', 'u1', 'cat-1')).rejects.toThrow('still has items');
  });

  it('creates a sub-category and deletes an empty one with audit + outbox', async () => {
    const { svc, audit, outbox, db } = makeService();
    const sub = await svc.createCategory('t1', 'u1', { code: 'BEV', name: 'Beverages', parentId: 'cat-1' } as any);
    expect(sub.parentId).toBe('cat-1');
    expect(db.categories).toHaveLength(2);
    await svc.deleteCategory('t1', 'u1', sub.id);
    expect(db.categories).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete:ItemCategory' }), expect.anything());
    expect(outbox.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'item-category.deleted' }));
  });

  it('throws 404 for missing items across tenants', async () => {
    const { svc } = makeService();
    await expect(svc.getItem('t1', 'nope')).rejects.toThrow('Item not found');
    await expect(svc.deleteItem('t1', 'u1', 'nope')).rejects.toThrow('Item not found');
  });
});
