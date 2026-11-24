/**
 * Phase 11 — data export centre.
 *
 * Direct downloads (GET /exports/:type?format=csv|json) stream rows in pages
 * of 500 from live, tenant-scoped data; CSV uses the same `toCsv` helper as
 * the Phase 10 analytics exports. POST /exports/jobs records an `ExportJob`
 * (type, format, row count, requester) for the same generation — in Phase 11
 * jobs run synchronously and `fileAssetId` stays null: there is no stored
 * file yet, the download endpoints are the delivery path (documented in
 * docs/erd-phase11.md). Employee exports mask national ID / IBAN unless the
 * caller has `hr:read-sensitive`, exactly like the HR endpoints.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { fieldEncryptor } from '@eserp/db';
import { EXPORT_TYPES, maskSensitive, type ExportType } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { toCsv } from '../analytics/exports.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

const PAGE = 500;

@Injectable()
export class ExportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  private async fetchAll<T>(tenantId: string, fetchPage: (skip: number) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    let skip = 0;
    for (;;) {
      const page = await fetchPage(skip);
      out.push(...page);
      if (page.length < PAGE) break;
      skip += PAGE;
    }
    return out;
  }

  async rows(tenantId: string, type: ExportType, canReadSensitive: boolean): Promise<Record<string, unknown>[]> {
    switch (type) {
      case 'contacts': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).contact.findMany({ where: { tenantId }, orderBy: { legalName: 'asc' }, skip, take: PAGE }),
          ),
        );
        return rows.map((r) => ({ type: r.type, legalName: r.legalName, displayName: r.displayName, taxNumber: r.taxNumber ?? '', email: r.email ?? '', phone: r.phone ?? '', creditLimitMinor: Number(r.creditLimitMinor ?? 0), paymentTermsDays: r.paymentTermsDays ?? '', status: r.status }));
      }
      case 'items': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).item.findMany({ where: { tenantId }, orderBy: { sku: 'asc' }, skip, take: PAGE, include: { category: { select: { code: true } } } }),
          ),
        );
        return rows.map((r) => ({ sku: r.sku, name: r.name, category: r.category?.code ?? '', salesPriceMinor: Number(r.salesPriceMinor ?? 0), purchasePriceMinor: Number(r.purchasePriceMinor ?? 0), standardCostMinor: Number(r.standardCostMinor ?? 0), status: r.status, trackStock: r.trackStock }));
      }
      case 'sales-invoices': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).salesInvoice.findMany({ where: { tenantId }, orderBy: { invoiceDate: 'desc' }, skip, take: PAGE, include: { customer: { select: { displayName: true } } } }),
          ),
        );
        return rows.map((r) => ({ number: r.number, type: r.type, customer: r.customer?.displayName ?? '', status: r.status, invoiceDate: r.invoiceDate, dueDate: r.dueDate, currency: r.currency, subtotalMinor: Number(r.subtotalMinor), taxMinor: Number(r.taxMinor), totalMinor: Number(r.totalMinor), paidMinor: Number(r.paidMinor) }));
      }
      case 'purchase-orders': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).purchaseOrder.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, skip, take: PAGE, include: { supplier: { select: { displayName: true } } } }),
          ),
        );
        return rows.map((r) => ({ number: r.number, supplier: r.supplier?.displayName ?? '', status: r.status, currency: r.currency, subtotalMinor: Number(r.subtotalMinor), taxMinor: Number(r.taxMinor), totalMinor: Number(r.totalMinor), expectedDate: r.expectedDate ?? '' }));
      }
      case 'journal-entries': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).journalEntry.findMany({ where: { tenantId }, orderBy: { entryDate: 'desc' }, skip, take: PAGE, include: { lines: { select: { debitMinor: true, creditMinor: true } } } }),
          ),
        );
        return rows.map((r) => ({
          number: r.number, entryDate: r.entryDate, status: r.status, source: r.source, description: r.description ?? '',
          debitMinor: Number((r.lines as any[]).reduce((s: bigint, l: any) => s + BigInt(l.debitMinor), 0n)),
          creditMinor: Number((r.lines as any[]).reduce((s: bigint, l: any) => s + BigInt(l.creditMinor), 0n)),
        }));
      }
      case 'stock-levels': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).stockLevel.findMany({ where: { tenantId }, orderBy: { item: { sku: 'asc' } }, skip, take: PAGE, include: { warehouse: { select: { code: true } }, item: { select: { sku: true, name: true } } } }),
          ),
        );
        return rows.map((r) => ({
          warehouse: r.warehouse?.code ?? '', sku: r.item?.sku ?? '', item: r.item?.name ?? '',
          qtyOnHand: Number(r.qtyOnHand), qtyReserved: Number(r.qtyReserved),
          qtyAvailable: Number(BigInt(r.qtyOnHand) - BigInt(r.qtyReserved)),
          averageCostMinor: Number(r.averageCostMinor), lastCostMinor: Number(r.lastCostMinor),
        }));
      }
      case 'employees': {
        const rows: any[] = await this.fetchAll(tenantId, (skip) =>
          this.prisma.withTenant(tenantId, (tx) =>
            (tx as any).employee.findMany({ where: { tenantId }, orderBy: { code: 'asc' }, skip, take: PAGE, include: { department: { select: { code: true } } } }),
          ),
        );
        const present = (v: string | null | undefined): string | null => {
          if (v === null || v === undefined || v === '') return null;
          if (canReadSensitive) {
            try { return fieldEncryptor().decrypt(v); } catch { return '****'; }
          }
          try { return maskSensitive(fieldEncryptor().decrypt(v)); } catch { return '****'; }
        };
        return rows.map((r) => ({
          code: r.code, name: r.name, jobTitle: r.jobTitle, department: r.department?.code ?? '',
          status: r.status, nationality: r.nationality, hireDate: r.hireDate,
          nationalId: present(r.nationalId) ?? '', iban: present(r.iban) ?? '',
          basicSalaryMinor: Number(r.basicSalaryMinor),
        }));
      }
      default:
        throw new BadRequestException(`Unknown export type: ${String(type)}`);
    }
  }

  async download(tenantId: string, type: string, format: string, canReadSensitive: boolean): Promise<{ content: string; contentType: string; filename: string }> {
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) throw new BadRequestException(`Unknown export type: ${type}`);
    if (format !== 'CSV' && format !== 'JSON') throw new BadRequestException('format must be CSV or JSON');
    const rows = await this.rows(tenantId, type as ExportType, canReadSensitive);
    const ext = format === 'CSV' ? 'csv' : 'json';
    return {
      content: format === 'CSV' ? toCsv(rows) : JSON.stringify(rows, null, 2),
      contentType: format === 'CSV' ? 'text/csv' : 'application/json',
      filename: `${type}.${ext}`,
    };
  }

  async createJob(tenantId: string, actorId: string, type: ExportType, format: 'CSV' | 'JSON', canReadSensitive: boolean) {
    const rows = await this.rows(tenantId, type, canReadSensitive);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const job: any = await (tx as any).exportJob.create({
        data: { tenantId, type, format, status: 'COMPLETED', rowCount: rows.length, fileAssetId: null, requestedBy: actorId, createdBy: actorId },
      });
      await this.audit.log(
        { tenantId, actorId, action: 'create:ExportJob', entityType: 'ExportJob', entityId: job.id, after: { type, format, rowCount: rows.length } },
        tx as never,
      );
      await this.outbox.publish(tx as never, {
        tenantId, eventType: 'export-job.completed', aggregateId: job.id,
        payload: { id: job.id, type, format, rowCount: rows.length }, createdBy: actorId,
      });
      return toJson(job);
    });
  }

  async listJobs(tenantId: string, query: { page?: string; pageSize?: string; type?: string; status?: string }) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).exportJob.count({ where }),
        (tx as any).exportJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getJob(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).exportJob.findUnique({ where: { id } }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Export job not found');
    return toJson(row);
  }
}
