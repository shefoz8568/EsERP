import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PurchaseOrderDto, PurchaseOrderUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { ensureSeries, getContact, validateDocLines } from '../sales/common';

export interface PurchaseOrderListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  supplierId?: string;
}

const INCLUDE = {
  supplier: { select: { id: true, displayName: true, legalName: true } },
  lines: { orderBy: { lineOrder: 'asc' as const }, include: { item: { select: { id: true, sku: true, name: true } } } },
};

/**
 * Purchase orders are commitments only: no ledger posting happens for a PO
 * itself (documented in docs/erd-phase4.md). Approval is DRAFT -> SENT ->
 * CONFIRMED (confirmed = sent to the supplier).
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: PurchaseOrderListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).purchaseOrder.count({ where }),
        (tx as any).purchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).purchaseOrder.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: PurchaseOrderDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getContact(tx as any, tenantId, dto.supplierId, ['SUPPLIER', 'BOTH']);
      const { validated, totals } = await validateDocLines(tx as any, tenantId, dto.lines);
      await ensureSeries(tx as any, tenantId, actorId, 'PO');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'PO');
      const created = await (tx as any).purchaseOrder.create({
        data: {
          tenantId, number, supplierId: dto.supplierId, status: 'DRAFT', currency: dto.currency,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor, totalMinor: totals.totalMinor, notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: validated.map((l, i) => ({
              tenantId, itemId: l.itemId, quantityOrdered: BigInt(l.quantity), quantityReceived: 0n,
              unitCostMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps,
              lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor,
              lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:PurchaseOrder', entityType: 'PurchaseOrder', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'purchase-order.created', aggregateId: created.id, payload: { id: created.id, number }, createdBy: actorId });
      return toJson(created);
    });
  }

  /** Update a DRAFT purchase order (expected date/notes/lines replaced wholesale). */
  async update(tenantId: string, actorId: string, id: string, dto: PurchaseOrderUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).purchaseOrder.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT purchase orders can be edited — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let totals = null;
      let validated = null;
      if (dto.lines) {
        const v = await validateDocLines(tx as any, tenantId, dto.lines);
        validated = v.validated;
        totals = v.totals;
        await (tx as any).purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      }
      const updated = await (tx as any).purchaseOrder.update({
        where: { id },
        data: {
          expectedDate: dto.expectedDate !== undefined ? (dto.expectedDate ? new Date(dto.expectedDate) : null) : undefined,
          notes: dto.notes !== undefined ? dto.notes : undefined,
          ...(totals ? { subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor } : {}),
          ...(validated ? { lines: { create: validated.map((l: any, i: number) => ({ tenantId, itemId: l.itemId, quantityOrdered: BigInt(l.quantity), quantityReceived: 0n, unitCostMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps, lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor, lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId })) } } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'update:PurchaseOrder', entityType: 'PurchaseOrder', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'purchase-order.updated', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /** DRAFT -> SENT. */
  async send(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, 'DRAFT', 'SENT', 'send:PurchaseOrder', 'purchase-order.sent');
  }

  /** SENT -> CONFIRMED (confirmed = sent to the supplier). */
  async confirm(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, 'SENT', 'CONFIRMED', 'confirm:PurchaseOrder', 'purchase-order.confirmed');
  }

  /** Close a CONFIRMED / RECEIVED order. */
  async close(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).purchaseOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    if (!['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(before.status)) {
      throw new ConflictException(`Only CONFIRMED, PARTIALLY_RECEIVED or RECEIVED orders can be closed — this order is ${before.status}`);
    }
    return this.transition(tenantId, actorId, id, before.status, 'CLOSED', 'close:PurchaseOrder', 'purchase-order.closed');
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).purchaseOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    if (!['DRAFT', 'SENT', 'CONFIRMED'].includes(before.status)) {
      throw new ConflictException(`Only DRAFT, SENT or CONFIRMED orders can be cancelled — this order is ${before.status}`);
    }
    return this.transition(tenantId, actorId, id, before.status, 'CANCELLED', 'cancel:PurchaseOrder', 'purchase-order.cancelled');
  }

  private async transition(tenantId: string, actorId: string, id: string, from: string, to: string, action: string, event: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).purchaseOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    if (before.status !== from) throw new ConflictException(`Only ${from} purchase orders can move to ${to} — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).purchaseOrder.update({ where: { id }, data: { status: to }, include: INCLUDE });
      await this.audit.log({ tenantId, actorId, action, entityType: 'PurchaseOrder', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: event, aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).purchaseOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT purchase orders can be deleted — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).purchaseOrder.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:PurchaseOrder', entityType: 'PurchaseOrder', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'purchase-order.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
