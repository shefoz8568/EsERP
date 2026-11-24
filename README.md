# EsERP

**EsERP** is a multi-tenant, cloud-native SMB ERP — one NestJS API, one
Next.js web app, one Postgres database, with tenant isolation enforced by
the application *and* by Postgres Row-Level Security.

**First country pack: Saudi Arabia** — Saudi chart of accounts, 15% VAT,
Arabic/English with full RTL support. The demo tenant is
**شركة الصفاء للتجارة / Al-Safa Trading Co.** (`alsafa-trading`).

## Architecture at a glance

| Layer | Technology |
| --- | --- |
| Web | Next.js 15 App Router, React 19, Tailwind CSS 3, next-intl (en/ar, RTL) |
| API | NestJS modular monolith, TypeScript strict, REST `/api/v1` |
| Data | PostgreSQL 16 + Prisma 6, RLS per tenant (`app.tenant_id`) |
| Queue | Redis 7 + BullMQ, transactional outbox (`OutboxEvent`) |
| Files | MinIO (S3-compatible), presigned uploads (`FileAsset`) |
| Mail | SMTP — MailHog captures mail locally |
| Shared | `@eserp/shared` (Money, Zod DTOs, roles/permissions), `@eserp/ui` (shadcn-style primitives), `@eserp/i18n` (en/ar) |

Key invariants:

- **Money is integer minor units + currency code, never floats.**
  Amounts are `bigint` halalas (SAR) / cents (USD); exchange rates are
  rational numerator/denominator; tax rates are integer basis points
  (1500 = 15% VAT). See `packages/shared/src/money.ts`.
- **Tenant isolation is defense in depth:** JWT tenant claim → API
  guards (RBAC/ABAC) → `withTenant()` transaction context
  (`SET LOCAL app.tenant_id`) → Postgres RLS `tenant_isolation` policy
  with `FORCE ROW LEVEL SECURITY` on all 48 tenant-scoped tables.
- **Audit log is append-only.** Every mutation writes an `AuditLog`
  row (actor, action, entity, before/after JSON).

Details: [`docs/architecture.md`](docs/architecture.md),
[`docs/erd-phase0.md`](docs/erd-phase0.md),
[`docs/erd-phase1.md`](docs/erd-phase1.md),
[`docs/erd-phase2.md`](docs/erd-phase2.md),
[`docs/erd-phase3.md`](docs/erd-phase3.md),
[`docs/erd-phase4.md`](docs/erd-phase4.md),
[`docs/erd-phase5.md`](docs/erd-phase5.md),
[`docs/erd-phase6.md`](docs/erd-phase6.md),
[`docs/erd-phase7.md`](docs/erd-phase7.md),
[`docs/erd-phase8.md`](docs/erd-phase8.md),
[`docs/erd-phase9.md`](docs/erd-phase9.md),
[`docs/erd-phase10.md`](docs/erd-phase10.md),
[`docs/erd-phase11.md`](docs/erd-phase11.md),
[`docs/handover.md`](docs/handover.md),
[`docs/security.md`](docs/security.md).

## Prerequisites

- Node.js **20+**
- pnpm **9** (`corepack enable && corepack prepare pnpm@9 --activate`)
- Docker + Docker Compose (for Postgres, Redis, MinIO, MailHog)

## Quick start

### Run on Windows

Prerequisites: **Node.js LTS 20+**, **Docker Desktop** (with the
WSL 2 backend), **PowerShell 5.1+**. From the repo root:

```powershell
.\setup-windows.ps1
```

That checks prerequisites, copies `.env.example` → `.env`, starts
Postgres/Redis/MinIO/MailHog, installs dependencies, runs migrations
+ seed, and prints the URLs and demo login. Double-clicking
`setup-windows.bat` does the same thing. Then:

```powershell
pnpm dev
```

- Web: http://localhost:3000 — API: http://localhost:3001/api/v1/health
- Demo login: `admin@alsafa-trading.sa` / `Demo1234!`

Manual alternative (same steps, PowerShell syntax):

```powershell
Copy-Item .env.example .env   # only if .env does not exist yet
docker compose up -d
pnpm install
$env:DATABASE_URL = "postgresql://eserp:eserp_dev_password@localhost:5432/eserp?schema=public"
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Troubleshooting:

| Problem | Fix |
| --- | --- |
| `setup-windows.ps1 cannot be loaded … execution policy` | Use `setup-windows.bat` (it passes `-ExecutionPolicy Bypass`), or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once |
| `Docker Desktop is installed but not running` | Start Docker Desktop and wait until its tray icon says it is running, then re-run the script |
| Port already in use (3000 / 3001 / 5432 / 6379 / 9000 / 1025) | Stop the other program using the port, or change the port in `docker-compose.yml` |
| `pnpm` not found | Run `corepack enable` then `corepack prepare pnpm@9 --activate` (the script does this automatically) |
| `pnpm install` fails | Delete `node_modules` and re-run; if the error mentions the lockfile, run `pnpm install --no-frozen-lockfile` once |
| Strange errors after editing files on Windows | Line endings: `.gitattributes` forces `*.ps1`/`*.bat` to CRLF and `*.sh` to LF — check the file out fresh if it was edited with the wrong endings |

> **Note:** the Windows setup script was reviewed, not executed, in
> the Linux VM where the project was built — see
> [`docs/handover.md`](docs/handover.md) ("NOT verified in this VM").

### Run on Linux / macOS

```bash
cp .env.example .env        # fill in real secrets for anything shared
docker compose up -d        # postgres, redis, minio, mailhog
pnpm install
# Migrations need the owner role (DDL); the app/test DATABASE_URL in .env is
# the least-privilege `eserp_app` role, which cannot create tables.
DATABASE_URL="postgresql://eserp:eserp_dev_password@localhost:5432/eserp?schema=public" pnpm db:migrate
pnpm db:seed                # demo tenant, roles, CoA, VAT, users
pnpm dev                    # web on :3000, api on :3001
```

> **Database roles — read this before changing DATABASE_URL.** The API and
> tests connect as `eserp_app`, a non-superuser role created on first boot
> by `docker/postgres/init/01-app-user.sh` (and granted via
> `ALTER DEFAULT PRIVILEGES`, so later migrations stay usable). The owner
> role (`eserp`, a superuser in the compose setup) **bypasses Postgres RLS
> entirely** — connecting the API as the owner would leave tenant isolation
> to the application guard alone. The RLS integration test
> (`packages/db/src/rls.test.ts`) fails loudly if it ever runs on a
> superuser connection, precisely to catch this misconfiguration.

### Demo login

Seeded by `packages/db/prisma/seed.ts` (local development only):

| User | Email | Password |
| --- | --- | --- |
| Owner (admin) | `admin@alsafa-trading.sa` | `Demo1234!` |
| Accountant, Sales, Purchasing, Warehouse, HR, Viewer | `<role>@alsafa-trading.sa` (e.g. `accountant@alsafa-trading.sa`) | `Demo1234!` |

The seed also creates: SAR (default) / USD / EUR / AED currencies with
USD→SAR 3.75 peg, VAT 15% (standard, default) / 0% zero-rated / exempt,
the Saudi chart of accounts (`prisma/data/saudi-coa.json`), main
warehouse `WH-RIY-01` and main branch `BR-RIY-01` in Riyadh, and the
numbering series / units of measure.

## Ports

| Service | Port |
| --- | --- |
| Web (Next.js) | 3000 |
| API (NestJS) | 3001 |
| PostgreSQL 16 | 5432 |
| Redis 7 | 6379 |
| MinIO API / Console | 9000 / 9001 |
| MailHog SMTP / UI | 1025 / 8025 |

## Tests

```bash
pnpm test            # whole repo (turbo: build deps first, then test)
pnpm test:unit       # unit tests only
pnpm --filter @eserp/ui test        # one package
pnpm --filter @eserp/shared test
pnpm --filter @eserp/db test
```

Unit tests (Vitest + Testing Library, jsdom) run without any backend.
Integration tests need a running Postgres — start it with
`docker compose up -d postgres` and set `DATABASE_URL` (see
`.env.example`); CI provides Postgres + Redis as services. The RLS test
and the API e2e suite only run for real when `DATABASE_URL` points at the
`eserp_app` role (never a superuser/owner — see "Database roles" above);
without a database they print a SKIPPED line instead of failing.

End-to-end (API: register → login → me → onboarding → currency → audit
log, plus cross-tenant isolation) — needs Postgres + Redis + JWT secrets:

```bash
DATABASE_URL="postgresql://eserp_app:<app-password>@localhost:5432/eserp?schema=public" \
REDIS_URL="redis://localhost:6379" \
JWT_ACCESS_SECRET="<dev-secret>" JWT_REFRESH_SECRET="<dev-secret>" \
pnpm --filter @eserp/api test:e2e
```

Other commands: `pnpm build`, `pnpm lint`, `pnpm typecheck`,
`pnpm db:studio` (Prisma Studio).

## API examples

Base URL: `http://localhost:3001/api/v1`. Auth is Bearer JWT; the tenant
comes from the token claim, never from the request body. Paths below are
verified against the controllers in `apps/api/src/modules`.

