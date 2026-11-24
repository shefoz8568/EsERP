import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { threeWayMatchError } from '@eserp/shared';
import type { SupplierInvoiceDto, SupplierInvoiceUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, dueDateFor, ensureSeries, findAccountByCode, getContact, validateDocLines } from '../sales/common';

export interface SupplierInvoiceListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  supplierId?: string;
  purchaseOrderId?: string;
}

const INCLUDE = {
  supplier: { select: { id: true, displayName: true, legalName: true } },
  purchaseOrder: { select: { id: true, number: true } },
  lines: { orderBy: { lineOrder: 'asc' as const }, include: { item: { select: { id: true, sku: true, name: true } } } },
  allocations: { select: { id: true, paymentId: true, amountMinor: true } },
};

@Injectable()
export class SupplierInvoicesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  async list(tenantId: string, query: SupplierInvoiceListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.purchaseOrderId) where.purchaseOrderId = query.purchaseOrderId;
    if (query.search) where.number = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).supplierInvoice.count({ where }),
        (tx as any).supplierInvoice.findMany({ where, orderBy: { invoiceDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).supplierInvoice.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Supplier invoice not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: SupplierInvoiceDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const supplier = await getContact(tx as any, tenantId, dto.supplierId, ['SUPPLIER', 'BOTH']);
      let po: any = null;
      if (dto.purchaseOrderId) {
        po = await (tx as any).purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, include: { lines: true } });
        if (!po || po.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
        if (po.supplierId !== dto.supplierId) throw new BadRequestException('Purchase order belongs to a different supplier');
      }
      const { validated, totals } = await validateDocLines(tx as any, tenantId, dto.lines);
      if (totals.totalMinor <= 0n) throw new BadRequestException('Invoice total must be positive');
      // Validate PO line links up front (the same check runs again on post).
      if (po) {
        for (const line of dto.lines) {
          if (line.purchaseOrderLineId) {
            const poLine = po.lines.find((l: any) => l.id === line.purchaseOrderLineId);
            if (!poLine) throw new BadRequestException(`Purchase order line not found: ${line.purchaseOrderLineId}`);
            if (poLine.itemId !== line.itemId) throw new BadRequestException('Invoice line item does not match the purchase order line item');
          }
        }
      }
      await ensureSeries(tx as any, tenantId, actorId, 'SIN');
      const number = await this.numbering.nextNumber(tx as any, tenantId, 'SIN');
      const dueDate = dto.dueDate ? new Date(dto.dueDate) : dueDateFor(dto.invoiceDate, supplier.paymentTermsDays);
      const created = await (tx as any).supplierInvoice.create({
        data: {
          tenantId, number, supplierId: dto.supplierId, purchaseOrderId: dto.purchaseOrderId ?? null,
          status: 'DRAFT', currency: dto.currency, invoiceDate: new Date(dto.invoiceDate), dueDate,
          subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor, totalMinor: totals.totalMinor, paidMinor: 0n,
          notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: validated.map((l, i) => ({
              tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitCostMinor: BigInt(l.unitPriceMinor),
              discountPct: l.discountPct, taxRateBps: l.taxRateBps,
              purchaseOrderLineId: (dto.lines[i] as any).purchaseOrderLineId ?? null,
              lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor,
              lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:SupplierInvoice', entityType: 'SupplierInvoice', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'supplier-invoice.created', aggregateId: created.id, payload: { id: created.id, number }, createdBy: actorId });
      return toJson(created);
    });
  }

  /** Update a DRAFT supplier invoice (notes/lines replaced wholesale). */
  async update(tenantId: string, actorId: string, id: string, dto: SupplierInvoiceUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).supplierInvoice.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Supplier invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be edited — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let totals = null;
      let validated = null;
      if (dto.lines) {
        const v = await validateDocLines(tx as any, tenantId, dto.lines);
        validated = v.validated;
        totals = v.totals;
        if (totals.totalMinor <= 0n) throw new BadRequestException('Invoice total must be positive');
        await (tx as any).supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: id } });
      }
      const updated = await (tx as any).supplierInvoice.update({
        where: { id },
        data: {
          notes: dto.notes !== undefined ? dto.notes : undefined,
          ...(totals ? { subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor } : {}),
          ...(validated ? { lines: { create: validated.map((l: any, i: number) => ({ tenantId, itemId: l.itemId, quantity: BigInt(l.quantity), unitCostMinor: BigInt(l.unitPriceMinor), discountPct: l.discountPct, taxRateBps: l.taxRateBps, purchaseOrderLineId: (dto.lines![i] as any).purchaseOrderLineId ?? null, lineSubtotalMinor: l.netMinor, lineDiscountMinor: l.discountMinor, lineTaxMinor: l.taxMinor, lineTotalMinor: l.totalMinor, lineOrder: i, createdBy: actorId })) } } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'update:SupplierInvoice', entityType: 'SupplierInvoice', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'supplier-invoice.updated', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /**
   * Post a DRAFT supplier invoice (DRAFT -> POSTED) via postBalanced().
   * Without receipts: Dr Purchases 5100 (net) / Dr Input VAT 2120 (tax) /
   * Cr AP 2010 (total). Phase 5 GRNI relief: for invoice lines matched to
   * goods receipts, the received portion posts Dr GRNI 2020 instead of
   * Dr Purchases (relieving the GRNI liability created at receipt time).
   * The tax rate stays linked on a debit line so the Phase 2 VAT summary
   * counts input VAT exactly once (it treats 2020 as an input-VAT base).
   * When linked to a PO, the 3-way match runs first: invoiced qty (incl.
   * already-invoiced qty on the same PO line) must not exceed the PO
   * ordered qty, must not exceed the qty actually received (goods must be
   * received before they can be invoiced), and unit-price variance over 5%
   * blocks posting (400).
   * The tax rate is linked on the purchases line only, so the Phase 2 VAT
   * summary counts input VAT exactly once.
   */
  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).supplierInvoice.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Supplier invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be posted — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (before.purchaseOrderId) await this.runThreeWayMatch(tx as any, tenantId, before);
      const grniNet = await this.grniReliefNet(tx as any, tenantId, before);
      const purchasesNet = BigInt(before.subtotalMinor) - grniNet;
      const purchases = await findAccountByCode(tx as any, tenantId, COA.PURCHASES);
      const grni = grniNet > 0n ? await findAccountByCode(tx as any, tenantId, COA.GRNI) : null;
      const vatIn = await findAccountByCode(tx as any, tenantId, COA.VAT_INPUT);
      const ap = await findAccountByCode(tx as any, tenantId, COA.AP);
      const maxRateBps = before.lines.reduce((m: number, l: any) => Math.max(m, l.taxRateBps), 0);
      const taxRate = maxRateBps > 0
        ? await (tx as any).taxRate.findFirst({ where: { tenantId, rateBps: maxRateBps } })
        : null;
      const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
        entryDate: before.invoiceDate,
        description: `Supplier invoice ${before.number}`,
        reference: before.number,
        sourceModule: 'PURCHASING',
        currency: before.currency,
        status: 'POSTED',
        lines: [
          ...(purchasesNet > 0n ? [{ accountId: purchases.id, debitMinor: purchasesNet, creditMinor: 0n, taxRateId: taxRate?.id ?? null, description: `Supplier invoice ${before.number}` }] : []),
          ...(grni && grniNet > 0n ? [{ accountId: grni.id, debitMinor: grniNet, creditMinor: 0n, taxRateId: purchasesNet > 0n ? null : taxRate?.id ?? null, description: `Supplier invoice ${before.number} (goods received)` }] : []),
          ...(BigInt(before.taxMinor) > 0n ? [{ accountId: vatIn.id, debitMinor: BigInt(before.taxMinor), creditMinor: 0n, description: `Supplier invoice ${before.number}` }] : []),
          { accountId: ap.id, debitMinor: 0n, creditMinor: BigInt(before.totalMinor), description: `Supplier invoice ${before.number}` },
        ],
      });
      const updated = await (tx as any).supplierInvoice.update({
        where: { id }, data: { status: 'POSTED', journalEntryId: entry.id }, include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'post:SupplierInvoice', entityType: 'SupplierInvoice', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'supplier-invoice.posted', aggregateId: id, payload: { id, number: updated.number, journalEntryId: entry.id }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /**
   * GRNI relief (Phase 5): the net value of invoice lines matched to goods
   * already received. For each line linked to a PO line, the matched
   * quantity is min(line qty, received qty − already-invoiced qty), valued
   * at the line's net unit value (lineSubtotal / quantity). Lines without a
   * receipt, and invoices with no receipt at all, relieve 0 — their posting
   * is unchanged from Phase 4.
   */
  private async grniReliefNet(tx: any, tenantId: string, invoice: any): Promise<bigint> {
    const linked = invoice.lines.filter((l: any) => l.purchaseOrderLineId);
    if (linked.length === 0) return 0n;
    const poLineIds = [...new Set(linked.map((l: any) => l.purchaseOrderLineId))];
    const receipts: any[] = await tx.goodsReceiptLine.findMany({
      where: { tenantId, purchaseOrderLineId: { in: poLineIds }, goodsReceipt: { status: 'POSTED' } },
      select: { purchaseOrderLineId: true, quantityReceived: true },
    });
    const receivedByLine = new Map<string, bigint>();
    for (const r of receipts) {
      receivedByLine.set(r.purchaseOrderLineId, (receivedByLine.get(r.purchaseOrderLineId) ?? 0n) + BigInt(r.quantityReceived));
    }
    const otherLines: any[] = await tx.supplierInvoiceLine.findMany({
      where: { purchaseOrderLineId: { in: poLineIds }, supplierInvoice: { id: { not: invoice.id }, status: { not: 'VOID' } } },
      select: { purchaseOrderLineId: true, quantity: true },
    });
    const invoicedByLine = new Map<string, bigint>();
    for (const l of otherLines) {
      invoicedByLine.set(l.purchaseOrderLineId, (invoicedByLine.get(l.purchaseOrderLineId) ?? 0n) + BigInt(l.quantity));
    }
    let relief = 0n;
    for (const line of linked) {
      const received = receivedByLine.get(line.purchaseOrderLineId) ?? 0n;
      const already = invoicedByLine.get(line.purchaseOrderLineId) ?? 0n;
      const matchable = received - already;
      if (matchable <= 0n) continue;
      const qty = BigInt(line.quantity) < matchable ? BigInt(line.quantity) : matchable;
      const netPerUnit = BigInt(line.quantity) > 0n ? BigInt(line.lineSubtotalMinor) / BigInt(line.quantity) : 0n;
      relief += qty * netPerUnit;
    }
    return relief;
  }

  /** 3-way match against the linked PO (see docs/erd-phase4.md). */
  private async runThreeWayMatch(tx: any, tenantId: string, invoice: any): Promise<void> {
    const po = await tx.purchaseOrder.findUnique({ where: { id: invoice.purchaseOrderId }, include: { lines: true } });
    if (!po || po.tenantId !== tenantId) throw new NotFoundException('Purchase order not found');
    // Already-invoiced quantities per PO line, from other (non-VOID) invoices.
    const otherLines: any[] = await tx.supplierInvoiceLine.findMany({
      where: { purchaseOrderLineId: { not: null }, supplierInvoice: { purchaseOrderId: po.id, id: { not: invoice.id }, status: { not: 'VOID' } } },
      select: { purchaseOrderLineId: true, quantity: true },
    });
    const alreadyByLine = new Map<string, bigint>();
    for (const l of otherLines) {
      alreadyByLine.set(l.purchaseOrderLineId, (alreadyByLine.get(l.purchaseOrderLineId) ?? 0n) + BigInt(l.quantity));
    }
    // Received quantities per PO line, from POSTED goods receipts only.
    // Invoicing goods that have not been received is blocked below: the
    // cumulative invoiced qty (incl. this invoice) must not exceed what
    // has actually been received (net of already-invoiced qty).
    const linkedLineIds = [...new Set(invoice.lines.filter((l: any) => l.purchaseOrderLineId).map((l: any) => l.purchaseOrderLineId))];
    const receivedByLine = new Map<string, bigint>();
    if (linkedLineIds.length > 0) {
      const receipts: any[] = await tx.goodsReceiptLine.findMany({
        where: { tenantId, purchaseOrderLineId: { in: linkedLineIds }, goodsReceipt: { status: 'POSTED' } },
        select: { purchaseOrderLineId: true, quantityReceived: true },
      });
      for (const r of receipts) {
        receivedByLine.set(r.purchaseOrderLineId, (receivedByLine.get(r.purchaseOrderLineId) ?? 0n) + BigInt(r.quantityReceived));
      }
    }
    for (const line of invoice.lines) {
      if (!line.purchaseOrderLineId) continue;
      const poLine = po.lines.find((l: any) => l.id === line.purchaseOrderLineId);
      if (!poLine) throw new BadRequestException(`Purchase order line not found: ${line.purchaseOrderLineId}`);
      const received = receivedByLine.get(poLine.id) ?? 0n;
      const alreadyInvoiced = alreadyByLine.get(poLine.id) ?? 0n;
      const receivable = received - alreadyInvoiced;
      if (BigInt(line.quantity) > receivable) {
        throw new BadRequestException(
          `3-way match failed for ${po.number} line ${poLine.lineOrder + 1}: invoiced quantity ${line.quantity} exceeds received quantity ${received} (already invoiced ${alreadyInvoiced}) — goods must be received before they can be invoiced`,
        );
      }
      const err = threeWayMatchError({
        poQuantity: poLine.quantityOrdered,
        alreadyInvoicedQuantity: alreadyByLine.get(poLine.id) ?? 0n,
        invoiceQuantity: line.quantity,
        poUnitPriceMinor: poLine.unitCostMinor,
        invoiceUnitPriceMinor: line.unitCostMinor,
      });
      if (err) throw new BadRequestException(`3-way match failed for ${po.number} line ${poLine.lineOrder + 1}: ${err}`);
    }
  }

  /** VOID only from DRAFT. */
  async void(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).supplierInvoice.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Supplier invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be voided — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).supplierInvoice.update({ where: { id }, data: { status: 'VOID' }, include: INCLUDE });
      await this.audit.log({ tenantId, actorId, action: 'void:SupplierInvoice', entityType: 'SupplierInvoice', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'supplier-invoice.voided', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).supplierInvoice.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Supplier invoice not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT invoices can be deleted — this invoice is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).supplierInvoice.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:SupplierInvoice', entityType: 'SupplierInvoice', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'supplier-invoice.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
