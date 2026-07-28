# PPL Aged Inventory Beta — Local Operator Runbook

Local/test only. Keep PPL feature flags **disabled** outside local and controlled test environments.

> Root `.env` may point at a remote database. Override `DATABASE_URL` to localhost Docker Postgres before any migrate, seed, or rehearsal.

## Required feature flags (local)

```powershell
$env:DATABASE_URL = "postgresql://sa360:sa360password@127.0.0.1:5432/<local_db>"
$env:SA360_PPL_SELECTION_ENABLED = "true"
$env:SA360_PPL_LOCAL_MIN_QTY = "1"          # local/test only; do not enable in production
$env:SA360_PPL_CSV_EXPORT_ENABLED = "true"
$env:SA360_PPL_REPLACEMENT_ENABLED = "true"
$env:SA360_LF2_EXECUTION_ENABLED = "false"
$env:SA360_LF2_GHL_CANARY_ENABLED = "false"
# Leave all SA360_LF2_GHL_ALLOWED_* unset
```

## Workflow stages

### Stage 2b — Selection / reserve
1. Open FOWB → select buyer order (aged-lead / PPL).
2. Choose niche, states, commerce age buckets, exact quantity.
3. **Preview** eligible inventory and exclusion counts.
4. **Commit** exact selection (no buffer; reserved qty = requested qty when inventory allows).
5. Inventory moves `available → reserved` atomically.

### Stage 2c — Buyer-safe CSV + manual delivery
1. **Preview** CSV (no package, no delivery history).
2. **Commit** immutable `LeadDeliveryExportPackage`.
3. **Download** CSV (does **not** claim delivery).
4. Confirm delivery with exact phrase: `MARK SPREADSHEET DELIVERED`
5. Evidence note: `MANUAL SPREADSHEET DELIVERY RECORDED`
6. Only then are `BuyerDeliveredIdentity` rows written.

### Stage 2d — Duplicate-only replacement
1. Request replacement with `reasonCode: duplicate` for a delivered allocation.
2. Preview independent evidence (same-batch identity **or** prior same-buyer delivery).
3. Buyer free-text is never proof.
4. Approve with exact phrase: `APPROVE REPLACEMENT`
5. System reserves exactly one replacement via canonical buyer-aware selection.
6. Original inventory stays historically delivered / unavailable.
7. Export the replacement package; confirm spreadsheet delivery separately if needed.
8. Deny unproven claims; repeated approval does not issue a second replacement.

## Confirmation phrases

| Action | Exact phrase |
|---|---|
| Record spreadsheet delivery | `MARK SPREADSHEET DELIVERED` |
| Approve replacement | `APPROVE REPLACEMENT` |

## Operating rules

- **No buffer:** commit reserves exact requested quantity.
- **First-come, first-served:** competing commits; loser gets typed `reservation_conflict` / `inventory_changed_retry` (not raw SQLSTATE).
- **Duplicate-only replacements:** deferred reasons (disconnected phone, no answer, low quality, invalid/incomplete name, dissatisfaction, wrong demographic, consent complaint, arbitrary operator request) are rejected.
- **Manual delivery boundary:** CSV commit ≠ delivered; only the mark-delivered action creates buyer history.
- **No external writes:** no Google Sheets API, GHL, webhook, CRM, or email sends in this beta path. `externalWriteOccurred` stays false.

## Local rehearsal

```powershell
# Fresh disposable DB (example)
# docker exec sa360-postgres psql -U sa360 -d postgres -c "CREATE DATABASE sa360_ppl_beta_rehearsal;"
$env:DATABASE_URL = "postgresql://sa360:sa360password@127.0.0.1:5432/sa360_ppl_beta_rehearsal"
pnpm exec prisma migrate deploy
pnpm exec prisma generate
# flags as above
pnpm exec tsx scripts/ppl-aged-beta-rehearsal.ts
```

Fixtures: `apps/api/src/services/ppl-fulfillment/ppl-beta-fixtures.ts` (synthetic contacts only).

## Rollback / local shutdown

1. Stop API / Admin C.O.C. processes.
2. Leave PPL flags unset/`false` (especially `SA360_PPL_LOCAL_MIN_QTY`).
3. Drop disposable DBs if created (`DROP DATABASE …`).
4. Do not run migrate/seed against remote DigitalOcean using root `.env`.

## Known deferred features

- Orders under 100 pricing / production min-qty policy
- Actual Google Sheets API delivery
- Fresh leads
- Billing, refunds, and credits
- Public quality scoring
- Mandatory outcome reporting
