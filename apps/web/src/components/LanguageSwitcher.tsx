"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@eserp/ui";
import { Globe } from "lucide-react";
import { locales, type Locale } from "@eserp/i18n";
import { switchLocalePath } from "@/lib/locale";

/**
 * Locale switcher (en ⇄ ar). Navigates to the same page in the other
 * locale; the [locale] layout then sets html lang + dir.
 */
export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const current = pathname.split("/")[1] as Locale;
  const other: Locale = current === "ar" ? "en" : "ar";

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Switch language to ${other === "ar" ? "العربية" : "English"}`}
      onClick={() => router.push(switchLocalePath(pathname, other))}
    >
      <Globe className="h-4 w-4" />
      <span className="ms-1 text-xs font-semibold">
        {other === "ar" ? "العربية" : "English"}
      </span>
      <span className="sr-only">
        {locales.join(", ")}
      </span>
    </Button>
  );
}
