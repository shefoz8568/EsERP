/**
 * Per-user shell preferences, persisted in localStorage (density,
 * favourites, recents, sidebar state) and a cookie for theme (so the
 * [locale] layout can apply it before first paint and avoid a flash).
 *
 * Theme values: "light" | "dark" | "system". "system" (the default)
 * follows the OS preference via matchMedia.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

export const THEME_COOKIE = "eserp-theme";
export const DENSITY_KEY = "eserp-density";
export const FAVOURITES_KEY = "eserp-favourites";
export const RECENTS_KEY = "eserp-recents";
export const SIDEBAR_COLLAPSED_KEY = "eserp-sidebar-collapsed";
export const SIDEBAR_GROUPS_KEY = "eserp-sidebar-groups";

export type ThemePreference = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

const MAX_RECENTS = 8;
const MAX_FAVOURITES = 20;

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / full storage: prefs just don't persist.
  }
}

function readJsonList(key: string): string[] {
  const raw = readStorage(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Resolve a theme preference to the concrete mode to apply. */
export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readThemeCookie(): ThemePreference {
  if (typeof document === "undefined") return "system";
  const m = document.cookie.match(/(?:^|; )eserp-theme=([^;]*)/);
  const v = m?.[1];
  return v === "dark" || v === "light" || v === "system" ? v : "system";
}

/** Apply a theme preference now: <html> class + persistent cookie. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(pref) === "dark");
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

/** Apply a density now: `density-compact` class on <html>. */
export function applyDensity(density: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("density-compact", density === "compact");
  writeStorage(DENSITY_KEY, density);
}

export function useThemePreference(): {
  theme: ThemePreference;
  setTheme: (pref: ThemePreference) => void;
} {
  const [theme, setThemeState] = useState<ThemePreference>("system");

  useEffect(() => {
    setThemeState(readThemeCookie());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemeCookie() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((pref: ThemePreference) => {
    applyTheme(pref);
    setThemeState(pref);
  }, []);

  return { theme, setTheme };
}

export function useDensity(): { density: Density; setDensity: (d: Density) => void } {
  const [density, setDensityState] = useState<Density>("comfortable");

  useEffect(() => {
    setDensityState(readStorage(DENSITY_KEY) === "compact" ? "compact" : "comfortable");
  }, []);

  const setDensity = useCallback((d: Density) => {
    applyDensity(d);
    setDensityState(d);
  }, []);

  return { density, setDensity };
}

export function useFavourites(): {
  favourites: string[];
  toggleFavourite: (href: string) => void;
  isFavourite: (href: string) => boolean;
} {
  const [favourites, setFavourites] = useState<string[]>([]);

  useEffect(() => setFavourites(readJsonList(FAVOURITES_KEY)), []);

  const toggleFavourite = useCallback((href: string) => {
    setFavourites((prev) => {
      const next = prev.includes(href)
        ? prev.filter((h) => h !== href)
        : [href, ...prev].slice(0, MAX_FAVOURITES);
      writeStorage(FAVOURITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavourite = useCallback((href: string) => favourites.includes(href), [favourites]);

  return { favourites, toggleFavourite, isFavourite };
}

/** Recently visited pages (hrefs, most recent first). */
export function readRecents(): string[] {
  return readJsonList(RECENTS_KEY);
}

/** Record a page visit. Called by AppShell on every route change and
 * by the command palette on selection. */
export function recordRecent(href: string): void {
  const base = href.split("?")[0];
  const next = [base, ...readRecents().filter((h) => h !== base)].slice(0, MAX_RECENTS);
  writeStorage(RECENTS_KEY, JSON.stringify(next));
}

export function useRecents(): string[] {
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(readRecents());
    // Recents change on navigation (AppShell records them); re-read
    // when the page becomes visible again / on route changes.
    const onFocus = () => setRecents(readRecents());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return recents;
}

export function useSidebarCollapsed(): {
  collapsed: boolean;
  toggleCollapsed: () => void;
} {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setCollapsed(readStorage(SIDEBAR_COLLAPSED_KEY) === "1"), []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      writeStorage(SIDEBAR_COLLAPSED_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  return { collapsed, toggleCollapsed };
}
