import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeDto, EmployeeUpdateDto } from '@eserp/shared';
import { maskSensitive } from '@eserp/shared';
import { fieldEncryptor } from '@eserp/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { StockService } from '../inventory/stock.service';

export interface EmployeeListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  departmentId?: string;
  nationality?: string;
}

const INCLUDE = {
  department: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
};

/**
 * Employees (Phase 8). Termination sets status + end date; terminated
 * employees stay readable for history.
 *
 * Phase 11 — field encryption: national ID / Iqama + IBAN are stored
 * AES-256-GCM encrypted ("enc1:..." values, see @eserp/db encryption.ts)
 * whenever ENCRYPTION_KEY is configured. API responses return MASKED values
 * (`****1234`) unless the caller has `hr:read-sensitive`; audit snapshots
 * always carry the stored (encrypted) form, never plaintext. Search by
 * national ID is no longer supported once values are encrypted (ciphertext
 * is not searchable) — search covers code + name only.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  /** Present one stored sensitive value: full plaintext only for privileged callers. */
  private present(value: string | null | undefined, canReadSensitive: boolean): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (!canReadSensitive) {
      try {
        return maskSensitive(fieldEncryptor().decrypt(value));
      } catch {
        return '****'; // encrypted but no key available — never leak ciphertext
      }
    }
    try {
      return fieldEncryptor().decrypt(value);
    } catch {
      return '****';
    }
  }

  private presentRow(row: Record<string, unknown>, canReadSensitive: boolean): Record<string, unknown> {
    return {
      ...row,
      nationalId: this.present(row.nationalId as string | null | undefined, canReadSensitive),
      iban: this.present(row.iban as string | null | undefined, canReadSensitive),
    };
  }

  async list(tenantId: string, query: EmployeeListQuery, canReadSensitive = false) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.nationality) where.nationality = query.nationality;
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).employee.count({ where }),
        (tx as any).employee.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: (data as Record<string, unknown>[]).map((r) => toJson(this.presentRow(r, canReadSensitive))), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string, canReadSensitive = false) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).employee.findUnique({ where: { id }, include: INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Employee not found');
    return toJson(this.presentRow(row, canReadSensitive));
  }

  private async validateRefs(tx: any, tenantId: string, dto: { departmentId?: string; branchId?: string | null; userId?: string | null }, selfId?: string): Promise<void> {
    if (dto.departmentId) {
      const dept = await tx.department.findUnique({ where: { id: dto.departmentId } });
      if (!dept || dept.tenantId !== tenantId) throw new NotFoundException('Department not found');
    }
    if (dto.branchId) {
      const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
      if (!branch || branch.tenantId !== tenantId) throw new NotFoundException('Branch not found');
    }
    if (dto.userId) {
      const user = await tx.user.findUnique({ where: { id: dto.userId } });
      if (!user || user.tenantId !== tenantId) throw new NotFoundException('User not found');
      const linked = await tx.employee.findFirst({ where: { tenantId, userId: dto.userId, ...(selfId ? { id: { not: selfId } } : {}) } });
      if (linked) throw new ConflictException('This user is already linked to another employee');
    }
  }

  async create(tenantId: string, actorId: string, dto: EmployeeDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await (tx as any).employee.findUnique({ where: { code_tenantId: { code: dto.code, tenantId } } });
      if (existing) throw new ConflictException(`Employee code ${dto.code} already exists`);
      await this.validateRefs(tx as any, tenantId, dto);
      const created = await (tx as any).employee.create({
        data: {
          tenantId, code: dto.code, name: dto.name, nameAr: dto.nameAr ?? null,
          nationalId: fieldEncryptor().encrypt(dto.nationalId ?? null), jobTitle: dto.jobTitle, departmentId: dto.departmentId,
          branchId: dto.branchId ?? null, hireDate: new Date(dto.hireDate), status: dto.status,
          basicSalaryMinor: BigInt(dto.basicSalaryMinor), housingAllowanceMinor: BigInt(dto.housingAllowanceMinor),
          transportAllowanceMinor: BigInt(dto.transportAllowanceMinor), otherAllowanceMinor: BigInt(dto.otherAllowanceMinor),
          currency: dto.currency, bankName: dto.bankName ?? null, iban: fieldEncryptor().encrypt(dto.iban ?? null),
          gosiNumber: dto.gosiNumber ?? null, nationality: dto.nationality,
          dependentsCount: dto.dependentsCount, userId: dto.userId ?? null, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:Employee', 'Employee', created.id, 'employee.created', { id: created.id, code: created.code }, undefined, created);
      return toJson(this.presentRow(created, false));
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: EmployeeUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).employee.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Employee not found');
    if (dto.status === 'TERMINATED') {
      throw new BadRequestException('Use the terminate endpoint to end employment (it sets the end date)');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.validateRefs(
        tx as any,
        tenantId,
        {
          departmentId: dto.departmentId ?? before.departmentId,
          branchId: dto.branchId !== undefined ? dto.branchId : before.branchId,
          userId: dto.userId !== undefined ? dto.userId : before.userId,
        },
        id,
      );
      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.nameAr !== undefined) data.nameAr = dto.nameAr;
      if (dto.nationalId !== undefined) data.nationalId = fieldEncryptor().encrypt(dto.nationalId);
      if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
      if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
      if (dto.branchId !== undefined) data.branchId = dto.branchId;
      if (dto.hireDate !== undefined) data.hireDate = new Date(dto.hireDate);
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.basicSalaryMinor !== undefined) data.basicSalaryMinor = BigInt(dto.basicSalaryMinor);
      if (dto.housingAllowanceMinor !== undefined) data.housingAllowanceMinor = BigInt(dto.housingAllowanceMinor);
      if (dto.transportAllowanceMinor !== undefined) data.transportAllowanceMinor = BigInt(dto.transportAllowanceMinor);
      if (dto.otherAllowanceMinor !== undefined) data.otherAllowanceMinor = BigInt(dto.otherAllowanceMinor);
      if (dto.currency !== undefined) data.currency = dto.currency;
      if (dto.bankName !== undefined) data.bankName = dto.bankName;
      if (dto.iban !== undefined) data.iban = fieldEncryptor().encrypt(dto.iban);
      if (dto.gosiNumber !== undefined) data.gosiNumber = dto.gosiNumber;
      if (dto.nationality !== undefined) data.nationality = dto.nationality;
      if (dto.dependentsCount !== undefined) data.dependentsCount = dto.dependentsCount;
      if (dto.userId !== undefined) data.userId = dto.userId;
      const updated = await (tx as any).employee.update({ where: { id }, data, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'update:Employee', 'Employee', id, 'employee.updated', { id }, before, updated);
      return toJson(this.presentRow(updated, false));
    });
  }

  /** Terminate: sets status TERMINATED + end date; the record stays readable. */
  async terminate(tenantId: string, actorId: string, id: string, endDate: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).employee.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Employee not found');
    if (before.status === 'TERMINATED') throw new ConflictException('Employee is already terminated');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).employee.update({
        where: { id },
        data: { status: 'TERMINATED', endDate: new Date(endDate) },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'terminate:Employee', 'Employee', id, 'employee.terminated', { id }, before, updated);
      return toJson(this.presentRow(updated, false));
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).employee.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Employee not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [leaves, attendance, payrollLines, managed] = await Promise.all([
        (tx as any).leaveRequest.count({ where: { tenantId, employeeId: id } }),
        (tx as any).attendanceRecord.count({ where: { tenantId, employeeId: id } }),
        (tx as any).payrollLine.count({ where: { tenantId, employeeId: id } }),
        (tx as any).department.count({ where: { tenantId, managerId: id } }),
      ]);
      if (leaves > 0 || attendance > 0 || payrollLines > 0 || managed > 0) {
        throw new ConflictException('Employee has leave, attendance, payroll or department-manager history — terminate instead of deleting');
      }
      const deleted = await (tx as any).employee.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:Employee', 'Employee', id, 'employee.deleted', { id }, before);
      return toJson(this.presentRow(deleted, false));
    });
  }
}
