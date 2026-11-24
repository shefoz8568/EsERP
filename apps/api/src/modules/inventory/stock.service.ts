import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { availableQty, consumeFifo, weightedAverageCost } from '@eserp/shared';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface StockListQuery {
  page?: string;
  pageSize?: string;
  warehouseId?: string;
  itemId?: string;
  search?: string;
  lowStockOnly?: string;
}

export interface MovementListQuery {
  page?: string;
  pageSize?: string;
  warehouseId?: string;
  itemId?: string;
  type?: string;
  sourceType?: string;
  sourceId?: string;
}

export interface ReceiptInput {
  warehouseId: string;
  itemId: string;
  quantity: bigint | number;
  unitCostMinor: bigint | number;
  sourceType: string;
  sourceId?: string | null;
  reference?: string | null;
  movementDate: Date;
  currency?: string;
  /** Movement type for the receipt (default IN). */
  movementType?: string;
}

export interface IssueInput {
  warehouseId: string;
  itemId: string;
  quantity: bigint | number;
  sourceType: string;
  sourceId?: string | null;
  reference?: string | null;
  movementDate: Date;
  currency?: string;
  /** Force a unit cost instead of the valuation cost (adjustments only). */
  unitCostOverrideMinor?: bigint | number | null;
  movementType?: string;
}

