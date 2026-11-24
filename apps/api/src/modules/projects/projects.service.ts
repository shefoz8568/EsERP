import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectDto, ProjectUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { assertStatusTransitionAllowed, getCustomerOr404, getUserOr404, logAndPublish } from './helpers';

export interface ProjectListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  billingType?: string;
  customerId?: string;
  managerId?: string;
}

const INCLUDE = {
  customer: { select: { id: true, displayName: true, legalName: true } },
  manager: { select: { id: true, email: true, firstName: true, lastName: true } },
  _count: { select: { tasks: true, timesheets: true, expenses: true, milestones: true } },
};

/**
 * Projects (Phase 9). COMPLETED / CANCELLED are terminal statuses;
 * COMPLETED also locks time and expense entry (see helpers).
 */
@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ProjectListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.billingType) where.billingType = query.billingType;
    if (query.customerId) where.customerId = query.customerId;
    if (query.managerId) where.managerId = query.managerId;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).project.count({ where }),
        (tx as any).project.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).project.findUnique({
        where: { id },
        include: {
          ...INCLUDE,
          tasks: { orderBy: { createdAt: 'asc' }, include: { assignee: { select: { id: true, code: true, name: true } } } },
          milestones: { orderBy: { dueDate: 'asc' } },
        },
      }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Project not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: ProjectDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await (tx as any).project.findUnique({ where: { code_tenantId: { code: dto.code, tenantId } } });
      if (existing) throw new ConflictException(`Project code ${dto.code} already exists`);
      if (dto.customerId) await getCustomerOr404(tx as any, tenantId, dto.customerId);
      if (dto.managerId) await getUserOr404(tx as any, tenantId, dto.managerId);
      if (dto.startDate && dto.dueDate && new Date(dto.dueDate) < new Date(dto.startDate)) {
        throw new BadRequestException('Due date cannot be before the start date');
      }
      const created = await (tx as any).project.create({
        data: {
          tenantId, code: dto.code, name: dto.name, nameAr: dto.nameAr ?? null,
          customerId: dto.customerId ?? null, managerId: dto.managerId ?? null,
          status: dto.status, startDate: dto.startDate ? new Date(dto.startDate) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          budgetMinor: BigInt(dto.budgetMinor), currency: dto.currency,
          billingType: dto.billingType, description: dto.description ?? null, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'create:Project', 'Project', created.id, 'project.created', { id: created.id, code: created.code }, undefined, created);
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: ProjectUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).project.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project not found');
    if (dto.status) assertStatusTransitionAllowed(before.status, dto.status);
    const start = dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : before.startDate;
    const due = dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : before.dueDate;
    if (start && due && due < start) throw new BadRequestException('Due date cannot be before the start date');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.customerId) await getCustomerOr404(tx as any, tenantId, dto.customerId);
      if (dto.managerId) await getUserOr404(tx as any, tenantId, dto.managerId);
      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.nameAr !== undefined) data.nameAr = dto.nameAr;
      if (dto.customerId !== undefined) data.customerId = dto.customerId;
      if (dto.managerId !== undefined) data.managerId = dto.managerId;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      if (dto.budgetMinor !== undefined) data.budgetMinor = BigInt(dto.budgetMinor);
      if (dto.currency !== undefined) data.currency = dto.currency;
      if (dto.billingType !== undefined) data.billingType = dto.billingType;
      if (dto.description !== undefined) data.description = dto.description;
      const updated = await (tx as any).project.update({ where: { id }, data, include: INCLUDE });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'update:Project', 'Project', id, 'project.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).project.findUnique({ where: { id }, include: { _count: { select: { tasks: true, timesheets: true, expenses: true, milestones: true, invoices: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project not found');
    const counts = before._count as Record<string, number>;
    if (Object.values(counts).some((n) => n > 0)) {
      throw new ConflictException('Project has tasks, timesheets, expenses, milestones or invoices — cancel it instead of deleting');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).project.delete({ where: { id } });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'delete:Project', 'Project', id, 'project.deleted', { id }, before, undefined);
      return toJson(deleted);
    });
  }
}
