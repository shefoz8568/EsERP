import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AttendanceBulkDto, AttendanceRecordDto } from '@eserp/shared';
import { workingDaysInMonth } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { StockService } from '../inventory/stock.service';

export interface AttendanceListQuery {
  page?: string;
  pageSize?: string;
  employeeId?: string;
  status?: string;
  from?: string;
  to?: string;
}

const INCLUDE = {
  employee: { select: { id: true, code: true, name: true, departmentId: true } },
};

/**
 * Attendance (Phase 8): daily records + bulk entry + monthly summary.
 * No biometric/hardware integration — records are entered manually or in bulk.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: AttendanceListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).attendanceRecord.count({ where }),
        (tx as any).attendanceRecord.findMany({ where, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  private async assertEmployee(tx: any, tenantId: string, employeeId: string): Promise<void> {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.tenantId !== tenantId) throw new NotFoundException(`Employee not found: ${employeeId}`);
  }

  async create(tenantId: string, actorId: string, dto: AttendanceRecordDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertEmployee(tx as any, tenantId, dto.employeeId);
      const date = new Date(dto.date);
      const existing = await (tx as any).attendanceRecord.findUnique({
        where: { employeeId_date_tenantId: { employeeId: dto.employeeId, date, tenantId } },
      });
      if (existing) throw new ConflictException('An attendance record already exists for this employee on this date');
      const created = await (tx as any).attendanceRecord.create({
        data: {
          tenantId, employeeId: dto.employeeId, date,
          checkIn: dto.checkIn ?? null, checkOut: dto.checkOut ?? null,
          status: dto.status, notes: dto.notes ?? null, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:AttendanceRecord', 'AttendanceRecord', created.id, 'attendance.created', { id: created.id }, undefined, created);
      return toJson(created);
    });
  }

  /** Bulk entry: one day, many employees (upserts by employee + date). */
  async bulk(tenantId: string, actorId: string, dto: AttendanceBulkDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const date = new Date(dto.date);
      const rows: any[] = [];
      for (const r of dto.records) {
        await this.assertEmployee(tx as any, tenantId, r.employeeId);
        const created = await (tx as any).attendanceRecord.upsert({
          where: { employeeId_date_tenantId: { employeeId: r.employeeId, date, tenantId } },
          update: { checkIn: r.checkIn ?? null, checkOut: r.checkOut ?? null, status: r.status, notes: r.notes ?? null },
          create: {
            tenantId, employeeId: r.employeeId, date,
            checkIn: r.checkIn ?? null, checkOut: r.checkOut ?? null,
            status: r.status, notes: r.notes ?? null, createdBy: actorId,
          },
          include: INCLUDE,
        });
        rows.push(created);
      }
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'bulk:AttendanceRecord', 'AttendanceRecord', rows[0]?.id ?? '', 'attendance.bulk', { date: dto.date, count: rows.length });
      return { data: toJson(rows), meta: { total: rows.length } };
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: Partial<AttendanceRecordDto>) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).attendanceRecord.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Attendance record not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).attendanceRecord.update({
        where: { id },
        data: {
          checkIn: dto.checkIn !== undefined ? dto.checkIn : before.checkIn,
          checkOut: dto.checkOut !== undefined ? dto.checkOut : before.checkOut,
          status: dto.status ?? before.status,
          notes: dto.notes !== undefined ? dto.notes : before.notes,
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:AttendanceRecord', 'AttendanceRecord', id, 'attendance.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).attendanceRecord.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Attendance record not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).attendanceRecord.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:AttendanceRecord', 'AttendanceRecord', id, 'attendance.deleted', { id }, before);
      return toJson(deleted);
    });
  }

  /** Monthly summary per employee: present / absent / late / on-leave / holiday days. */
  async monthlySummary(tenantId: string, year: number, month: number, employeeId?: string) {
    const employees: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).employee.findMany({
        where: { tenantId, status: { in: ['ACTIVE', 'ON_LEAVE'] }, ...(employeeId ? { id: employeeId } : {}) },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true },
      }),
    );
    if (employeeId && employees.length === 0) throw new NotFoundException('Employee not found');
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const records: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).attendanceRecord.findMany({
        where: { tenantId, date: { gte: from, lte: to }, ...(employeeId ? { employeeId } : {}) },
        select: { employeeId: true, status: true },
      }),
    );
    const rows = employees.map((e) => {
      const mine = records.filter((r) => r.employeeId === e.id);
      const count = (s: string): number => mine.filter((r) => r.status === s).length;
      return {
        employeeId: e.id,
        code: e.code,
        name: e.name,
        year,
        month,
        workingDays: workingDaysInMonth(year, month),
        present: count('PRESENT'),
        absent: count('ABSENT'),
        late: count('LATE'),
        onLeave: count('ON_LEAVE'),
        holiday: count('HOLIDAY'),
        recorded: mine.length,
      };
    });
    return { data: rows, meta: { total: rows.length } };
  }
}
