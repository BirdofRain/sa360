# SA360 Source Intake & Import Plan

## Goal

Generic source-intake layer: receive raw lead events → preserve source data → normalize to MASTER 2.0 → route → operator review → approved delivery via existing GHL adapter.

**Default: no automatic GHL writes.**

## Supported source systems

| `source_system` | Provider | Type |
|-----------------|----------|------|
| `leadcapture_io_legacy` | `leadcapture_io` | webhook / lead_form |
| `leadcapture_io_nextgen` | `leadcapture_io` | webhook / lead_form |
| `meta_lead_ads` | `facebook` | api_import (future) |
| `external_vendor` | vendor-specific | bulk_import |
| `csv_import` | `manual_import` | bulk_import |
| `google_sheet_import` | `google_sheets` | bulk_import |

## Implemented (this branch)

- `SourceLeadEvent` table
- `POST /webhooks/leadcaptureio`
- LeadCapture.io normalizer → MASTER 2.0
- Routing dry-run + duplicate risk on intake
- Admin `GET /admin/v1/source-leads`, detail, approve/reject/requeue
- Admin C.O.C. Source Intake Queue UI

## Planned endpoints (scaffolding)

| Endpoint | Status |
|----------|--------|
| `POST /admin/v1/source-imports/csv/preview` | 501 stub |
| `POST /admin/v1/source-imports/csv/commit` | not implemented |
| `POST /admin/v1/source-imports/google-sheets/preview` | not implemented |
| `POST /admin/v1/source-imports/google-sheets/commit` | not implemented |

## Future CSV / Google Sheet flow

1. Operator uploads CSV or connects Google Sheet
2. Map columns → SA360 contact / attribution fields
3. Preview normalized leads + routing + duplicates
4. Commit creates `SourceLeadEvent` rows (`status: needs_review`)
5. Operator approves per lead or in bulk (bulk approval later)

## GOAT Leads example (future)

```json
{
  "provider": "goat_leads",
  "sourceSystem": "external_vendor",
  "sourceType": "bulk_import",
  "importBatchId": "goat_batch_2026_06_12",
  "targetClientAccountId": "smart_agent_360_demo",
  "targetLocationIdGhl": "VPuMIhN6JpxdoXvvlekZ"
}
```

- Route override allowed only with admin approval
- Delivery still goes through review queue + existing GHL adapter safety gates

## Routing keys (preferred)

- `source_provider`
- `source_system`
- `source_type`
- `source_route_key` → maps to `attribution.campaign_id`
- `attribution.utm_campaign`
- Explicit client override on import approval only

## Safety constraints

- Do not weaken live canary gates
- Do not broaden live delivery allowlist automatically
- Do not bypass duplicate checks or readiness
- Webhook intake never auto-calls approve-delivery

## TypeScript interfaces

See `apps/api/src/services/source-intake/source-intake.types.ts`:

- `SourceLeadNormalizer`
- `SourceImportSourceDescriptor`

Register new normalizers in `source-lead-normalizer.registry.ts`.
