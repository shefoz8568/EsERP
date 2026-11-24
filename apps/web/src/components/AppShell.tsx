"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { RequireAuth } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { CommandPalette } from "@/components/CommandPalette";
import { recordRecent } from "@/lib/shell-prefs";

/** Authenticated app shell: sidebar + topbar + content + command palette. */
export function AppShell({ locale, children }: { locale: string; children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global Ctrl/⌘+K opens the command palette from anywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Record every visited page for the sidebar / palette recents.
  useEffect(() => {
    const segment = pathname.split("/").slice(2).join("/");
    if (segment) recordRecent(segment);
  }, [pathname]);

  return (
    <RequireAuth locale={locale}>
      <div className="flex min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          {t("shell.skipToContent")}
        </a>
        <Sidebar locale={locale} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            locale={locale}
            onMenuClick={() => setSidebarOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <main id="main-content" className="flex-1 p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette locale={locale} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </RequireAuth>
  );
}
