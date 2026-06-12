# LeadCapture.io → SA360 Source Intake Setup

## Webhook URL

```
POST https://sa360-sw6oq.ondigitalocean.app/webhooks/leadcaptureio
```

Optional route-key path (overrides or supplements `sa360_route_key` in body):

```
POST https://sa360-sw6oq.ondigitalocean.app/webhooks/leadcaptureio/LC_VET_FEX_TEST
```

## Security header

| Header | Value |
|--------|--------|
| `x-sa360-leadcapture-key` | Value of `SA360_LEADCAPTURE_WEBHOOK_SECRET` on the API |

- When `SA360_LEADCAPTURE_WEBHOOK_SECRET` is set, missing or wrong keys return **401**.
- When unset (local dev only), requests are accepted and a `devWarning` is logged — never use this in production.

## Custom payload template

Use the JSON template in [leadcaptureio-webhook-template.json](./leadcaptureio-webhook-template.json).

## Static values per funnel

Configure these per LeadCapture.io form / funnel:

| Field | Example (Vet FEX test) |
|-------|-------------------------|
| `sa360_route_key` | `LC_VET_FEX_TEST` |
| `sa360_source_system` | `leadcapture_io_legacy` or `leadcapture_io_nextgen` |
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
