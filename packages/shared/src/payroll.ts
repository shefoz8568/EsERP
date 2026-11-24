/**
 * Phase 8 — HR / Payroll: pure Saudi payroll, GOSI, EOSB and leave math.
 *
 * All amounts are integer minor units (bigint, halalas for SAR) — never
 * floats. Rates are documented in docs/erd-phase8.md; the headline
 * assumption is the GOSI **existing scheme** (Saudi employees registered
 * before 3 July 2024): employee 9.75% (9% pension + 0.75% SANED),
 * employer 11.75% (9% pension + 0.75% SANED + 2% occupational hazards);
 * non-Saudi: 2% employer hazards only, no employee deduction.
 * Contribution wage = basic salary + housing allowance, capped at
 * SAR 45,000/month (4,500,000 minor units).
 *
 * EOSB (Saudi Labour Law art. 84): half a month's wage per year of service
 * for the first 5 years, one month per year thereafter; accrued monthly as
 * (monthly wage x factor) / 12, where monthly wage = basic + all allowances
 * and factor = 0.5 (< 5 years of service) or 1.0 (>= 5 years).
 *
 * Leave / attendance use the Saudi working week: Friday–Saturday weekend.
 */

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/** round_half_up(numerator / denominator) for non-negative bigints. */
export function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  return (numerator * 2n + denominator) / (denominator * 2n);
}

// --- GOSI ------------------------------------------------------------------

export const GOSI_SAUDI_EMPLOYEE_BPS = 975; // 9% pension + 0.75% SANED
export const GOSI_SAUDI_EMPLOYER_BPS = 1175; // 9% pension + 0.75% SANED + 2% hazards
export const GOSI_NON_SAUDI_EMPLOYER_BPS = 200; // 2% occupational hazards only
/** Contribution-wage ceiling: SAR 45,000/month, in minor units. */
export const GOSI_WAGE_CAP_MINOR = 4_500_000n;

export interface GosiResult {
  /** Basic + housing, capped at SAR 45,000. */
  contributionWageMinor: bigint;
  employeeMinor: bigint;
  employerMinor: bigint;
}

/** GOSI contribution wage = basic + housing, capped at SAR 45,000/month. */
export function gosiContributionWage(
  basicSalaryMinor: bigint | number,
  housingAllowanceMinor: bigint | number,
): bigint {
  const wage = toBig(basicSalaryMinor) + toBig(housingAllowanceMinor);
  return wage > GOSI_WAGE_CAP_MINOR ? GOSI_WAGE_CAP_MINOR : wage;
}

/** GOSI employee deduction + employer contribution for one employee/month. */
export function gosiContribution(
  nationality: string,
  basicSalaryMinor: bigint | number,
  housingAllowanceMinor: bigint | number,
): GosiResult {
  const wage = gosiContributionWage(basicSalaryMinor, housingAllowanceMinor);
  if (nationality === 'SAUDI') {
    return {
      contributionWageMinor: wage,
      employeeMinor: divHalfUp(wage * BigInt(GOSI_SAUDI_EMPLOYEE_BPS), 10000n),
      employerMinor: divHalfUp(wage * BigInt(GOSI_SAUDI_EMPLOYER_BPS), 10000n),
    };
  }
  return {
    contributionWageMinor: wage,
    employeeMinor: 0n,
    employerMinor: divHalfUp(wage * BigInt(GOSI_NON_SAUDI_EMPLOYER_BPS), 10000n),
  };
}

// --- EOSB ------------------------------------------------------------------

/**
 * Monthly EOSB accrual. `yearsOfService` may be fractional; the factor
 * switches at 5 years (0.5 before, 1.0 from 5 years on).
 */
export function eosbMonthlyAccrual(
  monthlyWageMinor: bigint | number,
  yearsOfService: number,
): bigint {
  const wage = toBig(monthlyWageMinor);
  if (wage < 0n) throw new Error('Monthly wage must not be negative');
  if (yearsOfService < 0) throw new Error('Years of service must not be negative');
  const factorBps = yearsOfService >= 5 ? 10000 : 5000;
  return divHalfUp(wage * BigInt(factorBps), 120000n);
}

/** Completed years of service between two dates (fractional). */
export function yearsOfService(hireDate: Date | string, asOf: Date | string): number {
  const start = new Date(hireDate).getTime();
  const end = new Date(asOf).getTime();
  if (end < start) return 0;
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

// --- Leave / attendance ----------------------------------------------------

/** Saudi weekend: Friday (5) and Saturday (6) in UTC day-of-week. */
export function isWeekendDay(date: Date): boolean {
  const d = date.getUTCDay();
  return d === 5 || d === 6;
}

/**
 * Working days in a date range (inclusive), excluding Fridays and Saturdays.
 * Throws when end < start.
 */
export function leaveWorkingDays(start: Date | string, end: Date | string): number {
  const s = new Date(start);
  const e = new Date(end);
  s.setUTCHours(0, 0, 0, 0);
  e.setUTCHours(0, 0, 0, 0);
  if (e.getTime() < s.getTime()) throw new Error('Leave end date must not be before start date');
  let days = 0;
  for (let d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isWeekendDay(d)) days += 1;
  }
  return days;
}

