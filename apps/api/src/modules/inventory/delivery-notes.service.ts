import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DeliveryNoteDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, findAccountByCode } from '../sales/common';
import { ensureSeries } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from './stock.service';

export interface DeliveryNoteListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  salesOrderId?: string;
  warehouseId?: string;
}

const INCLUDE = {
  salesOrder: { select: { id: true, number: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: { item: { select: { id: true, sku: true, name: true } }, salesOrderLine: { select: { id: true, quantityOrdered: true, quantityFulfilled: true } } },
  },
};

/**
 * Delivery notes (Phase 5): fulfilling sales order lines from a warehouse.
 * Posting on POSTED: Dr COGS 5010 / Cr Inventory 1210 at valuation cost.
 * Updates SalesOrderLine.quantityFulfilled, the order status
 * (PARTIALLY_FULFILLED -> FULFILLED) and releases the reservation.
 */
@Injectable()
export class DeliveryNotesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: DeliveryNoteListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.salesOrderId) where.salesOrderId = query.salesOrderId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).deliveryNote.count({ where }),
        (tx as any).deliveryNote.findMany({ where, orderBy: { deliveryDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).deliveryNote.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Delivery note not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: DeliveryNoteDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const order: any = await (tx as any).salesOrder.findUnique({ where: { id: dto.salesOrderId }, include: { lines: true } });
      if (!order || order.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
      if (order.status === 'CANCELLED' || order.status === 'DRAFT') {
        throw new BadRequestException(`Cannot deliver against a ${order.status} sales order`);
      }
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      for (const line of dto.lines) {
        const orderLine = order.lines.find((l: any) => l.id === line.salesOrderLineId);
        if (!orderLine) throw new BadRequestException(`Sales order line not found: ${line.salesOrderLineId}`);
        if (orderLine.itemId !== line.itemId) throw new BadRequestException('Delivery line item does not match the sales order line item');
      }
      await ensureSeries(tx as any, tenantId, actorId, 'DN');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'DN');
      const created = await (tx as any).deliveryNote.create({
        data: {
          tenantId, number, salesOrderId: dto.salesOrderId, warehouseId: dto.warehouseId,
          status: 'DRAFT', deliveryDate: new Date(dto.deliveryDate), currency: dto.currency,
          notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: dto.lines.map((l, i) => ({
              tenantId, salesOrderLineId: l.salesOrderLineId, itemId: l.itemId,
              quantity: BigInt(l.quantity), unitCostMinor: 0n, lineTotalMinor: 0n, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:DeliveryNote', 'DeliveryNote', created.id, 'delivery-note.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  /** Post a DRAFT note: issue stock at valuation cost, fulfil lines, Dr COGS / Cr Inventory. */
  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).deliveryNote.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Delivery note not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT delivery notes can be posted — this note is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const order: any = await (tx as any).salesOrder.findUnique({ where: { id: before.salesOrderId }, include: { lines: true } });
      if (!order) throw new NotFoundException('Sales order not found');
      for (const line of before.lines) {
        const orderLine = order.lines.find((l: any) => l.id === line.salesOrderLineId);
        if (!orderLine) throw new BadRequestException(`Sales order line not found: ${line.salesOrderLineId}`);
        if (BigInt(orderLine.quantityFulfilled) + BigInt(line.quantity) > BigInt(orderLine.quantityOrdered)) {
          throw new BadRequestException(
            `Delivery quantity ${BigInt(orderLine.quantityFulfilled) + BigInt(line.quantity)} exceeds the ordered quantity ${orderLine.quantityOrdered}`,
          );
        }
      }
      let totalCost = 0n;
      for (const line of before.lines) {
        const issued = await this.stock.issue(tx as any, tenantId, actorId, {
          warehouseId: before.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          sourceType: 'DELIVERY_NOTE',
          sourceId: line.id,
          reference: before.number,
          movementDate: new Date(before.deliveryDate),
          currency: before.currency,
        });
        totalCost += issued.totalCostMinor;
        await (tx as any).deliveryNoteLine.update({
          where: { id: line.id },
          data: { unitCostMinor: issued.unitCostMinor, lineTotalMinor: issued.totalCostMinor },
        });
        await (tx as any).orderLine.update({
          where: { id: line.salesOrderLineId },
          data: { quantityFulfilled: { increment: BigInt(line.quantity) } },
        });
        await this.stock.releaseQty(tx as any, tenantId, before.warehouseId, line.itemId, BigInt(line.quantity));
      }
      const freshOrder: any = await (tx as any).salesOrder.findUnique({ where: { id: order.id }, include: { lines: true } });
      const allFulfilled = freshOrder.lines.every((l: any) => BigInt(l.quantityFulfilled) >= BigInt(l.quantityOrdered));
      const anyFulfilled = freshOrder.lines.some((l: any) => BigInt(l.quantityFulfilled) > 0n);
      const orderStatus = allFulfilled ? 'FULFILLED' : anyFulfilled ? 'PARTIALLY_FULFILLED' : order.status;
      if (orderStatus !== order.status) {
        await (tx as any).salesOrder.update({ where: { id: order.id }, data: { status: orderStatus } });
      }
      let journalEntryId: string | null = null;
      if (totalCost > 0n) {
        const cogs = await findAccountByCode(tx as any, tenantId, COA.COGS);
        const inventory = await findAccountByCode(tx as any, tenantId, COA.INVENTORY);
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.deliveryDate,
          description: `Delivery note ${before.number}`,
          reference: before.number,
          sourceModule: 'INVENTORY',
          currency: before.currency,
          status: 'POSTED',
          lines: [
            { accountId: cogs.id, debitMinor: totalCost, creditMinor: 0n, description: `Delivery note ${before.number}` },
            { accountId: inventory.id, debitMinor: 0n, creditMinor: totalCost, description: `Delivery note ${before.number}` },
          ],
        });
        journalEntryId = entry.id;
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'DELIVERY_NOTE', sourceId: { in: before.lines.map((l: any) => l.id) } },
          data: { journalEntryId },
        });
      }
      const updated = await (tx as any).deliveryNote.update({
        where: { id },
        data: { status: 'POSTED', totalCostMinor: totalCost, journalEntryId },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:DeliveryNote', 'DeliveryNote', id, 'delivery-note.posted', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).deliveryNote.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Delivery note not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT delivery notes can be cancelled — this note is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).deliveryNote.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:DeliveryNote', 'DeliveryNote', id, 'delivery-note.cancelled', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).deliveryNote.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Delivery note not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT delivery notes can be deleted — this note is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).deliveryNote.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:DeliveryNote', 'DeliveryNote', id, 'delivery-note.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
