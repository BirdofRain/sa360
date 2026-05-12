# SA360

## Local setup

1. Install Node.js, pnpm, Docker Desktop.
2. Start local Postgres + Redis containers:
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
3. Point your local `.env` at the **local** Postgres (see [Database environments](#database-environments) below). It must not point at the DigitalOcean managed cluster for `migrate dev`.
4. Generate the Prisma client:
   ```bash
   pnpm prisma:generate
   ```
5. Apply migrations to your local database:
   ```bash
   pnpm prisma:migrate --name init      # safe wrapper — see "Database environments"
   ```
6. Seed a test client:
   ```bash
   pnpm prisma:seed
   ```
7. Build the shared package:
   ```bash
   pnpm --filter @sa360/shared build
   ```
8. Start the API:
   ```bash
   pnpm dev:api
   ```
9. Start the worker:
   ```bash
   pnpm dev:worker
   ```

## Database environments

> **TL;DR — never run `prisma migrate dev`, `migrate reset`, or `db push` while `DATABASE_URL` points at the DigitalOcean cluster.** Those commands can rewrite or drop data. Use `prisma migrate deploy` for production. A safety guard now refuses the destructive commands automatically against remote URLs.

### Recommended local setup

Use a local Postgres (the one started by `infra/docker-compose.yml`) and keep your DigitalOcean URL out of your local working `.env`:

```env
# .env (repo root)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sa360_local
```

Apply migrations with the safe wrappers below. They route through `scripts/prisma-guard.ts`, which inspects `DATABASE_URL` and rejects destructive commands when the host looks remote (`*ondigitalocean.com`, or `sslmode=require` with a non-local host).

### Prisma scripts

All scripts run from the repo root.

| Script | What it runs | Guard? | Use for |
|---|---|---|---|
| `pnpm prisma:generate` | `prisma generate` | n/a (read-only) | Regenerate the Prisma client after schema changes. |
| `pnpm prisma:migrate --name <slug>` | `prisma migrate dev` | ✅ refuses remote | Day-to-day local migrations. |
| `pnpm prisma:migrate:safe --name <slug>` | `prisma migrate dev` | ✅ refuses remote | Same as above; explicit alias for scripts/docs. |
| `pnpm prisma:migrate:reset` | `prisma migrate reset` | ✅ refuses remote | Wipe + re-apply migrations against your local DB. |
| `pnpm prisma:db:push` | `prisma db push` | ✅ refuses remote | Prototype schema changes without a migration (local only). |
| `pnpm prisma:deploy` | `prisma migrate deploy` | logs target, allows remote | **Production** — apply already-committed migrations. Idempotent. |
| `pnpm prisma:studio` | `prisma studio` | n/a (read-only) | Browse the DB attached to current `DATABASE_URL`. |
| `pnpm prisma:seed` | `tsx prisma/seed.ts` | n/a | Seed the DB attached to current `DATABASE_URL`. |

### What the guard does

`scripts/prisma-guard.ts` reads `DATABASE_URL` (via `dotenv`, exactly as Prisma does), classifies the host, and:

- **Blocks** `migrate-dev`, `migrate-reset`, and `db-push` when the URL matches:
  - any host containing `ondigitalocean.com`, or
  - any URL with `sslmode=require` whose host is not `localhost` / `127.0.0.1` / `::1` / `0.0.0.0`.
- **Allows** `migrate-deploy` against remote URLs (that's its purpose) but logs the destination host first so you can see what you're about to hit.
- **Refuses** to run anything if `DATABASE_URL` is missing.

### Emergency bypass

If you really must run a destructive Prisma command against a remote DB (rare — almost always wrong), set the bypass env var on a single invocation:

```bash
ALLOW_REMOTE_PRISMA_MIGRATE=1 pnpm prisma:migrate:safe --name <slug>
```

### Production migration deploy

Migrations are applied to the DigitalOcean Postgres cluster via `prisma migrate deploy`:

```bash
# Run on a deploy host (or locally) with the production DATABASE_URL exported.
# `prisma migrate deploy` only applies already-committed migration files;
# it never generates new ones and is safe to re-run.
DATABASE_URL='<production url>' pnpm prisma:deploy
```

The guard will log `prisma-guard: prisma migrate deploy → REMOTE (...)` before the command runs, confirming the destination cluster.

## Health checks

- GET /health
- GET /health/db
- GET /health/queue

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

### DigitalOcean / runtime environment variables

Set on **both** the API and worker services (same values unless you use separate Logtail sources):

| Variable | Required | Description |
|----------|----------|-------------|
| `LOGTAIL_SOURCE_TOKEN` | For remote ingest | Source token from Better Stack → Logs → Sources → your Node source. |
| `LOGTAIL_INGESTING_HOST` | Optional | Ingest host from the same source (e.g. `in.logs.betterstack.com`). Omit to use the client default. Use hostname only or a full `https://…` URL. |
| `SA360_LOG_LEVEL` | Optional | `debug`, `info`, `warn`, or `error` (default `info`). |
| `SA360_ENV` | Recommended | e.g. `production` — included on every M1A log as `env`. |
| `ENABLE_DEBUG_ROUTES` | Optional | Set to `true` only when you need `GET /debug/logtail-test`. |

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