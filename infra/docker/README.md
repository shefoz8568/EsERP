# Docker images

Both images are built from the **repository root** (the build context is
`.`, so workspace files resolve). `docker-compose.yml` already references
them; you can also build them by hand.

```bash
docker build -f infra/docker/Dockerfile.api -t eserp-api .
docker build -f infra/docker/Dockerfile.web -t eserp-web .
```

## Dockerfile.api — NestJS API (port 3001)

| Stage | Base | What it does |
| --- | --- | --- |
| `build` | `node:20-alpine` | Enables pnpm 9 via Corepack, copies the workspace manifests first (cache layer), runs `pnpm install --frozen-lockfile`, copies the `packages/db`, `packages/shared`, `packages/i18n` and `apps/api` sources, runs `prisma generate`, then builds `@eserp/api` (assumed to emit `apps/api/dist/main.js`). |
| `runtime` | `node:20-alpine` | Runs as the non-root `node` user, with `WORKDIR /app/apps/api`. Copies the whole workspace layout (`apps/`, `packages/`, `node_modules/`) from the build stage — not a pruned `pnpm deploy` — because `@eserp/db` resolves to workspace sources and the generated Prisma client lives in `node_modules/.prisma`; pruning risks dropping either. Runs `node dist/main.js`, exposes **3001**, and health-checks `GET /api/v1/health` with `wget`. |

## Dockerfile.web — Next.js web app (port 3000)

| Stage | Base | What it does |
| --- | --- | --- |
| `deps` | `node:20-alpine` | Installs the whole workspace's dependencies (cached until a manifest changes). |
| `build` | `node:20-alpine` | Copies the workspace sources and runs `pnpm --filter @eserp/web build` (Next.js 15 App Router). `NEXT_PUBLIC_API_URL` is a **build arg** (default `http://localhost:3001/api/v1`) because Next.js bakes public env vars into the browser bundle at build time — pass `--build-arg NEXT_PUBLIC_API_URL=…` when the API lives elsewhere. |
| `runtime` | `node:20-alpine` | Runs as the non-root `node` user, with `WORKDIR /app/apps/web`. Copies the whole workspace layout (`apps/`, `packages/`, `node_modules/`) from the build stage — pnpm keeps per-package `node_modules` symlinks, so copying only the root `node_modules` would break module resolution. Runs `pnpm start` (`next start -p 3000`), exposes **3000**, and health-checks `GET /`. |

### Standalone-output assumption

`apps/web/next.config.mjs` does **not** set `output: 'standalone'`, so the
web Dockerfile uses a standard `next build` + `next start` flow and ships
the full `.next` directory. If standalone output is enabled later, the
runtime stage can be slimmed to `.next/standalone` + `.next/static` +
`public/` with `node server.js` — the commented alternative at the bottom
of `Dockerfile.web` shows exactly how.

## Local stack

`docker compose up -d` (from the repo root) builds both images and starts
Postgres 16, Redis 7, MinIO, MailHog, the API and the web app. See the root
`README.md` for ports and the demo login.
