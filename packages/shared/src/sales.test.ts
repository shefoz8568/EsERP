import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  computeAging,
  computeDocLine,
  computeDocTotals,
  creditLimitExceeded,
  daysPastDue,
  threeWayMatchError,
} from './sales.js';

describe('computeDocLine', () => {
  it('computes gross, discount, VAT and total in minor units', () => {
    // 10 x 3499 = 34990 gross; 10% discount = 3499; net 31491; VAT 15% = 4724 (31491*0.15=4723.65 -> 4724); total 36215.
    const t = computeDocLine({ quantity: 10, unitPriceMinor: 3499, discountPct: 10, taxRateBps: 1500 });
    expect(t.grossMinor).toBe(34990n);
    expect(t.discountMinor).toBe(3499n);
    expect(t.netMinor).toBe(31491n);
    expect(t.taxMinor).toBe(4724n);
    expect(t.totalMinor).toBe(36215n);
  });

  it('rounds half-up: 10 halalas at 15% VAT = 2 halalas', () => {
    expect(computeDocLine({ quantity: 1, unitPriceMinor: 10, taxRateBps: 1500 }).taxMinor).toBe(2n);
  });

  it('zero discount and zero tax give total = gross', () => {
    const t = computeDocLine({ quantity: 3, unitPriceMinor: 1000 });
    expect(t).toEqual({ grossMinor: 3000n, discountMinor: 0n, netMinor: 3000n, taxMinor: 0n, totalMinor: 3000n });
  });

  it('rejects invalid discount / tax / quantities', () => {
    expect(() => computeDocLine({ quantity: 1, unitPriceMinor: 100, discountPct: 101 })).toThrow();
    expect(() => computeDocLine({ quantity: 1, unitPriceMinor: 100, taxRateBps: 10001 })).toThrow();
    expect(() => computeDocLine({ quantity: -1, unitPriceMinor: 100 })).toThrow();
    expect(() => computeDocLine({ quantity: 1, unitPriceMinor: -5 })).toThrow();
  });
});

describe('computeDocTotals', () => {
  it('sums line columns', () => {
    // Line 1: 100 x 3499 @15% = net 349900, tax 52485, total 402385.
    // Line 2: 2 x 1000, 50% discount @0% = net 1000, tax 0, total 1000.
    const t = computeDocTotals([
      { quantity: 100, unitPriceMinor: 3499, taxRateBps: 1500 },
      { quantity: 2, unitPriceMinor: 1000, discountPct: 50, taxRateBps: 0 },
    ]);
    expect(t.subtotalMinor).toBe(350900n);
    expect(t.discountMinor).toBe(1000n);
    expect(t.taxMinor).toBe(52485n);
    expect(t.totalMinor).toBe(403385n);
  });

  it('empty document totals to zero', () => {
    expect(computeDocTotals([])).toEqual({ subtotalMinor: 0n, discountMinor: 0n, taxMinor: 0n, totalMinor: 0n });
  });
});

describe('aging', () => {
  it('buckets by days past due', () => {
    expect(agingBucket(-5)).toBe('CURRENT');
    expect(agingBucket(0)).toBe('CURRENT');
    expect(agingBucket(1)).toBe('D1_30');
    expect(agingBucket(30)).toBe('D1_30');
    expect(agingBucket(31)).toBe('D31_60');
    expect(agingBucket(60)).toBe('D31_60');
    expect(agingBucket(61)).toBe('D61_90');
    expect(agingBucket(90)).toBe('D61_90');
    expect(agingBucket(91)).toBe('D90_PLUS');
  });

  it('daysPastDue counts whole calendar days', () => {
    expect(daysPastDue('2026-11-20', '2026-11-20')).toBe(0);
    expect(daysPastDue('2026-11-20', '2026-12-05')).toBe(15);
    expect(daysPastDue('2026-12-20', '2026-11-24')).toBe(-26);
  });

  it('sums balances per bucket and ignores zero/negative balances', () => {
    const r = computeAging([
      { balanceMinor: 1000n, daysPastDue: -3 },
      { balanceMinor: 2000n, daysPastDue: 10 },
      { balanceMinor: 3000n, daysPastDue: 45 },
      { balanceMinor: 4000n, daysPastDue: 75 },
      { balanceMinor: 5000n, daysPastDue: 120 },
      { balanceMinor: 0n, daysPastDue: 10 },
      { balanceMinor: -500n, daysPastDue: 10 },
    ]);
    expect(r).toEqual({
      currentMinor: 1000n, d1_30Minor: 2000n, d31_60Minor: 3000n,
      d61_90Minor: 4000n, d90PlusMinor: 5000n, totalMinor: 15000n,
    });
  });
});

describe('creditLimitExceeded', () => {
  it('blocks when open AR + order exceeds the limit', () => {
    expect(creditLimitExceeded(4000000n, 1500000n, 5000000n)).toBe(true);
    expect(creditLimitExceeded(4000000n, 1000000n, 5000000n)).toBe(false);
    expect(creditLimitExceeded(4000000n, 1000000n, 5000000n)).toBe(false);
  });

  it('a zero limit means no limit set and never blocks', () => {
    expect(creditLimitExceeded(999999999n, 999999999n, 0n)).toBe(false);
  });
});

describe('threeWayMatchError', () => {
  const base = {
    poQuantity: 100, alreadyInvoicedQuantity: 0, invoiceQuantity: 50,
    poUnitPriceMinor: 2800, invoiceUnitPriceMinor: 2800,
  };
  it('passes an exact match', () => {
    expect(threeWayMatchError(base)).toBeNull();
  });

  it('blocks quantity over the PO ordered quantity', () => {
    expect(threeWayMatchError({ ...base, invoiceQuantity: 101 })).toMatch(/exceeds the purchase order quantity/);
    expect(threeWayMatchError({ ...base, alreadyInvoicedQuantity: 60, invoiceQuantity: 41 })).toMatch(/exceeds/);
    expect(threeWayMatchError({ ...base, alreadyInvoicedQuantity: 60, invoiceQuantity: 40 })).toBeNull();
  });

  it('blocks price variance over 5% and allows exactly 5%', () => {
    // 5% of 2800 = 140: 2940 passes, 2941 blocks.
    expect(threeWayMatchError({ ...base, invoiceUnitPriceMinor: 2940 })).toBeNull();
    expect(threeWayMatchError({ ...base, invoiceUnitPriceMinor: 2941 })).toMatch(/exceeds 5% tolerance/);
    expect(threeWayMatchError({ ...base, invoiceUnitPriceMinor: 2660 })).toBeNull();
    expect(threeWayMatchError({ ...base, invoiceUnitPriceMinor: 2659 })).toMatch(/exceeds 5% tolerance/);
  });

  it('rejects non-positive invoice quantities', () => {
    expect(threeWayMatchError({ ...base, invoiceQuantity: 0 })).toMatch(/must be positive/);
  });
});
