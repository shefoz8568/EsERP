# @eserp/web — EsERP web app (Phase 0)

Next.js 15 App Router + React 19. Bilingual (English / Arabic) with full RTL
support. All UI strings come from `@eserp/i18n`; components come from
`@eserp/ui` (shadcn/ui-style, Radix + Tailwind).

## Run

```bash
# from the repo root (installs all workspaces once)
pnpm install

# start the API first (port 3001), then the web app
pnpm --filter @eserp/web dev        # http://localhost:3000
pnpm --filter @eserp/web build
pnpm --filter @eserp/web test       # vitest (no backend needed; fetch is mocked)
pnpm --filter @eserp/web typecheck  # tsc --noEmit
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` | API base URL (see `src/lib/api.ts`) |

No secrets live in the web app. The access token is kept in memory only
(never `localStorage`); see **Auth** below.

## Pages map

| Route | What it does |
| --- | --- |
| `/` | Redirects to `/en/dashboard` (locale middleware prefixes `/en` or `/ar`) |
| `/[locale]/login` | Email + password; routes to `/mfa` when `mfaRequired` |
| `/[locale]/register` | Creates tenant + owner; applies the company name to the profile, then goes to onboarding |
| `/[locale]/mfa` | 6-digit TOTP code entry |
| `/[locale]/dashboard` | Greeting, tenant/company name, real counts (users / warehouses / currencies), latest 10 audit-log entries, next-steps card |
| `/[locale]/onboarding` | 7-step wizard (see below) |
| `/[locale]/settings?tab=…` | Tabs: `company`, `currencies`, `taxes`, `units`, `numbering`, `warehouses`, `users`, `roles`, `audit` |
| `/[locale]/notifications` | Notification list with mark-as-read |

## Auth

- `src/lib/api.ts` — typed fetch client. Attaches the in-memory Bearer
  token, parses the API's `{ error: { code, message } }` envelope into
  `ApiError`, and on a 401 refreshes once and retries.
- `src/lib/auth.tsx` — `AuthProvider` + `useAuth()` + `RequireAuth` route
  guard. Login/register/MFA responses are normalised: the API returns
  `{ tokens: { accessToken, refreshToken }, user }` (nested tokens, flat
  user object) and the client maps that to the brief's flat shape.
- **Contract deviation (real API):** the API does **not** set an httpOnly
  refresh cookie — `POST /auth/refresh` and `POST /auth/logout` take
  `{ refreshToken }` in the JSON body. The refresh token is therefore also
  kept in memory only, so a page reload ends the session (the user logs in
  again) instead of silently restoring it. Nothing token-like is ever
  written to `localStorage` or a cookie.

## Onboarding wizard (`src/components/onboarding/OnboardingWizard.tsx`)

Steps 0–6, persisted with `POST /onboarding/step` after each step, resumed
from the server's `currentStep`; `POST /onboarding/complete` needs steps
0–4 (the API enforces this). Skip is allowed only for invite (5) and
import (6).

Payloads follow the real `@eserp/shared` DTOs:

- 0 company → `{ legalName, tradeName }` (workspace name / currency were
  set at registration)
- 1 fiscal year → `{ fiscalYearStartMonth: 1–12, calendarType }`
- 2 chart of accounts → `{ template: "saudi" }` (Saudi template
  pre-selected; summary shows the 5 account groups + 15% VAT note)
- 3 taxes → `{ taxes: [{ name, rateBps, type: "standard", isInclusive, isDefault }] }`
- 4 warehouse → `{ name, city }`
- 5 invites → `{ invites: [{ email, roleNames: [role] }] }`
- 6 import → `{ csvText }`; the CSV is parsed in the browser with
  PapaParse for an instant preview (first 10 rows + per-row errors) and
  also validated server-side via `POST /onboarding/import/preview`.

## Settings tabs

Field names follow the real DTOs: taxes use **basis points**
(`rateBps`, 1500 = 15%), units use `{ code, name, baseUnitCode }`,
numbering series use `{ code, name, pattern, nextNumber, prefix }`,
company profile uses `legalName` / `tradeName` / `addressLine1` /
`city` (default currency lives on the tenant, `GET/PATCH /tenants/me`).
The roles tab renders the permission matrix from `@eserp/shared`
`ALL_PERMISSIONS` (`module:action` strings) and saves with
`PATCH /roles/:id/permissions`. Lists are normalised from the API's
`{ data, meta: { total, page, pageSize, totalPages } }` envelope; the
audit log uses the `pageSize` query param and exposes `actorId`.

A few `DELETE`/`PATCH` routes in the original brief do not exist in the
API, so the UI does not offer them: no delete for units, numbering
series or branches, and no edit for currencies. Where a call 404s the
error is shown (toast / error state) — no data is invented.

## i18n / RTL

- Locales: `en` (default), `ar`. Routing via `next-intl` middleware
  (`middleware.ts`, `src/i18n/request.ts`); the dictionaries live in
  `@eserp/i18n` and are passed to next-intl as messages, so every string
  still comes from the shared dictionaries.
- `[locale]/layout.tsx` sets `<html lang dir>` from the locale
  (`dir="rtl"` for Arabic). Components use Tailwind logical utilities
  (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`) — never physical `ml-`/`mr-`.
- `LanguageSwitcher` navigates to the same path in the other locale.
- Dark mode is class-based (`.dark` on `<html>`), toggled in the Topbar
  and persisted in the `eserp-theme` cookie (with a no-flash inline
  script in the layout).

## Money

Money is integer minor units + currency code. Display goes through
`formatMoney(minor, currency, locale)` in `src/lib/money.ts`
(`Intl.NumberFormat`); floats are never used for money. Tax rates are
stored as basis points and converted with `percentToBps`/`bpsToPercent`
(`src/lib/types.ts`).

## Tests

Vitest + Testing Library, runnable without a backend (fetch is mocked):

- `src/lib/money.test.ts` — `formatMoney` / `formatPercent`
- `src/lib/locale.test.ts` — `dirFor` / `applyDocumentDir` (asserts
  `document.dir === "rtl"` for `ar`) / locale-path switching
- `src/components/LanguageSwitcher.test.tsx` — renders both locales
- `src/components/onboarding/OnboardingWizard.test.tsx` — step
  navigation with mocked fetch, Saudi CoA step content