```bash
# Health
curl http://localhost:3001/api/v1/health

# Register a new tenant + owner account
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"tenantName":"Al-Safa Trading","email":"admin@alsafa-trading.sa","password":"Demo1234!","defaultCurrency":"SAR","defaultLocale":"ar"}'

# Log in (returns access + refresh tokens; MFA users get an mfaToken instead)
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@alsafa-trading.sa","password":"Demo1234!","tenantSlug":"alsafa-trading"}'

# Current user (Bearer token from login)
curl http://localhost:3001/api/v1/auth/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Onboarding — submit one wizard step (steps 0–6, see docs/erd-phase0.md)
curl -X POST http://localhost:3001/api/v1/onboarding/step \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"step":0,"data":{"legalName":"شركة الصفاء للتجارة","taxNumber":"300000000000003","country":"SA"}}'

# List currencies for the tenant
curl http://localhost:3001/api/v1/settings/currencies \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# List contacts (search + type filter)
curl "http://localhost:3001/api/v1/contacts?search=noor&type=CUSTOMER" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Create a customer (Saudi VAT number is 15 digits when present)
curl -X POST http://localhost:3001/api/v1/contacts \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"CUSTOMER","legalName":"Al-Noor Retail Stores","displayName":"Al-Noor Retail","taxNumber":"300100000000001","email":"sales@alnoor-retail.sa","creditLimitMinor":5000000,"paymentTermsDays":30}'

# Create an item (prices are integer minor units — halalas for SAR)
curl -X POST http://localhost:3001/api/v1/items \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sku":"RICE-BAS-5KG","name":"Basmati Rice 5kg","defaultUomId":"<uom-id>","salesPriceMinor":3499,"purchasePriceMinor":2800,"costingMethod":"FIFO"}'

# CSV import preview for contacts (validated, nothing persisted)
curl -X POST http://localhost:3001/api/v1/contacts/import/preview \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"csvText":"legalName,displayName,type,email\nGood Co,Good,CUSTOMER,good@co.sa"}'

# Create a draft journal entry (amounts are integer minor units — halalas)
curl -X POST http://localhost:3001/api/v1/journals \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"entryDate":"2026-11-15T00:00:00.000Z","description":"Cash sale","lines":[{"accountId":"<cash-1010-id>","debitMinor":1150000,"creditMinor":0},{"accountId":"<sales-4010-id>","debitMinor":0,"creditMinor":1000000},{"accountId":"<vat-2110-id>","debitMinor":0,"creditMinor":150000}]}'

# Post it, then reverse it (reversal creates a new POSTED entry with swapped lines)
curl -X POST http://localhost:3001/api/v1/journals/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/journals/<id>/reverse -H "Authorization: Bearer $ACCESS_TOKEN"

# Trial balance / VAT summary for a fiscal period
curl "http://localhost:3001/api/v1/reports/trial-balance?fiscalPeriodId=<period-id>" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl "http://localhost:3001/api/v1/reports/vat-summary?fiscalPeriodId=<period-id>" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Sales: lead -> convert -> quote -> accept -> order -> confirm -> invoice -> post -> pay
curl -X POST http://localhost:3001/api/v1/leads \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Khalid Al-Otaibi","company":"Otaibi Trading","source":"REFERRAL","expectedValueMinor":5000000}'
curl -X POST http://localhost:3001/api/v1/leads/<id>/convert \
  -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/quotes \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"customerId":"<customer-id>","validFrom":"2026-11-24T00:00:00.000Z","validTo":"2026-12-24T00:00:00.000Z","lines":[{"itemId":"<item-id>","quantity":10,"unitPriceMinor":3499,"taxRateBps":1500}]}'
curl -X POST http://localhost:3001/api/v1/quotes/<id>/send -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/quotes/<id>/accept -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/sales-orders/<order-id>/confirm -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/sales-invoices \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"customerId":"<customer-id>","orderId":"<order-id>","invoiceDate":"2026-11-24T00:00:00.000Z","lines":[{"itemId":"<item-id>","quantity":10,"unitPriceMinor":3499,"taxRateBps":1500}]}'
curl -X POST http://localhost:3001/api/v1/sales-invoices/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/customer-payments \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"customerId":"<customer-id>","method":"BANK_TRANSFER","paymentDate":"2026-11-24T00:00:00.000Z","amountMinor":20000,"allocations":[{"invoiceId":"<invoice-id>","amountMinor":20000}]}'
curl "http://localhost:3001/api/v1/reports/ar-aging" -H "Authorization: Bearer $ACCESS_TOKEN"

# Purchasing: PO -> confirm -> supplier invoice (3-way matched) -> post -> pay
curl -X POST http://localhost:3001/api/v1/purchase-orders \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"supplierId":"<supplier-id>","lines":[{"itemId":"<item-id>","quantity":50,"unitPriceMinor":2800,"taxRateBps":1500}]}'
curl -X POST http://localhost:3001/api/v1/purchase-orders/<id>/send -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/purchase-orders/<id>/confirm -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/supplier-invoices \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"supplierId":"<supplier-id>","purchaseOrderId":"<po-id>","invoiceDate":"2026-11-24T00:00:00.000Z","lines":[{"itemId":"<item-id>","quantity":50,"unitPriceMinor":2800,"taxRateBps":1500,"purchaseOrderLineId":"<po-line-id>"}]}'
curl -X POST http://localhost:3001/api/v1/supplier-invoices/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/supplier-payments \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"supplierId":"<supplier-id>","method":"BANK_TRANSFER","paymentDate":"2026-11-24T00:00:00.000Z","amountMinor":100000,"allocations":[{"invoiceId":"<invoice-id>","amountMinor":100000}]}'
curl "http://localhost:3001/api/v1/reports/ap-aging" -H "Authorization: Bearer $ACCESS_TOKEN"

# Inventory: receive a PO -> post (Dr 1210 / Cr 2020), then deliver an order -> post (Dr 5010 / Cr 1210)
curl -X POST http://localhost:3001/api/v1/inventory/goods-receipts \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"purchaseOrderId":"<po-id>","warehouseId":"<warehouse-id>","receiptDate":"2026-11-24T00:00:00.000Z","lines":[{"purchaseOrderLineId":"<po-line-id>","itemId":"<item-id>","quantity":30,"unitCostMinor":2800}]}'
curl -X POST http://localhost:3001/api/v1/inventory/goods-receipts/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/inventory/delivery-notes \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"salesOrderId":"<order-id>","warehouseId":"<warehouse-id>","deliveryDate":"2026-11-24T00:00:00.000Z","lines":[{"salesOrderLineId":"<order-line-id>","itemId":"<item-id>","quantity":20}]}'
curl -X POST http://localhost:3001/api/v1/inventory/delivery-notes/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl "http://localhost:3001/api/v1/inventory/stock?lowStockOnly=true" -H "Authorization: Bearer $ACCESS_TOKEN"
curl "http://localhost:3001/api/v1/inventory/reports/low-stock" -H "Authorization: Bearer $ACCESS_TOKEN"

# POS: open a shift -> look up an item by barcode -> sell -> Z-report -> close
curl -X POST http://localhost:3001/api/v1/pos/shifts/open \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"terminalId":"<terminal-id>","openingFloatMinor":50000}'
curl "http://localhost:3001/api/v1/pos/lookup?terminalId=<terminal-id>&code=RICE-BAS-5KG" -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/pos/sales \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"terminalId":"<terminal-id>","shiftId":"<shift-id>","lines":[{"itemId":"<item-id>","quantity":2,"unitPriceMinor":3499,"taxRateBps":1500}],"payments":[{"method":"CASH","amountMinor":8048}]}'
curl "http://localhost:3001/api/v1/pos/shifts/<shift-id>/z-report" -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/pos/shifts/<shift-id>/close \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"countedCashMinor":58048}'

# Manufacturing: BOM -> work order -> release -> issue -> receipt -> scrap -> WIP report
curl -X POST http://localhost:3001/api/v1/manufacturing/boms \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"finishedItemId":"<item-id>","version":1,"status":"DRAFT","lines":[{"componentItemId":"<comp-id>","quantityPerUnit":2,"scrapBps":500}]}'
curl http://localhost:3001/api/v1/manufacturing/boms/<id>/cost -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X PATCH http://localhost:3001/api/v1/manufacturing/boms/<id> \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"status":"ACTIVE"}'
curl -X POST http://localhost:3001/api/v1/manufacturing/work-orders \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"finishedItemId":"<item-id>","bomId":"<bom-id>","warehouseId":"<warehouse-id>","qtyPlanned":10}'
curl -X POST http://localhost:3001/api/v1/manufacturing/work-orders/<id>/release -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/manufacturing/material-issues \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"workOrderId":"<wo-id>","warehouseId":"<warehouse-id>","lines":[{"workOrderLineId":"<wo-line-id>","itemId":"<comp-id>","quantity":21}]}'
curl -X POST http://localhost:3001/api/v1/manufacturing/material-issues/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/manufacturing/production-receipts \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"workOrderId":"<wo-id>","warehouseId":"<warehouse-id>","quantity":6}'
curl -X POST http://localhost:3001/api/v1/manufacturing/production-receipts/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/manufacturing/scrap \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"workOrderId":"<wo-id>","kind":"FINISHED","itemId":"<item-id>","warehouseId":"<warehouse-id>","quantity":1,"reason":"Damaged"}'
curl -X POST http://localhost:3001/api/v1/manufacturing/scrap/<id>/post -H "Authorization: Bearer $ACCESS_TOKEN"
curl http://localhost:3001/api/v1/manufacturing/reports/wip -H "Authorization: Bearer $ACCESS_TOKEN"

# HR / payroll: employee -> leave -> attendance -> payroll calculate -> approve -> pay
curl -X POST http://localhost:3001/api/v1/hr/employees \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"code":"EMP-001","name":"Sara Al-Harbi","jobTitle":"HR Manager","departmentId":"<dept-id>","hireDate":"2023-01-15T00:00:00.000Z","basicSalaryMinor":1200000,"housingAllowanceMinor":300000,"nationality":"SAUDI"}'
curl -X POST http://localhost:3001/api/v1/hr/leave-requests \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"employeeId":"<emp-id>","leaveTypeId":"<type-id>","startDate":"2026-11-15T00:00:00.000Z","endDate":"2026-11-17T00:00:00.000Z"}'
curl -X POST http://localhost:3001/api/v1/hr/leave-requests/<id>/approve -H "Authorization: Bearer $ACCESS_TOKEN"
curl http://localhost:3001/api/v1/hr/leave-balances?employeeId=<emp-id> -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/hr/attendance/bulk \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"date":"2026-11-10T00:00:00.000Z","records":[{"employeeId":"<emp-id>","status":"ABSENT"}]}'
curl -X POST http://localhost:3001/api/v1/hr/payroll-runs \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"periodYear":2026,"periodMonth":11}'
curl -X POST http://localhost:3001/api/v1/hr/payroll-runs/<id>/calculate -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' -d '{"overrides":[]}'
curl -X POST http://localhost:3001/api/v1/hr/payroll-runs/<id>/approve -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/hr/payroll-runs/<id>/pay \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"bankAccountCode":"1020","paymentDate":"2026-11-24T00:00:00.000Z"}'

# Projects: project -> task -> timesheet -> approve -> expense -> milestone -> invoice
curl -X POST http://localhost:3001/api/v1/projects \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"code":"PRJ-001","name":"Riyadh Trade Show Booth","customerId":"<contact-id>","billingType":"MILESTONE","budgetMinor":2000000,"startDate":"2026-11-01T00:00:00.000Z","dueDate":"2026-12-15T00:00:00.000Z"}'
curl -X POST http://localhost:3001/api/v1/project-tasks \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"<project-id>","title":"Booth design and 3D mockup","assigneeId":"<employee-id>","estimatedHours":40,"priority":"HIGH"}'
curl -X POST http://localhost:3001/api/v1/timesheets \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"employeeId":"<employee-id>","projectId":"<project-id>","taskId":"<task-id>","date":"2026-11-10T00:00:00.000Z","hours":8}'
curl -X POST http://localhost:3001/api/v1/timesheets/<id>/approve -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/project-expenses \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"<project-id>","date":"2026-11-14T00:00:00.000Z","category":"MATERIALS","amountMinor":150000}'
curl -X POST http://localhost:3001/api/v1/project-expenses/<id>/approve -H "Authorization: Bearer $ACCESS_TOKEN"
curl http://localhost:3001/api/v1/projects/<id>/costing -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/milestones \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectId":"<project-id>","title":"Booth design approved","dueDate":"2026-11-20T00:00:00.000Z","amountMinor":500000}'
curl -X POST http://localhost:3001/api/v1/milestones/<id>/achieve -H "Authorization: Bearer $ACCESS_TOKEN"

# Analytics / AI: dashboard, statements, exports, snapshots, ask
curl "http://localhost:3001/api/v1/analytics/dashboard?year=2026&month=11" -H "Authorization: Bearer $ACCESS_TOKEN"
curl "http://localhost:3001/api/v1/analytics/profit-loss?from=2026-11-01T00:00:00.000Z&to=2026-11-30T23:59:59.999Z" -H "Authorization: Bearer $ACCESS_TOKEN"
curl "http://localhost:3001/api/v1/analytics/balance-sheet?asOf=2026-11-30T00:00:00.000Z" -H "Authorization: Bearer $ACCESS_TOKEN"
curl http://localhost:3001/api/v1/analytics/exports/ar-aging -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/analytics/report-snapshots \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"PROFIT_LOSS","parameters":{}}'
curl http://localhost:3001/api/v1/ai/insights -H "Authorization: Bearer $ACCESS_TOKEN"
curl -X POST http://localhost:3001/api/v1/ai/ask \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"question":"What is the revenue this month?"}'
```

