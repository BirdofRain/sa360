# LeadCapture.io → SA360 Source Intake Setup

LeadCapture.io is a **supported SA360 source adapter** with two intake channels:

| Channel | Endpoint | Source system | Default behavior |
|---------|----------|---------------|------------------|
| Legacy | `POST /webhooks/leadcaptureio` | `leadcapture_io_legacy` (or explicit nextgen marker) | Normalize + route dry-run; **no automatic GHL delivery** |
| **NextGen** | `POST /sources/leadcapture/nextgen/lead-created` | `leadcapture_io_nextgen` | **Capture-only** unless stage env is raised |

## NextGen source adapter (capture-only by default)

Preferred path for LeadCapture 2.0 / NextGen campaigns.

```
POST https://sa360-sw6oq.ondigitalocean.app/sources/leadcapture/nextgen/lead-created
```

### Authentication

| Header / method | Value |
|-----------------|--------|
| `x-sa360-leadcapture-nextgen-key` | `SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET` |
| HTTP Basic (optional) | Username `sa360-leadcapture-nextgen` (or `SA360_LEADCAPTURE_NEXTGEN_BASIC_AUTH_USERNAME`); password = NextGen webhook secret |

- Dedicated secret — **not** the legacy `SA360_LEADCAPTURE_WEBHOOK_SECRET`.
- Production fail-closed: missing NextGen secret → **503** `integration_not_configured`.
- Dev without secret: accepted with `devWarning` only.

### Identifiers

| Field | Value |
|-------|--------|
| `sourceProvider` | `leadcapture_io` |
| `sourceSystem` | `leadcapture_io_nextgen` |
| Provider lead id | UUID `lead_id` (required; numeric legacy IDs rejected) |

### Zero-config webhook contract (NextGen)

Preferred human webhook name for **every** funnel (the webhook name has **no** routing meaning):

`SA360 - NextGen Intake`

Matt's target workflow: duplicate funnel → rename funnel → verify the generic SA360 webhook copied with dynamic `lead_id` / `parent_url` / `funnel_name` → publish.

There is no requirement to rename the webhook per client, no unique `sa360_route_key` editing, and no hidden technical field.

Use LeadCapture **dynamic** provider values in the payload template ([leadcaptureio-nextgen-webhook-template.json](./leadcaptureio-nextgen-webhook-template.json)):

| Field | Required | Notes |
|-------|---------|--------|
| `lead_id` | **Yes** (UUID) | Dynamic LeadCapture lead UUID. Must **not** be hardcoded |
| `parent_url` | **Expected** (dynamic) | Live funnel page URL. Must **not** be hardcoded. Query parameters (including `?v=`) are ignored for source identity. Canonical identity is `hostname + pathname`, e.g. `my.leadcapture.io/p/dn_omzoj` |
| `funnel_name` | **Expected** (dynamic) | Current funnel title, e.g. `Life Insurance For Veterans - Madison Pimentel V2`. Metadata only — renaming does not create a new source |
| `funnel_id` | Optional | Include if LeadCapture exposes it. Not required for the normal workflow |
| `form_id` | Optional | Include if LeadCapture exposes it |
| `sa360_route_key` | Legacy optional | Compatibility fallback only. A stale copied route key never overrides `funnel_id` / `form_id` / `parent_url_key` |

`funnel_id` / `form_id` absence must **not** 4xx the lead. SA360 retains the lead. When `parent_url` is a valid absolute http(s) URL, SourceFunnel is identified by the normalized `parentUrlKey`. Missing/invalid `parent_url` is fail-soft and may fall through to route-key compatibility without blocking inventory.

Do **not** connect the live LeadCapture provider from this foundation PR. Production stage remains `capture_only` unless a separate human-gated change raises it. Do **not** set `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE=inventory_only` as a production default.

### Idempotency

Replays of the same `(leadcapture_io, leadcapture_io_nextgen, lead_id UUID)` return the existing `SourceLeadEvent` with `duplicate: true` — no second durable event.

### Intake stages (`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE`)

Default when unset or unrecognized: **`capture_only`**.

| Stage | Allowed | Not allowed |
|-------|---------|-------------|
| `capture_only` | Auth, validate, redact log, idempotent `SourceLeadEvent` | Normalize/route, allocation, fulfillment outbox, GHL/delivery |
| `normalize_route_proof` | + normalize, exact campaign/form match, proof ingest | Loose keyword/UTM live routing; unmatched → review (no fallback client) |
| `shadow_fulfillment` | + LF2 shadow outbox / shadow allocation planning | Live external delivery, destination writes, cutover |
| `live_canary` | + explicit one-lead live canary gates (separate env allowlists) | Automatic broad live delivery |

**Live routing and delivery are not enabled by default.** Raising the stage still does not enable GHL writes until existing delivery/runtime allowlists and operator confirmation paths are used.

