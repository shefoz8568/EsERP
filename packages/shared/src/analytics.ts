/**
 * Phase 10 — Analytics: pure financial-statement and KPI aggregation math.
 *
 * All amounts are integer minor units (bigint) — never floats. These
 * functions take already-fetched ledger rows and return statement totals;
 * they never touch the database. Derivation rules are documented in
 * docs/erd-phase10.md.
 *
 * P&L: revenue = net credit of REVENUE accounts; COGS = net debit of
 * account 5010 only (the Saudi CoA's COGS account); operating expenses =
 * net debit of all other EXPENSE accounts. Net income = revenue - COGS -
 * operating expenses. Only POSTED/REVERSED journal lines in the period
 * count; DRAFTs never count.
 *
 * Balance sheet (at a date): account balance = opening (debit - credit)
 * + posted movements with entryDate <= asOf. Assets = net debit of ASSET
 * accounts; liabilities = net credit of LIABILITY accounts; equity = net
 * credit of EQUITY accounts + current-period net income (the P&L result
 * for the fiscal year to date, passed in as `netIncomeMinor`). A
 * balance sheet balances by construction when every posting is balanced
 * and opening balances are balanced; `differenceMinor` reports any gap.
 *
 * Cash flow (simple indirect presentation): starts from net income and
 * adjusts for the change in working-capital accounts between two dates
 * (AR 1110, inventory 1210/1220/1230, other assets, AP 2010, payroll
 * payables 2210–2240, VAT 2110/2120, other liabilities), investing =
 * change in fixed assets (14xx), financing = change in equity excluding
 * net income + change in loans (23xx/24xx). The three sections must sum
 * to the change in cash (1010 + 1020 + 1030); `differenceMinor` reports
 * any gap (0 when the ledger is complete).
 */

export interface LedgerRow {
  accountCode: string;
  accountType: string; // ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  debitMinor: bigint | number;
  creditMinor: bigint | number;
}

const toBig = (v: bigint | number): bigint => (typeof v === 'bigint' ? v : BigInt(v));

/** Net debit (positive) / net credit (negative) of one ledger row. */
export function netDebit(row: LedgerRow): bigint {
  return toBig(row.debitMinor) - toBig(row.creditMinor);
}

export interface ProfitLoss {
  revenueMinor: bigint;
  cogsMinor: bigint;
  grossProfitMinor: bigint;
  operatingExpensesMinor: bigint;
  netIncomeMinor: bigint;
  /** Gross margin in basis points, null when revenue is 0. */
  grossMarginBps: number | null;
  /** Net margin in basis points, null when revenue is 0. */
  netMarginBps: number | null;
}

/** COGS is the Saudi CoA account 5010 only (see module doc). */
export const COGS_ACCOUNT_CODE = '5010';

/** Profit & loss from posted journal lines of one period. */
export function computeProfitLoss(rows: LedgerRow[]): ProfitLoss {
  let revenue = 0n;
  let cogs = 0n;
  let opex = 0n;
  for (const row of rows) {
    const net = netDebit(row);
    if (row.accountType === 'REVENUE') revenue -= net; // revenue is a net credit
    else if (row.accountType === 'EXPENSE') {
      if (row.accountCode === COGS_ACCOUNT_CODE) cogs += net;
      else opex += net;
    }
  }
  const gross = revenue - cogs;
  const netIncome = gross - opex;
  return {
    revenueMinor: revenue,
    cogsMinor: cogs,
    grossProfitMinor: gross,
    operatingExpensesMinor: opex,
    netIncomeMinor: netIncome,
    grossMarginBps: revenue === 0n ? null : Number((gross * 10_000n) / revenue),
    netMarginBps: revenue === 0n ? null : Number((netIncome * 10_000n) / revenue),
  };
}

export interface BalanceSheet {
  assetsMinor: bigint;
  liabilitiesMinor: bigint;
  equityMinor: bigint;
  netIncomeMinor: bigint;
  /** liabilities + equity + net income — must equal assets. */
  totalLiabilitiesEquityMinor: bigint;
  differenceMinor: bigint;
  balanced: boolean;
}

