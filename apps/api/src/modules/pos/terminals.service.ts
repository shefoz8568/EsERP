import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PosTerminalDto, PosTerminalUpdateDto } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { findAccountByCode } from '../sales/common';

export interface PosTerminalListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  branchId?: string;
}

const INCLUDE = {
  branch: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
};

/**
 * POS terminals (Phase 6): a terminal belongs to a branch and draws stock
 * from one warehouse. The cash/card account codes default to 1010 Cash on
 * Hand and 1030 Card Payments Clearing; they must exist in the tenant's CoA.
 */
@Injectable()
export class PosTerminalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: PosTerminalListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.branchId) where.branchId = query.branchId;
    if (query.search) where.code = { contains: query.search, mode: 'insensitive' };
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).posTerminal.count({ where }),
        (tx as any).posTerminal.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posTerminal.findUnique({ where: { id }, include: { ...INCLUDE, shifts: { orderBy: { openedAt: 'desc' }, take: 5, select: { id: true, status: true, openedAt: true, closedAt: true } } } }),
    );
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('POS terminal not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: PosTerminalDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const branch = await (tx as any).branch.findUnique({ where: { id: dto.branchId } });
      if (!branch || branch.tenantId !== tenantId) throw new NotFoundException('Branch not found');
      const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      const existing = await (tx as any).posTerminal.findUnique({ where: { code_tenantId: { code: dto.code, tenantId } } });
      if (existing) throw new ConflictException(`A POS terminal with code ${dto.code} already exists`);
      // The posting accounts must exist in the tenant's chart of accounts.
      await findAccountByCode(tx as any, tenantId, dto.cashAccountCode);
      await findAccountByCode(tx as any, tenantId, dto.cardAccountCode);
      const created = await (tx as any).posTerminal.create({
        data: { tenantId, ...dto, createdBy: actorId },
        include: INCLUDE,
      });
      await this.audit.log({ tenantId, actorId, action: 'create:PosTerminal', entityType: 'PosTerminal', entityId: created.id, after: toJson(created) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-terminal.created', aggregateId: created.id, payload: { id: created.id, code: created.code }, createdBy: actorId });
      return toJson(created);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: PosTerminalUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).posTerminal.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('POS terminal not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.branchId) {
        const branch = await (tx as any).branch.findUnique({ where: { id: dto.branchId } });
        if (!branch || branch.tenantId !== tenantId) throw new NotFoundException('Branch not found');
      }
      if (dto.warehouseId) {
        const warehouse = await (tx as any).warehouse.findUnique({ where: { id: dto.warehouseId } });
        if (!warehouse || warehouse.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
      }
      if (dto.cashAccountCode) await findAccountByCode(tx as any, tenantId, dto.cashAccountCode);
      if (dto.cardAccountCode) await findAccountByCode(tx as any, tenantId, dto.cardAccountCode);
      const updated = await (tx as any).posTerminal.update({ where: { id }, data: { ...dto }, include: INCLUDE });
      await this.audit.log({ tenantId, actorId, action: 'update:PosTerminal', entityType: 'PosTerminal', entityId: id, before: toJson(before), after: toJson(updated) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-terminal.updated', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).posTerminal.findUnique({ where: { id }, include: { shifts: { select: { id: true } }, sales: { select: { id: true } } } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('POS terminal not found');
    if (before.shifts.length > 0 || before.sales.length > 0) {
      throw new BadRequestException('A terminal with shifts or sales cannot be deleted — set it INACTIVE instead');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).posTerminal.delete({ where: { id } });
      await this.audit.log({ tenantId, actorId, action: 'delete:PosTerminal', entityType: 'PosTerminal', entityId: id, before: toJson(before) }, tx as any);
      await this.outbox.publish(tx as any, { tenantId, eventType: 'pos-terminal.deleted', aggregateId: id, payload: { id }, createdBy: actorId });
      return toJson(deleted);
    });
  }
}
