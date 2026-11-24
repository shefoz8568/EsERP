/**
 * Grouped, collapsible sidebar (#5) — module sections, favourites +
 * recents on top, filter, collapse to an icon rail with fly-out menus.
 *
 * RTL SAFETY (preserved Bug 1 fix): the closed-state slide-out is
 * scoped to below `lg` only. At desktop the only transform rule that
 * applies is the desktop reset, so the sidebar is always visible in
 * both directions; the static desktop flex item keeps its width. All spacing uses logical utilities (ms-/me-/ps-/pe-,
 * start/end) so the sidebar sits on the inline-start side (left in
 * LTR, right in RTL). No literal utility names appear in comments
 * here — Tailwind scans source text and would regenerate rules.
 */
"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Star,
} from "lucide-react";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@eserp/ui";
import { NAV_GROUPS, findNavItem, type NavItem } from "@/lib/nav";
import {
  SIDEBAR_GROUPS_KEY,
  useFavourites,
  useRecents,
  useSidebarCollapsed,
} from "@/lib/shell-prefs";
import { useAuth } from "@/lib/auth";

function readCollapsedGroups(): string[] {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function Sidebar({
  locale,
  open,
  onClose,
}: {
  locale: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const { user } = useAuth();
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();
  const { favourites, toggleFavourite, isFavourite } = useFavourites();
  const recents = useRecents();
  const [filter, setFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  useEffect(() => setCollapsedGroups(readCollapsedGroups()), []);

  // Admin-only items are hidden unless the user has an OWNER/ADMIN
  // role. An empty role list means "unknown" — show everything and let
  // the API enforce authorisation (fail-open, never lock out the demo).
  const roles = user?.roles ?? [];
  const isAdmin = roles.length === 0 || roles.includes("OWNER") || roles.includes("ADMIN");

  const isActive = (href: string) => {
    const base = `/${locale}/${href.split("?")[0]}`;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  const visibleGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiresAdmin && !isAdmin) return false;
        if (!q) return true;
        const label = (t(item.key as never) as string).toLowerCase();
        return label.includes(q) || item.href.toLowerCase().includes(q);
      }),
    })).filter((group) => group.items.length > 0);
  }, [filter, isAdmin, t]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        window.localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Non-persistent is fine.
      }
      return next;
    });
  };

  const favouriteItems = favourites
    .map((href) => findNavItem(href))
    .filter((n): n is NavItem => !!n && (!n.requiresAdmin || isAdmin));
  const recentItems = recents
    .map((href) => findNavItem(href))
    .filter((n): n is NavItem => !!n && (!n.requiresAdmin || isAdmin))
    .slice(0, 5);

  const rtl = locale === "ar";

  const renderItemRow = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const fav = isFavourite(item.href);
    return (
      <div
        key={item.href}
        className={cn(
          "group/row flex items-center rounded-md transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <Link
          href={`/${locale}/${item.href}`}
          onClick={onClose}
          aria-current={active ? "page" : undefined}
          data-shell-nav-item
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-sm font-medium"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{t(item.key as never)}</span>
        </Link>
        <button
          type="button"
          aria-label={`${fav ? "Unfavourite" : "Favourite"} ${t(item.key as never)}`}
          aria-pressed={fav}
          onClick={() => toggleFavourite(item.href)}
          className={cn(
            "me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            fav
              ? "text-critical opacity-100"
              : "opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
          )}
        >
          <Star className={cn("h-4 w-4", fav && "fill-current")} />
        </button>
      </div>
    );
  };

  /** Full sidebar: filter + favourites/recents + grouped sections. */
  const renderFullNav = () => (
    <>
      <div className="shrink-0 px-3 pt-3">
        <label className="relative block">
          <span className="sr-only">{t("shell.searchMenu")}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("shell.searchMenuPlaceholder")}
            className="h-9 w-full rounded-md border bg-background ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label={t("shell.menu")}>
        {filter.trim() === "" && (
          <>
            {favouriteItems.length > 0 && (
              <div className="pb-1">
                <p className="flex items-center gap-2 px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Star className="h-3 w-3" />
                  {t("shell.favourites")}
                </p>
                {favouriteItems.map(renderItemRow)}
              </div>
            )}
            {recentItems.length > 0 && (
              <div className="pb-1">
                <p className="flex items-center gap-2 px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t("shell.recents")}
                </p>
                {recentItems.map(renderItemRow)}
              </div>
            )}
            {favouriteItems.length === 0 && recentItems.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t("shell.noFavourites")}</p>
            )}
          </>
        )}
        {visibleGroups.map((group) => {
          const groupCollapsed = filter.trim() === "" && collapsedGroups.includes(group.key);
          return (
            <div key={group.key}>
              <button
                type="button"
                aria-expanded={!groupCollapsed}
                onClick={() => toggleGroup(group.key)}
                className="flex w-full items-center gap-1 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                <span className="flex-1 text-start">{t(`shell.groups.${group.key}` as never)}</span>
                <span className="text-[10px] font-normal">{group.items.length}</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    groupCollapsed && (rtl ? "rotate-90" : "-rotate-90"),
                  )}
                />
              </button>
              {!groupCollapsed && group.items.map(renderItemRow)}
            </div>
          );
        })}
        {visibleGroups.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t("common.noData")}</p>
        )}
      </nav>
    </>
  );

  /** Icon-rail fly-out for one module group (portal-based, so the
   * scrolling nav never clips it). */
  const renderRailGroup = (group: (typeof NAV_GROUPS)[number], items: NavItem[]) => {
    const Icon = items[0].icon;
    const groupActive = items.some((i) => isActive(i.href));
    return (
      <DropdownMenu key={group.key}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t(`shell.groups.${group.key}` as never)}
            title={t(`shell.groups.${group.key}` as never)}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-md transition-colors",
              groupActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={rtl ? "left" : "right"} align="start" className="w-60">
          <DropdownMenuLabel>{t(`shell.groups.${group.key}` as never)}</DropdownMenuLabel>
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <DropdownMenuItem key={item.href} asChild>
                <Link
                  href={`/${locale}/${item.href}`}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-2",
                    isActive(item.href) && "font-semibold text-primary",
                  )}
                >
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {t(item.key as never)}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderRailList = (title: string, icon: typeof Star, items: NavItem[]) => {
    if (items.length === 0) return null;
    const Icon = icon;
    return (
      <DropdownMenu key={title}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={title}
            title={title}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Icon className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={rtl ? "left" : "right"} align="start" className="w-60">
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={`/${locale}/${item.href}`} onClick={onClose} className="flex items-center gap-2">
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {t(item.key as never)}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <>
      {open && (
        <button
          aria-label={t("shell.closeMenu")}
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-40 flex shrink-0 flex-col border-e bg-card transition-transform lg:static lg:translate-x-0",
          collapsed ? "w-64 lg:w-[var(--shell-sidebar-rail-width)]" : "w-64",
          open ? "translate-x-0" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <Building2 className="h-6 w-6 shrink-0 text-primary" />
          <span className={cn("text-lg font-bold", collapsed && "lg:hidden")}>EsERP</span>
        </div>

        {collapsed ? (
          <>
            {/* Icon rail — desktop only; below lg the drawer shows the
                full nav instead (see the lg:hidden block below). */}
            <nav
              className="hidden flex-1 flex-col items-center gap-1 overflow-y-auto py-3 lg:flex"
              aria-label={t("shell.menu")}
            >
              {renderRailList(t("shell.favourites"), Star, favouriteItems)}
              {renderRailList(t("shell.recents"), Clock, recentItems)}
              {visibleGroups.map((g) => renderRailGroup(g, g.items))}
            </nav>
            <div className="flex min-h-0 flex-1 flex-col lg:hidden">{renderFullNav()}</div>
          </>
        ) : (
          renderFullNav()
        )}

        <div className="flex shrink-0 items-center justify-between border-t p-3">
          <span className={cn("text-xs text-muted-foreground", collapsed && "lg:hidden")}>
            EsERP · Phase 8
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
            aria-pressed={collapsed}
            title={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
            className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 rtl:rotate-180" />
            ) : (
              <PanelLeftClose className="h-4 w-4 rtl:rotate-180" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
