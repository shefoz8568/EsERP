import { describe, expect, it, vi } from 'vitest';
import { ContactsService } from './contacts.service';

function makeService(store: { contacts: any[] }) {
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as any;
  const outbox = { publish: vi.fn().mockResolvedValue(undefined) } as any;
  const prismaClient = {
    contact: {
      count: vi.fn(async ({ where }: any) => store.contacts.filter((c) => !where?.type || c.type === where.type).length),
      findMany: vi.fn(async () => store.contacts),
      findUnique: vi.fn(async ({ where }: any) => store.contacts.find((c) => c.id === where.id) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `c-${store.contacts.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        store.contacts.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.contacts.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const i = store.contacts.findIndex((c) => c.id === where.id);
        return store.contacts.splice(i, 1)[0];
      }),
    },
  };
  const prisma = { withTenant: async (_tid: string, fn: (tx: any) => Promise<unknown>) => fn(prismaClient) } as any;
  const svc = new ContactsService(prisma, audit, outbox);
  return { svc, audit, outbox, prismaClient };
}

const valid = {
  type: 'CUSTOMER', legalName: 'Al-Noor', displayName: 'Al-Noor',
  taxNumber: '300100000000001', email: 'a@alnoor.sa',
  creditLimitMinor: 1000, creditLimitCurrency: 'SAR', paymentTermsDays: 30, status: 'ACTIVE', country: 'SA',
} as any;

describe('ContactsService', () => {
  it('creates a contact, writes audit + outbox in the same transaction', async () => {
    const store = { contacts: [] as any[] };
    const { svc, audit, outbox } = makeService(store);
    const created = await svc.create('t1', 'u1', valid);
    expect(created.displayName).toBe('Al-Noor');
    // Stored as BigInt in the DB row, serialised to a JSON-safe number on return.
    expect(store.contacts[0].creditLimitMinor).toBe(1000n);
    expect(created.creditLimitMinor).toBe(1000);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create:Contact', entityType: 'Contact' }),
      expect.anything(),
    );
    expect(outbox.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'contact.created', tenantId: 't1' }),
    );
  });

  it('lists with search/type filters and pagination meta', async () => {
    const store = { contacts: [{ id: 'c-1', ...valid }] };
    const { svc } = makeService(store);
    const res = await svc.list('t1', { page: '1', pageSize: '20', type: 'CUSTOMER' });
    expect(res.meta.total).toBe(1);
    expect(res.meta.totalPages).toBe(1);
    expect(res.data).toHaveLength(1);
  });

  it('throws 404 for a missing contact and for cross-tenant access', async () => {
    const store = { contacts: [{ id: 'c-1', tenantId: 'other-tenant', ...valid }] };
    const { svc } = makeService(store);
    await expect(svc.get('t1', 'c-1')).rejects.toThrow('Contact not found');
    await expect(svc.get('t1', 'nope')).rejects.toThrow('Contact not found');
    await expect(svc.update('t1', 'u1', 'nope', { displayName: 'X' })).rejects.toThrow('Contact not found');
    await expect(svc.delete('t1', 'u1', 'nope')).rejects.toThrow('Contact not found');
  });

  it('updates money as BigInt and deletes with audit + outbox', async () => {
    const store = { contacts: [{ id: 'c-1', tenantId: 't1', ...valid, creditLimitMinor: 1000n }] };
    const { svc, audit, outbox } = makeService(store);
    const updated = await svc.update('t1', 'u1', 'c-1', { creditLimitMinor: 2500 } as any);
    expect(store.contacts[0].creditLimitMinor).toBe(2500n);
    expect(updated.creditLimitMinor).toBe(2500);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'update:Contact' }), expect.anything());
    await svc.delete('t1', 'u1', 'c-1');
    expect(store.contacts).toHaveLength(0);
    expect(outbox.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'contact.deleted' }));
  });
});
