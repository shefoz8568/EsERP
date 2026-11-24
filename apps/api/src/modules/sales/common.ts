/**
 * Shared helpers for the Sales (Phase 3) and Purchasing (Phase 4) modules.
 *
 * - Account lookup by CoA code (leaf accounts used for postings).
 * - Numbering-series auto-creation (a tenant that never had an SO/PO/… series
 *   still gets a number; the series row is created inside the caller's tx).
 * - Document-line validation: every line's item must exist in this tenant.
 * - Open AR / AP: unpaid balances of POSTED / PARTIALLY_PAID invoices.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { computeDocLine, computeDocTotals } from '@eserp/shared';
import type { PrismaTx } from '../../common/prisma/prisma.service';
import { toJson } from '../master-data/serialize';

export const COA = {
  AR: '1110', // Customers - Local
  AP: '2010', // Suppliers - Local
  CASH: '1010', // Cash on Hand
  BANK: '1020', // Banks - Current Accounts
  CARD_CLEARING: '1030', // Card Payments Clearing (Phase 6)
  SALES_REVENUE: '4010', // Merchandise Sales
  PURCHASES: '5100', // Merchandise Purchases
  VAT_OUTPUT: '2110', // VAT - Output Tax
  VAT_INPUT: '2120', // VAT - Input Tax
  GRNI: '2020', // Goods Received Not Invoiced (Phase 5)
  INVENTORY: '1210', // Merchandise Inventory
  COGS: '5010', // Cost of Goods Sold (Phase 5)
  INV_ADJ_EXPENSE: '5240', // Inventory Adjustments and Shrinkage (Phase 5)
  INV_ADJ_GAIN: '4110', // Inventory Adjustment Gains (Phase 5)
  CASH_OVER_SHORT: '5250', // Cash Over / Short (Phase 6)
  WIP: '1220', // Work in Progress (Phase 7)
  FINISHED_GOODS: '1230', // Finished Goods Inventory (Phase 7)
  SCRAP_LOSS: '5260', // Scrap Loss (Phase 7)
  SALARIES: '5210', // Salaries and Wages
  GOSI_EMPLOYER_EXPENSE: '5211', // GOSI Employer Contributions (Phase 8)
  EOSB_EXPENSE: '5212', // End of Service Benefits Expense (Phase 8)
  GOSI_PAYABLE: '2210', // GOSI Payable (Phase 8)
  SALARIES_PAYABLE: '2220', // Net Salaries Payable (Phase 8)
  EOSB_PROVISION: '2230', // End of Service Provision (Phase 8)
  OTHER_DEDUCTIONS_PAYABLE: '2240', // Other Payroll Deductions Payable (Phase 8)
} as const;

/** Cash/bank account for a payment method: CASH -> 1010, everything else -> 1020. */
export function cashAccountCode(method: string): string {
  return method === 'CASH' ? COA.CASH : COA.BANK;
}

export async function findAccountByCode(tx: PrismaTx, tenantId: string, code: string): Promise<any> {
  const account = await (tx as any).chartOfAccounts.findFirst({ where: { tenantId, code } });
  if (!account) {
    throw new BadRequestException(
      `Chart of accounts has no account ${code} for this tenant — run onboarding step 2 (Saudi CoA) first`,
    );
  }
  return account;
}

const SERIES_PATTERNS: Record<string, { name: string; pattern: string }> = {
  QUO: { name: 'Quotations', pattern: 'QUO-{YYYY}-{SEQ:5}' },
  SO: { name: 'Sales Orders', pattern: 'SO-{YYYY}-{SEQ:5}' },
  INV: { name: 'Sales Invoices', pattern: 'INV-{YYYY}-{SEQ:5}' },
  PAY: { name: 'Customer Payments', pattern: 'PAY-{YYYY}-{SEQ:5}' },
  PO: { name: 'Purchase Orders', pattern: 'PO-{YYYY}-{SEQ:5}' },
  SIN: { name: 'Supplier Invoices', pattern: 'SIN-{YYYY}-{SEQ:5}' },
  SPAY: { name: 'Supplier Payments', pattern: 'SPAY-{YYYY}-{SEQ:5}' },
  GRN: { name: 'Goods Receipts', pattern: 'GRN-{YYYY}-{SEQ:5}' },
  DN: { name: 'Delivery Notes', pattern: 'DN-{YYYY}-{SEQ:5}' },
  ADJ: { name: 'Stock Adjustments', pattern: 'ADJ-{YYYY}-{SEQ:5}' },
  TRF: { name: 'Stock Transfers', pattern: 'TRF-{YYYY}-{SEQ:5}' },
  CNT: { name: 'Stock Counts', pattern: 'CNT-{YYYY}-{SEQ:5}' },
  POS: { name: 'POS Sales', pattern: 'POS-{YYYY}-{SEQ:5}' },
  WO: { name: 'Work Orders', pattern: 'WO-{YYYY}-{SEQ:5}' },
  MI: { name: 'Material Issues', pattern: 'MI-{YYYY}-{SEQ:5}' },
  PR: { name: 'Production Receipts', pattern: 'PR-{YYYY}-{SEQ:5}' },
  SCR: { name: 'Scrap Records', pattern: 'SCR-{YYYY}-{SEQ:5}' },
};