## Monorepo layout

```
eserp/
├── apps/
│   ├── api/                  # NestJS modular monolith (port 3001)
│   └── web/                  # Next.js 15 App Router, en/ar + RTL (port 3000)
├── packages/
│   ├── db/                   # Prisma schema, migrations, RLS, seed
│   ├── shared/               # Money, Zod DTOs, roles/permissions, errors
│   ├── i18n/                 # en/ar dictionaries, RTL helpers
│   └── ui/                   # shadcn-style primitives (@eserp/ui)
├── infra/docker/             # Dockerfile.api, Dockerfile.web + README
├── docs/                     # architecture.md, erd-phase0.md, security.md
├── docker-compose.yml        # postgres, redis, minio, mailhog, api, web
└── turbo.json / pnpm-workspace.yaml / tsconfig.base.json
```

## Phase 0 scope

Foundation: monorepo + pnpm workspaces + Turborepo, auth (JWT + refresh
rotation, TOTP MFA, Google/Microsoft OAuth), tenants + RLS, RBAC with
eight system roles, audit log, settings (company profile, currencies,
exchange rates, tax rates, units of measure, numbering series,
warehouses, branches), i18n/RTL, 7-step onboarding wizard, file assets
via MinIO presigned upload, notifications, invitations, outbox events,
Saudi CoA template + seed.

