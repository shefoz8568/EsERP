"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@eserp/ui";

/**
 * Scoped error boundary for every [locale] route (Next.js convention):
 * a render throw in a page shows this instead of taking out the whole
 * app shell. Deliberately avoids next-intl: if the providers above this
 * boundary are what crashed, translations may be unavailable.
 * The error is logged so it is visible in server/browser logs.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="text-sm font-medium">Something went wrong.</p>
      <p className="max-w-md text-sm text-muted-foreground">
        This page could not be displayed. Try again, or go back and continue from another page.
      </p>
      {error?.digest && (
        <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>
      )}
      <Button variant="outline" size="sm" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
