import type { ReactNode } from "react";

/**
 * Root layout renders only its children: the [locale] layout below owns
 * <html>/<body> so lang + dir are set per locale (next-intl convention).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
