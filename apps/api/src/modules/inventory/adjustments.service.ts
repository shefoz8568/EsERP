import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StockAdjustmentDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, ensureSeries, findAccountByCode } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from './stock.service';

export interface StockAdjustmentListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  warehouseId?: string;
}

const INCLUDE = {
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: { item: { select: { id: true, sku: true, name: true } } },
  },
};

/**
 * Stock adjustments (Phase 5): signed quantity deltas with a reason.
 * Posting on POSTED (net of all lines):
 * - net stock increase: Dr Inventory 1210 / Cr Adjustment Gains 4110
 * - net stock decrease: Dr Adjustment Expense 5240 / Cr Inventory 1210
 * Positive deltas create a FIFO layer at the given (or purchase) cost;
 * negative deltas issue at valuation cost.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: StockAdjustmentListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).stockAdjustment.count({ where }),
        (tx as any).stockAdjustment.findMany({ where, orderBy: { adjustmentDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockAdjustment.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Stock adjustment not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: StockAdjustmentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      for (const line of dto.lines) {
        await this.stock.getItem(tx as any, tenantId, line.itemId);
      }
      await ensureSeries(tx as any, tenantId, actorId, 'ADJ');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'ADJ');
      const created = await (tx as any).stockAdjustment.create({
        data: {
          tenantId, number, warehouseId: dto.warehouseId, status: 'DRAFT',
          adjustmentDate: new Date(dto.adjustmentDate), currency: dto.currency,
          notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: dto.lines.map((l, i) => ({
              tenantId, itemId: l.itemId, quantityDelta: BigInt(l.quantityDelta),
              unitCostMinor: l.unitCostMinor !== undefined ? BigInt(l.unitCostMinor) : 0n,
              lineTotalMinor: 0n, reason: l.reason, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:StockAdjustment', 'StockAdjustment', created.id, 'stock-adjustment.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  /** Post a DRAFT adjustment: apply deltas and post the net value. */
  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockAdjustment.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock adjustment not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT adjustments can be posted — this adjustment is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let netValue = 0n;
      for (const line of before.lines) {
        const delta = BigInt(line.quantityDelta);
        const item = await this.stock.getItem(tx as any, tenantId, line.itemId);
        let unitCost = 0n;
        let lineValue = 0n;
        if (delta > 0n) {
          unitCost = BigInt(line.unitCostMinor) > 0n ? BigInt(line.unitCostMinor) : BigInt(item.purchasePriceMinor);
          const r = await this.stock.receipt(tx as any, tenantId, actorId, {
            warehouseId: before.warehouseId,
            itemId: line.itemId,
            quantity: delta,
            unitCostMinor: unitCost,
            sourceType: 'ADJUSTMENT',
            sourceId: line.id,
            reference: before.number,
            movementDate: new Date(before.adjustmentDate),
            currency: before.currency,
            movementType: 'ADJUSTMENT',
          });
          lineValue = r.totalCostMinor;
        } else {
          const issued = await this.stock.issue(tx as any, tenantId, actorId, {
            warehouseId: before.warehouseId,
            itemId: line.itemId,
            quantity: -delta,
            sourceType: 'ADJUSTMENT',
            sourceId: line.id,
            reference: before.number,
            movementDate: new Date(before.adjustmentDate),
            currency: before.currency,
            unitCostOverrideMinor: BigInt(line.unitCostMinor) > 0n ? BigInt(line.unitCostMinor) : null,
            movementType: 'ADJUSTMENT',
          });
          unitCost = issued.unitCostMinor;
          lineValue = -issued.totalCostMinor;
          // Preserve the adjustment direction on the ledger row: the
          // stock engine records every movement with a positive
          // quantity, so a −2 removal and a +2 addition would otherwise
          // produce byte-identical rows (type ADJUSTMENT, quantity 2).
          // Negate this line's movement quantity so removals show as
          // negative in Stock Movements. Stock levels and the journal
          // above are untouched (they already apply the sign).
          const movement = await (tx as any).stockMovement.findFirst({
            where: { tenantId, sourceType: 'ADJUSTMENT', sourceId: line.id },
          });
          if (movement) {
            await (tx as any).stockMovement.update({
              where: { id: movement.id },
              data: { quantity: -BigInt(movement.quantity) },
            });
          }
        }
        netValue += lineValue;
        await (tx as any).stockAdjustmentLine.update({
          where: { id: line.id },
          data: { unitCostMinor: unitCost, lineTotalMinor: lineValue },
        });
      }
      let journalEntryId: string | null = null;
      if (netValue !== 0n) {
        const inventory = await findAccountByCode(tx as any, tenantId, COA.INVENTORY);
        const amount = netValue > 0n ? netValue : -netValue;
        const lines =
          netValue > 0n
            ? [
                { accountId: inventory.id, debitMinor: amount, creditMinor: 0n, description: `Stock adjustment ${before.number}` },
                { accountId: (await findAccountByCode(tx as any, tenantId, COA.INV_ADJ_GAIN)).id, debitMinor: 0n, creditMinor: amount, description: `Stock adjustment ${before.number}` },
              ]
            : [
                { accountId: (await findAccountByCode(tx as any, tenantId, COA.INV_ADJ_EXPENSE)).id, debitMinor: amount, creditMinor: 0n, description: `Stock adjustment ${before.number}` },
                { accountId: inventory.id, debitMinor: 0n, creditMinor: amount, description: `Stock adjustment ${before.number}` },
              ];
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.adjustmentDate,
          description: `Stock adjustment ${before.number}`,
          reference: before.number,
          sourceModule: 'INVENTORY',
          currency: before.currency,
          status: 'POSTED',
          lines,
        });
        journalEntryId = entry.id;
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'ADJUSTMENT', sourceId: { in: before.lines.map((l: any) => l.id) } },
          data: { journalEntryId },
        });
      }
      const updated = await (tx as any).stockAdjustment.update({
        where: { id },
        data: { status: 'POSTED', totalValueMinor: netValue, journalEntryId },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:StockAdjustment', 'StockAdjustment', id, 'stock-adjustment.posted', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).stockAdjustment.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock adjustment not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT adjustments can be cancelled — this adjustment is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).stockAdjustment.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:StockAdjustment', 'StockAdjustment', id, 'stock-adjustment.cancelled', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).stockAdjustment.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock adjustment not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT adjustments can be deleted — this adjustment is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).stockAdjustment.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:StockAdjustment', 'StockAdjustment', id, 'stock-adjustment.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
