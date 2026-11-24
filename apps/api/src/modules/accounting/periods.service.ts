import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { periodsOverlap } from '@eserp/shared';
import type { FiscalPeriodDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface PeriodListQuery {
  page?: string;
  pageSize?: string;
  fiscalYear?: string;
  status?: string;
}

/** Allowed status transitions. LOCKED is terminal; CLOSED can be reopened. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['CLOSED', 'LOCKED'],
  CLOSED: ['OPEN', 'LOCKED'],
  LOCKED: [],
};

@Injectable()
export class PeriodsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: PeriodListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.fiscalYear) where.fiscalYear = Number(query.fiscalYear);
    if (query.status) where.status = query.status;
    const [total, data]: any[] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).fiscalPeriod.count({ where }),
        (tx as any).fiscalPeriod.findMany({
          where,
          orderBy: [{ fiscalYear: 'desc' }, { periodNumber: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { _count: { select: { journalEntries: true } } },
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).fiscalPeriod.findUnique({ where: { id }, include: { _count: { select: { journalEntries: true } } } }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Fiscal period not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: FiscalPeriodDto) {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const existing = await (tx as any).fiscalPeriod.findMany({ where: { tenantId } });
        for (const p of existing) {
          if (periodsOverlap({ start: dto.startDate, end: dto.endDate }, { start: p.startDate, end: p.endDate })) {
            throw new BadRequestException(
              `Period overlaps fiscal period ${p.fiscalYear}/${p.periodNumber} (${String(p.startDate).slice(0, 10)} – ${String(p.endDate).slice(0, 10)}) — one open period per date`,
            );
          }
        }
        const created = await (tx as any).fiscalPeriod.create({
          data: { tenantId, fiscalYear: dto.fiscalYear, periodNumber: dto.periodNumber, startDate: new Date(dto.startDate), endDate: new Date(dto.endDate), status: dto.status ?? 'OPEN', createdBy: actorId },
        });
        await this.audit.log({ tenantId, actorId, action: 'create:FiscalPeriod', entityType: 'FiscalPeriod', entityId: created.id, after: toJson(created) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'fiscal-period.created', aggregateId: created.id, payload: { id: created.id, fiscalYear: created.fiscalYear, periodNumber: created.periodNumber }, createdBy: actorId });
        return toJson(created);
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if ((err as any)?.code === 'P2002') throw new ConflictException('A fiscal period with this year and number already exists in this tenant');
      throw err;
    }
  }

  /** Status-only update (close / lock / reopen). LOCKED is terminal. */
  async updateStatus(tenantId: string, actorId: string, id: string, status: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).fiscalPeriod.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Fiscal period not found');
    if (!ALLOWED_TRANSITIONS[before.status]?.includes(status)) {
      throw new ConflictException(`Cannot move a ${before.status} period to ${status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).fiscalPeriod.update({ where: { id }, data: { status } });
      await this.audit.log({ tenantId, actorId, action: 'update:FiscalPeriod', entityType: 'FiscalPeriod', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'fiscal-period.updated', aggregateId: id, payload: { id, status }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).fiscalPeriod.findUnique({ where: { id }, include: { _count: { select: { journalEntries: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Fiscal period not found');
    if (before._count.journalEntries > 0) {
      throw new ConflictException('Cannot delete a fiscal period that has journal entries — close or lock it instead');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).fiscalPeriod.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:FiscalPeriod', entityType: 'FiscalPeriod', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'fiscal-period.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
