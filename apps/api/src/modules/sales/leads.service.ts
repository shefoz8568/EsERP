import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LeadDto, LeadUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface LeadListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  source?: string;
}

@Injectable()
export class LeadsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: LeadListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).lead.count({ where }),
        (tx as any).lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { contact: { select: { id: true, displayName: true } } } }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).lead.findUnique({ where: { id }, include: { contact: { select: { id: true, displayName: true } }, opportunities: { select: { id: true, title: true, stage: true } } } }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Lead not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: LeadDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.contactId) {
        const contact = await (tx as any).contact.findUnique({ where: { id: dto.contactId } });
        if (!contact || contact.tenantId !== tenantId) throw new NotFoundException('Contact not found');
      }
      const created = await (tx as any).lead.create({
        data: { tenantId, ...dto, expectedValueMinor: BigInt(dto.expectedValueMinor), createdBy: actorId },
      });
      await this.audit.log({ tenantId, actorId, action: 'create:Lead', entityType: 'Lead', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'lead.created', aggregateId: created.id, payload: { id: created.id, name: created.name }, createdBy: actorId });
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: LeadUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).lead.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Lead not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const data: Record<string, unknown> = { ...dto };
      if (dto.expectedValueMinor !== undefined) data.expectedValueMinor = BigInt(dto.expectedValueMinor);
      const updated = await (tx as any).lead.update({ where: { id }, data });
      await this.audit.log({ tenantId, actorId, action: 'update:Lead', entityType: 'Lead', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'lead.updated', aggregateId: id, payload: { id, status: updated.status }, createdBy: actorId });
      return toJson(updated);
    });
  }

  /**
   * Convert a lead into a customer Contact. The lead's name/company become
   * the contact's display/legal name; the lead keeps contactId pointing at
   * the new contact and its status becomes QUALIFIED.
   */
  async convert(tenantId: string, actorId: string, id: string) {
    const lead: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).lead.findUnique({ where: { id } }));
    if (!lead || lead.tenantId !== tenantId) throw new NotFoundException('Lead not found');
    if (lead.contactId) {
      const existing = await this.prisma.withTenant(tenantId, (tx) => (tx as any).contact.findUnique({ where: { id: lead.contactId } }));
      if (existing) return toJson(existing);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const contact = await (tx as any).contact.create({
        data: {
          tenantId,
          type: 'CUSTOMER',
          legalName: lead.company || lead.name,
          displayName: lead.name,
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          notes: lead.notes ?? null,
          creditLimitMinor: 0n,
          creditLimitCurrency: lead.expectedValueCurrency,
          createdBy: actorId,
        },
      });
      const updated = await (tx as any).lead.update({ where: { id }, data: { contactId: contact.id, status: 'QUALIFIED' } });
      await this.audit.log({ tenantId, actorId, action: 'convert:Lead', entityType: 'Lead', entityId: id, before: toJson(lead), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'lead.converted', aggregateId: id, payload: { id, contactId: contact.id }, createdBy: actorId });
      return toJson(contact);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).lead.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Lead not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).lead.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:Lead', entityType: 'Lead', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'lead.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