/** Working days (Fri–Sat excluded) in a calendar month. */
export function workingDaysInMonth(year: number, month: number): number {
  // month is 1-based.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let days = 0;
  for (let d = 1; d <= daysInMonth; d += 1) {
    if (!isWeekendDay(new Date(Date.UTC(year, month - 1, d)))) days += 1;
  }
  return days;
}

/** Leave balance for one leave type: entitlement − approved days taken. */
export function leaveBalance(daysPerYear: number, approvedDaysTaken: number): number {
  return daysPerYear - approvedDaysTaken;
}

// --- Payroll line ----------------------------------------------------------

export interface PayrollLineInput {
  basicSalaryMinor: bigint | number;
  housingAllowanceMinor?: bigint | number;
  transportAllowanceMinor?: bigint | number;
  otherAllowanceMinor?: bigint | number;
  overtimeMinor?: bigint | number;
  otherDeductionsMinor?: bigint | number;
  nationality: string;
  hireDate: Date | string;
  periodYear: number;
  periodMonth: number;
  absentDays?: number;
  workingDays?: number;
}

export interface PayrollLineResult {
  basicSalaryMinor: bigint;
  allowancesMinor: bigint;
  absentDeductionMinor: bigint;
  overtimeMinor: bigint;
  grossMinor: bigint;
  gosiEmployeeMinor: bigint;
  otherDeductionsMinor: bigint;
  netMinor: bigint;
  gosiEmployerMinor: bigint;
  eosbAccrualMinor: bigint;
  absentDays: number;
  workingDays: number;
}

/**
 * Deterministic payroll line from the employee master + attendance.
 * Absent days deduct pro-rata basic: basic x absentDays / workingDays
 * (half-up). Gross = (basic − absent deduction) + allowances + overtime.
 * Net = gross − GOSI employee deduction − other deductions. Other
 * deductions are capped at gross − GOSI employee deduction, so net never
 * goes negative (the capped amount is what is stored) — this keeps the
 * payroll accrual journal entry balanced by construction.
 * GOSI is computed on the full basic + housing (not reduced by absence).
 * EOSB accrues on the full monthly wage (basic + all allowances).
 */
export function calculatePayrollLine(input: PayrollLineInput): PayrollLineResult {
  const basic = toBig(input.basicSalaryMinor);
  const housing = toBig(input.housingAllowanceMinor ?? 0);
  const transport = toBig(input.transportAllowanceMinor ?? 0);
  const other = toBig(input.otherAllowanceMinor ?? 0);
  const overtime = toBig(input.overtimeMinor ?? 0);
  const otherDeductions = toBig(input.otherDeductionsMinor ?? 0);
  const absentDays = input.absentDays ?? 0;
  const workingDays = input.workingDays ?? workingDaysInMonth(input.periodYear, input.periodMonth);
  if (basic < 0n || housing < 0n || transport < 0n || other < 0n || overtime < 0n || otherDeductions < 0n) {
    throw new Error('Payroll amounts must not be negative');
  }
  if (absentDays < 0 || absentDays > workingDays) throw new Error('Absent days must be between 0 and working days');
  const allowances = housing + transport + other;
  const absentDeduction = workingDays > 0 ? divHalfUp(basic * BigInt(absentDays), BigInt(workingDays)) : 0n;
  const gross = basic - absentDeduction + allowances + overtime;
  const gosi = gosiContribution(input.nationality, basic, housing);
  const periodEnd = new Date(Date.UTC(input.periodYear, input.periodMonth, 0));
  const eosb = eosbMonthlyAccrual(basic + allowances, yearsOfService(input.hireDate, periodEnd));
  const maxOtherDeductions = gross - gosi.employeeMinor > 0n ? gross - gosi.employeeMinor : 0n;
  const cappedOtherDeductions = otherDeductions > maxOtherDeductions ? maxOtherDeductions : otherDeductions;
  const netRaw = gross - gosi.employeeMinor - cappedOtherDeductions;
  return {
    basicSalaryMinor: basic,
    allowancesMinor: allowances,
    absentDeductionMinor: absentDeduction,
    overtimeMinor: overtime,
    grossMinor: gross,
    gosiEmployeeMinor: gosi.employeeMinor,
    otherDeductionsMinor: cappedOtherDeductions,
    netMinor: netRaw < 0n ? 0n : netRaw,
    gosiEmployerMinor: gosi.employerMinor,
    eosbAccrualMinor: eosb,
    absentDays,
    workingDays,
  };
}
