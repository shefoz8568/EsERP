# EsERP Phase 0 — Security notes

This is the security posture shipped in Phase 0 (Foundation). It is a
starting point, not a certification: review it again before any
production deployment with real customer data.

## Authentication

- **Password hashing — argon2.** Passwords are hashed with argon2
  (`argon2` package in `@eserp/db`; the seed hashes the demo password
  `Demo1234!` the same way). Never store or log a plaintext password.
  Password rules (enforced in `@eserp/shared` `passwordSchema`): 8–128
  characters, at least one upper-case, one lower-case, one digit.
- **JWT + refresh-token rotation.** Short-lived access tokens
  (`JWT_ACCESS_TTL_SECONDS`, default 900s) and long-lived refresh
  tokens (`JWT_REFRESH_TTL_SECONDS`, default 30 days). Refresh tokens
  are stored **hashed** (`RefreshToken.tokenHash` — an argon2 hash of
  the token's jti) with `expiresAt` / `revokedAt`; each use rotates the
  token (old token revoked, new token issued). A stolen refresh token is
  therefore usable at most once before rotation invalidates it, and
  reuse of an already-rotated token is rejected. (Family-wide
  revocation on detected reuse is not implemented — a reuse currently
  just fails the request; adding it is a recommended hardening step.)
- **TOTP MFA.** `MfaSecret` holds one TOTP secret per user
  (`userId` unique). MFA is opt-in per user (`User.mfaEnabled`); the
  login flow returns an `mfaToken` and requires a 6-digit code
  (`mfaVerifyDto` in `@eserp/shared`). Secrets must be encrypted at
  rest (see "Secrets" below — the column stores the secret, the API
  layer is responsible for envelope encryption before going to
  production with real users).
- **OAuth (Google / Microsoft).** Optional; disabled when the client
  IDs are empty. `User.oauthProvider` / `oauthSubject` link an OAuth
  identity; OAuth users have a `NULL` `passwordHash`. OAuth needs real
  client IDs and secrets — see "Known limitations" in the root README.
- **Invitations.** `Invitation.tokenHash` stores a hash of the invite
  token (never the raw token), with `expiresAt` and `acceptedAt`.
  Expired or already-accepted invites cannot be reused.

## Authorization — defense in depth

Tenant isolation and permission checks are enforced at **three
independent layers** (see `docs/architecture.md`):

1. **API guards** — JWT auth guard, then an RBAC/ABAC guard that
   checks the caller's roles/permissions (`module:action` strings from
   `@eserp/shared`) and, where relevant, resource attributes
   (e.g. branch/warehouse scope) before any data access.
2. **Tenant context** — every request runs inside
   `@eserp/db` `withTenant(tenantId, …)`, which sets
   `SET LOCAL app.tenant_id` for that transaction and scopes Prisma
   queries with `tenantId` filters.
3. **Postgres RLS (backstop)** — `FORCE ROW LEVEL SECURITY` plus the
   `tenant_isolation` policy on all 32 tenant-scoped tables. Even the
   table owner cannot read another tenant's rows, and even a bug that
   drops the `tenantId` filter in layer 2 cannot leak data.

Additional rules:

- `Tenant` (registry) and `Permission` (global catalog) are the only
  tables without RLS, by design.
- System roles (OWNER, ADMIN, ACCOUNTANT, SALES, PURCHASING,
  WAREHOUSE, HR, VIEWER) are seeded from `ROLE_PERMISSION_MATRIX`;
  ADMIN has every permission except `tenants:delete`.
- Never trust a `tenantId` (or any identifier) supplied in a request
  body or query string — the tenant always comes from the verified JWT
  claim.

## Audit log — immutability

- Every mutation writes an `AuditLog` row: `tenantId`, `actorId`,
  `action`, `entityType`, `entityId`, `before`/`after` JSON snapshots,
  `ipAddress`, `userAgent`, `createdAt`.
- **Audit rows are append-only.** The API exposes no update or delete
  path for `AuditLog`, and application code must never mutate them.
  (Database-level enforcement — e.g. a trigger rejecting UPDATE/DELETE
  or a separate audit role — is a recommended hardening step before
  production; it is not yet in the Phase 0 migrations.)
- Audit reads are themselves tenant-scoped (RLS) and permission-gated
  (`audit:read`).

## Secrets and configuration

- **No secrets in the repo.** `.env` is gitignored; only `.env.example`
  (placeholder values) is committed. JWT secrets, database passwords,
  S3 keys and OAuth secrets come from environment variables only.
- Rotate `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` by deploying new
  values — all existing sessions are invalidated (by design).
- The demo seed password (`Demo1234!`) is for local development only.
  Never seed it, and never use it, in any shared or production
  environment.
- `MfaSecret.secret` and `Invitation.tokenHash` / `RefreshToken.tokenHash`
  are sensitive values: encrypt secrets at rest and never log tokens,
  hashes, or authorization headers.
- S3/MinIO credentials are server-side only; browsers receive
  short-lived presigned URLs (`presignedUrlDto`, max 100 MB).

## Rate limiting

- **Status (Phase 11): implemented.** The Phase 0 gap is closed by
  the global `RateLimitGuard` (`apps/api/src/common/rate-limit/`):
  per-tenant + per-IP budget (default 600/min,
  `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS`) and a separate
  per-API-key budget (default 300/min,
  `API_KEY_RATE_LIMIT_MAX` / `API_KEY_RATE_LIMIT_WINDOW_SECONDS`).
  Exceeding the limit returns 429 `RATE_LIMITED` with a `Retry-After`
  header. The store is in-memory per process — with multiple API
  replicas a tenant could exceed the limit by up to N×; the
  production hardening is a Redis-backed store (Redis is already in
  the stack for BullMQ). See `docs/erd-phase11.md` ("Rate limiting").
- **History (Phase 0):** a search of `apps/api/src` at the time this
  document was written found no throttler, rate-limit guard, or
  rate-limit middleware anywhere in the API — login, registration,
  MFA verify and invitation acceptance were unthrottled. That was a
  known gap to close before any shared or production deployment, and
  Phase 11 closed it (the public-route bucket now bounds those
  endpoints per IP as well).

## Transport and headers

- Local development is plain HTTP; production must terminate TLS at the
  edge (the API never serves HTTP publicly).
- The API should set standard hardening headers (HSTS, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY` or `frame-ancestors`, a restrictive
  CSP for the web app) — verify in `apps/api` / `apps/web` before
  production; they are not part of the Phase 0 data model.

## What Phase 0 does NOT yet cover

- Database-level audit immutability (trigger / separate role) — planned
  hardening, see above.
- Per-field encryption beyond the hashing noted above (e.g. at-rest
  encryption of `MfaSecret.secret`). Employee national ID / IBAN
  encryption landed in Phase 11 (AES-256-GCM, see
  `docs/erd-phase11.md`); `MfaSecret.secret` is still unencrypted at
  rest.
- Rate limiting is implemented (Phase 11, see above).
- ZATCA e-invoicing cryptography landed in Phase 11 (simulation
  default + sandbox client; production clearance needs tenant
  onboarding — see `docs/erd-phase11.md`).
- A production secrets manager — env vars are the Phase 0 mechanism.