## Phase 1 scope — Master Data

Migration `0003_phase1_master_data` (see
[`docs/erd-phase1.md`](docs/erd-phase1.md)):

- **Contacts** — unified customer/supplier (`CUSTOMER | SUPPLIER | BOTH`),
  legal/display name (en/ar), Saudi VAT number (15 digits), CR number,
  email, phone, address, credit limit (minor units + currency), payment
  terms, status. Tax number and email are unique per tenant when set.
- **Item categories** — hierarchical (self-referencing parent), code
  unique per tenant.
- **Items** — SKU unique per tenant, name (en/ar), category, default UoM,
  barcode (unique when set), costing method (`FIFO | WEIGHTED_AVERAGE |
  STANDARD`), standard cost / sales / purchase price in minor units,
  tax-rate link (default VAT 15%), status, track-stock flag, reorder
  point, min/max stock, optional `FileAsset` image link.
- **Price lists** — per-tenant lists (currency, validity window, one
  default) with quantity-break lines (`PriceListItem`: item, price in
  minor units, min quantity).
- **CSV import preview** — `POST /contacts/import/preview` and
  `POST /items/import/preview` validate rows with the same Zod DTOs as
  the create endpoints and report per-row errors; nothing is persisted
  (preview only, no commit endpoint yet).
- **Permissions** — new `items:*`, `item-categories:*`, `pricelists:*`
  in `ROLE_PERMISSION_MATRIX` (Owner/Admin full; Sales contacts +
  items/pricelists read; Purchasing suppliers + items manage; Warehouse
  items read; Viewer read-only).
- **Web UI** — list + detail + create/edit pages for contacts, items
  (incl. categories) and price lists under `/[locale]/contacts`,
  `/[locale]/items`, `/[locale]/pricelists` (en/ar, RTL).
- **Seed** — alsafa-trading demo data: 8 contacts (4 customers,
  3 suppliers, 1 both), 4 categories, 10 items, 1 default price list
  ("Standard Retail") with 10 lines.

Also fixed in Phase 1: Zod validation errors now return
`400 VALIDATION_ERROR` instead of 500 (global exception filter).

**Phase 2** will build on these tables (sales/purchasing/inventory) —
see `docs/erd-phase1.md` "Known limitations" for what Phase 1
deliberately does not do (no import commit, no stock enforcement, no
price-list date selection at read time).

## Phase 2 scope — Accounting

Migration `0004_phase2_accounting` (see
[`docs/erd-phase2.md`](docs/erd-phase2.md)):

- **Fiscal periods** — fiscal year + period number, start/end dates,
  status `OPEN | CLOSED | LOCKED`. Postings only into `OPEN` periods;
  `LOCKED` is terminal; no overlapping periods per tenant.
- **Journal entries + lines** — double-entry core. Numbers from the `JE`
  numbering series (`JE-{YYYY}-{SEQ:5}`), period derived from the entry
  date, status `DRAFT | POSTED | REVERSED`, source module
  (`MANUAL | SALES | PURCHASING | INVENTORY | PAYROLL | OPENING | ADJUSTMENT`).
  Validation: ≥ 2 lines, debits == credits, no mixed/zero lines, all
  accounts must be **leaf** posting accounts (the CoA has no `isPosting`
  flag — a leaf account is a posting account). `DRAFT` entries are
  editable/deletable; `POSTED` entries are immutable and corrected only
  by a reversing entry (swapped debit/credit, dated today, one reversal
  per entry). A reusable `PostingService.postBalanced()` is the entry
  point later phases will call to post balanced entries.
- **Cost centres** — code unique per tenant, name en/ar, optional
  parent hierarchy, status. Journal lines may reference one (no
  allocations in Phase 2).
- **Opening balances** — per account per fiscal year (debit/credit minor
  units), feeding the trial balance and ledger opening figures.
- **Reports** (read-only) — Trial Balance (opening / period /
  closing, grouped by account type), General Ledger (running balance
  from the opening net), VAT summary for Saudi Arabia (output vs input
  VAT, net payable; tax per line = round-half-up(line amount × rateBps
  / 10000)). All amounts in minor units.
- **Permissions** — new `journals:*`, `periods:*`, `cost-centers:*` in
  `ROLE_PERMISSION_MATRIX` (Owner/Admin full; Accountant full
  accounting; Sales/Purchasing read-only journals; Warehouse read-only
  accounting; Viewer read-only).
- **Web UI** — journals (list/create/detail, post/reverse, draft edit),
  trial balance, general ledger, fiscal periods, cost centres under
  `/[locale]/journals`, `/[locale]/trial-balance`,
  `/[locale]/general-ledger`, `/[locale]/fiscal-periods`,
  `/[locale]/cost-centers` (en/ar, RTL).
- **Seed** — alsafa-trading demo data: fiscal year 2026 (Jan–Sep
  `CLOSED`, Oct–Dec `OPEN`), cost centres `HQ` / `SALES` / `OPS`,
  balanced 2026 opening balances (215,000,000 halalas each side), 5
  posted sample entries (cash sale with 15% VAT, inventory purchase,
  salaries, rent, customer receipt) and 1 draft entry, `JE` numbering
  series at next number 7.
- **Chart of accounts read endpoint** — `GET /settings/chart-of-accounts`
  (read-only, each row marked `isPosting`) so the journal UI can offer
  leaf accounts.

## Phase 3 scope — Sales / CRM

Migration `0005_phase3_sales` (see
[`docs/erd-phase3.md`](docs/erd-phase3.md)):

- **Leads** — name/company, contact info, source (`WALK_IN | REFERRAL |
  WEBSITE | SOCIAL | OTHER`), status (`NEW | CONTACTED | QUALIFIED |
  LOST`), expected value; convert creates a customer Contact.
- **Opportunities** — customer (required), optional lead, title, stage
  (`PROSPECTING | QUALIFICATION | PROPOSAL | NEGOTIATION | WON | LOST`),
  probability 0–100%, expected value, expected close date; stage changes
  audited.
- **Quotes + lines** — `QUO` numbering series, customer, valid-from/to,
  status (`DRAFT | SENT | ACCEPTED | REJECTED | EXPIRED`). Expiry is
  computed on read (SENT + `validTo` past ⇒ EXPIRED, no scheduler).
  Accept creates a DRAFT sales order and links it.
- **Sales orders + lines** — `SO` series, status (`DRAFT | CONFIRMED |
  PARTIALLY_FULFILLED | FULFILLED | CANCELLED`); `quantityFulfilled`
  stays 0 in Phase 3 (Phase 5 drives fulfilment). Confirm is blocked
  (400) when open AR + order total exceeds the customer's credit limit
  (limit 0 = no limit set).
