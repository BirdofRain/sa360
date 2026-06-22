# SA360

## Local setup

1. Install Node.js, pnpm, Docker Desktop
2. Start containers:
   docker compose -f infra/docker-compose.yml up -d
3. Generate Prisma client:
   pnpm prisma:generate
4. Run migrations:
   pnpm prisma:migrate --name init
5. Seed test client:
   pnpm prisma:seed
6. Build shared package:
   pnpm --filter @sa360/shared build
7. Start API:
   pnpm dev:api
8. Start worker:
   pnpm dev:worker

## Health checks

- GET /health
- GET /health/db
- GET /health/queue

## Environment variables

Reference for **`apps/api`** (Fastify) and **`apps/admin-coc`** (Next.js). Deploy runbooks also live in **[docs/deploy/digitalocean-app-platform.md](docs/deploy/digitalocean-app-platform.md)** and **[apps/admin-coc/README.md](apps/admin-coc/README.md)**.

**Conventions**

- **Server-only** secrets must never use the `NEXT_PUBLIC_` prefix (Next.js exposes those to the browser).
- When two names are listed with **or**, pick one consistently; the first listed usually wins if both are set.
- API loads `.env` from the repo root via `dotenv` (`apps/api/src/server.ts`). Admin C.O.C. uses Next.js env loading (`.env.local` in `apps/admin-coc` or repo root).

### API (`apps/api`)

#### Core (required to run)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | **Yes** | Postgres connection string (Prisma). |
| `REDIS_URL` | **Yes** | Redis/Valkey URL (BullMQ, queues, `GET /health/queue`). |
| `PORT` | Auto | HTTP port (default `3000`; App Platform sets this). |
| `NODE_ENV` | Auto | `development` / `production` / `test`. |

#### Auth and webhooks

| Variable | Required | Notes |
|----------|----------|-------|
| `WEBHOOK_SECRET` | **Yes in prod** | GHL lifecycle + Synthflow voice routes (`x-sa360-secret` header). |
| `ADMIN_API_KEY` **or** `SA360_ADMIN_KEY` | For `/admin/v1/*` | Header: `x-sa360-admin-key`. |
| `AGENT_WORKSPACE_API_KEY` **or** `SA360_WORKSPACE_SECRET` | For `/agent-workspace/v1/*` | Header: `x-sa360-workspace-key` (`AGENT_WORKSPACE_API_KEY` wins if both set). |
| `CLIENT_PORTAL_API_KEY` | For `/client/v1/*` | Header: `x-sa360-client-portal-key`. |
| `SA360_LEADCAPTURE_WEBHOOK_SECRET` | **Prod** | LeadCapture.io webhooks; dev accepts without it. |
| `SA360_LEADCAPTURE_BASIC_AUTH_USERNAME` | Optional | Basic-auth username for LeadCapture (default: `sa360-leadcapture`; password = secret). |

#### Logging and ops

| Variable | Required | Notes |
|----------|----------|-------|
| `SA360_ENV` | Recommended | e.g. `production` — included in structured logs. |
| `SA360_LOG_LEVEL` | Optional | `debug` / `info` / `warn` / `error` (default `info`). |
| `LOGTAIL_SOURCE_TOKEN` | Optional | Better Stack remote logging. |
| `LOGTAIL_INGESTING_HOST` | Optional | Better Stack ingest host. |
| `ENABLE_DEBUG_ROUTES` | Optional | `true` → enables `GET /debug/logtail-test`. |
| `SA360_BUILD_LABEL` **or** `BUILD_LABEL` | Optional | Build label in version metadata. |
| `CORS_ALLOWED_ORIGINS` | Optional | Comma-separated origins; enables `@fastify/cors` when set. |

#### GHL integration (general)

