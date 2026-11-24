/**
 * Phase 10 — CSV exports + report snapshots. Every export is generated from
 * live data (same computations as the dashboard/statements); a snapshot
 * stores the generated JSON so the report can be re-downloaded later.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { agingBucket, daysPastDue } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { AnalyticsService } from './analytics.service';

export const SNAPSHOT_TYPES = [
  'PROFIT_LOSS', 'BALANCE_SHEET', 'CASH_FLOW', 'AR_AGING', 'AP_AGING',
  'STOCK_VALUATION', 'SALES_BY_ITEM', 'SALES_BY_CUSTOMER',
] as const;

export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','));
  return `${lines.join('\n')}\n`;
}

/** Flatten a snapshot's JSON content into CSV rows (best-effort, generic). */
export function contentToRows(content: Record<string, any>): Record<string, unknown>[] {
  for (const key of ['accounts', 'customers', 'rows', 'salesByMonth', 'topCustomers', 'topItems']) {
    if (Array.isArray(content[key])) return content[key] as Record<string, unknown>[];
  }
  return Object.entries(content)
    .filter(([, v]) => typeof v !== 'object' || v === null)
    .map(([field, value]) => ({ field, value: value as unknown }));
}

const OPEN_STATUSES = ['POSTED', 'PARTIALLY_PAID'];

