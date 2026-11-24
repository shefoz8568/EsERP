import { describe, expect, it } from 'vitest';
import {
  bomLineStandardCost,
  bomStandardCost,
  completionPct,
  isOverProduced,
  materialVariance,
  requiredQty,
  wipBalance,
} from './manufacturing.js';

describe('BOM cost roll-up', () => {
  it('sums component standard costs x qty, no scrap', () => {
    expect(
      bomStandardCost([
        { standardCostMinor: 6500, quantityPerUnit: 2 },
        { standardCostMinor: 1000, quantityPerUnit: 1 },
        { standardCostMinor: 1400, quantityPerUnit: 1 },
      ]),
    ).toBe(15400n);
  });

  it('applies scrap % (basis points) per line, half-up', () => {
    // 2 x 6,500 x 1.05 = 13,650; + 1,000 + 1,400 = 16,050.
    expect(
      bomStandardCost([
        { standardCostMinor: 6500, quantityPerUnit: 2, scrapBps: 500 },
        { standardCostMinor: 1000, quantityPerUnit: 1 },
        { standardCostMinor: 1400, quantityPerUnit: 1 },
      ]),
    ).toBe(16050n);
    // Half-up: 1 x 333 x 1.005 = 334.665 -> 335.
    expect(bomLineStandardCost({ standardCostMinor: 333, quantityPerUnit: 1, scrapBps: 50 })).toBe(335n);
  });

  it('rejects negative costs and out-of-range scrap', () => {
    expect(() => bomStandardCost([{ standardCostMinor: -1, quantityPerUnit: 1 }])).toThrow();
    expect(() => bomStandardCost([{ standardCostMinor: 100, quantityPerUnit: 1, scrapBps: 10001 }])).toThrow();
  });
});

describe('required quantity', () => {
  it('includes the scrap allowance, half-up', () => {
    // 10 planned x 2 per unit x 1.05 = 21.
    expect(requiredQty(10, 2, 500)).toBe(21n);
    expect(requiredQty(10, 1, 0)).toBe(10n);
    // 3 x 1 x 1.05 = 3.15 -> 3.
    expect(requiredQty(3, 1, 500)).toBe(3n);
  });
});

describe('WIP math', () => {
  it('balances issued - received - finished scrap', () => {
    expect(wipBalance(160500, 96300, 16050)).toBe(48150n);
    expect(wipBalance(0, 0, 0)).toBe(0n);
  });

  it('computes completion % (two decimals, over 100 allowed)', () => {
    expect(completionPct(6, 10)).toBe(60);
    expect(completionPct(0, 10)).toBe(0);
    expect(completionPct(11, 10)).toBe(110);
    expect(completionPct(1, 3)).toBe(33.33);
    expect(completionPct(5, 0)).toBe(0);
  });

  it('flags over-production', () => {
    expect(isOverProduced(11, 10)).toBe(true);
    expect(isOverProduced(10, 10)).toBe(false);
  });

  it('summarises the material cost variance on completion', () => {
    // Planned 160,500 vs actual 165,000: +4,500 (+2.8%).
    const v = materialVariance(160500, 165000);
    expect(v.varianceMinor).toBe(4500n);
    expect(v.variancePct).toBe(2.8);
    expect(materialVariance(100000, 90000).varianceMinor).toBe(-10000n);
  });
});
