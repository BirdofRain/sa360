# Bulk CSV lead imports

SA360 bulk imports let operators upload purchased or historical lead CSV files into the **same Source Intake pipeline** used by LeadCapture.io webhooks. There is no second delivery engine.

## Architecture

```mermaid
flowchart LR
  CSV[CSV upload] --> Batch[BulkLeadImport]
  Batch --> Rows[BulkLeadImportRow]
  Rows --> SLE[SourceLeadEvent]
  SLE --> Review[Operator review]
  Review --> Sim[GHL adapter simulate]
  Sim --> Approve[Typed approval]
  Approve --> Queue[BullMQ chunks]
  Queue --> GHL[Guarded GHL adapter]
```

### Core models

| Model | Purpose |
|-------|---------|
| `BulkLeadImport` | Batch metadata, mapping, destination, status counters |
| `BulkLeadImportRow` | Per-row audit, duplicate/delivery state, link to `SourceLeadEvent` |
| `BulkLeadImportMappingTemplate` | Reusable column maps |

Migration: `20260617120000_bulk_lead_import`

### Source identity

| Field | Value |
|-------|-------|
| `sourceProvider` | `manual_import` |
| `sourceSystem` | `csv_import` |
| `sourceType` | `bulk_import` |
| `sourceRouteKey` | `IMPORT::<batchId>` |

`sourceLeadId` precedence:

1. Mapped `source_lead_id` / vendor ID column
2. Stable hash of phone + email + batch/vendor (never `unknown_lead`)

### Routing

Manual imports **do not require** a `CampaignRoutingRule`. The operator-selected client + GHL location is recorded as:

- `routingSource`: `manual_bulk_import`
- `routingAuthority`: `operator_selected_destination`

Advanced mode `useExistingRoutingRules` may be enabled later; default is direct destination selection.

## Feature flag

| Layer | Variable |
|-------|----------|
| API | `SA360_BULK_SOURCE_IMPORTS_ENABLED=true` |
| Admin C.O.C. | `NEXT_PUBLIC_SA360_BULK_SOURCE_IMPORTS_ENABLED=true` |

Default: **off** in production unless explicitly enabled. Development defaults to on when unset.

## CSV requirements

- UTF-8 (BOM stripped)
- Delimiter: comma, semicolon, or tab (auto-detected)
- Quoted fields supported (`"Comma, Inside"`)
- Leading zeros preserved in phone/ID columns (parsed as strings)
- Max file size: 10 MB
- Max rows per batch: 10,000
- No real PII in repository fixtures — use `@example.test` only

## Operator workflow

1. **Upload** — `/source-intake/imports/new`
2. **Map fields** — CSV column → canonical SA360 field; ignore or preserve unmapped
3. **Select destination** — client, GHL location, workflow strategy
4. **Review** — normalize rows → `SourceLeadEvent` (no GHL writes)
5. **Simulate** — existing GHL adapter `simulate` mode
6. **Approve** — type `APPROVE BULK LEAD DELIVERY`; capped wave (default 250)
7. **Monitor** — background chunks via BullMQ
8. **Results** — export CSV from batch detail

## Duplicate policies

| Signal | Default |
|--------|---------|
| Duplicate `source_lead_id` in file or DB | Blocked |
| Duplicate phone in file | First row canonical; others review |
| Phone/email match different lead ID | Review required |
| No signals | Eligible |

Operators may exclude rows; no automatic GHL merge.

## Simulation & delivery gates

Delivery requires:

- At least one successful simulation on the batch
- Destination readiness (`readyForSimulation`)
- Typed approval phrase
- Row within approved wave limit
- Existing guarded GHL adapter (`runDirectDemoDelivery` / live canary)
- Direct delivery allowlist unchanged

**No automatic delivery after upload.**

## Workflow strategy (imports)

Default purchased-lead behavior should **not** trigger real-time new-lead automation unless explicitly selected:

| Strategy | Behavior |
|----------|----------|
| `source_tag_only` | Tags only (default recommended) |
| `no_automation` | No workflow tags |
| `aged_lead_workflow` | Dedicated import workflow |
| `trigger_new_lead` | Explicit opt-in; show call/SMS warning |

Example tags: `SA360::SOURCE::CSV_IMPORT`, `SA360::IMPORT::<batchId>`, `SA360::VENDOR::<vendor>`

## Queue / worker

| Setting | Default |
|---------|---------|
| Queue | `bulk-import-delivery` |
| Chunk size | 25 rows |
| Concurrency | 2 per worker |
| Inter-chunk delay | 2s |
| Retries | 3 exponential |

Worker calls API internal endpoint `POST /admin/v1/bulk-imports/internal/process-chunk` so delivery reuses the API GHL adapter.

Env: `SA360_API_INTERNAL_URL`, `ADMIN_API_KEY`, `BULK_IMPORT_DELIVERY_CONCURRENCY`

## API routes

| Method | Path |
|--------|------|
| GET | `/admin/v1/bulk-imports` |
| POST | `/admin/v1/bulk-imports/upload` |
| GET | `/admin/v1/bulk-imports/:id` |
| POST | `/admin/v1/bulk-imports/:id/mapping` |
| POST | `/admin/v1/bulk-imports/:id/destination` |
| POST | `/admin/v1/bulk-imports/:id/normalize` |
| POST | `/admin/v1/bulk-imports/:id/simulate` |
| POST | `/admin/v1/bulk-imports/:id/approve-delivery` |
| POST | `/admin/v1/bulk-imports/:id/pause` |
| GET | `/admin/v1/bulk-imports/:id/export-results` |
| POST | `/admin/v1/bulk-imports/internal/process-chunk` |

## Future Google Sheets

`BulkImportSource` interface supports `google_sheet` kind. A future connector should emit the same `ParsedImportRow` stream and create `BulkLeadImport` records — the CSV parser is not embedded in the delivery service.

## First controlled test

1. Enable flags in staging
2. Upload `purchased-leads-complete.csv` fixture (sanitized)
3. Map columns → select allowlisted demo destination
4. Normalize → verify Source Intake events created with `needs_review` / `routing_matched`
5. Simulate 5 rows → confirm no external GHL writes
6. Approve wave of ≤5 with phrase → monitor chunk delivery
7. Export results CSV; verify counts

## Pause / resume / failure recovery

- **Pause**: `POST .../pause` sets batch `paused`; worker chunks no-op
- **Retry**: re-run simulation or approve a new wave for failed rows after correction
- **Cancel**: exclude rows or mark batch `cancelled` (operator action)