### Recommended canary progression

1. Deploy with unset stage (`capture_only`) + set `SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET`.
2. Send one real NextGen test lead; confirm `SourceLeadEvent` + redacted webhook log.
3. Optionally raise to `normalize_route_proof` for exact match + proof (still no delivery).
4. Optionally raise to `shadow_fulfillment` for shadow outbox only.
5. `live_canary` only with explicit `SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_*` allowlists and max-leads budget.

### Related NextGen env vars (all opt-in)

| Variable | Default effect |
|----------|----------------|
| `SA360_LEADCAPTURE_NEXTGEN_WEBHOOK_SECRET` | Required in production |
| `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` | Unset → `capture_only` |
| `SA360_LEADCAPTURE_NEXTGEN_LIVE_CANARY_ENABLED` | Unset/false → live canary off |
| `SA360_LEADCAPTURE_NEXTGEN_LEGACY_PAUSE_CAMPAIGN_IDS` | Unset → legacy webhook unchanged |

Admin read models (shadow/pool visibility only): `GET /admin/v1/live-lead-pool`, `GET /admin/v1/demand-queue`.

---

## Legacy webhook URL

```
POST https://sa360-sw6oq.ondigitalocean.app/webhooks/leadcaptureio
```

Optional route-key path (overrides or supplements `sa360_route_key` in body):

```
POST https://sa360-sw6oq.ondigitalocean.app/webhooks/leadcaptureio/LC_VET_FEX_TEST
```

## Legacy security header

| Header | Value |
|--------|--------|
| `x-sa360-leadcapture-key` | Value of `SA360_LEADCAPTURE_WEBHOOK_SECRET` on the API |

- When `SA360_LEADCAPTURE_WEBHOOK_SECRET` is set, missing or wrong keys return **401**.
- When unset (local dev only), requests are accepted and a `devWarning` is logged — never use this in production.

## Custom payload template

- **NextGen (preferred):** [leadcaptureio-nextgen-webhook-template.json](./leadcaptureio-nextgen-webhook-template.json) — dynamic `lead_id`, `parent_url`, `funnel_name`. Optional `funnel_id` / `form_id` if the provider exposes them.
- **Legacy:** [leadcaptureio-webhook-template.json](./leadcaptureio-webhook-template.json).

## Static values per funnel

**NextGen:** do not configure a unique static `sa360_route_key` or a static `sa360_funnel_name`. Do **not** hardcode `parent_url`. `lead_id`, `parent_url`, and `funnel_name` are dynamic. Query parameters are ignored for source identity.

**Legacy only** — configure these per LeadCapture.io form / funnel:

| Field | Example (Vet FEX test) |
|-------|-------------------------|
| `sa360_route_key` | `LC_VET_FEX_TEST` |
| `sa360_source_system` | `leadcapture_io_legacy` |
| `sa360_funnel_name` | `Life Insurance For Veterans` |
| `sa360_campaign_name` | `LeadCapture.io Vet FEX Test` |

## What happens on ingest

1. Raw payload stored in `SourceLeadEvent`
2. Normalized to SA360 **MASTER 2.0** lifecycle payload (`client_account_id: leadcapture_io`)
3. Routing dry-run against `campaign_id = sa360_route_key`
4. Duplicate risk evaluated
5. **No automatic GHL delivery**

## Admin review

Open **Admin C.O.C. → Source Intake Queue** (`/source-intake`) or **Webhook Monitor** for HTTP audit rows (`source: leadcapture_io`).

## Routing rule (create manually)

Do **not** auto-seed in production. For Monday demo:

| Field | Value |
|-------|--------|
| `masterClientAccountId` | `leadcapture_io` |
| `matchType` | `campaign_id` |
| `campaignId` | `LC_VET_FEX_TEST` |
| `clientAccountId` | `smart_agent_360_demo` |
| `destinationSubaccountIdGhl` | `VPuMIhN6JpxdoXvvlekZ` |

## Monday demo test sequence

1. **Send Test** in LeadCapture.io (or POST fixture JSON to webhook URL with header).
2. Verify row in **Source Intake Queue** — status `routing_matched` or `routing_unmatched`.
3. Confirm routing rule exists for `LC_VET_FEX_TEST` → Smart Agent 360 Demo.
4. Inspect detail drawer: raw payload, normalized payload, routing, duplicate risk.
5. **Approve for simulation** — type `APPROVE SOURCE LEAD DELIVERY`.
6. Only after simulation passes: **Approve and deliver one lead** (live canary) with same confirmation text plus runtime mode `live_canary`.

## Fixtures

- `apps/api/src/fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy.json`
- `apps/api/src/fixtures/leadcaptureio/leadcaptureio-webhook-sample-nextgen.json`

All fixture PII is synthetic (`@example.test`, `55501…` numbers).
