import { describe, expect, it } from 'vitest';
import {
  computeLedger,
  computeTaxMinor,
  computeTrialBalance,
  computeVatSummary,
  journalTotals,
  periodsOverlap,
  validateJournalLines,
} from './accounting.js';

const line = (debitMinor: number, creditMinor: number, accountId = 'a1') => ({
  accountId,
  debitMinor,
  creditMinor,
});

describe('validateJournalLines', () => {
  it('accepts a balanced two-line entry', () => {
    expect(validateJournalLines([line(1000, 0), line(0, 1000, 'a2')])).toEqual([]);
  });

  it('rejects fewer than two lines', () => {
    expect(validateJournalLines([line(1000, 0)])).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'TOO_FEW_LINES' })]),
    );
  });

  it('rejects an unbalanced entry with the totals in the message', () => {
    const errors = validateJournalLines([line(1000, 0), line(0, 900, 'a2')]);
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNBALANCED' })]));
    expect(errors[0].message).toContain('1000');
  });

  it('rejects a line with both debit and credit, a zero line, and a debit-only entry', () => {
    expect(validateJournalLines([line(500, 500), line(0, 500, 'a2')])).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DEBIT_AND_CREDIT' })]),
    );
    expect(validateJournalLines([line(0, 0), line(0, 100, 'a2')])).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ZERO_LINE' })]),
    );
    expect(validateJournalLines([line(100, 0), line(200, 0, 'a2')])).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NO_CREDIT' })]),
    );
  });

  it('rejects negative amounts', () => {
    expect(validateJournalLines([line(-100, 0), line(0, 100, 'a2')])).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NEGATIVE_AMOUNT' })]),
    );
  });

  it('sums totals as bigint minor units', () => {
    expect(journalTotals([line(1000, 0), line(0, 1000, 'a2')])).toEqual({
      totalDebitMinor: 1000n,
      totalCreditMinor: 1000n,
    });
  });
});

describe('computeTaxMinor (half-up, integer minor units)', () => {
  it('computes 15% VAT exactly', () => {
    // 10,000.00 SAR = 1,000,000 halalas; 15% = 150,000 halalas.
    expect(computeTaxMinor(1000000n, 1500)).toBe(150000n);
    expect(computeTaxMinor(5000000n, 1500)).toBe(750000n);
  });

  it('rounds half-up on a .5 remainder', () => {
    // 10 halalas * 15% = 1.5 -> 2 (half-up), not 1.
    expect(computeTaxMinor(10n, 1500)).toBe(2n);
    // 1 halala * 15% = 0.15 -> 0.
    expect(computeTaxMinor(1n, 1500)).toBe(0n);
    // 0% and exempt rates give zero.
    expect(computeTaxMinor(1000000n, 0)).toBe(0n);
  });

  it('rejects out-of-range rates', () => {
    expect(() => computeTaxMinor(100n, 10001)).toThrow();
    expect(() => computeTaxMinor(100n, -1)).toThrow();
  });
});

describe('computeTrialBalance', () => {
  it('computes closing debit/credit from opening + period movement and stays balanced', () => {
    const { rows, totals } = computeTrialBalance([
      {
        accountId: 'cash', accountCode: '1010', accountName: 'Cash', accountType: 'ASSET',
        openingDebitMinor: 25000000n, openingCreditMinor: 0n, periodDebitMinor: 1150000n, periodCreditMinor: 5700000n,
      },
      {
        accountId: 'cap', accountCode: '3000', accountName: 'Capital', accountType: 'EQUITY',
        openingDebitMinor: 0n, openingCreditMinor: 19450000n, periodDebitMinor: 0n, periodCreditMinor: 0n,
      },
      {
        accountId: 'sales', accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE',
        openingDebitMinor: 0n, openingCreditMinor: 0n, periodDebitMinor: 0n, periodCreditMinor: 1000000n,
      },
    ]);
    const cash = rows.find((r) => r.accountCode === '1010')!;
    expect(cash.closingNetMinor).toBe(25000000n + 1150000n - 5700000n);
    expect(cash.closingDebitMinor).toBe(cash.closingNetMinor);
    expect(cash.closingCreditMinor).toBe(0n);
    const capital = rows.find((r) => r.accountCode === '3000')!;
    expect(capital.closingCreditMinor).toBe(19450000n);
    expect(capital.closingDebitMinor).toBe(0n);
    expect(totals.closingDebitMinor).toBe(totals.closingCreditMinor);
  });

  it('drops accounts with no opening balance and no movement', () => {
    const { rows } = computeTrialBalance([
      {
        accountId: 'x', accountCode: '9999', accountName: 'Empty', accountType: 'ASSET',
        openingDebitMinor: 0n, openingCreditMinor: 0n, periodDebitMinor: 0n, periodCreditMinor: 0n,
      },
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('computeLedger', () => {
  it('runs a balance from the opening net in date order', () => {
    const { openingNetMinor, lines, closingNetMinor } = computeLedger(10000n, 2000n, [
      { entryDate: '2026-11-10', entryNumber: 'JE-2026-00002', debitMinor: 500n, creditMinor: 0n },
      { entryDate: '2026-11-03', entryNumber: 'JE-2026-00001', debitMinor: 0n, creditMinor: 3000n },
    ]);
    expect(openingNetMinor).toBe(8000n);
    expect(lines[0].entryNumber).toBe('JE-2026-00001');
    expect(lines[0].runningBalanceMinor).toBe(5000n);
    expect(lines[1].runningBalanceMinor).toBe(5500n);
    expect(closingNetMinor).toBe(5500n);
  });
});

describe('computeVatSummary', () => {
  it('splits output vs input VAT by account type and nets them', () => {
    const s = computeVatSummary([
      { accountType: 'REVENUE', accountCode: '4010', debitMinor: 0n, creditMinor: 1000000n, taxRateBps: 1500 },
      { accountType: 'EXPENSE', accountCode: '5100', debitMinor: 5000000n, creditMinor: 0n, taxRateBps: 1500 },
      { accountType: 'ASSET', accountCode: '1020', debitMinor: 1000000n, creditMinor: 0n, taxRateBps: 1500 },
    ]);
    expect(s.outputVatMinor).toBe(150000n);
    // Input: the expense line (750,000) plus the asset debit line (150,000)
    // — a debit to an ASSET or EXPENSE account with a tax rate counts as input VAT.
    expect(s.inputVatMinor).toBe(900000n);
    expect(s.netVatPayableMinor).toBe(-750000n);
  });

  it('ignores lines without a tax rate or with a zero rate', () => {
    expect(computeVatSummary([
      { accountType: 'REVENUE', accountCode: '4010', debitMinor: 0n, creditMinor: 1000000n, taxRateBps: null },
      { accountType: 'REVENUE', accountCode: '4010', debitMinor: 0n, creditMinor: 1000000n, taxRateBps: 0 },
    ])).toEqual({ outputVatMinor: 0n, inputVatMinor: 0n, netVatPayableMinor: 0n });
  });
});

describe('periodsOverlap', () => {
  it('detects overlapping and adjacent-but-disjoint ranges', () => {
    expect(periodsOverlap({ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-01-15', end: '2026-02-28' })).toBe(true);
    expect(periodsOverlap({ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-02-01', end: '2026-02-28' })).toBe(false);
    expect(periodsOverlap({ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-01-31', end: '2026-02-28' })).toBe(true);
  });
});
