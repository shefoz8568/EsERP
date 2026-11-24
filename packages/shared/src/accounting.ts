/**
 * Phase 2 — Accounting: pure double-entry math.
 *
 * All amounts are integer minor units (bigint, halalas for SAR) — never
 * floats. Tax is derived as round-half-up(lineAmount * rateBps / 10000),
 * the same half-up rule Money.multiplyByRational uses.
 */

export interface JournalLineInput {
  accountId: string;
  debitMinor: bigint | number;
  creditMinor: bigint | number;
  taxRateId?: string | null;
  costCenterId?: string | null;
  description?: string | null;
  lineOrder?: number;
}

export interface JournalValidationError {
  code: string;
  message: string;
}

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/**
 * Validate a set of journal lines. Returns a list of errors (empty = valid).
 * Rules: >= 2 lines; at least one debit and one credit; sum(debit) ==
 * sum(credit); no line with both debit and credit > 0; no zero-amount lines;
 * no negative amounts; all amounts integer minor units.
 */
export function validateJournalLines(lines: JournalLineInput[]): JournalValidationError[] {
  const errors: JournalValidationError[] = [];
  if (!Array.isArray(lines) || lines.length < 2) {
    errors.push({ code: 'TOO_FEW_LINES', message: 'A journal entry needs at least two lines' });
    return errors;
  }
  let totalDebit = 0n;
  let totalCredit = 0n;
  let hasDebit = false;
  let hasCredit = false;
  lines.forEach((line, i) => {
    const d = toBig(line.debitMinor);
    const c = toBig(line.creditMinor);
    if (d < 0n || c < 0n) {
      errors.push({ code: 'NEGATIVE_AMOUNT', message: `Line ${i + 1}: amounts must not be negative` });
    }
    if (d > 0n && c > 0n) {
      errors.push({ code: 'DEBIT_AND_CREDIT', message: `Line ${i + 1}: a line cannot have both a debit and a credit` });
    }
    if (d === 0n && c === 0n) {
      errors.push({ code: 'ZERO_LINE', message: `Line ${i + 1}: a line cannot be zero` });
    }
    if (d > 0n) hasDebit = true;
    if (c > 0n) hasCredit = true;
    totalDebit += d;
    totalCredit += c;
  });
  if (!hasDebit) errors.push({ code: 'NO_DEBIT', message: 'A journal entry needs at least one debit line' });
  if (!hasCredit) errors.push({ code: 'NO_CREDIT', message: 'A journal entry needs at least one credit line' });
  if (totalDebit !== totalCredit) {
    errors.push({
      code: 'UNBALANCED',
      message: `Debits (${totalDebit}) must equal credits (${totalCredit})`,
    });
  }
  return errors;
}

export function journalTotals(lines: JournalLineInput[]): { totalDebitMinor: bigint; totalCreditMinor: bigint } {
  let totalDebitMinor = 0n;
  let totalCreditMinor = 0n;
  for (const line of lines) {
    totalDebitMinor += toBig(line.debitMinor);
    totalCreditMinor += toBig(line.creditMinor);
  }
  return { totalDebitMinor, totalCreditMinor };
}

/**
 * Tax amount for one journal line, in minor units:
 *   tax = round_half_up(lineAmount * rateBps / 10000)
 * where lineAmount = debit + credit (exactly one is non-zero on a valid
 * line). Half-up on the exact rational result: (amount * bps * 2 + 10000)
 * / 20000 for non-negative amounts. rateBps 1500 = 15% VAT.
 */
export function computeTaxMinor(lineAmountMinor: bigint | number, rateBps: number): bigint {
  const amount = toBig(lineAmountMinor);
  if (amount < 0n) throw new Error('Tax cannot be computed on a negative amount');
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
    throw new Error('rateBps must be an integer between 0 and 10000');
  }
  return (amount * BigInt(rateBps) * 2n + 10000n) / 20000n;
}

/** Do two date ranges overlap (inclusive on both ends)? Pure helper for period rules. */
export function periodsOverlap(
  a: { start: Date | string; end: Date | string },
  b: { start: Date | string; end: Date | string },
): boolean {
  const aStart = new Date(a.start).getTime();
  const aEnd = new Date(a.end).getTime();
  const bStart = new Date(b.start).getTime();
  const bEnd = new Date(b.end).getTime();
  return aStart <= bEnd && bStart <= aEnd;
}

// --- Trial balance ---------------------------------------------------------

export interface TrialBalanceInputRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string; // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  openingDebitMinor: bigint;
  openingCreditMinor: bigint;
  periodDebitMinor: bigint;
  periodCreditMinor: bigint;
}

export interface TrialBalanceRow extends TrialBalanceInputRow {
  /** Signed net: debit-positive (opening debit - opening credit + debits - credits). */
  closingNetMinor: bigint;
  closingDebitMinor: bigint;
  closingCreditMinor: bigint;
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totals: {
    openingDebitMinor: bigint;
    openingCreditMinor: bigint;
    periodDebitMinor: bigint;
    periodCreditMinor: bigint;
    closingDebitMinor: bigint;
    closingCreditMinor: bigint;
  };
}

