import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PayrollCalculateDto, PayrollPayDto, PayrollRunDto } from '@eserp/shared';
import { calculatePayrollLine, workingDaysInMonth } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';
import { COA, findAccountByCode } from '../sales/common';
import { StockService } from '../inventory/stock.service';

export interface PayrollRunListQuery {
  page?: string;
  pageSize?: string;
  status?: string;
  periodYear?: string;
  periodMonth?: string;
}

const INCLUDE = {
  lines: {
    orderBy: { employeeId: 'asc' as const },
    include: { employee: { select: { id: true, code: true, name: true, nationality: true } } },
  },
};

/**
 * Payroll (Phase 8, Saudi rules).
 *
 * Calculation is deterministic from the employee master + attendance:
 * absent days deduct pro-rata basic (basic x absent / working days).
 * GOSI: Saudi 9.75% employee + 11.75% employer on basic + housing (capped
 * at SAR 45,000); non-Saudi 2% employer hazards only. EOSB accrues monthly
 * at half a month's wage per year (< 5 years) or a full month (>= 5 years).
 *
 * Role split: HR calculates (payroll:manage); the Accountant approves and
 * pays (payroll:approve). APPROVED locks the run. Paying posts two entries:
 * the accrual (Dr Salaries / Dr GOSI Employer / Dr EOSB Expense / Cr GOSI
 * Payable / Cr Net Salaries Payable / Cr EOS Provision / Cr Other
 * Deductions Payable) and the bank payment (Dr Net Salaries Payable /
 * Cr Bank).
 */
