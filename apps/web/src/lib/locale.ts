import { dirFor, isRTL, locales, type Locale } from "@eserp/i18n";

export { dirFor, isRTL, locales, type Locale };

/**
 * Apply the locale direction to the live document. The [locale] layout
 * sets dir server-side; this helper is for client-side locale switches
 * and for tests asserting RTL behaviour.
 */
export function applyDocumentDir(locale: string): "rtl" | "ltr" {
  const dir = dirFor(locale);
  if (typeof document !== "undefined") {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }
  return dir;
}

/** Build the same path in another locale, e.g. /en/settings -> /ar/settings. */
export function switchLocalePath(pathname: string, nextLocale: string): string {
  const segments = pathname.split("/");
  if (segments.length > 1 && (locales as readonly string[]).includes(segments[1])) {
    segments[1] = nextLocale;
    return segments.join("/") || "/";
  }
  return `/${nextLocale}${pathname === "/" ? "" : pathname}`;
}
