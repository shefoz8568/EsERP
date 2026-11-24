import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MaterialIssueDto, ProductionReceiptDto, ScrapDto } from '@eserp/shared';
import { completionPct, wipBalance } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, ensureSeries, findAccountByCode } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from '../inventory/stock.service';

export interface DocListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  workOrderId?: string;
  warehouseId?: string;
}

const ISSUE_INCLUDE = {
  workOrder: { select: { id: true, number: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: { item: { select: { id: true, sku: true, name: true } } },
  },
};
const RECEIPT_INCLUDE = {
  workOrder: { select: { id: true, number: true } },
  warehouse: { select: { id: true, code: true, name: true } },
};
const SCRAP_INCLUDE = {
  workOrder: { select: { id: true, number: true } },
  item: { select: { id: true, sku: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
};

/**
 * Production documents (Phase 7): material issues, production receipts and
 * scrap. All three are created DRAFT and post stock + ledger effects on
 * POST. Postings go through postBalanced() with sourceModule MANUFACTURING:
 * - issue:   Dr 1220 WIP / Cr 1210 Inventory (valuation cost)
 * - receipt: Dr 1230 Finished Goods / Cr 1220 WIP (computed unit cost)
 * - scrap:   Dr 5260 Scrap Loss / Cr 1220 WIP (finished) or Cr 1210 (components)
 */
@Injectable()
export class ProductionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  // --- Material issues ------------------------------------------------------

  async listIssues(tenantId: string, query: DocListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.workOrderId) where.workOrderId = query.workOrderId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).materialIssue.count({ where }),
        (tx as any).materialIssue.findMany({ where, orderBy: { issueDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: ISSUE_INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getIssue(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).materialIssue.findUnique({ where: { id }, include: ISSUE_INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Material issue not found');
    return toJson(row);
  }

  async createIssue(tenantId: string, actorId: string, dto: MaterialIssueDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wo: any = await (tx as any).workOrder.findUnique({ where: { id: dto.workOrderId }, include: { lines: true } });
      if (!wo || wo.tenantId !== tenantId) throw new NotFoundException('Work order not found');
      if (wo.status !== 'RELEASED' && wo.status !== 'IN_PROGRESS') {
        throw new BadRequestException(`Cannot issue material to a ${wo.status} work order`);
      }
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      for (const line of dto.lines) {
        const woLine = wo.lines.find((l: any) => l.id === line.workOrderLineId);
        if (!woLine) throw new BadRequestException(`Work order line not found: ${line.workOrderLineId}`);
        if (woLine.componentItemId !== line.itemId) throw new BadRequestException('Issue line item does not match the work order line item');
        if (BigInt(woLine.qtyIssued) + BigInt(line.quantity) > BigInt(woLine.qtyRequired)) {
          throw new BadRequestException(
            `Issue quantity exceeds the required quantity for this line (required ${woLine.qtyRequired}, already issued ${woLine.qtyIssued})`,
          );
        }
      }
      await ensureSeries(tx as any, tenantId, actorId, 'MI');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'MI');
      const created = await (tx as any).materialIssue.create({
        data: {
          tenantId, number, workOrderId: dto.workOrderId, warehouseId: dto.warehouseId,
          status: 'DRAFT', issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
          currency: dto.currency, totalCostMinor: 0n, notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: dto.lines.map((l, i) => ({
              tenantId, workOrderLineId: l.workOrderLineId, itemId: l.itemId,
              quantity: BigInt(l.quantity), unitCostMinor: 0n, lineTotalMinor: 0n, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: ISSUE_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:MaterialIssue', 'MaterialIssue', created.id, 'material-issue.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  async postIssue(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).materialIssue.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Material issue not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT issues can be posted — this issue is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wo: any = await (tx as any).workOrder.findUnique({ where: { id: before.workOrderId } });
      if (!wo) throw new NotFoundException('Work order not found');
      if (wo.status !== 'RELEASED' && wo.status !== 'IN_PROGRESS') {
        throw new BadRequestException(`Cannot issue material to a ${wo.status} work order`);
      }
      let totalCost = 0n;
      for (const line of before.lines) {
        const r = await this.stock.issue(tx as any, tenantId, actorId, {
          warehouseId: before.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          sourceType: 'MATERIAL_ISSUE',
          sourceId: line.id,
          reference: before.number,
          movementDate: new Date(before.issueDate),
          currency: before.currency,
        });
        totalCost += r.totalCostMinor;
        await (tx as any).materialIssueLine.update({
          where: { id: line.id },
          data: { unitCostMinor: r.unitCostMinor, lineTotalMinor: r.totalCostMinor },
        });
        await (tx as any).workOrderLine.update({
          where: { id: line.workOrderLineId },
          data: { qtyIssued: { increment: BigInt(line.quantity) }, unitCostMinor: r.unitCostMinor },
        });
      }
      let journalEntryId: string | null = null;
      if (totalCost > 0n) {
        const wip = await findAccountByCode(tx as any, tenantId, COA.WIP);
        const inventory = await findAccountByCode(tx as any, tenantId, COA.INVENTORY);
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.issueDate,
          description: `Material issue ${before.number} — work order ${wo.number}`,
          reference: before.number,
          sourceModule: 'MANUFACTURING',
          currency: before.currency,
          status: 'POSTED',
          lines: [
            { accountId: wip.id, debitMinor: totalCost, creditMinor: 0n, description: `Material issue ${before.number}` },
            { accountId: inventory.id, debitMinor: 0n, creditMinor: totalCost, description: `Material issue ${before.number}` },
          ],
        });
        journalEntryId = entry.id;
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'MATERIAL_ISSUE', sourceId: { in: before.lines.map((l: any) => l.id) } },
          data: { journalEntryId },
        });
      }
      await (tx as any).workOrder.update({
        where: { id: wo.id },
        data: { materialCostActualMinor: { increment: totalCost }, status: wo.status === 'RELEASED' ? 'IN_PROGRESS' : wo.status },
      });
      const updated = await (tx as any).materialIssue.update({
        where: { id },
        data: { status: 'POSTED', totalCostMinor: totalCost, journalEntryId },
        include: ISSUE_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:MaterialIssue', 'MaterialIssue', id, 'material-issue.posted', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancelIssue(tenantId: string, actorId: string, id: string) {
    return this.cancelDoc(tenantId, actorId, id, 'materialIssue', 'MaterialIssue');
  }

  async deleteIssue(tenantId: string, actorId: string, id: string) {
    return this.deleteDoc(tenantId, actorId, id, 'materialIssue', 'MaterialIssue');
  }

  // --- Production receipts ---------------------------------------------------

  async listReceipts(tenantId: string, query: DocListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.workOrderId) where.workOrderId = query.workOrderId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).productionReceipt.count({ where }),
        (tx as any).productionReceipt.findMany({ where, orderBy: { receiptDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: RECEIPT_INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getReceipt(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).productionReceipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Production receipt not found');
    return toJson(row);
  }

  async createReceipt(tenantId: string, actorId: string, dto: ProductionReceiptDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wo: any = await (tx as any).workOrder.findUnique({ where: { id: dto.workOrderId } });
      if (!wo || wo.tenantId !== tenantId) throw new NotFoundException('Work order not found');
      if (wo.status !== 'RELEASED' && wo.status !== 'IN_PROGRESS') {
        throw new BadRequestException(`Cannot receive production for a ${wo.status} work order`);
      }
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      await ensureSeries(tx as any, tenantId, actorId, 'PR');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'PR');
      const overProduced = BigInt(wo.qtyProduced) + BigInt(dto.quantity) > BigInt(wo.qtyPlanned);
      const created = await (tx as any).productionReceipt.create({
        data: {
          tenantId, number, workOrderId: dto.workOrderId, warehouseId: dto.warehouseId,
          status: 'DRAFT', receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : new Date(),
          quantity: BigInt(dto.quantity), unitCostMinor: 0n, totalCostMinor: 0n,
          overProduced, currency: dto.currency, notes: dto.notes ?? null, createdBy: actorId,
        },
        include: RECEIPT_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:ProductionReceipt', 'ProductionReceipt', created.id, 'production-receipt.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  async postReceipt(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).productionReceipt.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Production receipt not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT receipts can be posted — this receipt is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wo: any = await (tx as any).workOrder.findUnique({ where: { id: before.workOrderId } });
      if (!wo) throw new NotFoundException('Work order not found');
      if (wo.status !== 'RELEASED' && wo.status !== 'IN_PROGRESS') {
        throw new BadRequestException(`Cannot receive production for a ${wo.status} work order`);
      }
      // Unit cost = WIP cost incurred so far / planned qty (actual material
      // cost when anything was issued, else the planned roll-up cost).
      const costBase = BigInt(wo.materialCostActualMinor) > 0n ? BigInt(wo.materialCostActualMinor) : BigInt(wo.materialCostPlannedMinor);
      const unitCost = BigInt(wo.qtyPlanned) > 0n ? costBase / BigInt(wo.qtyPlanned) : 0n;
      const totalCost = BigInt(before.quantity) * unitCost;
      const overProduced = BigInt(wo.qtyProduced) + BigInt(before.quantity) > BigInt(wo.qtyPlanned);
      await this.stock.receipt(tx as any, tenantId, actorId, {
        warehouseId: before.warehouseId,
        itemId: wo.finishedItemId,
        quantity: before.quantity,
        unitCostMinor: unitCost,
        sourceType: 'PRODUCTION_RECEIPT',
        sourceId: before.id,
        reference: before.number,
        movementDate: new Date(before.receiptDate),
        currency: before.currency,
      });
      let journalEntryId: string | null = null;
      if (totalCost > 0n) {
        const finished = await findAccountByCode(tx as any, tenantId, COA.FINISHED_GOODS);
        const wip = await findAccountByCode(tx as any, tenantId, COA.WIP);
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.receiptDate,
          description: `Production receipt ${before.number} — work order ${wo.number}`,
          reference: before.number,
          sourceModule: 'MANUFACTURING',
          currency: before.currency,
          status: 'POSTED',
          lines: [
            { accountId: finished.id, debitMinor: totalCost, creditMinor: 0n, description: `Production receipt ${before.number}` },
            { accountId: wip.id, debitMinor: 0n, creditMinor: totalCost, description: `Production receipt ${before.number}` },
          ],
        });
        journalEntryId = entry.id;
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'PRODUCTION_RECEIPT', sourceId: before.id },
          data: { journalEntryId },
        });
      }
      await (tx as any).workOrder.update({
        where: { id: wo.id },
        data: {
          qtyProduced: { increment: BigInt(before.quantity) },
          unitCostMinor: unitCost,
          status: wo.status === 'RELEASED' ? 'IN_PROGRESS' : wo.status,
        },
      });
      const updated = await (tx as any).productionReceipt.update({
        where: { id },
        data: { status: 'POSTED', unitCostMinor: unitCost, totalCostMinor: totalCost, overProduced, journalEntryId },
        include: RECEIPT_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:ProductionReceipt', 'ProductionReceipt', id, 'production-receipt.posted', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancelReceipt(tenantId: string, actorId: string, id: string) {
    return this.cancelDoc(tenantId, actorId, id, 'productionReceipt', 'ProductionReceipt');
  }

  async deleteReceipt(tenantId: string, actorId: string, id: string) {
    return this.deleteDoc(tenantId, actorId, id, 'productionReceipt', 'ProductionReceipt');
  }

  // --- Scrap -----------------------------------------------------------------

  async listScrap(tenantId: string, query: DocListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.workOrderId) where.workOrderId = query.workOrderId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).scrap.count({ where }),
        (tx as any).scrap.findMany({ where, orderBy: { scrapDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: SCRAP_INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getScrap(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).scrap.findUnique({ where: { id }, include: SCRAP_INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Scrap record not found');
    return toJson(row);
  }

  async createScrap(tenantId: string, actorId: string, dto: ScrapDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      let wo: any = null;
      if (dto.workOrderId) {
        wo = await (tx as any).workOrder.findUnique({ where: { id: dto.workOrderId }, include: { lines: true } });
        if (!wo || wo.tenantId !== tenantId) throw new NotFoundException('Work order not found');
        if (wo.status !== 'RELEASED' && wo.status !== 'IN_PROGRESS') {
          throw new BadRequestException(`Cannot record scrap for a ${wo.status} work order`);
        }
        if (dto.kind === 'FINISHED' && wo.finishedItemId !== dto.itemId) {
          throw new BadRequestException('Finished scrap must use the work order finished item');
        }
        if (dto.kind === 'COMPONENT' && !wo.lines.some((l: any) => l.componentItemId === dto.itemId)) {
          throw new BadRequestException('Component scrap must use a component of the work order');
        }
      } else if (dto.kind === 'FINISHED') {
        throw new BadRequestException('Finished scrap requires a work order');
      }
      const item = await (tx as any).item.findUnique({ where: { id: dto.itemId } });
      if (!item || item.tenantId !== tenantId) throw new NotFoundException('Item not found');
      if (!item.trackStock && dto.kind === 'COMPONENT') throw new BadRequestException('Component scrap requires a stock-tracked item');
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      await ensureSeries(tx as any, tenantId, actorId, 'SCR');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'SCR');
      const created = await (tx as any).scrap.create({
        data: {
          tenantId, number, workOrderId: dto.workOrderId ?? null, kind: dto.kind, itemId: dto.itemId,
          warehouseId: dto.warehouseId, quantity: BigInt(dto.quantity), unitCostMinor: 0n, totalCostMinor: 0n,
          reason: dto.reason, scrapDate: dto.scrapDate ? new Date(dto.scrapDate) : new Date(),
          status: 'DRAFT', currency: dto.currency, createdBy: actorId,
        },
        include: SCRAP_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:Scrap', 'Scrap', created.id, 'scrap.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  async postScrap(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).scrap.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Scrap record not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT scrap can be posted — this record is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const wo: any = before.workOrderId ? await (tx as any).workOrder.findUnique({ where: { id: before.workOrderId } }) : null;
      let unitCost = 0n;
      let totalCost = 0n;
      if (before.kind === 'COMPONENT') {
        // Component scrap leaves warehouse stock: Dr Scrap Loss / Cr Inventory.
        const r = await this.stock.issue(tx as any, tenantId, actorId, {
          warehouseId: before.warehouseId,
          itemId: before.itemId,
          quantity: before.quantity,
          sourceType: 'SCRAP',
          sourceId: before.id,
          reference: before.number,
          movementDate: new Date(before.scrapDate),
          currency: before.currency,
        });
        unitCost = r.unitCostMinor;
        totalCost = r.totalCostMinor;
      } else {
        // Finished scrap never entered stock: Dr Scrap Loss / Cr WIP at the
        // work order's computed unit cost.
        if (!wo) throw new BadRequestException('Finished scrap requires a work order');
        const costBase = BigInt(wo.materialCostActualMinor) > 0n ? BigInt(wo.materialCostActualMinor) : BigInt(wo.materialCostPlannedMinor);
        unitCost = BigInt(wo.qtyPlanned) > 0n ? costBase / BigInt(wo.qtyPlanned) : 0n;
        totalCost = BigInt(before.quantity) * unitCost;
      }
      let journalEntryId: string | null = null;
      if (totalCost > 0n) {
        const scrapLoss = await findAccountByCode(tx as any, tenantId, COA.SCRAP_LOSS);
        const creditCode = before.kind === 'COMPONENT' ? COA.INVENTORY : COA.WIP;
        const credit = await findAccountByCode(tx as any, tenantId, creditCode);
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.scrapDate,
          description: `Scrap ${before.number} (${before.kind.toLowerCase()})${wo ? ` — work order ${wo.number}` : ''}`,
          reference: before.number,
          sourceModule: 'MANUFACTURING',
          currency: before.currency,
          status: 'POSTED',
          lines: [
            { accountId: scrapLoss.id, debitMinor: totalCost, creditMinor: 0n, description: `Scrap ${before.number}` },
            { accountId: credit.id, debitMinor: 0n, creditMinor: totalCost, description: `Scrap ${before.number}` },
          ],
        });
        journalEntryId = entry.id;
        if (before.kind === 'COMPONENT') {
          await (tx as any).stockMovement.updateMany({
            where: { tenantId, sourceType: 'SCRAP', sourceId: before.id },
            data: { journalEntryId },
          });
        }
      }
      if (wo && before.kind === 'FINISHED') {
        await (tx as any).workOrder.update({ where: { id: wo.id }, data: { qtyScrapped: { increment: BigInt(before.quantity) } } });
      }
      const updated = await (tx as any).scrap.update({
        where: { id },
        data: { status: 'POSTED', unitCostMinor: unitCost, totalCostMinor: totalCost, journalEntryId },
        include: SCRAP_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:Scrap', 'Scrap', id, 'scrap.posted', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancelScrap(tenantId: string, actorId: string, id: string) {
    return this.cancelDoc(tenantId, actorId, id, 'scrap', 'Scrap');
  }

  async deleteScrap(tenantId: string, actorId: string, id: string) {
    return this.deleteDoc(tenantId, actorId, id, 'scrap', 'Scrap');
  }

  // --- WIP report ------------------------------------------------------------

  /**
   * WIP per open work order: material issued, production received, finished
   * scrap, WIP balance (Dr WIP − Cr WIP postings, mirrored by the documents)
   * and completion %.
   */
  async wipReport(tenantId: string, warehouseId?: string) {
    const orders: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).workOrder.findMany({
        where: { tenantId, status: { in: ['RELEASED', 'IN_PROGRESS'] }, ...(warehouseId ? { warehouseId } : {}) },
        orderBy: { createdAt: 'desc' },
        include: {
          finishedItem: { select: { id: true, sku: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
      }),
    );
    const rows: any[] = [];
    for (const wo of orders) {
      const totals = await this.prisma.withTenant(tenantId, (tx) => wipTotalsLocal(tx as any, tenantId, wo.id));
      rows.push({
        workOrderId: wo.id,
        number: wo.number,
        finishedItem: toJson(wo.finishedItem),
        warehouse: toJson(wo.warehouse),
        status: wo.status,
        qtyPlanned: Number(wo.qtyPlanned),
        qtyProduced: Number(wo.qtyProduced),
        qtyScrapped: Number(wo.qtyScrapped),
        materialIssuedMinor: Number(totals.issued),
        productionReceivedMinor: Number(totals.received),
        finishedScrapMinor: Number(totals.finishedScrap),
        wipBalanceMinor: Number(wipBalance(totals.issued, totals.received, totals.finishedScrap)),
        completionPct: completionPct(BigInt(wo.qtyProduced), BigInt(wo.qtyPlanned)),
      });
    }
    return { data: rows, meta: { total: rows.length } };
  }

  // --- Shared DRAFT helpers ---------------------------------------------------

  private async cancelDoc(tenantId: string, actorId: string, id: string, delegate: string, entityType: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any)[delegate].findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException(`${entityType} not found`);
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT documents can be cancelled — this one is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any)[delegate].update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, `cancel:${entityType}`, entityType, id, `${entityType.toLowerCase()}.cancelled`, { id }, before, updated);
      return toJson(updated);
    });
  }

  private async deleteDoc(tenantId: string, actorId: string, id: string, delegate: string, entityType: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any)[delegate].findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException(`${entityType} not found`);
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT documents can be deleted — this one is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any)[delegate].delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, `delete:${entityType}`, entityType, id, `${entityType.toLowerCase()}.deleted`, { id }, before);
      return toJson(deleted);
    });
  }
}

async function wipTotalsLocal(tx: any, tenantId: string, workOrderId: string): Promise<{ issued: bigint; received: bigint; finishedScrap: bigint }> {
  const [issues, receipts, scraps] = await Promise.all([
    (tx as any).materialIssue.findMany({ where: { tenantId, workOrderId, status: 'POSTED' }, select: { totalCostMinor: true } }),
    (tx as any).productionReceipt.findMany({ where: { tenantId, workOrderId, status: 'POSTED' }, select: { totalCostMinor: true } }),
    (tx as any).scrap.findMany({ where: { tenantId, workOrderId, status: 'POSTED', kind: 'FINISHED' }, select: { totalCostMinor: true } }),
  ]);
  const sum = (rows: any[]): bigint => rows.reduce((s: bigint, r: any) => s + BigInt(r.totalCostMinor), 0n);
  return { issued: sum(issues), received: sum(receipts), finishedScrap: sum(scraps) };
}
