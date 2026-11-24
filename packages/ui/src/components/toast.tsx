import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";

/**
 * Toast system: sonner (chosen over @radix-ui/react-toast — smaller API,
 * built-in promise/loading toasts, and first-class RTL positioning).
 *
 * Usage:
 *   import { Toaster, toast } from "@eserp/ui";
 *   // once, near the app root: <Toaster />
 *   toast.success("Invoice saved");
 *   toast.error("Could not save invoice", { description: err.message });
 *
 * `dir` follows the document direction; pass `position` explicitly when
 * the app renders inside a container with a different direction.
 */
function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      className="toaster group"
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
export type { ToasterProps } from "sonner";
