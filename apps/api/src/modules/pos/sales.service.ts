import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { computeDocTotals } from '@eserp/shared';
import type { PosSaleDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, ensureSeries, findAccountByCode } from '../sales/common';
import { NumberingSeriesService } from '../settings/numbering.service';
import { StockService } from '../inventory/stock.service';

export interface PosSaleListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  terminalId?: string;
  shiftId?: string;
}

const INCLUDE = {
  terminal: { select: { id: true, code: true, name: true } },
  shift: { select: { id: true, status: true, openedAt: true } },
  customer: { select: { id: true, displayName: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: { item: { select: { id: true, sku: true, name: true } } },
  },
  payments: { orderBy: { createdAt: 'asc' as const } },
};

/**
 * POS sales (Phase 6): fast counter sales inside an OPEN shift.
 * One combined journal entry per sale:
 *   Dr Cash 1010 (cash part) / Dr Card Clearing 1030 (card part) /
 *   Dr COGS 5010 / Cr Sales Revenue 4010 (net) / Cr Output VAT 2110 /
 *   Cr Inventory 1210 (COGS).
 * Voiding (same OPEN shift only) restores stock and posts a reversing entry.
 */
@Injectable()
export class PosSalesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: PosSaleListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.terminalId) where.terminalId = query.terminalId;
    if (query.shiftId) where.shiftId = query.shiftId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).posSale.count({ where }),
        (tx as any).posSale.findMany({ where, orderBy: { saleDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posSale.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('POS sale not found');
    return toJson(row);
  }

  /** Barcode/SKU lookup: item + price + available stock at the terminal's warehouse. */
  async lookup(tenantId: string, terminalId: string, q: string) {
    const result: any = await this.prisma.withTenant(tenantId, async (tx) => {
      const terminal: any = await (tx as any).posTerminal.findUnique({ where: { id: terminalId } });
      if (!terminal || terminal.tenantId !== tenantId) throw new NotFoundException('POS terminal not found');
      const item: any = await (tx as any).item.findFirst({
        where: { tenantId, OR: [{ sku: q }, { barcode: q }] },
        include: { taxRate: { select: { id: true, rateBps: true } } },
      });
      if (!item) throw new NotFoundException(`No item with SKU or barcode ${q}`);
      const level = await (tx as any).stockLevel.findUnique({
        where: { warehouseId_itemId_tenantId: { warehouseId: terminal.warehouseId, itemId: item.id, tenantId } },
      });
      const price = await this.resolvePrice(tx as any, tenantId, item);
      return {
        item: toJson({ id: item.id, sku: item.sku, barcode: item.barcode, name: item.name, nameAr: item.nameAr, salesPriceMinor: item.salesPriceMinor, taxRateBps: item.taxRate?.rateBps ?? 1500, costingMethod: item.costingMethod, trackStock: item.trackStock }),
        priceMinor: price,
        taxRateBps: item.taxRate?.rateBps ?? 1500,
        warehouseId: terminal.warehouseId,
        qtyOnHand: level ? Number(level.qtyOnHand) : 0,
        qtyReserved: level ? Number(level.qtyReserved) : 0,
        qtyAvailable: level ? Number(BigInt(level.qtyOnHand) - BigInt(level.qtyReserved)) : 0,
      };
    });
    return result;
  }

  /** Default price list (best quantity break) wins, else the item's sales price. */
  private async resolvePrice(tx: any, tenantId: string, item: any): Promise<number> {
    const list = await tx.priceList.findFirst({ where: { tenantId, isDefault: true } });
    if (list) {
      const line = await tx.priceListItem.findFirst({
        where: { tenantId, priceListId: list.id, itemId: item.id, minQuantity: { lte: 1n } },
        orderBy: { minQuantity: 'desc' },
      });
      if (line) return Number(line.priceMinor);
    }
    return Number(item.salesPriceMinor);
  }

  async create(tenantId: string, actorId: string, dto: PosSaleDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const terminal: any = await (tx as any).posTerminal.findUnique({ where: { id: dto.terminalId } });
      if (!terminal || terminal.tenantId !== tenantId) throw new NotFoundException('POS terminal not found');
      if (terminal.status !== 'ACTIVE') throw new BadRequestException(`Terminal ${terminal.code} is ${terminal.status}`);
      const shift: any = await (tx as any).posShift.findUnique({ where: { id: dto.shiftId } });
      if (!shift || shift.tenantId !== tenantId) throw new NotFoundException('POS shift not found');
      if (shift.terminalId !== dto.terminalId) throw new BadRequestException('Shift belongs to a different terminal');
      if (shift.status !== 'OPEN') throw new ConflictException(`Shift is ${shift.status} — sales are only allowed in an OPEN shift`);
      if (dto.customerId) {
        const customer = await (tx as any).contact.findUnique({ where: { id: dto.customerId } });
        if (!customer || customer.tenantId !== tenantId) throw new NotFoundException('Customer not found');
        if (!['CUSTOMER', 'BOTH'].includes(customer.type)) throw new BadRequestException('Contact is not a customer');
      }
      // Resolve prices/tax per line, then compute totals with the shared math.
      const resolved: { itemId: string; quantity: number; unitPriceMinor: number; discountPct: number; taxRateBps: number }[] = [];
      for (const line of dto.lines) {
        const item: any = await (tx as any).item.findUnique({ where: { id: line.itemId }, include: { taxRate: true } });
        if (!item || item.tenantId !== tenantId) throw new BadRequestException(`Item not found: ${line.itemId}`);
        if (item.status !== 'ACTIVE') throw new BadRequestException(`Item ${item.sku} is ${item.status}`);
        const unitPrice = line.unitPriceMinor ?? (await this.resolvePrice(tx as any, tenantId, item));
        resolved.push({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPriceMinor: unitPrice,
          discountPct: line.discountPct ?? 0,
          taxRateBps: line.taxRateBps ?? item.taxRate?.rateBps ?? 1500,
        });
      }
      const totals = computeDocTotals(resolved);
      if (totals.totalMinor <= 0n) throw new BadRequestException('Sale total must be positive');
      const paid = dto.payments.reduce((s, p) => s + BigInt(p.amountMinor), 0n);
      if (paid !== totals.totalMinor) {
        throw new BadRequestException(`Payment splits (${paid}) must equal the sale total (${totals.totalMinor})`);
      }
      const cashMinor = dto.payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + BigInt(p.amountMinor), 0n);
      const cardMinor = dto.payments.filter((p) => p.method === 'CARD').reduce((s, p) => s + BigInt(p.amountMinor), 0n);
      await ensureSeries(tx as any, tenantId, actorId, 'POS');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'POS');
      const saleDate = dto.saleDate ? new Date(dto.saleDate) : new Date();
      // Issue stock first (throws on insufficient stock) and collect COGS.
      let cogs = 0n;
      const issueResults: { lineIndex: number; unitCostMinor: bigint; totalCostMinor: bigint }[] = [];
      for (const [i, line] of resolved.entries()) {
        const issued = await this.stock.issue(tx as any, tenantId, actorId, {
          warehouseId: terminal.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          sourceType: 'POS_SALE',
          sourceId: null, // linked after the sale row exists (below)
          reference: number,
          movementDate: saleDate,
          currency: dto.currency,
        });
        cogs += issued.totalCostMinor;
        issueResults.push({ lineIndex: i, unitCostMinor: issued.unitCostMinor, totalCostMinor: issued.totalCostMinor });
      }
      const created = await (tx as any).posSale.create({
        data: {
          tenantId, number, terminalId: dto.terminalId, shiftId: dto.shiftId, cashierId: actorId,
          customerId: dto.customerId ?? null, status: 'COMPLETED', saleDate,
          currency: dto.currency, subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
          cashMinor, cardMinor, cogsMinor: cogs, createdBy: actorId,
          lines: {
            create: resolved.map((l, i) => {
              const t = computeDocTotals([l]);
              return {
                tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitPriceMinor: BigInt(l.unitPriceMinor),
                discountPct: l.discountPct, taxRateBps: l.taxRateBps,
                unitCostMinor: issueResults[i].unitCostMinor,
                lineSubtotalMinor: t.subtotalMinor, lineDiscountMinor: t.discountMinor,
                lineTaxMinor: t.taxMinor, lineTotalMinor: t.totalMinor, lineOrder: i, createdBy: actorId,
              };
            }),
          },
          payments: {
            create: dto.payments.map((p) => ({ tenantId, method: p.method, amountMinor: BigInt(p.amountMinor), reference: p.reference ?? null, createdBy: actorId })),
          },
        },
        include: INCLUDE,
      });
      // Link the stock movements to this sale now that it exists.
      await (tx as any).stockMovement.updateMany({
        where: { tenantId, sourceType: 'POS_SALE', reference: number, sourceId: null },
        data: { sourceId: created.id },
      });
      // One combined journal entry per sale.
      const cashAccount = await findAccountByCode(tx as any, tenantId, terminal.cashAccountCode);
      const cardAccount = await findAccountByCode(tx as any, tenantId, terminal.cardAccountCode);
      const salesRevenue = await findAccountByCode(tx as any, tenantId, COA.SALES_REVENUE);
      const vatOut = await findAccountByCode(tx as any, tenantId, COA.VAT_OUTPUT);
      const cogsAccount = await findAccountByCode(tx as any, tenantId, COA.COGS);
      const inventory = await findAccountByCode(tx as any, tenantId, COA.INVENTORY);
      const taxRate = totals.taxMinor > 0n
        ? await (tx as any).taxRate.findFirst({ where: { tenantId, rateBps: resolved.reduce((m, l) => Math.max(m, l.taxRateBps), 0) } })
        : null;
      const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
        entryDate: saleDate,
        description: `POS sale ${number} — terminal ${terminal.code}`,
        reference: number,
        sourceModule: 'POS',
        currency: dto.currency,
        status: 'POSTED',
        lines: [
          ...(cashMinor > 0n ? [{ accountId: cashAccount.id, debitMinor: cashMinor, creditMinor: 0n, description: `POS sale ${number} (cash)` }] : []),
          ...(cardMinor > 0n ? [{ accountId: cardAccount.id, debitMinor: cardMinor, creditMinor: 0n, description: `POS sale ${number} (card)` }] : []),
          ...(cogs > 0n ? [{ accountId: cogsAccount.id, debitMinor: cogs, creditMinor: 0n, description: `POS sale ${number} (COGS)` }] : []),
          { accountId: salesRevenue.id, debitMinor: 0n, creditMinor: totals.subtotalMinor, taxRateId: taxRate?.id ?? null, description: `POS sale ${number}` },
          ...(totals.taxMinor > 0n ? [{ accountId: vatOut.id, debitMinor: 0n, creditMinor: totals.taxMinor, description: `POS sale ${number} (VAT)` }] : []),
          ...(cogs > 0n ? [{ accountId: inventory.id, debitMinor: 0n, creditMinor: cogs, description: `POS sale ${number} (COGS)` }] : []),
        ],
      });
      const withJournal = await (tx as any).posSale.update({
        where: { id: created.id },
        data: { journalEntryId: entry.id },
        include: INCLUDE,
      });
      await (tx as any).stockMovement.updateMany({
        where: { tenantId, sourceType: 'POS_SALE', sourceId: created.id },
        data: { journalEntryId: entry.id },
      });
      await this.audit.log({ tenantId, actorId, action: 'create:PosSale', entityType: 'PosSale', entityId: created.id, after: toJson(withJournal) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-sale.created', aggregateId: created.id, payload: { id: created.id, number, journalEntryId: entry.id }, createdBy: actorId });
      return toJson(withJournal);
    });
  }

  /** Void a COMPLETED sale in the same OPEN shift: restore stock + reverse the entry. */
  async void(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posSale.findUnique({ where: { id }, include: { lines: true, payments: true, shift: true, terminal: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('POS sale not found');
    if (before.status !== 'COMPLETED') throw new ConflictException(`Only COMPLETED sales can be voided — this sale is ${before.status}`);
    if (before.shift.status !== 'OPEN') throw new ConflictException('A sale can only be voided while its shift is still OPEN');
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Restore stock at the original unit costs (new FIFO layers).
      for (const line of before.lines) {
        await this.stock.receipt(tx as any, tenantId, actorId, {
          warehouseId: before.terminal.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          sourceType: 'POS_SALE',
          sourceId: before.id,
          reference: before.number,
          movementDate: new Date(),
          currency: before.currency,
          movementType: 'RETURN_IN',
        });
      }
      // Reversing entry: swap the original entry's lines.
      const original: any = before.journalEntryId
        ? await (tx as any).journalEntry.findUnique({ where: { id: before.journalEntryId }, include: { lines: true } })
        : null;
      let reversalId: string | null = null;
      if (original) {
        const reversal = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: new Date(),
          description: `Void POS sale ${before.number}`,
          reference: before.number,
          sourceModule: 'POS',
          currency: before.currency,
          status: 'POSTED',
          reversesId: original.id,
          lines: original.lines.map((l: any) => ({
            accountId: l.accountId,
            debitMinor: BigInt(l.creditMinor),
            creditMinor: BigInt(l.debitMinor),
            taxRateId: l.taxRateId,
            costCenterId: l.costCenterId,
            description: l.description,
            lineOrder: l.lineOrder,
          })),
        });
        reversalId = reversal.id;
      }
      const updated = await (tx as any).posSale.update({
        where: { id },
        data: { status: 'VOIDED', voidedAt: new Date() },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'void:PosSale', entityType: 'PosSale', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-sale.voided', aggregateId: id, payload: { id, number: before.number, reversalJournalEntryId: reversalId }, createdBy: actorId });
      return toJson(updated);
    });
  }
}
