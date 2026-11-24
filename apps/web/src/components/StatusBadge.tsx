"use client";

import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge, cn } from "@eserp/ui";

/**
 * Status as text + icon, never colour alone (#12). The status code itself
 * is the label; the icon + badge variant only reinforce it, so the meaning
 * survives monochrome / colour-blind viewing.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  /** Display text; defaults to the status code itself. */
  label?: string;
  className?: string;
}) {
  const text = label ?? status;
  const s = status.toUpperCase();
  const positive = [
    "PAID",
    "CONFIRMED",
    "POSTED",
    "ACTIVE",
    "RECEIVED",
    "COMPLETED",
    "APPROVED",
    "OK",
    "CLOSED",
  ];
  const negative = ["VOID", "CANCELLED", "REVERSED", "REJECTED", "FAILED", "OVERDUE"];
  const warning = [
    "DRAFT",
    "PARTIALLY_PAID",
    "PARTIALLY_RECEIVED",
    "PENDING",
    "SENT",
    "LOW",
    "DISCONTINUED",
  ];

  if (positive.includes(s)) {
    return (
      <Badge variant="default" className={cn("gap-1", className)}>
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {text}
      </Badge>
    );
  }
  if (negative.includes(s)) {
    return (
      <Badge variant="destructive" className={cn("gap-1", className)}>
        <XCircle className="h-3 w-3" aria-hidden />
        {text}
      </Badge>
    );
  }
  if (warning.includes(s)) {
    return (
      <Badge variant="secondary" className={cn("gap-1", className)}>
        {s === "DRAFT" || s === "PENDING" ? (
          <Clock className="h-3 w-3" aria-hidden />
        ) : (
          <AlertTriangle className="h-3 w-3" aria-hidden />
        )}
        {text}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={cn("gap-1", className)}>
      <Clock className="h-3 w-3" aria-hidden />
      {text}
    </Badge>
  );
}
