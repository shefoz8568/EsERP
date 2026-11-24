import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectTaskDto, ProjectTaskUpdateDto } from '@eserp/shared';
import { hoursToMinutes, minutesToHours } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { assertProjectOpenForEntry, getEmployeeOr404, getProjectOr404, logAndPublish } from './helpers';

export interface TaskListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  projectId?: string;
  status?: string;
  assigneeId?: string;
  priority?: string;
}

const INCLUDE = {
  project: { select: { id: true, code: true, name: true, status: true } },
  assignee: { select: { id: true, code: true, name: true } },
};

/**
 * Project tasks (Phase 9). The assignee is an Employee (documented in
 * docs/erd-phase9.md). `actualHours` is computed from APPROVED timesheets
 * on the task — it is never stored.
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Approved minutes per task id (0 when a task has no approved time). */
  private async approvedMinutesByTask(tx: any, tenantId: string, taskIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (taskIds.length === 0) return map;
    const rows: any[] = await tx.timesheet.groupBy({
      by: ['taskId'], where: { tenantId, taskId: { in: taskIds }, status: 'APPROVED' }, _sum: { minutesInt: true },
    });
    for (const r of rows) if (r.taskId) map.set(r.taskId, r._sum.minutesInt ?? 0);
    return map;
  }

  private withActualHours(rows: any[], minutesByTask: Map<string, number>): any[] {
    return rows.map((r) => {
      const minutes = minutesByTask.get(r.id) ?? 0;
      return { ...r, actualMinutes: minutes, actualHours: minutesToHours(minutes) };
    });
  }

  async list(tenantId: string, query: TaskListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.priority) where.priority = query.priority;
    if (query.search) where.title = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, async (tx) => {
      const [t, d] = await Promise.all([
        (tx as any).projectTask.count({ where }),
        (tx as any).projectTask.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]);
      const minutes = await this.approvedMinutesByTask(tx as any, tenantId, d.map((r: any) => r.id));
      return [t, this.withActualHours(d, minutes)] as const;
    });
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, async (tx) => {
      const found = await (tx as any).projectTask.findUnique({ where: { id }, include: INCLUDE });
      if (!found) return null;
      const minutes = await this.approvedMinutesByTask(tx as any, tenantId, [found.id]);
      return this.withActualHours([found], minutes)[0];
    });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Project task not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: ProjectTaskDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const project = await getProjectOr404(tx as any, tenantId, dto.projectId);
      assertProjectOpenForEntry(project);
      if (dto.assigneeId) await getEmployeeOr404(tx as any, tenantId, dto.assigneeId);
      const created = await (tx as any).projectTask.create({
        data: {
          tenantId, projectId: dto.projectId, title: dto.title,
          assigneeId: dto.assigneeId ?? null, status: dto.status,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          estimatedMinutes: dto.estimatedHours != null ? hoursToMinutes(dto.estimatedHours) : null,
          hourlyRateMinor: dto.hourlyRateMinor != null ? BigInt(dto.hourlyRateMinor) : null,
          priority: dto.priority, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'create:ProjectTask', 'ProjectTask', created.id, 'project-task.created', { id: created.id, projectId: dto.projectId }, undefined, created);
      return toJson({ ...created, actualMinutes: 0, actualHours: 0 });
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: ProjectTaskUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).projectTask.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project task not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.assigneeId) await getEmployeeOr404(tx as any, tenantId, dto.assigneeId);
      const data: Record<string, unknown> = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      if (dto.estimatedHours !== undefined) data.estimatedMinutes = dto.estimatedHours != null ? hoursToMinutes(dto.estimatedHours) : null;
      if (dto.hourlyRateMinor !== undefined) data.hourlyRateMinor = dto.hourlyRateMinor != null ? BigInt(dto.hourlyRateMinor) : null;
      if (dto.priority !== undefined) data.priority = dto.priority;
      const updated = await (tx as any).projectTask.update({ where: { id }, data, include: INCLUDE });
      const minutes = await this.approvedMinutesByTask(tx as any, tenantId, [id]);
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'update:ProjectTask', 'ProjectTask', id, 'project-task.updated', { id }, before, updated);
      return toJson(this.withActualHours([updated], minutes)[0]);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).projectTask.findUnique({ where: { id }, include: { _count: { select: { timesheets: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Project task not found');
    if (before._count.timesheets > 0) throw new ConflictException('Task has timesheet entries — remove them first');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).projectTask.delete({ where: { id } });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'delete:ProjectTask', 'ProjectTask', id, 'project-task.deleted', { id }, before, undefined);
      return toJson(deleted);
    });
  }
}