/**
 * Trial balance: one row per account that has an opening balance or period
 * movement. Closing net = (openingDebit - openingCredit) + periodDebit -
 * periodCredit; the net is then split into a closing debit (>= 0) or
 * closing credit (>= 0) column. In a balanced ledger the closing debit
 * total equals the closing credit total.
 */
export function computeTrialBalance(rows: TrialBalanceInputRow[]): TrialBalanceResult {
  const out: TrialBalanceRow[] = rows
    .filter(
      (r) =>
        r.openingDebitMinor !== 0n || r.openingCreditMinor !== 0n || r.periodDebitMinor !== 0n || r.periodCreditMinor !== 0n,
    )
    .map((r) => {
      const closingNetMinor =
        (r.openingDebitMinor - r.openingCreditMinor) + (r.periodDebitMinor - r.periodCreditMinor);
      return {
        ...r,
        closingNetMinor,
        closingDebitMinor: closingNetMinor > 0n ? closingNetMinor : 0n,
        closingCreditMinor: closingNetMinor < 0n ? -closingNetMinor : 0n,
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const sum = (f: (r: TrialBalanceRow) => bigint): bigint => out.reduce((acc, r) => acc + f(r), 0n);
  return {
    rows: out,
    totals: {
      openingDebitMinor: sum((r) => r.openingDebitMinor),
      openingCreditMinor: sum((r) => r.openingCreditMinor),
      periodDebitMinor: sum((r) => r.periodDebitMinor),
      periodCreditMinor: sum((r) => r.periodCreditMinor),
      closingDebitMinor: sum((r) => r.closingDebitMinor),
      closingCreditMinor: sum((r) => r.closingCreditMinor),
    },
  };
}

// --- General ledger ----------------------------------------------------------

export interface LedgerInputLine {
  entryDate: Date | string;
  entryNumber: string;
  description?: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface LedgerLine extends LedgerInputLine {
  /** Signed running balance after this line (debit-positive). */
  runningBalanceMinor: bigint;
}

/**
 * General ledger for one account: running balance starts at the opening
 * net (openingDebit - openingCredit) and each line adds debit - credit.
 * Lines are applied in date order, then entry number (stable, deterministic).
 */
export function computeLedger(
  openingDebitMinor: bigint,
  openingCreditMinor: bigint,
  lines: LedgerInputLine[],
): { openingNetMinor: bigint; lines: LedgerLine[]; closingNetMinor: bigint } {
  const openingNetMinor = openingDebitMinor - openingCreditMinor;
  const sorted = [...lines].sort((a, b) => {
    const d = new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime();
    return d !== 0 ? d : a.entryNumber.localeCompare(b.entryNumber);
  });
  let running = openingNetMinor;
  const out: LedgerLine[] = sorted.map((l) => {
    running += l.debitMinor - l.creditMinor;
    return { ...l, runningBalanceMinor: running };
  });
  return { openingNetMinor, lines: out, closingNetMinor: running };
}

// --- VAT summary -------------------------------------------------------------

export interface VatInputLine {
  accountType: string;
  accountCode: string;
  debitMinor: bigint;
  creditMinor: bigint;
  taxRateBps: number | null;
}

export interface VatSummary {
  outputVatMinor: bigint;
  inputVatMinor: bigint;
  netVatPayableMinor: bigint;
}

/**
 * VAT summary (Saudi Arabia, 15% standard rate).
 *
 * Derivation — tax is computed per posted journal line that carries a
 * TaxRate link, as round_half_up(lineAmount * rateBps / 10000):
 * - Output VAT (collected): tax on a CREDIT line to a REVENUE account, or
 *   a credit line to a VAT-output liability account (code 211x).
 * - Input VAT (paid): tax on a DEBIT line to an ASSET or EXPENSE account.
 * - Lines of any other shape (e.g. a tax rate on a bank line) are ignored.
 * Net VAT payable = output - input (negative = refundable / carried forward).
 */
export function computeVatSummary(lines: VatInputLine[]): VatSummary {
  let outputVatMinor = 0n;
  let inputVatMinor = 0n;
  for (const line of lines) {
    if (line.taxRateBps === null || line.taxRateBps === 0) continue;
    const amount = line.debitMinor + line.creditMinor;
    if (amount === 0n) continue;
    const tax = computeTaxMinor(amount, line.taxRateBps);
    if (line.creditMinor > 0n && (line.accountType === 'REVENUE' || line.accountCode.startsWith('211'))) {
      outputVatMinor += tax;
    } else if (line.debitMinor > 0n && (line.accountType === 'ASSET' || line.accountType === 'EXPENSE' || line.accountCode === '2020')) {
      // 2020 Goods Received Not Invoiced is a LIABILITY, but a debit to it
      // with a tax rate is a taxable purchase received (Phase 5 GRNI relief
      // on supplier invoices) — it is an input-VAT base like purchases.
      inputVatMinor += tax;
    }
  }
  return { outputVatMinor, inputVatMinor, netVatPayableMinor: outputVatMinor - inputVatMinor };
}
