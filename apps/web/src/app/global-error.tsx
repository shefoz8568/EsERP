"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@eserp/ui";

/**
 * Root error boundary (Next.js convention): catches throws in the root
 * layout itself, where the [locale]/error.tsx boundary cannot help.
 * Must render its own <html>/<body> because the root layout is gone.
 * Translations are not used here for the same reason as error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Something went wrong.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            The application could not be displayed. Try again, or reload the page.
          </p>
          {error?.digest && (
            <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>
          )}
          <Button variant="outline" size="sm" onClick={() => reset()}>
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
