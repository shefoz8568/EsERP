/**
 * Global command palette (#1): Ctrl/⌘+K fuzzy search over every page,
 * quick actions and recent pages. Keyboard navigable (↑/↓, Enter, Esc).
 *
 * Lightweight custom implementation — `cmdk` is not a dependency of
 * the web app and the palette needs only fuzzy matching + list
 * navigation, so no new dependency was added.
 */
"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownLeft,
  LayoutDashboard,
  Moon,
  Rows3,
  Search,
  Settings,
  Bell,
  Globe,
  Star,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@eserp/ui";
import { NAV_ITEMS, findNavItem, type NavItem } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { isAdminUser } from "@/lib/permissions";
import {
  recordRecent,
  readRecents,
  useDensity,
  useThemePreference,
} from "@/lib/shell-prefs";
import { switchLocalePath } from "@/lib/locale";
import { locales, type Locale } from "@eserp/i18n";

/** Subsequence fuzzy match; higher = better. Null = no match. */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let qi = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (last >= 0) gaps += i - last - 1;
      last = i;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return 50 - gaps * 2;
}

interface PaletteEntry {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
  score: number;
}

export function CommandPalette({
  locale,
  open,
  onClose,
}: {
  locale: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const { user } = useAuth();
  // Same admin rule as the sidebar: admin-only entries (Users, Roles,
  // API Keys, Providers, Webhooks) are hidden from non-admin roles.
  // An unknown/empty role list fails open, the API still enforces.
  const isAdmin = isAdminUser(user?.roles);
  const { theme, setTheme } = useThemePreference();
  const { density, setDensity } = useDensity();

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setRecents(readRecents());
      inputRef.current?.focus();
    }
  }, [open ]);

  const goTo = (href: string) => {
    recordRecent(href);
    onClose();
    router.push(`/${locale}/${href}`);
  };

  const entries = useMemo(() => {
    const q = query.trim();
    const pages: PaletteEntry[] = NAV_ITEMS.filter((item) => !item.requiresAdmin || isAdmin).map((item) => {
      const label = t(item.key as never) as string;
      const group = t(`shell.groups.${item.group}` as never) as string;
      return {
        id: `page:${item.href}`,
        label,
        hint: group,
        icon: item.icon,
        run: () => goTo(item.href),
        score: fuzzyScore(q, `${label} ${item.href} ${group}`) ?? -1,
      };
    }).filter((e) => e.score >= 0);

    const other: Locale = (pathname.split("/")[1] as Locale) === "ar" ? "en" : "ar";
    const actions: PaletteEntry[] = [
      {
        id: "action:dashboard",
        label: t("shell.goToDashboard"),
        hint: t("shell.actions"),
        icon: LayoutDashboard,
        run: () => goTo("dashboard"),
        score: fuzzyScore(q, t("shell.goToDashboard")) ?? -1,
      },
      {
        id: "action:settings",
        label: t("shell.openSettings"),
        hint: t("shell.actions"),
        icon: Settings,
        run: () => goTo("settings"),
        score: fuzzyScore(q, t("shell.openSettings")) ?? -1,
      },
      {
        id: "action:notifications",
        label: t("shell.openNotifications"),
        hint: t("shell.actions"),
        icon: Bell,
        run: () => goTo("notifications"),
        score: fuzzyScore(q, t("shell.openNotifications")) ?? -1,
      },
      {
        id: "action:theme",
        label: t("shell.toggleTheme"),
        hint: t("shell.actions"),
        icon: Moon,
        run: () => {
          setTheme(theme === "dark" ? "light" : "dark");
          onClose();
        },
        score: fuzzyScore(q, `${t("shell.toggleTheme")} theme dark light`) ?? -1,
      },
      {
        id: "action:density",
        label: t("shell.toggleDensity"),
        hint: t("shell.actions"),
        icon: Rows3,
        run: () => {
          setDensity(density === "compact" ? "comfortable" : "compact");
          onClose();
        },
        score: fuzzyScore(q, `${t("shell.toggleDensity")} density compact comfortable`) ?? -1,
      },
      {
        id: "action:language",
        label: `${t("shell.switchLanguage")} — ${other === "ar" ? "العربية" : "English"}`,
        hint: t("shell.actions"),
        icon: Globe,
        run: () => {
          onClose();
          router.push(switchLocalePath(pathname, other));
        },
        score: fuzzyScore(q, `${t("shell.switchLanguage")} language العربية English`) ?? -1,
      },
    ].filter((e) => e.score >= 0);

    const recentEntries: PaletteEntry[] = q
      ? []
      : recents
          .map((href) => findNavItem(href))
          .filter((n): n is NavItem => !!n && (!n.requiresAdmin || isAdmin))
          .map((item) => ({
            id: `recent:${item.href}`,
            label: t(item.key as never) as string,
            hint: t("shell.recents"),
            icon: item.icon,
            run: () => goTo(item.href),
            score: 0,
          }));

    const sorted = (list: PaletteEntry[]) =>
      [...list].sort((a, b) => b.score - a.score);
    return { recentEntries, pages: sorted(pages), actions: sorted(actions) };
  }, [query, recents, theme, density, locale, pathname, t, isAdmin]);

  const flat = useMemo(
    () => [...entries.recentEntries, ...entries.pages, ...entries.actions],
    [entries],
  );

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const renderGroup = (title: string, items: PaletteEntry[], offset: number) => {
    if (items.length === 0) return null;
    return (
      <div key={title} role="group" aria-label={title}>
        <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {items.map((entry, i) => {
          const idx = offset + i;
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={idx === active}
              data-idx={idx}
              onMouseEnter={() => setActive(idx)}
              onClick={() => entry.run()}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-start text-sm",
                idx === active ? "bg-accent text-accent-foreground" : "text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{entry.label}</span>
              <span className="hidden text-xs text-muted-foreground sm:block">{entry.hint}</span>
              {idx === active && <CornerDownLeft className="h-3 w-3 shrink-0 text-muted-foreground" />}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]" role="dialog" aria-modal="true" aria-label={t("common.search")}>
      <button aria-label={t("common.close")} onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("shell.searchPlaceholder")}
            aria-label={t("shell.searchPlaceholder")}
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={flat[active]?.id}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {flat.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("common.noData")}
            </p>
          )}
          {renderGroup(t("shell.recents"), entries.recentEntries, 0)}
          {renderGroup(t("shell.pages"), entries.pages, entries.recentEntries.length)}
          {renderGroup(
            t("shell.actions"),
            entries.actions,
            entries.recentEntries.length + entries.pages.length,
          )}
        </div>
        <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3" /> {t("shell.searchHint")}
          </span>
          <span className="ms-auto hidden sm:block">{locales.join(" / ")}</span>
        </div>
      </div>
    </div>
  );
}