/** Balance sheet from account balances at a date (see module doc). */
export function computeBalanceSheet(rows: LedgerRow[], netIncomeMinor: bigint | number): BalanceSheet {
  let assets = 0n;
  let liabilities = 0n;
  let equity = 0n;
  for (const row of rows) {
    const net = netDebit(row);
    if (row.accountType === 'ASSET') assets += net;
    else if (row.accountType === 'LIABILITY') liabilities -= net; // liabilities are net credits
    else if (row.accountType === 'EQUITY') equity -= net;
  }
  const ni = toBig(netIncomeMinor);
  const totalLE = liabilities + equity + ni;
  return {
    assetsMinor: assets,
    liabilitiesMinor: liabilities,
    equityMinor: equity,
    netIncomeMinor: ni,
    totalLiabilitiesEquityMinor: totalLE,
    differenceMinor: assets - totalLE,
    balanced: assets === totalLE,
  };
}

export interface AccountBalanceChange {
  accountCode: string;
  accountType: string;
  /** Balance (net debit) at the start of the period. */
  openingNetDebitMinor: bigint | number;
  /** Balance (net debit) at the end of the period. */
  closingNetDebitMinor: bigint | number;
}

export interface CashFlow {
  netIncomeMinor: bigint;
  operatingMinor: bigint;
  investingMinor: bigint;
  financingMinor: bigint;
  netChangeInCashMinor: bigint;
  /** Change in cash accounts (1010 + 1020 + 1030) over the period. */
  actualCashChangeMinor: bigint;
  differenceMinor: bigint;
  balanced: boolean;
}

const isCode = (code: string, prefixes: string[]): boolean => prefixes.some((p) => code.startsWith(p));

/**
 * Simple indirect cash flow from the change in account balances.
 * Working-capital adjustments use balance changes (closing - opening,
 * net debit). A rise in an asset is a cash outflow; a rise in a
 * liability/equity item is a cash inflow. Investing is the change in
 * fixed assets (14xx); financing is the change in equity excluding net
 * income plus loans (23xx/24xx).
 */
export function computeCashFlow(
  changes: AccountBalanceChange[],
  netIncomeMinor: bigint | number,
  actualCashChangeMinor: bigint | number,
): CashFlow {
  const ni = toBig(netIncomeMinor);
  let operating = ni;
  let investing = 0n;
  let financing = 0n;
  for (const c of changes) {
    const delta = toBig(c.closingNetDebitMinor) - toBig(c.openingNetDebitMinor);
    if (isCode(c.accountCode, ['1010', '1020', '1030'])) continue; // cash itself
    if (isCode(c.accountCode, ['14'])) {
      investing -= delta; // buying fixed assets is a cash outflow
    } else if (c.accountType === 'ASSET') {
      operating -= delta; // asset up = cash out
    } else if (c.accountType === 'EQUITY') {
      financing -= delta; // equity up (net credit rises, net debit falls) = cash in
    } else if (c.accountType === 'LIABILITY') {
      if (isCode(c.accountCode, ['23', '24'])) financing -= delta; // loan balance up (net credit falls in net-debit terms) = cash in
      else operating -= delta; // other liability up = cash in
    }
  }
  const netChange = operating + investing + financing;
  const actual = toBig(actualCashChangeMinor);
  return {
    netIncomeMinor: ni,
    operatingMinor: operating,
    investingMinor: investing,
    financingMinor: financing,
    netChangeInCashMinor: netChange,
    actualCashChangeMinor: actual,
    differenceMinor: netChange - actual,
    balanced: netChange === actual,
  };
}

/** Trend in basis points: (current - previous) / previous, null when previous is 0. */
export function trendBps(current: bigint | number, previous: bigint | number): number | null {
  const cur = toBig(current);
  const prev = toBig(previous);
  if (prev === 0n) return null;
  return Number(((cur - prev) * 10_000n) / prev);
}
