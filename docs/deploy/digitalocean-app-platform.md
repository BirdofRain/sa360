# DigitalOcean App Platform — SA360 API, Worker, and Agent Workspace (admin-coc)

This repo is a **pnpm monorepo** at the repository root. On App Platform you normally deploy **three separate components** that share the same GitHub repo and root directory, each with its own **build** and **run** command.

## Recommended App Platform components

| Component | Type | Purpose |
|-----------|------|---------|
| **sa360-api** | Web Service | Fastify HTTP API: webhooks, voice, admin, agent-workspace, health. |
| **sa360-worker** | Worker | BullMQ consumer (same `REDIS_URL` / Valkey as API). |
| **sa360-admin-coc** | Web Service | Next.js 15 app: internal C.O.C. dashboard + embedded **`/agent-workspace`** for GHL. |

**Also provision (managed or external):**

- **PostgreSQL** — connection string → `DATABASE_URL`.
- **Redis or Valkey** — connection URL → `REDIS_URL` (same variable name; Valkey is Redis-compatible for this stack).

**Networking:** Give the API a stable public HTTPS URL. The Next app must call that URL via **`NEXT_PUBLIC_SA360_API_BASE_URL`** (preferred) or **`NEXT_PUBLIC_API_BASE_URL`** (legacy).

---

## Node / pnpm (all components)

- **Node:** `22.x` (matches root `package.json` `engines`).
- **Package manager:** enable Corepack and use the repo’s pnpm version (`package.json` → `packageManager`, e.g. `pnpm@10.32.1`).

Example **pre-build** snippet (adjust if your build image already provides pnpm):

```bash
corepack enable && corepack prepare pnpm@10.32.1 --activate
```

Install from repo root:

```bash
pnpm install --frozen-lockfile
```

---

## Build commands (exact)

Run from **repository root** (`Source Dir` = `.`).

### API (`sa360-api`)

```bash
corepack enable && corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile && pnpm build:api
```

(`build:api` = `prisma generate` + `@sa360/shared` build + `@sa360/api` TypeScript compile.)

### Worker (`sa360-worker`)

```bash
corepack enable && corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile && pnpm build:worker
```

### Next.js admin / Agent Workspace (`sa360-admin-coc`)

```bash
corepack enable && corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile && pnpm build:admin-coc
```

---

## Run commands (exact)

From repo root, using pnpm’s filter (sets the correct package working directory):

| Component | Run command |
|-----------|-------------|
| API | `pnpm --filter @sa360/api start` |
| Worker | `pnpm --filter @sa360/worker start` |
| admin-coc | `pnpm --filter @sa360/admin-coc start` |

**HTTP port:** App Platform sets `PORT`. The API (`apps/api/src/server.ts`) and Next.js both read **`PORT`** — assign the HTTP route port in DO to match (default behavior).

---

## Health checks (API)

Already implemented; use for the **API** Web Service liveness/health:

| Path | Use case |
|------|----------|
| `GET /health` | Lightweight — process up. |
| `GET /health/db` | Validates Postgres via Prisma. |
| `GET /health/queue` | Validates Redis/Valkey (`PING`). |

**admin-coc:** use **`GET /agent-workspace`** as a simple 200 check (returns an HTML empty state without `clientAccountId`), or rely on the platform’s default HTTP check against `/`.

---

## Database migrations

**Schema:** root `prisma/schema.prisma` (single database for API + worker).

**Deploy migrations** (production, non-interactive):

```bash
corepack enable && corepack prepare pnpm@10.32.1 --activate && pnpm install --frozen-lockfile && pnpm migrate:deploy
```

**When to run:** Prefer a **Job** (one-off) or a **release phase** before traffic switches, with the same `DATABASE_URL` as production. Do not use `prisma migrate dev` on App Platform.

Root script: `pnpm migrate:deploy` → `prisma migrate deploy`.

---

## Environment variables