@Injectable()
export class ExportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  private async arAgingRows(tenantId: string, asOf: Date): Promise<Record<string, unknown>[]> {
    const rows: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoice.findMany({
        where: { tenantId, type: 'INVOICE', status: { in: OPEN_STATUSES } },
        select: { number: true, dueDate: true, totalMinor: true, paidMinor: true, customer: { select: { displayName: true } } },
        orderBy: { dueDate: 'asc' },
      }),
    );
    return rows
      .map((r) => ({ customer: r.customer?.displayName ?? '', invoice: r.number, dueDate: r.dueDate, balanceMinor: Number(BigInt(r.totalMinor) - BigInt(r.paidMinor)), bucket: agingBucket(daysPastDue(r.dueDate, asOf)) }))
      .filter((r) => r.balanceMinor > 0);
  }

  private async apAgingRows(tenantId: string, asOf: Date): Promise<Record<string, unknown>[]> {
    const rows: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).supplierInvoice.findMany({
        where: { tenantId, status: { in: OPEN_STATUSES } },
        select: { number: true, dueDate: true, totalMinor: true, paidMinor: true, supplier: { select: { displayName: true } } },
        orderBy: { dueDate: 'asc' },
      }),
    );
    return rows
      .map((r) => ({ supplier: r.supplier?.displayName ?? '', invoice: r.number, dueDate: r.dueDate, balanceMinor: Number(BigInt(r.totalMinor) - BigInt(r.paidMinor)), bucket: agingBucket(daysPastDue(r.dueDate, asOf)) }))
      .filter((r) => r.balanceMinor > 0);
  }

  private async stockValuationRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const rows: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockLevel.findMany({
        select: {
          qtyOnHand: true, averageCostMinor: true,
          warehouse: { select: { code: true } }, item: { select: { sku: true, name: true } },
        },
        orderBy: { item: { sku: 'asc' } },
      }),
    );
    return rows.map((r) => ({
      warehouse: r.warehouse?.code ?? '', sku: r.item?.sku ?? '', item: r.item?.name ?? '',
      qtyOnHand: Number(r.qtyOnHand), averageCostMinor: Number(r.averageCostMinor),
      valueMinor: Number(BigInt(r.qtyOnHand) * BigInt(r.averageCostMinor)),
    }));
  }

  private async salesByItemRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const lines: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoiceLine.findMany({
        where: { tenantId, invoice: { type: 'INVOICE', status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } } },
        select: { itemId: true, quantity: true, lineTotalMinor: true, item: { select: { sku: true, name: true } } },
      }),
    );
    const byItem = new Map<string, { sku: string; item: string; quantity: bigint; revenueMinor: bigint }>();
    for (const l of lines) {
      if (!l.itemId) continue;
      const e = byItem.get(l.itemId) ?? { sku: l.item?.sku ?? '', item: l.item?.name ?? '', quantity: 0n, revenueMinor: 0n };
      e.quantity += BigInt(l.quantity);
      e.revenueMinor += BigInt(l.lineTotalMinor);
      byItem.set(l.itemId, e);
    }
    return [...byItem.values()]
      .map((e) => ({ sku: e.sku, item: e.item, quantity: Number(e.quantity), revenueMinor: Number(e.revenueMinor) }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor);
  }

  private async salesByCustomerRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const invoices: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoice.findMany({
        where: { tenantId, type: 'INVOICE', status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
        select: { customerId: true, totalMinor: true, customer: { select: { displayName: true } } },
      }),
    );
    const byCustomer = new Map<string, { customer: string; invoices: number; revenueMinor: bigint }>();
    for (const inv of invoices) {
      const e = byCustomer.get(inv.customerId) ?? { customer: inv.customer?.displayName ?? '', invoices: 0, revenueMinor: 0n };
      e.invoices += 1;
      e.revenueMinor += BigInt(inv.totalMinor);
      byCustomer.set(inv.customerId, e);
    }
    return [...byCustomer.values()]
      .map((e) => ({ customer: e.customer, invoices: e.invoices, revenueMinor: Number(e.revenueMinor) }))
      .sort((a, b) => b.revenueMinor - a.revenueMinor);
  }

  /** Generate the JSON content for a snapshot type from live data. */
  async generateContent(tenantId: string, type: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    const asOf = parameters.asOf ? new Date(String(parameters.asOf)) : new Date();
    switch (type) {
      case 'PROFIT_LOSS': {
        const pl: any = await this.analytics.profitLoss(tenantId, {
          fiscalPeriodId: parameters.fiscalPeriodId ? String(parameters.fiscalPeriodId) : undefined,
          from: parameters.from ? String(parameters.from) : undefined,
          to: parameters.to ? String(parameters.to) : undefined,
        });
        return { type, generatedAt: new Date().toISOString(), ...pl };
      }
      case 'BALANCE_SHEET': {
        const bs: any = await this.analytics.balanceSheet(tenantId, asOf.toISOString());
        return { type, generatedAt: new Date().toISOString(), ...bs };
      }
      case 'CASH_FLOW': {
        const cf: any = await this.analytics.cashFlow(
          tenantId,
          parameters.from ? String(parameters.from) : undefined,
          parameters.to ? String(parameters.to) : undefined,
        );
        return { type, generatedAt: new Date().toISOString(), ...cf };
      }
      case 'AR_AGING': {
        const rows = await this.arAgingRows(tenantId, asOf);
        return { type, generatedAt: new Date().toISOString(), asOf: asOf.toISOString(), rows };
      }
      case 'AP_AGING': {
        const rows = await this.apAgingRows(tenantId, asOf);
        return { type, generatedAt: new Date().toISOString(), asOf: asOf.toISOString(), rows };
      }
      case 'STOCK_VALUATION': {
        const rows = await this.stockValuationRows(tenantId);
        const totalMinor = rows.reduce((s, r) => s + Number(r.valueMinor), 0);
        return { type, generatedAt: new Date().toISOString(), totalMinor, rows };
      }
      case 'SALES_BY_ITEM': {
        const rows = await this.salesByItemRows(tenantId);
        return { type, generatedAt: new Date().toISOString(), rows };
      }
      case 'SALES_BY_CUSTOMER': {
        const rows = await this.salesByCustomerRows(tenantId);
        return { type, generatedAt: new Date().toISOString(), rows };
      }
      default:
        throw new NotFoundException(`Unknown report type ${type}`);
    }
  }

  /** One-shot CSV export of a report type (no snapshot stored). */
  async exportCsv(tenantId: string, report: string, query: Record<string, string | undefined>): Promise<{ filename: string; csv: string }> {
    const typeMap: Record<string, string> = {
      'profit-loss': 'PROFIT_LOSS', 'balance-sheet': 'BALANCE_SHEET', 'cash-flow': 'CASH_FLOW',
      'ar-aging': 'AR_AGING', 'ap-aging': 'AP_AGING', 'stock-valuation': 'STOCK_VALUATION',
      'sales-by-item': 'SALES_BY_ITEM', 'sales-by-customer': 'SALES_BY_CUSTOMER',
    };
    const type = typeMap[report.replace(/\.csv$/i, '')];
    if (!type) throw new NotFoundException(`Unknown export ${report}`);
    const content = await this.generateContent(tenantId, type, query as Record<string, unknown>);
    // Statements export their summary fields (revenueMinor, netIncomeMinor,
    // …) as field/value rows; list reports export their row arrays.
    const isStatement = ['PROFIT_LOSS', 'BALANCE_SHEET', 'CASH_FLOW'].includes(type);
    const rows = isStatement
      ? Object.entries(content)
          .filter(([, v]) => typeof v !== 'object' || v === null)
          .map(([field, value]) => ({ field, value: value as unknown }))
      : contentToRows(content);
    return { filename: `${report}.csv`, csv: toCsv(rows) };
  }

  // --- Snapshots --------------------------------------------------------------

  async listSnapshots(tenantId: string, query: { page?: string; pageSize?: string; type?: string }) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.type) where.type = query.type;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).reportSnapshot.count({ where }),
        (tx as any).reportSnapshot.findMany({ where, orderBy: { generatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getSnapshot(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).reportSnapshot.findUnique({ where: { id } }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Report snapshot not found');
    return toJson(row);
  }

  async createSnapshot(tenantId: string, actorId: string, dto: { type: string; parameters?: Record<string, unknown>; format?: string; content?: Record<string, unknown>; fileAssetId?: string | null }) {
    if (!SNAPSHOT_TYPES.includes(dto.type as (typeof SNAPSHOT_TYPES)[number])) {
      throw new NotFoundException(`Unknown report type ${dto.type}`);
    }
    const content = dto.content ?? (await this.generateContent(tenantId, dto.type, dto.parameters ?? {}));
    return this.prisma.withTenant(tenantId, async (tx) => {
      const created = await (tx as any).reportSnapshot.create({
        data: {
          tenantId, type: dto.type, parameters: (dto.parameters ?? {}) as object,
          format: dto.format ?? 'CSV', content: content as object,
          fileAssetId: dto.fileAssetId ?? null, generatedBy: actorId, createdBy: actorId,
        },
      });
      await this.audit.log({ tenantId, actorId, action: 'create:ReportSnapshot', entityType: 'ReportSnapshot', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'report-snapshot.created', aggregateId: created.id, payload: { id: created.id, type: dto.type }, createdBy: actorId });
      return toJson(created);
    });
  }

  async downloadSnapshot(tenantId: string, id: string, format?: string): Promise<{ filename: string; contentType: string; body: string }> {
    const row: any = await this.getSnapshot(tenantId, id);
    const fmt = (format ?? row.format ?? 'CSV').toUpperCase();
    if (fmt === 'JSON') {
      return { filename: `${row.type.toLowerCase()}-${id.slice(0, 8)}.json`, contentType: 'application/json', body: JSON.stringify(row.content ?? {}, null, 2) };
    }
    const content = (row.content ?? {}) as Record<string, any>;
    const isStatement = ['PROFIT_LOSS', 'BALANCE_SHEET', 'CASH_FLOW'].includes(row.type);
    const rows = isStatement
      ? Object.entries(content)
          .filter(([, v]) => typeof v !== 'object' || v === null)
          .map(([field, value]) => ({ field, value: value as unknown }))
      : contentToRows(content);
    return { filename: `${row.type.toLowerCase()}-${id.slice(0, 8)}.csv`, contentType: 'text/csv', body: toCsv(rows) };
  }
}
