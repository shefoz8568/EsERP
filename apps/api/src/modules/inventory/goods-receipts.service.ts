import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { GoodsReceiptDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, ensureSeries, findAccountByCode } from '../sales/common';
import { StockService } from './stock.service';

export interface GoodsReceiptListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  purchaseOrderId?: string;
  warehouseId?: string;
}

const INCLUDE = {
  purchaseOrder: { select: { id: true, number: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: { item: { select: { id: true, sku: true, name: true } }, purchaseOrderLine: { select: { id: true, quantityOrdered: true, quantityReceived: true } } },
  },
};

/**
 * Goods receipts (Phase 5): receiving PO lines into a warehouse.
 * Posting on POSTED: Dr Inventory 1210 / Cr GRNI 2020 at net receipt cost.
 * Updates PurchaseOrderLine.quantityReceived and the PO status
 * (PARTIALLY_RECEIVED -> RECEIVED).
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
  ) {}

  async list(tenantId: string, query: GoodsReceiptListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).goodsReceipt.count({ where }),
        (tx as any).goodsReceipt.findMany({ where, orderBy: { receiptDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).goodsReceipt.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Goods receipt not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: GoodsReceiptDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const po: any = await (tx as any).purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, include: { lines: true } });
      if (!po || po.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
      if (po.status === 'CANCELLED' || po.status === 'CLOSED') {
        throw new BadRequestException(`Cannot receive against a ${po.status} purchase order`);
      }
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      let subtotal = 0n;
      for (const line of dto.lines) {
        const poLine = po.lines.find((l: any) => l.id === line.purchaseOrderLineId);
        if (!poLine) throw new BadRequestException(`Purchase order line not found: ${line.purchaseOrderLineId}`);
        if (poLine.itemId !== line.itemId) throw new BadRequestException('Receipt line item does not match the purchase order line item');
        subtotal += BigInt(line.quantity) * BigInt(line.unitCostMinor);
      }
      await ensureSeries(tx as any, tenantId, actorId, 'GRN');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'GRN');
      const created = await (tx as any).goodsReceipt.create({
        data: {
          tenantId, number, purchaseOrderId: dto.purchaseOrderId, warehouseId: dto.warehouseId,
          status: 'DRAFT', receiptDate: new Date(dto.receiptDate), currency: dto.currency,
          subtotalMinor: subtotal, totalCostMinor: subtotal, notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: dto.lines.map((l, i) => ({
              tenantId, purchaseOrderLineId: l.purchaseOrderLineId, itemId: l.itemId,
              quantityReceived: BigInt(l.quantity), unitCostMinor: BigInt(l.unitCostMinor),
              lineTotalMinor: BigInt(l.quantity) * BigInt(l.unitCostMinor), lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:GoodsReceipt', 'GoodsReceipt', created.id, 'goods-receipt.created', { id: created.id, number }, undefined, created);
      return toJson(created);
    });
  }

  /** Post a DRAFT receipt: stock in, PO quantities, Dr Inventory / Cr GRNI. */
  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).goodsReceipt.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Goods receipt not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT receipts can be posted — this receipt is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const po: any = await (tx as any).purchaseOrder.findUnique({ where: { id: before.purchaseOrderId }, include: { lines: true } });
      if (!po) throw new NotFoundException('Purchase order not found');
      // Receiving must not exceed the PO ordered quantity (net of receipts).
      for (const line of before.lines) {
        const poLine = po.lines.find((l: any) => l.id === line.purchaseOrderLineId);
        if (!poLine) throw new BadRequestException(`Purchase order line not found: ${line.purchaseOrderLineId}`);
        if (BigInt(poLine.quantityReceived) + BigInt(line.quantityReceived) > BigInt(poLine.quantityOrdered)) {
          throw new BadRequestException(
            `Receipt quantity ${BigInt(poLine.quantityReceived) + BigInt(line.quantityReceived)} exceeds the purchase order quantity ${poLine.quantityOrdered}`,
          );
        }
      }
      let totalCost = 0n;
      for (const line of before.lines) {
        const r = await this.stock.receipt(tx as any, tenantId, actorId, {
          warehouseId: before.warehouseId,
          itemId: line.itemId,
          quantity: line.quantityReceived,
          unitCostMinor: line.unitCostMinor,
          sourceType: 'GOODS_RECEIPT',
          sourceId: line.id,
          reference: before.number,
          movementDate: new Date(before.receiptDate),
          currency: before.currency,
        });
        totalCost += r.totalCostMinor;
        await (tx as any).purchaseOrderLine.update({
          where: { id: line.purchaseOrderLineId },
          data: { quantityReceived: { increment: BigInt(line.quantityReceived) } },
        });
      }
      // PO status from received quantities.
      const freshPo: any = await (tx as any).purchaseOrder.findUnique({ where: { id: po.id }, include: { lines: true } });
      const allReceived = freshPo.lines.every((l: any) => BigInt(l.quantityReceived) >= BigInt(l.quantityOrdered));
      const anyReceived = freshPo.lines.some((l: any) => BigInt(l.quantityReceived) > 0n);
      const poStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status;
      if (poStatus !== po.status) {
        await (tx as any).purchaseOrder.update({ where: { id: po.id }, data: { status: poStatus } });
      }
      let journalEntryId: string | null = null;
      if (totalCost > 0n) {
        const inventory = await findAccountByCode(tx as any, tenantId, COA.INVENTORY);
        const grni = await findAccountByCode(tx as any, tenantId, COA.GRNI);
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: before.receiptDate,
          description: `Goods receipt ${before.number}`,
          reference: before.number,
          sourceModule: 'INVENTORY',
          currency: before.currency,
          status: 'POSTED',
          lines: [
            { accountId: inventory.id, debitMinor: totalCost, creditMinor: 0n, description: `Goods receipt ${before.number}` },
            { accountId: grni.id, debitMinor: 0n, creditMinor: totalCost, description: `Goods receipt ${before.number}` },
          ],
        });
        journalEntryId = entry.id;
        // Link the GRNI entry to the movements for traceability.
        await (tx as any).stockMovement.updateMany({
          where: { tenantId, sourceType: 'GOODS_RECEIPT', sourceId: { in: before.lines.map((l: any) => l.id) } },
          data: { journalEntryId },
        });
      }
      const updated = await (tx as any).goodsReceipt.update({
        where: { id },
        data: { status: 'POSTED', totalCostMinor: totalCost, journalEntryId },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'post:GoodsReceipt', 'GoodsReceipt', id, 'goods-receipt.posted', { id, number: updated.number, journalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).goodsReceipt.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Goods receipt not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT receipts can be cancelled — this receipt is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).goodsReceipt.update({ where: { id }, data: { status: 'CANCELLED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:GoodsReceipt', 'GoodsReceipt', id, 'goods-receipt.cancelled', { id, number: updated.number }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).goodsReceipt.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Goods receipt not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT receipts can be deleted — this receipt is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).goodsReceipt.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:GoodsReceipt', 'GoodsReceipt', id, 'goods-receipt.deleted', { id }, before);
      return toJson(deleted);
    });
  }

}