### Shared (API + worker)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Postgres connection string. |
| `REDIS_URL` | Yes | Redis or Valkey URL (`rediss://` when TLS). |
| `WEBHOOK_SECRET` | **Yes in production** for GHL lifecycle + Synthflow voice routes (`x-sa360-secret`). **Unchanged behavior** — do not rename or remove. |
| `LOGTAIL_SOURCE_TOKEN` | Optional | Remote logs (see root README). |
| `LOGTAIL_INGESTING_HOST` | Optional | |
| `SA360_ENV` | Recommended | e.g. `production`. |
| `SA360_LOG_LEVEL` | Optional | Default `info`. |

### API-only (web service)

| Variable | Required | Notes |
|----------|----------|--------|
| `PORT` | Auto | Set by App Platform. |
| `ADMIN_API_KEY` **or** `SA360_ADMIN_KEY` | For `/admin/v1/*` | Same secret; header `x-sa360-admin-key`. Prefer one name consistently. |
| `AGENT_WORKSPACE_API_KEY` **or** `SA360_WORKSPACE_SECRET` | For `/agent-workspace/v1/*` | Same secret; header `x-sa360-workspace-key`. `AGENT_WORKSPACE_API_KEY` wins if both set. |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated list. If set, registers `@fastify/cors` on the API. Omit to leave CORS off (default). |
| `GHL_PRIVATE_INTEGRATION_TOKEN` / `AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN` / `GHL_API_KEY` | Optional | Workspace→GHL sync and other GHL calls; see `ghl-workspace-sync-env.ts`. |
| `GHL_API_BASE_URL` | Optional | Defaults to LeadConnector `https://services.leadconnectorhq.com`. |
| `GHL_OAUTH_CLIENT_ID` / `GHL_OAUTH_CLIENT_SECRET` | For GHL Marketplace OAuth | Marketplace app credentials. |
| `GHL_OAUTH_REDIRECT_URI` | **Yes (OAuth)** | **Must use the API Web Service public URL**, e.g. `https://<api-domain>/integrations/oauth/callback`. Do **not** use the admin-coc hostname unless you rely on the Next.js proxy route (see below). |
| `GHL_OAUTH_SCOPES` | **Yes (OAuth)** | Space-separated scopes for chooselocation install. |
| `GHL_OAUTH_VERSION_ID` | Recommended | Marketplace `version_id` (whitelabel install URL). |
| `GHL_TOKEN_ENCRYPTION_KEY` | **Yes (OAuth)** | Encrypts stored refresh tokens. |
| `ADMIN_COC_BASE_URL` | **Yes (OAuth)** | Public admin-coc origin for post-callback redirects (`/ghl-connections`). |
| `AGENT_WORKSPACE_GHL_SYNC_ENABLED` | Optional | `true` to push “What happened” to GHL when token + field map configured. |

**OAuth callback routing:** Fastify registers `GET /integrations/oauth/callback` on the **API** component. If GHL’s redirect URI accidentally points at **admin-coc**, middleware allows `/integrations/oauth/callback` and Next forwards to `NEXT_PUBLIC_SA360_API_BASE_URL` + same path.

**Smoke (production):**

```bash
curl -i https://<api-domain>/integrations/oauth/callback
# Expect 302 to ADMIN_COC_BASE_URL?ghl_oauth=error&reason=missing_code_or_state — never 404
```

Or: `pnpm smoke:oauth:ps` (see `scripts/smoke-oauth-callback.ps1`).

**Webhook / voice behavior** is still driven by **`WEBHOOK_SECRET`** only — no change to that contract.

### Worker-only

| Variable | Required | Notes |
|----------|----------|--------|
| Same as shared + `REDIS_URL` | Yes | Worker uses BullMQ on Redis. |
| `META_DISPATCH_CONCURRENCY` | Optional | Default `5`. |

### admin-coc (Next.js)

