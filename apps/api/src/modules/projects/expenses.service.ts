import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectExpenseDto, ProjectExpenseUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { assertProjectOpenForEntry, getProjectOr404, logAndPublish } from './helpers';

export interface ExpenseListQuery {
  page?: string;
  pageSize?: string;
  projectId?: string;
  status?: string;
  category?: string;
  from?: string;
  to?: string;
}

const INCLUDE = {
  project: { select: { id: true, code: true, name: true, status: true } },
};

/**
 * Project expenses (Phase 9). `receiptFileId` is a FileAsset id stored as a
 * plain string (same pattern as Phase 1 item images). Only DRAFT expenses
 * are editable; approval locks the entry.
 */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ExpenseListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).projectExpense.count({ where }),
        (tx as any).projectExpense.findMany({ where, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).projectExpense.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Project expense not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: ProjectExpenseDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const project = await getProjectOr404(tx as any, tenantId, dto.projectId);
      assertProjectOpenForEntry(project);
      const created = await (tx as any).projectExpense.create({
        data: {
          tenantId, projectId: dto.projectId, date: new Date(dto.date),
          category: dto.category, amountMinor: BigInt(dto.amountMinor), currency: dto.currency,
          description: dto.description ?? null, receiptFileId: dto.receiptFileId ?? null,
          status: 'DRAFT', submittedBy: actorId, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'create:ProjectExpense', 'ProjectExpense', created.id, 'project-expense.created', { id: created.id, projectId: dto.projectId }, undefined, created);
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: ProjectExpenseUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).projectExpense.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project expense not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT expenses can be edited — this expense is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const data: Record<string, unknown> = {};
      if (dto.date !== undefined) data.date = new Date(dto.date);
      if (dto.category !== undefined) data.category = dto.category;
      if (dto.amountMinor !== undefined) data.amountMinor = BigInt(dto.amountMinor);
      if (dto.currency !== undefined) data.currency = dto.currency;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.receiptFileId !== undefined) data.receiptFileId = dto.receiptFileId;
      const updated = await (tx as any).projectExpense.update({ where: { id }, data, include: INCLUDE });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'update:ProjectExpense', 'ProjectExpense', id, 'project-expense.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  private async transition(tenantId: string, actorId: string, id: string, to: string, action: string, event: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).projectExpense.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project expense not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT expenses can move to ${to} — this expense is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).projectExpense.update({ where: { id }, data: { status: to }, include: INCLUDE });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, action, 'ProjectExpense', id, event, { id }, before, updated);
      return toJson(updated);
    });
  }

  approve(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, 'APPROVED', 'approve:ProjectExpense', 'project-expense.approved');
  }

  reject(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, 'REJECTED', 'reject:ProjectExpense', 'project-expense.rejected');
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).projectExpense.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project expense not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT expenses can be deleted — this expense is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).projectExpense.delete({ where: { id } });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'delete:ProjectExpense', 'ProjectExpense', id, 'project-expense.deleted', { id }, before, undefined);
      return toJson(deleted);
    });
  }
}
