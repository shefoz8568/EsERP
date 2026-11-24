/**
 * Money formatting. Money is always integer minor units + a currency code;
 * floats are never used for money. Display only goes through
 * Intl.NumberFormat with the tenant currency (SAR default).
 */
export function formatMoney(
  minorUnits: number,
  currency = "SAR",
  locale = "en",
): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    style: "currency",
    currency,
  }).format(minorUnits / 100);
}

/** Format a tax rate stored as a percent number, e.g. 15 -> "15%". */
export function formatPercent(rate: number, locale = "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(rate / 100);
}
