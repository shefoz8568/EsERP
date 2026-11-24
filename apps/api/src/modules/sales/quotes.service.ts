import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SalesQuoteDto, SalesQuoteUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { ensureSeries, getContact, quoteWithLiveStatus, validateDocLines } from './common';

export interface QuoteListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  customerId?: string;
}

const INCLUDE = {
  customer: { select: { id: true, displayName: true, legalName: true } },
  lines: { orderBy: { lineOrder: 'asc' as const }, include: { item: { select: { id: true, sku: true, name: true } } } },
};

function withLiveStatus(row: any): any {
  return toJson(quoteWithLiveStatus(row));
}

@Injectable()
export class QuotesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: QuoteListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).salesQuote.count({ where }),
        (tx as any).salesQuote.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: data.map(withLiveStatus), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesQuote.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Quote not found');
    return withLiveStatus(row);
  }

  async create(tenantId: string, actorId: string, dto: SalesQuoteDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getContact(tx as any, tenantId, dto.customerId, ['CUSTOMER', 'BOTH']);
      const { validated, totals } = await validateDocLines(tx as any, tenantId, dto.lines);
      await ensureSeries(tx as any, tenantId, actorId, 'QUO');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'QUO');
      const created = await (tx as any).salesQuote.create({
        data: {
          tenantId,
          number,
          customerId: dto.customerId,
          validFrom: new Date(dto.validFrom),
          validTo: new Date(dto.validTo),
          status: 'DRAFT',
          currency: dto.currency,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          notes: dto.notes ?? null,
          createdBy: actorId,
          lines: {
            create: validated.map((l, i) => ({
              tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitPriceMinor: BigInt(l.unitPriceMinor),
              discountPct: l.discountPct, taxRateBps: l.taxRateBps,
              lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor,
              lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:SalesQuote', entityType: 'SalesQuote', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'quote.created', aggregateId: created.id, payload: { id: created.id, number }, createdBy: actorId });
      return withLiveStatus(created);
    });
  }

  /** Update a DRAFT quote (dates/notes/lines replaced wholesale). */
  async update(tenantId: string, actorId: string, id: string, dto: SalesQuoteUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesQuote.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Quote not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT quotes can be edited — this quote is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let totals = null;
      let validated = null;
      if (dto.lines) {
        const v = await validateDocLines(tx as any, tenantId, dto.lines);
        validated = v.validated;
        totals = v.totals;
        await (tx as any).quoteLine.deleteMany({ where: { quoteId: id } });
      }
      const updated = await (tx as any).salesQuote.update({
        where: { id },
        data: {
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo ? new Date(dto.validTo) : undefined,
          notes: dto.notes !== undefined ? dto.notes : undefined,
          ...(totals ? { subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor } : {}),
          ...(validated ? { lines: { create: validated.map((l: any, i: number) => ({ tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitPriceMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps, lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor, lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId })) } } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'update:SalesQuote', entityType: 'SalesQuote', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'quote.updated', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return withLiveStatus(updated);
    });
  }

  /** DRAFT -> SENT. */
  async send(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, 'DRAFT', 'SENT', 'send:SalesQuote', 'quote.sent');
  }

  /**
   * Accept a SENT quote: creates a DRAFT SalesOrder from the quote lines
   * and links it (quote.salesOrderId). An expired quote (validTo past)
   * cannot be accepted — its live status is EXPIRED.
   */
  async accept(tenantId: string, actorId: string, id: string) {
    const quote: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesQuote.findUnique({ where: { id }, include: { lines: { orderBy: { lineOrder: 'asc' } } } }),
    );
    if (!quote || quote.tenantId !== tenantId) throw new NotFoundException('Quote not found');
    const live = quoteWithLiveStatus(quote);
    if (live.status !== 'SENT') throw new ConflictException(`Only SENT quotes can be accepted — this quote is ${live.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      await ensureSeries(tx as any, tenantId, actorId, 'SO');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'SO');
      const order = await (tx as any).salesOrder.create({
        data: {
          tenantId, number, customerId: quote.customerId, quoteId: quote.id, status: 'DRAFT',
          currency: quote.currency, subtotalMinor: quote.subtotalMinor, discountMinor: quote.discountMinor,
          taxMinor: quote.taxMinor, totalMinor: quote.totalMinor, notes: quote.notes, createdBy: actorId,
          lines: {
            create: quote.lines.map((l: any) => ({
              tenantId, itemId: l.itemId, quantityOrdered: l.quantity, quantityFulfilled: 0n,
              unitPriceMinor: l.unitPriceMinor, discountPct: l.discountPct, taxRateBps: l.taxRateBps,
              lineSubtotalMinor: l.lineSubtotalMinor, lineDiscountMinor: l.lineDiscountMinor,
              lineTaxMinor: l.lineTaxMinor, lineTotalMinor: l.lineTotalMinor, lineOrder: l.lineOrder, createdBy: actorId,
            })),
          },
        },
      });
      const updated = await (tx as any).salesQuote.update({
        where: { id }, data: { status: 'ACCEPTED', salesOrderId: order.id }, include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'accept:SalesQuote', entityType: 'SalesQuote', entityId: id, before: toJson(quote), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'quote.accepted', aggregateId: id, payload: { id, number: updated.number, salesOrderId: order.id }, createdBy: actorId });
      return withLiveStatus(updated);
    });
  }

  /** Reject a SENT quote. */
  async reject(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, 'SENT', 'REJECTED', 'reject:SalesQuote', 'quote.rejected');
  }

  private async transition(tenantId: string, actorId: string, id: string, from: string, to: string, action: string, event: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).salesQuote.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Quote not found');
    const live = quoteWithLiveStatus(before);
    if (live.status !== from) throw new ConflictException(`Only ${from} quotes can move to ${to} — this quote is ${live.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).salesQuote.update({ where: { id }, data: { status: to }, include: INCLUDE });
      await this.audit.log({ tenantId, actorId, action, entityType: 'SalesQuote', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: event, aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return withLiveStatus(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).salesQuote.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Quote not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT quotes can be deleted — this quote is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).salesQuote.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:SalesQuote', entityType: 'SalesQuote', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'quote.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