| Variable | Required | Notes |
|----------|----------|-------|
| `GHL_API_BASE_URL` | Optional | Default: `https://services.leadconnectorhq.com`. |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Optional* | GHL API calls, contact lookup, live delivery. |
| `AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN` | Optional | Workspace sync token (overrides `GHL_PRIVATE_INTEGRATION_TOKEN` for sync). |
| `GHL_API_KEY` | Optional | Legacy fallback for GHL token. |
| `GHL_SA360_CUSTOM_FIELD_IDS_JSON` | Optional | JSON map of SA360 custom field IDs for GHL writes. |
| `GHL_LOCATION_ID` | Optional | Required with token for Synthflow GHL contact lookup. |
| `GHL_CONTACT_SEARCH_TIMEOUT_MS` | Optional | Contact search timeout. |

#### GHL OAuth (Marketplace install)

| Variable | Required | Notes |
|----------|----------|-------|
| `GHL_OAUTH_CLIENT_ID` | **Yes (OAuth)** | Marketplace app client ID. |
| `GHL_OAUTH_CLIENT_SECRET` | **Yes (OAuth)** | Marketplace app secret. |
| `GHL_OAUTH_REDIRECT_URI` | **Yes (OAuth)** | Must be API URL, e.g. `https://<api>/integrations/oauth/callback`. |
| `GHL_OAUTH_SCOPES` | **Yes (OAuth)** | Space-separated scopes. |
| `GHL_OAUTH_VERSION_ID` | Recommended | Marketplace `version_id`. |
| `GHL_OAUTH_AUTHORIZE_BASE_URL` | Optional | Override OAuth authorize URL. |
| `GHL_TOKEN_ENCRYPTION_KEY` | **Yes (OAuth)** | Encrypts stored refresh tokens. |
| `ADMIN_COC_BASE_URL` | **Yes (OAuth)** | Admin-coc origin for post-callback redirects (`/ghl-connections`). |
| `GHL_OAUTH_COC_REDIRECT_BASE` | Optional | Fallback if `ADMIN_COC_BASE_URL` unset. |

#### GHL delivery adapter

| Variable | Required | Notes |
|----------|----------|-------|
| `GHL_DELIVERY_ADAPTER_MAX_MODE` | Optional | Ceiling: `simulate` / `live_canary` / `disabled` / `readonly_probe` / `live_blocked`. |
| `SA360_GHL_LIVE_CANARY_ALLOWED` | Optional | Legacy bool ceiling (`true` → `live_canary`). |
| `GHL_DELIVERY_ADAPTER_MODE` | Optional | Legacy mode (superseded by DB runtime mode). |
| `GHL_WRITEBACK_ENABLED` | Optional | Action dashboard GHL writeback. |

#### Agent workspace → GHL sync

| Variable | Required | Notes |
|----------|----------|-------|
| `AGENT_WORKSPACE_GHL_SYNC_ENABLED` | Optional | `true` to push workspace notes to GHL. |
| `AGENT_WORKSPACE_GHL_SYNC_TIMEOUT_MS` | Optional | Sync request timeout. |
| `AGENT_WORKSPACE_GHL_SYNC_MAX_ATTEMPTS` | Optional | Retry cap. |

#### Synthflow / voice

| Variable | Required | Notes |
|----------|----------|-------|
| `SYNTHFLOW_INBOUND_ENABLED` | Optional | Default `false` — explicit opt-in. |
| `SYNTHFLOW_OUTBOUND_CONTEXT_ENABLED` | Optional | Default enabled; set `false` to disable. |
| `SYNTHFLOW_GHL_CONTACT_LOOKUP_ENABLED` | Optional | GHL contact lookup during voice. |
| `LOOKUP_MODE` | Optional | Inbound lookup mode. |
| `MAKE_LOOKUP_URL` | Optional | Make.com lookup webhook URL. |
| `MAKE_LOOKUP_TIMEOUT_MS` | Optional | Default `8000`, max `30000`. |
| `SYNTHFLOW_LOOKUP_CLIENT_ACCOUNT_ID` | Optional | Restrict lookup to one client. |
| `SYNTHFLOW_LOOKUP_SUBACCOUNT_ID_GHL` | Optional | Further scope to one GHL location. |
| `SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON` | Optional | Calendar ID map for outbound context. |
| `SYNTHFLOW_TENANT_RESOLUTION_MAP` **or** `SYNTHFLOW_TENANT_RESOLUTION_MAP_JSON` | Optional | Tenant resolution map. |

#### Client portal (API side)

