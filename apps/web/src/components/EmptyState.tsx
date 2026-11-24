"use client";

import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";

export function EmptyState({ message }: { message?: string }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message ?? t("common.noData")}</p>
    </div>
  );
}