export async function ensureSeries(tx: PrismaTx, tenantId: string, actorId: string, code: string): Promise<void> {
  const existing = await (tx as any).numberingSeries.findUnique({ where: { code_tenantId: { code, tenantId } } });
  if (existing) return;
  const def = SERIES_PATTERNS[code] ?? { name: code, pattern: `${code}-{YYYY}-{SEQ:5}` };
  await (tx as any).numberingSeries.create({
    data: { tenantId, code, name: def.name, pattern: def.pattern, nextNumber: 1, createdBy: actorId },
  });
}

export interface ValidatedLine {
  itemId: string;
  quantity: number;
  unitPriceMinor: number;
  discountPct: number;
  taxRateBps: number;
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

/** Validate line items exist in this tenant and compute their money columns. */
export async function validateDocLines(
  tx: PrismaTx,
  tenantId: string,
  lines: { itemId: string; quantity: number; unitPriceMinor: number; discountPct?: number; taxRateBps?: number }[],
): Promise<{ validated: ValidatedLine[]; totals: ReturnType<typeof computeDocTotals> }> {
  const validated: ValidatedLine[] = [];
  for (const line of lines) {
    const item = await (tx as any).item.findUnique({ where: { id: line.itemId } });
    if (!item || item.tenantId !== tenantId) {
      throw new BadRequestException(`Item not found: ${line.itemId}`);
    }
    const t = computeDocLine({
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountPct: line.discountPct ?? 0,
      taxRateBps: line.taxRateBps ?? 1500,
    });
    validated.push({
      itemId: line.itemId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discountPct: line.discountPct ?? 0,
      taxRateBps: line.taxRateBps ?? 1500,
      grossMinor: t.grossMinor,
      discountMinor: t.discountMinor,
      netMinor: t.netMinor,
      taxMinor: t.taxMinor,
      totalMinor: t.totalMinor,
    });
  }
  const totals = computeDocTotals(
    validated.map((v) => ({ quantity: v.quantity, unitPriceMinor: v.unitPriceMinor, discountPct: v.discountPct, taxRateBps: v.taxRateBps })),
  );
  return { validated, totals };
}

/** Fetch a contact of the expected type(s); 404 when missing or wrong tenant. */
export async function getContact(tx: PrismaTx, tenantId: string, id: string, types?: string[]): Promise<any> {
  const contact = await (tx as any).contact.findUnique({ where: { id } });
  if (!contact || contact.tenantId !== tenantId) throw new NotFoundException('Contact not found');
  if (types && !types.includes(contact.type)) {
    throw new BadRequestException(`Contact ${contact.displayName} is a ${contact.type}, not ${types.join(' or ')}`);
  }
  return contact;
}

/** Open AR for a customer: sum of (total - paid) over POSTED/PARTIALLY_PAID invoices (credit notes reduce it). */
export async function openArMinor(tx: PrismaTx, tenantId: string, customerId: string): Promise<bigint> {
  const rows: any[] = await (tx as any).salesInvoice.findMany({
    where: { tenantId, customerId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
    select: { totalMinor: true, paidMinor: true },
  });
  return rows.reduce((s: bigint, r: any) => s + (BigInt(r.totalMinor) - BigInt(r.paidMinor)), 0n);
}

/** Open AP for a supplier: same shape over supplier invoices. */
export async function openApMinor(tx: PrismaTx, tenantId: string, supplierId: string): Promise<bigint> {
  const rows: any[] = await (tx as any).supplierInvoice.findMany({
    where: { tenantId, supplierId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
    select: { totalMinor: true, paidMinor: true },
  });
  return rows.reduce((s: bigint, r: any) => s + (BigInt(r.totalMinor) - BigInt(r.paidMinor)), 0n);
}

/** Due date = invoice date + the contact's payment terms (days). */
export function dueDateFor(invoiceDate: Date | string, paymentTermsDays: number): Date {
  const d = new Date(invoiceDate);
  d.setUTCDate(d.getUTCDate() + (paymentTermsDays || 0));
  return d;
}

/** Serialise a document row: BigInts -> numbers, and compute a quote's live status. */
export function quoteWithLiveStatus<T extends { status: string; validTo: Date | string }>(row: T): T {
  if (row.status === 'SENT' && new Date(row.validTo).getTime() < Date.now()) {
    return { ...row, status: 'EXPIRED' };
  }
  return row;
}

export { toJson };