| Variable | Required | Notes |
|----------|----------|-------|
| `CLIENT_PORTAL_API_KEY` | For live portal | Must match admin-coc. |
| `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` | **Yes (live)** | Tenant scope (not from browser). |
| `CLIENT_PORTAL_SUBACCOUNT_ID_GHL` | Optional | Scope metrics to one GHL location. |

#### Source intake / bulk import

| Variable | Required | Notes |
|----------|----------|-------|
| `SA360_BULK_SOURCE_IMPORTS_ENABLED` | Optional | Default on in dev, off in prod unless `true`. |

#### Direct demo delivery

| Variable | Required | Notes |
|----------|----------|-------|
| `SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS` | Optional | CSV allowlist. |
| `SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS` | Optional | CSV allowlist. |

#### Support tickets (API)

| Variable | Required | Notes |
|----------|----------|-------|
| `SUPPORT_TICKET_NOTIFY_EMAIL` | Optional | Notification inbox. |
| `SUPPORT_TICKET_NOTIFY_ENABLED` | Optional | Set `false` to disable email notify. |
| `RESEND_API_KEY` | Optional | Required with `SA360_TRANSACTIONAL_EMAIL_FROM` for email. |
| `SA360_TRANSACTIONAL_EMAIL_FROM` | Optional | From address for transactional email. |

#### Meta / queues

| Variable | Required | Notes |
|----------|----------|-------|
| `META_SYNC_ENABLED` | Optional | Default `true` when unset — gates Meta BullMQ enqueue. |

#### Test-only

| Variable | Notes |
|----------|-------|
| `SA360_TEST_PRISMA_CONNECTION_LIMIT` | Test DB connection pool limit (default `1`). |

### Admin C.O.C. (`apps/admin-coc`)

#### Core (required for live admin data)

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | Auto | HTTP port (default `3000`). |
| `NODE_ENV` | Auto | Affects cookie `secure` flag. |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | **Recommended** | Fastify API origin (no trailing slash). |
| `NEXT_PUBLIC_API_BASE_URL` | Optional | Legacy alias if `NEXT_PUBLIC_SA360_API_BASE_URL` unset. |
| `SA360_ADMIN_API_KEY` **or** `ADMIN_API_KEY` **or** `SA360_ADMIN_KEY` | **Server-only** | Forwarded as `x-sa360-admin-key` to API. |

#### Internal admin gate

| Variable | Required | Notes |
|----------|----------|-------|
| `ADMIN_COC_PASSWORD` | Recommended prod | Single-password login gate; unset = bypass (good for local dev). |

#### Agent workspace embed

| Variable | Required | Notes |
|----------|----------|-------|
| `SA360_AGENT_WORKSPACE_API_KEY` **or** `AGENT_WORKSPACE_API_KEY` | For `/agent-workspace` | Must match API workspace secret. |
| `GHL_EMBED_FRAME_ANCESTORS` | Optional | CSP `frame-ancestors` for `/agent-workspace` and `/action-center`. |

#### UI / branding (public — safe in browser)

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SA360_ENV` | Optional | `staging` / `production` header badge. |
| `NEXT_PUBLIC_SA360_REGION` | Optional | Region pill in header. |
| `NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID` | Optional | Pre-fills master client on several pages. |
| `NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID` | Optional | Legacy alias for above. |
| `NEXT_PUBLIC_GHL_APP_BASE_URL` **or** `NEXT_PUBLIC_GOHIGHLEVEL_APP_URL` | Optional | GHL deep-link origin. |
| `NEXT_PUBLIC_SA360_ADMIN_BASE_URL` | Optional | Admin origin for client portal links. |
| `NEXT_PUBLIC_CLIENT_PORTAL_BASE_URL` | Optional | Portal link from client detail panel. |
| `NEXT_PUBLIC_SA360_BUILD_LABEL` | Optional | Build label in UI. |
| `NEXT_PUBLIC_SA360_BUILD_COMMIT_SHA` | Auto | Set at build from git / deploy env. |
| `NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT` | Auto | Short commit in UI. |

Build-time inputs for commit SHA (used by `next.config.ts`, not read directly by app code): `SA360_BUILD_COMMIT_SHA`, `COMMIT_HASH`, `COMMIT_SHA`, `GIT_COMMIT`.

#### Feature flags (public)

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED` | off | Support tickets nav + pages. |
| `NEXT_PUBLIC_SA360_COC_DETAIL_OVERLAY_ENABLED` | on | Detail overlay UI. |
| `NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED` | on in dev | CSV bulk import wizard. |

