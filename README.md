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