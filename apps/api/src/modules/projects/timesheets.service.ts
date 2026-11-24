import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TimesheetDto, TimesheetUpdateDto } from '@eserp/shared';
import { hoursToMinutes, minutesToHours } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { assertProjectOpenForEntry, getEmployeeOr404, getProjectOr404, logAndPublish } from './helpers';

export interface TimesheetListQuery {
  page?: string;
  pageSize?: string;
  employeeId?: string;
  projectId?: string;
  taskId?: string;
  status?: string;
  from?: string;
  to?: string;
}

const INCLUDE = {
  employee: { select: { id: true, code: true, name: true, basicSalaryMinor: true } },
  project: { select: { id: true, code: true, name: true, status: true } },
  task: { select: { id: true, title: true, hourlyRateMinor: true } },
};

/**
 * Timesheets (Phase 9). Hours are stored as integer minutes. One entry per
 * employee + project + task + date (the DB unique index covers non-null
 * tasks; the service check below also covers the null-task case, because
 * Postgres treats NULLs as distinct in unique indexes). APPROVED entries
 * are immutable; DRAFT/SUBMITTED entries are editable.
 */
@Injectable()
export class TimesheetsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  private present(row: any): any {
    return { ...row, hours: minutesToHours(row.minutesInt) };
  }

  private async assertNoDuplicate(
    tx: any, tenantId: string, employeeId: string, projectId: string, taskId: string | null, date: Date, selfId?: string,
  ): Promise<void> {
    const existing = await tx.timesheet.findFirst({
      where: { tenantId, employeeId, projectId, taskId, date, ...(selfId ? { id: { not: selfId } } : {}) },
    });
    if (existing) throw new ConflictException('A timesheet entry already exists for this employee, project, task and date');
  }

  async list(tenantId: string, query: TimesheetListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.taskId) where.taskId = query.taskId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).timesheet.count({ where }),
        (tx as any).timesheet.findMany({ where, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data.map((r: any) => this.present(r))), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).timesheet.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Timesheet not found');
    return toJson(this.present(row));
  }

  async create(tenantId: string, actorId: string, dto: TimesheetDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getEmployeeOr404(tx as any, tenantId, dto.employeeId);
      const project = await getProjectOr404(tx as any, tenantId, dto.projectId);
      assertProjectOpenForEntry(project);
      if (dto.taskId) {
        const task = await (tx as any).projectTask.findUnique({ where: { id: dto.taskId } });
        if (!task || task.tenantId !== tenantId) throw new NotFoundException('Project task not found');
        if (task.projectId !== dto.projectId) throw new ConflictException('Task belongs to a different project');
      }
      const date = new Date(dto.date);
      await this.assertNoDuplicate(tx as any, tenantId, dto.employeeId, dto.projectId, dto.taskId ?? null, date);
      const created = await (tx as any).timesheet.create({
        data: {
          tenantId, employeeId: dto.employeeId, projectId: dto.projectId,
          taskId: dto.taskId ?? null, date, minutesInt: hoursToMinutes(dto.hours),
          billable: dto.billable, description: dto.description ?? null,
          status: 'DRAFT', createdBy: actorId,
        },
        include: INCLUDE,
      });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'create:Timesheet', 'Timesheet', created.id, 'timesheet.created', { id: created.id, projectId: dto.projectId }, undefined, created);
      return toJson(this.present(created));
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: TimesheetUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).timesheet.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Timesheet not found');
    if (before.status === 'APPROVED' || before.status === 'REJECTED') {
      throw new ConflictException(`A ${before.status} timesheet entry is locked and cannot be edited`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const taskId = dto.taskId !== undefined ? dto.taskId : before.taskId;
      const date = dto.date ? new Date(dto.date) : before.date;
      if (taskId) {
        const task = await (tx as any).projectTask.findUnique({ where: { id: taskId } });
        if (!task || task.tenantId !== tenantId) throw new NotFoundException('Project task not found');
        if (task.projectId !== before.projectId) throw new ConflictException('Task belongs to a different project');
      }
      await this.assertNoDuplicate(tx as any, tenantId, before.employeeId, before.projectId, taskId ?? null, date, id);
      const data: Record<string, unknown> = {};
      if (dto.taskId !== undefined) data.taskId = dto.taskId;
      if (dto.date !== undefined) data.date = new Date(dto.date);
      if (dto.hours !== undefined) data.minutesInt = hoursToMinutes(dto.hours);
      if (dto.billable !== undefined) data.billable = dto.billable;
      if (dto.description !== undefined) data.description = dto.description;
      const updated = await (tx as any).timesheet.update({ where: { id }, data, include: INCLUDE });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'update:Timesheet', 'Timesheet', id, 'timesheet.updated', { id }, before, updated);
      return toJson(this.present(updated));
    });
  }

  private async transition(tenantId: string, actorId: string, id: string, from: string[], to: string, action: string, event: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).timesheet.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Timesheet not found');
    if (!from.includes(before.status)) {
      throw new ConflictException(`Only ${from.join(' or ')} entries can move to ${to} — this entry is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).timesheet.update({
        where: { id },
        data: { status: to, ...(to === 'APPROVED' ? { approverId: actorId } : {}) },
        include: INCLUDE,
      });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, action, 'Timesheet', id, event, { id }, before, updated);
      return toJson(this.present(updated));
    });
  }

  submit(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, ['DRAFT'], 'SUBMITTED', 'submit:Timesheet', 'timesheet.submitted');
  }

  approve(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, ['DRAFT', 'SUBMITTED'], 'APPROVED', 'approve:Timesheet', 'timesheet.approved');
  }

  reject(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, ['DRAFT', 'SUBMITTED'], 'REJECTED', 'reject:Timesheet', 'timesheet.rejected');
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).timesheet.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Timesheet not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT entries can be deleted — this entry is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).timesheet.delete({ where: { id } });
      await logAndPublish(this.audit, this.outbox, tx as any, tenantId, actorId, 'delete:Timesheet', 'Timesheet', id, 'timesheet.deleted', { id }, before, undefined);
      return toJson(deleted);
    });
  }
}
