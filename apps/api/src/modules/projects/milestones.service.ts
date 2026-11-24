import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MilestoneDto, MilestoneUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { SalesInvoicesService } from '../sales/invoices.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { getProjectOr404, logAndPublish } from './helpers';

export interface MilestoneListQuery {
  page?: string;
  pageSize?: string;
  projectId?: string;
  status?: string;
}

const INCLUDE = {
  project: { select: { id: true, code: true, name: true, billingType: true, currency: true, customerId: true } },
  invoice: { select: { id: true, number: true, status: true, totalMinor: true } },
};

/**
 * Milestones (Phase 9). Achieving a milestone on a MILESTONE-billed
 * project creates a DRAFT sales invoice (via the Phase 3 invoice service
 * — no invoice logic is duplicated here) and moves the milestone to
 * INVOICED. On FIXED_PRICE / TIME_AND_MATERIALS projects milestones are
 * tracking-only: achieve just flips PENDING -> ACHIEVED.
 */
@Injectable()
export class MilestonesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(SalesInvoicesService) private readonly invoices: SalesInvoicesService,
  ) {}

  async list(tenantId: string, query: MilestoneListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).milestone.count({ where }),
        (tx as any).milestone.findMany({ where, orderBy: { dueDate: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).milestone.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Milestone not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: MilestoneDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getProjectOr404(tx as any, tenantId, dto.projectId);
      const created = await (tx as any).milestone.create({
        data: {
          tenantId, projectId: dto.projectId, title: dto.title,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          amountMinor: BigInt(dto.amountMinor), status: dto.status, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'create:Milestone', 'Milestone', created.id, 'milestone.created', { id: created.id, projectId: dto.projectId }, undefined, created);
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: MilestoneUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).milestone.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Milestone not found');
    if (before.status !== 'PENDING') throw new ConflictException(`Only PENDING milestones can be edited — this milestone is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const data: Record<string, unknown> = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      if (dto.amountMinor !== undefined) data.amountMinor = BigInt(dto.amountMinor);
      const updated = await (tx as any).milestone.update({ where: { id }, data, include: INCLUDE });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'update:Milestone', 'Milestone', id, 'milestone.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  async achieve(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).milestone.findUnique({ where: { id }, include: { project: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Milestone not found');
    if (before.status !== 'PENDING') throw new ConflictException(`Only PENDING milestones can be achieved — this milestone is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const project = before.project as any;
      let invoice: any = null;
      let status = 'ACHIEVED';
      if (project.billingType === 'MILESTONE') {
        if (!project.customerId) {
          throw new BadRequestException('Cannot bill this milestone: the project has no customer');
        }
        if (BigInt(before.amountMinor) <= 0n) {
          throw new BadRequestException('Cannot bill this milestone: its amount is zero');
        }
        invoice = await this.invoices.createForMilestone(tx as any, tenantId, actorId, {
          customerId: project.customerId,
          projectId: project.id,
          title: before.title,
          amountMinor: BigInt(before.amountMinor),
          currency: project.currency,
          invoiceDate: new Date(),
        });
        status = 'INVOICED';
      }
      const updated = await (tx as any).milestone.update({
        where: { id },
        data: { status, invoiceId: invoice ? invoice.id : null },
        include: INCLUDE,
      });
      await logAndPublish(
        this.audit, this.outbox, tx as any, tenantId, actorId, 'achieve:Milestone', 'Milestone', id,
        'milestone.achieved', { id, status, invoiceId: invoice?.id ?? null }, before, updated,
      );
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).milestone.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Milestone not found');
    if (before.status !== 'PENDING') throw new ConflictException(`Only PENDING milestones can be deleted — this milestone is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).milestone.delete({ where: { id } });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'delete:Milestone', 'Milestone', id, 'milestone.deleted', { id }, before, undefined);
      return toJson(deleted);
    });
  }
}
