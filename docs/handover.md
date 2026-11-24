# EsERP — Handover

**Status: complete.** All 12 phases (0–11) are built, tested and
verified in this VM on 2026-11-24. This document is the handover: what
was built per phase, how to run it (Windows first), the demo login,
the known limitations, and — honestly — what was **not** verified here.

## What EsERP is

A multi-tenant, cloud-native SMB ERP — one NestJS API, one Next.js
web app, one Postgres database, with tenant isolation enforced by the
application **and** by Postgres Row-Level Security. First country pack:
**Saudi Arabia** (Saudi chart of accounts, 15% VAT, Arabic/English
with full RTL). Demo tenant: **شركة الصفاء للتجارة / Al-Safa Trading
Co.** (`alsafa-trading`).

Key invariants (all phases): money is integer minor units (`bigint`)
+ currency code, never floats; UUIDv7 PKs; every tenant table has
`tenantId/createdAt/updatedAt/createdBy` + `@@index([tenantId])`;
tenant isolation via JWT claim → guards → `withTenant()` →
Postgres RLS; every mutation writes an `AuditLog` row; async side
effects go through the transactional `OutboxEvent`.

## Per-phase summary

| Phase | What was built | Key files | Migration |
| --- | --- | --- | --- |
| 0 — Foundation | Monorepo, auth (JWT + refresh rotation, TOTP MFA, Google/Microsoft OAuth), tenants + RLS, RBAC (8 system roles), audit log, settings (company, currencies, tax, UoM, numbering, warehouses, branches), i18n/RTL, 7-step onboarding, MinIO files, notifications, invitations, outbox, Saudi CoA template + seed | `apps/api/src/modules/auth/`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/rls.sql`, `packages/db/prisma/seed.ts` | `0001_init`, `0002_rls` |
| 1 — Master Data | Contacts (customer/supplier), item categories, items, price lists, CSV import preview | `apps/api/src/modules/contacts/`, `items/`, `pricelists/`, `master-data/` | `0003_phase1_master_data` |
| 2 — Accounting | Fiscal periods, double-entry journals (`postBalanced()`), cost centres, opening balances, trial balance / ledger / VAT reports | `apps/api/src/modules/accounting/` | `0004_phase2_accounting` |
| 3 — Sales / CRM | Leads, opportunities, quotes, sales orders, sales invoices (+ credit notes), customer payments, AR aging | `apps/api/src/modules/sales/` | `0005_phase3_sales` |
| 4 — Purchasing | Purchase orders, supplier invoices (3-way match, 5% price variance), supplier payments, AP aging | `apps/api/src/modules/purchasing/` | `0006_phase4_purchasing` |
| 5 — Inventory | Stock levels/movements, FIFO/weighted/standard valuation, goods receipts (GRNI), delivery notes (COGS), adjustments, transfers, counts, low-stock report | `apps/api/src/modules/inventory/` | `0007_phase5_inventory` |
| 6 — POS | Terminals, shifts, counter sales (cash/card splits, one combined journal entry), barcode/SKU lookup, Z-report, void | `apps/api/src/modules/pos/` | `0008_phase6_pos` |
| 7 — Manufacturing | Work centres, BOMs (computed roll-up cost), work orders (BOM snapshot at release), material issues (WIP), production receipts, scrap, WIP report | `apps/api/src/modules/manufacturing/` | `0009_phase7_manufacturing` |
| 8 — HR / Payroll | Departments, employees, leave (working-day calc), attendance, payroll runs (GOSI + EOSB, accrual + bank payment postings) | `apps/api/src/modules/hr/` | `0010_phase8_hr_payroll` |
| 9 — Projects | Projects, tasks, timesheets (minutes), expenses, milestones (→ draft invoice), project costing | `apps/api/src/modules/projects/` | `0011_phase9_projects` |
| 10 — Analytics / AI | KPI dashboard (Redis-cached 60s), P&L / balance sheet / cash flow, CSV exports + report snapshots, rule-based AI insights + ask | `apps/api/src/modules/analytics/`, `ai/` | `0012_phase10_analytics` |
| 11 — Integrations | ZATCA e-invoicing (UBL 2.1 + TLV QR + hash chain; simulation default, sandbox client), outbound webhooks (HMAC, BullMQ, 5 attempts), API keys (hash-only, `X-API-Key` auth), export centre, payment/SMS provider mocks, AES-256-GCM field encryption (national ID/IBAN), rate limiting, Windows setup | `apps/api/src/modules/zatca/`, `webhooks/`, `api-keys/`, `exports/`, `providers/`, `packages/db/src/encryption.ts`, `setup-windows.ps1` | `0013_phase11_integrations` |

Full per-phase detail: `docs/erd-phase0.md` … `docs/erd-phase11.md`,
`docs/architecture.md`, `docs/security.md`.

## How to run

### On Windows (recommended path)

Prerequisites: **Node.js LTS 20+**, **Docker Desktop** (with the WSL 2
backend), **PowerShell 5.1+**. Then, from the repo root:

```powershell
.\setup-windows.ps1
```

That checks prerequisites, copies `.env.example` → `.env`, starts
Postgres/Redis/MinIO/MailHog, installs dependencies, runs migrations
+ seed, and prints the URLs and demo login. Double-clicking
`setup-windows.bat` does the same thing. Then start the apps:

```powershell
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001/api/v1/health

