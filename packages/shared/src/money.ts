import { AppError } from './errors.js';

/**
 * Money value object. Amounts are always integer minor units (halalas for
 * SAR, cents for USD/EUR) stored as bigint — never floats.
 */
export class Money {
  readonly amountMinor: bigint;
  readonly currency: string;

  private constructor(amountMinor: bigint, currency: string) {
    this.amountMinor = amountMinor;
    this.currency = currency.toUpperCase();
  }

  static fromMinor(amountMinor: bigint | number | string, currency: string): Money {
    if (!isValidCurrencyCode(currency)) {
      throw new AppError('INVALID_CURRENCY', `Invalid currency code: ${currency}`, 400);
    }
    let minor: bigint;
    if (typeof amountMinor === 'bigint') minor = amountMinor;
    else if (typeof amountMinor === 'number') {
      if (!Number.isInteger(amountMinor)) {
        throw new AppError('INVALID_AMOUNT', 'Money amount must be an integer number of minor units', 400);
      }
      minor = BigInt(amountMinor);
    } else {
      if (!/^-?\d+$/.test(amountMinor.trim())) {
        throw new AppError('INVALID_AMOUNT', 'Money amount must be an integer string of minor units', 400);
      }
      minor = BigInt(amountMinor.trim());
    }
    return new Money(minor, currency);
  }

  static zero(currency: string): Money {
    return Money.fromMinor(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new AppError(
        'CURRENCY_MISMATCH',
        `Cannot combine ${this.currency} with ${other.currency}`,
        400,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  /**
   * Multiply by a rational numerator/denominator (e.g. 15/100 for 15% VAT).
   * Rounding is half-up (away from zero on a .5 remainder) on the exact
   * rational result — the standard for tax/discount math in the ERP.
   */
  multiplyByRational(numerator: bigint | number, denominator: bigint | number): Money {
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    if (d === 0n) throw new AppError('INVALID_ARGUMENT', 'Denominator must not be zero', 400);
    const product = this.amountMinor * n;
    // Half-up: round(|product| / d) with .5 rounding up, then restore sign.
    const sign = product < 0n ? -1n : 1n;
    const abs = product < 0n ? -product : product;
    const absD = d < 0n ? -d : d;
    const rounded = (abs * 2n + absD) / (absD * 2n);
    return new Money(sign * rounded, this.currency);
  }

  /** Convenience: multiply by a percentage, e.g. percent(15) = 15%. */
  percent(pct: number | bigint): Money {
    return this.multiplyByRational(pct, 100);
  }

  toMinorString(): string {
    return this.amountMinor.toString();
  }

  /** Minor-unit exponent for a currency (2 for SAR/USD/EUR/AED; 0 for JPY). */
  static minorUnits(currency: string): number {
    return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
  }

  format(locale = 'en-SA'): string {
    const minor = Money.minorUnits(this.currency);
    const value = Number(this.amountMinor) / 10 ** minor;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
    }).format(value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isNegative(): boolean {
    return this.amountMinor < 0n;
  }
}

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP']);

const ISO_4217 = new Set([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
  'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS',
  'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR',
  'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD',
  'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU',
  'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK',
  'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK',
  'SGD', 'SHP', 'SLE', 'SLL', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP',
  'SZL', 'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TVD', 'TWD',
  'TZS', 'UAH', 'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST',
  'XAF', 'XCD', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL',
]);

export function isValidCurrencyCode(code: string): boolean {
  return typeof code === 'string' && ISO_4217.has(code.trim().toUpperCase());
}

/** Parse a decimal-major-unit input ("123.45") into minor units for a currency. */
export function parseMoneyInput(input: string | number, currency: string): Money {
  if (!isValidCurrencyCode(currency)) {
    throw new AppError('INVALID_CURRENCY', `Invalid currency code: ${currency}`, 400);
  }
  const minor = Money.minorUnits(currency);
  const text = String(input).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new AppError('INVALID_AMOUNT', `Invalid money amount: ${input}`, 400);
  }
  const [whole, frac = ''] = text.split('.');
  if (frac.length > minor) {
    throw new AppError('INVALID_AMOUNT', `Too many decimal places for ${currency}`, 400);
  }
  const padded = (frac + '0'.repeat(minor)).slice(0, minor);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const absWhole = BigInt(whole.replace('-', ''));
  const value = absWhole * 10n ** BigInt(minor) + BigInt(padded || '0');
  return Money.fromMinor(sign * value, currency);
}
