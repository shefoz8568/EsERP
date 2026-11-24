import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@eserp/db';
import type { PriceListDto, PriceListItemDto, PriceListUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface PriceListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  currency?: string;
  isDefault?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class PriceListsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: PriceListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.currency) where.currency = query.currency;
    if (query.isDefault !== undefined) where.isDefault = query.isDefault === 'true';
    if (query.search) where.OR = ['name', 'nameAr'].map((f) => ({ [f]: { contains: query.search, mode: 'insensitive' } }));
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.priceList.count({ where }),
        tx.priceList.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { items: true } } } }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.priceList.findUnique({
        where: { id },
        include: { items: { include: { item: { select: { id: true, sku: true, name: true, nameAr: true, salesPriceMinor: true, salesPriceCurrency: true } } }, orderBy: { item: { sku: 'asc' } } } },
      }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Price list not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: PriceListDto) {
    const data = { ...dto, validFrom: dto.validFrom ? new Date(dto.validFrom) : null, validTo: dto.validTo ? new Date(dto.validTo) : null };
    if (data.validFrom && data.validTo && data.validTo < data.validFrom) {
      throw new ConflictException('validTo must be on or after validFrom');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (data.isDefault) await tx.priceList.updateMany({ where: { tenantId }, data: { isDefault: false } });
      const created = await tx.priceList.create({ data: { tenantId, ...data, createdBy: actorId } });
      await this.audit.log({ tenantId, actorId, action: 'create:PriceList', entityType: 'PriceList', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pricelist.created', aggregateId: created.id, payload: { id: created.id, name: created.name }, createdBy: actorId });
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: PriceListUpdateDto) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.priceList.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Price list not found');
    const data: Record<string, unknown> = { ...dto };
    if (dto.validFrom !== undefined) data.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    if (dto.validTo !== undefined) data.validTo = dto.validTo ? new Date(dto.validTo) : null;
    const validFrom = (data.validFrom as Date | undefined) ?? before.validFrom ?? undefined;
    const validTo = (data.validTo as Date | undefined) ?? before.validTo ?? undefined;
    if (validFrom && validTo && validTo < validFrom) throw new ConflictException('validTo must be on or after validFrom');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.isDefault) await tx.priceList.updateMany({ where: { tenantId, id: { not: id } }, data: { isDefault: false } });
      const updated = await tx.priceList.update({ where: { id }, data });
      await this.audit.log({ tenantId, actorId, action: 'update:PriceList', entityType: 'PriceList', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pricelist.updated', aggregateId: id, payload: { id, name: updated.name }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.priceList.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Price list not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      // PriceListItem rows cascade-delete with the list.
      const deleted = await tx.priceList.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:PriceList', entityType: 'PriceList', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pricelist.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }

  // --- Price list lines ---
  async addItem(tenantId: string, actorId: string, priceListId: string, dto: PriceListItemDto) {
    const list = await this.prisma.withTenant(tenantId, (tx) => tx.priceList.findUnique({ where: { id: priceListId } }));
    if (!list || list.tenantId !== tenantId) throw new NotFoundException('Price list not found');
    const item = await this.prisma.withTenant(tenantId, (tx) => tx.item.findUnique({ where: { id: dto.itemId } }));
    if (!item || item.tenantId !== tenantId) throw new NotFoundException('Item not found');
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const created = await tx.priceListItem.create({
          data: { tenantId, priceListId, itemId: dto.itemId, priceMinor: BigInt(dto.priceMinor), minQuantity: BigInt(dto.minQuantity), createdBy: actorId },
        });
        await this.audit.log({ tenantId, actorId, action: 'create:PriceListItem', entityType: 'PriceListItem', entityId: created.id, after: toJson(created) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'pricelist.item-added', aggregateId: priceListId, payload: { priceListId, itemId: dto.itemId, priceMinor: dto.priceMinor }, createdBy: actorId });
        return toJson(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This item already has a price at this minimum quantity on this price list');
      throw err;
    }
  }

  async removeItem(tenantId: string, actorId: string, priceListId: string, lineId: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.priceListItem.findUnique({ where: { id: lineId } }));
    if (!before || before.tenantId !== tenantId || before.priceListId !== priceListId) throw new NotFoundException('Price list line not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.priceListItem.delete({ where: { id: lineId } });
      await this.audit.log({ tenantId, actorId, action: 'delete:PriceListItem', entityType: 'PriceListItem', entityId: lineId, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pricelist.item-removed', aggregateId: priceListId, payload: { priceListId, itemId: before.itemId }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