Full steps, the manual alternative, and the troubleshooting table are
in the README ("Run on Windows"). **The PowerShell script was
reviewed, not executed, in this Linux VM** — see "Not verified" below.

### On Linux / macOS

```bash
cp .env.example .env        # fill in real secrets for anything shared
docker compose up -d        # postgres, redis, minio, mailhog
pnpm install
# Migrations/seed need the owner role (DDL); the app runs as eserp_app.
DATABASE_URL="postgresql://eserp:eserp_dev_password@localhost:5432/eserp?schema=public" pnpm db:migrate
pnpm db:seed
pnpm dev                    # web on :3000, api on :3001
```

Ports: web 3000, API 3001, Postgres 5432, Redis 6379, MinIO 9000/9001,
MailHog 1025/8025.

### Demo login (seeded, local development only)

| User | Email | Password |
| --- | --- | --- |
| Owner (admin) | `admin@alsafa-trading.sa` | `Demo1234!` |
| Accountant, Sales, Purchasing, Warehouse, HR, Viewer | `<role>@alsafa-trading.sa` (e.g. `accountant@alsafa-trading.sa`) | `Demo1234!` |

## Verification performed in this VM (2026-11-24)

All green, with the app-role database URL + Redis + JWT dev secrets
(+ `ENCRYPTION_KEY` set for the encryption checks):

| Check | Result |
| --- | --- |
| `pnpm lint` | Green (0 errors; pre-existing warnings only) |
| `pnpm typecheck` | Green (10 tasks) |
| `pnpm build` | Green (6 tasks, incl. Next.js production build) |
| `pnpm test` | **182 passed** — shared 106, i18n 3, UI 16, db 2 (incl. Phase 11 RLS), web 14, API 41 (incl. encryption round-trip/tamper, rate limiter, webhook HMAC). No tests skipped. |
| `pnpm --filter @eserp/api test:e2e` | **13/13 passed**, incl. the Phase 11 flow: invoice → ZATCA generate → submit (simulation) → webhook test delivery to a local receiver with a verified HMAC signature → API key create/use/revoke/401 → CSV export + job → mock charge → encrypted-field masking (viewer masked, HR full) → cross-tenant 404 → viewer 403 |
| `prisma validate` | Schema valid |
| `prisma migrate diff` (vs a separate empty `eserp_diff` database — never the live DB) | Empty migration: schema matches migrations |
| `prisma migrate deploy` + `pnpm db:seed` (owner URL) | 13 migrations, no pending; seed idempotent; demo data present (incl. 1 DISABLED demo webhook endpoint + 1 REVOKED demo API key) |
| Field-encryption migration script | `prisma/scripts/encrypt-employee-fields.ts`: idempotent (already-`enc1:` values skipped); all 4 demo employees store `enc1:` values. Handover fix 2026-11-24: the original dev key was lost, so the demo rows were reset to seed plaintext and re-encrypted with the fresh key now stored in the local (gitignored) `.env`; `setup-windows.ps1` generates a key automatically when `.env` has none. |
| Live smoke test (built API + built web) | `GET /api/v1/health` → `{"status":"ok","db":"up"}`; login as demo admin OK; `GET /api/v1/analytics/dashboard?year=2026&month=11` → real KPIs (revenue 360,397; gross margin 82.13%); `GET /api/v1/zatca/documents` → 200 (empty for the demo tenant); `GET /api/v1/exports/contacts?format=csv` → real CSV rows; `GET /api/v1/providers/status` → mock-labelled; web pages `/en/zatca-documents`, `/en/webhooks`, `/en/api-keys`, `/en/exports`, `/en/providers` → all 200. Both servers stopped afterwards. |