| Variable | Required | Notes |
|----------|----------|--------|
| `PORT` | Auto | App Platform. |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | **Recommended** | Public HTTPS base URL of **sa360-api** (no trailing slash). Browser/server use for admin + workspace proxies. |
| `NEXT_PUBLIC_API_BASE_URL` | Optional | Legacy alias if `NEXT_PUBLIC_SA360_API_BASE_URL` is unset. |
| `SA360_APP_BASE_URL` | Optional | **Not read by code today**; document for operators (GHL menu links, runbooks). Set to the **admin-coc** public origin, e.g. `https://coc.example.com`. |
| `SA360_AGENT_WORKSPACE_API_KEY` or `AGENT_WORKSPACE_API_KEY` | For `/agent-workspace` + `/api/agent-workspace/*` | Must equal the API’s `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET`. Forwarded server-side as `x-sa360-workspace-key`. |
| `SA360_ADMIN_API_KEY` or `ADMIN_API_KEY` or `SA360_ADMIN_KEY` | For dashboard admin API proxies | Must match API `ADMIN_API_KEY` or `SA360_ADMIN_KEY`. |
| `NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID` | Optional (staging) | Pre-fills master client filter on Delivery Readiness / Routing Dry Run (e.g. `lal_master_vet`). Not locked — operators can override. |
| `ADMIN_COC_PASSWORD` | Recommended prod | Single-password gate for `/(dashboard)`; **`/agent-workspace`** is excluded in middleware so GHL iframe works without this cookie. |
| `GHL_EMBED_FRAME_ANCESTORS` | Optional | CSP **`frame-ancestors`** for **`/agent-workspace`** only (embed in GoHighLevel). Unset → default allowlist `app.gohighlevel.com` + `app.leadconnectorhq.com` + `'self'`. Set to a source list or full `frame-ancestors ...` string. See `docs/ghl/agent-workspace-gohighlevel-embed.md` §9. |

---

## Cross-service secret alignment

1. Pick one workspace secret value.
2. API: set `SA360_WORKSPACE_SECRET` **or** `AGENT_WORKSPACE_API_KEY` to that value.
3. admin-coc: set `SA360_AGENT_WORKSPACE_API_KEY` **or** `AGENT_WORKSPACE_API_KEY` to the **same** value.

Admin API key: API `ADMIN_API_KEY` or `SA360_ADMIN_KEY` ↔ Next `SA360_ADMIN_API_KEY` or `ADMIN_API_KEY`.

---

## Post-deploy smoke tests

For **repeatable Agent Workspace checks** (health, guidance, CSP, optional mutating POSTs), see **`docs/deploy/agent-workspace-smoke-tests.md`** and run `pnpm smoke:workspace:ps` (or `pnpm smoke:workspace:bash`).

Run against **production URLs** and secrets (use a test contact / client only).

1. **API shallow health**  
   `GET https://<api-domain>/health` → `200`, JSON `{ "ok": true, "service": "api" }`.

2. **API DB + queue**  
   `GET https://<api-domain>/health/db` and `/health/queue` → `200`.

3. **Webhook secret unchanged**  
   `POST https://<api-domain>/webhooks/ghl/lifecycle-event` with **wrong** `x-sa360-secret` → `401`. (Do not spam real pipelines; one negative test is enough.)

4. **Agent Workspace API** (replace placeholders):  
   `GET https://<api-domain>/agent-workspace/v1/context?clientAccountId=<id>`  
   Header: `x-sa360-workspace-key: <same as API env>`  
   → `200` with context JSON, or `400` if query invalid — not `503` (which means workspace key not configured).

5. **Embedded UI**  
   Open `https://<coc-domain>/agent-workspace?clientAccountId=<id>&locationId=<loc>&contactId=<ghl>` in a browser → page loads (no infinite redirect to `/login`); network tab shows `200` on `/api/agent-workspace/context` when configured.

6. **Worker**  
   Confirm App Platform worker instance is **running** (no crash loop) and Redis connectivity — optionally trigger a known queue job and verify logs in Logtail.

---

## Summary table (copy-paste for runbooks)

| Item | Value |
|------|--------|
| Repo root | `.` |
| API build | `pnpm install --frozen-lockfile && pnpm build:api` |
| API run | `pnpm --filter @sa360/api start` |
| Worker build | `pnpm install --frozen-lockfile && pnpm build:worker` |
| Worker run | `pnpm --filter @sa360/worker start` |
| admin-coc build | `pnpm install --frozen-lockfile && pnpm build:admin-coc` |
| admin-coc run | `pnpm --filter @sa360/admin-coc start` |
| Migrations | `pnpm migrate:deploy` |
| API health path | `/health` |
