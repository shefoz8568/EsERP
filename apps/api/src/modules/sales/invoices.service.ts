import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { creditLimitExceeded } from '@eserp/shared';
import type { SalesInvoiceDto, SalesInvoiceUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, dueDateFor, ensureSeries, findAccountByCode, getContact, openArMinor, validateDocLines } from './common';

export interface InvoiceListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  type?: string;
  customerId?: string;
  orderId?: string;
  projectId?: string;
}

const INCLUDE = {
  customer: { select: { id: true, displayName: true, legalName: true } },
  order: { select: { id: true, number: true } },
  lines: { orderBy: { lineOrder: 'asc' as const }, include: { item: { select: { id: true, sku: true, name: true } } } },
  allocations: { select: { id: true, paymentId: true, amountMinor: true } },
};

@Injectable()
export class SalesInvoicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  async list(tenantId: string, query: InvoiceListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.customerId) where.customerId = query.customerId;
    if (query.orderId) where.orderId = query.orderId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).salesInvoice.count({ where }),
        (tx as any).salesInvoice.findMany({ where, orderBy: { invoiceDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoice.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Sales invoice not found');
    return toJson(row);
  }

  /**
   * Create a DRAFT invoice (or credit note). Credit notes store NEGATIVE
   * totals — they are negative invoices, posted as the reverse entries.
   */
  async create(tenantId: string, actorId: string, dto: SalesInvoiceDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const customer = await getContact(tx as any, tenantId, dto.customerId, ['CUSTOMER', 'BOTH']);
      if (dto.orderId) {
        const order = await (tx as any).salesOrder.findUnique({ where: { id: dto.orderId } });
        if (!order || order.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
        if (order.customerId !== dto.customerId) throw new BadRequestException('Order belongs to a different customer');
      }
      const { validated, totals } = await validateDocLines(tx as any, tenantId, dto.lines);
      if (totals.totalMinor <= 0n) throw new BadRequestException('Invoice total must be positive');
      // Credit-limit rule (mirrors order confirm): blocked with 400 when
      // the customer's open AR + this invoice's total exceeds their credit
      // limit (a limit of 0 means "no limit set"). Credit notes reduce
      // exposure, so they are exempt.
      if (dto.type !== 'CREDIT_NOTE') {
        const openAr = await openArMinor(tx as any, tenantId, dto.customerId);
        if (creditLimitExceeded(openAr, totals.totalMinor, BigInt(customer.creditLimitMinor ?? 0))) {
          throw new BadRequestException(
            `Credit limit exceeded for ${customer.displayName}: open AR ${openAr} + invoice ${totals.totalMinor} exceeds limit ${customer.creditLimitMinor}`,
          );
        }
      }
      if (dto.projectId) {
        const project = await (tx as any).project.findUnique({ where: { id: dto.projectId } });
        if (!project || project.tenantId !== tenantId) throw new NotFoundException('Project not found');
        if (project.customerId && project.customerId !== dto.customerId) {
          throw new BadRequestException('Invoice customer does not match the project customer');
        }
      }
      const sign = dto.type === 'CREDIT_NOTE' ? -1n : 1n;
      await ensureSeries(tx as any, tenantId, actorId, 'INV');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'INV');
      const dueDate = dto.dueDate ? new Date(dto.dueDate) : dueDateFor(dto.invoiceDate, customer.paymentTermsDays);
      const created = await (tx as any).salesInvoice.create({
        data: {
          tenantId, number, type: dto.type, customerId: dto.customerId, orderId: dto.orderId ?? null,
          projectId: dto.projectId ?? null,
          status: 'DRAFT', currency: dto.currency, invoiceDate: new Date(dto.invoiceDate), dueDate,
          subtotalMinor: sign * totals.subtotalMinor, discountMinor: sign * totals.discountMinor,
          taxMinor: sign * totals.taxMinor, totalMinor: sign * totals.totalMinor, paidMinor: 0n,
          notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: validated.map((l, i) => ({
              tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitPriceMinor: BigInt(l.unitPriceMinor),
              discountPct: l.discountPct, taxRateBps: l.taxRateBps,
              lineSubtotalMinor: sign * l.netMinor, lineDiscountMinor: sign * l.discountMinor,
              lineTaxMinor: sign * l.taxMinor, lineTotalMinor: sign * l.totalMinor, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:SalesInvoice', entityType: 'SalesInvoice', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'sales-invoice.created', aggregateId: created.id, payload: { id: created.id, number, type: created.type }, createdBy: actorId });
      return toJson(created);
    });
  }

  /**
   * Phase 9 — milestone billing. Creates a DRAFT invoice inside the
   * caller's transaction (the milestone service owns the tx so the
   * milestone status flip and the invoice are atomic). The line is a
   * service line: no stock item (itemId null), labelled with the
   * milestone title, tax 0 — milestone amounts are treated as net and
   * VAT-exempt in Phase 9 (see docs/erd-phase9.md). Callers post the
   * invoice through the normal `post()` flow afterwards.
   */
  async createForMilestone(
    tx: any,
    tenantId: string,
    actorId: string,
    input: { customerId: string; projectId: string; title: string; amountMinor: bigint; currency: string; invoiceDate: Date },
  ) {
    const customer = await getContact(tx as any, tenantId, input.customerId, ['CUSTOMER', 'BOTH']);
    await ensureSeries(tx as any, tenantId, actorId, 'INV');
    const number = await this.numbering.nextNumber(tx as any, tenantId, 'INV');
    const dueDate = dueDateFor(input.invoiceDate.toISOString(), customer.paymentTermsDays);
    const created = await (tx as any).salesInvoice.create({
      data: {
        tenantId, number, type: 'INVOICE', customerId: input.customerId, orderId: null,
        projectId: input.projectId, status: 'DRAFT', currency: input.currency,
        invoiceDate: input.invoiceDate, dueDate,
        subtotalMinor: input.amountMinor, discountMinor: 0n, taxMinor: 0n,
        totalMinor: input.amountMinor, paidMinor: 0n,
        notes: `Milestone billing: ${input.title}`, createdBy: actorId,
        lines: {
          create: [{
            tenantId, itemId: null, description: input.title, quantity: 1n,
            unitPriceMinor: input.amountMinor, discountPct: 0, taxRateBps: 0,
            lineSubtotalMinor: input.amountMinor, lineDiscountMinor: 0n,
            lineTaxMinor: 0n, lineTotalMinor: input.amountMinor, lineOrder: 0, createdBy: actorId,
          }],
        },
      },
      include: INCLUDE,
    });
    await this.audit.log({ tenantId, actorId, action: 'create:SalesInvoice', entityType: 'SalesInvoice', entityId: created.id, after: toJson(created) }, tx as any);
    await this.outbox.publish(tx as any, { tenantId, eventType: 'sales-invoice.created', aggregateId: created.id, payload: { id: created.id, number, projectId: input.projectId }, createdBy: actorId });
    return toJson(created);
  }

  /** Update a DRAFT invoice (notes/lines replaced wholesale). */
  async update(tenantId: string, actorId: string, id: string, dto: SalesInvoiceUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoice.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be edited — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let totals = null;
      let validated = null;
      if (dto.lines) {
        const v = await validateDocLines(tx as any, tenantId, dto.lines);
        validated = v.validated;
        totals = v.totals;
        if (totals.totalMinor <= 0n) throw new BadRequestException('Invoice total must be positive');
        await (tx as any).salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
      }
      const sign = before.type === 'CREDIT_NOTE' ? -1n : 1n;
      const updated = await (tx as any).salesInvoice.update({
        where: { id },
        data: {
          notes: dto.notes !== undefined ? dto.notes : undefined,
          ...(totals ? { subtotalMinor: sign * totals.subtotalMinor, discountMinor: sign * totals.discountMinor, taxMinor: sign * totals.taxMinor, totalMinor: sign * totals.totalMinor } : {}),
          ...(validated ? { lines: { create: validated.map((l: any, i: number) => ({ tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitPriceMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps, lineSubtotalMinor: sign * l.netMinor, lineDiscountMinor: sign * l.discountMinor, lineTaxMinor: sign * l.taxMinor, lineTotalMinor: sign * l.totalMinor, lineOrder: i, createdBy: actorId })) } } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'update:SalesInvoice', entityType: 'SalesInvoice', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'sales-invoice.updated', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /**
   * Post a DRAFT invoice (DRAFT -> POSTED) via postBalanced():
   *   invoice:     Dr AR 1110 (total) / Cr Sales Revenue 4010 (net) / Cr Output VAT 2110 (tax)
   *   credit note: Dr Sales Revenue 4010 / Dr Output VAT 2110 / Cr AR 1110 (reversed)
   * The tax rate is linked on the revenue line only, so the Phase 2 VAT
   * summary counts output VAT exactly once. The customer credit limit is
   * enforced here (as at create time): posting is blocked with 400 when
   * open AR + this invoice exceeds the limit.
   */
  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesInvoice.findUnique({ where: { id }, include: { lines: true, customer: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be posted — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Credit-limit rule (mirrors order confirm and invoice create):
      // re-checked at post time because open AR can grow between create
      // and post. Credit notes reduce exposure, so they are exempt.
      if (before.type !== 'CREDIT_NOTE') {
        const openAr = await openArMinor(tx as any, tenantId, before.customerId);
        if (creditLimitExceeded(openAr, BigInt(before.totalMinor), BigInt(before.customer.creditLimitMinor ?? 0))) {
          throw new BadRequestException(
            `Credit limit exceeded for ${before.customer.displayName}: open AR ${openAr} + invoice ${before.totalMinor} exceeds limit ${before.customer.creditLimitMinor}`,
          );
        }
      }
      const ar = await findAccountByCode(tx as any, tenantId, COA.AR);
      const revenue = await findAccountByCode(tx as any, tenantId, COA.SALES_REVENUE);
      const vatOut = await findAccountByCode(tx as any, tenantId, COA.VAT_OUTPUT);
      const total = BigInt(before.totalMinor) < 0n ? -BigInt(before.totalMinor) : BigInt(before.totalMinor);
      const subtotal = BigInt(before.subtotalMinor) < 0n ? -BigInt(before.subtotalMinor) : BigInt(before.subtotalMinor);
      const tax = BigInt(before.taxMinor) < 0n ? -BigInt(before.taxMinor) : BigInt(before.taxMinor);
      const maxRateBps = before.lines.reduce((m: number, l: any) => Math.max(m, l.taxRateBps), 0);
      const taxRate = maxRateBps > 0
        ? await (tx as any).taxRate.findFirst({ where: { tenantId, rateBps: maxRateBps } })
        : null;
      const isCredit = before.type === 'CREDIT_NOTE';
      const lines: any[] = isCredit
        ? [
            { accountId: revenue.id, debitMinor: subtotal, creditMinor: 0n, taxRateId: taxRate?.id ?? null, description: `Credit note ${before.number}` },
            ...(tax > 0n ? [{ accountId: vatOut.id, debitMinor: tax, creditMinor: 0n, description: `Credit note ${before.number}` }] : []),
            { accountId: ar.id, debitMinor: 0n, creditMinor: total, description: `Credit note ${before.number}` },
          ]
        : [
            { accountId: ar.id, debitMinor: total, creditMinor: 0n, description: `Invoice ${before.number}` },
            { accountId: revenue.id, debitMinor: 0n, creditMinor: subtotal, taxRateId: taxRate?.id ?? null, description: `Invoice ${before.number}` },
            ...(tax > 0n ? [{ accountId: vatOut.id, debitMinor: 0n, creditMinor: tax, description: `Invoice ${before.number}` }] : []),
          ];
      const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
        entryDate: before.invoiceDate,
        description: `${isCredit ? 'Credit note' : 'Sales invoice'} ${before.number}`,
        reference: before.number,
        sourceModule: 'SALES',
        currency: before.currency,
        status: 'POSTED',
        lines,
      });
      const updated = await (tx as any).salesInvoice.update({
        where: { id }, data: { status: 'POSTED', journalEntryId: entry.id }, include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'post:SalesInvoice', entityType: 'SalesInvoice', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'sales-invoice.posted', aggregateId: id, payload: { id, number: updated.number, journalEntryId: entry.id }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /** VOID only from DRAFT; POSTED invoices are corrected by credit note. */
  async void(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).salesInvoice.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales invoice not found');
    if (before.status !== 'DRAFT') {
      throw new ConflictException(`Only DRAFT invoices can be voided — this invoice is ${before.status}; post a credit note to correct a POSTED invoice`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).salesInvoice.update({ where: { id }, data: { status: 'VOID' }, include: INCLUDE });
      await this.audit.log({ tenantId, actorId, action: 'void:SalesInvoice', entityType: 'SalesInvoice', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'sales-invoice.voided', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).salesInvoice.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be deleted — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).salesInvoice.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:SalesInvoice', entityType: 'SalesInvoice', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'sales-invoice.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
