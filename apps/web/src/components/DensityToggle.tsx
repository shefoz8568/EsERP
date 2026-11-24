/**
 * Density toggle (#3): Compact / Comfortable, persisted per user in
 * localStorage and applied as `.density-compact` on <html> (see
 * globals.css). Compact rows are ~1.625rem, comfortable ~2.25rem
 * (Fiori Horizon densities).
 */
"use client";

import { useTranslations } from "next-intl";
import { Rows3, Rows2 } from "lucide-react";
import { cn } from "@eserp/ui";
import { useDensity } from "@/lib/shell-prefs";

export function DensityToggle({ className }: { className?: string }) {
  const t = useTranslations();
  const { density, setDensity } = useDensity();

  return (
    <div
      role="group"
      aria-label={t("shell.density")}
      className={cn("flex items-center rounded-md border bg-card p-0.5", className)}
    >
      {(
        [
          { value: "comfortable", icon: Rows3, label: t("shell.densityComfortable") },
          { value: "compact", icon: Rows2, label: t("shell.densityCompact") },
        ] as const
      ).map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={density === value}
          title={label}
          onClick={() => setDensity(value)}
          className={cn(
            "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors",
            density === value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
