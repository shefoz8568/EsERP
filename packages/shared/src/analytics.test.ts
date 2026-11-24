import { describe, expect, it } from 'vitest';
import {
  computeBalanceSheet,
  computeCashFlow,
  computeProfitLoss,
  trendBps,
} from './analytics.js';
import { agingBucket, daysPastDue } from './sales.js';

describe('analytics aggregation', () => {
  it('P&L: revenue, COGS (5010 only), opex, net income, margins', () => {
    const pl = computeProfitLoss([
      { accountCode: '4010', accountType: 'REVENUE', debitMinor: 0n, creditMinor: 1_000_000n },
      { accountCode: '5010', accountType: 'EXPENSE', debitMinor: 400_000n, creditMinor: 0n },
      { accountCode: '5100', accountType: 'EXPENSE', debitMinor: 50_000n, creditMinor: 0n },
      { accountCode: '5210', accountType: 'EXPENSE', debitMinor: 100_000n, creditMinor: 0n },
    ]);
    expect(pl.revenueMinor).toBe(1_000_000n);
    expect(pl.cogsMinor).toBe(400_000n);
    expect(pl.grossProfitMinor).toBe(600_000n);
    expect(pl.operatingExpensesMinor).toBe(150_000n);
    expect(pl.netIncomeMinor).toBe(450_000n);
    expect(pl.grossMarginBps).toBe(6_000);
    expect(pl.netMarginBps).toBe(4_500);
  });

  it('P&L with no revenue returns null margins, not NaN', () => {
    const pl = computeProfitLoss([]);
    expect(pl.netIncomeMinor).toBe(0n);
    expect(pl.grossMarginBps).toBeNull();
    expect(pl.netMarginBps).toBeNull();
  });

  it('balance sheet balances: assets = liabilities + equity + net income', () => {
    const bs = computeBalanceSheet(
      [
        { accountCode: '1010', accountType: 'ASSET', debitMinor: 500_000n, creditMinor: 0n },
        { accountCode: '1110', accountType: 'ASSET', debitMinor: 200_000n, creditMinor: 0n },
        { accountCode: '2010', accountType: 'LIABILITY', debitMinor: 0n, creditMinor: 300_000n },
        { accountCode: '3100', accountType: 'EQUITY', debitMinor: 0n, creditMinor: 100_000n },
      ],
      300_000n,
    );
    expect(bs.assetsMinor).toBe(700_000n);
    expect(bs.totalLiabilitiesEquityMinor).toBe(700_000n);
    expect(bs.balanced).toBe(true);
    expect(bs.differenceMinor).toBe(0n);
  });

  it('balance sheet reports a difference when it does not balance', () => {
    const bs = computeBalanceSheet(
      [{ accountCode: '1010', accountType: 'ASSET', debitMinor: 100_000n, creditMinor: 0n }],
      0n,
    );
    expect(bs.balanced).toBe(false);
    expect(bs.differenceMinor).toBe(100_000n);
  });

  it('cash flow (indirect): AR rise is an outflow, AP rise is an inflow, reconciles to cash change', () => {
    // Net income 450,000; AR up 200,000 (outflow); AP up 100,000 (inflow);
    // inventory up 50,000 (outflow). Cash change = 450k - 200k + 100k - 50k = 300k.
    const cf = computeCashFlow(
      [
        { accountCode: '1110', accountType: 'ASSET', openingNetDebitMinor: 0n, closingNetDebitMinor: 200_000n },
        { accountCode: '1210', accountType: 'ASSET', openingNetDebitMinor: 0n, closingNetDebitMinor: 50_000n },
        { accountCode: '2010', accountType: 'LIABILITY', openingNetDebitMinor: 0n, closingNetDebitMinor: -100_000n },
      ],
      450_000n,
      300_000n,
    );
    expect(cf.operatingMinor).toBe(300_000n);
    expect(cf.investingMinor).toBe(0n);
    expect(cf.financingMinor).toBe(0n);
    expect(cf.balanced).toBe(true);
  });

  it('aging buckets follow the 30/60/90-day boundaries (shared sales helper)', () => {
    const asOf = '2026-11-24T00:00:00.000Z';
    const bucket = (due: string) => agingBucket(daysPastDue(due, asOf));
    expect(bucket('2026-12-01T00:00:00.000Z')).toBe('CURRENT');
    expect(bucket('2026-11-24T00:00:00.000Z')).toBe('CURRENT');
    expect(bucket('2026-11-10T00:00:00.000Z')).toBe('D1_30');
    expect(bucket('2026-10-10T00:00:00.000Z')).toBe('D31_60');
    expect(bucket('2026-09-10T00:00:00.000Z')).toBe('D61_90');
    expect(bucket('2026-06-01T00:00:00.000Z')).toBe('D90_PLUS');
  });

  it('trend is null when the previous period is zero', () => {
    expect(trendBps(1000n, 0n)).toBeNull();
    expect(trendBps(1500n, 1000n)).toBe(5_000);
    expect(trendBps(500n, 1000n)).toBe(-5_000);
  });
});
