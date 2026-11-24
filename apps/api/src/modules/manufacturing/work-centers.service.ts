import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkCenterDto, WorkCenterUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { StockService } from '../inventory/stock.service';

export interface WorkCenterListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
}

/** Work centres (Phase 7): simple cost-rate master, no machine calendars. */
@Injectable()
export class WorkCentersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: WorkCenterListQuery) {
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
        (tx as any).workCenter.count({ where }),
        (tx as any).workCenter.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workCenter.findUnique({ where: { id } }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Work centre not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: WorkCenterDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await (tx as any).workCenter.findUnique({ where: { code_tenantId: { code: dto.code, tenantId } } });
      if (existing) throw new ConflictException(`Work centre code ${dto.code} already exists`);
      const created = await (tx as any).workCenter.create({
        data: { tenantId, code: dto.code, name: dto.name, nameAr: dto.nameAr ?? null, standardCostRateMinor: BigInt(dto.standardCostRateMinor), status: dto.status, createdBy: actorId },
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:WorkCenter', 'WorkCenter', created.id, 'work-center.created', { id: created.id, code: created.code }, undefined, created);
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: WorkCenterUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workCenter.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work centre not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).workCenter.update({
        where: { id },
        data: {
          name: dto.name ?? before.name,
          nameAr: dto.nameAr !== undefined ? dto.nameAr : before.nameAr,
          standardCostRateMinor: dto.standardCostRateMinor !== undefined ? BigInt(dto.standardCostRateMinor) : before.standardCostRateMinor,
          status: dto.status ?? before.status,
        },
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:WorkCenter', 'WorkCenter', id, 'work-center.updated', { id }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).workCenter.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Work centre not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const refs = await Promise.all([
        (tx as any).bomLine.count({ where: { tenantId, workCenterId: id } }),
        (tx as any).workOrderLine.count({ where: { tenantId, workCenterId: id } }),
        (tx as any).workOrderOperation.count({ where: { tenantId, workCenterId: id } }),
      ]);
      if (refs.some((n) => n > 0)) {
        throw new ConflictException('Work centre is referenced by BOM lines, work order lines or operations and cannot be deleted');
      }
      const deleted = await (tx as any).workCenter.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:WorkCenter', 'WorkCenter', id, 'work-center.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
