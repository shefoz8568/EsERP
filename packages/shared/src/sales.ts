/**
 * Phase 3/4 — Sales & Purchasing: pure document math.
 *
 * All amounts are integer minor units (bigint, halalas for SAR) — never
 * floats. Tax is derived per line as round_half_up(net * rateBps / 10000),
 * the same half-up rule computeTaxMinor uses (see accounting.ts).
 *
 * Line math (per line):
 *   gross    = quantity * unitPriceMinor
 *   discount = round_half_up(gross * discountPct / 100)
 *   net      = gross - discount
 *   tax      = round_half_up(net * taxRateBps / 10000)
 *   total    = net + tax
 * Document totals are the sums of the line columns.
 */

import { computeTaxMinor } from './accounting.js';

export interface DocLineInput {
  quantity: bigint | number;
  unitPriceMinor: bigint | number;
  /** Discount percent, 0..100 (whole percent). */
  discountPct?: number;
  /** VAT rate in basis points, 1500 = 15%. */
  taxRateBps?: number;
}

export interface DocLineTotals {
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/** round_half_up(numerator / denominator) for non-negative bigints. */
function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function computeDocLine(input: DocLineInput): DocLineTotals {
  const quantity = toBig(input.quantity);
  const unitPriceMinor = toBig(input.unitPriceMinor);
  const discountPct = input.discountPct ?? 0;
  const taxRateBps = input.taxRateBps ?? 0;
  if (quantity < 0n) throw new Error('Quantity must not be negative');
  if (unitPriceMinor < 0n) throw new Error('Unit price must not be negative');
  if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new Error('discountPct must be an integer between 0 and 100');
  }
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
    throw new Error('taxRateBps must be an integer between 0 and 10000');
  }
  const grossMinor = quantity * unitPriceMinor;
  const discountMinor = divHalfUp(grossMinor * BigInt(discountPct), 100n);
  const netMinor = grossMinor - discountMinor;
  const taxMinor = computeTaxMinor(netMinor, taxRateBps);
  return { grossMinor, discountMinor, netMinor, taxMinor, totalMinor: netMinor + taxMinor };
}

export interface DocTotals {
  subtotalMinor: bigint; // sum of line nets (gross - discount)
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export function computeDocTotals(lines: DocLineInput[]): DocTotals {
  let subtotalMinor = 0n;
  let discountMinor = 0n;
  let taxMinor = 0n;
  let totalMinor = 0n;
  for (const line of lines) {
    const t = computeDocLine(line);
    subtotalMinor += t.netMinor;
    discountMinor += t.discountMinor;
    taxMinor += t.taxMinor;
    totalMinor += t.totalMinor;
  }
  return { subtotalMinor, discountMinor, taxMinor, totalMinor };
}

// --- AR/AP aging ------------------------------------------------------------

export type AgingBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export interface AgingInputRow {
  balanceMinor: bigint;
  /** Days past due: negative = not yet due. */
  daysPastDue: number;
}

export interface AgingResult {
  currentMinor: bigint;
  d1_30Minor: bigint;
  d31_60Minor: bigint;
  d61_90Minor: bigint;
  d90PlusMinor: bigint;
  totalMinor: bigint;
}

/** Bucket for one invoice balance by days past due (CURRENT = not yet due). */
export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return 'CURRENT';
  if (daysPastDue <= 30) return 'D1_30';
  if (daysPastDue <= 60) return 'D31_60';
  if (daysPastDue <= 90) return 'D61_90';
  return 'D90_PLUS';
}

/** Whole days between two dates (due -> asOf), ignoring time of day. */
export function daysPastDue(dueDate: Date | string, asOf: Date | string): number {
  const day = 24 * 60 * 60 * 1000;
  const due = new Date(new Date(dueDate).toISOString().slice(0, 10));
  const ref = new Date(new Date(asOf).toISOString().slice(0, 10));
  return Math.floor((ref.getTime() - due.getTime()) / day);
}

export function computeAging(rows: AgingInputRow[]): AgingResult {
  const out: AgingResult = {
    currentMinor: 0n, d1_30Minor: 0n, d31_60Minor: 0n, d61_90Minor: 0n, d90PlusMinor: 0n, totalMinor: 0n,
  };
  for (const row of rows) {
    if (row.balanceMinor <= 0n) continue;
    out.totalMinor += row.balanceMinor;
    switch (agingBucket(row.daysPastDue)) {
      case 'CURRENT': out.currentMinor += row.balanceMinor; break;
      case 'D1_30': out.d1_30Minor += row.balanceMinor; break;
      case 'D31_60': out.d31_60Minor += row.balanceMinor; break;
      case 'D61_90': out.d61_90Minor += row.balanceMinor; break;
      case 'D90_PLUS': out.d90PlusMinor += row.balanceMinor; break;
    }
  }
  return out;
}

// --- Credit limit -----------------------------------------------------------

/**
 * Credit-limit rule (Phase 3, documented in docs/erd-phase3.md):
 * confirming a sales order is blocked (400) when the customer's open AR
 * plus this order's total exceeds their credit limit. A limit of 0 means
 * "no limit set" and never blocks.
 */
export function creditLimitExceeded(openArMinor: bigint | number, orderTotalMinor: bigint | number, creditLimitMinor: bigint | number): boolean {
  const limit = toBig(creditLimitMinor);
  if (limit <= 0n) return false;
  return toBig(openArMinor) + toBig(orderTotalMinor) > limit;
}

// --- Three-way match (Phase 4) ----------------------------------------------

/** Price variance tolerance for the 3-way match: 5%. */
export const THREE_WAY_MATCH_PRICE_TOLERANCE_PCT = 5;

export interface ThreeWayMatchInput {
  poQuantity: bigint | number;
  /** Quantity already invoiced against this PO line (from other invoices). */
  alreadyInvoicedQuantity: bigint | number;
  invoiceQuantity: bigint | number;
  poUnitPriceMinor: bigint | number;
  invoiceUnitPriceMinor: bigint | number;
}

/**
 * 3-way match check (Phase 4, documented in docs/erd-phase4.md).
 * Returns an error message when the invoice line fails the match, else null.
 * Rules: invoiced qty (incl. this line) must not exceed the PO ordered qty;
 * unit-price variance over 5% blocks posting.
 */
export function threeWayMatchError(input: ThreeWayMatchInput): string | null {
  const poQty = toBig(input.poQuantity);
  const already = toBig(input.alreadyInvoicedQuantity);
  const invQty = toBig(input.invoiceQuantity);
  if (invQty <= 0n) return 'Invoice quantity must be positive';
  if (already + invQty > poQty) {
    return `Invoice quantity ${already + invQty} exceeds the purchase order quantity ${poQty}`;
  }
  const poPrice = toBig(input.poUnitPriceMinor);
  const invPrice = toBig(input.invoiceUnitPriceMinor);
  if (poPrice === 0n) {
    if (invPrice > 0n) return 'Purchase order unit price is 0 but the invoice charges a price';
    return null;
  }
  // |inv - po| * 100 > po * 5  <=>  variance over 5% (integer math, no floats).
  const diff = invPrice > poPrice ? invPrice - poPrice : poPrice - invPrice;
  if (diff * 100n > poPrice * BigInt(THREE_WAY_MATCH_PRICE_TOLERANCE_PCT)) {
    return `Unit price variance exceeds ${THREE_WAY_MATCH_PRICE_TOLERANCE_PCT}% tolerance (PO ${poPrice}, invoice ${invPrice})`;
  }
  return null;
}
