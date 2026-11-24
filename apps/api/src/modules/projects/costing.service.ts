import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { projectCosting, resolveHourlyRateMinor, timesheetCostMinor } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toJson } from '../master-data/serialize';

/** Recognised revenue: invoiced amounts linked to the project. */
const RECOGNISED_INVOICE_STATUSES = ['POSTED', 'PARTIALLY_PAID', 'PAID'];

/**
 * Project costing (Phase 9): budget vs actual (approved timesheet labour
 * + approved expenses + materials), profitability and burn rate.
 * Labour cost per entry = minutes/60 x hourly rate, where the rate is the
 * task's `hourlyRateMinor` override when set, else the employee's basic
 * salary / 160 hours/month (see @eserp/shared projects.ts). Materials are
 * 0 in Phase 9 — there is no stock linkage for projects yet.
 */
@Injectable()
export class CostingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async compute(tenantId: string, projectId: string) {
    const project: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).project.findUnique({ where: { id: projectId } }),
    );
    if (!project || project.tenantId !== tenantId) throw new NotFoundException('Project not found');

    const [timesheets, expenses, invoices] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).timesheet.findMany({
          where: { tenantId, projectId, status: 'APPROVED' },
          include: {
            employee: { select: { id: true, code: true, name: true, basicSalaryMinor: true } },
            task: { select: { id: true, title: true, hourlyRateMinor: true } },
          },
        }),
        (tx as any).projectExpense.findMany({ where: { tenantId, projectId, status: 'APPROVED' } }),
        (tx as any).salesInvoice.findMany({
          where: { tenantId, projectId, status: { in: RECOGNISED_INVOICE_STATUSES } },
          select: { id: true, number: true, status: true, totalMinor: true, type: true },
        }),
      ]),
    );

    let labourMinor = 0n;
    const labourByEmployee = new Map<string, { employeeId: string; code: string; name: string; minutes: number; costMinor: bigint }>();
    const labourByTask = new Map<string, { taskId: string | null; title: string | null; minutes: number; costMinor: bigint }>();
    for (const ts of timesheets as any[]) {
      const rate = resolveHourlyRateMinor(ts.task?.hourlyRateMinor ?? null, ts.employee.basicSalaryMinor);
      const cost = timesheetCostMinor(ts.minutesInt, rate);
      labourMinor += cost;
      const byEmp = labourByEmployee.get(ts.employeeId) ?? { employeeId: ts.employeeId, code: ts.employee.code, name: ts.employee.name, minutes: 0, costMinor: 0n };
      byEmp.minutes += ts.minutesInt;
      byEmp.costMinor += cost;
      labourByEmployee.set(ts.employeeId, byEmp);
      const byTask = labourByTask.get(ts.taskId ?? 'none') ?? { taskId: ts.taskId ?? null, title: ts.task?.title ?? null, minutes: 0, costMinor: 0n };
      byTask.minutes += ts.minutesInt;
      byTask.costMinor += cost;
      labourByTask.set(ts.taskId ?? 'none', byTask);
    }

    const expensesByCategory = new Map<string, bigint>();
    let expensesMinor = 0n;
    for (const e of expenses as any[]) {
      expensesMinor += BigInt(e.amountMinor);
      expensesByCategory.set(e.category, (expensesByCategory.get(e.category) ?? 0n) + BigInt(e.amountMinor));
    }

    let revenueMinor = 0n;
    for (const inv of invoices as any[]) revenueMinor += BigInt(inv.totalMinor);

    const costing = projectCosting({
      budgetMinor: BigInt(project.budgetMinor),
      labourMinor,
      expensesMinor,
      materialsMinor: 0n,
      revenueMinor,
      startDate: project.startDate ?? project.createdAt,
      dueDate: project.dueDate ?? null,
    });

    return toJson({
      project: { id: project.id, code: project.code, name: project.name, status: project.status, billingType: project.billingType, currency: project.currency },
      ...costing,
      labourByEmployee: [...labourByEmployee.values()],
      labourByTask: [...labourByTask.values()],
      expensesByCategory: [...expensesByCategory.entries()].map(([category, amountMinor]) => ({ category, amountMinor })),
      revenueInvoices: invoices,
      approvedTimesheetCount: (timesheets as any[]).length,
      approvedExpenseCount: (expenses as any[]).length,
    });
  }
}