- **Sales invoices + lines** — `INV` series, optional order link,
  status (`DRAFT | POSTED | PARTIALLY_PAID | PAID | VOID`), VAT per line
  (round-half-up, same as Phase 2). Posting calls `postBalanced()`: Dr
  AR 1110 / Cr Sales Revenue 4010 / Cr Output VAT 2110. VOID only from
  DRAFT; POSTED invoices are corrected by a **credit note** (`type:
  CREDIT_NOTE`, negative invoice) posting the reverse entries.
- **Customer payments** — allocation-based (payment → invoice
  allocations), method (`CASH | BANK_TRANSFER | CARD | CHEQUE`); posting
  Dr Cash/Bank / Cr AR; updates invoice paid amounts/status.
- **AR aging report** — `GET /reports/ar-aging`, buckets CURRENT | 1–30 |
  31–60 | 61–90 | 90+ days past due per customer, plus a web page.
- **Permissions** — new `leads:*`, `opportunities:*`, `quotes:*`,
  `sales-orders:*`, `sales-invoices:*`, `customer-payments:*`,
  `aging:read` in `ROLE_PERMISSION_MATRIX` (Sales full on CRM/sales;
  Accountant full on invoices/payments/aging; Warehouse read on orders;
  Viewer read-only).
- **Web UI** — leads, opportunities, quotes, sales orders, sales
  invoices, customer payments, AR aging under `/[locale]/leads`,
  `/[locale]/opportunities`, `/[locale]/quotes`,
  `/[locale]/sales-orders`, `/[locale]/sales-invoices`,
  `/[locale]/customer-payments`, `/[locale]/ar-aging` (en/ar, RTL).
- **Seed** — alsafa-trading demo flow: lead → opportunity (WON) → quote
  `QUO-2026-00001` (ACCEPTED) → order `SO-2026-00001` (CONFIRMED) →
  invoice `INV-2026-00001` (PARTIALLY_PAID, 402,385 total, 200,000
  paid) + payment `PAY-2026-00001`.

## Phase 4 scope — Purchasing

Migration `0006_phase4_purchasing` (see
[`docs/erd-phase4.md`](docs/erd-phase4.md)):

- **Purchase orders + lines** — `PO` series, supplier (SUPPLIER/BOTH),
  status (`DRAFT | SENT | CONFIRMED | PARTIALLY_RECEIVED | RECEIVED |
  CLOSED | CANCELLED`); approval DRAFT→SENT→CONFIRMED. **No ledger
  posting for the PO itself** (commitment only). `quantityReceived`
  stays 0 in Phase 4 (Phase 5 goods receipt drives it).
- **Supplier invoices + lines** — `SIN` series, optional PO link, status
  (`DRAFT | POSTED | PARTIALLY_PAID | PAID | VOID`), input VAT per line.
  **3-way match on posting** (when linked to a PO): invoiced quantity
  must not exceed the PO ordered quantity, and unit-price variance over
  **5%** blocks posting (400). Posting calls `postBalanced()`: Dr
  Purchases 5100 / Dr Input VAT 2120 / Cr AP 2010.
- **Supplier payments** — same allocation pattern as customer payments:
  Dr AP 2010 / Cr Cash/Bank; updates invoice status.
- **AP aging report** — `GET /reports/ap-aging`, same buckets as AR, per
  supplier, plus a web page.
- **Permissions** — new `purchase-orders:*`, `supplier-invoices:*`,
  `supplier-payments:*` (Purchasing full on purchasing; Accountant full
  on supplier invoices/payments; Sales read on purchasing; Warehouse
  read on purchase orders; Viewer read-only).
- **Web UI** — purchase orders, supplier invoices, supplier payments, AP
  aging under `/[locale]/purchase-orders`,
  `/[locale]/supplier-invoices`, `/[locale]/supplier-payments`,
  `/[locale]/ap-aging` (en/ar, RTL).
- **Seed** — alsafa-trading demo flow: PO `PO-2026-00001` (CONFIRMED) →
  supplier invoice `SIN-2026-00001` (PARTIALLY_PAID, 161,000 total,
  100,000 paid) + payment `SPAY-2026-00001`.

## Phase 5 scope — Inventory

Migration `0007_phase5_inventory` (see
[`docs/erd-phase5.md`](docs/erd-phase5.md)):

- **Stock levels** — one row per (warehouse, item): `qtyOnHand`,
  `qtyReserved`, `qtyAvailable` (= on-hand − reserved, computed),
  `averageCostMinor`, `lastCostMinor`. Confirming a sales order
  reserves its quantities against the tenant's **default warehouse**;
  delivery/cancellation releases them.
- **Stock movements** — append-only ledger of every stock change
  (`IN | OUT | TRANSFER | ADJUSTMENT | RETURN_IN | RETURN_OUT`),
  with source document type + id, unit cost at movement time and
  reference. Corrections are new reversing movements, never edits.
- **Goods receipts** — `GRN` series, linked to a PurchaseOrder
  (required); updates `quantityReceived` and PO status
  (`PARTIALLY_RECEIVED → RECEIVED`). Posting: **Dr 1210 Inventory /
  Cr 2020 GRNI** (new CoA account "Goods Received Not Invoiced").
  Supplier invoices now relieve GRNI for the received portion
  (**Dr 2020** instead of Dr 5100 Purchases); unreceived lines still
  post Dr 5100. The seeded Phase 4 demo invoice has no receipt, so its
  posting is unchanged.
- **Delivery notes** — `DN` series, linked to a SalesOrder (required);
  updates `quantityFulfilled` and order status
  (`PARTIALLY_FULFILLED → FULFILLED`), releases the reservation.
  Posting: **Dr 5010 COGS / Cr 1210 Inventory** at the item's current
  valuation cost.
- **Valuation** — FIFO via `StockCostLayer` (oldest-first; shortfall
  falls back to average cost), WEIGHTED_AVERAGE (recomputed on each
  receipt, truncating integer division), STANDARD (item's standard
  cost). `packages/shared/src/inventory.ts` holds the pure math.
- **Adjustments, transfers, counts** — `ADJ` (reason DAMAGE | THEFT |
  FOUND | CORRECTION | OTHER; net posting Dr 1210 / Cr 4110 gain or
  Dr 5240 / Cr 1210 loss), `TRF` (OUT + IN movements at the same cost,
  no journal entry), `CNT` (counted vs system qty; variance movements
  + net journal entry on approval).
- **Low-stock report** — `GET /inventory/reports/low-stock`: items at
  or below reorder point per warehouse, plus a web page.
- **Permissions** — new `stock:*`, `goods-receipts:*`,
  `delivery-notes:*`, `adjustments:*`, `transfers:*`, `counts:*`
  (Warehouse full on inventory; Sales read on stock + delivery notes;
  Purchasing read on GRN; Accountant read on stock; Viewer read-only).
- **Web UI** — stock levels, movements, goods receipts, delivery
  notes, adjustments, transfers, counts, low-stock under
  `/[locale]/stock-levels`, `/[locale]/stock-movements`,
  `/[locale]/goods-receipts`, `/[locale]/delivery-notes`,
  `/[locale]/stock-adjustments`, `/[locale]/stock-transfers`,
  `/[locale]/stock-counts`, `/[locale]/low-stock` (en/ar, RTL).
- **Seed** — `GRN-2026-00001` receives 30 of the demo-PO rice into
  `WH-RIY-01` (PO → PARTIALLY_RECEIVED), `DN-2026-00001` delivers 20
  of the demo-SO rice (SO → PARTIALLY_FULFILLED), `ADJ-2026-00001`
  damages 2 rice; final rice level on hand 5, reserved 80, average
  cost 2,800 — the low-stock report shows it.

## Phase 6 scope — POS