## Known limitations (consolidated)

- **ZATCA: no live clearance.** Simulation is the default and is
  labelled `*_SIMULATED` everywhere. The sandbox client maps ZATCA's
  published API shape but was never exercised against a live ZATCA
  account (no credentials exist). Production clearance needs real
  ZATCA onboarding (OTP + CCSID + production certificate) which only
  the tenant can complete.
- **No live payments or SMS** — mock providers only (Moyasar/HyperPay/
  SMS are env-var config + documented adapter points).
- **No stored export files** — `ExportJob.fileAssetId` is always null
  in Phase 11; downloads are direct.
- **Rate limiting is per-process** (in-memory fixed window); with
  multiple API replicas a tenant could exceed the limit by up to N×.
  Redis-backed limiting is the documented production hardening.
- **Encryption key rotation is not implemented** — rotating
  `ENCRYPTION_KEY` orphans previously encrypted values. Rotation
  needs a re-encryption pass.
- **Search by national ID** no longer works once values are encrypted.
- **OAuth needs real client IDs** (Google/Microsoft login disabled
  unless configured). **Refresh-token reuse** fails the request but
  does not revoke the whole token family. **Audit rows** are
  append-only by convention, not by a database trigger.
- **POS is online-first** (no offline queue/sync, no printer/drawer/
  scanner drivers). **Payroll uses the pre-July-2024 GOSI scheme**
  (new-law step-up rates from 1 July 2026 are out of scope).
  **Milestone invoice amounts are VAT-exempt (tax 0)** in Phase 9.
- **Demo seed password (`Demo1234!`) is for local development only.**
- Earlier phases' limits still apply — see each `docs/erd-phaseN.md`
  ("Known limitations" / "Limitations").

## NOT verified in this VM

- **Docker Compose end-to-end** — no Docker in this VM; Postgres/Redis
  were apt-installed and running on localhost instead. The compose
  file and Dockerfiles were not executed here.
- **GitHub CI run** — the workflow (`.github/workflows/ci.yml`) was
  not executed here.
- **PowerShell script execution** — `powershell` is not available in
  this Linux VM; `setup-windows.ps1` / `setup-windows.bat` were
  written and carefully reviewed, but never run on Windows.
- **Real ZATCA production clearance** — needs tenant onboarding and
  credentials that do not exist here (see above).
- **Real payment/SMS providers** — mocks only; no live Moyasar,
  HyperPay or SMS account was used.
- **MinIO / MailHog** — not running in this VM (S3/MailHog-dependent
  paths were not smoke-tested live).

## If something breaks first

1. `docker compose ps` — are Postgres/Redis healthy? On Windows,
   is Docker Desktop actually running?
2. `pnpm db:migrate` with the **owner** URL (migrations need DDL);
   the API/tests must use the **`eserp_app`** URL (owner bypasses
   RLS — the RLS test fails loudly if run as a superuser).
3. `ENCRYPTION_KEY` must be the **same** value for the API, the seed
   and the encryption script. **Fixed 2026-11-24 (handover):** the dev key
   that encrypted the demo data was lost when it lived only in `/tmp`,
   which broke the e2e masking check (viewer saw `****` instead of
   `****5678`). The demo employees were reset to their seed plaintext
   values and re-encrypted with a fresh key, which is now stored in the
   local (gitignored) `.env` in this VM (`ENCRYPTION_KEY=3ab7f6c4…623a`)
   and the e2e suite passes 13/13 with it set. On Windows,
   `setup-windows.ps1` now **generates an `ENCRYPTION_KEY` into `.env`
   automatically** when none is set — keep that file: losing the key
   makes already-encrypted employee values undecryptable, and the
   recovery is to generate a fresh key, set it everywhere, and re-enter
   each employee's national ID / IBAN once through the HR UI (writes
   encrypt with the current key). For a fresh database, simply set any
   64-hex-char key before the first seed and it just works.
4. Ports 3000/3001/5432/6379/9000/1025 in use → stop the other
   program or change `docker-compose.yml`.
5. `setup-windows.ps1` blocked by execution policy → use
   `setup-windows.bat` (it passes `-ExecutionPolicy Bypass`) or run
   `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
