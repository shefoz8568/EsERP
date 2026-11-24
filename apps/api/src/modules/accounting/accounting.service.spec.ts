import { describe, expect, it, vi } from 'vitest';
import { PostingService } from './posting.service';
import { JournalsService } from './journals.service';
import { PeriodsService } from './periods.service';
import { NumberingSeriesService } from '../settings/numbering.service';

/**
 * Phase 2 service tests with an in-memory fake Prisma transaction client.
 * Pure validation/math lives in @eserp/shared (accounting.test.ts); these
 * tests cover the service rules: open-period gating, leaf-account posting,
 * draft -> post -> reverse lifecycle, and period transitions.
 */
function makeDb() {
  const db: any = {
    accounts: [
      { id: 'acc-1000', tenantId: 't1', code: '1000', nameEn: 'Cash and Equivalents', type: 'ASSET', parentId: null },
      { id: 'acc-1010', tenantId: 't1', code: '1010', nameEn: 'Cash on Hand', type: 'ASSET', parentId: 'acc-1000' },
      { id: 'acc-4010', tenantId: 't1', code: '4010', nameEn: 'Sales', type: 'REVENUE', parentId: null },
      { id: 'acc-1020', tenantId: 't1', code: '1020', nameEn: 'Bank', type: 'ASSET', parentId: 'acc-1000' },
    ],
    periods: [
      { id: 'per-oct', tenantId: 't1', fiscalYear: 2026, periodNumber: 10, startDate: new Date('2026-10-01T00:00:00.000Z'), endDate: new Date('2026-10-31T23:59:59.999Z'), status: 'CLOSED' },
      { id: 'per-nov', tenantId: 't1', fiscalYear: 2026, periodNumber: 11, startDate: new Date('2026-11-01T00:00:00.000Z'), endDate: new Date('2026-11-30T23:59:59.999Z'), status: 'OPEN' },
    ],
    series: [{ id: 'ser-je', tenantId: 't1', code: 'JE', name: 'Journal Entries', pattern: 'JE-{YYYY}-{SEQ:5}', nextNumber: 1, prefix: null, suffix: null }],
    entries: [] as any[],
    lines: [] as any[],
    costCenters: [{ id: 'cc-1', tenantId: 't1', code: 'HQ', name: 'Head Office', status: 'ACTIVE', parentId: null }],
    taxRates: [{ id: 'tax-1', tenantId: 't1', name: 'VAT 15%', rateBps: 1500 }],
  };
  let seq = 0;
  const tx: any = {
    chartOfAccounts: {
      findUnique: vi.fn(async ({ where }: any) => db.accounts.find((a: any) => a.id === where.id) ?? null),
      count: vi.fn(async ({ where }: any) => db.accounts.filter((a: any) => a.tenantId === where.tenantId && a.parentId === where.parentId).length),
    },
    fiscalPeriod: {
      findFirst: vi.fn(async ({ where }: any) =>
        db.periods.find((p: any) => p.tenantId === where.tenantId && p.startDate <= where.startDate.lte && p.endDate >= where.endDate.gte) ?? null),
      findUnique: vi.fn(async ({ where }: any) => db.periods.find((p: any) => p.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: any) => db.periods.filter((p: any) => !where || p.tenantId === where.tenantId)),
      create: vi.fn(async ({ data }: any) => { const r = { id: `per-${++seq}`, ...data }; db.periods.push(r); return r; }),
      update: vi.fn(async ({ where, data }: any) => { const r = db.periods.find((p: any) => p.id === where.id)!; Object.assign(r, data); return r; }),
      delete: vi.fn(async ({ where }: any) => db.periods.splice(db.periods.findIndex((p: any) => p.id === where.id), 1)[0]),
    },
    numberingSeries: {
      findUnique: vi.fn(async ({ where }: any) => db.series.find((s: any) => s.code === where.code_tenantId.code && s.tenantId === where.code_tenantId.tenantId) ?? null),
      create: vi.fn(async ({ data }: any) => { const r = { id: `ser-${++seq}`, ...data }; db.series.push(r); return r; }),
      update: vi.fn(async ({ where, data }: any) => { const r = db.series.find((s: any) => s.id === where.id)!; Object.assign(r, data); return r; }),
    },
    journalEntry: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const e = db.entries.find((x: any) => x.id === where.id) ?? null;
        if (!e) return null;
        const out: any = { ...e };
        if (include?.lines) out.lines = db.lines.filter((l: any) => l.entryId === e.id).sort((a: any, b: any) => a.lineOrder - b.lineOrder);
        if (include?.fiscalPeriod) out.fiscalPeriod = db.periods.find((p: any) => p.id === e.fiscalPeriodId);
        if (include?.reversedBy) out.reversedBy = db.entries.find((x: any) => x.reversesId === e.id) ?? null;
        if (include?.reverses) out.reverses = e.reversesId ? db.entries.find((x: any) => x.id === e.reversesId) ?? null : null;
        return out;
      }),
      findMany: vi.fn(async ({ where }: any) => db.entries.filter((e: any) => !where || e.tenantId === where.tenantId)),
      count: vi.fn(async () => db.entries.length),
      create: vi.fn(async ({ data, include }: any) => {
        const entry: any = { id: `je-${++seq}`, ...data, lines: undefined };
        delete entry.lines;
        const createdLines = (data.lines?.create ?? []).map((l: any, i: number) => ({ id: `jel-${++seq}`, entryId: entry.id, ...l, lineOrder: l.lineOrder ?? i }));
        db.lines.push(...createdLines);
        db.entries.push(entry);
        const out: any = { ...entry };
        if (include?.lines) out.lines = createdLines;
        if (include?.fiscalPeriod) out.fiscalPeriod = db.periods.find((p: any) => p.id === entry.fiscalPeriodId);
        return out;
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const e = db.entries.find((x: any) => x.id === where.id)!;
        if (data.lines?.create) {
          db.lines = db.lines.filter((l: any) => l.entryId !== e.id);
          db.lines.push(...data.lines.create.map((l: any, i: number) => ({ id: `jel-${++seq}`, entryId: e.id, ...l, lineOrder: l.lineOrder ?? i })));
        }
        const { lines: _l, ...rest } = data;
        Object.assign(e, rest);
        const out: any = { ...e };
        if (include?.lines) out.lines = db.lines.filter((l: any) => l.entryId === e.id);
        if (include?.fiscalPeriod) out.fiscalPeriod = db.periods.find((p: any) => p.id === e.fiscalPeriodId);
        if (include?.reversedBy) out.reversedBy = db.entries.find((x: any) => x.reversesId === e.id) ?? null;
        if (include?.reverses) out.reverses = e.reversesId ? db.entries.find((x: any) => x.id === e.reversesId) ?? null : null;
        return out;
      }),
      delete: vi.fn(async ({ where }: any) => { db.lines = db.lines.filter((l: any) => l.entryId !== where.id); return db.entries.splice(db.entries.findIndex((e: any) => e.id === where.id), 1)[0]; }),
    },
    journalEntryLine: {
      deleteMany: vi.fn(async ({ where }: any) => { const n = db.lines.filter((l: any) => l.entryId === where.entryId).length; db.lines = db.lines.filter((l: any) => l.entryId !== where.entryId); return { count: n }; }),
    },
    costCenter: {
      findUnique: vi.fn(async ({ where }: any) => db.costCenters.find((c: any) => c.id === where.id) ?? null),
    },
    taxRate: {
      findUnique: vi.fn(async ({ where }: any) => db.taxRates.find((t: any) => t.id === where.id) ?? null),
    },
  };
  const prisma = { withTenant: async (_tid: string, fn: (t: any) => Promise<unknown>) => fn(tx) } as any;
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as any;
  const outbox = { publish: vi.fn().mockResolvedValue(undefined) } as any;
  const numbering = new NumberingSeriesService();
  const posting = new PostingService(numbering, audit, outbox);
  return {
    db, tx, prisma, audit, outbox, posting,
    journals: new JournalsService(prisma, audit, outbox, posting),
    periods: new PeriodsService(prisma, audit, outbox),
  };
}

