import createMiddleware from "next-intl/middleware";
import { defaultLocale, locales } from "@eserp/i18n";

export default createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
});

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/", "/(en|ar)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
