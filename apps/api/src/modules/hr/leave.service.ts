import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LeaveRequestDto, LeaveTypeDto, LeaveTypeUpdateDto } from '@eserp/shared';
import { leaveBalance, leaveWorkingDays } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { StockService } from '../inventory/stock.service';

export interface LeaveTypeListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
}

export interface LeaveRequestListQuery {
  page?: string;
  pageSize?: string;
  employeeId?: string;
  leaveTypeId?: string;
  status?: string;
}

const REQUEST_INCLUDE = {
  employee: { select: { id: true, code: true, name: true } },
  leaveType: { select: { id: true, code: true, name: true, daysPerYear: true, paid: true } },
};

/**
 * Leave (Phase 8): types + requests + computed balances. Days are working
 * days only (Fri–Sat weekend excluded). Approval checks the balance and
 * updates it implicitly — balances are computed on read as
 * entitlement − approved days taken in the year.
 */
@Injectable()
export class LeaveService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  // --- Leave types ---

  async listTypes(tenantId: string, query: LeaveTypeListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).leaveType.count({ where }),
        (tx as any).leaveType.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getType(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveType.findUnique({ where: { id } }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Leave type not found');
    return toJson(row);
  }

  async createType(tenantId: string, actorId: string, dto: LeaveTypeDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await (tx as any).leaveType.findUnique({ where: { code_tenantId: { code: dto.code, tenantId } } });
      if (existing) throw new ConflictException(`Leave type code ${dto.code} already exists`);
      const created = await (tx as any).leaveType.create({
        data: { tenantId, code: dto.code, name: dto.name, nameAr: dto.nameAr ?? null, daysPerYear: dto.daysPerYear, paid: dto.paid, status: dto.status, createdBy: actorId },
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:LeaveType', 'LeaveType', created.id, 'leave-type.created', { id: created.id, code: created.code }, undefined, created);
      return toJson(created);
    });
  }

  async updateType(tenantId: string, actorId: string, id: string, dto: LeaveTypeUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveType.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Leave type not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).leaveType.update({
        where: { id },
        data: {
          name: dto.name ?? before.name,
          nameAr: dto.nameAr !== undefined ? dto.nameAr : before.nameAr,
          daysPerYear: dto.daysPerYear ?? before.daysPerYear,
          paid: dto.paid ?? before.paid,
          status: dto.status ?? before.status,
        },
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:LeaveType', 'LeaveType', id, 'leave-type.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  async deleteType(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveType.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Leave type not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const used = await (tx as any).leaveRequest.count({ where: { tenantId, leaveTypeId: id } });
      if (used > 0) throw new ConflictException('Leave type has requests and cannot be deleted');
      const deleted = await (tx as any).leaveType.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:LeaveType', 'LeaveType', id, 'leave-type.deleted', { id }, before);
      return toJson(deleted);
    });
  }

  // --- Leave requests ---

  async listRequests(tenantId: string, query: LeaveRequestListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
    if (query.status) where.status = query.status;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).leaveRequest.count({ where }),
        (tx as any).leaveRequest.findMany({ where, orderBy: { startDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: REQUEST_INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getRequest(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Leave request not found');
    return toJson(row);
  }

  async createRequest(tenantId: string, actorId: string, dto: LeaveRequestDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const employee = await (tx as any).employee.findUnique({ where: { id: dto.employeeId } });
      if (!employee || employee.tenantId !== tenantId) throw new NotFoundException('Employee not found');
      if (employee.status === 'TERMINATED') throw new BadRequestException('Terminated employees cannot request leave');
      const type = await (tx as any).leaveType.findUnique({ where: { id: dto.leaveTypeId } });
      if (!type || type.tenantId !== tenantId) throw new NotFoundException('Leave type not found');
      if (type.status !== 'ACTIVE') throw new BadRequestException(`Leave type ${type.code} is not ACTIVE`);
      const days = leaveWorkingDays(dto.startDate, dto.endDate);
      if (days <= 0) throw new BadRequestException('The requested range contains no working days (Fri–Sat weekend)');
      const overlap = await (tx as any).leaveRequest.findFirst({
        where: {
          tenantId, employeeId: dto.employeeId, status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: new Date(dto.endDate) }, endDate: { gte: new Date(dto.startDate) },
        },
      });
      if (overlap) throw new ConflictException('Employee already has a pending or approved leave overlapping this range');
      const created = await (tx as any).leaveRequest.create({
        data: {
          tenantId, employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId,
          startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), days,
          status: 'PENDING', notes: dto.notes ?? null, createdBy: actorId,
        },
        include: REQUEST_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:LeaveRequest', 'LeaveRequest', created.id, 'leave-request.created', { id: created.id }, undefined, created);
      return toJson(created);
    });
  }

  /** Approved days taken by an employee for a leave type in a calendar year. */
  async approvedDaysTaken(tx: any, tenantId: string, employeeId: string, leaveTypeId: string, year: number): Promise<number> {
    const rows: any[] = await (tx as any).leaveRequest.findMany({
      where: {
        tenantId, employeeId, leaveTypeId, status: 'APPROVED',
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      select: { days: true },
    });
    return rows.reduce((s: number, r: any) => s + r.days, 0);
  }

  async approve(tenantId: string, actorId: string, id: string, approverId?: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveRequest.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Leave request not found');
    if (before.status !== 'PENDING') throw new ConflictException(`Only PENDING requests can be approved — this request is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const type = await (tx as any).leaveType.findUnique({ where: { id: before.leaveTypeId } });
      const year = new Date(before.startDate).getUTCFullYear();
      const taken = await this.approvedDaysTaken(tx as any, tenantId, before.employeeId, before.leaveTypeId, year);
      if (taken + before.days > type.daysPerYear) {
        throw new BadRequestException(
          `Approving this leave would exceed the ${type.daysPerYear}-day yearly entitlement (${taken} days already approved in ${year})`,
        );
      }
      const updated = await (tx as any).leaveRequest.update({
        where: { id },
        data: { status: 'APPROVED', approverId: approverId ?? actorId },
        include: REQUEST_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'approve:LeaveRequest', 'LeaveRequest', id, 'leave-request.approved', { id }, before, updated);
      return toJson(updated);
    });
  }

  async reject(tenantId: string, actorId: string, id: string, approverId?: string) {
    return this.decide(tenantId, actorId, id, 'REJECTED', 'reject:LeaveRequest', 'leave-request.rejected', approverId);
  }

  async cancel(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveRequest.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Leave request not found');
    if (before.status !== 'PENDING' && before.status !== 'APPROVED') {
      throw new ConflictException(`Only PENDING or APPROVED requests can be cancelled — this request is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' }, include: REQUEST_INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'cancel:LeaveRequest', 'LeaveRequest', id, 'leave-request.cancelled', { id }, before, updated);
      return toJson(updated);
    });
  }

  private async decide(tenantId: string, actorId: string, id: string, status: string, action: string, eventType: string, approverId?: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).leaveRequest.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Leave request not found');
    if (before.status !== 'PENDING') throw new ConflictException(`Only PENDING requests can be decided — this request is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).leaveRequest.update({
        where: { id },
        data: { status, approverId: approverId ?? actorId },
        include: REQUEST_INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, action, 'LeaveRequest', id, eventType, { id }, before, updated);
      return toJson(updated);
    });
  }

  // --- Balances (computed) ---

  /**
   * Leave balance per employee per year: entitlement − approved days taken.
   * Computed on read; approval/cancellation move it implicitly.
   */
  async balances(tenantId: string, employeeId: string, year: number) {
    const employee = await this.prisma.withTenant(tenantId, (tx) => (tx as any).employee.findUnique({ where: { id: employeeId } }));
    if (!employee || (employee as any).tenantId !== tenantId) throw new NotFoundException('Employee not found');
    const types: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).leaveType.findMany({ where: { tenantId, status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
    );
    const rows: any[] = [];
    for (const type of types) {
      const taken = await this.prisma.withTenant(tenantId, (tx) => this.approvedDaysTaken(tx as any, tenantId, employeeId, type.id, year));
      rows.push({
        employeeId,
        year,
        leaveTypeId: type.id,
        code: type.code,
        name: type.name,
        daysPerYear: type.daysPerYear,
        approvedDaysTaken: taken,
        balance: leaveBalance(type.daysPerYear, taken),
      });
    }
    return { data: rows, meta: { total: rows.length } };
  }
}
