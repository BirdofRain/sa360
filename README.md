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