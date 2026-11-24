import { ar } from "./ar";
import { en, type Dictionary } from "./en";

export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export function isRTL(locale: string): boolean {
  return locale === "ar";
}

export function dirFor(locale: string): "rtl" | "ltr" {
  return isRTL(locale) ? "rtl" : "ltr";
}

export const dictionaries: Record<Locale, Dictionary> = { en, ar };

export function getDictionary(locale: string): Dictionary {
  return dictionaries[locale as Locale] ?? dictionaries[defaultLocale];
}

/** Resolve a dotted key path (e.g. "common.save") inside a dictionary. */
export function translate(locale: string, path: string): string {
  const parts = path.split(".");
  let current: unknown = getDictionary(locale);
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  return typeof current === "string" ? current : path;
}

export { ar, en, type Dictionary };
