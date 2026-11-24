import { describe, expect, it } from 'vitest';
import { Money, parseMoneyInput } from './money.js';

describe('Money', () => {
  it('adds and subtracts same-currency amounts', () => {
    expect(Money.fromMinor(1000, 'SAR').add(Money.fromMinor(500, 'SAR')).toMinorString()).toBe('1500');
    expect(Money.fromMinor(1000, 'SAR').subtract(Money.fromMinor(1500, 'SAR')).toMinorString()).toBe('-500');
    expect(Money.zero('SAR').toMinorString()).toBe('0');
  });

  it('throws on currency mismatch', () => {
    expect(() => Money.fromMinor(100, 'SAR').add(Money.fromMinor(100, 'USD'))).toThrow(/CURRENCY_MISMATCH/);
    expect(() => Money.fromMinor(100, 'SAR').subtract(Money.fromMinor(100, 'EUR'))).toThrow();
  });

  it('multiplies by a rational with half-up rounding', () => {
    // 15% VAT on 10.50 SAR = 1.575 SAR -> 158 halalas (half-up)
    expect(Money.fromMinor(1050, 'SAR').multiplyByRational(15, 100).toMinorString()).toBe('158');
    // 2.5 -> 3 (half-up), 2.4 -> 2
    expect(Money.fromMinor(5, 'SAR').multiplyByRational(1, 2).toMinorString()).toBe('3');
    expect(Money.fromMinor(12, 'SAR').multiplyByRational(1, 5).toMinorString()).toBe('2');
    expect(Money.fromMinor(100, 'SAR').percent(15).toMinorString()).toBe('15');
  });

  it('formats SAR', () => {
    const formatted = Money.fromMinor(2735000, 'SAR').format('en-SA');
    expect(formatted).toMatch(/27,350/);
    expect(formatted).toMatch(/SAR|ر\.س/);
    expect(Money.fromMinor(100, 'SAR').format('ar-SA')).toContain('١');
  });

  it('parses decimal input and validates currency codes', () => {
    expect(parseMoneyInput('123.45', 'SAR').toMinorString()).toBe('12345');
    expect(parseMoneyInput(10, 'USD').toMinorString()).toBe('1000');
    expect(() => Money.fromMinor(100, 'XXX')).toThrow();
    expect(() => Money.fromMinor(10.5, 'SAR')).toThrow();
    expect(() => parseMoneyInput('1.234', 'SAR')).toThrow();
  });

  it('equals compares currency and amount', () => {
    expect(Money.fromMinor(100, 'SAR').equals(Money.fromMinor(100, 'SAR'))).toBe(true);
    expect(Money.fromMinor(100, 'SAR').equals(Money.fromMinor(100, 'USD'))).toBe(false);
    expect(Money.fromMinor(100, 'SAR').equals(Money.fromMinor(101, 'SAR'))).toBe(false);
  });
});
