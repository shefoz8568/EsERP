"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ChevronDown } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, cn } from "@eserp/ui";

/**
 * One form-page template (research #8, Fiori Object Page / Dynamic Page):
 * title bar with record identity + status + actions, grouped collapsible
 * sections, a single required-field convention (`*` + screen-reader text
 * + inline error), and a sticky Save/Discard bar that appears only when
 * the form is dirty, with an unsaved-changes guard.
 *
 * Pages compose these primitives; the template owns no business logic and
 * never decides what "valid" means — the page passes `dirty`,
 * `saveDisabled` and per-field `error` strings.
 */

/** Warn on tab close / reload while the form has unsaved changes. */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

export function FormPageHeader({
  title,
  subtitle,
  status,
  actions,
  onBack,
  backLabel = "Back",
}: {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          {status}
        </div>
        {subtitle && (
          <p className="text-sm text-muted-foreground" dir="auto">
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            {backLabel}
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}

export function FormSection({
  id,
  title,
  description,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="flex w-full items-center justify-between gap-2 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>
            <CardTitle className="text-base">{title}</CardTitle>
            {description && (
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                {description}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90 rtl:rotate-90")}
            aria-hidden
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent id={`${id}-body`}>{children}</CardContent>
      )}
    </Card>
  );
}

/**
 * One required-field convention: a visible `*`, an sr-only "(required)"
 * for screen readers, and an inline error (`role="alert"`) under the
 * control. Pass `error` only after the field was touched / submitted,
 * so the form doesn't shout before the user has typed.
 */
export function FormField({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <>
            <span className="text-destructive" aria-hidden>
              {" "}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function StickySaveBar({
  dirty,
  saving,
  saveDisabled,
  onSave,
  onDiscard,
  saveLabel = "Save",
  discardLabel = "Discard",
  unsavedLabel = "You have unsaved changes",
}: {
  dirty: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  discardLabel?: string;
  unsavedLabel?: string;
}) {
  useUnsavedChangesGuard(dirty);
  if (!dirty) return null;
  return (
    <div
      className="sticky bottom-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3 shadow-sm"
      role="region"
      aria-label="Unsaved changes"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
        {unsavedLabel}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onDiscard} disabled={saving}>
          {discardLabel}
        </Button>
        <Button type="button" onClick={onSave} disabled={saveDisabled || saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
