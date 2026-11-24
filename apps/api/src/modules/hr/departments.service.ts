import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DepartmentDto, DepartmentUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { StockService } from '../inventory/stock.service';

export interface DepartmentListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  parentId?: string;
}

const INCLUDE = {
  parent: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, code: true, name: true, jobTitle: true } },
  _count: { select: { employees: true, children: true } },
};

/** Departments (Phase 8): hierarchy + optional manager (employee link). */
@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: DepartmentListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.parentId) where.parentId = query.parentId;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).department.count({ where }),
        (tx as any).department.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).department.findUnique({ where: { id }, include: INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Department not found');
    return toJson(row);
  }

  private async validateRefs(tx: any, tenantId: string, parentId?: string | null, managerId?: string | null, selfId?: string): Promise<void> {
    if (parentId) {
      if (selfId && parentId === selfId) throw new ConflictException('A department cannot be its own parent');
      const parent = await tx.department.findUnique({ where: { id: parentId } });
      if (!parent || parent.tenantId !== tenantId) throw new NotFoundException('Parent department not found');
    }
    if (managerId) {
      const manager = await tx.employee.findUnique({ where: { id: managerId } });
      if (!manager || manager.tenantId !== tenantId) throw new NotFoundException('Manager employee not found');
    }
  }

  async create(tenantId: string, actorId: string, dto: DepartmentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await (tx as any).department.findUnique({ where: { code_tenantId: { code: dto.code, tenantId } } });
      if (existing) throw new ConflictException(`Department code ${dto.code} already exists`);
      await this.validateRefs(tx as any, tenantId, dto.parentId ?? null, dto.managerId ?? null);
      const created = await (tx as any).department.create({
        data: { tenantId, code: dto.code, name: dto.name, nameAr: dto.nameAr ?? null, parentId: dto.parentId ?? null, managerId: dto.managerId ?? null, status: dto.status, createdBy: actorId },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:Department', 'Department', created.id, 'department.created', { id: created.id, code: created.code }, undefined, created);
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: DepartmentUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).department.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Department not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.validateRefs(
        tx as any,
        tenantId,
        dto.parentId !== undefined ? dto.parentId : before.parentId,
        dto.managerId !== undefined ? dto.managerId : before.managerId,
        id,
      );
      const updated = await (tx as any).department.update({
        where: { id },
        data: {
          name: dto.name ?? before.name,
          nameAr: dto.nameAr !== undefined ? dto.nameAr : before.nameAr,
          parentId: dto.parentId !== undefined ? dto.parentId : before.parentId,
          managerId: dto.managerId !== undefined ? dto.managerId : before.managerId,
          status: dto.status ?? before.status,
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:Department', 'Department', id, 'department.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).department.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Department not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [employees, children] = await Promise.all([
        (tx as any).employee.count({ where: { tenantId, departmentId: id } }),
        (tx as any).department.count({ where: { tenantId, parentId: id } }),
      ]);
      if (employees > 0 || children > 0) {
        throw new ConflictException('Department has employees or sub-departments and cannot be deleted');
      }
      const deleted = await (tx as any).department.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:Department', 'Department', id, 'department.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
