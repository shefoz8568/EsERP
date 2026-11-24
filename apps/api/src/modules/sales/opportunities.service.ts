import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OpportunityDto, OpportunityUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { getContact } from './common';

export interface OpportunityListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  stage?: string;
  customerId?: string;
}

const INCLUDE = {
  customer: { select: { id: true, displayName: true, legalName: true } },
  lead: { select: { id: true, name: true } },
};

@Injectable()
export class OpportunitiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: OpportunityListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.stage) where.stage = query.stage;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search) where.title = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).opportunity.count({ where }),
        (tx as any).opportunity.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).opportunity.findUnique({ where: { id }, include: INCLUDE }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Opportunity not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: OpportunityDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await getContact(tx as any, tenantId, dto.customerId, ['CUSTOMER', 'BOTH']);
      if (dto.leadId) {
        const lead = await (tx as any).lead.findUnique({ where: { id: dto.leadId } });
        if (!lead || lead.tenantId !== tenantId) throw new NotFoundException('Lead not found');
      }
      const created = await (tx as any).opportunity.create({
        data: {
          tenantId,
          ...dto,
          expectedValueMinor: BigInt(dto.expectedValueMinor),
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
          createdBy: actorId,
        },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:Opportunity', entityType: 'Opportunity', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'opportunity.created', aggregateId: created.id, payload: { id: created.id, title: created.title, stage: created.stage }, createdBy: actorId });
      return toJson(created);
    });
  }

  /** Update (stage changes are audited — the before/after snapshot records the move). */
  async update(tenantId: string, actorId: string, id: string, dto: OpportunityUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).opportunity.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Opportunity not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const data: Record<string, unknown> = { ...dto };
      if (dto.expectedValueMinor !== undefined) data.expectedValueMinor = BigInt(dto.expectedValueMinor);
      if (dto.expectedCloseDate !== undefined) data.expectedCloseDate = dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null;
      const updated = await (tx as any).opportunity.update({ where: { id }, data, include: INCLUDE });
      await this.audit.log({ tenantId, actorId, action: 'update:Opportunity', entityType: 'Opportunity', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'opportunity.updated', aggregateId: id, payload: { id, stage: updated.stage }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).opportunity.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Opportunity not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).opportunity.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:Opportunity', entityType: 'Opportunity', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'opportunity.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
