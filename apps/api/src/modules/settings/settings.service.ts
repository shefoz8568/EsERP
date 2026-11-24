import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppError } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  private async audited<T>(tenantId: string, actorId: string, action: string, entityType: string, entityId: string | undefined, fn: (tx: any) => Promise<T>, before?: unknown, after?: unknown): Promise<T> {
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const out = await fn(tx);
      await this.audit.log({ tenantId, actorId, action, entityType, entityId, before, after }, tx as any);
      return out;
    });
    return result;
  }

  // --- Company profile ---
  async getCompany(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.companyProfile.findUnique({ where: { tenantId } }));
  }
  async updateCompany(tenantId: string, actorId: string, dto: Record<string, unknown>) {
    const before = await this.getCompany(tenantId);
    return this.audited(tenantId, actorId, 'update:CompanyProfile', 'CompanyProfile', before?.id, async (tx) =>
      tx.companyProfile.upsert({ where: { tenantId }, update: dto, create: { tenantId, ...dto } }), before, dto);
  }

  // --- Chart of accounts (read-only; seeded from the Saudi template) ---
  async listChartOfAccounts(tenantId: string) {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.chartOfAccounts.findMany({
        where: { tenantId },
        orderBy: { code: 'asc' },
        include: { _count: { select: { children: true } } },
      }),
    );
    // Leaf accounts (no children) are the posting accounts.
    return rows.map((r: any) => ({ ...r, isPosting: r._count.children === 0 }));
  }

  // --- Currencies (default currency cannot be deleted) ---
  async listCurrencies(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.currency.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }));
  }
  async createCurrency(tenantId: string, actorId: string, dto: { code: string; name: string; symbol?: string; isDefault?: boolean }) {
    return this.audited(tenantId, actorId, 'create:Currency', 'Currency', undefined, async (tx) => {
      if (dto.isDefault) await tx.currency.updateMany({ where: { tenantId }, data: { isDefault: false } });
      return tx.currency.create({ data: { tenantId, ...dto } });
    }, undefined, dto);
  }
  async deleteCurrency(tenantId: string, actorId: string, id: string) {
    const cur = await this.prisma.withTenant(tenantId, (tx) => tx.currency.findUnique({ where: { id } }));
    if (!cur || cur.tenantId !== tenantId) throw new NotFoundException('Currency not found');
    if (cur.isDefault) throw new AppError('DEFAULT_CURRENCY', 'The default currency cannot be deleted', 400);
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });
    if (tenant?.defaultCurrency === cur.code) throw new AppError('DEFAULT_CURRENCY', 'The tenant default currency cannot be deleted', 400);
    return this.audited(tenantId, actorId, 'delete:Currency', 'Currency', id, async (tx) => tx.currency.delete({ where: { id } }), cur, undefined);
  }

  // --- Taxes ---
  async listTaxes(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.taxRate.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }));
  }
  async createTax(tenantId: string, actorId: string, dto: { name: string; nameAr?: string; rateBps: number; type?: string; isInclusive?: boolean; isDefault?: boolean }) {
    return this.audited(tenantId, actorId, 'create:TaxRate', 'TaxRate', undefined, async (tx) => tx.taxRate.create({ data: { tenantId, ...dto } }), undefined, dto);
  }
  async updateTax(tenantId: string, actorId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.taxRate.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Tax rate not found');
    return this.audited(tenantId, actorId, 'update:TaxRate', 'TaxRate', id, async (tx) => tx.taxRate.update({ where: { id }, data: dto }), before, dto);
  }
  async deleteTax(tenantId: string, actorId: string, id: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.taxRate.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Tax rate not found');
    return this.audited(tenantId, actorId, 'delete:TaxRate', 'TaxRate', id, async (tx) => tx.taxRate.delete({ where: { id } }), before, undefined);
  }

  // --- Units of measure ---
  async listUnits(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.unitOfMeasure.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }));
  }
  async createUnit(tenantId: string, actorId: string, dto: { code: string; name: string; nameAr?: string; baseUnitCode?: string }) {
    return this.audited(tenantId, actorId, 'create:UnitOfMeasure', 'UnitOfMeasure', undefined, async (tx) => tx.unitOfMeasure.create({ data: { tenantId, ...dto } }), undefined, dto);
  }
  async createConversion(tenantId: string, actorId: string, dto: { fromUomId: string; toUomId: string; factorNumerator: number; factorDenominator?: number }) {
    return this.audited(tenantId, actorId, 'create:UomConversion', 'UomConversion', undefined, async (tx) =>
      tx.uomConversion.create({ data: { tenantId, fromUomId: dto.fromUomId, toUomId: dto.toUomId, factorNumerator: BigInt(dto.factorNumerator), factorDenominator: BigInt(dto.factorDenominator ?? 1) } }), undefined, dto);
  }

  // --- Numbering series ---
  async listSeries(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.numberingSeries.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }));
  }
  async createSeries(tenantId: string, actorId: string, dto: { code: string; name: string; pattern: string; nextNumber?: number; prefix?: string; suffix?: string }) {
    return this.audited(tenantId, actorId, 'create:NumberingSeries', 'NumberingSeries', undefined, async (tx) => tx.numberingSeries.create({ data: { tenantId, ...dto } }), undefined, dto);
  }
  async updateSeries(tenantId: string, actorId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.numberingSeries.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Numbering series not found');
    return this.audited(tenantId, actorId, 'update:NumberingSeries', 'NumberingSeries', id, async (tx) => tx.numberingSeries.update({ where: { id }, data: dto }), before, dto);
  }

  // --- Warehouses & branches ---
  async listWarehouses(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.warehouse.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }));
  }
  async createWarehouse(tenantId: string, actorId: string, dto: { name: string; nameAr?: string; code?: string; address?: string; city?: string; isDefault?: boolean }) {
    return this.audited(tenantId, actorId, 'create:Warehouse', 'Warehouse', undefined, async (tx) => {
      if (dto.isDefault) await tx.warehouse.updateMany({ where: { tenantId }, data: { isDefault: false } });
      return tx.warehouse.create({ data: { tenantId, ...dto } });
    }, undefined, dto);
  }
  async updateWarehouse(tenantId: string, actorId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.warehouse.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
    return this.audited(tenantId, actorId, 'update:Warehouse', 'Warehouse', id, async (tx) => tx.warehouse.update({ where: { id }, data: dto }), before, dto);
  }
  async deleteWarehouse(tenantId: string, actorId: string, id: string) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.warehouse.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Warehouse not found');
    if (before.isDefault) throw new ConflictException('The default warehouse cannot be deleted');
    return this.audited(tenantId, actorId, 'delete:Warehouse', 'Warehouse', id, async (tx) => tx.warehouse.delete({ where: { id } }), before, undefined);
  }
  async listBranches(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.branch.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }));
  }
  async createBranch(tenantId: string, actorId: string, dto: { name: string; nameAr?: string; code?: string; city?: string; isDefault?: boolean }) {
    return this.audited(tenantId, actorId, 'create:Branch', 'Branch', undefined, async (tx) => {
      if (dto.isDefault) await tx.branch.updateMany({ where: { tenantId }, data: { isDefault: false } });
      return tx.branch.create({ data: { tenantId, ...dto } });
    }, undefined, dto);
  }
  async updateBranch(tenantId: string, actorId: string, id: string, dto: Record<string, unknown>) {
    const before = await this.prisma.withTenant(tenantId, (tx) => tx.branch.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Branch not found');
    return this.audited(tenantId, actorId, 'update:Branch', 'Branch', id, async (tx) => tx.branch.update({ where: { id }, data: dto }), before, dto);
  }
}
