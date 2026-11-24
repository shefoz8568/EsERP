import type { Config } from "tailwindcss";

/**
 * Web Tailwind config. Mirrors the design tokens in
 * @eserp/ui/src/styles/globals.css (HSL CSS variables) and scans both the
 * web app and the shared UI package so its classes are generated.
 * Dark mode is class-based (`.dark` on <html>), toggled from the Topbar
 * and persisted in the `eserp-theme` cookie.
 * All layout utilities in components use logical properties
 * (ms-/me-/ps-/pe-/start/end) so RTL flips automatically.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        /* Semantic colours — tokens live in apps/web/src/app/globals.css. */
        positive: { DEFAULT: "hsl(var(--positive))", foreground: "hsl(var(--positive-foreground))" },
        critical: { DEFAULT: "hsl(var(--critical))", foreground: "hsl(var(--critical-foreground))" },
        negative: { DEFAULT: "hsl(var(--negative))", foreground: "hsl(var(--negative-foreground))" },
        info: { DEFAULT: "hsl(var(--info))", foreground: "hsl(var(--info-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