const validDto = (overrides: Record<string, unknown> = {}) => ({
  entryDate: '2026-11-15T00:00:00.000Z',
  description: 'Cash sale',
  sourceModule: 'MANUAL',
  currency: 'SAR',
  lines: [
    { accountId: 'acc-1010', debitMinor: 115000, creditMinor: 0, taxRateId: undefined, costCenterId: undefined, lineOrder: 0 },
    { accountId: 'acc-4010', debitMinor: 0, creditMinor: 115000, taxRateId: 'tax-1', costCenterId: 'cc-1', lineOrder: 1 },
  ],
  ...overrides,
});

describe('PostingService', () => {
  it('posts a balanced entry with a JE number, totals, audit + outbox', async () => {
    const { posting, tx, audit, outbox } = makeDb();
    const entry = await posting.postBalanced(tx, 't1', 'u1', { ...validDto(), status: 'POSTED' });
    expect(entry.number).toBe('JE-2026-00001');
    expect(entry.totalDebitMinor).toBe(115000n);
    expect(entry.totalCreditMinor).toBe(115000n);
    expect(entry.status).toBe('POSTED');
    expect(entry.postedBy).toBe('u1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'post:JournalEntry' }), expect.anything());
    expect(outbox.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: 'journal.posted' }));
  });

  it('rejects unbalanced, group-account, closed-period and unknown-account postings', async () => {
    const { posting, tx } = makeDb();
    await expect(posting.postBalanced(tx, 't1', 'u1', {
      ...validDto(), lines: [
        { accountId: 'acc-1010', debitMinor: 1000, creditMinor: 0 },
        { accountId: 'acc-4010', debitMinor: 0, creditMinor: 900 },
      ],
    })).rejects.toThrow('must equal');
    await expect(posting.postBalanced(tx, 't1', 'u1', {
      ...validDto(), lines: [
        { accountId: 'acc-1000', debitMinor: 1000, creditMinor: 0 },
        { accountId: 'acc-4010', debitMinor: 0, creditMinor: 1000 },
      ],
    })).rejects.toThrow('group/header account');
    await expect(posting.postBalanced(tx, 't1', 'u1', {
      ...validDto(), entryDate: '2026-10-15T00:00:00.000Z',
    })).rejects.toThrow('CLOSED');
    await expect(posting.postBalanced(tx, 't1', 'u1', {
      ...validDto(), entryDate: '2026-12-15T00:00:00.000Z',
    })).rejects.toThrow('No fiscal period covers');
  });
});

