/**
 * Phase 10 — Analytics: dashboard KPIs + financial statements, computed
 * from real data only (ledger, invoices, stock, payroll). No mocked numbers.
 *
 * Read-only endpoints are cached in Redis for 60s, keyed per tenant +
 * parameters (`eserp:analytics:{tenantId}:{key}`). A Redis failure never
 * fails the request — the cache is best-effort and the data is recomputed.
 * Money is integer minor units (bigint) throughout; JSON output goes
 * through toJson() (BigInt -> Number), the same as every other module.
 */
import { Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  computeBalanceSheet,
  computeCashFlow,
  computeProfitLoss,
  trendBps,
} from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toJson } from '../master-data/serialize';

const POSTED_STATUSES = ['POSTED', 'REVERSED'];
const OPEN_INVOICE_STATUSES = ['POSTED', 'PARTIALLY_PAID'];
const CACHE_TTL_SECONDS = 60;

const monthBounds = (year: number, month: number): { from: Date; to: Date } => ({
  from: new Date(Date.UTC(year, month - 1, 1)),
  to: new Date(Date.UTC(year, month, 1)),
});

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.redis = new Redis(this.config.get<string>('redisUrl') ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      retryStrategy: () => null,
    });
    // ioredis emits 'error' when Redis is down; without a listener Node crashes.
    this.redis.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async cached<T>(tenantId: string, key: string, fn: () => Promise<T>): Promise<T> {
    const cacheKey = `eserp:analytics:${tenantId}:${key}`;
    try {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // cache miss / Redis down — recompute below
    }
    const value = await fn();
    try {
      await this.redis.set(cacheKey, JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // best-effort cache
    }
    return value;
  }

  /** Posted journal lines (with account code/type) in a date range. */
  private async ledgerLines(tx: any, tenantId: string, from?: Date, to?: Date): Promise<any[]> {
    return (tx as any).journalEntryLine.findMany({
      where: {
        tenantId,
        entry: {
          status: { in: POSTED_STATUSES },
          ...(from || to ? { entryDate: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
        },
      },
      select: {
        accountId: true, debitMinor: true, creditMinor: true,
        account: { select: { code: true, type: true, nameEn: true } },
        entry: { select: { entryDate: true } },
      },
    });
  }

  // --- Dashboard ------------------------------------------------------------

  async dashboard(tenantId: string, year?: number, month?: number) {
    const now = new Date();
    const y = year ?? now.getUTCFullYear();
    const m = month ?? now.getUTCMonth() + 1;
    return this.cached(tenantId, `dashboard:${y}-${m}`, async () => {
      const { from, to } = monthBounds(y, m);
      const prev = monthBounds(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
      const [curLines, prevLines, invoices, supInvoices, stockLevels, pos, payrollRuns, salesByMonthLines] = await this.prisma.withTenant(tenantId, (tx) =>
        Promise.all([
          this.ledgerLines(tx as any, tenantId, from, to),
          this.ledgerLines(tx as any, tenantId, prev.from, prev.to),
          (tx as any).salesInvoice.findMany({
            where: { tenantId, type: 'INVOICE', status: { in: OPEN_INVOICE_STATUSES } },
            select: { id: true, totalMinor: true, paidMinor: true, dueDate: true, customerId: true, invoiceDate: true },
          }),
          (tx as any).supplierInvoice.findMany({
            where: { tenantId, status: { in: OPEN_INVOICE_STATUSES } },
            select: { id: true, totalMinor: true, paidMinor: true, dueDate: true },
          }),
          (tx as any).stockLevel.findMany({
            select: { qtyOnHand: true, averageCostMinor: true, item: { select: { reorderPoint: true } } },
          }),
          (tx as any).purchaseOrder.findMany({
            where: { tenantId, status: { in: ['DRAFT', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] } },
            select: { lines: { select: { quantityOrdered: true, quantityReceived: true, unitCostMinor: true } } },
          }),
          (tx as any).payrollRun.findMany({ where: { tenantId, periodYear: y, periodMonth: m }, select: { grossMinor: true, netMinor: true } }),
          this.ledgerLines(tx as any, tenantId, new Date(Date.UTC(y, m - 12, 1)), to),
        ]),
      );

      const curPl = computeProfitLoss((curLines as any[]).map((l) => ({ accountCode: l.account.code, accountType: l.account.type, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      const prevPl = computeProfitLoss((prevLines as any[]).map((l) => ({ accountCode: l.account.code, accountType: l.account.type, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));

      let openAr = 0n;
      let overdueAr = 0n;
      for (const inv of invoices as any[]) {
        const balance = BigInt(inv.totalMinor) - BigInt(inv.paidMinor);
        if (balance <= 0n) continue;
        openAr += balance;
        if (new Date(inv.dueDate) < now) overdueAr += balance;
      }
      let openAp = 0n;
      let overdueAp = 0n;
      for (const inv of supInvoices as any[]) {
        const balance = BigInt(inv.totalMinor) - BigInt(inv.paidMinor);
        if (balance <= 0n) continue;
        openAp += balance;
        if (new Date(inv.dueDate) < now) overdueAp += balance;
      }

      let stockValue = 0n;
      let lowStockCount = 0;
      for (const s of stockLevels as any[]) {
        stockValue += BigInt(s.qtyOnHand) * BigInt(s.averageCostMinor);
        if (BigInt(s.qtyOnHand) <= BigInt(s.item?.reorderPoint ?? 0)) lowStockCount += 1;
      }

      let openPoValue = 0n;
      for (const po of pos as any[]) {
        for (const line of po.lines) {
          const remaining = BigInt(line.quantityOrdered) - BigInt(line.quantityReceived);
          if (remaining > 0n) openPoValue += remaining * BigInt(line.unitCostMinor);
        }
      }

      const payrollCost = (payrollRuns as any[]).reduce((s: bigint, r: any) => s + BigInt(r.grossMinor), 0n);

      // Sales by month (last 12 months) from ledger revenue lines.
      const salesByMonth = new Map<string, bigint>();
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        salesByMonth.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, 0n);
      }
      for (const l of salesByMonthLines as any[]) {
        if (l.account.type !== 'REVENUE') continue;
        const d = new Date(l.entry.entryDate);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        if (salesByMonth.has(key)) salesByMonth.set(key, (salesByMonth.get(key) ?? 0n) + (BigInt(l.creditMinor) - BigInt(l.debitMinor)));
      }

      const [topCustomers, topItems] = await this.prisma.withTenant(tenantId, (tx) =>
        Promise.all([
          (tx as any).salesInvoice.findMany({
            where: { tenantId, type: 'INVOICE', status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
            select: { customerId: true, totalMinor: true, customer: { select: { id: true, displayName: true } } },
          }),
          (tx as any).salesInvoiceLine.findMany({
            where: { tenantId, invoice: { type: 'INVOICE', status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } } },
            select: { itemId: true, lineTotalMinor: true, item: { select: { id: true, sku: true, name: true } } },
          }),
        ]),
      );
      const customerTotals = new Map<string, { customerId: string; name: string; revenueMinor: bigint }>();
      for (const inv of topCustomers as any[]) {
        const e = customerTotals.get(inv.customerId) ?? { customerId: inv.customerId, name: inv.customer?.displayName ?? '', revenueMinor: 0n };
        e.revenueMinor += BigInt(inv.totalMinor);
        customerTotals.set(inv.customerId, e);
      }
      const itemTotals = new Map<string, { itemId: string; sku: string; name: string; revenueMinor: bigint }>();
      for (const line of topItems as any[]) {
        if (!line.itemId) continue;
        const e = itemTotals.get(line.itemId) ?? { itemId: line.itemId, sku: line.item?.sku ?? '', name: line.item?.name ?? '', revenueMinor: 0n };
        e.revenueMinor += BigInt(line.lineTotalMinor);
        itemTotals.set(line.itemId, e);
      }

      return toJson({
        period: { year: y, month: m },
        revenueMinor: curPl.revenueMinor,
        previousRevenueMinor: prevPl.revenueMinor,
        revenueTrendBps: trendBps(curPl.revenueMinor, prevPl.revenueMinor),
        grossProfitMinor: curPl.grossProfitMinor,
        grossMarginBps: curPl.grossMarginBps,
        previousGrossMarginBps: prevPl.grossMarginBps,
        netIncomeMinor: curPl.netIncomeMinor,
        openArMinor: openAr,
        overdueArMinor: overdueAr,
        openApMinor: openAp,
        overdueApMinor: overdueAp,
        stockValueMinor: stockValue,
        lowStockCount,
        openPurchaseOrdersMinor: openPoValue,
        payrollCostMinor: payrollCost,
        salesByMonth: [...salesByMonth.entries()].map(([monthKey, revenueMinor]) => ({ month: monthKey, revenueMinor })),
        topCustomers: [...customerTotals.values()].sort((a, b) => (b.revenueMinor > a.revenueMinor ? 1 : -1)).slice(0, 5),
        topItems: [...itemTotals.values()].sort((a, b) => (b.revenueMinor > a.revenueMinor ? 1 : -1)).slice(0, 5),
      });
    });
  }

  // --- Statements -------------------------------------------------------------

  async profitLoss(tenantId: string, query: { fiscalPeriodId?: string; from?: string; to?: string }) {
    const key = `pl:${query.fiscalPeriodId ?? ''}:${query.from ?? ''}:${query.to ?? ''}`;
    return this.cached(tenantId, key, async () => {
      let from: Date | undefined;
      let to: Date | undefined;
      let period: any = null;
      if (query.fiscalPeriodId) {
        period = await this.prisma.withTenant(tenantId, (tx) => (tx as any).fiscalPeriod.findUnique({ where: { id: query.fiscalPeriodId } }));
        if (!period || period.tenantId !== tenantId) throw new NotFoundException('Fiscal period not found');
        from = new Date(period.startDate);
        to = new Date(new Date(period.endDate).getTime() + 86_400_000);
      } else {
        from = query.from ? new Date(query.from) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
        to = query.to ? new Date(query.to) : new Date();
      }
      const lines = await this.prisma.withTenant(tenantId, (tx) => this.ledgerLines(tx as any, tenantId, from, to));
      const rows = (lines as any[]).map((l) => ({ accountCode: l.account.code, accountType: l.account.type, debitMinor: l.debitMinor, creditMinor: l.creditMinor }));
      const pl = computeProfitLoss(rows);
      // Per-account detail for the statement page.
      const byAccount = new Map<string, { accountCode: string; accountName: string; accountType: string; debitMinor: bigint; creditMinor: bigint }>();
      for (const l of lines as any[]) {
        const e = byAccount.get(l.account.code) ?? { accountCode: l.account.code, accountName: l.account.nameEn, accountType: l.account.type, debitMinor: 0n, creditMinor: 0n };
        e.debitMinor += BigInt(l.debitMinor);
        e.creditMinor += BigInt(l.creditMinor);
        byAccount.set(l.account.code, e);
      }
      return toJson({
        fiscalPeriod: period ? { id: period.id, fiscalYear: period.fiscalYear, periodNumber: period.periodNumber, status: period.status } : null,
        from: from?.toISOString(), to: to?.toISOString(),
        ...pl,
        accounts: [...byAccount.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      });
    });
  }

  async balanceSheet(tenantId: string, asOf?: string) {
    const ref = asOf ? new Date(asOf) : new Date();
    const key = `bs:${ref.toISOString().slice(0, 10)}`;
    return this.cached(tenantId, key, async () => {
      const fiscalYear = ref.getUTCFullYear();
      const [accounts, openings, lines, ytdLines] = await this.prisma.withTenant(tenantId, (tx) =>
        Promise.all([
          (tx as any).chartOfAccounts.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
          (tx as any).openingBalance.findMany({ where: { tenantId, fiscalYear } }),
          (tx as any).journalEntryLine.findMany({
            where: { tenantId, entry: { status: { in: POSTED_STATUSES }, entryDate: { lte: ref } } },
            select: { accountId: true, debitMinor: true, creditMinor: true },
          }),
          (tx as any).journalEntryLine.findMany({
            where: { tenantId, entry: { status: { in: POSTED_STATUSES }, entryDate: { gte: new Date(Date.UTC(fiscalYear, 0, 1)), lte: ref } } },
            select: { accountId: true, debitMinor: true, creditMinor: true, account: { select: { code: true, type: true } } },
          }),
        ]),
      );
      const openingByAccount = new Map<string, any>((openings as any[]).map((o) => [o.accountId, o] as [string, any]));
      const movement = new Map<string, bigint>();
      for (const l of lines as any[]) movement.set(l.accountId, (movement.get(l.accountId) ?? 0n) + BigInt(l.debitMinor) - BigInt(l.creditMinor));
      const rows: any[] = [];
      for (const a of accounts as any[]) {
        const o = openingByAccount.get(a.id);
        const net = (BigInt(o?.debitMinor ?? 0) - BigInt(o?.creditMinor ?? 0)) + (movement.get(a.id) ?? 0n);
        rows.push({ accountCode: a.code, accountName: a.nameEn, accountType: a.type, debitMinor: net > 0n ? net : 0n, creditMinor: net < 0n ? -net : 0n, netDebitMinor: net });
      }
      const ytdPl = computeProfitLoss((ytdLines as any[]).map((l) => ({ accountCode: l.account.code, accountType: l.account.type, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      const bs = computeBalanceSheet(rows, ytdPl.netIncomeMinor);
      return toJson({ asOf: ref.toISOString(), fiscalYear, ...bs, accounts: rows.filter((r) => r.netDebitMinor !== 0n) });
    });
  }

  async cashFlow(tenantId: string, from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const toDate = to ? new Date(to) : new Date();
    const key = `cf:${fromDate.toISOString().slice(0, 10)}:${toDate.toISOString().slice(0, 10)}`;
    return this.cached(tenantId, key, async () => {
      const fiscalYear = fromDate.getUTCFullYear();
      const [accounts, openings, beforeLines, inRangeLines] = await this.prisma.withTenant(tenantId, (tx) =>
        Promise.all([
          (tx as any).chartOfAccounts.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
          (tx as any).openingBalance.findMany({ where: { tenantId, fiscalYear } }),
          (tx as any).journalEntryLine.findMany({
            where: { tenantId, entry: { status: { in: POSTED_STATUSES }, entryDate: { lt: fromDate } } },
            select: { accountId: true, debitMinor: true, creditMinor: true },
          }),
          (tx as any).journalEntryLine.findMany({
            where: { tenantId, entry: { status: { in: POSTED_STATUSES }, entryDate: { gte: fromDate, lte: toDate } } },
            select: { accountId: true, debitMinor: true, creditMinor: true, account: { select: { code: true, type: true } } },
          }),
        ]),
      );
      const openingByAccount = new Map<string, any>((openings as any[]).map((o) => [o.accountId, o] as [string, any]));
      const before = new Map<string, bigint>();
      for (const l of beforeLines as any[]) before.set(l.accountId, (before.get(l.accountId) ?? 0n) + BigInt(l.debitMinor) - BigInt(l.creditMinor));
      const inRange = new Map<string, bigint>();
      for (const l of inRangeLines as any[]) inRange.set(l.accountId, (inRange.get(l.accountId) ?? 0n) + BigInt(l.debitMinor) - BigInt(l.creditMinor));
      const changes: any[] = [];
      let openingCash = 0n;
      let closingCash = 0n;
      for (const a of accounts as any[]) {
        const openingNet = (BigInt(openingByAccount.get(a.id)?.debitMinor ?? 0) - BigInt(openingByAccount.get(a.id)?.creditMinor ?? 0)) + (before.get(a.id) ?? 0n);
        const closingNet = openingNet + (inRange.get(a.id) ?? 0n);
        changes.push({ accountCode: a.code, accountType: a.type, openingNetDebitMinor: openingNet, closingNetDebitMinor: closingNet });
        if (['1010', '1020', '1030'].includes(a.code)) {
          openingCash += openingNet;
          closingCash += closingNet;
        }
      }
      const pl = computeProfitLoss((inRangeLines as any[]).map((l) => ({ accountCode: l.account.code, accountType: l.account.type, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      const cf = computeCashFlow(changes, pl.netIncomeMinor, closingCash - openingCash);
      return toJson({
        from: fromDate.toISOString(), to: toDate.toISOString(),
        openingCashMinor: openingCash, closingCashMinor: closingCash,
        ...cf,
        method: 'Simple indirect presentation from bank/cash account movements (see docs/erd-phase10.md).',
      });
    });
  }

  // --- Raw aggregates shared by the AI module -------------------------------

  /** Overdue open AR (POSTED/PARTIALLY_PAID invoices past due). */
  async overdueAr(tenantId: string): Promise<{ count: number; totalMinor: bigint }> {
    const now = new Date();
    const rows: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoice.findMany({
        where: { tenantId, type: 'INVOICE', status: { in: OPEN_INVOICE_STATUSES }, dueDate: { lt: now } },
        select: { totalMinor: true, paidMinor: true },
      }),
    );
    let total = 0n;
    let count = 0;
    for (const r of rows) {
      const balance = BigInt(r.totalMinor) - BigInt(r.paidMinor);
      if (balance > 0n) { total += balance; count += 1; }
    }
    return { count, totalMinor: total };
  }
}
