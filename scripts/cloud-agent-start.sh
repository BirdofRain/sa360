#!/usr/bin/env bash
#
# Cloud Agent start phase for SA360.
#
# Per-boot reconciliation of the LOCAL developer infrastructure:
#   - start Redis
#   - start the local PostgreSQL 16 cluster
#   - ensure the sa360 role and the sa360 / sa360_test databases exist
#   - apply Prisma migrations to those LOCAL databases only
#
# It is idempotent and safe to run repeatedly. It NEVER contacts a remote or
# production database: every connection string is bound to 127.0.0.1. It does
# NOT start the API, worker, or admin-coc servers; those stay task-specific.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

log() { printf '\n[cloud-start] %s\n' "$*"; }

PG_APP_USER=sa360
PG_APP_PASSWORD=sa360password
PG_HOST=127.0.0.1
PG_PORT=5432
PG_MAJOR=16

if ! command -v psql >/dev/null 2>&1; then
  log "PostgreSQL not installed; skipping DB/Redis startup (run scripts/cloud-agent-install.sh first)"
  exit 0
fi

# --- Redis -----------------------------------------------------------------
if command -v redis-server >/dev/null 2>&1; then
  if ! redis-cli ping >/dev/null 2>&1; then
    log "starting redis-server"
    redis-server --daemonize yes --save '' --appendonly no
    for _ in $(seq 1 20); do redis-cli ping >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  if redis-cli ping >/dev/null 2>&1; then
    log "redis ready"
  else
    log "redis failed to become ready"
    exit 1
  fi
fi

# --- PostgreSQL ------------------------------------------------------------
if ! sudo -u postgres pg_isready -h "$PG_HOST" -p "$PG_PORT" >/dev/null 2>&1; then
  log "starting postgresql cluster ${PG_MAJOR}/main"
  sudo pg_ctlcluster "$PG_MAJOR" main start || true
  for _ in $(seq 1 30); do
    sudo -u postgres pg_isready -h "$PG_HOST" -p "$PG_PORT" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

if sudo -u postgres pg_isready -h "$PG_HOST" -p "$PG_PORT" >/dev/null 2>&1; then
  log "postgres ready"
else
  log "postgres failed to become ready"
  exit 1
fi

# Application login role.
if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_APP_USER}'")" != "1" ]; then
  log "creating role ${PG_APP_USER}"
  sudo -u postgres psql -c "CREATE ROLE ${PG_APP_USER} LOGIN PASSWORD '${PG_APP_PASSWORD}' CREATEDB;"
fi

# Local dev + test databases.
for db in sa360 sa360_test; do
  if [ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'")" != "1" ]; then
    log "creating database ${db}"
    sudo -u postgres createdb -O "$PG_APP_USER" "$db"
  fi
done

# Apply migrations to the LOCAL databases only. prisma migrate deploy is a
# no-op once every migration is present, so this stays cheap on later boots.
for db in sa360 sa360_test; do
  log "prisma migrate deploy -> ${db} (local)"
  DATABASE_URL="postgresql://${PG_APP_USER}:${PG_APP_PASSWORD}@${PG_HOST}:${PG_PORT}/${db}" \
    pnpm exec prisma migrate deploy
done

log "start complete"
