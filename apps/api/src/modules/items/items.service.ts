import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@eserp/db';
import type { ItemCategoryDto, ItemCategoryUpdateDto, ItemDto, ItemUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export interface ItemListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  categoryId?: string;
  status?: string;
  costingMethod?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function isFkViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

@Injectable()
export class ItemsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // --- Categories ---
  async listCategories(tenantId: string) {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.itemCategory.findMany({ where: { tenantId }, orderBy: { code: 'asc' }, include: { _count: { select: { items: true, children: true } } } }),
    );
    return toJson(rows);
  }

  async getCategory(tenantId: string, id: string) {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.itemCategory.findUnique({ where: { id }, include: { children: true, items: { select: { id: true, sku: true, name: true } } } }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Item category not found');
    return toJson(row);
  }

  async createCategory(tenantId: string, actorId: string, dto: ItemCategoryDto) {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.parentId) await this.requireCategory(tx, tenantId, dto.parentId);
        const created = await tx.itemCategory.create({ data: { tenantId, ...dto, createdBy: actorId } });
        await this.audit.log({ tenantId, actorId, action: 'create:ItemCategory', entityType: 'ItemCategory', entityId: created.id, after: toJson(created) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'item-category.created', aggregateId: created.id, payload: { id: created.id, code: created.code }, createdBy: actorId });
        return toJson(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An item category with this code already exists in this tenant');
      throw err;
    }
  }

  async updateCategory(tenantId: string, actorId: string, id: string, dto: ItemCategoryUpdateDto) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.itemCategory.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Item category not found');
    if (dto.parentId) {
      if (dto.parentId === id) throw new ConflictException('A category cannot be its own parent');
      await this.prisma.withTenant(tenantId, (tx) => this.requireCategory(tx, tenantId, dto.parentId!));
    }
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const updated = await tx.itemCategory.update({ where: { id }, data: dto });
        await this.audit.log({ tenantId, actorId, action: 'update:ItemCategory', entityType: 'ItemCategory', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'item-category.updated', aggregateId: id, payload: { id, code: updated.code }, createdBy: actorId });
        return toJson(updated);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An item category with this code already exists in this tenant');
      throw err;
    }
  }

  async deleteCategory(tenantId: string, actorId: string, id: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) =>
      tx.itemCategory.findUnique({ where: { id }, include: { _count: { select: { items: true, children: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Item category not found');
    if (before._count.items > 0 || before._count.children > 0) {
      throw new ConflictException('Cannot delete a category that still has items or sub-categories');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.itemCategory.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:ItemCategory', entityType: 'ItemCategory', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'item-category.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }

  private async requireCategory(tx: any, tenantId: string, id: string) {
    const row = await tx.itemCategory.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Item category not found');
  }

  private async requireUom(tx: any, tenantId: string, id: string) {
    const row = await tx.unitOfMeasure.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Unit of measure not found');
  }

  private async requireTaxRate(tx: any, tenantId: string, id: string) {
    const row = await tx.taxRate.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Tax rate not found');
  }

  // --- Items ---
  async listItems(tenantId: string, query: ItemListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.status) where.status = query.status;
    if (query.costingMethod) where.costingMethod = query.costingMethod;
    if (query.search) {
      where.OR = ['sku', 'name', 'nameAr', 'barcode', 'description'].map((f) => ({ [f]: { contains: query.search, mode: 'insensitive' } }));
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.item.count({ where }),
        tx.item.findMany({
          where,
          orderBy: { sku: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { category: { select: { id: true, code: true, name: true, nameAr: true } }, defaultUom: { select: { id: true, code: true, name: true } }, taxRate: { select: { id: true, name: true, rateBps: true } } },
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async getItem(tenantId: string, id: string) {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.item.findUnique({ where: { id }, include: { category: true, defaultUom: true, taxRate: true, priceListItems: { include: { priceList: { select: { id: true, name: true, currency: true } } } } } }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Item not found');
    return toJson(row);
  }

  async createItem(tenantId: string, actorId: string, dto: ItemDto) {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.categoryId) await this.requireCategory(tx, tenantId, dto.categoryId);
        await this.requireUom(tx, tenantId, dto.defaultUomId);
        if (dto.taxRateId) await this.requireTaxRate(tx, tenantId, dto.taxRateId);
        const created = await tx.item.create({
          data: {
            tenantId,
            ...dto,
            standardCostMinor: BigInt(dto.standardCostMinor),
            salesPriceMinor: BigInt(dto.salesPriceMinor),
            purchasePriceMinor: BigInt(dto.purchasePriceMinor),
            reorderPoint: BigInt(dto.reorderPoint),
            minStock: BigInt(dto.minStock),
            maxStock: dto.maxStock === undefined || dto.maxStock === null ? null : BigInt(dto.maxStock),
            createdBy: actorId,
          },
        });
        await this.audit.log({ tenantId, actorId, action: 'create:Item', entityType: 'Item', entityId: created.id, after: toJson(created) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'item.created', aggregateId: created.id, payload: { id: created.id, sku: created.sku, name: created.name }, createdBy: actorId });
        return toJson(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An item with this SKU or barcode already exists in this tenant');
      if (isFkViolation(err)) throw new ConflictException('Referenced category, unit of measure or tax rate does not exist');
      throw err;
    }
  }

  async updateItem(tenantId: string, actorId: string, id: string, dto: ItemUpdateDto) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.item.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Item not found');
    const data: Record<string, unknown> = { ...dto };
    for (const f of ['standardCostMinor', 'salesPriceMinor', 'purchasePriceMinor', 'reorderPoint', 'minStock'] as const) {
      if (dto[f] !== undefined) data[f] = BigInt(dto[f]!);
    }
    if (dto.maxStock !== undefined) data.maxStock = dto.maxStock === null ? null : BigInt(dto.maxStock);
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        if (dto.categoryId) await this.requireCategory(tx, tenantId, dto.categoryId);
        if (dto.defaultUomId) await this.requireUom(tx, tenantId, dto.defaultUomId);
        if (dto.taxRateId) await this.requireTaxRate(tx, tenantId, dto.taxRateId);
        const updated = await tx.item.update({ where: { id }, data });
        await this.audit.log({ tenantId, actorId, action: 'update:Item', entityType: 'Item', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
        await this.outbox.publish(tx as any, { tenantId, eventType: 'item.updated', aggregateId: id, payload: { id, sku: updated.sku, name: updated.name }, createdBy: actorId });
        return toJson(updated);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('An item with this SKU or barcode already exists in this tenant');
      if (isFkViolation(err)) throw new ConflictException('Referenced category, unit of measure or tax rate does not exist');
      throw err;
    }
  }

  async deleteItem(tenantId: string, actorId: string, id: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) =>
      tx.item.findUnique({ where: { id }, include: { _count: { select: { priceListItems: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Item not found');
    if (before._count.priceListItems > 0) {
      throw new ConflictException('Cannot delete an item that is on a price list — remove it from the price lists first');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.item.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:Item', entityType: 'Item', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'item.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