Migration `0008_phase6_pos` (see
[`docs/erd-phase6.md`](docs/erd-phase6.md)):

- **POS terminals** — `POS` code unique per tenant, branch + warehouse
  (sales draw stock from the terminal's warehouse), status
  (`ACTIVE | INACTIVE`), cash account `1010` and card-clearing account
  `1030` (new CoA account "Card Payments Clearing").
- **POS shifts** — one OPEN shift per terminal; opening float ≥ 0;
  close computes expected cash/card and posts any cash variance to
  **5250 Cash Over / Short** (new CoA account; one netting account for
  over and short).
- **POS sales** — fast counter sale inside an OPEN shift: receipt
  number from the `POS` series, optional customer, lines looked up by
  SKU/barcode, payment splits CASH and/or CARD that must equal the
  total exactly. **One combined journal entry per sale**:
  Dr 1010 Cash / Dr 1030 Card Clearing / Dr 5010 COGS /
  Cr 4010 Sales Revenue / Cr 2110 Output VAT / Cr 1210 Inventory.
  Stock is issued at valuation cost (FIFO / weighted-average /
  standard). Void only in the same OPEN shift — restores stock and
  posts a reversing entry (`reversesId`).
- **Barcode/SKU lookup** — `GET /pos/lookup?terminalId=…&code=…`:
  item + default price + available stock at the terminal's warehouse
  in one query.
- **Z-report** — `GET /pos/shifts/:id/z-report`: sales count, gross,
  discounts, VAT, net, cash/card split, expected vs counted cash,
  variance; works on OPEN shifts as a live total.
- **Permissions** — new `pos:*`, `pos-terminals:*`, `pos-shifts:*`,
  `pos-sales:*`. The **SALES role doubles as the POS cashier** (open /
  close shifts, sell; terminals read-only); Accountant read on POS;
  Viewer read-only.
- **Web UI** — the counter screen at `/[locale]/pos` (terminal +
  OPEN shift, lookup input, cart, cash/card splits, receipt view with
  void), `/[locale]/pos-terminals`, `/[locale]/pos-shifts` with the
  Z-report panel (en/ar, RTL).
- **Seed** — terminal `POS-RIY-01` (Riyadh Counter 1, `BR-RIY-01` /
  `WH-RIY-01`), one CLOSED shift with two sales
  (`POS-2026-00001` cash 8,048, `POS-2026-00002` card 4,024) and one
  OPEN shift (float 50,000) ready to use.
- **Scope limit** — POS is ONLINE-first: no offline queue/sync and no
  printer/drawer/scanner drivers; the receipt is a printable HTML/JSON
  view.

## Phase 7 scope — Manufacturing

Migration `0009_phase7_manufacturing` (see
[`docs/erd-phase7.md`](docs/erd-phase7.md)):

- **Work centres** — code unique per tenant, name en/ar, standard
  hourly cost rate (minor units/hour), status `ACTIVE | INACTIVE`.
  Simple cost-rate master; no machine calendars.
- **BOMs** — finished item (must be stock-tracked), version, status
  `DRAFT | ACTIVE | ARCHIVED` with only one ACTIVE version per
  finished item; lines: component item (stock-tracked, not the
  finished item itself), quantity per finished unit, scrap % (basis
  points), optional work centre / operation reference. The standard
  cost is a **computed roll-up, never stored**: Σ component standard
  cost × qty × (1 + scrap), half-up integer math in
  `packages/shared/src/manufacturing.ts`; `GET /manufacturing/boms/:id/cost`
  returns it.
- **Work orders** — `WO` series; finished item + BOM version. **The BOM
  is snapshotted at RELEASE**: lines are copied to `WorkOrderLine`
  with `qtyRequired` incl. scrap, so later BOM edits never rewrite
  history; `materialCostPlannedMinor` = roll-up × qty planned.
  Operations record planned/actual hours — **labour cost is NOT
  posted in Phase 7** (deferred to Phase 8 payroll integration).
- **Material issues** — `MI` series; issue components from stock to a
  work order (OUT movements at valuation cost, capped at
  `qtyRequired − qtyIssued`). Posting: **Dr 1220 WIP / Cr 1210
  Inventory** (new CoA account "Work in Progress").
- **Production receipts** — `PR` series; receive finished goods into
  stock at a computed unit cost (WIP cost incurred / planned qty, or
  planned roll-up if nothing issued). Posting: **Dr 1230 Finished
  Goods Inventory / Cr 1220 WIP** (new CoA account). Over-production
  beyond planned qty is allowed with an `overProduced` warning flag.
- **Scrap** — `SCR` series; components or finished units with a
  reason. Posting: **Dr 5260 Scrap Loss / Cr 1210 Inventory**
  (components) or **Cr 1220 WIP** (finished, at WO unit cost) — new
  CoA account "Scrap Loss".
- **Complete + variance** — completing a work order returns a
  cost-variance summary (planned vs actual material cost). Remaining
  WIP stays on the order; no automatic write-off.
- **WIP report** — `GET /manufacturing/reports/wip`: per open work
  order — material issued, production received, finished scrap, WIP
  balance, completion %.
- **Permissions** — new `manufacturing:*`, `work-centers:*`, `boms:*`,
  `work-orders:*`. The **WAREHOUSE role doubles as the shop-floor /
  production role** (manage work centres, work orders, issues,
  receipts, scrap; read BOMs); Accountant read on manufacturing;
  Viewer read-only.
- **Web UI** — work centres, BOMs (with roll-up cost), work orders
  (+ release / complete / cancel, detail panel), material issues,
  production receipts, scrap, WIP report under
  `/[locale]/work-centers`, `/[locale]/boms`,
  `/[locale]/work-orders`, `/[locale]/material-issues`,
  `/[locale]/production-receipts`, `/[locale]/scrap`,
  `/[locale]/wip-report` (en/ar, RTL).
- **Seed** — BOM v1 for the `GIFT-DATES-BOX` dates gift box (roll-up
  16,050), `WO-2026-00001` IN_PROGRESS (10 planned, 6 produced,
  1 scrapped), `MI-2026-00001` POSTED 160,500,
  `PR-2026-00001` POSTED 6 @ 16,050, `SCR-2026-00001` POSTED
  1 finished @ 16,050; WIP balance 48,150, completion 60%.

## Phase 8 scope — HR / Payroll

Migration `0010_phase8_hr_payroll` (see
[`docs/erd-phase8.md`](docs/erd-phase8.md)):

- **Departments** — code unique per tenant, name en/ar, parent
  hierarchy, optional manager (employee link), status.
- **Employees** — code unique per tenant, name en/ar, National ID /
  Iqama number (**stored as a plain string in Phase 8 — field
  encryption is Phase 11 hardening**), job title, department, branch,
  hire date, status `ACTIVE | ON_LEAVE | TERMINATED`, basic salary +
  housing / transport / other allowances (minor units/month), bank +
  IBAN, GOSI number, nationality `SAUDI | NON_SAUDI` (drives GOSI
  rates), dependents count, optional link to a login user.
  Termination sets status + end date; terminated employees stay
  readable for history.
- **Leave** — leave types (code, days per year, paid flag); leave
  requests with days **computed as working days only (Fri–Sat weekend
  excluded)**; approval enforces the entitlement and rejects overlaps.
  Leave balances are computed on read:
  entitlement − approved days taken per employee per year.
- **Attendance** — one record per employee per day (`PRESENT | ABSENT
  | LATE | ON_LEAVE | HOLIDAY`), bulk entry for one day / many
  employees, monthly summary per employee. No biometric/hardware
  integration.
- **Payroll runs** — one run per period (month/year), status
  `DRAFT | CALCULATED | APPROVED | PAID`; one line per ACTIVE +
  ON_LEAVE employee (paid leave still pays). Calculation is
  deterministic from the employee master + attendance: absent days
  deduct pro-rata basic; GOSI and EOSB are computed on the full wage
  (see below); other deductions are capped so net never goes negative.
  APPROVED locks the run. PAID posts two journal entries in one
  action: the accrual (**Dr 5210 Salaries / Dr 5211 GOSI Employer /
  Dr 5212 EOSB / Cr 2210 GOSI Payable / Cr 2220 Net Salaries Payable /
  Cr 2230 EOS Provision / Cr 2240 Other Deductions Payable**) and the
  bank payment (**Dr 2220 / Cr bank**, default 1020) — new CoA accounts
  2210, 2220, 2230, 2240, 5211, 5212.
- **GOSI (verified 2026-11-24 — existing scheme for employees first
  registered before 3 July 2024):** contribution wage = basic + housing,
  capped at **SAR 45,000/month**; Saudi employee **9.75%** (9% pension
  + 0.75% SANED), employer **11.75%** (9% + 0.75% + 2% hazards);
  non-Saudi **2% employer hazards only**, no employee deduction. The
  new-law step-up rates (from 1 July 2026) are out of scope.
- **EOSB (Saudi Labour Law art. 84):** half a month's wage per year
  for the first 5 years, one month per year thereafter; monthly wage =
  basic + all allowances; accrued monthly in payroll and posted to the
  EOS provision (Dr 5212 / Cr 2230).
- **Permissions** — new `employees:*`, `departments:*`, `leave:*`,
  `attendance:*`, `payroll:*`, `payroll:approve`. **HR calculates the
  run (`payroll:manage`); the Accountant approves and pays it
  (`payroll:approve`)** — payroll posting is an accounting action.
  Viewer read-only.
- **Web UI** — departments, employees (+ terminate), leave (types,
  requests, balances), attendance (bulk entry + monthly summary),
  payroll runs (+ calculate / approve / pay, line detail) under
  `/[locale]/departments`, `/[locale]/employees`, `/[locale]/leave`,
  `/[locale]/attendance`, `/[locale]/payroll-runs` (en/ar, RTL).
- **Seed** — departments ADM + OPS, 4 employees (3 Saudi, 1
  non-Saudi, incl. the HR user), leave types + one approved leave,
  full November 2026 attendance (88 records), one CALCULATED payroll
  run for November 2026 (gross 42,722.73, net 39,188.35, GOSI employer
  4,369.38, EOSB 2,300.00 SAR — not yet paid).

## Phase 9 scope — Projects

Migration `0011_phase9_projects` (see
[`docs/erd-phase9.md`](docs/erd-phase9.md)):

- **Projects** — code unique per tenant, name en/ar, customer
  (Contact, optional), manager (User), status `PLANNING | ACTIVE |
  ON_HOLD | COMPLETED | CANCELLED`, start/due dates, budget (minor
  units + currency), billing type `FIXED_PRICE | TIME_AND_MATERIALS |
  MILESTONE`, description. Status transitions are audited;
  `COMPLETED`/`CANCELLED` are terminal and `COMPLETED` locks
  time/expense entry.
- **Project tasks** — project, title, assignee (**Employee** — the
  assignee carries the salary the costing formula needs), status
  `TODO | IN_PROGRESS | DONE | BLOCKED`, due date, estimated hours,
  actual hours **computed from approved timesheets on the task, never
  stored**, priority `LOW | MEDIUM | HIGH`, optional
  `hourlyRateMinor` override.
- **Timesheets** — employee, project, task (optional), date, hours
  (**decimal hours in the DTO, stored as integer minutes**), billable
  flag, description, status `DRAFT | SUBMITTED | APPROVED |
  REJECTED`. Approval locks the entry. One entry per employee +
  project + task + date (unique constraint + service-level duplicate
  check); multiple entries the same day only for different tasks.
- **Project expenses** — project, date, category `TRAVEL | MATERIALS
  | SERVICES | OTHER`, amount (minor units + currency), description,
  receipt link (FileAsset id as plain string), status `DRAFT |
  APPROVED | REJECTED`, submittedBy.
- **Milestones** — project, title, due date, amount (minor units),
  status `PENDING | ACHIEVED | INVOICED`, invoice link. Achieving a
  milestone on a `MILESTONE`-billed project creates a **DRAFT sales
  invoice** via the Phase 3 invoice service (no duplicated invoice
  logic); on `FIXED_PRICE`/`TIME_AND_MATERIALS` projects milestones
  are tracking-only. Milestone invoice amounts are net / VAT-exempt
  (tax 0) in Phase 9.
- **Project costing** — `GET /projects/:id/costing`: budget vs actual
  (timesheet cost + expenses + materials), profitability, burn rate.
  **Hourly cost rate = employee basic salary ÷ 160 hours/month**
  (half-up), unless a task `hourlyRateMinor` override is set; cost is
  rounded half-up **per timesheet entry** and only `APPROVED`
  timesheets count. **Revenue recognised** = invoiced amounts linked
  by `projectId` with status `POSTED | PARTIALLY_PAID | PAID` (draft
  invoices not recognised). Materials = 0 in Phase 9 (no stock
  linkage yet). Sales invoices gained an optional `projectId` link.
- **Permissions** — new `projects:*`, `project-tasks:*`,
  `timesheets:*`, `project-expenses:*`, `milestones:*`. Owner/Admin
  full; Accountant read on projects/tasks/timesheets/expenses/
  milestones; Sales read on projects/tasks/milestones; HR read on
  timesheets; Viewer read-only.
- **Web UI** — projects (+ costing panel), tasks, timesheets
  (submit/approve/reject), expenses, milestones (+ achieve) under
  `/[locale]/projects`, `/[locale]/project-tasks`,
  `/[locale]/timesheets`, `/[locale]/project-expenses`,
  `/[locale]/milestones` (en/ar, RTL).
- **Seed** — demo project `PRJ-001` "Riyadh Trade Show Booth —
  Store Fit-Out" (customer Al-Noor Retail, `ACTIVE`, `MILESTONE`,
  budget SAR 20,000) with 2 tasks, 3 approved timesheets (labour
  SAR 1,200), 1 approved `MATERIALS` expense (SAR 1,500), milestone
  "Booth design approved" SAR 5,000 → `INVOICED` with DRAFT invoice
  `INV-2026-00002`; costing actual SAR 2,700, revenue 0 until the
  draft invoice posts.

