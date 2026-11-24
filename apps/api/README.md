# @eserp/api — NestJS API (Phase 0)

NestJS 11, global prefix `api/v1`, port `3001` (`API_PORT`). Structured JSON
logging (pino), OpenTelemetry stub (`src/config/otel.ts` — no-op tracer while
`OTEL_ENABLED=false`), OpenAPI at `/api/docs`, global exception filter that
returns every error as `{ error: { code, message } }`.

## Run

```bash
cp .env.example .env        # at repo root; never commit a real .env
pnpm install                # parent installs once at the end of Phase 0
pnpm --filter @eserp/db generate && pnpm --filter @eserp/db migrate:deploy
pnpm --filter @eserp/api dev
```

Scripts: `dev` (watch), `build`, `start`, `lint`, `typecheck`, `test`
(vitest unit), `test:e2e` (supertest; skipped without `DATABASE_URL`).

## Auth & tenancy

- `POST /auth/register` — creates Tenant + CompanyProfile + OWNER user +
  default roles/permissions + OnboardingState (step 0); returns tokens.
- `POST /auth/login` — argon2 verify; if MFA is on returns
  `{ mfaRequired: true, mfaToken }`, then `POST /auth/mfa/verify`.
- `POST /auth/refresh` — refresh-token rotation: the stored refresh token is
  an argon2 hash of the JWT `jti`; the old row is revoked (`revokedAt`) before
  a new pair is issued. `POST /auth/logout` revokes it.
- `GET /auth/me`, `POST /auth/mfa/setup` (TOTP secret + otpauth URL + QR data
  URL; the secret is stored only after `POST /auth/mfa/setup/verify`),
  `POST /auth/mfa/disable`. Access JWT 15 min, refresh 30 days.
- OAuth: `GET /auth/oauth/google|microsoft` redirects to the provider when
  `GOOGLE_/MICROSOFT_CLIENT_ID` are configured, else
  `501 { error: { code: "OAUTH_NOT_CONFIGURED" } }`;
  `GET /auth/oauth/callback/google|microsoft` exchanges the code via the
  passport strategies (`src/modules/auth/oauth.strategy.ts`). OAuth never
  creates a tenant — it links to an existing account by email.
- `TenantGuard` (global): tenant comes from the JWT `tenantId` claim.
  `X-Tenant-Id` is honoured only on explicitly marked bootstrap routes, and
  a header that disagrees with the JWT is rejected (403). All tenant reads
  run through `PrismaService.withTenant()` (`SET LOCAL app.tenant_id`), and
  Postgres RLS is the backstop (see `packages/db`).

## RBAC

`@Permissions('settings:manage')` + global `PermissionsGuard` (loads the
caller's roles → permissions from the DB per request). Matrix (seeded):
OWNER = all; ADMIN = all except `tenants:delete`; ACCOUNTANT =
`accounting:*`, `audit:read`, `settings:read`, `files:*`; SALES = `sales:*`,
`contacts:*`, `inventory:read`; PURCHASING = `purchasing:*`, `inventory:read`,
`contacts:*`; WAREHOUSE = `inventory:*`, `warehouses:manage`; HR = `hr:*`,
`users:read`; VIEWER = `*:read`. Roles CRUD + `PATCH /roles/:id/permissions`.

## Endpoints

| Area | Endpoints |
|---|---|
| Health | `GET /api/v1/health` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/mfa/verify`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/mfa/setup`, `POST /auth/mfa/setup/verify`, `POST /auth/mfa/disable`, `GET /auth/oauth/{google,microsoft}`, `GET /auth/oauth/callback/{google,microsoft}` |
| Tenants | `GET /tenants/me`, `PATCH /tenants/me` |
| Users | `GET /users`, `POST /users/invite`, `PATCH /users/:id` |
| Roles | `GET /roles`, `GET /roles/permissions`, `POST /roles`, `PATCH /roles/:id/permissions` |
| Settings | `GET/PATCH /settings/company`; `GET/POST/DELETE /settings/currencies` (default currency cannot be deleted); `GET/POST/PATCH/DELETE /settings/taxes`; `GET/POST /settings/units`, `POST /settings/units/conversions`; `GET/POST/PATCH /settings/numbering-series`; `GET/POST/PATCH/DELETE /settings/warehouses`; `GET/POST/PATCH /settings/branches` |
| Audit | `GET /audit-logs?page&entityType&action&actorId&from&to` (append-only, no write endpoints) |
| Onboarding | `GET /onboarding`, `POST /onboarding/step`, `POST /onboarding/import/preview`, `POST /onboarding/complete` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read` |
| Files | `POST /files/presigned-url`, `GET /files/:id` (S3 presigned URLs) |

## curl examples

```bash
BASE=http://localhost:3001/api/v1
curl $BASE/health
# register
curl -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d '{"tenantName":"Acme Trading","email":"owner@acme.sa","password":"Demo1234!"}'
# login (save the access token)
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@acme.sa","password":"Demo1234!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["tokens"]["accessToken"])')
curl $BASE/auth/me -H "Authorization: Bearer $TOKEN"
curl $BASE/settings/currencies -H "Authorization: Bearer $TOKEN"
curl -X POST $BASE/settings/currencies -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"code":"USD","name":"US Dollar"}'
curl "$BASE/audit-logs?entityType=Currency" -H "Authorization: Bearer $TOKEN"
```

## Background work

BullMQ queues `email` and `exports` (Redis) + an `outbox` drain worker that
runs every 60 s: it marks unpublished `OutboxEvent` rows published and logs
them. Webhook delivery is Phase 11 — the worker deliberately makes no
external calls. Mail goes through `MailService` (nodemailer SMTP; MailHog
locally). Files use S3 presigned URLs (MinIO locally).

## Tests

- Unit (`src/**/*.spec.ts`): AuthService (argon2, refresh rotation revokes the
  old token, TOTP setup/verify), PermissionsGuard (allow/deny/OWNER),
  NumberingSeriesService (`INV-2026-00001`, increments, per-tenant counters).
- E2E (`test/app.e2e-spec.ts`, supertest): register → login → me →
  onboarding step → create currency → audit log; tenant isolation
  (spoofed `X-Tenant-Id` → 403, unauthenticated → 401). Skipped without
  `DATABASE_URL`.
