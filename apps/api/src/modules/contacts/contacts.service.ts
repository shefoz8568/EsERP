import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@eserp/db';
import type { ContactDto, ContactUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface ContactListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  type?: string;
  status?: string;
}

const SEARCH_FIELDS = ['legalName', 'legalNameAr', 'displayName', 'email', 'taxNumber', 'commercialRegistration'] as const;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class ContactsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ContactListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = SEARCH_FIELDS.map((f) => ({ [f]: { contains: query.search, mode: 'insensitive' } }));
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.contact.count({ where }),
        tx.contact.findMany({ where, orderBy: { displayName: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findUnique({ where: { id } }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Contact not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: ContactDto) {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const created = await tx.contact.create({
          data: { tenantId, ...dto, creditLimitMinor: BigInt(dto.creditLimitMinor), createdBy: actorId },
        });
        await this.audit.log({ tenantId, actorId, action: 'create:Contact', entityType: 'Contact', entityId: created.id, after: toJson(created) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'contact.created', aggregateId: created.id, payload: { id: created.id, type: created.type, displayName: created.displayName }, createdBy: actorId });
        return toJson(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A contact with this tax number or email already exists in this tenant');
      throw err;
    }
  }

  async update(tenantId: string, actorId: string, id: string, dto: ContactUpdateDto) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Contact not found');
    const data: Record<string, unknown> = { ...dto };
    if (dto.creditLimitMinor !== undefined) data.creditLimitMinor = BigInt(dto.creditLimitMinor);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const updated = await tx.contact.update({ where: { id }, data });
        await this.audit.log({ tenantId, actorId, action: 'update:Contact', entityType: 'Contact', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'contact.updated', aggregateId: id, payload: { id, type: updated.type, displayName: updated.displayName }, createdBy: actorId });
        return toJson(updated);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A contact with this tax number or email already exists in this tenant');
      throw err;
    }
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.contact.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Contact not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.contact.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:Contact', entityType: 'Contact', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'contact.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
