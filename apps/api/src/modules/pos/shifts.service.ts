import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { cashVarianceMinor, computeShiftTotals, expectedCashMinor } from '@eserp/shared';
import type { PosShiftCloseDto, PosShiftDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, findAccountByCode } from '../sales/common';

export interface PosShiftListQuery {
  page?: string;
  pageSize?: string;
  terminalId?: string;
  status?: string;
  cashierId?: string;
}

const INCLUDE = {
  terminal: { select: { id: true, code: true, name: true, warehouseId: true } },
  sales: {
    orderBy: { saleDate: 'asc' as const },
    select: { id: true, number: true, status: true, subtotalMinor: true, discountMinor: true, taxMinor: true, totalMinor: true, cashMinor: true, cardMinor: true, cogsMinor: true, saleDate: true },
  },
};

/**
 * POS shifts (Phase 6): one OPEN shift per terminal. Closing computes the
 * Z-report (expected cash = opening float + cash sales), compares it with
 * the counted cash and posts any variance to 5250 Cash Over / Short
 * (short: Dr 5250 / Cr Cash; over: Dr Cash / Cr 5250).
 */
@Injectable()
export class PosShiftsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  async list(tenantId: string, query: PosShiftListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.terminalId) where.terminalId = query.terminalId;
    if (query.status) where.status = query.status;
    if (query.cashierId) where.cashierId = query.cashierId;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).posShift.count({ where }),
        (tx as any).posShift.findMany({ where, orderBy: { openedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { terminal: { select: { id: true, code: true, name: true } } } }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posShift.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('POS shift not found');
    return toJson(row);
  }

  /** Z-report for a shift (works for OPEN shifts too — a live running total). */
  async zReport(tenantId: string, id: string) {
    const shift: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posShift.findUnique({
        where: { id },
        include: {
          terminal: { select: { id: true, code: true, name: true } },
          sales: { where: { status: 'COMPLETED' }, orderBy: { saleDate: 'asc' } },
        },
      }),
    );
    if (!shift || shift.tenantId !== tenantId) throw new NotFoundException('POS shift not found');
    const totals = computeShiftTotals(shift.sales);
    const expectedCash = expectedCashMinor(BigInt(shift.openingFloatMinor), totals.cashMinor);
    const counted = shift.countedCashMinor !== null && shift.countedCashMinor !== undefined ? BigInt(shift.countedCashMinor) : null;
    return toJson({
      shift: {
        id: shift.id,
        terminal: shift.terminal,
        cashierId: shift.cashierId,
        status: shift.status,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        openingFloatMinor: shift.openingFloatMinor,
      },
      salesCount: totals.salesCount,
      grossMinor: totals.grossMinor,
      discountMinor: totals.discountMinor,
      netMinor: totals.netMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.netMinor + totals.taxMinor,
      cashMinor: totals.cashMinor,
      cardMinor: totals.cardMinor,
      expectedCashMinor: expectedCash,
      expectedCardMinor: totals.cardMinor,
      countedCashMinor: counted,
      varianceMinor: counted !== null ? cashVarianceMinor(counted, expectedCash) : null,
      sales: shift.sales,
    });
  }

  async open(tenantId: string, actorId: string, dto: PosShiftDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const terminal: any = await (tx as any).posTerminal.findUnique({ where: { id: dto.terminalId } });
      if (!terminal || terminal.tenantId !== tenantId) throw new NotFoundException('POS terminal not found');
      if (terminal.status !== 'ACTIVE') throw new BadRequestException(`Terminal ${terminal.code} is ${terminal.status} — only ACTIVE terminals can open a shift`);
      const openShift = await (tx as any).posShift.findFirst({ where: { tenantId, terminalId: dto.terminalId, status: 'OPEN' } });
      if (openShift) throw new ConflictException(`Terminal ${terminal.code} already has an OPEN shift`);
      const created = await (tx as any).posShift.create({
        data: {
          tenantId, terminalId: dto.terminalId, cashierId: actorId,
          openedAt: new Date(), openingFloatMinor: BigInt(dto.openingFloatMinor),
          status: 'OPEN', createdBy: actorId,
        },
        include: { terminal: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.log({ tenantId, actorId, action: 'open:PosShift', entityType: 'PosShift', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-shift.opened', aggregateId: created.id, payload: { id: created.id, terminalId: dto.terminalId }, createdBy: actorId });
      return toJson(created);
    });
  }

  /** Close an OPEN shift: lock it, compute the Z-report and post any cash variance. */
  async close(tenantId: string, actorId: string, id: string, dto: PosShiftCloseDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posShift.findUnique({ where: { id }, include: { terminal: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('POS shift not found');
    if (before.status !== 'OPEN') throw new ConflictException(`Only OPEN shifts can be closed — this shift is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const sales: any[] = await (tx as any).posSale.findMany({ where: { tenantId, shiftId: id, status: 'COMPLETED' } });
      const totals = computeShiftTotals(sales);
      const expectedCash = expectedCashMinor(BigInt(before.openingFloatMinor), totals.cashMinor);
      const counted = BigInt(dto.countedCashMinor);
      const variance = cashVarianceMinor(counted, expectedCash);
      let journalEntryId: string | null = null;
      if (variance !== 0n) {
        const cash = await findAccountByCode(tx as any, tenantId, before.terminal.cashAccountCode);
        const overShort = await findAccountByCode(tx as any, tenantId, COA.CASH_OVER_SHORT);
        const amount = variance > 0n ? variance : -variance;
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: new Date(),
          description: `POS shift cash variance — terminal ${before.terminal.code}`,
          reference: before.terminal.code,
          sourceModule: 'POS',
          currency: 'SAR',
          status: 'POSTED',
          lines:
            variance > 0n
              ? [
                  { accountId: cash.id, debitMinor: amount, creditMinor: 0n, description: 'Cash over on shift close' },
                  { accountId: overShort.id, debitMinor: 0n, creditMinor: amount, description: 'Cash over on shift close' },
                ]
              : [
                  { accountId: overShort.id, debitMinor: amount, creditMinor: 0n, description: 'Cash short on shift close' },
                  { accountId: cash.id, debitMinor: 0n, creditMinor: amount, description: 'Cash short on shift close' },
                ],
        });
        journalEntryId = entry.id;
      }
      const updated = await (tx as any).posShift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          expectedCashMinor: expectedCash,
          expectedCardMinor: totals.cardMinor,
          countedCashMinor: counted,
          varianceMinor: variance,
          closedBy: actorId,
          journalEntryId,
        },
        include: { terminal: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.log({ tenantId, actorId, action: 'close:PosShift', entityType: 'PosShift', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-shift.closed', aggregateId: id, payload: { id, varianceMinor: Number(variance), journalEntryId }, createdBy: actorId });
      return toJson(updated);
    });
  }
}