## Phase 10 scope — Analytics / AI

Migration `0012_phase10_analytics` (see
[`docs/erd-phase10.md`](docs/erd-phase10.md)) — the only new table
is `ReportSnapshot`:

- **KPI dashboard** — `GET /analytics/dashboard`: revenue (current +
  previous month + trend), gross profit + margin, open/overdue AR/AP,
  stock value, sales by month (last 12 months), top 5 customers/items
  by revenue, low-stock count, open POs value, payroll cost current
  month. All computed from real data only — no mocked numbers.
  Read-only, cached in Redis for **60s per tenant** (best-effort; a
  down Redis never fails the request). No background scheduler.
- **Financial statements** — `GET /analytics/profit-loss` (by fiscal
  period or date range; **COGS = CoA account 5010 only**, operating
  expenses = all other `EXPENSE` accounts), `GET
  /analytics/balance-sheet` (assets = liabilities + equity at a date;
  equity includes YTD net income; `balanced`/`differenceMinor`
  reported), `GET /analytics/cash-flow` (simple indirect presentation
  from bank/cash movements: cash = 1010+1020+1030; investing = change
  in fixed assets `14xx`; financing = change in equity excl. net
  income + loans `23xx`/`24xx`). Derived from posted journal lines
  grouped by CoA account type; the Phase 2 trial balance is reused,
  not rebuilt.
