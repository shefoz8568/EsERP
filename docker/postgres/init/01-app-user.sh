#!/bin/sh
# Runs once on first `docker compose up` (postgres entrypoint initdb.d).
# Creates the least-privilege runtime role `eserp_app` used by the API and
# tests. The API must NEVER connect as POSTGRES_USER: that role is a
# superuser, and superusers bypass Postgres RLS entirely, so tenant
# isolation would rest only on the application guard.
#
# Default privileges are set now so that every table/sequence the owner
# (POSTGRES_USER) creates later — i.e. via `prisma migrate deploy` — is
# automatically usable by eserp_app. No explicit per-table GRANT step is
# needed after migrations.
set -eu

# psql variables (:"..." interpolates them safely quoted as identifiers /
# string literals); the heredoc is quoted so the shell expands nothing.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="${POSTGRES_APP_PASSWORD:-eserp_app_password}" \
  -v db_name="$POSTGRES_DB" \
  -v owner="$POSTGRES_USER" <<'EOSQL'
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eserp_app') AS missing \gset
\if :missing
CREATE USER eserp_app WITH PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN;
\endif
GRANT CONNECT ON DATABASE :"db_name" TO eserp_app;
GRANT USAGE ON SCHEMA public TO eserp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eserp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eserp_app;
EOSQL
