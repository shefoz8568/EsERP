/**
 * Phase 9 — Projects: pure costing / timesheet math.
 *
 * All amounts are integer minor units (bigint, halalas for SAR) — never
 * floats. Hours are stored as integer MINUTES on Timesheet
 * (`minutesInt`); the DTO accepts decimal hours and converts with
 * `hoursToMinutes` (round-half-up on minutes).
 *
 * Hourly cost rate (documented formula, docs/erd-phase9.md):
 *   hourlyRateMinor = basicSalaryMinor / 160
 * i.e. the employee's monthly basic salary spread over 160 working
 * hours/month (40h/week x 4 weeks), half-up integer division. A
 * ProjectTask may carry an `hourlyRateMinor` override, which wins.
 */

import { divHalfUp } from './payroll.js';

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/** Standard working hours per month used by the hourly-rate formula. */
export const HOURS_PER_MONTH = 160;

/** Hourly cost rate for an employee: basic salary / 160 hours, half-up. */
export function hourlyCostRateMinor(basicSalaryMinor: bigint | number): bigint {
  return divHalfUp(toBig(basicSalaryMinor), BigInt(HOURS_PER_MONTH));
}

/** Decimal hours (e.g. 7.5) -> integer minutes, rounded to the nearest minute. */
export function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Hours must be positive');
  return Math.round(hours * 60);
}

/** Integer minutes -> decimal hours (exact for whole minutes; a float only for display). */
export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

/**
 * Cost of one approved timesheet entry: minutes/60 x hourly rate, half-up.
 * Per-entry rounding (not on the summed total) so each entry's cost is
 * auditable on its own.
 */
export function timesheetCostMinor(minutes: number, hourlyRateMinor: bigint | number): bigint {
  if (minutes < 0) throw new Error('Minutes must be non-negative');
  return divHalfUp(BigInt(minutes) * toBig(hourlyRateMinor), 60n);
}

/** Resolve the rate for a timesheet: task override wins, else employee rate. */
export function resolveHourlyRateMinor(
  taskHourlyRateMinor: bigint | number | null | undefined,
  employeeBasicSalaryMinor: bigint | number,
): bigint {
  return taskHourlyRateMinor != null ? toBig(taskHourlyRateMinor) : hourlyCostRateMinor(employeeBasicSalaryMinor);
}

export interface ProjectCostingInput {
  budgetMinor: bigint | number;
  /** Approved timesheet labour cost. */
  labourMinor: bigint | number;
  /** Approved project expenses (all categories, incl. MATERIALS). */
  expensesMinor: bigint | number;
  /** Materials issued from stock / manufacturing — 0 in Phase 9 (no stock linkage yet). */
  materialsMinor?: bigint | number;
  /** Revenue recognised: invoiced amounts linked to the project. */
  revenueMinor: bigint | number;
  startDate: Date | string;
  dueDate: Date | string | null;
  /** "Today" for burn-rate math (defaults to now). */
  asOf?: Date | string;
}

export interface ProjectCosting {
  budgetMinor: bigint;
  labourMinor: bigint;
  expensesMinor: bigint;
  materialsMinor: bigint;
  /** actual = labour + expenses + materials */
  actualMinor: bigint;
  remainingMinor: bigint;
  revenueMinor: bigint;
  /** revenue - actual (may be negative). */
  profitMinor: bigint;
  /** profit / revenue in basis points, null when revenue is 0. */
  marginBps: number | null;
  /** actual / budget in basis points, null when budget is 0. */
  percentUsedBps: number | null;
  /** Whole days elapsed since start (min 1). */
  elapsedDays: number;
  /** Whole days in the planned window (min 1; null when no due date). */
  plannedDays: number | null;
  /** Average actual spend per elapsed day. */
  burnRateMinorPerDay: bigint;
  /** Projected total at the current burn rate over the planned window (null without a due date). */
  projectedTotalMinor: bigint | null;
  /** Projected overrun vs budget (null without a due date; may be negative). */
  projectedOverrunMinor: bigint | null;
}

function wholeDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

/** Budget vs actual, profitability and burn rate for one project. */
export function projectCosting(input: ProjectCostingInput): ProjectCosting {
  const budget = toBig(input.budgetMinor);
  const labour = toBig(input.labourMinor);
  const expenses = toBig(input.expensesMinor);
  const materials = toBig(input.materialsMinor ?? 0);
  const revenue = toBig(input.revenueMinor);
  const actual = labour + expenses + materials;
  const profit = revenue - actual;
  const start = new Date(input.startDate);
  const asOf = input.asOf ? new Date(input.asOf) : new Date();
  const due = input.dueDate ? new Date(input.dueDate) : null;
  const elapsedDays = Math.max(1, wholeDays(start, asOf));
  const plannedDays = due ? Math.max(1, wholeDays(start, due)) : null;
  const burnRate = actual / BigInt(elapsedDays);
  const projectedTotal = plannedDays !== null ? burnRate * BigInt(plannedDays) : null;
  return {
    budgetMinor: budget,
    labourMinor: labour,
    expensesMinor: expenses,
    materialsMinor: materials,
    actualMinor: actual,
    remainingMinor: budget - actual,
    revenueMinor: revenue,
    profitMinor: profit,
    marginBps: revenue === 0n ? null : Number((profit * 10_000n) / revenue),
    percentUsedBps: budget === 0n ? null : Number((actual * 10_000n) / budget),
    elapsedDays,
    plannedDays,
    burnRateMinorPerDay: burnRate,
    projectedTotalMinor: projectedTotal,
    projectedOverrunMinor: projectedTotal !== null ? projectedTotal - budget : null,
  };
}
