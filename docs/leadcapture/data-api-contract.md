# LeadCapture Data API contract (pilot reference)

Authoritative public source: [LeadCapture.io Data API](https://leadcapture.io/data-api/)

This document summarizes the contract used by the SA360 LeadCapture trust proof pilot. It does not replace the vendor OpenAPI spec or Postman collection supplied to Enterprise accounts.

## Base URL

- Default: `https://my.leadcapture.io/api`
- Override: `SA360_LEADCAPTURE_DATA_API_BASE_URL`

## Authentication

- Bearer token scoped per LeadCapture account
- Env: `SA360_LEADCAPTURE_DATA_API_TOKEN`
- Never log or persist the token in repository files

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/data/leads` | Cursor-paginated lead page |
| `GET` | `/v1/data/leads?since={cursor}&limit={n}` | Incremental sync |
| `GET` | `/v1/data/leads/{id}` | Single lead with deliveries |

## Pagination

- Response fields: `data`, `next_cursor`, `has_more`
- Pilot reconcile preview caps `limit` at 25

## Rate limits

- Vendor documents clear rate-limit headers; client handles `429` with `Retry-After`

## Trust / consent fields (webhook parity)

The Data API returns webhook-parity payloads. Trust evidence may include:

- `disclosure_text`, `disclosure_version`, `tcpa_consent`, `consent_timestamp`
- `submitted_at`, `source_url` / landing page URL
- `ip_address`, `user_agent`
- `verfi_proof_url`, TrustedForm certificate URLs, Jornaya tokens
- `leadproof_hash` / integrity hash
- `_meta.lead_id`, `_meta.funnel_id`, `_meta.updated_at`, `_meta.version`

## Pilot identifiers

| Field | Value |
| --- | --- |
| clientAccountId | `vet_life_james_torrey` |
| campaign key | `LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX` |
| Data API funnel UUID (`funnel_id`) | `d6f2157f-d612-441a-80af-88742ef084dc` |
| legacy form ID (old form system only) | `23381` — not a Data API `funnel_id` |
| provider / lane | `leadcapture_io` |

For the LeadCapture Data API pilot, persisted/`providerFormId` represents the provider `_meta.funnel_id` UUID. The name is retained for migration compatibility. Numeric ID `23381` belongs to a different legacy system and must not be used as `funnel_id`.

## LeadCapture 2.0 / NextGen identity join

Authoritative provider clarification:

| Channel | Field | Format |
| --- | --- | --- |
| NextGen webhook | `lead_id` | UUID |
| Data API | `_meta.lead_id` | UUID |

- Equality rule: webhook `lead_id` UUID **==** Data API `_meta.lead_id` UUID (identical and immutable)
- Attachment is allowed only for that exact UUID correlation (plus client/campaign/source-lane scope)
- `_meta.lead_number` is Data-API-only (internal auto-increment). It is **not** sent on webhooks and is **not** a correlation key
- Questionnaire/form field `number` is a form answer, not a lead identifier, not unique, and must never become `SourceLeadEvent.sourceLeadId`

## Legacy versus NextGen generation boundary

- Legacy lead IDs and form/campaign IDs are numeric (including legacy form ID `23381`)
- Legacy numeric lead IDs have **no** relationship to NextGen `lead_id` UUID or `_meta.lead_number`
- LeadCapture does **not** retain a legacy→NextGen crosswalk
- Historical legacy webhook events therefore cannot be automatically attached to NextGen Data API trust records
- Historical legacy trust recovery remains unsupported unless LeadCapture supplies a separate provider-backed artifact or mapping for those exact legacy records

## SA360 channel separation

- Webhooks remain speed-to-lead intake
- Data API is reconciliation, trust evidence, enrichment, and compliance only
- Proof attachment never authorizes GHL delivery
