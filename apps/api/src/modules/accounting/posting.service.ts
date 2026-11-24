import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { journalTotals, validateJournalLines } from '@eserp/shared';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { NumberingSeriesService } from '../settings/numbering.service';

export interface PostingLineInput {
  accountId: string;
  debitMinor: bigint | number;
  creditMinor: bigint | number;
  costCenterId?: string | null;
  taxRateId?: string | null;
  description?: string | null;
  lineOrder?: number;
}

export interface PostBalancedInput {
  entryDate: Date | string;
  description: string;
  reference?: string | null;
  sourceModule?: string;
  currency?: string;
  status?: 'DRAFT' | 'POSTED';
  reversesId?: string | null;
  lines: PostingLineInput[];
}

/**
 * Reusable double-entry posting service.
 *
 * Later phases (Sales / Purchasing / Inventory / Payroll) call
 * postBalanced() to post balanced entries — it applies exactly the same
 * validation as the manual journal flow: balance, leaf posting accounts,
 * open fiscal period, single currency per entry.
 *
 * Posting-account rule: ChartOfAccounts has no isPosting flag, so an
 * account is a posting account iff it is a LEAF (it has no children).
 * Group/header accounts (e.g. 1000 Cash and Cash Equivalents) cannot
 * receive lines. See docs/erd-phase2.md.
 */
@Injectable()
export class PostingService {
  constructor(
    @Inject(NumberingSeriesService) private readonly numbering: NumberingSeriesService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Find the fiscal period covering a date; it must exist and be OPEN. */
  async resolveOpenPeriod(tx: PrismaTx, tenantId: string, entryDate: Date | string): Promise<any> {
    const date = new Date(entryDate);
    const period = await (tx as any).fiscalPeriod.findFirst({
      where: { tenantId, startDate: { lte: date }, endDate: { gte: date } },
      orderBy: { startDate: 'asc' },
    });
    if (!period) {
      throw new BadRequestException(
        `No fiscal period covers ${date.toISOString().slice(0, 10)} — create one before posting`,
      );
    }
    if (period.status !== 'OPEN') {
      throw new BadRequestException(
        `Fiscal period ${period.fiscalYear}/${period.periodNumber} is ${period.status} — postings are only allowed into OPEN periods`,
      );
    }
    return period;
  }

  /** Validate lines + referenced accounts/cost centres/tax rates (inside tx). */
  async validateLines(tx: PrismaTx, tenantId: string, lines: PostingLineInput[]): Promise<void> {
    const errors = validateJournalLines(lines);
    if (errors.length > 0) {
      throw new BadRequestException(errors.map((e) => e.message).join('; '));
    }
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    for (const accountId of accountIds) {
      const account = await (tx as any).chartOfAccounts.findUnique({ where: { id: accountId } });
      if (!account || account.tenantId !== tenantId) {
        throw new BadRequestException(`Account not found: ${accountId}`);
      }
      const children = await (tx as any).chartOfAccounts.count({ where: { tenantId, parentId: accountId } });
      if (children > 0) {
        throw new BadRequestException(
          `Account ${account.code} (${account.nameEn}) is a group/header account — post to one of its leaf accounts instead`,
        );
      }
    }
    for (const line of lines) {
      if (line.costCenterId) {
        const cc = await (tx as any).costCenter.findUnique({ where: { id: line.costCenterId } });
        if (!cc || cc.tenantId !== tenantId) throw new BadRequestException(`Cost centre not found: ${line.costCenterId}`);
        if (cc.status !== 'ACTIVE') throw new BadRequestException(`Cost centre ${cc.code} is not ACTIVE`);
      }
      if (line.taxRateId) {
        const tax = await (tx as any).taxRate.findUnique({ where: { id: line.taxRateId } });
        if (!tax || tax.tenantId !== tenantId) throw new BadRequestException(`Tax rate not found: ${line.taxRateId}`);
      }
    }
  }

  /**
   * Create a balanced journal entry (DRAFT or POSTED) in the caller's
   * transaction. Assigns the next JE number, derives the fiscal period
   * from the entry date, writes audit + outbox rows, and returns the
   * entry with its lines. Throws BadRequestException on any rule breach.
   */
  async postBalanced(tx: PrismaTx, tenantId: string, actorId: string, input: PostBalancedInput): Promise<any> {
    const currency = (input.currency ?? 'SAR').toUpperCase();
    const status = input.status ?? 'POSTED';
    await this.validateLines(tx, tenantId, input.lines);
    const period = await this.resolveOpenPeriod(tx, tenantId, input.entryDate);
    const { totalDebitMinor, totalCreditMinor } = journalTotals(input.lines);

    // JE numbering series: auto-create it (pattern JE-{YYYY}-{SEQ:5}) if a
    // tenant never had one, so module postings never fail on numbering.
    const existing = await (tx as any).numberingSeries.findUnique({
      where: { code_tenantId: { code: 'JE', tenantId } },
    });
    if (!existing) {
      await (tx as any).numberingSeries.create({
        data: { tenantId, code: 'JE', name: 'Journal Entries', pattern: 'JE-{YYYY}-{SEQ:5}', nextNumber: 1, createdBy: actorId },
      });
    }
    const number = await this.numbering.nextNumber(tx as any, tenantId, 'JE');

    const entry = await (tx as any).journalEntry.create({
      data: {
        tenantId,
        number,
        entryDate: new Date(input.entryDate),
        fiscalPeriodId: period.id,
        status,
        description: input.description,
        reference: input.reference ?? null,
        sourceModule: input.sourceModule ?? 'MANUAL',
        currency,
        totalDebitMinor,
        totalCreditMinor,
        postedAt: status === 'POSTED' ? new Date() : null,
        postedBy: status === 'POSTED' ? actorId : null,
        reversesId: input.reversesId ?? null,
        createdBy: actorId,
        lines: {
          create: input.lines.map((l, i) => ({
            tenantId,
            accountId: l.accountId,
            debitMinor: BigInt(l.debitMinor),
            creditMinor: BigInt(l.creditMinor),
            currency,
            costCenterId: l.costCenterId ?? null,
            taxRateId: l.taxRateId ?? null,
            description: l.description ?? null,
            lineOrder: l.lineOrder ?? i,
            createdBy: actorId,
          })),
        },
      },
      include: { lines: { orderBy: { lineOrder: 'asc' } }, fiscalPeriod: true },
    });
    await this.audit.log(
      { tenantId, actorId, action: status === 'POSTED' ? 'post:JournalEntry' : 'create:JournalEntry', entityType: 'JournalEntry', entityId: entry.id, after: { number, status, totalDebitMinor: Number(totalDebitMinor) } },
      tx as any,
    );
    await this.outbox.publish(tx as any, {
      tenantId,
      eventType: status === 'POSTED' ? 'journal.posted' : 'journal.created',
      aggregateId: entry.id,
      payload: { id: entry.id, number, status },
      createdBy: actorId,
    });
    return entry;
  }
}
