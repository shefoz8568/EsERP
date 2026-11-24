import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkOrderDto, WorkOrderUpdateDto } from '@eserp/shared';
import { bomStandardCost, completionPct, materialVariance, requiredQty, wipBalance } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { ensureSeries } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from '../inventory/stock.service';

export interface WorkOrderListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  finishedItemId?: string;
  warehouseId?: string;
}

const INCLUDE = {
  finishedItem: { select: { id: true, sku: true, name: true, standardCostMinor: true } },
  bom: { select: { id: true, version: true, status: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: {
      componentItem: { select: { id: true, sku: true, name: true, standardCostMinor: true } },
      workCenter: { select: { id: true, code: true, name: true } },
    },
  },
  operations: {
    orderBy: { createdAt: 'asc' as const },
    include: { workCenter: { select: { id: true, code: true, name: true } } },
  },
};

/** Variance summary shown when a work order completes. */
export function varianceSummary(wo: any): Record<string, unknown> {
  const planned = BigInt(wo.materialCostPlannedMinor ?? 0);
  const actual = BigInt(wo.materialCostActualMinor ?? 0);
  const v = materialVariance(planned, actual);
  return {
    plannedMaterialCostMinor: Number(planned),
    actualMaterialCostMinor: Number(actual),
    varianceMinor: Number(v.varianceMinor),
    variancePct: v.variancePct,
    completionPct: completionPct(BigInt(wo.qtyProduced ?? 0), BigInt(wo.qtyPlanned ?? 0)),
  };
}

async function wipTotals(tx: any, tenantId: string, workOrderId: string): Promise<{ issued: bigint; received: bigint; finishedScrap: bigint }> {
  const [issues, receipts, scraps] = await Promise.all([
    (tx as any).materialIssue.findMany({ where: { tenantId, workOrderId, status: 'POSTED' }, select: { totalCostMinor: true } }),
    (tx as any).productionReceipt.findMany({ where: { tenantId, workOrderId, status: 'POSTED' }, select: { totalCostMinor: true } }),
    (tx as any).scrap.findMany({ where: { tenantId, workOrderId, status: 'POSTED', kind: 'FINISHED' }, select: { totalCostMinor: true } }),
  ]);
  const sum = (rows: any[]): bigint => rows.reduce((s: bigint, r: any) => s + BigInt(r.totalCostMinor), 0n);
  return { issued: sum(issues), received: sum(receipts), finishedScrap: sum(scraps) };
}

/**
 * Work orders (Phase 7). The BOM is snapshotted at RELEASE: the BOM lines
 * are copied to WorkOrderLine (with required quantities incl. scrap), so
 * later BOM edits never rewrite history. Labour hours are recorded on
 * WorkOrderOperation; labour COST posting is deferred to Phase 8 payroll
 * integration — Phase 7 posts material only.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: WorkOrderListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.finishedItemId) where.finishedItemId = query.finishedItemId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).workOrder.count({ where }),
        (tx as any).workOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    const rows = (data as any[]).map((r) => ({ ...toJson(r), completionPct: completionPct(BigInt(r.qtyProduced), BigInt(r.qtyPlanned)) }));
    return { data: rows, meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workOrder.findUnique({ where: { id }, include: INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    const totals = await this.prisma.withTenant(tenantId, (tx) => wipTotals(tx as any, tenantId, id));
    return {
      ...toJson(row),
      completionPct: completionPct(BigInt(row.qtyProduced), BigInt(row.qtyPlanned)),
      materialIssuedMinor: Number(totals.issued),
      productionReceivedMinor: Number(totals.received),
      finishedScrapMinor: Number(totals.finishedScrap),
      wipBalanceMinor: Number(wipBalance(totals.issued, totals.received, totals.finishedScrap)),
      variance: varianceSummary(row),
    };
  }

  async create(tenantId: string, actorId: string, dto: WorkOrderDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const item = await (tx as any).item.findUnique({ where: { id: dto.finishedItemId } });
      if (!item || item.tenantId !== tenantId) throw new NotFoundException('Finished item not found');
      if (!item.trackStock) throw new BadRequestException('The finished item must be a stock-tracked item');
      const bom: any = await (tx as any).bom.findUnique({ where: { id: dto.bomId }, include: { lines: true } });
      if (!bom || bom.tenantId !== tenantId) throw new NotFoundException('BOM not found');
      if (bom.finishedItemId !== dto.finishedItemId) {
        throw new BadRequestException('The BOM belongs to a different finished item');
      }
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      for (const op of dto.operations) {
        if (op.workCenterId) {
          const wc = await (tx as any).workCenter.findUnique({ where: { id: op.workCenterId } });
          if (!wc || wc.tenantId !== tenantId) throw new NotFoundException(`Work centre not found: ${op.workCenterId}`);
        }
      }
      await ensureSeries(tx as any, tenantId, actorId, 'WO');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'WO');
      const created = await (tx as any).workOrder.create({
        data: {
          tenantId, number, finishedItemId: dto.finishedItemId, bomId: dto.bomId, bomVersion: bom.version,
          warehouseId: dto.warehouseId, status: 'DRAFT', qtyPlanned: BigInt(dto.qtyPlanned),
          qtyProduced: 0n, qtyScrapped: 0n,
          plannedStartDate: dto.plannedStartDate ? new Date(dto.plannedStartDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          currency: dto.currency, notes: dto.notes ?? null, createdBy: actorId,
          operations: {
            create: dto.operations.map((o) => ({
              tenantId, name: o.name, workCenterId: o.workCenterId ?? null,
              plannedHours: o.plannedHours, actualHours: 0, status: 'PENDING', createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:WorkOrder', 'WorkOrder', created.id, 'work-order.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: WorkOrderUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    if (before.status !== 'DRAFT') throw new BadRequestException(`Only DRAFT work orders can be edited — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).workOrder.update({
        where: { id },
        data: {
          plannedStartDate: dto.plannedStartDate ? new Date(dto.plannedStartDate) : before.plannedStartDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : before.dueDate,
          notes: dto.notes !== undefined ? dto.notes : before.notes,
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:WorkOrder', 'WorkOrder', id, 'work-order.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  /**
   * Release: snapshot the BOM lines into WorkOrderLine (required quantities
   * incl. scrap) and lock the planned material cost from the roll-up.
   * The BOM must be ACTIVE at release.
   */
  async release(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).workOrder.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT work orders can be released — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const bom: any = await (tx as any).bom.findUnique({ where: { id: before.bomId }, include: { lines: { include: { componentItem: true }, orderBy: { lineOrder: 'asc' } } } });
      if (!bom) throw new NotFoundException('BOM not found');
      if (bom.status !== 'ACTIVE') throw new BadRequestException(`Cannot release against a ${bom.status} BOM — activate it first`);
      const rollup = bomStandardCost(
        bom.lines.map((l: any) => ({ standardCostMinor: BigInt(l.componentItem.standardCostMinor), quantityPerUnit: BigInt(l.quantityPerUnit), scrapBps: l.scrapBps })),
      );
      const updated = await (tx as any).workOrder.update({
        where: { id },
        data: {
          status: 'RELEASED',
          bomVersion: bom.version,
          materialCostPlannedMinor: rollup * BigInt(before.qtyPlanned),
          lines: {
            create: bom.lines.map((l: any, i: number) => ({
              tenantId, componentItemId: l.componentItemId, quantityPerUnit: BigInt(l.quantityPerUnit),
              scrapBps: l.scrapBps, workCenterId: l.workCenterId ?? null, operationName: l.operationName ?? null,
              qtyRequired: requiredQty(BigInt(before.qtyPlanned), BigInt(l.quantityPerUnit), l.scrapBps),
              qtyIssued: 0n, unitCostMinor: 0n, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'release:WorkOrder', 'WorkOrder', id, 'work-order.released', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  /** Record actual hours on an operation (labour hours only; cost posts via payroll in Phase 8). */
  async updateOperation(tenantId: string, actorId: string, workOrderId: string, operationId: string, actualHours: number, status?: string) {
    const wo: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workOrder.findUnique({ where: { id: workOrderId } }));
    if (!wo || wo.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot update operations on a ${wo.status} work order`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const op: any = await (tx as any).workOrderOperation.findUnique({ where: { id: operationId } });
      if (!op || op.tenantId !== tenantId || op.workOrderId !== workOrderId) throw new NotFoundException('Operation not found');
      const updated = await (tx as any).workOrderOperation.update({
        where: { id: operationId },
        data: { actualHours, status: status ?? op.status },
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:WorkOrderOperation', 'WorkOrderOperation', operationId, 'work-order-operation.updated', { id: operationId, workOrderId }, op, updated);
      return toJson(updated);
    });
  }

  /**
   * Complete: locks the order and returns the cost-variance summary
   * (planned vs actual material cost). Any remaining WIP balance stays on
   * the order for review — Phase 7 does not auto-write it off.
   */
  async complete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    if (before.status !== 'RELEASED' && before.status !== 'IN_PROGRESS') {
      throw new ConflictException(`Only RELEASED or IN_PROGRESS work orders can be completed — this order is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).workOrder.update({ where: { id }, data: { status: 'COMPLETED' }, include: INCLUDE });
      const totals = await wipTotals(tx as any, tenantId, id);
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'complete:WorkOrder', 'WorkOrder', id, 'work-order.completed', { id, number: updated.number }, before, updated);
      return {
        ...toJson(updated),
        completionPct: completionPct(BigInt(updated.qtyProduced), BigInt(updated.qtyPlanned)),
        wipBalanceMinor: Number(wipBalance(totals.issued, totals.received, totals.finishedScrap)),
        variance: varianceSummary(updated),
      };
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    if (before.status !== 'DRAFT' && before.status !== 'RELEASED') {
      throw new ConflictException(`Only DRAFT or RELEASED work orders can be cancelled — this order is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const posted = await Promise.all([
        (tx as any).materialIssue.count({ where: { tenantId, workOrderId: id, status: 'POSTED' } }),
        (tx as any).productionReceipt.count({ where: { tenantId, workOrderId: id, status: 'POSTED' } }),
        (tx as any).scrap.count({ where: { tenantId, workOrderId: id, status: 'POSTED' } }),
      ]);
      if (posted.some((n) => n > 0)) {
        throw new ConflictException('Work order already has posted issues, receipts or scrap and cannot be cancelled');
      }
      const updated = await (tx as any).workOrder.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:WorkOrder', 'WorkOrder', id, 'work-order.cancelled', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workOrder.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work order not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT work orders can be deleted — this order is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).workOrder.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:WorkOrder', 'WorkOrder', id, 'work-order.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