#### Client portal (`/portal`)

| Variable | Required | Notes |
|----------|----------|-------|
| `CLIENT_PORTAL_API_KEY` | For live data | **Server-only** — must match API. |
| `CLIENT_PORTAL_LOGIN_EMAIL` | For login | **Server-only**. |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | For login | **Server-only**. |
| `CLIENT_PORTAL_SESSION_SECRET` | For login | **Server-only** — HMAC for session cookie. |
| `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` | For login/invite | Tenant scope (also set on API). |
| `CLIENT_PORTAL_ACCESS_CODE` | Optional | One-time invite via `/portal?access=<code>`. |
| `CLIENT_PORTAL_DISPLAY_NAME` | Optional | Server fallback for display name. |
| `NEXT_PUBLIC_CLIENT_PORTAL_DISPLAY_NAME` | Optional | Client name in portal header. |
| `NEXT_PUBLIC_CLIENT_PORTAL_LOCATION_LABEL` | Optional | Location label under client name. |

### Cross-service alignment (must match)

| Purpose | API | Admin C.O.C. |
|---------|-----|--------------|
| Admin API | `ADMIN_API_KEY` or `SA360_ADMIN_KEY` | `SA360_ADMIN_API_KEY` or `ADMIN_API_KEY` or `SA360_ADMIN_KEY` |
| Agent workspace | `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET` | `SA360_AGENT_WORKSPACE_API_KEY` or `AGENT_WORKSPACE_API_KEY` |
| Client portal | `CLIENT_PORTAL_API_KEY` + `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` | Same `CLIENT_PORTAL_*` values |
| API base URL | (your public API origin) | `NEXT_PUBLIC_SA360_API_BASE_URL` |
| OAuth redirects | `ADMIN_COC_BASE_URL` | GHL may hit admin-coc proxy → forwards to API |

### Minimal local dev examples

**API** (`.env` at repo root):

```env
DATABASE_URL=postgresql://sa360:sa360password@localhost:5432/sa360
REDIS_URL=redis://localhost:6379
WEBHOOK_SECRET=dev-webhook-secret
ADMIN_API_KEY=dev-admin-key
AGENT_WORKSPACE_API_KEY=dev-workspace-key
```

**Admin C.O.C.** (`.env.local` in `apps/admin-coc` or repo root):

```env
NEXT_PUBLIC_SA360_API_BASE_URL=http://localhost:3001
SA360_ADMIN_API_KEY=dev-admin-key
AGENT_WORKSPACE_API_KEY=dev-workspace-key
# ADMIN_COC_PASSWORD=          # leave unset locally to skip login gate
```

## C.O.C. request logs (observability)

- **`POST /webhooks/ghl/lifecycle-event`** → table **`WebhookRequestLog`** (`source` = `ghl_lifecycle`).
- **`POST /voice/synthflow/inbound-lookup`** → table **`SynthflowRequestLog`** (dedicated columns for lookup outcome, phones, `knownCaller`, `matchedBy`, redacted JSON).

### Synthflow voice routes (authentication)

All **`POST /voice/synthflow/*`** endpoints require the same shared secret as GHL lifecycle webhooks:

| Item | Value |
|------|--------|
| Header | **`x-sa360-secret`** (must match env exactly after trim) |
| Env var | **`WEBHOOK_SECRET`** (required non-empty in production; routes return **401** if unset or wrong) |

Endpoints: **`inbound-lookup`**, **`outbound-context`**, **`outbound-result`**.

Example (PowerShell):

```powershell
$secret = $env:WEBHOOK_SECRET   # same value configured on the API
$body = @{ event = "call_inbound"; call_inbound = @{ from_number = "+15551234567"; to_number = "+15559876543" } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:3000/voice/synthflow/inbound-lookup" `
  -Method POST -Headers @{ "Content-Type" = "application/json"; "x-sa360-secret" = $secret } -Body $body
