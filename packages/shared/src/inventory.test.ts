import { describe, expect, it } from 'vitest';
import {
  availableQty,
  cashVarianceMinor,
  computeShiftTotals,
  consumeFifo,
  expectedCashMinor,
  isLowStock,
  unitIssueCost,
  weightedAverageCost,
} from './inventory.js';

describe('consumeFifo', () => {
  const layers = [
    { id: 'l1', quantityRemaining: 10n, unitCostMinor: 2800n },
    { id: 'l2', quantityRemaining: 20n, unitCostMinor: 3000n },
  ];

  it('consumes the oldest layer first', () => {
    const r = consumeFifo(layers, 15n);
    expect(r.consumed).toEqual([
      { layerId: 'l1', quantity: 10n, unitCostMinor: 2800n, totalCostMinor: 28000n },
      { layerId: 'l2', quantity: 5n, unitCostMinor: 3000n, totalCostMinor: 15000n },
    ]);
    expect(r.totalCostMinor).toBe(43000n);
    expect(r.remaining).toEqual([
      { id: 'l1', quantityRemaining: 0n, unitCostMinor: 2800n },
      { id: 'l2', quantityRemaining: 15n, unitCostMinor: 3000n },
    ]);
  });

  it('consumes a partial layer and leaves the rest untouched', () => {
    const r = consumeFifo(layers, 4n);
    expect(r.totalCostMinor).toBe(11200n);
    expect(r.remaining[0].quantityRemaining).toBe(6n);
    expect(r.remaining[1].quantityRemaining).toBe(20n);
  });

  it('throws when the layers do not hold enough units', () => {
    expect(() => consumeFifo(layers, 31n)).toThrow(/Insufficient stock/);
  });

  it('consuming zero leaves layers unchanged', () => {
    const r = consumeFifo(layers, 0n);
    expect(r.totalCostMinor).toBe(0n);
    expect(r.consumed).toEqual([]);
  });
});

describe('weightedAverageCost', () => {
  it('recomputes the average on receipt', () => {
    // 10 @ 2800 on hand, receive 10 @ 3000 -> avg (28000+30000)/20 = 2900.
    expect(weightedAverageCost(10n, 2800n, 10n, 3000n)).toBe(2900n);
  });

  it('first receipt sets the average to the receipt cost', () => {
    expect(weightedAverageCost(0n, 0n, 5n, 1234n)).toBe(1234n);
  });

  it('returns 0 when nothing is on hand', () => {
    expect(weightedAverageCost(0n, 0n, 0n, 0n)).toBe(0n);
  });
});

describe('unitIssueCost', () => {
  it('STANDARD always uses the standard cost', () => {
    expect(unitIssueCost('STANDARD', { averageCostMinor: 2900n, standardCostMinor: 2500n })).toBe(2500n);
  });

  it('WEIGHTED_AVERAGE uses the running average', () => {
    expect(unitIssueCost('WEIGHTED_AVERAGE', { averageCostMinor: 2900n, standardCostMinor: 2500n })).toBe(2900n);
  });
});

describe('availableQty / isLowStock', () => {
  it('available = on hand minus reserved', () => {
    expect(availableQty(30n, 12n)).toBe(18n);
    expect(availableQty(5n, 10n)).toBe(-5n);
  });

  it('low stock at or below the reorder point', () => {
    expect(isLowStock(50n, 50n)).toBe(true);
    expect(isLowStock(49n, 50n)).toBe(true);
    expect(isLowStock(51n, 50n)).toBe(false);
  });
});

describe('POS shift totals', () => {
  it('sums sales, cash/card split and derives gross', () => {
    const t = computeShiftTotals([
      { subtotalMinor: 6998n, discountMinor: 0n, taxMinor: 1050n, totalMinor: 8048n, cashMinor: 8048n, cardMinor: 0n },
      { subtotalMinor: 3499n, discountMinor: 0n, taxMinor: 525n, totalMinor: 4024n, cashMinor: 0n, cardMinor: 4024n },
    ]);
    expect(t.salesCount).toBe(2);
    expect(t.grossMinor).toBe(10497n);
    expect(t.taxMinor).toBe(1575n);
    expect(t.netMinor).toBe(10497n);
    expect(t.cashMinor).toBe(8048n);
    expect(t.cardMinor).toBe(4024n);
  });

  it('expected cash and variance', () => {
    expect(expectedCashMinor(50000n, 8048n)).toBe(58048n);
    expect(cashVarianceMinor(58048n, 58048n)).toBe(0n);
    expect(cashVarianceMinor(57548n, 58048n)).toBe(-500n);
    expect(cashVarianceMinor(58548n, 58048n)).toBe(500n);
  });
});