/**
 * Inventory stock engine (Phase 5).
 *
 * All stock changes funnel through receipt()/issue() so that StockLevel,
 * StockCostLayer and StockMovement stay consistent inside the caller's
 * transaction. Valuation (see docs/erd-phase5.md):
 * - FIFO: consume StockCostLayer rows oldest-first; a remainder not covered
 *   by layers is valued at the level's average cost (fallback for stock
 *   that predates layers, e.g. opening balances).
 * - WEIGHTED_AVERAGE: issues use StockLevel.averageCostMinor; receipts
 *   recompute it with weightedAverageCost().
 * - STANDARD: issues use Item.standardCostMinor.
 * Items with trackStock=false skip stock entirely (cost 0, no movements).
 * Movements are append-only: corrections are new reversing movements.
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // --- Reads ---------------------------------------------------------------

  async listLevels(tenantId: string, query: StockListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.itemId) where.itemId = query.itemId;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).stockLevel.count({ where }),
        (tx as any).stockLevel.findMany({
          where,
          orderBy: [{ warehouseId: 'asc' }, { itemId: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            warehouse: { select: { id: true, code: true, name: true } },
            item: { select: { id: true, sku: true, name: true, reorderPoint: true, costingMethod: true } },
          },
        }),
      ]),
    );
    let rows = (data as any[]).map((r) => ({
      ...toJson(r),
      qtyAvailable: Number(availableQty(BigInt(r.qtyOnHand), BigInt(r.qtyReserved))),
    }));
    if (query.lowStockOnly === 'true') {
      rows = rows.filter((r) => BigInt(r.qtyOnHand) <= BigInt(r.item?.reorderPoint ?? 0));
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter(
        (r) => (r.item?.sku ?? '').toLowerCase().includes(s) || (r.item?.name ?? '').toLowerCase().includes(s),
      );
    }
    return { data: rows, meta: pageMeta(query.lowStockOnly === 'true' || query.search ? rows.length : total, { page, pageSize }) };
  }

  async listMovements(tenantId: string, query: MovementListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.itemId) where.itemId = query.itemId;
    if (query.type) where.type = query.type;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.sourceId) where.sourceId = query.sourceId;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).stockMovement.count({ where }),
        (tx as any).stockMovement.findMany({
          where,
          orderBy: { movementDate: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            item: { select: { id: true, sku: true, name: true } },
            warehouse: { select: { id: true, code: true, name: true } },
            destinationWarehouse: { select: { id: true, code: true, name: true } },
          },
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  /** Items at/below their reorder point, per warehouse. */
  async lowStock(tenantId: string, warehouseId?: string) {
    const levels: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockLevel.findMany({
        where: { tenantId, ...(warehouseId ? { warehouseId } : {}) },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          item: { select: { id: true, sku: true, name: true, reorderPoint: true } },
        },
        orderBy: { qtyOnHand: 'asc' },
      }),
    );
    const rows = levels
      .filter((l) => BigInt(l.qtyOnHand) <= BigInt(l.item.reorderPoint))
      .map((l) => ({
        ...toJson(l),
        qtyAvailable: Number(availableQty(BigInt(l.qtyOnHand), BigInt(l.qtyReserved))),
      }));
    return { data: rows, meta: { total: rows.length } };
  }

  // --- Engine (transactional, called by other services with their tx) ------

  async defaultWarehouse(tx: PrismaTx, tenantId: string): Promise<any> {
    const wh = await this.defaultWarehouseOrNull(tx, tenantId);
    if (!wh) throw new BadRequestException('No warehouse exists for this tenant — create one first');
    return wh;
  }

  async defaultWarehouseOrNull(tx: PrismaTx, tenantId: string): Promise<any | null> {
    return (
      (await (tx as any).warehouse.findFirst({ where: { tenantId, isDefault: true } })) ??
      (await (tx as any).warehouse.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } }))
    );
  }

  async getItem(tx: PrismaTx, tenantId: string, itemId: string): Promise<any> {
    const item = await (tx as any).item.findUnique({ where: { id: itemId } });
    if (!item || item.tenantId !== tenantId) throw new NotFoundException(`Item not found: ${itemId}`);
    return item;
  }

  async getLevel(tx: PrismaTx, tenantId: string, warehouseId: string, itemId: string): Promise<any | null> {
    return (tx as any).stockLevel.findUnique({
      where: { warehouseId_itemId_tenantId: { warehouseId, itemId, tenantId } },
    });
  }

  async ensureLevel(tx: PrismaTx, tenantId: string, warehouseId: string, itemId: string, actorId: string, currency = 'SAR'): Promise<any> {
    const existing = await this.getLevel(tx, tenantId, warehouseId, itemId);
    if (existing) return existing;
    return (tx as any).stockLevel.create({
      data: { tenantId, warehouseId, itemId, qtyOnHand: 0n, qtyReserved: 0n, averageCostMinor: 0n, lastCostMinor: 0n, currency, createdBy: actorId },
    });
  }

  async recordMovement(
    tx: PrismaTx,
    tenantId: string,
    actorId: string,
    input: {
      type: string;
      itemId: string;
      warehouseId: string;
      destinationWarehouseId?: string | null;
      quantity: bigint;
      unitCostMinor: bigint;
      totalCostMinor: bigint;
      currency?: string;
      sourceType: string;
      sourceId?: string | null;
      reference?: string | null;
      movementDate: Date;
      journalEntryId?: string | null;
    },
  ): Promise<any> {
    return (tx as any).stockMovement.create({
      data: {
        tenantId,
        type: input.type,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        destinationWarehouseId: input.destinationWarehouseId ?? null,
        quantity: input.quantity,
        unitCostMinor: input.unitCostMinor,
        totalCostMinor: input.totalCostMinor,
        currency: input.currency ?? 'SAR',
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        reference: input.reference ?? null,
        movementDate: input.movementDate,
        journalEntryId: input.journalEntryId ?? null,
        createdBy: actorId,
      },
    });
  }

  /**
   * Receive stock: +onHand, new FIFO layer, weighted-average recompute,
   * last cost update, IN movement. Returns the receipt's total cost.
   */
  async receipt(tx: PrismaTx, tenantId: string, actorId: string, input: ReceiptInput): Promise<{ totalCostMinor: bigint; unitCostMinor: bigint }> {
    const qty = BigInt(input.quantity);
    const unitCost = BigInt(input.unitCostMinor);
    if (qty <= 0n) throw new BadRequestException('Receipt quantity must be positive');
    const item = await this.getItem(tx, tenantId, input.itemId);
    if (!item.trackStock) return { totalCostMinor: 0n, unitCostMinor: 0n };
    const level = await this.ensureLevel(tx, tenantId, input.warehouseId, input.itemId, actorId, input.currency);
    const totalCost = qty * unitCost;
    await (tx as any).stockCostLayer.create({
      data: {
        tenantId,
        warehouseId: input.warehouseId,
        itemId: input.itemId,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        quantityRemaining: qty,
        unitCostMinor: unitCost,
        currency: input.currency ?? 'SAR',
        receivedAt: input.movementDate,
        createdBy: actorId,
      },
    });
    const newAvg = weightedAverageCost(BigInt(level.qtyOnHand), BigInt(level.averageCostMinor), qty, unitCost);
    await (tx as any).stockLevel.update({
      where: { id: level.id },
      data: { qtyOnHand: BigInt(level.qtyOnHand) + qty, averageCostMinor: newAvg, lastCostMinor: unitCost },
    });
    await this.recordMovement(tx, tenantId, actorId, {
      type: input.movementType ?? 'IN',
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      quantity: qty,
      unitCostMinor: unitCost,
      totalCostMinor: totalCost,
      currency: input.currency,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reference: input.reference,
      movementDate: input.movementDate,
    });
    return { totalCostMinor: totalCost, unitCostMinor: unitCost };
  }

  /**
   * Issue stock: -onHand, FIFO layer consumption (or average/standard cost),
   * OUT movement. Throws 400 when on-hand is insufficient. Returns the
   * issue's total (valuation) cost and the effective unit cost.
   */
  async issue(tx: PrismaTx, tenantId: string, actorId: string, input: IssueInput): Promise<{ totalCostMinor: bigint; unitCostMinor: bigint }> {
    const qty = BigInt(input.quantity);
    if (qty <= 0n) throw new BadRequestException('Issue quantity must be positive');
    const item = await this.getItem(tx, tenantId, input.itemId);
    if (!item.trackStock) return { totalCostMinor: 0n, unitCostMinor: 0n };
    const level = await this.ensureLevel(tx, tenantId, input.warehouseId, input.itemId, actorId, input.currency);
    if (BigInt(level.qtyOnHand) < qty) {
      throw new BadRequestException(
        `Insufficient stock for ${item.sku} in this warehouse: on hand ${level.qtyOnHand}, requested ${qty}`,
      );
    }
    let totalCost = 0n;
    let unitCost = 0n;
    if (input.unitCostOverrideMinor !== undefined && input.unitCostOverrideMinor !== null) {
      unitCost = BigInt(input.unitCostOverrideMinor);
      totalCost = qty * unitCost;
    } else if (item.costingMethod === 'FIFO') {
      const layers: any[] = await (tx as any).stockCostLayer.findMany({
        where: { tenantId, warehouseId: input.warehouseId, itemId: input.itemId, quantityRemaining: { gt: 0 } },
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      });
      const layerQty = layers.reduce((s: bigint, l: any) => s + BigInt(l.quantityRemaining), 0n);
      if (layerQty >= qty) {
        const consumed = consumeFifo(
          layers.map((l: any) => ({ id: l.id, quantityRemaining: l.quantityRemaining, unitCostMinor: l.unitCostMinor })),
          qty,
        );
        totalCost = consumed.totalCostMinor;
        unitCost = qty > 0n ? totalCost / qty : 0n;
        for (const r of consumed.remaining) {
          await (tx as any).stockCostLayer.update({ where: { id: r.id }, data: { quantityRemaining: r.quantityRemaining } });
        }
      } else {
        // Layers cover only part of the stock (e.g. opening stock with no
        // layers): consume what exists, value the rest at the average cost.
        const consumed = consumeFifo(
          layers.map((l: any) => ({ id: l.id, quantityRemaining: l.quantityRemaining, unitCostMinor: l.unitCostMinor })),
          layerQty,
        );
        const rest = qty - layerQty;
        const restUnit = BigInt(level.averageCostMinor) > 0n ? BigInt(level.averageCostMinor) : BigInt(level.lastCostMinor);
        totalCost = consumed.totalCostMinor + rest * restUnit;
        unitCost = qty > 0n ? totalCost / qty : 0n;
        for (const r of consumed.remaining) {
          await (tx as any).stockCostLayer.update({ where: { id: r.id }, data: { quantityRemaining: r.quantityRemaining } });
        }
      }
    } else if (item.costingMethod === 'WEIGHTED_AVERAGE') {
      unitCost = BigInt(level.averageCostMinor) > 0n ? BigInt(level.averageCostMinor) : BigInt(level.lastCostMinor);
      totalCost = qty * unitCost;
    } else {
      // STANDARD
      unitCost = BigInt(item.standardCostMinor);
      totalCost = qty * unitCost;
    }
    await (tx as any).stockLevel.update({
      where: { id: level.id },
      data: { qtyOnHand: BigInt(level.qtyOnHand) - qty },
    });
    // Phase 11 — emit `stock.low` once per crossing: on-hand was above the
    // reorder point before this issue and is at/below it now. Webhook
    // endpoints subscribed to `stock.low` get the event via the outbox drain.
    const reorderPoint = BigInt(item.reorderPoint ?? 0);
    const afterQty = BigInt(level.qtyOnHand) - qty;
    if (reorderPoint > 0n && BigInt(level.qtyOnHand) > reorderPoint && afterQty <= reorderPoint) {
      await this.outbox.publish(tx as any, {
        tenantId, eventType: 'stock.low', aggregateId: input.itemId,
        payload: { itemId: input.itemId, sku: item.sku, warehouseId: input.warehouseId, qtyOnHand: Number(afterQty), reorderPoint: Number(reorderPoint) },
        createdBy: actorId,
      });
    }
    await this.recordMovement(tx, tenantId, actorId, {
      type: input.movementType ?? 'OUT',
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      quantity: qty,
      unitCostMinor: unitCost,
      totalCostMinor: totalCost,
      currency: input.currency,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reference: input.reference,
      movementDate: input.movementDate,
    });
    return { totalCostMinor: totalCost, unitCostMinor: unitCost };
  }

  // --- Reservations (sales orders) ------------------------------------------

  /**
   * Reserve the unfulfilled quantities of a CONFIRMED order against the
   * tenant's default warehouse. Reservations are aggregate (no per-order
   * rows): delivery and cancellation release them again. Orders have no
   * warehouse of their own in Phase 5 — the default warehouse is used.
   * A tenant with no warehouse yet simply gets no reservation (confirm
   * must keep working for sales-only tenants).
   */
  async reserveForOrder(tx: PrismaTx, tenantId: string, actorId: string, orderId: string): Promise<void> {
    const order: any = await (tx as any).salesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    const warehouse = await this.defaultWarehouseOrNull(tx, tenantId);
    if (!warehouse) return;
    for (const line of order.lines) {
      const item = await this.getItem(tx, tenantId, line.itemId);
      if (!item.trackStock) continue;
      const remaining = BigInt(line.quantityOrdered) - BigInt(line.quantityFulfilled);
      if (remaining <= 0n) continue;
      const level = await this.ensureLevel(tx, tenantId, warehouse.id, line.itemId, actorId, order.currency);
      await (tx as any).stockLevel.update({
        where: { id: level.id },
        data: { qtyReserved: BigInt(level.qtyReserved) + remaining },
      });
    }
  }

  /** Release the still-unfulfilled reservation of an order (cancellation). */
  async releaseForOrder(tx: PrismaTx, tenantId: string, actorId: string, orderId: string): Promise<void> {
    const order: any = await (tx as any).salesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!order || order.tenantId !== tenantId) throw new NotFoundException('Sales order not found');
    const warehouse = await this.defaultWarehouseOrNull(tx, tenantId);
    if (!warehouse) return;
    for (const line of order.lines) {
      const item = await this.getItem(tx, tenantId, line.itemId);
      if (!item.trackStock) continue;
      const remaining = BigInt(line.quantityOrdered) - BigInt(line.quantityFulfilled);
      if (remaining <= 0n) continue;
      const level = await this.getLevel(tx, tenantId, warehouse.id, line.itemId);
      if (!level) continue;
      const release = remaining < BigInt(level.qtyReserved) ? remaining : BigInt(level.qtyReserved);
      await (tx as any).stockLevel.update({
        where: { id: level.id },
        data: { qtyReserved: BigInt(level.qtyReserved) - release },
      });
    }
  }

  /** Release a delivered quantity from the reservation at a warehouse. */
  async releaseQty(tx: PrismaTx, tenantId: string, warehouseId: string, itemId: string, quantity: bigint): Promise<void> {
    const level = await this.getLevel(tx, tenantId, warehouseId, itemId);
    if (!level || BigInt(level.qtyReserved) <= 0n) return;
    const release = quantity < BigInt(level.qtyReserved) ? quantity : BigInt(level.qtyReserved);
    await (tx as any).stockLevel.update({
      where: { id: level.id },
      data: { qtyReserved: BigInt(level.qtyReserved) - release },
    });
  }

  /** Audit + outbox helper for document services. */
  async logAndPublish(
    tx: PrismaTx,
    tenantId: string,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    eventType: string,
    payload: Record<string, unknown>,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    await this.audit.log(
      { tenantId, actorId, action, entityType, entityId, before: before ? toJson(before) : undefined, after: after ? toJson(after) : undefined },
      tx as any,
    );
    await this.outbox.publish(tx as any, { tenantId, eventType, aggregateId: entityId, payload, createdBy: actorId });
  }
}
