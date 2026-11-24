# @eserp/db — Prisma schema, RLS & seed

## Schema

PostgreSQL 16 via Prisma 6. Conventions (enforced across the monorepo):

- Every table: `id String @id @default(uuid(7))`, `createdAt`, `updatedAt`, `createdBy String?`.
- Every tenant-scoped table carries `tenantId String` + `@@index([tenantId])`.
  The only exceptions are `Tenant` itself (the tenant registry) and
  `Permission` (a global, seeded catalog — `RolePermission` carries the tenantId).
- Money and quantities are integer minor units (`BigInt` in Prisma) plus a
  currency code — never floats.
- Unique constraints where sensible: `User(email, tenantId)`, `Role(name, tenantId)`,
  `Currency(code, tenantId)`, `NumberingSeries(code, tenantId)`,
  `ChartOfAccounts(code, tenantId)`, `Tenant(slug)`.

Models: `Tenant`, `User`, `Role`, `Permission`, `RolePermission`, `UserRole`,
`RefreshToken`, `MfaSecret`, `AuditLog`, `CompanyProfile`, `Currency`,
`ExchangeRate`, `TaxRate`, `UnitOfMeasure`, `UomConversion`,
`NumberingSeries`, `Warehouse`, `Branch`, `ChartOfAccounts`, `Notification`,
`Invitation`, `OnboardingState`, `FileAsset`, `OutboxEvent`.

## Row-Level Security (RLS)

`prisma/rls.sql` (applied by migration `0002_rls`) enables RLS — with
`FORCE ROW LEVEL SECURITY` so it applies even to the table owner — on every
tenant-scoped table, with one policy per table:

```sql
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
```

The API sets `app.tenant_id` from the JWT `tenantId` claim via
`withTenant(tenantId, fn)` in `src/index.ts`, which runs the callback inside
a transaction and issues `SET LOCAL app.tenant_id = '<tenantId>'`. `SET LOCAL`
lives only for that transaction, so the tenant can never leak across pooled
connections. RLS is the backstop: even a query that forgets the tenant filter
cannot return another tenant's rows, and with no tenant set nothing is visible.

One narrow escape exists in the policy: `OR current_setting('app.bootstrap',
true) = 'eserp-login'`. It is set only by server code (`withBootstrap` in
`src/index.ts`) inside a transaction, for the pre-authentication lookups that
cannot yet know a tenant (login by email, OAuth linking) and the outbox drain
worker. It is never derived from user input and never set on a
request-scoped transaction.

## Migrations

Migrations are hand-written SQL mirroring `prisma/schema.prisma`
(`0001_init` = full DDL, `0002_rls` = `rls.sql`). After `pnpm install`,
verify them against a live database:

```bash
pnpm --filter @eserp/db generate
pnpm --filter @eserp/db migrate:dev   # or migrate:deploy in CI/prod
```

## Seed

```bash
pnpm --filter @eserp/db seed
```

Creates (idempotently — all writes are upserts on unique keys) the Saudi demo
tenant `alsafa-trading` — شركة الصفاء للتجارة / Al-Safa Trading Co., SAR,
locale `ar`, fiscal year from January, Gregorian calendar — with:

- Saudi chart of accounts (`prisma/data/saudi-coa.json`, 34 accounts, codes 1000–5999)
- VAT 15% standard, 0% zero-rated, exempt; currencies SAR/USD/EUR/AED with rates to SAR
- UoM piece/kg/box/carton/litre/gram + conversions (1 carton = 12 piece, 1 box = 24 piece, 1 kg = 1000 g)
- Warehouse + branch "المستودع الرئيسي - الرياض" / "الفرع الرئيسي - الرياض"
- Roles with the full permission matrix, and one user per role
  (`admin@`, `accountant@`, `sales@`, `purchasing@`, `warehouse@`, `hr@`,
  `viewer@alsafa-trading.sa`, password `Demo1234!` — demo only, argon2 hashed)

## Tests

`src/rls.test.ts` is an integration test: it creates two tenants, sets
`app.tenant_id` to tenant A and asserts only A's rows are visible (and none
with no tenant set). It is skipped with a clear console message when
`DATABASE_URL` is unset or the database is unreachable.
