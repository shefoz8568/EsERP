import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { creditLimitExceeded } from '@eserp/shared';
import type { SalesOrderDto, SalesOrderUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from '../inventory/stock.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { ensureSeries, getContact, openArMinor, validateDocLines } from './common';

export interface OrderListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  customerId?: string;
}

const INCLUDE = {
  customer: { select: { id: true, displayName: true, legalName: true, creditLimitMinor: true } },
  quote: { select: { id: true, number: true } },
  lines: { orderBy: { lineOrder: 'asc' as const }, include: { item: { select: { id: true, sku: true, name: true } } } },
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: OrderListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).salesOrder.count({ where }),
        (tx as any).salesOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: SalesOrderDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getContact(tx as any, tenantId, dto.customerId, ['CUSTOMER', 'BOTH']);
      if (dto.quoteId) {
        const quote = await (tx as any).salesQuote.findUnique({ where: { id: dto.quoteId } });
        if (!quote || quote.tenantId !== tenantId) throw new NotFoundException('Quote not found');
        if (quote.customerId !== dto.customerId) throw new BadRequestException('Quote belongs to a different customer');
      }
      const { validated, totals } = await validateDocLines(tx as any, tenantId, dto.lines);
      await ensureSeries(tx as any, tenantId, actorId, 'SO');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'SO');
      const created = await (tx as any).salesOrder.create({
        data: {
          tenantId, number, customerId: dto.customerId, quoteId: dto.quoteId ?? null, status: 'DRAFT',
          currency: dto.currency, subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor, totalMinor: totals.totalMinor, notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: validated.map((l, i) => ({
              tenantId, itemId: l.itemId, quantityOrdered: BigInt(l.quantity), quantityFulfilled: 0n,
              unitPriceMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps,
              lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor,
              lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:SalesOrder', entityType: 'SalesOrder', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'order.created', aggregateId: created.id, payload: { id: created.id, number }, createdBy: actorId });
      return toJson(created);
    });
  }

  /** Update a DRAFT order (notes/lines replaced wholesale). */
  async update(tenantId: string, actorId: string, id: string, dto: SalesOrderUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT orders can be edited — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let totals = null;
      let validated = null;
      if (dto.lines) {
        const v = await validateDocLines(tx as any, tenantId, dto.lines);
        validated = v.validated;
        totals = v.totals;
        await (tx as any).orderLine.deleteMany({ where: { orderId: id } });
      }
      const updated = await (tx as any).salesOrder.update({
        where: { id },
        data: {
          notes: dto.notes !== undefined ? dto.notes : undefined,
          ...(totals ? { subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor } : {}),
          ...(validated ? { lines: { create: validated.map((l: any, i: number) => ({ tenantId, itemId: l.itemId, quantityOrdered: BigInt(l.quantity), quantityFulfilled: 0n, unitPriceMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps, lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor, lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId })) } } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'update:SalesOrder', entityType: 'SalesOrder', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'order.updated', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /**
   * Confirm a DRAFT order. Credit-limit rule (see docs/erd-phase3.md):
   * blocked with 400 when the customer's open AR + this order's total
   * exceeds their credit limit (a limit of 0 means "no limit set").
   * Phase 5: confirming also reserves the ordered quantities against the
   * default warehouse (released by delivery or cancellation).
   */
  async confirm(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).salesOrder.findUnique({ where: { id }, include: { customer: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT orders can be confirmed — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const openAr = await openArMinor(tx as any, tenantId, before.customerId);
      if (creditLimitExceeded(openAr, BigInt(before.totalMinor), BigInt(before.customer.creditLimitMinor))) {
        throw new BadRequestException(
          `Credit limit exceeded for ${before.customer.displayName}: open AR ${openAr} + order ${before.totalMinor} exceeds limit ${before.customer.creditLimitMinor}`,
        );
      }
      const updated = await (tx as any).salesOrder.update({ where: { id }, data: { status: 'CONFIRMED' }, include: INCLUDE });
      await this.stock.reserveForOrder(tx as any, tenantId, actorId, id);
      await this.audit.log({ tenantId, actorId, action: 'confirm:SalesOrder', entityType: 'SalesOrder', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'order.confirmed', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).salesOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    if (!['DRAFT', 'CONFIRMED'].includes(before.status)) {
      throw new ConflictException(`Only DRAFT or CONFIRMED orders can be cancelled — this order is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).salesOrder.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      if (before.status === 'CONFIRMED') {
        // Phase 5: release the reservation made at confirm time.
        await this.stock.releaseForOrder(tx as any, tenantId, actorId, id);
      }
      await this.audit.log({ tenantId, actorId, action: 'cancel:SalesOrder', entityType: 'SalesOrder', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'order.cancelled', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).salesOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT orders can be deleted — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).salesOrder.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:SalesOrder', entityType: 'SalesOrder', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'order.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
