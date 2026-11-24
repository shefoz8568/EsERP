import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StockTransferDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { ensureSeries } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from './stock.service';

export interface StockTransferListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
}

const INCLUDE = {
  fromWarehouse: { select: { id: true, code: true, name: true } },
  toWarehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: { item: { select: { id: true, sku: true, name: true } } },
  },
};

/**
 * Stock transfers (Phase 5): move stock between warehouses. Posting creates
 * two movements (OUT at the source, IN at the destination) at the same
 * valuation cost and one FIFO layer in the destination. No ledger entry —
 * inventory only changes location, not value.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: StockTransferListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.fromWarehouseId) where.fromWarehouseId = query.fromWarehouseId;
    if (query.toWarehouseId) where.toWarehouseId = query.toWarehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).stockTransfer.count({ where }),
        (tx as any).stockTransfer.findMany({ where, orderBy: { transferDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockTransfer.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Stock transfer not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: StockTransferDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Source and destination warehouses must differ');
      for (const id of [dto.fromWarehouseId, dto.toWarehouseId]) {
        const wh = await (tx as any).warehouse.findUnique({ where: { id } });
        if (!wh || wh.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      }
      for (const line of dto.lines) {
        await this.stock.getItem(tx as any, tenantId, line.itemId);
      }
      await ensureSeries(tx as any, tenantId, actorId, 'TRF');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'TRF');
      const created = await (tx as any).stockTransfer.create({
        data: {
          tenantId, number, fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId,
          status: 'DRAFT', transferDate: new Date(dto.transferDate), currency: dto.currency,
          notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: dto.lines.map((l, i) => ({
              tenantId, itemId: l.itemId, quantity: BigInt(l.quantity),
              unitCostMinor: 0n, lineTotalMinor: 0n, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:StockTransfer', 'StockTransfer', created.id, 'stock-transfer.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).stockTransfer.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock transfer not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT transfers can be posted — this transfer is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let totalCost = 0n;
      for (const line of before.lines) {
        const issued = await this.stock.issue(tx as any, tenantId, actorId, {
          warehouseId: before.fromWarehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          sourceType: 'TRANSFER',
          sourceId: line.id,
          reference: before.number,
          movementDate: new Date(before.transferDate),
          currency: before.currency,
          movementType: 'TRANSFER',
        });
        // Destination receives the same units at the same unit cost.
        const received = await this.stock.receipt(tx as any, tenantId, actorId, {
          warehouseId: before.toWarehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          unitCostMinor: issued.unitCostMinor,
          sourceType: 'TRANSFER',
          sourceId: line.id,
          reference: before.number,
          movementDate: new Date(before.transferDate),
          currency: before.currency,
          movementType: 'TRANSFER',
        });
        totalCost += received.totalCostMinor;
        // Mark the OUT movement with its destination warehouse.
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'TRANSFER', sourceId: line.id, warehouseId: before.fromWarehouseId },
          data: { destinationWarehouseId: before.toWarehouseId },
        });
        await (tx as any).stockTransferLine.update({
          where: { id: line.id },
          data: { unitCostMinor: issued.unitCostMinor, lineTotalMinor: issued.totalCostMinor },
        });
      }
      const updated = await (tx as any).stockTransfer.update({
        where: { id },
        data: { status: 'POSTED', totalCostMinor: totalCost },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:StockTransfer', 'StockTransfer', id, 'stock-transfer.posted', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).stockTransfer.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock transfer not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT transfers can be cancelled — this transfer is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).stockTransfer.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:StockTransfer', 'StockTransfer', id, 'stock-transfer.cancelled', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).stockTransfer.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Stock transfer not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT transfers can be deleted — this transfer is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).stockTransfer.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:StockTransfer', 'StockTransfer', id, 'stock-transfer.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