```

#### Outbound context (`POST /voice/synthflow/outbound-context`)

Call **before** an outbound Synthflow agent schedules. Response `custom_variables` include guardrails (`booking_allowed`, `script_goal`, `has_active_appointment`, `reschedule_allowed`), identity, assigned agent, and calendar hints.

**Request body (shape):** `event`: `call_outbound_context`, nested `call` with `to_number` (lead), `from_number` (caller-ID line), optional `model_id`, `contact_id_ghl`, `client_account_id`, `subaccount_id_ghl`, `lead_uid`.

**Calendar configuration (API env):** `SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON` — JSON with `byAgentId` and `defaultByClientAccountId` mapping to `{ "calendarId", "calendarLink"? }`. Resolved calendar is exposed as `scheduling_calendar_id` / `scheduling_calendar_link` (and legacy `calendar_id` / `calendar_link`). When resolution uses the agent map, `assigned_agent_calendar_id` / `assigned_agent_calendar_link` are also set; for client-default fallback those agent-specific fields stay empty while scheduling_* still holds the default calendar.

Example:

```powershell
$secret = $env:WEBHOOK_SECRET
$body = @{
  event = "call_outbound_context"
  call = @{
    model_id = "your_model"
    from_number = "+15551230001"
    to_number = "+15559876543"
    client_account_id = "your_ca"
    subaccount_id_ghl = ""
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3000/voice/synthflow/outbound-context" `
  -Method POST -Headers @{ "Content-Type" = "application/json"; "x-sa360-secret" = $secret } -Body $body
```

Requests are logged to **`SynthflowRequestLog`** with `route` `/voice/synthflow/outbound-context` when using the default ingest source.

Apply migrations, then query in Prisma Studio or SQL, for example:

`SELECT * FROM "WebhookRequestLog" ORDER BY "receivedAt" DESC LIMIT 20;`

`SELECT * FROM "SynthflowRequestLog" ORDER BY "receivedAt" DESC LIMIT 20;`

## Better Stack (Logtail) structured logs

Production visibility for GHL M1A intake uses `@logtail/node` in both the API and worker. Logs are structured JSON (console + Logtail when configured).

### DigitalOcean App Platform (API + worker + admin-coc)

See **[docs/deploy/digitalocean-app-platform.md](docs/deploy/digitalocean-app-platform.md)** for recommended components, exact build/run commands, `DATABASE_URL` / `REDIS_URL`, migration job (`pnpm migrate:deploy`), Agent Workspace env alignment, optional `CORS_ALLOWED_ORIGINS`, and post-deploy smoke tests.

### DigitalOcean / runtime environment variables

Logging-related variables (`LOGTAIL_SOURCE_TOKEN`, `LOGTAIL_INGESTING_HOST`, `SA360_LOG_LEVEL`, `SA360_ENV`, `ENABLE_DEBUG_ROUTES`) are documented in **[Environment variables](#environment-variables)** above. Set them on **both** the API and worker services (same values unless you use separate Logtail sources).

**Where to find token and ingesting host:** Better Stack → Logs → **Sources** → open your source → copy **Source token** and **Ingesting host** (do not paste the Live Tail browser URL into code or env as a substitute for these).

### Testing

1. Deploy or run locally with `LOGTAIL_SOURCE_TOKEN` set (and host if your source requires a non-default endpoint).
2. Optionally set `ENABLE_DEBUG_ROUTES=true` and call `GET /debug/logtail-test` — expect `{ ok: true }` and one `logtail.test` line in Live Tail.
3. Send a valid `POST /webhooks/ghl/lifecycle-event` and confirm stages such as `m1a.webhook.received`, `m1a.webhook.completed`, etc.

### Live Tail searches (examples)

- `module = M1A`
- `event_uuid = "<uuid>"`
- `lead_uid = "<uid>"`
- `stage = m1a.webhook.completed`
- `request_id = "<id>"` (or `worker:<jobId>` for worker logs)