/**
 * Phase 7 — Manufacturing: pure BOM / work-order / WIP math.
 *
 * All amounts are integer minor units (bigint, halalas for SAR) and all
 * quantities are integer units (bigint) — never floats.
 *
 * BOM cost roll-up (documented in docs/erd-phase7.md):
 *   line cost = component standardCostMinor x quantityPerUnit x (1 + scrap)
 *   with scrap in basis points (500 = 5%); each line is rounded half-up to
 *   the minor unit, then summed.
 * WIP balance = material issued − production received − finished scrap.
 * Completion % = qtyProduced / qtyPlanned (may exceed 100 on over-production).
 */

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/** round_half_up(numerator / denominator) for non-negative bigints. */
function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export interface BomCostLineInput {
  standardCostMinor: bigint | number;
  quantityPerUnit: bigint | number;
  scrapBps?: number;
}

/** Standard cost of one finished unit of a BOM line (incl. scrap allowance). */
export function bomLineStandardCost(line: BomCostLineInput): bigint {
  const cost = toBig(line.standardCostMinor);
  const qty = toBig(line.quantityPerUnit);
  const scrapBps = line.scrapBps ?? 0;
  if (cost < 0n) throw new Error('Standard cost must not be negative');
  if (qty < 0n) throw new Error('Quantity per unit must not be negative');
  if (!Number.isInteger(scrapBps) || scrapBps < 0 || scrapBps > 10000) {
    throw new Error('scrapBps must be an integer between 0 and 10000');
  }
  return divHalfUp(cost * qty * BigInt(10000 + scrapBps), 10000n);
}

/** Computed standard cost of one finished unit = sum of the BOM lines. */
export function bomStandardCost(lines: BomCostLineInput[]): bigint {
  return lines.reduce((sum, line) => sum + bomLineStandardCost(line), 0n);
}

/**
 * Quantity of a component required for a work order, including the scrap
 * allowance: qtyPlanned x quantityPerUnit x (1 + scrap), rounded half-up.
 */
export function requiredQty(
  qtyPlanned: bigint | number,
  quantityPerUnit: bigint | number,
  scrapBps?: number,
): bigint {
  const planned = toBig(qtyPlanned);
  const perUnit = toBig(quantityPerUnit);
  const scrap = scrapBps ?? 0;
  if (planned < 0n || perUnit < 0n) throw new Error('Quantities must not be negative');
  if (!Number.isInteger(scrap) || scrap < 0 || scrap > 10000) {
    throw new Error('scrapBps must be an integer between 0 and 10000');
  }
  return divHalfUp(planned * perUnit * BigInt(10000 + scrap), 10000n);
}

/** WIP balance for a work order: issued − received − finished scrap. */
export function wipBalance(
  materialIssuedMinor: bigint | number,
  productionReceivedMinor: bigint | number,
  finishedScrapMinor: bigint | number,
): bigint {
  return toBig(materialIssuedMinor) - toBig(productionReceivedMinor) - toBig(finishedScrapMinor);
}

/**
 * Completion % of a work order (two decimals, e.g. 62.5). Returns 0 when
 * nothing was planned; may exceed 100 on over-production.
 */
export function completionPct(qtyProduced: bigint | number, qtyPlanned: bigint | number): number {
  const produced = toBig(qtyProduced);
  const planned = toBig(qtyPlanned);
  if (planned <= 0n) return 0;
  return Number((produced * 10000n) / planned) / 100;
}

/** Material cost variance on completion: actual − planned (+ % vs planned). */
export function materialVariance(
  plannedMinor: bigint | number,
  actualMinor: bigint | number,
): { varianceMinor: bigint; variancePct: number } {
  const planned = toBig(plannedMinor);
  const actual = toBig(actualMinor);
  const varianceMinor = actual - planned;
  const variancePct = planned === 0n ? 0 : Number((varianceMinor * 10000n) / planned) / 100;
  return { varianceMinor, variancePct };
}

/** Over-production flag: produced exceeds planned. */
export function isOverProduced(qtyProduced: bigint | number, qtyPlanned: bigint | number): boolean {
  return toBig(qtyProduced) > toBig(qtyPlanned);
}