@Injectable()
export class PayrollService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}

  async list(tenantId: string, query: PayrollRunListQuery) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.periodYear) where.periodYear = Number(query.periodYear);
    if (query.periodMonth) where.periodMonth = Number(query.periodMonth);
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).payrollRun.count({ where }),
        (tx as any).payrollRun.findMany({ where, orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: INCLUDE }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async get(tenantId: string, id: string) {
    const row: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).payrollRun.findUnique({ where: { id }, include: INCLUDE }));
    if (!row || row.tenantId !== tenantId) throw new NotFoundException('Payroll run not found');
    return toJson(row);
  }

  async create(tenantId: string, actorId: string, dto: PayrollRunDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await (tx as any).payrollRun.findUnique({
        where: { periodYear_periodMonth_tenantId: { periodYear: dto.periodYear, periodMonth: dto.periodMonth, tenantId } },
      });
      if (existing) throw new ConflictException(`A payroll run already exists for ${dto.periodYear}/${dto.periodMonth}`);
      const created = await (tx as any).payrollRun.create({
        data: {
          tenantId, periodYear: dto.periodYear, periodMonth: dto.periodMonth,
          status: 'DRAFT', currency: dto.currency, notes: dto.notes ?? null, createdBy: actorId,
        },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'create:PayrollRun', 'PayrollRun', created.id, 'payroll-run.created', { id: created.id, periodYear: dto.periodYear, periodMonth: dto.periodMonth }, undefined, created);
      return toJson(created);
    });
  }

  /** Calculate (or re-calculate) a DRAFT/CALCULATED run from master + attendance. */
  async calculate(tenantId: string, actorId: string, id: string, dto: PayrollCalculateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).payrollRun.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Payroll run not found');
    if (before.status !== 'DRAFT' && before.status !== 'CALCULATED') {
      throw new ConflictException(`Only DRAFT or CALCULATED runs can be calculated — this run is ${before.status}`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const employees: any[] = await (tx as any).employee.findMany({
        where: { tenantId, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
        orderBy: { code: 'asc' },
      });
      const from = new Date(Date.UTC(before.periodYear, before.periodMonth - 1, 1));
      const to = new Date(Date.UTC(before.periodYear, before.periodMonth, 0, 23, 59, 59, 999));
      const absences: any[] = await (tx as any).attendanceRecord.findMany({
        where: { tenantId, status: 'ABSENT', date: { gte: from, lte: to } },
        select: { employeeId: true },
      });
      const absentByEmployee = new Map<string, number>();
      for (const a of absences) absentByEmployee.set(a.employeeId, (absentByEmployee.get(a.employeeId) ?? 0) + 1);
      const overrides = new Map((dto.overrides ?? []).map((o) => [o.employeeId, o]));
      const workingDays = workingDaysInMonth(before.periodYear, before.periodMonth);

      await (tx as any).payrollLine.deleteMany({ where: { tenantId, payrollRunId: id } });
      let gross = 0n;
      let deductions = 0n;
      let net = 0n;
      let gosiEmployer = 0n;
      let eosb = 0n;
      const lines: any[] = [];
      for (const emp of employees) {
        const ov = overrides.get(emp.id);
        const line = calculatePayrollLine({
          basicSalaryMinor: BigInt(emp.basicSalaryMinor),
          housingAllowanceMinor: BigInt(emp.housingAllowanceMinor),
          transportAllowanceMinor: BigInt(emp.transportAllowanceMinor),
          otherAllowanceMinor: BigInt(emp.otherAllowanceMinor),
          overtimeMinor: ov ? BigInt(ov.overtimeMinor) : 0n,
          otherDeductionsMinor: ov ? BigInt(ov.otherDeductionsMinor) : 0n,
          nationality: emp.nationality,
          hireDate: emp.hireDate,
          periodYear: before.periodYear,
          periodMonth: before.periodMonth,
          absentDays: absentByEmployee.get(emp.id) ?? 0,
          workingDays,
        });
        gross += line.grossMinor;
        deductions += line.gosiEmployeeMinor + line.otherDeductionsMinor;
        net += line.netMinor;
        gosiEmployer += line.gosiEmployerMinor;
        eosb += line.eosbAccrualMinor;
        lines.push({
          tenantId, payrollRunId: id, employeeId: emp.id,
          basicSalaryMinor: line.basicSalaryMinor, allowancesMinor: line.allowancesMinor,
          overtimeMinor: line.overtimeMinor, grossMinor: line.grossMinor,
          gosiEmployeeMinor: line.gosiEmployeeMinor, otherDeductionsMinor: line.otherDeductionsMinor,
          netMinor: line.netMinor, gosiEmployerMinor: line.gosiEmployerMinor,
          eosbAccrualMinor: line.eosbAccrualMinor, absentDays: line.absentDays, workingDays: line.workingDays,
          createdBy: actorId,
        });
      }
      if (lines.length > 0) await (tx as any).payrollLine.createMany({ data: lines });
      const updated = await (tx as any).payrollRun.update({
        where: { id },
        data: { status: 'CALCULATED', grossMinor: gross, deductionsMinor: deductions, netMinor: net, gosiEmployerMinor: gosiEmployer, eosbMinor: eosb },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'calculate:PayrollRun', 'PayrollRun', id, 'payroll-run.calculated', { id, lines: lines.length }, before, updated);
      return toJson(updated);
    });
  }

  /** Approve locks the run — no further edits until it is paid. */
  async approve(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).payrollRun.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Payroll run not found');
    if (before.status !== 'CALCULATED') throw new ConflictException(`Only CALCULATED runs can be approved — this run is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await (tx as any).payrollRun.update({ where: { id }, data: { status: 'APPROVED' }, include: INCLUDE });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'approve:PayrollRun', 'PayrollRun', id, 'payroll-run.approved', { id }, before, updated);
      return toJson(updated);
    });
  }

  /**
   * Pay: posts the accrual entry and the bank payment entry, then marks the
   * run PAID. Both entries are dated the payment date (must fall in an OPEN
   * fiscal period).
   */
  async pay(tenantId: string, actorId: string, id: string, dto: PayrollPayDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).payrollRun.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Payroll run not found');
    if (before.status !== 'APPROVED') throw new ConflictException(`Only APPROVED runs can be paid — this run is ${before.status}`);
    if (before.lines.length === 0) throw new BadRequestException('Cannot pay a run with no payroll lines — calculate it first');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const paymentDate = new Date(dto.paymentDate);
      const reference = `PAYROLL-${before.periodYear}-${String(before.periodMonth).padStart(2, '0')}`;
      const gosiEmployee = before.lines.reduce((s: bigint, l: any) => s + BigInt(l.gosiEmployeeMinor), 0n);
      const otherDeductions = before.lines.reduce((s: bigint, l: any) => s + BigInt(l.otherDeductionsMinor), 0n);
      const gosiPayable = gosiEmployee + BigInt(before.gosiEmployerMinor);

      let journalEntryId: string | null = null;
      const totalDebits = BigInt(before.grossMinor) + BigInt(before.gosiEmployerMinor) + BigInt(before.eosbMinor);
      if (totalDebits > 0n) {
        const salaries = await findAccountByCode(tx as any, tenantId, COA.SALARIES);
        const gosiEmployerExp = await findAccountByCode(tx as any, tenantId, COA.GOSI_EMPLOYER_EXPENSE);
        const eosbExp = await findAccountByCode(tx as any, tenantId, COA.EOSB_EXPENSE);
        const gosiPayableAcc = await findAccountByCode(tx as any, tenantId, COA.GOSI_PAYABLE);
        const salariesPayable = await findAccountByCode(tx as any, tenantId, COA.SALARIES_PAYABLE);
        const eosbProvision = await findAccountByCode(tx as any, tenantId, COA.EOSB_PROVISION);
        const otherDedAcc = await findAccountByCode(tx as any, tenantId, COA.OTHER_DEDUCTIONS_PAYABLE);
        const lines: { accountId: string; debitMinor: bigint; creditMinor: bigint; description: string }[] = [];
        if (BigInt(before.grossMinor) > 0n) lines.push({ accountId: salaries.id, debitMinor: BigInt(before.grossMinor), creditMinor: 0n, description: `Salaries ${reference}` });
        if (BigInt(before.gosiEmployerMinor) > 0n) lines.push({ accountId: gosiEmployerExp.id, debitMinor: BigInt(before.gosiEmployerMinor), creditMinor: 0n, description: `GOSI employer ${reference}` });
        if (BigInt(before.eosbMinor) > 0n) lines.push({ accountId: eosbExp.id, debitMinor: BigInt(before.eosbMinor), creditMinor: 0n, description: `EOSB accrual ${reference}` });
        if (gosiPayable > 0n) lines.push({ accountId: gosiPayableAcc.id, debitMinor: 0n, creditMinor: gosiPayable, description: `GOSI payable ${reference}` });
        if (BigInt(before.netMinor) > 0n) lines.push({ accountId: salariesPayable.id, debitMinor: 0n, creditMinor: BigInt(before.netMinor), description: `Net salaries payable ${reference}` });
        if (BigInt(before.eosbMinor) > 0n) lines.push({ accountId: eosbProvision.id, debitMinor: 0n, creditMinor: BigInt(before.eosbMinor), description: `EOS provision ${reference}` });
        if (otherDeductions > 0n) lines.push({ accountId: otherDedAcc.id, debitMinor: 0n, creditMinor: otherDeductions, description: `Other deductions ${reference}` });
        const entry = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: paymentDate,
          description: `Payroll accrual ${reference}`,
          reference,
          sourceModule: 'PAYROLL',
          currency: before.currency,
          status: 'POSTED',
          lines,
        });
        journalEntryId = entry.id;
      }

      let paymentJournalEntryId: string | null = null;
      if (BigInt(before.netMinor) > 0n) {
        const salariesPayable = await findAccountByCode(tx as any, tenantId, COA.SALARIES_PAYABLE);
        const bank = await findAccountByCode(tx as any, tenantId, dto.bankAccountCode);
        const payment = await this.posting.postBalanced(tx as any, tenantId, actorId, {
          entryDate: paymentDate,
          description: `Payroll payment ${reference} — bank ${dto.bankAccountCode}`,
          reference,
          sourceModule: 'PAYROLL',
          currency: before.currency,
          status: 'POSTED',
          lines: [
            { accountId: salariesPayable.id, debitMinor: BigInt(before.netMinor), creditMinor: 0n, description: `Payroll payment ${reference}` },
            { accountId: bank.id, debitMinor: 0n, creditMinor: BigInt(before.netMinor), description: `Payroll payment ${reference}` },
          ],
        });
        paymentJournalEntryId = payment.id;
      }

      const updated = await (tx as any).payrollRun.update({
        where: { id },
        data: { status: 'PAID', journalEntryId, paymentJournalEntryId, bankAccountCode: dto.bankAccountCode, paymentDate, paidAt: new Date() },
        include: INCLUDE,
      });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'pay:PayrollRun', 'PayrollRun', id, 'payroll-run.paid', { id, journalEntryId, paymentJournalEntryId }, before, updated);
      return toJson(updated);
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).payrollRun.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Payroll run not found');
    if (before.status !== 'DRAFT') throw new ConflictException(`Only DRAFT runs can be deleted — this run is ${before.status}`);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await (tx as any).payrollRun.delete({ where: { id } });
      await this.stock.logAndPublish(tx as any, tenantId, actorId, 'delete:PayrollRun', 'PayrollRun', id, 'payroll-run.deleted', { id }, before);
      return toJson(deleted);
    });
  }
}
