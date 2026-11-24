/**
 * Phase 5/6 — Inventory valuation + POS shift math (pure functions).
 *
 * All amounts are integer minor units (bigint, halalas for SAR) and all
 * quantities are integer units (bigint) — never floats.
 *
 * Valuation rules (documented in docs/erd-phase5.md):
 * - FIFO: issues consume the oldest cost layer first (by receivedAt, then
 *   creation order). A layer is fully consumed before the next is touched.
 * - WEIGHTED_AVERAGE: average cost = (prevQty*prevAvg + newQty*newCost) /
 *   (prevQty+newQty), integer division truncating toward zero (the remainder
 *   is < 1 minor unit per unit and is absorbed on the next receipt).
 * - STANDARD: issues are always valued at the item's standard cost.
 */

export interface CostLayerInput {
  id: string;
  quantityRemaining: bigint | number;
  unitCostMinor: bigint | number;
}

export interface ConsumedLayer {
  layerId: string;
  quantity: bigint;
  unitCostMinor: bigint;
  totalCostMinor: bigint;
}

export interface FifoConsumption {
  consumed: ConsumedLayer[];
  /** Total issue cost (sum of consumed qty x unit cost). */
  totalCostMinor: bigint;
  /** Layers after consumption (fully-consumed layers have qty 0). */
  remaining: { id: string; quantityRemaining: bigint; unitCostMinor: bigint }[];
}

/**
 * Consume `quantity` units from FIFO layers (oldest first — the caller
 * passes layers sorted by receivedAt ascending). Throws when the layers
 * do not hold enough units.
 */
export function consumeFifo(layers: CostLayerInput[], quantity: bigint | number): FifoConsumption {
  const qty = typeof quantity === 'bigint' ? quantity : BigInt(quantity);
  if (qty < 0n) throw new Error('Quantity must not be negative');
  if (qty === 0n) {
    return {
      consumed: [],
      totalCostMinor: 0n,
      remaining: layers.map((l) => ({ id: l.id, quantityRemaining: toBig(l.quantityRemaining), unitCostMinor: toBig(l.unitCostMinor) })),
    };
  }
  let left = qty;
  const consumed: ConsumedLayer[] = [];
  const remaining: FifoConsumption['remaining'] = [];
  for (const layer of layers) {
    const avail = toBig(layer.quantityRemaining);
    const cost = toBig(layer.unitCostMinor);
    if (left <= 0n) {
      remaining.push({ id: layer.id, quantityRemaining: avail, unitCostMinor: cost });
      continue;
    }
    const take = avail < left ? avail : left;
    if (take > 0n) consumed.push({ layerId: layer.id, quantity: take, unitCostMinor: cost, totalCostMinor: take * cost });
    remaining.push({ id: layer.id, quantityRemaining: avail - take, unitCostMinor: cost });
    left -= take;
  }
  if (left > 0n) throw new Error(`Insufficient stock in cost layers: short by ${left} units`);
  const totalCostMinor = consumed.reduce((s, c) => s + c.totalCostMinor, 0n);
  return { consumed, totalCostMinor, remaining };
}

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/**
 * Recompute the weighted-average unit cost after a receipt.
 * Returns 0 when the resulting quantity is 0.
 */
export function weightedAverageCost(
  prevQty: bigint | number,
  prevAvgMinor: bigint | number,
  newQty: bigint | number,
  newUnitCostMinor: bigint | number,
): bigint {
  const pq = toBig(prevQty);
  const nq = toBig(newQty);
  const total = pq + nq;
  if (total <= 0n) return 0n;
  if (total === nq) return toBig(newUnitCostMinor);
  return (pq * toBig(prevAvgMinor) + nq * toBig(newUnitCostMinor)) / total;
}

/** Issue cost for one unit under each costing method. */
export function unitIssueCost(
  costingMethod: string,
  opts: { averageCostMinor: bigint | number; standardCostMinor: bigint | number; fifoUnitCostMinor?: bigint | number },
): bigint {
  if (costingMethod === 'STANDARD') return toBig(opts.standardCostMinor);
  if (costingMethod === 'WEIGHTED_AVERAGE') return toBig(opts.averageCostMinor);
  // FIFO: the caller resolves the unit cost from the consumed layers; the
  // first (oldest) layer's unit cost is the per-unit figure for a 1-unit issue.
  return toBig(opts.fifoUnitCostMinor ?? opts.averageCostMinor);
}

/** Available stock = on hand minus reserved. */
export function availableQty(qtyOnHand: bigint | number, qtyReserved: bigint | number): bigint {
  return toBig(qtyOnHand) - toBig(qtyReserved);
}

/** An item is at/below its reorder point when on-hand <= reorder point. */
export function isLowStock(qtyOnHand: bigint | number, reorderPoint: bigint | number): boolean {
  return toBig(qtyOnHand) <= toBig(reorderPoint);
}

// --- POS shift math (Phase 6) ----------------------------------------------

export interface PosSaleTotalsInput {
  quantity: bigint | number;
  unitPriceMinor: bigint | number;
  discountPct?: number;
  taxRateBps?: number;
}

export interface ShiftTotals {
  salesCount: number;
  grossMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  netMinor: bigint;
  cashMinor: bigint;
  cardMinor: bigint;
}

/**
 * Z-report totals for a shift's COMPLETED sales. Each sale contributes its
 * stored net/tax/total plus its cash/card split; gross/discount are derived
 * from the sale lines when provided, else from net+discount.
 */
export function computeShiftTotals(
  sales: {
    subtotalMinor: bigint | number;
    discountMinor: bigint | number;
    taxMinor: bigint | number;
    totalMinor: bigint | number;
    cashMinor: bigint | number;
    cardMinor: bigint | number;
  }[],
): ShiftTotals {
  const out: ShiftTotals = {
    salesCount: sales.length,
    grossMinor: 0n,
    discountMinor: 0n,
    taxMinor: 0n,
    netMinor: 0n,
    cashMinor: 0n,
    cardMinor: 0n,
  };
  for (const s of sales) {
    out.grossMinor += toBig(s.subtotalMinor) + toBig(s.discountMinor);
    out.discountMinor += toBig(s.discountMinor);
    out.taxMinor += toBig(s.taxMinor);
    out.netMinor += toBig(s.subtotalMinor);
    out.cashMinor += toBig(s.cashMinor);
    out.cardMinor += toBig(s.cardMinor);
  }
  return out;
}

/** Expected cash in the drawer at close = opening float + cash sales. */
export function expectedCashMinor(openingFloatMinor: bigint | number, cashSalesMinor: bigint | number): bigint {
  return toBig(openingFloatMinor) + toBig(cashSalesMinor);
}

/** Cash variance = counted cash − expected cash (positive = over). */
export function cashVarianceMinor(countedCashMinor: bigint | number, expectedCashMinorValue: bigint | number): bigint {
  return toBig(countedCashMinor) - toBig(expectedCashMinorValue);
}
