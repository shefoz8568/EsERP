import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeLedger, computeTrialBalance, computeVatSummary } from '@eserp/shared';
import type { OpeningBalanceDto, OpeningBalanceUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

/** Posted movement = POSTED + REVERSED entries (a reversed entry's amounts stay in history, netted by its reversal). DRAFTs never count. */
const POSTED_STATUSES = ['POSTED', 'REVERSED'];

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // --- Opening balances ---

  async listOpeningBalances(tenantId: string, query: { page?: string; pageSize?: string; fiscalYear?: string }) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.fiscalYear) where.fiscalYear = Number(query.fiscalYear);
    const [total, data]: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).openingBalance.count({ where }),
        (tx as any).openingBalance.findMany({
          where,
          orderBy: { account: { code: 'asc' } },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { account: { select: { id: true, code: true, nameEn: true, nameAr: true, type: true } } },
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async upsertOpeningBalance(tenantId: string, actorId: string, dto: OpeningBalanceDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const account = await (tx as any).chartOfAccounts.findUnique({ where: { id: dto.accountId } });
      if (!account || account.tenantId !== tenantId) throw new NotFoundException('Account not found');
      const row = await (tx as any).openingBalance.upsert({
        where: { tenantId_accountId_fiscalYear: { tenantId, accountId: dto.accountId, fiscalYear: dto.fiscalYear } },
        update: { debitMinor: BigInt(dto.debitMinor), creditMinor: BigInt(dto.creditMinor), currency: dto.currency },
        create: { tenantId, accountId: dto.accountId, fiscalYear: dto.fiscalYear, debitMinor: BigInt(dto.debitMinor), creditMinor: BigInt(dto.creditMinor), currency: dto.currency, createdBy: actorId },
      });
      await this.audit.log({ tenantId, actorId, action: 'upsert:OpeningBalance', entityType: 'OpeningBalance', entityId: row.id, after: toJson(row) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'opening-balance.upserted', aggregateId: row.id, payload: { id: row.id, accountId: dto.accountId, fiscalYear: dto.fiscalYear }, createdBy: actorId });
      return toJson(row);
    });
  }

  async updateOpeningBalance(tenantId: string, actorId: string, id: string, dto: OpeningBalanceUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).openingBalance.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Opening balance not found');
    const data: Record<string, unknown> = {};
    if (dto.debitMinor !== undefined) data.debitMinor = BigInt(dto.debitMinor);
    if (dto.creditMinor !== undefined) data.creditMinor = BigInt(dto.creditMinor);
    if (dto.currency !== undefined) data.currency = dto.currency;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).openingBalance.update({ where: { id }, data });
      await this.audit.log({ tenantId, actorId, action: 'update:OpeningBalance', entityType: 'OpeningBalance', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      return toJson(updated);
    });
  }

  async deleteOpeningBalance(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).openingBalance.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Opening balance not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).openingBalance.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:OpeningBalance', entityType: 'OpeningBalance', entityId: id, before: toJson(before) }, tx as any);
      return toJson(deleted);
    });
  }

  // --- Trial balance ---

  async trialBalance(tenantId: string, fiscalPeriodId: string) {
    const period: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).fiscalPeriod.findUnique({ where: { id: fiscalPeriodId } }),
    );
    if (!period || period.tenantId !== tenantId) throw new NotFoundException('Fiscal period not found');

    const [accounts, openings, lines]: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).chartOfAccounts.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
        (tx as any).openingBalance.findMany({ where: { tenantId, fiscalYear: period.fiscalYear } }),
        (tx as any).journalEntryLine.findMany({
          where: { tenantId, entry: { fiscalPeriodId, status: { in: POSTED_STATUSES } } },
          select: { accountId: true, debitMinor: true, creditMinor: true },
        }),
      ]),
    );
    const openingByAccount = new Map<string, any>(openings.map((o: any) => [o.accountId, o] as [string, any]));
    const movement = new Map<string, { debit: bigint; credit: bigint }>();
    for (const l of lines) {
      const m = movement.get(l.accountId) ?? { debit: 0n, credit: 0n };
      m.debit += l.debitMinor;
      m.credit += l.creditMinor;
      movement.set(l.accountId, m);
    }
    const result = computeTrialBalance(
      accounts.map((a: any) => {
        const o = openingByAccount.get(a.id);
        const m = movement.get(a.id) ?? { debit: 0n, credit: 0n };
        return {
          accountId: a.id,
          accountCode: a.code,
          accountName: a.nameEn,
          accountType: a.type,
          openingDebitMinor: o?.debitMinor ?? 0n,
          openingCreditMinor: o?.creditMinor ?? 0n,
          periodDebitMinor: m.debit,
          periodCreditMinor: m.credit,
        };
      }),
    );
    return toJson({
      fiscalPeriod: { id: period.id, fiscalYear: period.fiscalYear, periodNumber: period.periodNumber, status: period.status },
      rows: result.rows,
      totals: result.totals,
    });
  }

  // --- General ledger ---

  async generalLedger(tenantId: string, accountId: string, from?: string, to?: string) {
    const account: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).chartOfAccounts.findUnique({ where: { id: accountId } }),
    );
    if (!account || account.tenantId !== tenantId) throw new NotFoundException('Account not found');
    const fromDate = from ? new Date(from) : new Date(`${new Date().getFullYear()}-01-01T00:00:00.000Z`);
    const toDate = to ? new Date(to) : new Date();
    const fiscalYear = fromDate.getUTCFullYear();

    const [opening, priorLines, lines]: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).openingBalance.findUnique({ where: { tenantId_accountId_fiscalYear: { tenantId, accountId, fiscalYear } } }),
        (tx as any).journalEntryLine.findMany({
          where: { tenantId, accountId, entry: { status: { in: POSTED_STATUSES }, entryDate: { lt: fromDate } } },
          select: { debitMinor: true, creditMinor: true },
        }),
        (tx as any).journalEntryLine.findMany({
          where: { tenantId, accountId, entry: { status: { in: POSTED_STATUSES }, entryDate: { gte: fromDate, lte: toDate } } },
          select: { debitMinor: true, creditMinor: true, entry: { select: { entryDate: true, number: true, description: true } } },
          orderBy: { entry: { entryDate: 'asc' } },
        }),
      ]),
    );
    let openingDebit = opening?.debitMinor ?? 0n;
    let openingCredit = opening?.creditMinor ?? 0n;
    for (const l of priorLines) {
      openingDebit += l.debitMinor;
      openingCredit += l.creditMinor;
    }
    const computed = computeLedger(
      openingDebit,
      openingCredit,
      lines.map((l: any) => ({
        entryDate: l.entry.entryDate,
        entryNumber: l.entry.number,
        description: l.entry.description,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
      })),
    );
    return toJson({
      account: { id: account.id, code: account.code, nameEn: account.nameEn, nameAr: account.nameAr, type: account.type },
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      openingNetMinor: computed.openingNetMinor,
      lines: computed.lines,
      closingNetMinor: computed.closingNetMinor,
    });
  }

  // --- VAT summary ---

  async vatSummary(tenantId: string, fiscalPeriodId: string) {
    const period: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).fiscalPeriod.findUnique({ where: { id: fiscalPeriodId } }),
    );
    if (!period || period.tenantId !== tenantId) throw new NotFoundException('Fiscal period not found');
    const lines: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).journalEntryLine.findMany({
        where: { tenantId, taxRateId: { not: null }, entry: { fiscalPeriodId, status: { in: POSTED_STATUSES } } },
        include: {
          account: { select: { code: true, nameEn: true, type: true } },
          taxRate: { select: { id: true, name: true, rateBps: true } },
          entry: { select: { number: true, entryDate: true } },
        },
        orderBy: { entry: { entryDate: 'asc' } },
      }),
    );
    const summary = computeVatSummary(
      lines.map((l: any) => ({
        accountType: l.account.type,
        accountCode: l.account.code,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        taxRateBps: l.taxRate?.rateBps ?? null,
      })),
    );
    return toJson({
      fiscalPeriod: { id: period.id, fiscalYear: period.fiscalYear, periodNumber: period.periodNumber, status: period.status },
      currency: 'SAR',
      ...summary,
      lines: lines.map((l: any) => ({
        entryNumber: l.entry.number,
        entryDate: l.entry.entryDate,
        accountCode: l.account.code,
        accountName: l.account.nameEn,
        accountType: l.account.type,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        taxRateName: l.taxRate.name,
        rateBps: l.taxRate.rateBps,
      })),
    });
  }
}