describe('JournalsService lifecycle', () => {
  it('draft -> post -> reverse, with double-post and double-reverse blocked', async () => {
    const { journals, db } = makeDb();
    const draft = await journals.createDraft('t1', 'u1', validDto() as any);
    expect(draft.status).toBe('DRAFT');
    expect(draft.number).toBe('JE-2026-00001');

    const posted = await journals.post('t1', 'u1', draft.id);
    expect(posted.status).toBe('POSTED');
    expect(posted.postedAt).toBeTruthy();

    await expect(journals.post('t1', 'u1', draft.id)).rejects.toThrow('Only DRAFT entries can be posted');
    await expect(journals.updateDraft('t1', 'u1', draft.id, { description: 'changed' } as any)).rejects.toThrow('Only DRAFT entries can be edited');
    await expect(journals.deleteDraft('t1', 'u1', draft.id)).rejects.toThrow('Only DRAFT entries can be deleted');

    const reversal: any = await journals.reverse('t1', 'u1', draft.id);
    expect(reversal.status).toBe('POSTED');
    expect(reversal.reverses.number).toBe('JE-2026-00001');
    // Swapped lines: cash is now credited, sales debited.
    expect(reversal.lines.find((l: any) => l.accountId === 'acc-1010').creditMinor).toBe(115000);
    expect(reversal.lines.find((l: any) => l.accountId === 'acc-4010').debitMinor).toBe(115000);
    expect(db.entries.find((e: any) => e.id === draft.id).status).toBe('REVERSED');
    await expect(journals.reverse('t1', 'u1', draft.id)).rejects.toThrow('Only POSTED entries can be reversed');
  });

  it('deletes a draft and rejects a draft into a closed period', async () => {
    const { journals } = makeDb();
    const draft = await journals.createDraft('t1', 'u1', validDto() as any);
    const deleted = await journals.deleteDraft('t1', 'u1', draft.id);
    expect(deleted.id).toBe(draft.id);
    await expect(journals.createDraft('t1', 'u1', validDto({ entryDate: '2026-10-15T00:00:00.000Z' }) as any)).rejects.toThrow('CLOSED');
  });
});

describe('PeriodsService', () => {
  it('rejects an overlapping period and a duplicate year/number', async () => {
    const { periods } = makeDb();
    await expect(periods.create('t1', 'u1', {
      fiscalYear: 2026, periodNumber: 12, startDate: '2026-11-15T00:00:00.000Z', endDate: '2026-12-15T00:00:00.000Z', status: 'OPEN',
    } as any)).rejects.toThrow('overlaps');
    const created = await periods.create('t1', 'u1', {
      fiscalYear: 2026, periodNumber: 12, startDate: '2026-12-01T00:00:00.000Z', endDate: '2026-12-31T23:59:59.999Z', status: 'OPEN',
    } as any);
    expect(created.periodNumber).toBe(12);
  });

  it('allows OPEN -> CLOSED -> OPEN but never leaves LOCKED', async () => {
    const { periods } = makeDb();
    const closed = await periods.updateStatus('t1', 'u1', 'per-nov', 'CLOSED');
    expect(closed.status).toBe('CLOSED');
    const reopened = await periods.updateStatus('t1', 'u1', 'per-nov', 'OPEN');
    expect(reopened.status).toBe('OPEN');
    await periods.updateStatus('t1', 'u1', 'per-nov', 'LOCKED');
    await expect(periods.updateStatus('t1', 'u1', 'per-nov', 'OPEN')).rejects.toThrow('Cannot move a LOCKED period');
  });
});
