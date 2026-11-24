import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent } from "./money";

describe("formatMoney", () => {
  it("formats integer minor units as currency (no floats for money)", () => {
    expect(formatMoney(2735000, "SAR", "en")).toContain("27,350");
    expect(formatMoney(100, "USD", "en")).toContain("1.00");
    expect(formatMoney(0, "SAR", "en")).toContain("0");
  });

  it("formats negative amounts", () => {
    expect(formatMoney(-5000, "SAR", "en")).toContain("50");
  });

  it("formats with the Arabic locale", () => {
    const out = formatMoney(2735000, "SAR", "ar");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("ر.س");
  });

  it("defaults to SAR", () => {
    expect(formatMoney(100, undefined, "en")).toContain("1.00");
  });
});

describe("formatPercent", () => {
  it("formats 15 as 15%", () => {
    expect(formatPercent(15, "en")).toContain("15");
  });
});