- **Exports & snapshots** — `GET /analytics/exports/:report` (CSV for
  P&L, balance sheet, cash flow, AR/AP aging, stock valuation, sales
  by item/customer); `ReportSnapshot` (type, parameters JSON, format
  `CSV|JSON`, content inline JSON, generatedBy, generatedAt) —
  `POST /analytics/report-snapshots` saves a generated report for
  later re-download (`GET
  /analytics/report-snapshots/:id/download`).
- **AI insights** — `GET /ai/insights` and `POST /ai/ask` in
  `apps/api/src/modules/ai/`. **There was no Phase 0 AI interface** —
  Phase 10 introduces the provider seam `AiProvider` with
  `summarize(prompt, data)` (`packages/shared/src/ai.ts`). The only
  shipped adapter is `RuleBasedProvider` (`"rule-based"`):
  deterministic, offline, never fabricates — it echoes insights
  computed from real aggregates (overdue invoices, low stock, margin
  change, payroll share of revenue, working capital, open POs).
  **No LLM key is required for anything**; `AI_PROVIDER` set to
  anything else logs a warning and falls back to `rule-based`. Every
  response is labelled with its source. `POST /ai/ask` answers only
  from computed aggregates via a small en/ar intent matcher (revenue,
  gross profit, AR/AP, stock, payroll, top customers/items, sales by
  month); anything else gets a clear "I can only answer questions
  about …" response — never a hallucinated number.
- **Permissions** — new `analytics:read`, `reports:read`,
  `reports:manage`, `ai:read`, `ai:ask`. Owner/Admin full; Accountant
  full on reports/analytics + AI; Sales read on analytics + AI;
  Purchasing/Warehouse read on analytics + `ai:read`; HR read on
  analytics + `ai:read`; Viewer read-only.
- **Web UI** — analytics dashboard (KPI cards + CSS bar chart for
  sales by month + top customers/items), P&L / balance sheet / cash
  flow pages, report snapshots (+ CSV download), AI insights panel
  under `/[locale]/analytics-dashboard`, `/[locale]/profit-loss`,
  `/[locale]/balance-sheet`, `/[locale]/cash-flow`,
  `/[locale]/report-snapshots`, `/[locale]/ai-insights` (en/ar, RTL).
- **Seed** — one `ReportSnapshot` (`PROFIT_LOSS`, November 2026) for
  the demo tenant, content computed in-seed from real posted journal
  lines (net income −5,565,653 minor).

## Known limitations

- **OAuth needs real client IDs.** Google/Microsoft login is disabled
  unless `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` (and secrets) are
  set in `.env`.
- **E-invoicing (ZATCA) is Phase 11**, not Phase 0.
- **Phase 2 accounting limits:** single-currency journal entries only;
  no fiscal-year close / profit roll-forward; no bulk journal import or
  recurring entries (see [`docs/erd-phase2.md`](docs/erd-phase2.md)).
  AR/AP subledgers arrived with Phases 3–4 (sales/purchase invoices and
  payments).
- **Manufacturing** is a later phase.
- **Integration tests need a running Postgres** (see Tests above).
- The demo seed password (`Demo1234!`) is for local development only.

## Phase 11 scope — Integrations

Migration `0013_phase11_integrations` (see
[`docs/erd-phase11.md`](docs/erd-phase11.md)):

- **ZATCA e-invoicing (Saudi Fatoora)** — `ZatcaDocument` linked to a
  posted sales invoice: standards-shaped UBL 2.1 XML + TLV QR
  (seller/VAT/timestamp/totals) + SHA-256 hash + previous-hash chain.
  `SimulationClient` is the default (validates XML + hash locally,
  marks `REPORTED_SIMULATED` / `CLEARED_SIMULATED`); `SandboxClient`
  maps ZATCA's published compliance/clearance/reporting API and
  degrades to simulation when no credentials are configured.
  Production clearance needs real ZATCA onboarding (OTP + CCSID +
  production certificate) which only the tenant can complete.
- **Outbound webhooks** — `WebhookEndpoint` (URL, secret, subscribed
  event types, ACTIVE/DISABLED) + `WebhookDelivery` (attempts, last
  response, next retry). The outbox drain worker fans events out to
  subscribed endpoints; delivery is via BullMQ (5 attempts,
  exponential backoff) with HMAC-SHA256 (`X-EsERP-Signature`).
  A test-delivery endpoint sends a `ping` event.
- **API keys** — `ApiKey` stores only the SHA-256 hash + last-4
  prefix; the plaintext is returned once at creation. `X-API-Key`
  auth resolves the tenant + scopes and enforces the same RBAC as
  JWT. Rate limit per key (300/min default).
- **Export centre** — CSV/JSON downloads for contacts, items, sales
  invoices, purchase orders, journal entries, stock levels,
  employees, plus `ExportJob` records (direct downloads in Phase 11;
  no stored files yet).
- **Provider interfaces + mocks** — `PaymentGateway` /
  `SmsProvider` with `MockPaymentProvider` / `MockSmsProvider`
  (labelled simulated; no live charge/SMS). Real Saudi gateways
  (Moyasar/HyperPay) and SMS are documented env-var config.
- **Field encryption (Phase 8 hardening)** — AES-256-GCM at rest for
  Employee national ID/Iqama + IBAN (`ENCRYPTION_KEY`, 64 hex chars).
  API responses return masked values (`****1234`) unless the caller
  has `hr:read-sensitive`. A migration script encrypts existing
  plaintext values in place.
- **Rate limiting** — closes the Phase 0 gap: per-tenant + per-IP
  (600/min default) and per-API-key (300/min), 429 with `Retry-After`.
  Per-process in-memory store (see `docs/erd-phase11.md`).
- **Permissions** — new `zatca:*`, `webhooks:*`, `api-keys:*`,
  `exports:*`, `hr:read-sensitive` (Owner/Admin full; Accountant full
  on ZATCA/exports; Viewer read-only; API-key management
  Owner/Admin only).
- **Web UI** — ZATCA documents, webhooks, API keys, export centre,
  provider settings under `/[locale]/zatca-documents`,
  `/[locale]/webhooks`, `/[locale]/api-keys`, `/[locale]/exports`,
  `/[locale]/providers` (en/ar, RTL).
- **Windows setup** — `setup-windows.ps1` (one-command setup),
  `setup-windows.bat` (double-click wrapper), `.gitattributes`
  (CRLF for `*.ps1`/`*.bat`, LF for `*.sh`).
- **Seed** — one DISABLED demo webhook endpoint + one REVOKED demo
  API key (deliberately inert so the pages are not empty); demo
  employees' national ID / IBAN encrypted when `ENCRYPTION_KEY` is
  set at seed time.

## Project status — all 12 phases complete

EsERP is **complete and handed over** (verified 2026-11-24 in the
Linux VM — see [`docs/handover.md`](docs/handover.md) for the full
verification table and the "NOT verified in this VM" list).

| | |
| --- | --- |
| Phases | 0–11 (Foundation → Integrations) |
| Migrations | 13 (`0001_init` … `0013_phase11_integrations`) |
| Tables | 96 models in `packages/db/prisma/schema.prisma` |
| Unit + integration tests | **182 passed** (shared 106, i18n 3, UI 16, db 2, web 14, API 41) — none skipped |
| API e2e tests | **13/13 passed** (incl. the Phase 11 flow) |
| Lint / typecheck / build | All green |
| Live smoke test | Built API + built web: health, demo login, dashboard KPIs, ZATCA list, CSV export, provider status, all 5 new web pages (200) |

How to run: see "Run on Windows" above (or `docs/handover.md`).
Known limitations and what was **not** verified in this VM (Docker
Compose end-to-end, GitHub CI, PowerShell execution, real ZATCA
production clearance, real payment/SMS providers) are listed in
[`docs/handover.md`](docs/handover.md).
