import { describe, expect, it } from "vitest";
import { ar } from "./ar";
import { en } from "./en";

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    collectKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

function collectLeaves(obj: unknown): Array<[string, unknown]> {
  if (typeof obj !== "object" || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? collectLeaves(value).map(([sub, v]) => [`${key}.${sub}`, v] as [string, unknown])
      : [[key, value] as [string, unknown]],
  );
}

describe("i18n dictionaries", () => {
  it("en and ar have identical key sets (recursive)", () => {
    const enKeys = collectKeys(en).sort();
    const arKeys = collectKeys(ar).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("has no empty strings", () => {
    for (const [name, dict] of [
      ["en", en],
      ["ar", ar],
    ] as const) {
      for (const [key, value] of collectLeaves(dict)) {
        expect(typeof value, `${name}.${key}`).toBe("string");
        expect((value as string).trim().length, `${name}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("has the required top-level sections", () => {
    for (const dict of [en, ar]) {
      expect(Object.keys(dict).sort()).toEqual(
        ["accounting", "ai", "analytics", "auth", "common", "dashboard", "hr", "integrations", "inventory", "manufacturing", "masterData", "nav", "notifications", "onboarding", "pos", "projects", "purchasing", "sales", "settings", "shell"].sort(),
      );
    }
  });
});
