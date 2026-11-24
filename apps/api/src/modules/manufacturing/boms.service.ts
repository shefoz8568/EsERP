import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BomDto, BomUpdateDto } from '@eserp/shared';
import { bomLineStandardCost, bomStandardCost } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { StockService } from '../inventory/stock.service';

export interface BomListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  finishedItemId?: string;
}

const INCLUDE = {
  finishedItem: { select: { id: true, sku: true, name: true, standardCostMinor: true } },
  lines: {
    orderBy: { lineOrder: 'asc' as const },
    include: {
      componentItem: { select: { id: true, sku: true, name: true, standardCostMinor: true } },
      workCenter: { select: { id: true, code: true, name: true } },
    },
  },
};

/** Attach the computed standard cost (roll-up) to a BOM row. */
function withCost(row: any): any {
  const lines = (row.lines ?? []).map((l: any) => ({
    ...l,
    lineCostMinor: Number(bomLineStandardCost({ standardCostMinor: BigInt(l.componentItem?.standardCostMinor ?? 0), quantityPerUnit: BigInt(l.quantityPerUnit), scrapBps: l.scrapBps })),
  }));
  const standardCostMinor = Number(
    bomStandardCost(
      (row.lines ?? []).map((l: any) => ({
        standardCostMinor: BigInt(l.componentItem?.standardCostMinor ?? 0),
        quantityPerUnit: BigInt(l.quantityPerUnit),
        scrapBps: l.scrapBps,
      })),
    ),
  );
  return { ...row, lines, standardCostMinor };
}

/**
 * BOMs (Phase 7): one ACTIVE version per finished item. The standard cost
 * is a computed roll-up (sum of component standard costs x qty x (1+scrap)),
 * never stored — a later standard-cost change re-rolls the BOM.
 */
