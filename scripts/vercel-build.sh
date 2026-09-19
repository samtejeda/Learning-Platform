#!/usr/bin/env bash
# Vercel build entrypoint (vercel.json -> buildCommand -> `pnpm build:vercel`).
#
# Production deploys apply pending Drizzle migrations BEFORE building. If the
# migration fails the build fails, so the previous deployment stays live and
# no code that expects the new schema ships. `drizzle-kit migrate` is
# idempotent (journal in drizzle.__drizzle_migrations), so redeploying the
# same commit is a no-op.
#
# Preview deploys never migrate: they must not be able to touch the production
# database, even if someone mistakenly exposes DIRECT_URL to Preview scope.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  : "${DIRECT_URL:?DIRECT_URL must be set in Vercel (Production scope only) to run migrations}"
  echo "Production deploy: applying migrations"
  pnpm exec drizzle-kit migrate
else
  echo "Skipping migrations (VERCEL_ENV=${VERCEL_ENV:-unset})"
fi

pnpm build
