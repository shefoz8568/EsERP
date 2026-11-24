import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CostCenterDto, CostCenterUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface CostCenterListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
}

@Injectable()
export class CostCentersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: CostCenterListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameAr: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data]: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).costCenter.count({ where }),
        (tx as any).costCenter.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { children: true, journalLines: true } } },
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).costCenter.findUnique({ where: { id }, include: { children: true, _count: { select: { journalLines: true } } } }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Cost centre not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: CostCenterDto) {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.parentId) await this.requireCostCenter(tx, tenantId, dto.parentId);
        const created = await (tx as any).costCenter.create({ data: { tenantId, ...dto, createdBy: actorId } });
        await this.audit.log({ tenantId, actorId, action: 'create:CostCenter', entityType: 'CostCenter', entityId: created.id, after: toJson(created) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'cost-center.created', aggregateId: created.id, payload: { id: created.id, code: created.code }, createdBy: actorId });
        return toJson(created);
      });
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      if ((err as any)?.code === 'P2002') throw new ConflictException('A cost centre with this code already exists in this tenant');
      throw err;
    }
  }

  async update(tenantId: string, actorId: string, id: string, dto: CostCenterUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).costCenter.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Cost centre not found');
    if (dto.parentId) {
      if (dto.parentId === id) throw new ConflictException('A cost centre cannot be its own parent');
      await this.prisma.withTenant(tenantId, (tx) => this.requireCostCenter(tx, tenantId, dto.parentId!));
    }
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const updated = await (tx as any).costCenter.update({ where: { id }, data: dto });
        await this.audit.log({ tenantId, actorId, action: 'update:CostCenter', entityType: 'CostCenter', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'cost-center.updated', aggregateId: id, payload: { id, code: updated.code }, createdBy: actorId });
        return toJson(updated);
      });
    } catch (err) {
      if ((err as any)?.code === 'P2002') throw new ConflictException('A cost centre with this code already exists in this tenant');
      throw err;
    }
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).costCenter.findUnique({ where: { id }, include: { _count: { select: { children: true, journalLines: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Cost centre not found');
    if (before._count.children > 0 || before._count.journalLines > 0) {
      throw new ConflictException('Cannot delete a cost centre that has sub-centres or journal lines');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).costCenter.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:CostCenter', entityType: 'CostCenter', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'cost-center.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }

  private async requireCostCenter(tx: any, tenantId: string, id: string) {
    const row = await tx.costCenter.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Cost centre not found');
  }
}
