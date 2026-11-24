import { describe, expect, it } from 'vitest';
import {
  HOURS_PER_MONTH,
  hourlyCostRateMinor,
  hoursToMinutes,
  minutesToHours,
  projectCosting,
  resolveHourlyRateMinor,
  timesheetCostMinor,
} from './projects.js';

describe('projects costing math', () => {
  it('hourly rate is basic salary / 160 hours', () => {
    expect(HOURS_PER_MONTH).toBe(160);
    // 12,000 SAR = 1,200,000 minor / 160 = 7,500 minor/hour
    expect(hourlyCostRateMinor(1_200_000n)).toBe(7_500n);
    // half-up: 1,000,001 / 160 = 6250.00625 -> 6250
    expect(hourlyCostRateMinor(1_000_001)).toBe(6_250n);
    // 100 / 160 = 0.625 -> 1 (half-up)
    expect(hourlyCostRateMinor(100n)).toBe(1n);
  });

  it('hours convert to integer minutes and back', () => {
    expect(hoursToMinutes(7.5)).toBe(450);
    expect(hoursToMinutes(0.25)).toBe(15);
    expect(minutesToHours(450)).toBe(7.5);
    expect(() => hoursToMinutes(0)).toThrow();
    expect(() => hoursToMinutes(-1)).toThrow();
  });

  it('timesheet cost is minutes/60 x rate, half-up per entry', () => {
    // 90 min at 7,500/hr = 11,250
    expect(timesheetCostMinor(90, 7_500n)).toBe(11_250n);
    // 1 min at 100/hr = 1.666.. -> 2
    expect(timesheetCostMinor(1, 100n)).toBe(2n);
  });

  it('task rate override wins over the employee rate', () => {
    expect(resolveHourlyRateMinor(9_999n, 1_200_000n)).toBe(9_999n);
    expect(resolveHourlyRateMinor(null, 1_200_000n)).toBe(7_500n);
    expect(resolveHourlyRateMinor(undefined, 1_200_000n)).toBe(7_500n);
  });

  it('project costing: actual, profit, margin, burn rate', () => {
    const c = projectCosting({
      budgetMinor: 1_000_000n,
      labourMinor: 200_000n,
      expensesMinor: 100_000n,
      materialsMinor: 50_000n,
      revenueMinor: 500_000n,
      startDate: '2026-11-01T00:00:00.000Z',
      dueDate: '2026-12-31T00:00:00.000Z',
      asOf: '2026-11-30T00:00:00.000Z',
    });
    expect(c.actualMinor).toBe(350_000n);
    expect(c.remainingMinor).toBe(650_000n);
    expect(c.profitMinor).toBe(150_000n);
    expect(c.marginBps).toBe(3_000); // 30%
    expect(c.percentUsedBps).toBe(3_500); // 35%
    expect(c.elapsedDays).toBe(29);
    expect(c.plannedDays).toBe(60);
    expect(c.burnRateMinorPerDay).toBe(350_000n / 29n);
    expect(c.projectedTotalMinor).toBe((350_000n / 29n) * 60n);
  });

  it('project costing handles zero revenue/budget without dividing by zero', () => {
    const c = projectCosting({
      budgetMinor: 0,
      labourMinor: 0,
      expensesMinor: 0,
      revenueMinor: 0,
      startDate: '2026-11-01T00:00:00.000Z',
      dueDate: null,
      asOf: '2026-11-02T00:00:00.000Z',
    });
    expect(c.marginBps).toBeNull();
    expect(c.percentUsedBps).toBeNull();
    expect(c.plannedDays).toBeNull();
    expect(c.projectedTotalMinor).toBeNull();
  });
});
