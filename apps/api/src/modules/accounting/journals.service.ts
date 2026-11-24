import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { journalTotals, validateJournalLines } from '@eserp/shared';
import type { JournalEntryDto, JournalEntryUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { PostingService } from './posting.service';

export interface JournalListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  fiscalPeriodId?: string;
  sourceModule?: string;
  from?: string;
  to?: string;
}

const ENTRY_INCLUDE = {
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: {
      account: { select: { id: true, code: true, nameEn: true, nameAr: true, type: true } },
      costCenter: { select: { id: true, code: true, name: true } },
      taxRate: { select: { id: true, name: true, rateBps: true } },
    },
  },
  fiscalPeriod: { select: { id: true, fiscalYear: true, periodNumber: true, status: true } },
  reverses: { select: { id: true, number: true } },
  reversedBy: { select: { id: true, number: true } },
};

@Injectable()
export class JournalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  async list(tenantId: string, query: JournalListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.fiscalPeriodId) where.fiscalPeriodId = query.fiscalPeriodId;
    if (query.sourceModule) where.sourceModule = query.sourceModule;
    if (query.from || query.to) {
      where.entryDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data]: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).journalEntry.count({ where }),
        (tx as any).journalEntry.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { number: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: ENTRY_INCLUDE,
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).journalEntry.findUnique({ where: { id }, include: ENTRY_INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Journal entry not found');
    return toJson(row);
  }

  /** Create a DRAFT entry (editable/deletable until posted). */
  async createDraft(tenantId: string, actorId: string, dto: JournalEntryDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
        entryDate: dto.entryDate,
        description: dto.description,
        reference: dto.reference,
        sourceModule: dto.sourceModule,
        currency: dto.currency,
        status: 'DRAFT',
        lines: dto.lines,
      });
      return toJson(entry);
    });
  }

  /** Update a DRAFT entry (lines are replaced wholesale). POSTED entries are immutable. */
  async updateDraft(tenantId: string, actorId: string, id: string, dto: JournalEntryUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).journalEntry.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Journal entry not found');
    if (before.status !== 'DRAFT') {
      throw new ConflictException(`Only DRAFT entries can be edited — this entry is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const lines = dto.lines ?? before.lines.map((l: any) => ({
        accountId: l.accountId,
        debitMinor: Number(l.debitMinor),
        creditMinor: Number(l.creditMinor),
        costCenterId: l.costCenterId,
        taxRateId: l.taxRateId,
        description: l.description,
        lineOrder: l.lineOrder,
      }));
      const errors = validateJournalLines(lines as any);
      if (errors.length > 0) throw new BadRequestException(errors.map((e) => e.message).join('; '));
      await this.posting.validateLines(tx as any, tenantId, lines as any);
      const entryDate = dto.entryDate ? new Date(dto.entryDate) : before.entryDate;
      const period = await this.posting.resolveOpenPeriod(tx as any, tenantId, entryDate);
      const { totalDebitMinor, totalCreditMinor } = journalTotals(lines as any);
      await (tx as any).journalEntryLine.deleteMany({ where: { entryId: id } });
      const updated = await (tx as any).journalEntry.update({
        where: { id },
        data: {
          entryDate,
          fiscalPeriodId: period.id,
          description: dto.description ?? before.description,
          reference: dto.reference !== undefined ? dto.reference : before.reference,
          totalDebitMinor,
          totalCreditMinor,
          lines: {
            create: lines.map((l: any, i: number) => ({
              tenantId,
              accountId: l.accountId,
              debitMinor: BigInt(l.debitMinor),
              creditMinor: BigInt(l.creditMinor),
              currency: before.currency,
              costCenterId: l.costCenterId ?? null,
              taxRateId: l.taxRateId ?? null,
              description: l.description ?? null,
              lineOrder: l.lineOrder ?? i,
              createdBy: actorId,
            })),
          },
        },
        include: ENTRY_INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'update:JournalEntry', entityType: 'JournalEntry', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'journal.updated', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /** Delete a DRAFT entry. POSTED/REVERSED entries can only be corrected by reversal. */
  async deleteDraft(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).journalEntry.findUnique({ where: { id } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Journal entry not found');
    if (before.status !== 'DRAFT') {
      throw new ConflictException(`Only DRAFT entries can be deleted — this entry is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).journalEntry.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:JournalEntry', entityType: 'JournalEntry', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'journal.deleted', aggregateId: id, payload: { id, number: before.number }, createdBy: actorId });
      return toJson(deleted);
    });
  }

  /** Post a DRAFT: re-validates balance and requires the entry's period to still be OPEN. */
  async post(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).journalEntry.findUnique({ where: { id }, include: { lines: true, fiscalPeriod: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Journal entry not found');
    if (before.status !== 'DRAFT') {
      throw new ConflictException(`Only DRAFT entries can be posted — this entry is ${before.status}`);
    }
    const errors = validateJournalLines(before.lines as any);
    if (errors.length > 0) throw new BadRequestException(errors.map((e) => e.message).join('; '));
    return this.prisma.withTenant(tenantId, async (tx) => {
      const period = await (tx as any).fiscalPeriod.findUnique({ where: { id: before.fiscalPeriodId } });
      if (!period || period.status !== 'OPEN') {
        throw new BadRequestException(`Fiscal period ${period?.fiscalYear}/${period?.periodNumber} is ${period?.status ?? 'missing'} — postings are only allowed into OPEN periods`);
      }
      const updated = await (tx as any).journalEntry.update({
        where: { id },
        data: { status: 'POSTED', postedAt: new Date(), postedBy: actorId },
        include: ENTRY_INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'post:JournalEntry', entityType: 'JournalEntry', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'journal.posted', aggregateId: id, payload: { id, number: updated.number }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /**
   * Reverse a POSTED entry: creates a new POSTED entry with swapped
   * debit/credit dated today (in today's OPEN period — which may differ
   * from the original's period if that period has since closed), and
   * marks the original REVERSED. One reversal per entry (enforced by the
   * unique reversesId).
   */
  async reverse(tenantId: string, actorId: string, id: string) {
    const original: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).journalEntry.findUnique({ where: { id }, include: { lines: { orderBy: { lineOrder: 'asc' } }, reversedBy: true } }),
    );
    if (!original || original.tenantId !== tenantId) throw new NotFoundException('Journal entry not found');
    if (original.status !== 'POSTED') {
      throw new ConflictException(`Only POSTED entries can be reversed — this entry is ${original.status}`);
    }
    if (original.reversedBy) {
      throw new ConflictException(`Entry ${original.number} was already reversed by ${original.reversedBy.number}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const reversal = await this.posting.postBalanced(tx as any, tenantId, actorId, {
        entryDate: new Date(),
        description: `Reversal of ${original.number}: ${original.description}`,
        reference: original.reference,
        sourceModule: original.sourceModule,
        currency: original.currency,
        status: 'POSTED',
        reversesId: original.id,
        lines: original.lines.map((l: any) => ({
          accountId: l.accountId,
          debitMinor: l.creditMinor,
          creditMinor: l.debitMinor,
          costCenterId: l.costCenterId,
          taxRateId: l.taxRateId,
          description: l.description,
          lineOrder: l.lineOrder,
        })),
      });
      const updatedOriginal = await (tx as any).journalEntry.update({
        where: { id },
        data: { status: 'REVERSED' },
        include: ENTRY_INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'reverse:JournalEntry', entityType: 'JournalEntry', entityId: id, before: toJson(original), after: toJson(updatedOriginal) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'journal.reversed', aggregateId: id, payload: { id, number: original.number, reversedBy: reversal.number }, createdBy: actorId });
      return toJson({ ...reversal, reverses: { id: original.id, number: original.number } });
    });
  }
}
