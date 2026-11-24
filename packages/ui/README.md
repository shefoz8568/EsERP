# @eserp/ui

Shared UI primitives for EsERP — shadcn/ui-style components built on Radix UI
primitives, Tailwind CSS 3, `class-variance-authority`, `clsx` and
`tailwind-merge`. React 19.

## Consuming from apps/web

1. Import the Tailwind config in the web app's `tailwind.config.ts`:

   ```ts
   import uiConfig from "@eserp/ui/tailwind.config";

   export default {
     ...uiConfig,
     content: [
       ...uiConfig.content,
       "./app/**/*.{ts,tsx}",
       "./src/**/*.{ts,tsx}",
     ],
   } satisfies import("tailwindcss").Config;
   ```

   (The package config already covers `packages/ui/src` and the standard
   `apps/web` globs; extend it only if the web app adds new source roots.)
   As built, `apps/web/tailwind.config.ts` instead duplicates the token
   palette inline — that works, but importing the shared config is the
   recommended setup so tokens stay in one place.

   Whichever way the web app configures Tailwind, it must also load the
   `tailwindcss-animate` plugin (a devDependency of this package):
   `Dialog`, `Select` and `DropdownMenu` use its `animate-in` /
   `fade-in-0` / `zoom-in-95` / `slide-in-from-*` utilities, which do
   not exist without the plugin (the components still render, but
   without open/close animations). The shared config in this package
   already includes it; a hand-written web config needs
   `plugins: [require("tailwindcss-animate")]` (or the ESM import).

2. Import the design tokens once, at the app root (e.g. `app/layout.tsx`):

   ```tsx
   import "@eserp/ui/globals.css";
   ```

   That file carries the Tailwind directives plus the light/dark HSL token
   variables. Dark mode is toggled with a `.dark` class on `<html>`.

3. Import components:

   ```tsx
   import { Button, Card, CardContent, Input, Label, Toaster, toast } from "@eserp/ui";
   ```

## Toasts

Toasts use **sonner** (not `@radix-ui/react-toast`): smaller API, built-in
promise/loading toasts, and RTL-aware positioning. Render `<Toaster />` once
near the app root, then call `toast.success(...)` / `toast.error(...)` from
anywhere. See `src/components/toast.tsx`.

## RTL

All components use Tailwind logical utilities (`ms-`/`me-`/`ps-`/`pe-`,
`start-`/`end-`, `text-start`/`text-end`) for directional spacing — never
`ml-`/`mr-`/`pl-`/`pr-` for direction. Set `dir="rtl"` on `<html>` for
Arabic; layouts flip automatically.

## Money

This package renders amounts; it never computes them. Amounts are always
integer minor units + a currency code (e.g. `2735000` halalah + `SAR`) —
never floats. Format with `Intl.NumberFormat` from the integer value.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | `tsc` — emits `dist/` with declarations |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (root flat config) |
| `pnpm test` / `pnpm test:unit` | Vitest + Testing Library (jsdom, no backend) |
| `pnpm test:watch` | Vitest in watch mode |

## Components

Button, Input, Label, Textarea, Select, Checkbox, Switch, Badge, Card,
Dialog, Table, Tabs, Toast/Toaster, Alert, Skeleton, Separator, Avatar,
DropdownMenu, Pagination, Form (react-hook-form), Spinner, EmptyState,
PageHeader. Every component is in `src/components/<name>.tsx` and exported
from `src/index.ts`.
