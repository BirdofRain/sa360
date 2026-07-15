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

## SA360 channel separation

- Webhooks remain speed-to-lead intake
- Data API is reconciliation, trust evidence, enrichment, and compliance only
- Proof attachment never authorizes GHL delivery
