import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StockCountDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, ensureSeries, findAccountByCode } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from './stock.service';

export interface StockCountListQuery {
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
 * Stock counts (Phase 5): cycle counts. Lines snapshot the system quantity
 * at creation; approval applies each variance as an adjustment movement
 * (source COUNT) and posts the net value like an adjustment
 * (Dr 5240 / Cr 1210 for a net shortage, Dr 1210 / Cr 4110 for a net surplus).
 */
@Injectable()
export class CountsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: StockCountListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).stockCount.count({ where }),
        (tx as any).stockCount.findMany({ where, orderBy: { countDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockCount.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Stock count not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: StockCountDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      const lineData: any[] = [];
      for (const [i, line] of dto.lines.entries()) {
        await this.stock.getItem(tx as any, tenantId, line.itemId);
        const level = await this.stock.getLevel(tx as any, tenantId, dto.warehouseId, line.itemId);
        const systemQty = level ? BigInt(level.qtyOnHand) : 0n;
        const counted = BigInt(line.countedQuantity);
        lineData.push({
          tenantId, itemId: line.itemId, systemQuantity: systemQty, countedQuantity: counted,
          varianceQuantity: counted - systemQty, unitCostMinor: 0n, lineOrder: i, createdBy: actorId,
        });
      }
      await ensureSeries(tx as any, tenantId, actorId, 'CNT');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'CNT');
      const created = await (tx as any).stockCount.create({
        data: {
          tenantId, number, warehouseId: dto.warehouseId, status: 'DRAFT',
          countDate: new Date(dto.countDate), currency: 'SAR', notes: dto.notes ?? null,
          createdBy: actorId, lines: { create: lineData },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:StockCount', 'StockCount', created.id, 'stock-count.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  /** Approve a DRAFT count: apply variances and post the net value. */
  async approve(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockCount.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock count not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT counts can be approved — this count is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let netValue = 0n;
      for (const line of before.lines) {
        const variance = BigInt(line.varianceQuantity);
        if (variance === 0n) continue;
        const item = await this.stock.getItem(tx as any, tenantId, line.itemId);
        let unitCost = 0n;
        let lineValue = 0n;
        if (variance > 0n) {
          unitCost = BigInt(item.purchasePriceMinor);
          const r = await this.stock.receipt(tx as any, tenantId, actorId, {
            warehouseId: before.warehouseId,
            itemId: line.itemId,
            quantity: variance,
            unitCostMinor: unitCost,
            sourceType: 'COUNT',
            sourceId: line.id,
            reference: before.number,
            movementDate: new Date(before.countDate),
            currency: before.currency,
            movementType: 'ADJUSTMENT',
          });
          lineValue = r.totalCostMinor;
        } else {
          const issued = await this.stock.issue(tx as any, tenantId, actorId, {
            warehouseId: before.warehouseId,
            itemId: line.itemId,
            quantity: -variance,
            sourceType: 'COUNT',
            sourceId: line.id,
            reference: before.number,
            movementDate: new Date(before.countDate),
            currency: before.currency,
            movementType: 'ADJUSTMENT',
          });
          unitCost = issued.unitCostMinor;
          lineValue = -issued.totalCostMinor;
        }
        netValue += lineValue;
        await (tx as any).stockCountLine.update({
          where: { id: line.id },
          data: { unitCostMinor: unitCost },
        });
      }
      let journalEntryId: string | null = null;
      if (netValue !== 0n) {
        const inventory = await findAccountByCode(tx as any, tenantId, COA.INVENTORY);
        const amount = netValue > 0n ? netValue : -netValue;
        const lines =
          netValue > 0n
            ? [
                { accountId: inventory.id, debitMinor: amount, creditMinor: 0n, description: `Stock count ${before.number}` },
                { accountId: (await findAccountByCode(tx as any, tenantId, COA.INV_ADJ_GAIN)).id, debitMinor: 0n, creditMinor: amount, description: `Stock count ${before.number}` },
              ]
            : [
                { accountId: (await findAccountByCode(tx as any, tenantId, COA.INV_ADJ_EXPENSE)).id, debitMinor: amount, creditMinor: 0n, description: `Stock count ${before.number}` },
                { accountId: inventory.id, debitMinor: 0n, creditMinor: amount, description: `Stock count ${before.number}` },
              ];
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.countDate,
          description: `Stock count ${before.number}`,
          reference: before.number,
          sourceModule: 'INVENTORY',
          currency: before.currency,
          status: 'POSTED',
          lines,
        });
        journalEntryId = entry.id;
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'COUNT', sourceId: { in: before.lines.map((l: any) => l.id) } },
          data: { journalEntryId },
        });
      }
      const updated = await (tx as any).stockCount.update({
        where: { id },
        data: { status: 'APPROVED', journalEntryId },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'approve:StockCount', 'StockCount', id, 'stock-count.approved', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).stockCount.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock count not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT counts can be cancelled — this count is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).stockCount.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:StockCount', 'StockCount', id, 'stock-count.cancelled', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).stockCount.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock count not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT counts can be deleted — this count is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).stockCount.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:StockCount', 'StockCount', id, 'stock-count.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