@Injectable()
export class BomsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: BomListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.finishedItemId) where.finishedItemId = query.finishedItemId;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).bom.count({ where }),
        (tx as any).bom.findMany({ where, orderBy: [{ finishedItemId: 'asc' }, { version: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    let rows = (data as any[]).map((r) => withCost(toJson(r)));
    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.finishedItem?.sku ?? '').toLowerCase().includes(s) ||
          (r.finishedItem?.name ?? '').toLowerCase().includes(s) ||
          (r.name ?? '').toLowerCase().includes(s),
      );
    }
    return { data: rows, meta: pageMeta(query.search ? rows.length : total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).bom.findUnique({ where: { id }, include: INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('BOM not found');
    return withCost(toJson(row));
  }

  /** Computed standard cost of one finished unit (roll-up) + per-line costs. */
  async cost(tenantId: string, id: string) {
    const bom = await this.get(tenantId, id);
    return {
      bomId: bom.id,
      finishedItemId: bom.finishedItemId,
      version: bom.version,
      status: bom.status,
      standardCostMinor: bom.standardCostMinor,
      lines: bom.lines.map((l: any) => ({ id: l.id, componentItemId: l.componentItemId, quantityPerUnit: l.quantityPerUnit, scrapBps: l.scrapBps, lineCostMinor: l.lineCostMinor })),
    };
  }

  private async validateItems(tx: any, tenantId: string, finishedItemId: string, lines: { componentItemId: string }[]): Promise<void> {
    const finished = await tx.item.findUnique({ where: { id: finishedItemId } });
    if (!finished || finished.tenantId !== tenantId) throw new NotFoundException('Finished item not found');
    if (!finished.trackStock) throw new BadRequestException('The finished item must be a stock-tracked item');
    for (const line of lines) {
      const comp = await tx.item.findUnique({ where: { id: line.componentItemId } });
      if (!comp || comp.tenantId !== tenantId) throw new NotFoundException(`Component item not found: ${line.componentItemId}`);
      if (!comp.trackStock) throw new BadRequestException(`Component ${comp.sku} must be a stock-tracked item`);
      if (comp.id === finishedItemId) throw new BadRequestException('A BOM cannot contain its own finished item as a component');
    }
  }

  private async archiveOtherActive(tx: any, tenantId: string, finishedItemId: string, exceptId?: string): Promise<void> {
    await tx.bom.updateMany({
      where: { tenantId, finishedItemId, status: 'ACTIVE', ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { status: 'ARCHIVED' },
    });
  }

  async create(tenantId: string, actorId: string, dto: BomDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.validateItems(tx as any, tenantId, dto.finishedItemId, dto.lines);
      const dup = await (tx as any).bom.findUnique({ where: { finishedItemId_version_tenantId: { finishedItemId: dto.finishedItemId, version: dto.version, tenantId } } });
      if (dup) throw new ConflictException(`BOM version ${dto.version} already exists for this finished item`);
      if (dto.status === 'ACTIVE') await this.archiveOtherActive(tx as any, tenantId, dto.finishedItemId);
      for (const line of dto.lines) {
        if (line.workCenterId) {
          const wc = await (tx as any).workCenter.findUnique({ where: { id: line.workCenterId } });
          if (!wc || wc.tenantId !== tenantId) throw new NotFoundException(`Work centre not found: ${line.workCenterId}`);
        }
      }
      const created = await (tx as any).bom.create({
        data: {
          tenantId, finishedItemId: dto.finishedItemId, version: dto.version, status: dto.status,
          name: dto.name ?? null, notes: dto.notes ?? null, createdBy: actorId,
          lines: {
            create: dto.lines.map((l, i) => ({
              tenantId, componentItemId: l.componentItemId, quantityPerUnit: BigInt(l.quantityPerUnit),
              scrapBps: l.scrapBps, workCenterId: l.workCenterId ?? null, operationName: l.operationName ?? null,
              lineOrder: i, createdBy: actorId,
            })),
          },
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:Bom', 'Bom', created.id, 'bom.created', { id: created.id, finishedItemId: created.finishedItemId, version: created.version }, undefined, created);
      return withCost(toJson(created));
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: BomUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).bom.findUnique({ where: { id }, include: { lines: true } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('BOM not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.lines !== undefined && before.status !== 'DRAFT') {
        throw new BadRequestException(`Only DRAFT BOMs can change lines — this BOM is ${before.status}`);
      }
      if (dto.status === 'ACTIVE' && before.status === 'ARCHIVED') {
        throw new BadRequestException('An ARCHIVED BOM cannot be re-activated — create a new version instead');
      }
      if (dto.lines !== undefined) await this.validateItems(tx as any, tenantId, before.finishedItemId, dto.lines);
      if (dto.status === 'ACTIVE') await this.archiveOtherActive(tx as any, tenantId, before.finishedItemId, id);
      let updated: any;
      if (dto.lines !== undefined) {
        await (tx as any).bomLine.deleteMany({ where: { tenantId, bomId: id } });
        updated = await (tx as any).bom.update({
          where: { id },
          data: {
            status: dto.status ?? before.status,
            name: dto.name !== undefined ? dto.name : before.name,
            notes: dto.notes !== undefined ? dto.notes : before.notes,
            lines: {
              create: dto.lines.map((l, i) => ({
                tenantId, componentItemId: l.componentItemId, quantityPerUnit: BigInt(l.quantityPerUnit),
                scrapBps: l.scrapBps, workCenterId: l.workCenterId ?? null, operationName: l.operationName ?? null,
                lineOrder: i, createdBy: actorId,
              })),
            },
          },
          include: INCLUDE,
        });
      } else {
        updated = await (tx as any).bom.update({
          where: { id },
          data: {
            status: dto.status ?? before.status,
            name: dto.name !== undefined ? dto.name : before.name,
            notes: dto.notes !== undefined ? dto.notes : before.notes,
          },
          include: INCLUDE,
        });
      }
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:Bom', 'Bom', id, 'bom.updated', { id }, before, updated);
      return withCost(toJson(updated));
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).bom.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('BOM not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT BOMs can be deleted — this BOM is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const used = await (tx as any).workOrder.count({ where: { tenantId, bomId: id } });
      if (used > 0) throw new ConflictException('BOM is referenced by work orders and cannot be deleted');
      const deleted = await (tx as any).bom.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:Bom', 'Bom', id, 'bom.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
