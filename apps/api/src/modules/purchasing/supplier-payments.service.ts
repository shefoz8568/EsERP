import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SupplierPaymentDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, cashAccountCode, ensureSeries, findAccountByCode, getContact } from '../sales/common';

export interface SupplierPaymentListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  supplierId?: string;
  method?: string;
}

const INCLUDE = {
  supplier: { select: { id: true, displayName: true, legalName: true } },
  allocations: {
    orderBy: { createdAt: 'asc' as const },
    include: { invoice: { select: { id: true, number: true, totalMinor: true, paidMinor: true, status: true } } },
  },
};

@Injectable()
export class SupplierPaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  async list(tenantId: string, query: SupplierPaymentListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.method) where.method = query.method;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).supplierPayment.count({ where }),
        (tx as any).supplierPayment.findMany({ where, orderBy: { paymentDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).supplierPayment.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Supplier payment not found');
    return toJson(row);
  }

  /**
   * Create + post a payment in one step (payments have no DRAFT state):
   * validates every allocation against the invoice's unpaid balance, posts
   * Dr AP / Cr Cash/Bank via postBalanced(), then updates each invoice's
   * paidMinor and status (PARTIALLY_PAID / PAID).
   */
  async create(tenantId: string, actorId: string, dto: SupplierPaymentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getContact(tx as any, tenantId, dto.supplierId, ['SUPPLIER', 'BOTH']);
      const invoices: any[] = [];
      for (const alloc of dto.allocations) {
        const inv = await (tx as any).supplierInvoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!inv || inv.tenantId !== tenantId) throw new NotFoundException(`Invoice not found: ${alloc.invoiceId}`);
        if (inv.supplierId !== dto.supplierId) throw new BadRequestException(`Invoice ${inv.number} belongs to a different supplier`);
        if (!['POSTED', 'PARTIALLY_PAID'].includes(inv.status)) {
          throw new BadRequestException(`Invoice ${inv.number} is ${inv.status} — only POSTED or PARTIALLY_PAID invoices accept payments`);
        }
        const balance = BigInt(inv.totalMinor) - BigInt(inv.paidMinor);
        if (BigInt(alloc.amountMinor) > balance) {
          throw new BadRequestException(`Allocation ${alloc.amountMinor} exceeds the unpaid balance ${balance} of invoice ${inv.number}`);
        }
        invoices.push(inv);
      }
      await ensureSeries(tx as any, tenantId, actorId, 'SPAY');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'SPAY');
      const cash = await findAccountByCode(tx as any, tenantId, cashAccountCode(dto.method));
      const ap = await findAccountByCode(tx as any, tenantId, COA.AP);
      const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
        entryDate: dto.paymentDate,
        description: `Supplier payment ${number}`,
        reference: dto.reference ?? number,
        sourceModule: 'PURCHASING',
        currency: dto.currency,
        status: 'POSTED',
        lines: [
          { accountId: ap.id, debitMinor: BigInt(dto.amountMinor), creditMinor: 0n, description: `Supplier payment ${number}` },
          { accountId: cash.id, debitMinor: 0n, creditMinor: BigInt(dto.amountMinor), description: `Supplier payment ${number}` },
        ],
      });
      const created = await (tx as any).supplierPayment.create({
        data: {
          tenantId, number, supplierId: dto.supplierId, method: dto.method, reference: dto.reference ?? null,
          paymentDate: new Date(dto.paymentDate), currency: dto.currency, amountMinor: BigInt(dto.amountMinor),
          journalEntryId: entry.id, createdBy: actorId,
          allocations: {
            create: dto.allocations.map((a) => ({ tenantId, invoiceId: a.invoiceId, amountMinor: BigInt(a.amountMinor), createdBy: actorId })),
          },
        },
        include: INCLUDE,
      });
      for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        const newPaid = BigInt(inv.paidMinor) + BigInt(dto.allocations[i].amountMinor);
        const status = newPaid >= BigInt(inv.totalMinor) ? 'PAID' : 'PARTIALLY_PAID';
        await (tx as any).supplierInvoice.update({ where: { id: inv.id }, data: { paidMinor: newPaid, status } });
      }
      await this.audit.log({ tenantId, actorId, action: 'create:SupplierPayment', entityType: 'SupplierPayment', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'supplier-payment.created', aggregateId: created.id, payload: { id: created.id, number, journalEntryId: entry.id }, createdBy: actorId });
      return toJson(created);
    });
  }
}
