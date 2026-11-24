import { describe, expect, it } from 'vitest';
import {
  calculatePayrollLine,
  eosbMonthlyAccrual,
  gosiContribution,
  gosiContributionWage,
  leaveBalance,
  leaveWorkingDays,
  workingDaysInMonth,
  yearsOfService,
} from './payroll.js';

describe('GOSI (existing scheme, pre-3 July 2024 registrants)', () => {
  it('charges the contribution wage = basic + housing, capped at SAR 45,000', () => {
    expect(gosiContributionWage(1_200_000, 300_000)).toBe(1_500_000n);
    expect(gosiContributionWage(4_000_000, 1_000_000)).toBe(4_500_000n);
  });

  it('deducts 9.75% from a Saudi employee and 11.75% from the employer', () => {
    // Wage 1,500,000: employee 146,250; employer 176,250.
    const g = gosiContribution('SAUDI', 1_200_000, 300_000);
    expect(g.contributionWageMinor).toBe(1_500_000n);
    expect(g.employeeMinor).toBe(146250n);
    expect(g.employerMinor).toBe(176250n);
  });

  it('charges a non-Saudi 2% employer hazards only, no employee deduction', () => {
    const g = gosiContribution('NON_SAUDI', 450_000, 100_000);
    expect(g.employeeMinor).toBe(0n);
    expect(g.employerMinor).toBe(11000n); // 550,000 x 2%
  });

  it('rounds half-up on the exact rational result', () => {
    // Wage 333: employee 333 x 975 / 10000 = 32.4675 -> 32.
    expect(gosiContribution('SAUDI', 333, 0).employeeMinor).toBe(32n);
  });
});

describe('EOSB accrual', () => {
  it('accrues half a month per year for the first 5 years', () => {
    // 1,550,000 x 0.5 / 12 = 64,583.33 -> 64,583.
    expect(eosbMonthlyAccrual(1_550_000, 3.8)).toBe(64583n);
  });

  it('accrues a full month per year from 5 years on', () => {
    expect(eosbMonthlyAccrual(1_200_000, 5)).toBe(100000n);
    expect(eosbMonthlyAccrual(1_200_000, 12.4)).toBe(100000n);
    expect(eosbMonthlyAccrual(1_200_000, 4.99)).toBe(50000n);
  });

  it('measures service in fractional years', () => {
    expect(yearsOfService('2023-01-15', '2026-11-30')).toBeGreaterThan(3.8);
    expect(yearsOfService('2023-01-15', '2026-11-30')).toBeLessThan(3.9);
    expect(yearsOfService('2026-12-01', '2026-11-30')).toBe(0);
  });
});

describe('leave working days (Fri–Sat weekend)', () => {
  it('counts only Sun–Thu days', () => {
    // Sun 2026-11-15 .. Tue 2026-11-17 = 3 working days.
    expect(leaveWorkingDays('2026-11-15', '2026-11-17')).toBe(3);
    // Thu 2026-11-19 .. Sun 2026-11-22 = Thu + Sun = 2 (Fri/Sat skipped).
    expect(leaveWorkingDays('2026-11-19', '2026-11-22')).toBe(2);
    // A Friday alone is 0 working days.
    expect(leaveWorkingDays('2026-11-20', '2026-11-20')).toBe(0);
  });

  it('rejects an end before the start', () => {
    expect(() => leaveWorkingDays('2026-11-17', '2026-11-15')).toThrow();
  });

  it('counts November 2026 as 22 working days', () => {
    expect(workingDaysInMonth(2026, 11)).toBe(22);
  });

  it('computes the balance as entitlement - approved days taken', () => {
    expect(leaveBalance(30, 3)).toBe(27);
  });
});

describe('payroll line calculation', () => {
  it('deducts absent days pro-rata basic and nets GOSI + deductions', () => {
    // Saudi, hired 2023-01-15, Nov 2026 (22 working days), 2 absent days.
    // Basic 1,200,000; housing 300,000; transport 50,000; overtime 0.
    // Absent deduction = 1,200,000 x 2 / 22 = 109,090.9 -> 109,091.
    // Gross = 1,200,000 - 109,091 + 350,000 = 1,440,909.
    // GOSI employee (on full basic+housing 1,500,000) = 146,250.
    // Net = 1,440,909 - 146,250 = 1,294,659. EOSB = 64,583 (see above).
    const line = calculatePayrollLine({
      basicSalaryMinor: 1_200_000,
      housingAllowanceMinor: 300_000,
      transportAllowanceMinor: 50_000,
      nationality: 'SAUDI',
      hireDate: '2023-01-15',
      periodYear: 2026,
      periodMonth: 11,
      absentDays: 2,
    });
    expect(line.absentDeductionMinor).toBe(109091n);
    expect(line.grossMinor).toBe(1440909n);
    expect(line.gosiEmployeeMinor).toBe(146250n);
    expect(line.gosiEmployerMinor).toBe(176250n);
    expect(line.eosbAccrualMinor).toBe(64583n);
    expect(line.netMinor).toBe(1294659n);
    expect(line.workingDays).toBe(22);
  });

  it('charges a non-Saudi no GOSI deduction and full EOSB after 5 years', () => {
    const line = calculatePayrollLine({
      basicSalaryMinor: 900_000,
      housingAllowanceMinor: 200_000,
      transportAllowanceMinor: 100_000,
      nationality: 'NON_SAUDI',
      hireDate: '2019-01-01',
      periodYear: 2026,
      periodMonth: 11,
    });
    expect(line.gosiEmployeeMinor).toBe(0n);
    expect(line.gosiEmployerMinor).toBe(22000n); // 1,100,000 x 2%
    expect(line.eosbAccrualMinor).toBe(100000n); // 1,200,000 / 12
    expect(line.grossMinor).toBe(1200000n);
    expect(line.netMinor).toBe(1200000n);
  });

  it('caps other deductions so net pay never goes negative', () => {
    // Gross 100,000, GOSI employee 9,750 -> max other deductions 90,250.
    const line = calculatePayrollLine({
      basicSalaryMinor: 100_000,
      nationality: 'SAUDI',
      hireDate: '2024-01-01',
      periodYear: 2026,
      periodMonth: 11,
      otherDeductionsMinor: 500_000,
    });
    expect(line.otherDeductionsMinor).toBe(90250n);
    expect(line.netMinor).toBe(0n);
  });

  it('rejects absent days beyond the working days in the month', () => {
    expect(() =>
      calculatePayrollLine({
        basicSalaryMinor: 100_000,
        nationality: 'SAUDI',
        hireDate: '2024-01-01',
        periodYear: 2026,
        periodMonth: 11,
        absentDays: 23,
      }),
    ).toThrow();
  });
});
