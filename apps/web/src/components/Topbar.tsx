/**
 * Unified topbar (#6): logo + tenant name (home), global search
 * (opens the command palette), Create/New menu, notification bell
 * with a date-grouped panel, theme + density controls, language
 * switcher, avatar menu (Settings first, Sign Out separated).
 *
 * Tenant switcher: the API exposes only the current tenant
 * (GET /tenants/me) — there is no list/switch endpoint, so the
 * topbar shows the tenant name and links home instead of a switcher.
 */
"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bell,
  Building2,
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@eserp/ui";
import { useAuth } from "@/lib/auth";
import { asList, notificationsApi, tenantsApi } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { DensityToggle } from "./DensityToggle";
import { CREATE_ACTIONS } from "@/lib/nav";
import { useThemePreference, type ThemePreference } from "@/lib/shell-prefs";

function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (first + second).toUpperCase();
}

function dayBucket(createdAt: string, now: Date): "today" | "yesterday" | "week" | "earlier" {
  const d = new Date(createdAt);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round(
    (startOf(now).getTime() - startOf(d).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "week";
  return "earlier";
}

export function Topbar({
  locale,
  onMenuClick,
  onOpenPalette,
}: {
  locale: string;
  onMenuClick: () => void;
  onOpenPalette: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useThemePreference();
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: tenant } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: () => tenantsApi.getMe(),
    enabled: !!user,
  });

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(),
    enabled: !!user,
  });
  const notifications = asList(data);
  const unread = notifications.filter((n) => !n.read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      await Promise.all(
        notifications.filter((n) => !n.read).map((n) => notificationsApi.markRead(n.id)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const grouped = useMemo(() => {
    const now = new Date();
    const buckets: Record<"today" | "yesterday" | "week" | "earlier", NotificationItem[]> = {
      today: [],
      yesterday: [],
      week: [],
      earlier: [],
    };
    for (const n of notifications) buckets[dayBucket(n.createdAt, now)].push(n);
    return buckets;
  }, [notifications]);

  const handleLogout = async () => {
    await logout();
    router.push(`/${locale}/login`);
  };

  const themeIcon =
    theme === "dark" ? <Moon className="h-5 w-5" /> : theme === "light" ? <Sun className="h-5 w-5" /> : <Monitor className="h-5 w-5" />;

  const renderNotifGroup = (
    key: "today" | "yesterday" | "week" | "earlier",
    labelKey: string,
  ) => {
    const items = grouped[key];
    if (items.length === 0) return null;
    return (
      <div key={key}>
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(labelKey as never)}
        </DropdownMenuLabel>
        {items.map((n) => (
          <DropdownMenuItem
            key={n.id}
            onSelect={() => {
              if (!n.read) markOneRead.mutate(n.id);
              setNotifOpen(false);
              router.push(`/${locale}/notifications`);
            }}
            className="flex cursor-pointer items-start gap-2 whitespace-normal"
          >
            <span
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                n.read ? "bg-muted" : "bg-primary",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{n.title}</span>
              {n.body && (
                <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
              )}
              <span className="block text-[11px] text-muted-foreground">
                {new Date(n.createdAt).toLocaleString(locale)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </div>
    );
  };

  return (
    <header className="flex h-[var(--shell-topbar-height)] shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label={t("shell.menu")}
        data-shell-topbar-action
      >
        <Menu className="h-5 w-5" />
      </Button>

      <Link
        href={`/${locale}/dashboard`}
        className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 font-bold"
        aria-label={t("common.dashboard")}
      >
        <Building2 className="h-5 w-5 text-primary" />
        <span className="hidden max-w-40 truncate text-sm md:inline">
          {tenant?.name ?? "EsERP"}
        </span>
      </Link>

      {/* Global search trigger — opens the command palette. */}
      <button
        type="button"
        onClick={onOpenPalette}
        data-shell-topbar-action
        className="hidden h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:flex md:max-w-md"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-start">{t("shell.searchPlaceholder")}</span>
        <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold lg:inline">
          Ctrl K
        </kbd>
      </button>
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label={t("common.search")}
        data-shell-topbar-action
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      <DensityToggle className="hidden lg:flex" />

      {/* Create / New menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-shell-topbar-action aria-label={t("shell.create")}>
            <Plus className="h-4 w-4" />
            <span className="ms-1 hidden sm:inline">{t("shell.create")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("shell.create")}</DropdownMenuLabel>
          {CREATE_ACTIONS.map(({ href, key, icon: Icon }) => (
            <DropdownMenuItem key={href} asChild>
              <Link href={`/${locale}/${href}`} className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                {t(key as never)}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Theme: light / dark / system */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("shell.theme")} data-shell-topbar-action>
            {themeIcon}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("shell.theme")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(v) => setTheme(v as ThemePreference)}
          >
            <DropdownMenuRadioItem value="light">
              <Sun className="me-2 h-4 w-4" />
              {t("shell.themeLight")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="me-2 h-4 w-4" />
              {t("shell.themeDark")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="me-2 h-4 w-4" />
              {t("shell.themeSystem")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Notifications bell with date-grouped panel */}
      <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={t("nav.notifications")} data-shell-topbar-action>
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {unread}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
          <div className="flex items-center justify-between px-2 pt-1">
            <DropdownMenuLabel className="px-0">{t("nav.notifications")}</DropdownMenuLabel>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-accent disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                {t("shell.markAllRead")}
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("shell.noNotifications")}
            </p>
          ) : (
            <>
              {renderNotifGroup("today", "shell.notificationsToday")}
              {renderNotifGroup("yesterday", "shell.notificationsYesterday")}
              {renderNotifGroup("week", "shell.notificationsThisWeek")}
              {renderNotifGroup("earlier", "shell.notificationsEarlier")}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/notifications`} className="justify-center">
              {t("common.viewAll")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LanguageSwitcher />

      {/* Avatar menu: Settings first, Sign Out separated */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={user?.name ?? user?.email ?? "User"}
            data-shell-topbar-action
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-none"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials(user?.name ?? user?.email ?? "?")}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium">
              {user?.name ?? user?.email}
            </span>
            {user?.name && (
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/settings`} className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              {t("common.settings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/notifications`} className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              {t("nav.notifications")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleLogout}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <LogOut className="me-2 h-4 w-4" />
            {t("common.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
