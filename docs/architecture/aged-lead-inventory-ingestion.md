# Aged Lead Inventory Ingestion v1

Stacked on [Lead Inventory Foundation PR #39](https://github.com/BirdofRain/sa360/pull/39).

## Domain boundary

| Model | Responsibility |
|-------|----------------|
| `SourceLeadEvent` | Normalized lead + contact identity (restricted payload) |
| `LeadInventoryItem` | Commercial inventory metadata only — no raw PII |
| `InventoryLot` | Batch-level provenance |
| `LeadInventoryImportBatch` | Operator audit — fingerprints and counts only |

## Guarded workflow

1. **Preview** (`POST /admin/v1/lead-inventory/imports/preview`) — zero DB writes
2. **Commit** (`POST /admin/v1/lead-inventory/imports/commit`) — requires exact confirmation phrase, requestId, operator note, matching file fingerprint

Imported items default to `pending_review`. No proof, verification, allocation, or delivery records are fabricated.

## Merge order

1. PR #38 (LeadCapture trust pilot)
2. PR #39 (Lead Inventory Foundation) — rebase + validate migrations
3. Aged lead ingestion PR — rebase onto updated PR #39

Do not merge or deploy until the chain is resolved.

## Reused infrastructure

- CSV parser and mapping (`csv-import-parser.service.ts`, `csv-import-mapping.service.ts`)
- Identity normalization (`phone-e164.service.ts`, `normalized-lead-identity.ts`)
- Inventory age/state (`lead-inventory-age.ts`, `lead-inventory-state.ts`)
- Duplicate within-batch index (`bulk-import-duplicate.service.ts`)

## Not in scope

- Production imports
- Automatic `available` status
- LeadCapture / GHL / payment / fulfillment writes
