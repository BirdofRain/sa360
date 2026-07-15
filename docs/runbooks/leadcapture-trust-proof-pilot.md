# LeadCapture trust proof pilot runbook

## Scope

- one LeadCapture campaign: `LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX`
- one SA360 client: `vet_life_james_torrey`
- Data API funnel UUID `d6f2157f-d612-441a-80af-88742ef084dc`
- legacy form ID `23381` (historical webhook/source metadata only; not a Data API `funnel_id`)
- trust evidence only via LeadCapture Data API
- webhooks remain primary for speed-to-lead
- Data API is reconciliation/proof channel
- no delivery, allocation, GHL, or LF2 changes

Persisted/`providerFormId` stores the provider `_meta.funnel_id` UUID for this pilot; the field name is retained for migration compatibility.

## Week 1

- confirm API contract against vendor OpenAPI / Postman collection
- build and configure provider client env vars
- verify campaign identifiers (`LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX`, Data API funnel UUID `d6f2157f-d612-441a-80af-88742ef084dc`)
- run one read-only trust preview (`POST /admin/v1/leadcapture/trust/pilot/preview`)
- verify exact SA360 correlation to `SourceLeadEvent`
- inspect completeness status and blockers

## Week 2

- authorize and attach one trust record (`POST /admin/v1/leadcapture/trust/pilot/attach`)
- confirm `LeadProof`, `LeadSourceSnapshot`, and `LeadProofArtifact` rows
- prove idempotent replay with the same `requestId`
- reconcile up to 25 campaign leads in preview
- measure exact-match percentage

## Week 3

- attach a small explicitly authorized pilot batch
- detect provider record changes via content hash
- measure missing/incomplete trust evidence
- test recovery/reconciliation preview
- produce pilot findings and recommendation

## Metrics

- provider records available
- exact correlation rate
- trust evidence completeness rate
- attachment success rate
- ambiguous/unmatched rate
- provider error rate
- changed-record rate
- average evidence age
- proof statuses after sync
- time from webhook intake to proof attachment

## Stop conditions

- campaign mismatch
- client mismatch
- ambiguous identity
- provider authorization failure
- unexpected provider schema change
- excessive rate limiting
- raw PII appearing in logs
- incorrect lead attachment
- proof overwriting prior evidence
- any GHL or delivery side effect

## Disable/rollback

- set `SA360_LEADCAPTURE_TRUST_SYNC_ENABLED=false`
- clear `SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST`
- stop manual reconciliation
- preserve already attached audit/proof records
- do not delete compliance evidence
- no effect on webhook intake or GHL delivery

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `SA360_LEADCAPTURE_DATA_API_BASE_URL` | API base | `https://my.leadcapture.io/api` |
| `SA360_LEADCAPTURE_DATA_API_TOKEN` | Bearer token | unset |
| `SA360_LEADCAPTURE_TRUST_SYNC_ENABLED` | Master gate | `false` |
| `SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST` | CSV campaign keys | empty |
| `SA360_LEADCAPTURE_TRUST_SYNC_FORM_ALLOWLIST` | CSV Data API funnel UUIDs | empty (fails closed) |
| `SA360_LEADCAPTURE_DATA_API_TIMEOUT_MS` | Read timeout | `15000` |
| `SA360_LEADCAPTURE_DATA_API_MAX_PAGE_SIZE` | Page size cap | `25` |

## Admin routes

- `POST /admin/v1/leadcapture/trust/pilot/preview` — read-only, no persistence
- `POST /admin/v1/leadcapture/trust/pilot/attach` — guarded single-lead attachment
- `POST /admin/v1/leadcapture/trust/pilot/reconcile-preview` — read-only campaign reconciliation (max 25)

Attach confirmation phrase: `ATTACH ONE LEADCAPTURE TRUST FORM`
